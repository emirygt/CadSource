# CORE — Proje Özeti

## Proje
AI destekli CAD dosyası benzerlik arama motoru. DWG/DXF → 128-D geometric + 512-D CLIP vektörü → pgvector HNSW ile < 100ms arama. SaaS, müşteri sıfır kurulum.

## Stack
- **Backend:** Python 3.9, FastAPI + Uvicorn, PM2 (process manager)
- **DB:** PostgreSQL 16 + pgvector (HNSW m=16 ef=64), multi-tenant schema izolasyonu
- **Auth:** JWT (payload: user_id, email, schema_name)
- **Frontend:** Vanilla JS SPA (index.html), login.html, i18n.js (TR/EN)
- **Infra:** Nginx reverse proxy, PM2, EC2 Amazon Linux 2023
- **AI:** CLIP (openai/clip-vit-base-patch32) lazy singleton, CPU

## Dizin Yapısı
```
cadsource/
├── backend/
│   ├── main.py              # FastAPI app, router kayıtları
│   ├── db.py                # Engine, SessionLocal, CadFile model, init_db()
│   ├── features.py          # 128-D geometric vektör (DOKUNMA)
│   ├── clip_encoder.py      # CLIP PNG render + 512-D encode
│   ├── middleware/
│   │   └── tenant.py        # JWT auth + search_path set
│   ├── routes/
│   │   ├── auth.py          # /auth/register, /auth/login
│   │   ├── index.py         # /index, /index/bulk, /index/bulk-zip, /index/archive/preview
│   │   ├── search.py        # /search, /files, /stats, /files/{id}, /files/{id}/download
│   │   ├── categories.py    # /categories CRUD
│   │   ├── history.py       # /history
│   │   ├── analytics.py     # /analytics
│   │   ├── contour.py       # /contour/vectorize
│   │   ├── activity.py      # /activity, log_activity()
│   │   └── scan.py          # /scan/convert, /scan/export-dxf
│   └── services/
│       ├── auth_service.py  # hash_password, verify_password, create_token, decode_token
│       └── schema_manager.py # TENANT_SCHEMA_SQL, create_tenant_schema, set_search_path
├── frontend/
│   ├── index.html           # Ana SPA (tüm paneller, tab navigasyon)
│   ├── login.html           # Giriş/kayıt formu
│   ├── i18n.js              # TR/EN çeviri tablosu, t(), applyI18n(), toggleLang()
│   └── theme.css            # CSS değişkenleri ve global stiller
├── nginx/default.conf       # /api → http://localhost:8000 proxy
├── start-dev.sh             # Yerel dev ortamı başlatıcı (port 8000 + 8080)
├── stop-dev.sh
├── ecosystem.config.js      # PM2 config
├── proje_plan.md            # Görev takibi (⬜/✅)
├── ARCHITECTURE.md          # Tam endpoint listesi ve şema
└── CLAUDE.md                # Bu proje AI kuralları
```

## Kritik Dosyalar
| Dosya | Amaç |
|-------|------|
| `backend/features.py` | 128-D geometric vektör — **asla değiştirme** |
| `backend/services/schema_manager.py` | TENANT_SCHEMA_SQL + migration helper'lar |
| `backend/db.py` | `init_db()` — startup migration loop, mevcut tenant'lara ALTER TABLE |
| `frontend/index.html` | Tüm frontend SPA (~3000 satır) |
| `frontend/i18n.js` | TR/EN çeviri + applyI18n() + toggleLang() |

---
*Son güncelleme: 2026-04-24*
