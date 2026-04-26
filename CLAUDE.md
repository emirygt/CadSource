# CAD-Search Project Memory

## 🔒 NO_DOCKER Politikası (Zorunlu)
- Bu projede Docker kurulumu/çalıştırması **yasak**.
- AI ajanlar `docker`/`docker compose` kurulum veya deploy akışı önermemeli.
- Operasyon akışı: `git pull` + backend process restart (`uvicorn`/`pm2`/`systemd`) + `nginx reload`.

---
## ⚡ Son Tamamlanan Görevler
- ✅ Faza 3.1 — CLIP embedding + hibrit arama (0.4*geo + 0.6*clip)
- ✅ 3-seviyeli Excel kategori import (category_1/2/3, template download, dedup)
- ✅ categories.parent_id migration (schema_manager + db.py loop)
- ✅ Min. benzerlik slider adımı 5→1
- ✅ Page header sidebar bg rengiyle eşleştirildi
- ✅ Scan → CAD nav tab geri getirildi (yanlışlıkla display:none yapılmıştı)

## VPS Bilgisi
- Host: 3.79.98.10 — ec2-user@ip-172-31-22-74
- Backend: PM2 ile `venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --name cadsearch`
- Deploy: `git pull` → sadece frontend değişmişse restart gerekmez
- Backend değişmişse: `pm2 restart cadsearch`
- VPS'te venv yoksa: `python3 -m venv venv && venv/bin/pip install -r requirements.txt`

## Sıradaki
Faza 3.3 — Autodesk Vault / SharePoint entegrasyonu (veya 3.4 API key)
---

## Proje Nedir
AI destekli CAD dosyası benzerlik arama motoru. DWG/DXF dosyalarını 128 boyutlu vektöre dönüştürüp pgvector HNSW ile < 100ms aramayı hedefliyor. SaaS modeli — müşteri sadece browser kullanır, sıfır kurulum.

## Mimari Kararlar (Kesin)
- **Model:** SaaS, müşteri hiçbir şey kurmaz
- **İzolasyon:** Her müşteri = kendi PostgreSQL schema'sı (aynı DB instance)
- **DB:** PostgreSQL 16 + pgvector (Docker'sız servis)
- **Backend:** FastAPI + Uvicorn → PM2 ile process yönetimi (Docker'sız)
- **Frontend:** Şimdilik Vanilla JS, ilerisi React
- **Auth:** JWT, payload'da `schema_name` claim'i var
- **Supabase YOK** — gereksiz maliyet, local PostgreSQL yeterli
- **Bulk yükleme:** Web UI üzerinden, müşteri kendi dosyalarını yükler

## Multi-Tenant Çalışma Mantığı
```
Register: ali@acmemuh.com → schema_name = "acmemuh"
→ CREATE SCHEMA acmemuh
→ CREATE TABLE acmemuh.cad_files (...)  -- standart tabloyu kopyala
→ JWT token { user_id, schema_name: "acmemuh", email }

Her request:
→ JWT'den schema_name al
→ SET search_path TO acmemuh
→ Tüm sorgular otomatik acmemuh.cad_files'a gider
```

## Feature Vector (128-D) — Değişmeyecek
- [0:20]    Entity type distribution (20 CAD tipi)
- [20:36]   Çizgi açı histogramı (16 bin)
- [36:52]   Çizgi uzunluk histogramı (16 bin)
- [52:60]   Çember/yay yarıçapı histogramı (8 bin)
- [60:64]   Entity yoğunluk metrikleri
- [64:96]   Katman kompozisyonu (32 binary slot)
- [96:112]  Boyutsal özellikler (aspect ratio, kağıt formatları)
- [112:128] 4×4 spatial grid yoğunluğu
- **Son adım:** L2 normalizasyon (cosine similarity için)

## Faza Durumu
- **Faza 1** ✅ — Auth, multi-tenant, bulk upload, arama, frontend
- **Faza 2** ✅ — Önizleme, kategoriler, geçmiş, detay modal, karşılaştırma
- **Faza 3** 🔄 — CLIP embeddings başlandı (3.1), devam ediyor
- **Faza 4** ⬜ — Güvenlik (en son)

## Kritik Dosyalar
- `backend/main.py` — FastAPI app, tüm router kayıtları
- `backend/features.py` — 128-D geometric vektör çıkarma — **DOKUNMA**
- `backend/clip_encoder.py` — CLIP PNG render + 512-D encode (Faza 3)
- `backend/db.py` — SQLAlchemy model, `init_db()`, tenant migration loop
- `backend/services/schema_manager.py` — Tenant schema oluşturma, `TENANT_SCHEMA_SQL`
- `backend/routes/auth.py` — Register / Login
- `backend/routes/index.py` — `/index`, `/index/bulk`
- `backend/routes/search.py` — `/search`, `/files`, `/stats`
- `backend/routes/categories.py` — `/categories` CRUD
- `backend/routes/history.py` — `/history` CRUD
- `backend/middleware/tenant.py` — JWT doğrulama + SET search_path
- `frontend/index.html` — Tüm frontend SPA
- `ARCHITECTURE.md` — Tam mimari, şema, endpoint listesi
- `AGENTS.md` — Agent sorumlulukları ve kurallar
- `proje_plan.md` — Görev takibi (her işlem sonrası güncelle)

## 🚫 Yasaklar
- Docker kurmak/çalıştırmak/öneri vermek (`docker`, `docker compose`, kurulum scriptleri)
- `features.py` — DOKUNMA, geometric vektör sabittir
- `schema_manager.py` → TENANT_SCHEMA_SQL'i migration loop yazmadan değiştirme
- Mevcut DB şemasını migration yazmadan bozma
- `.env` dosyasını değiştirme

## Bilinen Buglar
- `scripts/bulk_index.py`: `init_db_engine()` çağrısı undefined — düşük öncelik (UI upload yeterli)
- ezdxf eski DWG versiyonlarını açamıyor (sessiz fail)

## Dev Setup
Detay için → `DEV_SETUP.md`
Başlatmak için: `./start-dev.sh`
Backend API: http://localhost:8000 | Frontend: http://localhost:8080/login.html

## Stack
Python 3.9, FastAPI, SQLAlchemy 2.0, pgvector (HNSW m=16 ef=64), ezdxf, CLIP (transformers)
PostgreSQL 16 (service) | PM2 + Nginx

## Route Kuralı
Named route'lar wildcard'dan önce tanımlanmalı:
`/files/stats` → `/files/{id}`'den ÖNCE gelsin

## Yeni Tablo/Kolon Ekleme Kuralı
1. `schema_manager.py` → `TENANT_SCHEMA_SQL`'e ekle
2. `db.py:init_db()` → migration loop'a ALTER TABLE ekle
3. ARCHITECTURE.md ve proje_plan.md güncelle

## proje_plan.md Kuralı
**Her görev tamamlandığında proje_plan.md güncellenmeli.** ⬜ → ✅

## Test
Şu an sıfır test.
