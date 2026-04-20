#!/usr/bin/env bash
set -euo pipefail

# Docker'sız DWG desteği: dwg2dxf kurar.

LIBREDWG_VERSION="${LIBREDWG_VERSION:-0.13.3}"

default_install_path() {
  if command -v brew >/dev/null 2>&1; then
    local brew_bin
    brew_bin="$(brew --prefix)/bin"
    if [ -d "$brew_bin" ] && [ -w "$brew_bin" ]; then
      echo "$brew_bin/dwg2dxf"
      return
    fi
  fi
  echo "/usr/local/bin/dwg2dxf"
}

INSTALL_PATH="${INSTALL_PATH:-$(default_install_path)}"

echo "[DWG] dwg2dxf kontrol ediliyor..."
if command -v dwg2dxf >/dev/null 2>&1; then
  echo "[DWG] Hazır: $(command -v dwg2dxf)"
  dwg2dxf --version || true
  exit 0
fi

install_build_tools_linux() {
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -y
    sudo apt-get install -y --no-install-recommends \
      build-essential autoconf automake libtool texinfo xz-utils wget curl tar
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y \
      gcc gcc-c++ make autoconf automake libtool texinfo xz wget curl tar
    return
  fi
  if command -v yum >/dev/null 2>&1; then
    sudo yum install -y \
      gcc gcc-c++ make autoconf automake libtool texinfo xz wget curl tar
    return
  fi
  echo "[DWG] Desteklenmeyen Linux paket yöneticisi. Elle kurulum gerekli."
  exit 1
}

download_archive() {
  local url="$1"
  local out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$out" "$url"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$out"
    return
  fi
  echo "[DWG] curl/wget bulunamadı."
  exit 1
}

if command -v brew >/dev/null 2>&1; then
  echo "[DWG] macOS/Homebrew tespit edildi. libredwg kuruluyor..."
  # Derleme bağımlılıkları
  brew install autoconf automake libtool texinfo xz wget >/dev/null 2>&1 || true

  if ! brew list libredwg >/dev/null 2>&1; then
    if ! brew install libredwg; then
      echo "[DWG] Homebrew'da libredwg formülü bulunamadı. Source derleme fallback kullanılacak."
    fi
  fi

  if brew --prefix libredwg >/dev/null 2>&1; then
    BREW_DWG2DXF="$(brew --prefix libredwg)/bin/dwg2dxf"
    if [ -x "$BREW_DWG2DXF" ]; then
      echo "[DWG] Bulundu: $BREW_DWG2DXF"
      if [ "$BREW_DWG2DXF" != "$INSTALL_PATH" ]; then
        if [ -w "$(dirname "$INSTALL_PATH")" ]; then
          ln -sf "$BREW_DWG2DXF" "$INSTALL_PATH" || true
        else
          sudo ln -sf "$BREW_DWG2DXF" "$INSTALL_PATH" || true
        fi
      fi
    fi
  fi
fi

if command -v dwg2dxf >/dev/null 2>&1; then
  echo "[DWG] Hazır: $(command -v dwg2dxf)"
  dwg2dxf --version || true
  exit 0
fi

echo "[DWG] dwg2dxf bulunamadı, LibreDWG source derlemesi başlatılıyor..."
if ! command -v brew >/dev/null 2>&1; then
  install_build_tools_linux
fi

TMP_DIR="$(mktemp -d -t cad-libredwg-XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE="libredwg-${LIBREDWG_VERSION}.tar.xz"
URL="https://ftp.gnu.org/gnu/libredwg/${ARCHIVE}"

download_archive "$URL" "$TMP_DIR/$ARCHIVE"
tar -xf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR"
cd "$TMP_DIR/libredwg-${LIBREDWG_VERSION}"

./configure --disable-shared --disable-python --disable-bindings --disable-werror
make -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

if [ -x "programs/dwg2dxf" ]; then
  if [ -w "$(dirname "$INSTALL_PATH")" ]; then
    install -m 0755 "programs/dwg2dxf" "$INSTALL_PATH"
  else
    sudo install -m 0755 "programs/dwg2dxf" "$INSTALL_PATH"
  fi
else
  echo "[DWG] Derleme tamamlandı ama programs/dwg2dxf bulunamadı."
  exit 1
fi

if command -v dwg2dxf >/dev/null 2>&1; then
  echo "[DWG] Kurulum başarılı: $(command -v dwg2dxf)"
  dwg2dxf --version || true
  echo "[DWG] Backend'i yeniden başlatın ve DWG yüklemeyi tekrar deneyin."
else
  echo "[DWG] Kurulumdan sonra komut PATH'te görünmüyor: $INSTALL_PATH"
  exit 1
fi
