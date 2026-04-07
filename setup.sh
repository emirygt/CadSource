#!/bin/bash
# CAD-Search VPS Kurulum Script
# Ubuntu 22.04 LTS için

set -e

echo "=== CAD-Search Kurulum Başlıyor ==="

# 1. Sistem güncelle
apt update && apt upgrade -y

# 2. Gerekli paketler
apt install -y python3.11 python3.11-venv python3-pip nginx docker.io docker-compose curl

# 3. Node.js + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2

# 4. Proje dizini
mkdir -p /home/cad-search
mkdir -p /var/log/cad-search

# 5. Python venv
cd /home/cad-search/backend
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt

# 6. PostgreSQL (Docker ile)
docker-compose up -d postgres
echo "PostgreSQL bekleniyor..."
sleep 5

# 7. PM2 ile backend başlat
pm2 start /home/cad-search/ecosystem.config.js
pm2 save
pm2 startup

# 8. Nginx config
cp /home/cad-search/nginx.conf /etc/nginx/sites-available/cad-search
ln -sf /etc/nginx/sites-available/cad-search /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 9. SSL (domain adını güncelle)
# certbot --nginx -d your-domain.com

echo ""
echo "=== Kurulum Tamamlandı ==="
echo "Backend: http://127.0.0.1:8000"
echo "Nginx: https://your-domain.com"
echo ""
echo "Sonraki adımlar:"
echo "  1. nginx.conf içindeki 'your-domain.com' alanını güncelle"
echo "  2. ecosystem.config.js içindeki JWT_SECRET ve DB_PASSWORD değerlerini değiştir"
echo "  3. certbot --nginx -d your-domain.com (SSL için)"
