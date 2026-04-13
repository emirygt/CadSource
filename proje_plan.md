# CAD-Search — Proje Planı
> Son güncelleme: 2026-04-13

---

## Genel Durum: Faza 1 ✅, Faza 2 ✅, Faza 3.1-3.5 ✅ — MVP hazır, arama kalitesi iyileştirildi

---

## FAZA 1 — SaaS Altyapısı ✅ TAMAMLANDI

| # | Görev | Durum | Not |
|---|-------|-------|-----|
| 1.1 | PostgreSQL + pgvector Docker container | ✅ | `cad_postgres`, port 5433, şifre `password` |
| 1.2 | FastAPI backend (uvicorn) | ✅ | `backend/main.py`, port 8000 |
| 1.3 | Multi-tenant schema sistemi | ✅ | `services/schema_manager.py` — register → CREATE SCHEMA |
| 1.4 | JWT auth (register + login) | ✅ | `routes/auth.py`, JWT payload'da `schema_name` |
| 1.5 | `/index` tek dosya endpoint | ✅ | `routes/index.py` |
| 1.6 | `/index/bulk` toplu upload endpoint | ✅ | batch 10'lu gönderim |
| 1.7 | `/search` vektör benzerlik araması | ✅ | pgvector cosine, HNSW index |
| 1.8 | `/files` CRUD (list, get, delete) | ✅ | `routes/search.py` |
| 1.9 | `/stats` endpoint | ✅ | toplam / indexlenmiş dosya sayısı |
| 1.10 | 128-D feature vector (DXF/DWG) | ✅ | `features.py` — sabit, değişmeyecek |
| 1.11 | Frontend login/register sayfası | ✅ | `frontend/login.html` |
| 1.12 | Frontend arama arayüzü | ✅ | `frontend/index.html` — grid/liste view |
| 1.13 | Frontend DB sekmesi (upload + liste) | ✅ | index.html içinde 2. sekme |
| 1.14 | PDF desteği (upload + indexleme) | ✅ | `pypdf` — sayfa boyutu/metin → 128-D vektör |
| 1.15 | Local geliştirme scriptleri | ✅ | `start-dev.sh` / `stop-dev.sh` |

**Faza 1'de düzeltilen buglar:**
- `routes/index.py`: `:param::json` → `CAST(:param AS jsonb)` (SQLAlchemy çakışması)
- Tüm frontend path'leri absolute → relative (`/login.html` → `login.html`)
- PostgreSQL container port 5433, şifre `password` (docker-compose.yml varsayılanından farklı)

