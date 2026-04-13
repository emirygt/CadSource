#!/bin/bash
set -e

if [ "${ALLOW_DOCKER:-0}" != "1" ]; then
    echo "Bu script legacy Docker deploy icindir ve varsayilan olarak kapali."
    echo "Proje politikasi: NO_DOCKER (Docker kurma/calistirma yok)."
    echo "Docker'siz deploy akislarini kullanin."
    exit 1
fi

echo "========================================"
echo "  CAD-Search VPS Deploy Script"
echo "========================================"

# ---- Ayarlar ----
APP_DIR="/home/cadsearch"
REPO_URL="https://github.com/emirygt/CadSource.git"

# ---- 1. Sistem Guncelleme + Docker Kurulumu ----
echo ""
echo "[1/6] Sistem guncelleniyor ve Docker kuruluyor..."

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
fi

if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    sudo apt-get update -y
    sudo apt-get install -y git curl
    # Docker
    if ! command -v docker &> /dev/null; then
        curl -fsSL https://get.docker.com | sudo sh
        sudo systemctl enable docker
        sudo systemctl start docker
    fi
    # Docker Compose plugin
    if ! docker compose version &> /dev/null; then
        sudo apt-get install -y docker-compose-plugin
    fi
elif [ "$OS" = "amzn" ]; then
    # git ve docker zaten yukluyse dokunma, curl-minimal conflict'i onlemek icin
    command -v git &> /dev/null || sudo dnf install -y git
    command -v docker &> /dev/null || sudo dnf install -y docker
    sudo systemctl enable docker
    sudo systemctl start docker
    if ! docker compose version &> /dev/null; then
        COMPOSE_VERSION="v2.24.5"
        sudo curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
        sudo ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose
    fi
else
    echo "Desteklenmeyen OS: $OS — manual Docker kurulumu yapiniz"
    exit 1
fi

# Mevcut kullaniciyi docker grubuna ekle
sudo usermod -aG docker $USER

echo "Docker $(docker --version) kurulu."

# ---- 2. Repo Clone ----
echo ""
echo "[2/6] Repo klonlaniyor..."

if [ -d "$APP_DIR" ]; then
    echo "  $APP_DIR zaten var, git pull yapiliyor..."
    cd "$APP_DIR"
    git pull origin main
else
    sudo mkdir -p "$APP_DIR"
    sudo chown $USER:$USER "$APP_DIR"
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# ---- 3. .env Dosyasi ----
echo ""
echo "[3/6] .env dosyasi hazirlaniyor..."

if [ ! -f "$APP_DIR/.env" ]; then
    # Rastgele sifre ve secret olustur
    DB_PASS=$(openssl rand -base64 24 | tr -d '=/+' | head -c 32)
    JWT_SEC=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)

    cat > "$APP_DIR/.env" <<EOF
DB_PASSWORD=$DB_PASS
JWT_SECRET=$JWT_SEC
PORT=80
EOF
    echo "  .env olusturuldu (sifreler rastgele)"
    echo "  DB_PASSWORD: $DB_PASS"
    echo "  JWT_SECRET:  $JWT_SEC"
    echo "  >>> Bu bilgileri kaydedin! <<<"
else
    echo "  .env zaten mevcut, atlanıyor."
fi

# ---- 4. Docker Build & Up ----
echo ""
echo "[4/6] Docker imajlari build ediliyor (ilk seferde ~10-15dk surer)..."

cd "$APP_DIR"
docker compose -f docker-compose.prod.yml build

echo ""
echo "[5/6] Konteynerler baslatiliyor..."

docker compose -f docker-compose.prod.yml up -d

# ---- 5. Saglık Kontrolu ----
echo ""
echo "[6/6] Saglik kontrolu yapiliyor..."

sleep 10

# Postgres check
if docker exec cad_postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo "  ✓ PostgreSQL calisiyor"
else
    echo "  ✗ PostgreSQL baslatılamadı!"
fi

# Backend check
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
    echo "  ✓ Backend API calisiyor"
else
    echo "  ✗ Backend henuz hazir degil (HTTP $HEALTH)"
    echo "    Log icin: docker logs cad_backend"
fi

# Nginx check
NGINX=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null || echo "000")
if [ "$NGINX" = "200" ]; then
    echo "  ✓ Nginx + Frontend calisiyor"
else
    echo "  ✗ Nginx henuz hazir degil (HTTP $NGINX)"
    echo "    Log icin: docker logs cad_nginx"
fi

echo ""
echo "========================================"
echo "  Deploy tamamlandi!"
echo "  Site: http://$(curl -s ifconfig.me 2>/dev/null || echo 'VPS_IP'):${PORT:-80}"
echo ""
echo "  Faydali komutlar:"
echo "    docker compose -f docker-compose.prod.yml logs -f     # Tum loglar"
echo "    docker compose -f docker-compose.prod.yml restart      # Yeniden baslat"
echo "    docker compose -f docker-compose.prod.yml down         # Durdur"
echo "    cd $APP_DIR && git pull && docker compose -f docker-compose.prod.yml up -d --build  # Guncelle"
echo "========================================"
