#!/bin/bash
# CAD-Search yerel ortamini durdurur.

TMP_BASE="${TMPDIR:-/tmp}"
BACKEND_PID="$TMP_BASE/cad_backend.pid"
FRONTEND_PID="$TMP_BASE/cad_frontend.pid"

echo "CAD-Search durduruluyor..."

if [ -f "$BACKEND_PID" ]; then
  kill "$(cat "$BACKEND_PID")" 2>/dev/null && echo "Backend durduruldu"
  rm -f "$BACKEND_PID"
else
  lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "Backend durduruldu (PID dosyasi yoktu)"
fi

if [ -f "$FRONTEND_PID" ]; then
  kill "$(cat "$FRONTEND_PID")" 2>/dev/null && echo "Frontend durduruldu"
  rm -f "$FRONTEND_PID"
else
  lsof -ti:8080 | xargs kill -9 2>/dev/null && echo "Frontend durduruldu (PID dosyasi yoktu)"
fi

echo "PostgreSQL servisi otomatik durdurulmaz; gerekirse servis yoneticisinden kapatin."
echo "Bitti."
