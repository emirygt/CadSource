## Local Gelistirme Ortamini Calistirma

### Tek komutla baslat
```bash
./start-dev.sh
./stop-dev.sh
```

`start-dev.sh` PostgreSQL servisi ayakta oldugunda backend ve frontend sureclerini baslatir.

### Adresler
| Servis | URL |
|--------|-----|
| Frontend (login) | http://localhost:8080/login.html |
| Frontend (ana) | http://localhost:8080/index.html |
| Backend API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |

### Manuel baslatma
```bash
# 1. PostgreSQL
sudo systemctl enable --now postgresql

# 2. Backend
cd backend
venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 3. Frontend
python3 -m http.server 8080 --directory frontend
```

### DWG destegi
DWG yukleme icin sistemde `dwg2dxf` komutu gerekir.

```bash
./scripts/setup-dwg2dxf.sh
```

### .env (backend/.env) ornek
```env
DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/cad_search
JWT_SECRET=local-dev-secret-change-in-production
ENVIRONMENT=development
```

- Port `5432` PostgreSQL servis portudur.
- Sema ilk backend baslangicinda `init_db()` ile otomatik olusur.

### Test kullanicisi
| Email | Sifre | Sirket |
|-------|-------|--------|
| admin@example.com | admin123 | Test Firma |

Yeni kullanici olusturmak icin:
```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"sen@firmam.com","password":"sifre123","company_name":"Firmam"}'
```

### Loglar
```text
/tmp/cad_backend.log
/tmp/cad_frontend.log
```
