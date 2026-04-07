#!/bin/bash
# CAD-Search yerel ortamı durdurur.

echo "🛑 CAD-Search durduruluyor..."

# Backend
if [ -f /tmp/cad_backend.pid ]; then
  kill $(cat /tmp/cad_backend.pid) 2>/dev/null && echo "✅ Backend durduruldu"
  rm /tmp/cad_backend.pid
else
  lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "✅ Backend durduruldu (PID dosyası yoktu)"
fi

# Frontend
if [ -f /tmp/cad_frontend.pid ]; then
  kill $(cat /tmp/cad_frontend.pid) 2>/dev/null && echo "✅ Frontend durduruldu"
  rm /tmp/cad_frontend.pid
else
  lsof -ti:8080 | xargs kill -9 2>/dev/null && echo "✅ Frontend durduruldu (PID dosyası yoktu)"
fi

# PostgreSQL (isteğe bağlı)
read -p "PostgreSQL container'ı da durdurulsun mu? [y/N] " yn
if [[ "$yn" =~ ^[Yy]$ ]]; then
  docker stop cad_postgres && echo "✅ PostgreSQL durduruldu"
fi

echo "Bitti."