**Faza 1'de yapılmayan (ertelendi):**
- Nginx + SSL kurulumu → Faza 1 sonunda (VPS deploy henüz yapılmadı)
- PM2 config → VPS deploy ile birlikte
- `scripts/bulk_index.py` bug fix → düşük öncelikli (UI'dan upload yeterli)

---

## FAZA 2 — Kullanılabilir Ürün 🔄 DEVAM EDİYOR

| # | Görev | Durum | Açıklama |
|---|-------|-------|----------|
| 2.1 | CAD önizleme — sidebar (Ara sekmesi) | ✅ | Dosya seçilince tarayıcıda DXF parse → SVG render |
| 2.2 | CAD önizleme — DB sekmesi "Önizle" butonu | ✅ | Backend SVG üretir (upload sırasında), modal'da gösterilir |
| 2.3 | Kategori sistemi (backend + DB) | ✅ | `/categories` CRUD, `cad_files.category_id` kolonu |
| 2.4 | Kategoriler sekmesi (frontend) | ✅ | Ekle/düzenle/sil + renk seçici |
| 2.5 | Upload'da kategori seçimi | ✅ | DB sekmesinde dropdown, bulk upload'a category_id eklendi |
| 2.6 | DB tablosunda kategori badge | ✅ | Renk kodlu badge, her satırda görünür |
| 2.7 | Katman / entity tipi filtresi | ⬜ | Arama sidebar'a ek filtreler |
| 2.8 | Boyut aralığı filtresi | ⬜ | A3/A4/A2 format seçimi |
| 2.9 | Arama geçmişi | ✅ | `search_history` tablosu, `/history` CRUD, sidebar geçmiş bölümü |
| 2.10 | Favoriler | ⬜ | `favorites` tablosu + UI |
| 2.11 | İki çizimi yan yana karşılaştırma | ✅ | Sonuç kartına "Karşılaştır" butonu, yan yana modal, SVG lazy load |
| 2.12 | Dosya detay modalı | ✅ | DB tablosunda satıra tıkla → SVG + tüm metadata popup |
| 2.13 | DB toplu durum akışı | ✅ | DB tablosunda checkbox + status seçimi (`yüklendi/draft/onaylı`) |
| 2.14 | Ürün Durumları sekmesi | ✅ | Tek sayfa, filtreyle yüklendi/draft/onaylı listeleme + toplu durum atama |

**Sıradaki görev:** Faza 3 başladı — 3.1 CLIP embeddings

---

## FAZA 3 — Akıllı Arama & Ölçek 🔄 DEVAM EDİYOR

| # | Görev | Durum |
|---|-------|-------|
| 3.1 | CLIP embeddings (CAD render → ML vektör) | ✅ | 512-D CLIP + 128-D concat → search route — tamamlandı |
| 3.2 | Analytics dashboard (en çok aranan, dağılım) | ✅ | `/analytics` route, Chart.js dashboard — tamamlandı |
| 3.3 | DWG/DXF gerçekçi JPEG preview pipeline | ✅ | `generate_jpg_preview_from_bytes` + DWG→DXF render + siluet dolgu |
| 3.4 | Hibrit skor sonrası kalite re-rank | ✅ | `visual_similarity` + `geometry_guard` ile false-positive azaltma |
| 3.5 | Aranan dosyanın görselini sonuç üstünde gösterme | ✅ | `/search` → `query_preview`, frontend "Aranan Dosya" kartı |
| 3.6 | Autodesk Vault / SharePoint entegrasyonu | ⬜ |
| 3.7 | API key desteği (dışarıdan sorgu) | ⬜ |
| 3.8 | Redis query cache | ⬜ |
| 3.9 | Vector quantization (int8, 4x küçük) | ⬜ |

---

## FAZA 4 — Güvenlik ⬜ BAŞLANMADI

| # | Görev | Durum |
|---|-------|-------|
| 4.1 | Dosya boyutu kota (tenant başına) | ⬜ |
| 4.2 | MIME type + magic byte validasyonu | ⬜ |
| 4.3 | CORS whitelist (wildcard kaldır) | ⬜ |
| 4.4 | Rate limiting (tenant bazlı) | ⬜ |
| 4.5 | Prometheus metrics + Grafana | ⬜ |

---

## VPS Deploy (Faza 1 sonunda yapılacak)

| # | Görev | Durum |
|---|-------|-------|
| D.1 | VPS temin + SSH erişimi | ⬜ |
| D.2 | Docker kurulumu + `cad_postgres` container | ⬜ |
| D.3 | Backend venv + PM2 ecosystem config | ⬜ |
| D.4 | Nginx config + SSL (Let's Encrypt) | ⬜ |
| D.5 | Domain bağlama | ⬜ |
| D.6 | CI/CD (GitHub Actions → VPS deploy) | ⬜ |

---

## Bilinen Açık Buglar

| Dosya | Bug | Öncelik |
|-------|-----|---------|
| `scripts/bulk_index.py` | `init_db_engine()` undefined | Düşük (UI upload yeterli) |
| `features.py` | ezdxf eski DWG versiyonlarını sessiz fail ediyor | Düşük (hata mesajı artık net) |
| `backend/.env` | Port 5433 hardcode — VPS'te 5432 olacak | VPS deploy'da düzelt |

## MVP Olarak Tamamlananlar (bu oturumda)
- ZIP bulk upload (500 MB limit, iç içe klasör, çakışma önleme)
- Bulk upload'da CLIP skip (hızlı mod — varsayılan açık)
- Dosya boyutu limitleri (tekil 50 MB, ZIP 500 MB)
- Hata mesajları net hale getirildi (eski DWG, bozuk dosya)
- Min. benzerlik default %50 → %20
- Analytics boş veri graceful handling
- Sonuç bulunamadı mesajı yönlendirici hale getirildi
- Gerçek DWG/DXF tabanlı `jpg_preview` üretimi (Cloud-converter'a daha yakın render)
- Re-index/backfill akışı: mevcut kayıtlara `jpg_preview` ve CLIP güncelleme desteği
- `/files/{id}` JSON serileştirme düzeltmesi (`BYTEA` yerine `has_file_data` flag)
- `/files/{id}/download` ile orijinal dosya indirme
- Sonuç ekranında "Aranan Dosya" görsel kartı (`query_preview`)
- Search skorunda görsel karşılaştırma + geometri guard ile daha güvenli sıralama

---

## Kritik Dosyalar

| Dosya | Ne yapar |
|-------|----------|
| `backend/main.py` | FastAPI app, router kayıtları |
| `backend/features.py` | 128-D vektör çıkarma — **DOKUNMA** |
| `backend/db.py` | SQLAlchemy model, `init_db()` |
| `backend/routes/auth.py` | Register / Login |
| `backend/routes/index.py` | `/index`, `/index/bulk` |
| `backend/routes/search.py` | `/search`, `/files`, `/stats` |
| `backend/middleware/tenant.py` | JWT doğrulama + search_path |
| `backend/services/schema_manager.py` | Tenant schema oluşturma |
| `frontend/index.html` | Ana uygulama (Ara + DB sekmeleri) |
| `frontend/login.html` | Login / register |
| `start-dev.sh` | Local ortamı tek komutla başlatır |

---

## Local Çalışma Hatırlatması

```bash
./start-dev.sh
# Frontend → http://localhost:8080/login.html
# Backend  → http://localhost:8000
# API Docs → http://localhost:8000/docs
# Login    → admin@example.com / admin123
```
