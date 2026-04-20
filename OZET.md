# CAD-Search — Kapsamlı Proje Özeti

> Oluşturulma: 2026-04-19 | Opus 4.7 için hazırlanmıştır

---

## Proje Nedir

AI destekli CAD dosyası benzerlik arama motoru. DWG/DXF/PDF dosyalarını vektöre dönüştürüp pgvector HNSW indeksiyle hızlı ve anlamlı benzerlik araması yapar. SaaS modeli — müşteri sadece tarayıcı kullanır, sıfır kurulum.

---

## Mimari Kararlar (Sabit)

| Konu | Karar |
|------|-------|
| Model | SaaS — müşteri hiçbir şey kurmaz |
| İzolasyon | Her müşteri = kendi PostgreSQL schema'sı (aynı DB instance) |
| DB | PostgreSQL 16 + pgvector (Docker'sız sistem servisi) |
| Backend | FastAPI + Uvicorn, PM2 ile process yönetimi |
| Frontend | Vanilla JS — tek dosya `frontend/index.html` SPA |
| Auth | JWT — payload'da `user_id`, `schema_name`, `email` |
| Supabase | YOK — gereksiz maliyet, local PostgreSQL yeterli |
| Docker | YASAK — `git pull` + process restart + nginx reload yeterli |

---

## Sistem Mimarisi

```
[Müşteri Browser]
       ↓
[Nginx + SSL]  ← alan adı
       ↓
[FastAPI + Uvicorn]  ← PM2 yönetimli, port 8000
       ↓
[PostgreSQL 16 + pgvector]
  ├── schema: public       → users tablosu (tüm tenantlar)
  ├── schema: acmemuh      → cad_files, categories, search_history, activity_log
  ├── schema: xyz          → cad_files, categories, search_history, activity_log
  └── schema: ...          → yeni kayıt → otomatik oluşur
```

---

## Multi-Tenant Çalışma Mantığı

```
Kayıt: ali@acmemuh.com
  → schema_name = "acmemuh"
  → CREATE SCHEMA acmemuh
  → CREATE TABLE acmemuh.cad_files (...)
  → CREATE TABLE acmemuh.categories (...)
  → CREATE TABLE acmemuh.search_history (...)
  → CREATE TABLE acmemuh.activity_log (...)
  → JWT { user_id, schema_name: "acmemuh", email }

Her istek:
  → Authorization: Bearer <JWT>
  → JWT decode → schema_name çek
  → SET search_path TO acmemuh
  → Tüm sorgular otomatik doğru schema'ya gider
```

---

## Vektör Yapısı

### Geometric Vektör — 128 Boyut (features.py — DOKUNMA)

```
[0:20]    Entity type dağılımı (20 CAD tipi)
[20:36]   Çizgi açı histogramı (16 bin)
[36:52]   Çizgi uzunluk histogramı (16 bin)
[52:60]   Çember/yay yarıçapı histogramı (8 bin)
[60:64]   Entity yoğunluk metrikleri
[64:96]   Katman kompozisyonu (32 binary slot)
[96:112]  Boyutsal özellikler (aspect ratio, kağıt formatları)
[112:128] 4×4 spatial grid yoğunluğu
Son adım: L2 normalizasyon (cosine similarity için)
```

CAD entity tipleri (20 adet):
LINE, CIRCLE, ARC, POLYLINE, LWPOLYLINE, SPLINE, ELLIPSE, TEXT, MTEXT, INSERT, HATCH, DIMENSION, LEADER, SOLID, TRACE, POINT, RAY, XLINE, 3DFACE, MESH

### CLIP Vektörü — 512 Boyut (clip_encoder.py — Faza 3)

```
Ham dosya (DWG/DXF/JPG/PNG)
  → generate_jpg_preview_from_bytes() ile görsel üretimi
  → openai/clip-vit-base-patch32 modeli
  → 512-D L2-normalize

Model: local, CPU, ~600 MB, lazy singleton (ilk istekte yüklenir)
```

### Hibrit Arama Skoru

```
SQL taban skor:
  clip_vector varsa:  base = 0.4 × geo_sim + 0.6 × clip_sim
  clip_vector yoksa:  base = geo_sim

SQL clip ceza katmanı:
  clip_sim < 0.25  → base × 0.65
  clip_sim < 0.40  → base × 0.85

Uygulama tarafı yeniden sıralama (re-rank):
  query_mask + candidate_mask ile visual_similarity hesabı
  geometry_guard (aspect ratio + entity oranı) uygulanır
  final = (0.65 × base + 0.35 × visual_similarity) × geometry_guard

Fallback:
  visual_similarity üretilemezse → final = base × geometry_guard
```

### Preview Üretim Akışı

```
DWG ise:
  dwg2dxf (LibreDWG) → DXF bytes

DXF:
  ezdxf drawing backend (matplotlib/Agg) → raster render
  kontur büyütme + iç dolgu (siluet etkisi)
  JPEG (data:image/jpeg;base64,...) olarak DB'ye yaz
```

---

## Veritabanı Şeması

### public.users (tüm tenantlar için ortak)

```sql
users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR NOT NULL UNIQUE,
  password_hash VARCHAR NOT NULL,
  schema_name   VARCHAR NOT NULL UNIQUE,
  company_name  VARCHAR DEFAULT '',
  created_at    TIMESTAMP DEFAULT NOW()
)
```

### {tenant_schema}.cad_files

```sql
cad_files (
  id              SERIAL PRIMARY KEY,
  filename        VARCHAR NOT NULL,
  filepath        VARCHAR NOT NULL UNIQUE,
  file_format     VARCHAR NOT NULL,          -- 'dwg' | 'dxf' | 'pdf'
  indexed_at      TIMESTAMP DEFAULT NOW(),

  -- İstatistikler
  entity_count    INTEGER DEFAULT 0,
  layer_count     INTEGER DEFAULT 0,
  layers          JSON DEFAULT '[]',         -- ["walls","doors",...]
  entity_types    JSON DEFAULT '{}',         -- {"LINE":120,"CIRCLE":40,...}
  bbox_width      FLOAT DEFAULT 0.0,
  bbox_height     FLOAT DEFAULT 0.0,
  bbox_area       FLOAT DEFAULT 0.0,

  -- Önizleme
  svg_preview     TEXT,                      -- küçük SVG string
  jpg_preview     TEXT,                      -- data:image/jpeg;base64,...

  -- Dosya verisi
  file_data       BYTEA,                     -- orijinal ham dosya

  -- İş akışı
  approved        BOOLEAN DEFAULT FALSE,
  approved_at     TIMESTAMP,
  approval_status VARCHAR(20) DEFAULT 'uploaded',  -- 'uploaded' | 'draft' | 'approved'
  category_id     INTEGER → categories(id),

  -- Vektörler
  feature_vector  vector(128),               -- geometric (zorunlu)
  clip_vector     vector(512)                -- CLIP (nullable, Faza 3)
)
```

### {tenant_schema}.categories

```sql
categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR NOT NULL,
  color      VARCHAR DEFAULT '#3B82F6',
  created_at TIMESTAMP DEFAULT NOW()
)
```

### {tenant_schema}.search_history

```sql
search_history (
  id             SERIAL PRIMARY KEY,
  query_filename VARCHAR NOT NULL,
  top_k          INTEGER DEFAULT 10,
  min_similarity FLOAT DEFAULT 0.5,
  category_id    INTEGER,
  result_count   INTEGER DEFAULT 0,
  searched_at    TIMESTAMP DEFAULT NOW()
)
```

### {tenant_schema}.activity_log

```sql
activity_log (
  id         SERIAL PRIMARY KEY,
  action     VARCHAR(50) NOT NULL,
  filename   VARCHAR,
  file_id    INTEGER,
  user_email VARCHAR,
  details    VARCHAR,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### HNSW İndeksleri

```sql
-- Geometric vektör (her tenant schema'sında)
CREATE INDEX USING hnsw (feature_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- CLIP vektör (her tenant schema'sında)
CREATE INDEX {schema}_clip_vector_idx
  ON {schema}.cad_files
  USING hnsw (clip_vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## API Endpoint'leri

| Method | Path | Açıklama | Auth |
|--------|------|----------|------|
| POST | /auth/register | Yeni tenant kayıt, schema oluşturma | Hayır |
| POST | /auth/login | JWT token al | Hayır |
| GET | /health | Sağlık kontrolü | Hayır |
| POST | /index | Tek dosya indexle | JWT |
| POST | /index/bulk | Toplu dosya indexle (ZIP veya çoklu) | JWT |
| POST | /search | Hibrit vektör benzerlik araması | JWT |
| GET | /files | Dosya listesi (sayfalı, filtreli) | JWT |
| POST | /files/approve/bulk | Toplu durum atama | JWT |
| GET | /files/{id} | Dosya detayı (has_file_data flag) | JWT |
| GET | /files/{id}/download | Orijinal dosya indir (DB file_data) | JWT |
| DELETE | /files/{id} | Dosya sil | JWT |
| GET | /stats | Toplam/indexlenmiş dosya sayısı | JWT |
| GET | /categories | Kategori listesi | JWT |
| POST | /categories | Yeni kategori | JWT |
| PUT | /categories/{id} | Kategori güncelle | JWT |
| DELETE | /categories/{id} | Kategori sil | JWT |
| GET | /history | Arama geçmişi | JWT |
| DELETE | /history/{id} | Tek geçmiş kaydı sil | JWT |
| DELETE | /history | Tüm geçmişi temizle | JWT |
| GET | /analytics | Dashboard istatistikleri | JWT |
| POST | /contour/vectorize | Kontur vektörizasyonu | JWT |
| GET | /activity | Aktivite log listesi | JWT |
| POST | /scan/convert | Tarama dönüştürme | JWT |
| POST | /scan/export-dxf | DXF dışa aktar | JWT |

### /files Sorgu Parametreleri

```
GET /files?page=1&limit=20&status=uploaded|draft|approved&approved=true|false&category_id=5
```

### /search İstek Yapısı

```json
{
  "file": "<multipart/form-data>",
  "top_k": 10,
  "min_similarity": 0.20,
  "category_id": null
}
```

### /search Yanıt Yapısı

```json
{
  "query_preview": "data:image/jpeg;base64,...",
  "results": [
    {
      "id": 1,
      "filename": "parca.dxf",
      "similarity": 0.87,
      "clip_similarity": 0.82,
      "visual_similarity": 0.79,
      "geometry_guard": 0.95,
      "jpg_preview": "data:image/jpeg;base64,...",
      "entity_count": 450,
      "layer_count": 8,
      "approval_status": "approved"
    }
  ]
}
```

---

## Kritik Dosyalar

| Dosya | Rol | Dokunulabilir mi? |
|-------|-----|-------------------|
| `backend/main.py` | FastAPI app, tüm router kayıtları | Evet |
| `backend/features.py` | 128-D geometric vektör çıkarma | **HAYIR** |
| `backend/clip_encoder.py` | CLIP PNG render + 512-D encode | Evet |
| `backend/db.py` | SQLAlchemy model, `init_db()`, migration loop | Evet |
| `backend/services/schema_manager.py` | Tenant schema oluşturma, TENANT_SCHEMA_SQL | Evet |
| `backend/middleware/tenant.py` | JWT doğrulama + SET search_path | Evet |
| `backend/routes/auth.py` | Register / Login | Evet |
| `backend/routes/index.py` | /index, /index/bulk | Evet |
| `backend/routes/search.py` | /search, /files, /stats | Evet |
| `backend/routes/categories.py` | /categories CRUD | Evet |
| `backend/routes/history.py` | /history CRUD | Evet |
| `backend/routes/analytics.py` | /analytics | Evet |
| `backend/routes/contour.py` | /contour/vectorize | Evet |
| `backend/routes/activity.py` | /activity log | Evet |
| `backend/routes/scan.py` | /scan/convert, /scan/export-dxf | Evet |
| `frontend/index.html` | Tüm frontend SPA (Ara + DB + Kategoriler sekmeleri) | Evet |
| `frontend/login.html` | Login / register sayfası | Evet |
| `ARCHITECTURE.md` | Tam mimari referans | Evet |
| `proje_plan.md` | Görev takibi — her işlem sonrası güncellenmeli | Evet |

---

## Zorunlu Kurallar

### Route Sıralaması
Named route'lar wildcard route'lardan önce tanımlanmalı:
```python
# DOĞRU:
router.get("/files/stats")   # önce
router.get("/files/{id}")    # sonra
```

### Yeni Tablo/Kolon Ekleme Sırası
1. `backend/services/schema_manager.py` → `TENANT_SCHEMA_SQL`'e ekle
2. `backend/db.py` → `init_db()` migration loop'a `ALTER TABLE IF NOT EXISTS` ekle
3. `ARCHITECTURE.md` ve `proje_plan.md` güncelle

### CLIP Başarısızlık Davranışı
CLIP encode başarısız olursa sessizce geç — arama geometric vektörle devam eder. Hata fırlatma.

### proje_plan.md Kuralı
Her görev tamamlandığında `proje_plan.md` güncellenmeli: `⬜` → `✅`

### NO_DOCKER Politikası
Docker kurulumu/çalıştırması tamamen yasak. Operasyon akışı:
```
git pull → uvicorn/pm2 restart → nginx reload
```

---

## Stack

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| Backend dili | Python | 3.9 |
| Web framework | FastAPI | - |
| ASGI sunucusu | Uvicorn | - |
| Process manager | PM2 | - |
| ORM | SQLAlchemy | 2.0 |
| DB | PostgreSQL | 16 |
| Vektör uzantısı | pgvector (HNSW m=16 ef=64) | - |
| CAD okuyucu | ezdxf | - |
| DWG→DXF | LibreDWG dwg2dxf binary | 0.13.3 |
| PDF desteği | pypdf | - |
| ML modeli | openai/clip-vit-base-patch32 (local CPU) | - |
| Render | matplotlib/Agg (raster), ezdxf drawing backend | - |
| Frontend | Vanilla JS + Chart.js | - |
| Web sunucusu | Nginx + SSL | - |
| Auth | JWT (python-jose) | - |
| Şifre hash | bcrypt | - |

---

## Faza Durumu

| Faza | Durum | İçerik |
|------|-------|--------|
| Faza 1 | ✅ Tamamlandı | Auth, multi-tenant, bulk upload, arama, frontend, PDF |
| Faza 2 | ✅ Tamamlandı | Önizleme, kategoriler, geçmiş, detay modal, karşılaştırma, onay akışı |
| Faza 3.1 | ✅ Tamamlandı | CLIP embeddings + hibrit skor |
| Faza 3.2 | ✅ Tamamlandı | Analytics dashboard (Chart.js) |
| Faza 3.3 | ✅ Tamamlandı | Gerçekçi JPEG preview pipeline |
| Faza 3.4 | ✅ Tamamlandı | Hibrit skor + görsel re-rank + geometry_guard |
| Faza 3.5 | ✅ Tamamlandı | Arama sonuçlarında query_preview gösterimi |
| Faza 3.6 | ⬜ Bekliyor | Autodesk Vault / SharePoint entegrasyonu |
| Faza 3.7 | ⬜ Bekliyor | API key desteği (dışarıdan sorgu) |
| Faza 3.8 | ⬜ Bekliyor | Redis query cache |
| Faza 3.9 | ⬜ Bekliyor | Vector quantization (int8) |
| Faza 4 | ⬜ Başlanmadı | Güvenlik — kota, MIME validasyon, CORS whitelist, rate limit, monitoring |
| VPS Deploy | ⬜ Bekliyor | Nginx+SSL, PM2 config, CI/CD |

---

## Bilinen Açık Buglar

| Dosya | Bug | Öncelik |
|-------|-----|---------|
| `scripts/bulk_index.py` | `init_db_engine()` undefined — UI upload yeterli | Düşük |
| `backend/features.py` | ezdxf eski DWG versiyonlarını sessiz fail ediyor | Düşük |
| `backend/.env` | Port 5433 hardcode — VPS'te 5432 olacak | VPS deploy'da düzelt |

---

## Yerel Geliştirme

```bash
./start-dev.sh

# Frontend  → http://localhost:8080/login.html
# Backend   → http://localhost:8000
# API Docs  → http://localhost:8000/docs
# Test user → admin@example.com / admin123
```

### DWG Desteği için LibreDWG

```bash
./scripts/setup-dwg2dxf.sh
# /tmp/libredwg-0.13.3/programs/dwg2dxf konumuna derler
```

---

## Frontend Yapısı (index.html SPA)

Tek sayfa uygulaması, sekmeli yapı:

| Sekme | İçerik |
|-------|--------|
| Ara | Dosya yükle → benzer CAD'leri bul → grid/liste görünüm, önizleme sidebar, arama geçmişi |
| Veritabanı | Tüm dosyalar — tablo, category badge, durum, dosya detay modal, toplu checkbox seçim, durum atama, karşılaştırma |
| Kategoriler | Kategori CRUD + renk seçici |
| Ürün Durumları | yüklendi/draft/onaylı filtreli liste + toplu durum atama |
| Analytics | Dashboard — Chart.js grafikleri, en çok aranan, dağılım |
| Aktivite | Sistem aktivite logu |

### Arama Akışı (kullanıcı perspektifi)
1. Dosya seçilir (DWG/DXF/PDF)
2. `/search` endpoint'e gönderilir
3. Yanıtta `query_preview` (aranan dosyanın görseli) + sonuç listesi gelir
4. Her sonuçta JPEG önizleme, benzerlik skoru, entity/katman bilgisi
5. "Karşılaştır" butonu ile iki dosya yan yana modal'da görülür
6. Onay durumuna göre badge rengi değişir

---

## Agent Sorumlulukları (AGENTS.md özeti)

Bu proje AI ajanlarla birlikte geliştiriliyor. Her ajan bu kuralları bilmeli:

- `features.py`'e dokunmaz
- `schema_manager.py` değiştirilirken migration loop zorunlu
- Mevcut DB şeması migration yazılmadan bozulmaz
- `.env` dosyası değiştirilmez
- Docker önerisi verilmez, kurulmaz
- Her görev bitiminde `proje_plan.md` güncellenir
- `CLIP` encode hatası sessizce yutulur, arama bozulmaz
