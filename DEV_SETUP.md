## Local Geliştirme Ortamını Çalıştırma

### Tek komutla başlat
```bash
./start-dev.sh    # Docker daemon'ı da otomatik açar
./stop-dev.sh     # Durdurur (PostgreSQL isteğe bağlı)
```

### Adresler
| Servis | URL |
|--------|-----|
| Frontend (login) | http://localhost:8080/login.html |
| Frontend (ana) | http://localhost:8080/index.html |
| Backend API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 (sadece container içi) |

### Manuel başlatma
```bash
# 1. PostgreSQL
docker start cad_postgres          # ilk sefer: docker compose up -d

# 2. Backend
cd backend
venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 3. Frontend
python3 -m http.server 3000 --directory frontend
```

### .env (backend/.env) — mevcut değerler
```
DATABASE_URL=postgresql://postgres:password@127.0.0.1:5433/cad_search
JWT_SECRET=local-dev-secret-change-in-production
ENVIRONMENT=development
```
- Port **5433** — eski container 5432 yerine 5433'e map edilmiş
- Şifre **password** — eski container'ın şifresi (changeme değil)
- Şema ilk backend başlangıcında `init_db()` ile otomatik oluşur

### Test Kullanıcıları (local)
| Email | Şifre | Şirket |
|-------|-------|--------|
| admin@example.com | admin123 | Test Firma |

Yeni kullanıcı oluşturmak için:
```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"sen@firmam.com","password":"sifre123","company_name":"Firmam"}'
```
> Not: Pydantic EmailStr `.local` TLD'yi reddediyor, gerçek TLD kullan (`.com`, `.net` vb.)

### Loglar
```
/tmp/cad_backend.log
/tmp/cad_frontend.log
```
