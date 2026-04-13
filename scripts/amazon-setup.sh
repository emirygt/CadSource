#!/bin/bash
set -e
echo "=== CAD-Search AWS Amazon Linux 2023 Setup ==="

echo "1. System Updates and Base Tools..."
sudo dnf update -y
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y python3.11 python3.11-pip nginx docker nodejs wget tar gzip bc xz util-linux
sudo dnf install -y autoconf automake libtool texinfo

echo "2. pm2 installation..."
sudo npm install -g pm2

echo "3. Docker configuration..."
sudo systemctl enable docker
sudo systemctl start docker

if [ ! -f "/usr/local/bin/docker-compose" ]; then
    echo "Installing docker-compose..."
    sudo curl -SL "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    sudo ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose
fi

echo "4. LibreDWG installation..."
cd /tmp
if [ ! -f "/usr/local/bin/dwg2dxf" ]; then
    wget -q https://ftp.gnu.org/gnu/libredwg/libredwg-0.13.3.tar.gz
    tar -xzf libredwg-0.13.3.tar.gz
    cd libredwg-0.13.3
    ./configure --disable-shared --disable-python --disable-bindings
    make -j$(nproc)
    sudo make install
fi

echo "5. Application Environment..."
cd /home/cad-search/backend
if [ ! -d "venv" ]; then
    python3.11 -m venv venv
fi
venv/bin/pip install -r requirements.txt

echo "6. Database Setup..."
cd /home/cad-search
docker-compose down || true
docker-compose up -d postgres
echo "Waiting 5 seconds for Postgres..."
sleep 5

echo "7. PM2 start..."
pm2 delete cad-search || true
pm2 start ecosystem.config.js
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user || true

echo "8. Nginx Setup..."
sudo rm -f /etc/nginx/conf.d/cad-search.conf
sudo cp /home/cad-search/nginx.conf /etc/nginx/conf.d/cad-search.conf
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "=== Kurulum Basariyla Tamamlandi ==="
