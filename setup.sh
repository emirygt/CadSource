#!/bin/bash
# CAD-Search VPS kurulum scripti
# Ubuntu 22.04 LTS icin Docker'siz akis

set -e

echo "=== CAD-Search Kurulum Basliyor ==="

apt update && apt upgrade -y
apt install -y python3.11 python3.11-venv python3-pip nginx curl postgresql postgresql-contrib

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

mkdir -p /home/cad-search
mkdir -p /var/log/cad-search

cd /home/cad-search/backend
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt

systemctl enable --now postgresql
echo "PostgreSQL bekleniyor..."
sleep 5

pm2 start /home/cad-search/ecosystem.config.js
pm2 save
pm2 startup

cp /home/cad-search/nginx.conf /etc/nginx/sites-available/cad-search
ln -sf /etc/nginx/sites-available/cad-search /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo ""
echo "=== Kurulum Tamamlandi ==="
echo "Backend: http://127.0.0.1:8000"
echo "Nginx: https://your-domain.com"
echo ""
echo "Sonraki adimlar:"
echo "  1. nginx.conf icindeki 'your-domain.com' alanini guncelle"
echo "  2. backend/.env veya ecosystem.config.js icindeki JWT_SECRET ve DATABASE_URL degerlerini degistir"
echo "  3. certbot --nginx -d your-domain.com (SSL icin)"
