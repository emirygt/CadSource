# CAD-Search: Agent Tanımları

> Son güncelleme: 2026-04-07

Her agent belirli bir sorumluluk alanına sahiptir. Bir agent başka bir agent'ın dosyalarına girmez.

---

## Agent 1: `schema-agent`
**Sorumluluk:** Multi-tenant PostgreSQL schema yönetimi

**Çalıştığı dosyalar:**
- `backend/db.py` — `init_db()`, migration loop
- `backend/services/schema_manager.py` — `create_tenant_schema()`, `TENANT_SCHEMA_SQL`

**Kurallar:**
- Yeni tablo/kolon eklenince hem `TENANT_SCHEMA_SQL` hem `init_db()` migration loop güncellenir
- Schema adı regex: `^[a-z][a-z0-9_]{0,62}$` — SQL injection koruması
- `init_db()` mevcut tenant schema'larını iterate ederek migration uygular

---

## Agent 2: `auth-agent`
**Sorumluluk:** Kimlik doğrulama ve JWT yönetimi

**Çalıştığı dosyalar:**
- `backend/routes/auth.py`
- `backend/middleware/tenant.py`

**JWT Payload:** `{ user_id, schema_name, email, exp }`

**Schema türetme:** `ali@acmemuh.com` → `"acmemuh"` (çakışırsa `acmemuh_2`)

---

## Agent 3: `index-agent`
**Sorumluluk:** CAD dosyası indexleme, vektör üretimi

**Çalıştığı dosyalar:**
- `backend/routes/index.py` — `/index`, `/index/bulk`
- `backend/clip_encoder.py` — CLIP vektörü (import et, değiştirme)

**Kurallar:**
- `features.py`'e **dokunma** — sadece import et
- Her upload'da hem `feature_vector` (128-D) hem `clip_vector` (512-D) hesaplanır
- CLIP başarısız olursa `None` kaydedilir, indexleme devam eder
- Bulk upload: her dosya ayrı `try/except`, hata diğerini engellemez

---

## Agent 4: `search-agent`
**Sorumluluk:** Hibrit vektör benzerlik araması

**Çalıştığı dosyalar:**
- `backend/routes/search.py` — `/search`, `/files`, `/stats`
- `backend/routes/history.py` — `/history`

**Hibrit skor:**
```
clip_vector varsa:  0.4 × geo_sim + 0.6 × clip_sim
clip_vector yoksa:  geo_sim
```

**Kurallar:**
- `/search` sonrası `search_history`'e kayıt at (hata olursa rollback, sessiz geç)
- `feature_vector IS NOT NULL` her zaman WHERE'de bulunur

---

## Agent 5: `clip-agent`
**Sorumluluk:** CLIP görsel embedding üretimi

**Çalıştığı dosyalar:**
- `backend/clip_encoder.py`

**Kurallar:**
- Model lazy singleton — ilk çağrıda yüklenir, bellekte kalır
- `render_dxf_to_png(data)` → features.py'den gelen dict alır (`entities`, `bbox`)
- `extract_clip_vector(data)` → ana entry point, None dönebilir
- CPU üzerinde çalışır, GPU gerekmez
- Model: `openai/clip-vit-base-patch32` (local, Hugging Face, ~600MB)

---

## Agent 6: `frontend-agent`
**Sorumluluk:** Web arayüzü

**Çalıştığı dosyalar:**
- `frontend/index.html` — tüm SPA (Ara, DB, Kategoriler sekmeleri)
- `frontend/login.html`

**Sekme yapısı:**
- **Ara** — sidebar (upload + filtreler + geçmiş) + sonuç grid/liste + karşılaştırma
- **DB** — bulk upload + dosya tablosu (satıra tıkla → detay modal)
- **Kategoriler** — CRUD

**State objeler:** `searchState`, `dbState`, `compareState`, `catState`

**Kurallar:**
- API URL: `const API = 'http://localhost:8000'` (üstte sabit)
- Auth: `localStorage.getItem('token')` → `Authorization: Bearer`
- Her oturum açılışında: `loadStats()`, `loadCategoriesIntoSelect()`, `loadHistory()`
- `loadCategoriesIntoSelect()` hem `dbCategorySelect` hem `searchCategorySelect` doldurur

---

## Agent 7: `infra-agent`
**Sorumluluk:** Deploy ve altyapı

**Çalıştığı dosyalar:**
- `docker-compose.yml` — sadece PostgreSQL
- `start-dev.sh`, `stop-dev.sh`
- `backend/.env`, `backend/.env.example`

**Local ortam:**
- PostgreSQL: port 5433, şifre `password` (eski container)
- Backend: port 8000
- Frontend: port 8080

---

## Agent İletişim Akışı

```
frontend-agent
    ↓ HTTP + JWT
auth-agent → schema-agent (register sırasında)
    ↓ JWT middleware (her request: SET search_path)
index-agent → clip-agent (upload sırasında)
search-agent → history kayıt
    ↓
PostgreSQL (tenant schema)
```

---

## Yeni Tablo/Kolon Ekleme Protokolü

1. `schema_manager.py` → `TENANT_SCHEMA_SQL`'e ekle (yeni tenantlar için)
2. `db.py:init_db()` → migration loop'a `ALTER TABLE IF NOT EXISTS` ekle (mevcut tenantlar için)
3. İlgili route'a READ/WRITE ekle
4. `ARCHITECTURE.md` → şema tablosunu güncelle
5. `proje_plan.md` → ilgili görevi ✅ yap
