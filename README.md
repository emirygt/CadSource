# CAD Arama Motoru

6000+ DWG/DXF dosyası arasında yapay zeka destekli benzerlik araması.

Güncel sistem:
- 128-D geometric + 512-D CLIP hibrit arama
- DWG/DXF için gerçekçi JPEG preview üretimi
- Arama sonucunda yüklenen sorgu dosyasının da görseli (`query_preview`)

## Mimari

```
┌─────────────┐    HTTP     ┌──────────────┐    SQL+pgvector   ┌─────────────┐
│  Frontend   │ ──────────► │  FastAPI     │ ────────────────► │  PostgreSQL │
│  (HTML/JS)  │             │  Backend     │                   │  + pgvector │
└─────────────┘             └──────────────┘                   └─────────────┘
                                   │
                            features.py
                            (128 boyutlu vektör)
                            • Geometri özellikleri
                            • Katman yapısı
                            • Boyut/ölçek
                            • Görsel dağılım
```

## Kurulum

### 1. PostgreSQL + pgvector

```bash
# Docker ile (en kolay):
docker-compose up -d postgres

# Veya elle:
# PostgreSQL 15+ kurun
# pgvector uzantısını ekleyin: https://github.com/pgvector/pgvector
```

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

# .env dosyasını düzenleyin:
DATABASE_URL=postgresql://postgres:password@localhost:5432/cad_search

# Veritabanını başlat ve servisi çalıştır:
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Dosyaları İndeksle (6000 dosya)

```bash
cd scripts

# Tüm DXF dosyalarını indeksle (4 paralel işçi):
python bulk_index.py --dir /path/to/dwg/files --workers 4

# DWG dahil:
python bulk_index.py --dir /path/to/files --ext dxf,dwg --workers 8

# Yarım kalan indekslemeye devam et:
python bulk_index.py --dir /path/to/files --resume

# Tahmini süre: 6000 dosya ≈ 10-30 dakika (dosya boyutuna göre)
```

### 4. Frontend

```bash
# Herhangi bir HTTP sunucu ile:
cd frontend
python -m http.server 3000
# veya
npx serve .

# Tarayıcıda açın: http://localhost:3000
```

## Docker ile Tam Kurulum

```bash
# .env ayarlarını yapın
docker-compose up -d

# Servisler:
# PostgreSQL: localhost:5432
# Backend API: localhost:8000
# API Docs: http://localhost:8000/docs
```

## API Endpointleri

| Endpoint | Yöntem | Açıklama |
|---|---|---|
| `/search` | POST | Benzer çizim ara |
| `/index` | POST | Tek dosya indeksle |
| `/index/bulk` | POST | Çoklu dosya indeksle |
| `/index/bulk-zip` | POST | ZIP/RAR içeriğini toplu indeksle |
| `/files` | GET | Dosya listesi |
| `/files/{id}` | GET | Dosya detayı |
| `/files/{id}/download` | GET | Orijinal dosyayı indir |
| `/stats` | GET | Sistem istatistikleri |
| `/health` | GET | Sağlık kontrolü |

## Benzerlik Nasıl Hesaplanır?

Toplam skor iki aşamalıdır:
- SQL taban skor:
  - CLIP varsa: `0.4 * geo_sim + 0.6 * clip_sim`
  - CLIP yoksa: `geo_sim`
- Uygulama tarafı yeniden sıralama:
  - `visual_similarity` (siluet karşılaştırması)
  - `geometry_guard` (en-boy oranı + entity oranı)

Geometric 128 boyutlu vektör:
- **[0:64]** Geometri: entity tip dağılımı, açı histogramı, uzunluk dağılımı, daire yarıçap dağılımı
- **[64:96]** Katman yapısı: yaygın katman adları, katman sayısı
- **[96:112]** Boyut/ölçek: en-boy oranı, kağıt formatı benzerliği, alan
- **[112:128]** Görsel dağılım: 4×4 hücre yoğunluk haritası

CLIP 512 boyutlu vektör, `openai/clip-vit-base-patch32` ile üretilir.
PostgreSQL'de `pgvector` ile **cosine benzerliği** (HNSW indeksi) kullanılır.

## DWG Dosyaları

DWG, Autodesk'in kapalı formatıdır. Açmak için:

```bash
# ODA File Converter (ücretsiz):
# https://www.opendesign.com/guestfiles/oda_file_converter

# LibreCAD ile DXF'e dönüştür, sonra indeksle
# veya ezdxf kütüphanesi bazı DWG sürümlerini okuyabilir
```

## Performans

| Metrik | Değer |
|---|---|
| 6000 dosya indeksleme | ~15 dakika (4 işçi) |
| Arama süresi | < 100ms |
| Vektör boyutu | 128 float32 = 512 byte/dosya |
| Toplam vektör deposu | ~3 MB (6000 dosya) |
