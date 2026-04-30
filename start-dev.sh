#!/bin/bash
# CAD-Search local development ortamini PostgreSQL servis ile baslatir.
# Kullanim: ./start-dev.sh
# Durdurmak icin: ./stop-dev.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
TMP_BASE="${TMPDIR:-/tmp}"
BACKEND_LOG="$TMP_BASE/cad_backend.log"
BACKEND_PID="$TMP_BASE/cad_backend.pid"
FRONTEND_LOG="$TMP_BASE/cad_frontend.log"
FRONTEND_PID="$TMP_BASE/cad_frontend.pid"

if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo ".env bulunamadi, .env.example'dan kopyalaniyor..."
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi

echo "PostgreSQL erisimi kontrol ediliyor..."
if command -v pg_isready >/dev/null 2>&1; then
  DATABASE_URL="$(grep '^DATABASE_URL=' "$BACKEND_DIR/.env" | cut -d= -f2-)"
  if [ -z "$DATABASE_URL" ]; then
    echo "DATABASE_URL bulunamadi. backend/.env dosyasini kontrol edin."
    exit 1
  fi

  if ! pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
    echo "PostgreSQL erisilemiyor. Once veritabani servisini baslatin."
    exit 1
  fi
else
  echo "pg_isready bulunamadi; veritabani kontrolu atlandi."
fi
echo "PostgreSQL hazir"

if lsof -ti:8000 >/dev/null 2>&1; then
  echo "Backend zaten calisiyor (port 8000)"
else
  echo "Backend baslatiliyor (port 8000)..."
  cd "$BACKEND_DIR"
  PYTHON="$BACKEND_DIR/venv/bin/python3"
  [ -f "$PYTHON" ] || PYTHON="$(command -v python3)"
  "$PYTHON" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload \
    > "$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID"
  cd "$SCRIPT_DIR"

  for i in {1..15}; do
    curl -s http://localhost:8000/health >/dev/null 2>&1 && break
    sleep 1
  done

  curl -s http://localhost:8000/health >/dev/null 2>&1 || {
    echo "Backend baslatilamadi. Log: $BACKEND_LOG"
    exit 1
  }
fi
echo "Backend hazir -> http://localhost:8000"
echo "API docs -> http://localhost:8000/docs"

if lsof -ti:8080 >/dev/null 2>&1; then
  echo "Frontend zaten calisiyor (port 8080)"
else
  echo "Frontend baslatiliyor (port 8080)..."
  python3 "$FRONTEND_DIR/spa_server.py" 8080 "$FRONTEND_DIR" \
    > "$FRONTEND_LOG" 2>&1 &
  echo $! > "$FRONTEND_PID"
  sleep 1
fi
echo "Frontend hazir -> http://localhost:8080/login.html"

echo ""
echo "--------------------------------------------"
echo " CAD-Search yerel ortami calisiyor:"
echo " Frontend  -> http://localhost:8080/login.html"
echo " Backend   -> http://localhost:8000"
echo " API Docs  -> http://localhost:8000/docs"
echo " Loglar    -> $BACKEND_LOG"
echo "              $FRONTEND_LOG"
echo " Durdurmak -> ./stop-dev.sh"
echo "--------------------------------------------"
