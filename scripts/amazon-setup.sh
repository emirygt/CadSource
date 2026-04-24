#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
NGINX_TEMPLATE="$PROJECT_DIR/nginx.conf"

echo "=== CAD-Search AWS Amazon Linux 2023 Setup ==="
echo "Project dir: $PROJECT_DIR"

if ! command -v dnf >/dev/null 2>&1; then
  echo "Bu script Amazon Linux (dnf) icin yazildi. Uyumlu bir ortamda calistirin."
  exit 1
fi

echo "1. System updates and base tools..."
sudo dnf update -y
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y python3.11 python3.11-pip nginx nodejs wget tar gzip bc xz util-linux
sudo dnf install -y autoconf automake libtool texinfo postgresql15-server postgresql15-contrib

echo "2. PM2 installation..."
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

echo "3. PostgreSQL configuration..."
if [ ! -f /var/lib/pgsql/data/PG_VERSION ]; then
  sudo postgresql-setup --initdb
fi
sudo systemctl enable postgresql
sudo systemctl start postgresql

echo "4. LibreDWG installation..."
cd /tmp
if [ ! -f "/usr/local/bin/dwg2dxf" ]; then
  wget -q https://ftp.gnu.org/gnu/libredwg/libredwg-0.13.3.tar.gz
  tar -xzf libredwg-0.13.3.tar.gz
  cd libredwg-0.13.3
  ./configure --disable-shared --disable-python --disable-bindings
  make -j"$(nproc)"
  sudo make install
fi

echo "5. Backend environment..."
cd "$BACKEND_DIR"
if [ ! -d "venv" ]; then
  python3.11 -m venv venv
fi
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt
if [ ! -f ".env" ]; then
  cp .env.example .env
fi

echo "6. PM2 process start..."
cd "$PROJECT_DIR"
pm2 delete cad-search >/dev/null 2>&1 || true
pm2 delete cadsearch >/dev/null 2>&1 || true
pm2 start ecosystem.config.js --only cadsearch --update-env
pm2 save

APP_USER="${SUDO_USER:-$USER}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
PM2_BIN="$(command -v pm2)"
sudo env PATH="$PATH:/usr/bin" "$PM2_BIN" startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1 || true

echo "7. Nginx setup..."
TMP_NGINX_CONF="$(mktemp)"
ESCAPED_PROJECT_DIR="$(printf '%s\n' "$PROJECT_DIR" | sed 's/[\/&]/\\&/g')"
sed "s/__PROJECT_ROOT__/$ESCAPED_PROJECT_DIR/g" "$NGINX_TEMPLATE" > "$TMP_NGINX_CONF"

sudo rm -f /etc/nginx/conf.d/cad-search.conf
sudo cp "$TMP_NGINX_CONF" /etc/nginx/conf.d/cad-search.conf
rm -f "$TMP_NGINX_CONF"

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "8. Health checks..."
curl -fsS http://127.0.0.1:8000/health >/dev/null
curl -fsS http://127.0.0.1/health >/dev/null

echo "=== Kurulum basariyla tamamlandi ==="
echo "Frontend: http://$(curl -s ifconfig.me 2>/dev/null || echo 'SERVER_IP')/login.html"
echo "Backend health: http://127.0.0.1:8000/health"
