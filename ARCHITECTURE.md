# CAD-Search: Teknik Mimari

> Son güncelleme: 2026-04-08 — Arama kalitesi + gerçek JPEG preview akışı güncellendi

---

## Karar Özeti

| Konu | Karar |
|------|-------|
| Model | SaaS — müşteri sıfır kurulum, sadece browser |
| İzolasyon | Her müşteri = kendi PostgreSQL schema'sı (aynı DB instance) |
| DB | VPS'te Docker container — PostgreSQL 16 + pgvector |
| Backend | FastAPI + Uvicorn, PM2 ile process yönetimi (Docker'sız) |
| Frontend | Vanilla JS (tek dosya `index.html`), ilerisi React |
| Auth | JWT — payload'da `user_id`, `schema_name`, `email` |
| Supabase | YOK — gereksiz maliyet, local PostgreSQL yeterli |

---

## Sistem Mimarisi

```
[Müşteri Browser]
       ↓
[Nginx + SSL]  ← sizin domain
       ↓
[FastAPI + Uvicorn]  ← PM2 ile yönetilen process
       ↓
[PostgreSQL 16 + pgvector]  ← Docker container
  ├── schema: public       → users tablosu
  ├── schema: acmemuh      → cad_files, categories, search_history (acmemuh.com)
  ├── schema: xyz          → cad_files, categories, search_history (xyz.com)
  └── schema: ...          → yeni kayıt → otomatik oluşur
```

---

## Tenant İzolasyon Mekanizması

```
Register: ali@acmemuh.com
  → schema_name = "acmemuh"
  → CREATE SCHEMA acmemuh
  → CREATE TABLE acmemuh.cad_files (...)
  → CREATE TABLE acmemuh.categories (...)
  → CREATE TABLE acmemuh.search_history (...)
  → JWT { user_id, schema_name: "acmemuh", email }

Her request:
  → JWT decode → schema_name al
  → SET search_path TO acmemuh
  → Tüm sorgular otomatik doğru schema'ya gider
```

---

## Vektör Yapısı

### Geometric Vektör — 128-D (değişmeyecek)

```
[0:20]    Entity type distribution (20 CAD tipi)
[20:36]   Çizgi açı histogramı (16 bin)
[36:52]   Çizgi uzunluk histogramı (16 bin)
[52:60]   Çember/yay yarıçapı histogramı (8 bin)
[60:64]   Entity yoğunluk metrikleri
[64:96]   Katman kompozisyonu (32 binary slot)
[96:112]  Boyutsal özellikler (aspect ratio, kağıt formatları)
[112:128] 4×4 spatial grid yoğunluğu
Son adım: L2 normalizasyon (cosine similarity için)
```

### CLIP Vektörü — 512-D (Faza 3)

```
Ham dosya (DWG/DXF/JPG/PNG)
  → generate_jpg_preview_from_bytes(...) ile görsel üretimi
  → openai/clip-vit-base-patch32
  → 512-D L2-normalize
Model: local, CPU, ~600MB, lazy singleton
```

### Hibrit Arama Skoru (Güncel)

```
SQL taban skor:
  clip_vector varsa:  base = 0.4 × geo_sim + 0.6 × clip_sim
  clip_vector yoksa:  base = geo_sim

SQL clip ceza katmanı:
  clip_sim < 0.25  → base × 0.65
  clip_sim < 0.40  → base × 0.85

Uygulama tarafı yeniden sıralama:
  query_mask + candidate_mask ile visual_similarity hesaplanır
  geometry_guard (aspect ratio + entity oranı) uygulanır
  final = (0.65 × base + 0.35 × visual_similarity) × geometry_guard

Not:
  visual_similarity üretilemezse final = base × geometry_guard
```

### Preview Üretim Akışı (DWG/DXF)

```
DWG ise:
  dwg2dxf (LibreDWG) → DXF bytes
DXF:
  ezdxf drawing backend (matplotlib/Agg) ile raster render
  kontur büyütme + iç dolgu (siluet)
  JPEG (data:image/jpeg;base64,...) olarak saklama
```

---

## Veritabanı Şeması (Tenant Schema)

```sql
-- Her tenant schema'sında:

categories (
  id, name, color, created_at
)

cad_files (
  id, filename, filepath, file_format, indexed_at,
  entity_count, layer_count, layers JSON, entity_types JSON,
  bbox_width, bbox_height, bbox_area,
  feature_vector vector(128),   -- geometric
  clip_vector    vector(512),   -- CLIP (Faza 3, nullable)
  svg_preview TEXT,
  jpg_preview TEXT,
  file_data BYTEA,
  category_id → categories(id)
)

search_history (
  id, query_filename, top_k, min_similarity,
  category_id, result_count, searched_at
)

-- Public schema:
users (id, email, password_hash, schema_name, company_name, created_at)
```

---

## API Endpoint'leri

| Method | Path | Açıklama |
|--------|------|----------|
| POST | /auth/register | Yeni tenant kayıt |
| POST | /auth/login | JWT token al |
| POST | /index | Tek dosya indexle |
| POST | /index/bulk | Toplu dosya indexle |
| POST | /search | Hibrit vektör araması |
| GET | /files | Dosya listesi (sayfalı) |
| GET | /files/{id} | Dosya detayı |
| GET | /files/{id}/download | Orijinal dosya indir (DB `file_data`) |
| DELETE | /files/{id} | Dosya sil |
| GET | /stats | Toplam/indexli dosya sayısı |
| GET/POST/PUT/DELETE | /categories | Kategori CRUD |
| GET | /history | Arama geçmişi |
| DELETE | /history/{id} | Geçmiş kaydı sil |
| DELETE | /history | Tüm geçmişi temizle |
| GET | /health | Sağlık kontrolü |

---

## Search Response Notları (2026-04-08)

- `/search` artık sorgu dosyasının görselini de döner: `query_preview`
- Sonuçlarda ek metrikler döner:
  - `clip_similarity`
  - `visual_similarity`
  - `geometry_guard`
- `/files/{id}` endpointi artık ham `BYTEA` dönmez; serileştirme güvenliği için:
  - `has_file_data` (bool)
  - `file_data` (geriye uyumluluk için var/yok flag)

---

## Kritik Dosyalar

| Dosya | Ne yapar | Dokunulabilir mi? |
|-------|----------|-------------------|
| `backend/features.py` | 128-D geometric vektör çıkarma | **HAYIR** |
| `backend/clip_encoder.py` | CLIP PNG render + encode | Evet |
| `backend/main.py` | FastAPI app, router kayıtları | Evet |
| `backend/db.py` | SQLAlchemy model, `init_db()`, migration | Evet |
| `backend/routes/auth.py` | Register / Login | Evet |
| `backend/routes/index.py` | `/index`, `/index/bulk` | Evet |
| `backend/routes/search.py` | `/search`, `/files`, `/stats` | Evet |
| `backend/routes/categories.py` | `/categories` CRUD | Evet |
| `backend/routes/history.py` | `/history` CRUD | Evet |
| `backend/middleware/tenant.py` | JWT doğrulama + search_path | Evet |
| `backend/services/schema_manager.py` | Tenant schema oluşturma | Evet |
| `frontend/index.html` | Tüm frontend SPA | Evet |
| `frontend/login.html` | Login / register | Evet |

---

## Kurallar

1. **`features.py`'e dokunma** — 128-D vektör sabittir, değişmez
2. **Named route'lar wildcard'dan önce** — `/files/stats` → `/files/{id}`'den önce
3. **CLIP başarısız olursa sessiz geç** — arama geometric ile devam eder
4. **Schema migration pattern** — `db.py:init_db()` içinde `ALTER TABLE IF NOT EXISTS` ile

---

## Faza Durumu

| Faza | Durum | İçerik |
|------|-------|--------|
| Faza 1 | ✅ Tamamlandı | Auth, multi-tenant, bulk upload, arama, frontend |
| Faza 2 | ✅ Tamamlandı | Önizleme, kategoriler, geçmiş, detay modal, karşılaştırma |
| Faza 3 | 🔄 Devam ediyor | CLIP embeddings (başlandı), analytics, entegrasyonlar |
| Faza 4 | ⬜ Başlanmadı | Güvenlik, rate limiting, monitoring |
