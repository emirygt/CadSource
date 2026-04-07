#!/bin/bash
# CAD-Search local geliştirme ortamını başlatır.
# Kullanım: ./start-dev.sh
# Durdurmak için: ./stop-dev.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# ── 1. Docker daemon kontrolü ─────────────────────────────────────────────────
echo "🔍 Docker daemon kontrol ediliyor..."
if ! docker info >/dev/null 2>&1; then
  echo "Docker çalışmıyor, başlatılıyor..."
  open -a Docker
  for i in {1..20}; do
    docker info >/dev/null 2>&1 && break
    sleep 2
    echo "  Bekleniyor... ($i/20)"
  done
  docker info >/dev/null 2>&1 || { echo "❌ Docker başlatılamadı"; exit 1; }
fi
echo "✅ Docker hazır"

# ── 2. PostgreSQL container ───────────────────────────────────────────────────
echo "🐘 PostgreSQL başlatılıyor..."
if docker ps --format '{{.Names}}' | grep -q "^cad_postgres$"; then
  echo "✅ cad_postgres zaten çalışıyor"
else
  # Container daha önce oluşturulmuş ama durdurulmuş mu?
  if docker ps -a --format '{{.Names}}' | grep -q "^cad_postgres$"; then
    docker start cad_postgres
  else
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d
  fi
  # Hazır olana kadar bekle
  for i in {1..15}; do
    docker exec cad_postgres pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
fi
docker exec cad_postgres pg_isready -U postgres >/dev/null 2>&1 || { echo "❌ PostgreSQL hazır değil"; exit 1; }
echo "✅ PostgreSQL hazır (localhost:5432)"

# ── 3. Backend .env kontrolü ──────────────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "⚠️  .env bulunamadı, .env.example'dan kopyalanıyor..."
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo "   JWT_SECRET=local-dev-secret-change-in-production" >> "$BACKEND_DIR/.env"
fi

# ── 4. Backend (FastAPI) ──────────────────────────────────────────────────────
# Port 8000 kullanımda mı?
if lsof -ti:8000 >/dev/null 2>&1; then
  echo "✅ Backend zaten çalışıyor (port 8000)"
else
  echo "🚀 Backend başlatılıyor (port 8000)..."
  cd "$BACKEND_DIR"
  PYTHON="$BACKEND_DIR/venv/bin/python3"
  [ -f "$PYTHON" ] || PYTHON="$(which python3)"
  $PYTHON -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload \
    > /tmp/cad_backend.log 2>&1 &
  echo $! > /tmp/cad_backend.pid
  cd "$SCRIPT_DIR"
  # Hazır olana kadar bekle
  for i in {1..15}; do
    curl -s http://localhost:8000/health >/dev/null 2>&1 && break
    sleep 1
  done
  curl -s http://localhost:8000/health >/dev/null 2>&1 || { echo "❌ Backend başlatılamadı — log: /tmp/cad_backend.log"; exit 1; }
fi
echo "✅ Backend hazır → http://localhost:8000"
echo "   API docs   → http://localhost:8000/docs"

# ── 5. Frontend (static HTTP server) ─────────────────────────────────────────
if lsof -ti:8080 >/dev/null 2>&1; then
  echo "✅ Frontend zaten çalışıyor (port 8080)"
else
  echo "🌐 Frontend başlatılıyor (port 8080)..."
  python3 -m http.server 8080 --directory "$FRONTEND_DIR" \
    > /tmp/cad_frontend.log 2>&1 &
  echo $! > /tmp/cad_frontend.pid
  sleep 1
fi
echo "✅ Frontend hazır → http://localhost:8080/login.html"

echo ""
echo "────────────────────────────────────────────"
echo "  CAD-Search yerel ortamı çalışıyor:"
echo "  Frontend  → http://localhost:8080/login.html"
echo "  Backend   → http://localhost:8000"
echo "  API Docs  → http://localhost:8000/docs"
echo "  Loglar    → /tmp/cad_backend.log"
echo "             /tmp/cad_frontend.log"
echo "  Durdurmak → ./stop-dev.sh"
echo "────────────────────────────────────────────"
