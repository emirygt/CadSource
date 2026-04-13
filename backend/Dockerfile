FROM python:3.11-slim AS libredwg-builder

ARG LIBREDWG_VERSION=0.13.3

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    autoconf \
    automake \
    libtool \
    texinfo \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp

RUN wget -q https://ftp.gnu.org/gnu/libredwg/libredwg-${LIBREDWG_VERSION}.tar.xz \
    && tar -xf libredwg-${LIBREDWG_VERSION}.tar.xz \
    && cd libredwg-${LIBREDWG_VERSION} \
    && ./configure --disable-shared --disable-python --disable-bindings \
    # GCC 13+ ile gelen alloc-size warning'ini libredwg 0.13.3 build'inde fatal olmaktan cikar.
    && CFLAGS="-Wno-error=alloc-size" make -j"$(nproc)" \
    && cp programs/dwg2dxf /tmp/dwg2dxf

FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=libredwg-builder /tmp/dwg2dxf /usr/local/bin/dwg2dxf

# Torch CPU-only (GPU yoksa ~1.5GB tasarruf)
RUN pip install --no-cache-dir \
    torch==2.3.0+cpu \
    torchvision==0.18.0+cpu \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
# torch/torchvision zaten yuklu, requirements'tan atla
RUN grep -v -E '^(torch|torchvision)' requirements.txt > requirements_filtered.txt \
    && pip install --no-cache-dir -r requirements_filtered.txt \
    && rm requirements_filtered.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
