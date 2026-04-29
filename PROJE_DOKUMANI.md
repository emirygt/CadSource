# Profile Axis / CAD-Search Proje Dokumani

> Son guncelleme: 2026-04-28  
> Amac: "Bu proje ne yapıyor?" sorusuna teknik ve urun seviyesinde eksiksiz cevap vermek.

---

## 1. Kisa Cevap

Profile Axis / CAD-Search, CAD dosyalarini ve teknik cizimleri tarayicidan yukleyip analiz eden, benzer cizimleri bulan, dosyalari kategori/onay akislariyla yoneten ve taranmis teknik gorselleri CAD vektorlerine donusturmeye calisan SaaS tabanli bir CAD analiz platformudur.

Sistem temel olarak su ihtiyaci cozer:

- Binlerce DWG, DXF, PDF veya teknik cizim dosyasi arasindan benzer olanlari hizli bulmak.
- Dosyalari sadece isimle degil geometri, katman, entity dagilimi, gorsel siluet ve CLIP tabanli gorsel benzerlikle karsilastirmak.
- Yuklenen CAD arsivini browser uzerinden onizlemek, filtrelemek, kategorize etmek, onay surecine almak ve raporlamak.
- Taranmis veya fotografi cekilmis teknik profil resimlerinden kontur/SVG/DXF uretmek.
- Scan -> CAD editoru ile vektorleri duzenleyip DXF/SVG olarak disa aktarmak.
- Duplicate ve revizyon adaylarini tespit edip kutuphane temizligini kolaylastirmak.

Proje musteri tarafinda kurulum istemeyen bir SaaS yaklasimiyla tasarlanmistir. Musteri sadece web tarayicisini kullanir; backend, veritabani, vektor indeksleri ve dosya isleme sunucu tarafinda calisir.

---

## 2. Projenin Ana Deger Onerisi

Klasik dosya arama sistemleri CAD dosyalarini genelde dosya adi, klasor yolu veya manuel etiketler uzerinden bulur. Bu proje ise dosyanin icindeki teknik geometriyi okuyup sayisal vektore donusturur.

Bu sayede kullanici:

- Elindeki bir cizimi yukleyip ona benzeyen arsiv dosyalarini bulabilir.
- Ayni parcaya ait farkli revizyonlari veya cok benzer profilleri yakalayabilir.
- Cizimlerin onizlemesini gorerek manuel kontrol suresini azaltabilir.
- CAD arsivindeki taslak, inceleme ve onayli dosyalari ayri is akislariyla yonetebilir.
- Taranmis teknik cizimleri yeniden vektor/CAD formatina cevirmek icin baslangic ciktilari alabilir.

Sistemin hedefi, CAD arsivlerinde "hangi dosya buna benziyor?", "bu parcanin revizyonu var mi?", "bu profil arsivde daha once yuklenmis mi?" ve "bu teknik gorseli CAD'e cevirebilir miyiz?" sorularina hizli cevap vermektir.

---

## 3. Hedef Kullanicilar

Bu proje ozellikle su ekipler icin anlamlidir:

- Aluminyum profil, sac, makine parcasi veya teknik profil arsivi olan ureticiler.
- CAD/DWG/DXF kutuphanesi buyuyen muhendislik ekipleri.
- Musteri cizimi alip arsivde benzer urun arayan satis/teknik destek ekipleri.
- Revizyon ve duplicate kontrolu yapmak isteyen operasyon ekipleri.
- Taranmis teknik cizimleri dijitallestirmek isteyen katalog/arsiv ekipleri.

---

## 4. Desteklenen Ana Is Akislari

### 4.1 Giris ve Tenant Olusturma

Kullanici email ve sifreyle kaydolur. Sistem email domain'inden otomatik bir tenant schema adi turetir.

Ornek:

```text
ali@acmemuh.com -> schema_name = acmemuh
```

Kayıt sirasinda:

1. Kullanici `public.users` tablosuna eklenir.
2. Kullaniciya ozel PostgreSQL schema'si olusturulur.
3. Bu schema icinde CAD dosyalari, kategoriler, arama gecmisi, aktivite loglari ve duplicate tablolari acilir.
4. JWT token uretilir.

Her korumali istekte JWT icindeki `schema_name` okunur ve `SET search_path TO {tenant}, public` uygulanir. Boylece her musteri sadece kendi verisini gorur.

### 4.2 Dosya Yukleme ve Indexleme

Kullanici tek dosya, coklu dosya veya ZIP/RAR arsivi yukleyebilir.

Sistem yukleme sirasinda:

- Dosya formatini belirler.
- DWG gerekiyorsa `dwg2dxf` uzerinden DXF'e cevirir.
- DXF/PDF/gorsel icin parse ve analiz akisini calistirir.
- Entity sayisi, layer sayisi, bbox boyutlari, entity tip dagilimi gibi istatistikleri cikarir.
- 128 boyutlu geometric vector uretir.
- Mumkunse 512 boyutlu CLIP vector uretir.
- SVG ve JPEG preview uretir.
- Orijinal dosya bytes'ini `file_data` alaninda saklar.
- Icerik hash'i ve geometri hash'i cikararak duplicate/revizyon kontrolu yapar.
- Dosyayi kategoriye ve varsayilan `uploaded` durumuna baglar.

Buyuk yuklemeler icin arka plan job sistemi vardir. Kullanici yuklemeyi baslatir, job kuyruga girer, worker dosyalari sirayla isler.

### 4.3 Benzerlik Arama

Kullanici bir sorgu dosyasi yukler. Sistem bu dosyayi parse eder, vektorlerini uretir ve veritabanindaki dosyalarla karsilastirir.

Arama sadece dosya adina bakmaz. Su sinyalleri kullanilir:

- Geometrik vektor benzerligi.
- CLIP gorsel embedding benzerligi.
- Siluet/gorsel maske benzerligi.
- En-boy orani ve entity sayisi gibi geometri koruma kontrolleri.
- Kategori filtresi.

Sonuc ekraninda:

- Aranan dosyanin preview'i gosterilir.
- En benzer dosyalar skorla listelenir.
- "Neden benzer?" rozetleri uretilir.
- Sonuclar grid veya liste halinde gorulebilir.
- Secilen dosyalar yan yana karsilastirilabilir.
- Gorsel fark overlay'i ile farklar incelenebilir.

### 4.4 Dosya Kutuphanesi

Kutuphane ekrani tum indexlenmis dosyalari yonetir.

Kullanici:

- Dosyalari listeleyebilir.
- Dosya adina gore arayabilir.
- Kategori, format, favori, preview var/yok, CLIP var/yok, file_data var/yok gibi filtreler uygulayabilir.
- Entity sayisi, layer sayisi, bbox genislik/yukseklik, aspect ratio ve tarih araliklariyla filtreleme yapabilir.
- Layer veya entity tipine gore filtreleyebilir.
- Dosya detay modalini acabilir.
- Preview, analiz, duplicate bilgisi, job gecmisi ve 3D gorunum sekmelerini inceleyebilir.
- Orijinal dosyayi indirebilir.
- Dosyayi silebilir.
- Favoriye alabilir.

### 4.5 Onay ve Durum Akisi

Dosyalarin is durumu `approval_status` ile tutulur.

Kullanilan durumlar:

- `uploaded`: Yuklendi.
- `draft`: Inceleme/taslak.
- `approved`: Onayli.
- `error`: Hata durumlari icin kullanilabilir.

Frontend tarafinda Dosya Kutuphanesi altinda:

- Tum Urunler
- Inceleme Kuyrugu
- Onayli Katalog

seklinde is akisi vardir. Kullanici secili dosyalara toplu durum atayabilir.

### 4.6 Kategoriler

Kategori sistemi CAD dosyalarini urun ailesi, profil tipi veya musteri ic gruplarina gore ayirmak icin kullanilir.

Desteklenenler:

- Kategori CRUD.
- Renkli kategori etiketleri.
- Dosyaya kategori atama.
- 3 seviyeli kategori import akisi.
- Excel template indirme.
- Kategori secimlerinin upload ve arama filtrelerine yansimasi.

Kategori tablosunda `parent_id` bulunur; bu da hiyerarsik kategori yapisina izin verir.

### 4.7 Dashboard ve Analitik

Dashboard genel sistem durumunu ozetler.

Gosterilebilen metrikler:

- Toplam dosya sayisi.
- Indexlenmis dosya sayisi.
- Kategori sayisi.
- Onay/draft/uploaded dagilimlari.
- Son yuklenen dosyalar.
- Son aramalar.
- Upload trendleri.
- Arama istatistikleri.

Dashboard frontend tarafinda Chart.js ve tablolarla gorsellestirilir.

### 4.8 Is Gecmisi ve Aktivite Loglari

Sistem iki tip gecmis tutar:

- Arama gecmisi: Kullanici hangi dosyayla arama yapti, kac sonuc dondu, minimum benzerlik neydi.
- Aktivite loglari: Upload, onay, favori, silme gibi operasyonlar.

Bu sayede kullanici hem kendi arama gecmisini hem de dosya uzerindeki operasyon gecmisini takip edebilir.

### 4.9 Duplicate ve Revizyon Yonetimi

Yukleme sirasinda iki hash uretilir:

- `content_hash`: Orijinal bytes uzerinden SHA-256. Birebir ayni dosyayi yakalar.
- `geometry_hash`: Entity dagilimi, layer bilgisi, bbox ve sayisal ozetlerden uretilen geometri parmak izi.

Sistem:

- Ayni `content_hash` varsa `exact_duplicate` olarak isaretler.
- Geometri hash'i uyusuyor ve feature vector benzerligi cok yuksekse `revision_candidate` olarak isaretler.
- Adaylari `cad_file_groups` ve `cad_file_group_members` tablolariyla gruplar.

Duplicate Yonetimi ekraninda gruplar incelenebilir, birlestirilebilir, dosya gruptan cikarilabilir veya grup dagitilabilir.

### 4.10 Raporlama

Reports API dosya, duplicate ve job verilerini rapor olarak disa aktarir.

Desteklenen rapor alanlari:

- Dosya raporu.
- Duplicate/revizyon raporu.
- Job raporu.

Raporlar CSV veya Excel mantiginda uretilir. Backend `openpyxl` kullanir.

### 4.11 Gorsel -> Kontur

Gorsel -> Kontur ekrani teknik parcayi bir raster gorselden alarak CAD konturune cevirmeye calisir.

Desteklenen girdiler:

- JPG
- PNG
- BMP
- TIFF
- PDF kaynakli gorseller

Ozellikler:

- Foreground izolasyonu.
- Olcu/yazi/dis cizgi gibi teknik cizim kalabaligini azaltmaya yonelik secim modlari.
- Kontur cikarma.
- Kapali sekil ve delik hiyerarsisi.
- Circle/ellipse/arc algilama.
- Kalibrasyon: manuel faktor, iki nokta secimi veya scan sayfa/DPI tahmini.
- DXF ve SVG cikisi.
- Kalite raporu: acik kontur, self-intersection, nokta sayisi gibi kontroller.

Bu modulun amaci, ozellikle renkli veya konturu belirgin teknik profil gorsellerinden temiz CAD baslangic ciktisi almaktir.

### 4.12 Scan -> CAD

Scan -> CAD ekrani taranmis teknik cizimi vektor entity listesine cevirir ve editor icinde duzenlenebilir hale getirir.

Desteklenen girdiler:

- JPG, PNG, BMP, TIFF, PDF
- DXF, DWG

Ozellikler:

- OpenCV tabanli binarizasyon ve vektorization.
- Line, circle, arc, spline gibi entity listesi.
- Foreground mode ile teknik parcayi olcu/yazi kalabaligindan ayirma.
- SVG teknik cizim gorunumu.
- Vektor editor uzerinden tasima, cizme, yay olusturma ve export.
- DXF export.

Bu modul henuz "her taramayi kusursuz CAD'e cevirir" iddiasinda degildir; asil hedef, teknik taramalardan duzenlenebilir bir vektor baslangici uretmektir.

### 4.13 CAD Pro Editor

Frontend icinde daha genis kapsamli bir CAD editor katmani bulunur.

Desteklenen araclar:

- Line, Circle, Arc, Rect, Polyline, Polygon, Ellipse, Point, Text, XLine, Ray, Leader.
- Move, Copy, Rotate, Erase, Trim, Extend, Offset, Mirror, Scale, Fillet, Chamfer, Break, Join, Explode, Lengthen, Array, Divide, Measure, Smooth, Matchprop.
- Linear, Aligned, Radius, Diameter, Angular olculendirme.
- Dist, Id, Area, List, Properties inquiry araclari.
- Katmanlar.
- Komut satiri kisayollari.
- OSNAP, ORTHO, grid snap.
- Undo/redo.
- DXF ve SVG export.

Bu editor frontend agirliklidir ve mevcut vektorleri pratik sekilde duzenlemek icin tasarlanmistir.

### 4.14 3D Gorunum

Dosya detay modalinda 3D gorunum sekmesi bulunur. Backend `/files/{id}/model3d` endpoint'i dosyanin DXF verisinden uygun ring/contour bilgilerini cikarmaya ve GLB benzeri bir model olusturmaya calisir.

Bu ozellik ozellikle kapali profil kesitlerinden basit 3D extrude onizleme almak icindir.

---

## 5. Sistem Mimarisi

```text
Browser Frontend
  |
  | HTTP / JWT
  v
Nginx
  |
  | /api -> FastAPI
  v
FastAPI Backend
  |
  | SQLAlchemy + SQL + pgvector
  v
PostgreSQL 16 + pgvector
  |
  +-- public.users
  +-- public.jobs / job_items / job_payloads
  +-- tenant_schema.cad_files
  +-- tenant_schema.categories
  +-- tenant_schema.search_history
  +-- tenant_schema.activity_log
  +-- tenant_schema.cad_file_groups
  +-- tenant_schema.search_feedback

Arka plan:
  PM2 -> cadsearch
  PM2 -> cadsearch-worker
```

### 5.1 Frontend

Frontend vanilla HTML/CSS/JavaScript olarak ilerler.

Ana dosyalar:

- `frontend/index.html`: Ana SPA.
- `frontend/login.html`: Login/register.
- `frontend/i18n.js`: Turkce/English metinler.
- `frontend/assets/profile-axis-logo-neon.png`: Sidebar logo varligi.

Ana sayfalar:

- Dashboard
- Ara & Karsilastir
- Dosya Kutuphanesi
- Inceleme Kuyrugu
- Onayli Katalog
- Dijitallestirme / Gorsel -> Kontur
- Dijitallestirme / Tara -> CAD
- Kategoriler
- Is Gecmisi
- Duplicate Yonetimi

### 5.2 Backend

Backend FastAPI ile yazilmistir.

Ana dosyalar:

- `backend/main.py`: FastAPI app ve router kayitlari.
- `backend/db.py`: DB engine, public tablolar, tenant migration loop.
- `backend/features.py`: CAD/PDF parse ve 128-D geometric vector uretimi.
- `backend/clip_encoder.py`: CLIP preview render ve 512-D embedding.
- `backend/worker.py`: PostgreSQL job kuyrugunu isleyen worker.
- `backend/logger.py`: Merkezi logging.

### 5.3 Veritabani

Veritabani PostgreSQL 16 + pgvector uzerine kuruludur. Her musteri kendi schema'sinda izole edilir. `public` schema sadece ortak kullanici ve job tablolarini tutar.

### 5.4 Operasyon

Projede Docker kullanilmaz. Zorunlu operasyon politikasi:

```text
git pull + backend process restart + nginx reload
```

PM2 iki process yonetir:

- `cadsearch`: FastAPI/Uvicorn.
- `cadsearch-worker`: Arka plan job worker.

---

## 6. Vektor ve Benzerlik Mantigi

### 6.1 128-D Geometric Vector

`backend/features.py` tarafindan uretilir ve sabit kabul edilir.

```text
[0:20]     Entity type dagilimi
[20:36]    Cizgi aci histogrami
[36:52]    Cizgi uzunluk histogrami
[52:60]    Cember/yay yaricap histogrami
[60:64]    Entity yogunluk metrikleri
[64:96]    Katman kompozisyonu
[96:112]   Boyutsal ozellikler
[112:128]  4x4 spatial grid yogunlugu
```

Son adim L2 normalizasyondur. Arama cosine similarity ile yapilir.

### 6.2 512-D CLIP Vector

`backend/clip_encoder.py` tarafindan uretilir.

Akis:

```text
CAD/PDF/gorsel dosya
  -> preview render
  -> openai/clip-vit-base-patch32
  -> 512-D normalized vector
```

CLIP basarisiz olursa dosya tamamen reddedilmez; geometric arama calismaya devam eder.

### 6.3 Hibrit Skor

Aramada skor su sekilde hesaplanir:

```text
Eger sorgu ve adayda CLIP varsa:
  base = 0.4 * geo_sim + 0.6 * clip_sim

Eger CLIP yoksa:
  base = geo_sim
```

Ek kalite katmanlari:

- CLIP benzerligi cok dusukse skor cezalandirilir.
- Preview maskelerinden `visual_similarity` hesaplanir.
- Aspect ratio ve entity oranindan `geometry_guard` hesaplanir.

Nihai yaklasim:

```text
final = (0.65 * base + 0.35 * visual_similarity) * geometry_guard
```

Visual similarity uretilemezse:

```text
final = base * geometry_guard
```

---

## 7. Veri Modeli

### 7.1 Public Tablolar

#### `public.users`

Tum tenant kullanicilarini tutar.

Baslica kolonlar:

- `id`
- `email`
- `password_hash`
- `schema_name`
- `company_name`
- `created_at`

#### `public.jobs`

Arka plan islerini tutar.

Baslica kolonlar:

- `id`
- `schema_name`
- `user_email`
- `type`
- `status`
- `priority`
- `total_items`
- `processed_items`
- `succeeded_items`
- `failed_items`
- `payload`
- `result`
- `error`
- `created_at`
- `started_at`
- `finished_at`

#### `public.job_items`

Job icindeki tekil dosya veya aksiyon satirlarini tutar.

#### `public.job_payloads`

Upload job'larinda gecici dosya bytes verilerini tutar. Job bitince temizlenir.

### 7.2 Tenant Tablolari

#### `{tenant}.cad_files`

CAD kutuphanesinin ana tablosudur.

Baslica kolonlar:

- `id`
- `filename`
- `filepath`
- `file_format`
- `indexed_at`
- `entity_count`
- `layer_count`
- `layers`
- `entity_types`
- `bbox_width`
- `bbox_height`
- `bbox_area`
- `feature_vector`
- `clip_vector`
- `svg_preview`
- `jpg_preview`
- `file_data`
- `content_hash`
- `geometry_hash`
- `duplicate_status`
- `duplicate_group_id`
- `is_favorite`
- `category_id`
- `approved`
- `approved_at`
- `approval_status`

#### `{tenant}.categories`

Kategori ve hiyerarsik kategori yapisini tutar.

Baslica kolonlar:

- `id`
- `name`
- `parent_id`
- `color`
- `created_at`

#### `{tenant}.search_history`

Kullanici arama gecmisini tutar.

#### `{tenant}.activity_log`

Dosya ve is akisi aktivitelerini tutar.

#### `{tenant}.cad_file_groups`

Duplicate veya revizyon gruplarini tutar.

#### `{tenant}.cad_file_group_members`

Bir duplicate/revizyon grubuna bagli dosyalari tutar.

#### `{tenant}.search_feedback`

Arama sonucunun ilgili/ilgisiz olduguna dair kullanici geri bildirimini tutar.

---

## 8. API Haritasi

### Auth

| Method | Endpoint | Amac |
|---|---|---|
| POST | `/auth/register` | Yeni kullanici ve tenant olusturur |
| POST | `/auth/login` | JWT token verir |

### Indexleme

| Method | Endpoint | Amac |
|---|---|---|
| POST | `/index` | Tek dosya indexler |
| POST | `/index/bulk` | Coklu dosya indexler |
| POST | `/index/archive/preview` | Arsiv icerigini indexlemeden onizler |
| POST | `/index/bulk-zip` | ZIP/RAR arsivini indexler |

### Arama ve Dosyalar

| Method | Endpoint | Amac |
|---|---|---|
| POST | `/search` | Benzer CAD aramasi yapar |
| GET | `/files` | Dosyalari listeler ve filtreler |
| GET | `/files/{file_id}` | Dosya detayini getirir |
| GET | `/files/{file_id}/download` | Orijinal dosyayi indirir |
| DELETE | `/files/{file_id}` | Dosyayi siler |
| POST | `/files/{file_id}/favorite` | Favori durumunu degistirir |
| POST | `/files/approve/bulk` | Toplu onay/durum gunceller |
| GET | `/stats` | Sistem istatistiklerini getirir |

### Duplicate Gruplari

| Method | Endpoint | Amac |
|---|---|---|
| GET | `/groups` | Duplicate/revizyon gruplarini listeler |
| POST | `/groups/merge` | Gruplari birlestirir |
| POST | `/groups/{group_id}/remove-member/{file_id}` | Dosyayi gruptan cikarir |
| POST | `/groups/{group_id}/dissolve` | Grubu dagitir |

### Arama Feedback

| Method | Endpoint | Amac |
|---|---|---|
| POST | `/search/feedback` | Sonuc alaka geri bildirimi kaydeder |
| GET | `/search/feedback/stats` | Feedback istatistiklerini getirir |

### Kategoriler

| Method | Endpoint | Amac |
|---|---|---|
| GET | `/categories` | Kategorileri listeler |
| POST | `/categories` | Kategori olusturur |
| PUT | `/categories/{cat_id}` | Kategori gunceller |
| DELETE | `/categories/{cat_id}` | Kategori siler |
| PATCH | `/categories/files/{file_id}` | Dosyanin kategorisini degistirir |
| GET | `/categories/template` | Kategori import template'i indirir |
| POST | `/categories/import` | Excel kategori import eder |

### Gecmis ve Aktivite

| Method | Endpoint | Amac |
|---|---|---|
| GET | `/history` | Arama gecmisini getirir |
| DELETE | `/history/{history_id}` | Tek arama gecmisi kaydini siler |
| DELETE | `/history` | Arama gecmisini temizler |
| GET | `/activity` | Aktivite loglarini getirir |

### Analytics

| Method | Endpoint | Amac |
|---|---|---|
| GET | `/analytics/overview` | Dashboard ozet verisi |
| GET | `/analytics/uploads-trend` | Upload trendi |
| GET | `/analytics/search-stats` | Arama istatistikleri |

### Dijitallestirme

| Method | Endpoint | Amac |
|---|---|---|
| POST | `/contour/vectorize` | Gorselden kontur, SVG ve DXF uretir |
| POST | `/scan/convert` | Scan/DXF/DWG dosyasini entity listesine cevirir |
| POST | `/scan/export-dxf` | Entity listesini DXF olarak verir |

### Job Sistemi

| Method | Endpoint | Amac |
|---|---|---|
| GET | `/jobs` | Job listesini getirir |
| GET | `/jobs/{job_id}` | Job detayini getirir |
| POST | `/jobs/{job_id}/cancel` | Job iptal eder |
| POST | `/jobs/{job_id}/retry-failed` | Basarisiz job item'larini tekrar dener |
| POST | `/jobs/upload` | Upload'u arka plan job olarak kuyruga alir |
| POST | `/jobs/gen-missing-preview` | Eksik preview'leri uretir |
| POST | `/jobs/check-file-data` | Dosya bytes kontrolu yapar |
| POST | `/jobs/duplicate-rescan` | Duplicate iliskilerini yeniden hesaplar |
| POST | `/jobs/cleanup-payloads` | Eski job payload'larini temizler |
| POST | `/jobs/report-broken` | Bozuk dosyalari raporlar |
| POST | `/jobs/clip-backfill` | Eksik CLIP vector'leri uretir |
| POST | `/jobs/reindex` | Secili dosyalari yeniden indexler |

### Raporlar ve 3D

| Method | Endpoint | Amac |
|---|---|---|
| GET | `/reports/files` | Dosya raporu |
| GET | `/reports/duplicates` | Duplicate raporu |
| GET | `/reports/jobs` | Job raporu |
| GET | `/files/{file_id}/model3d` | Dosyadan basit 3D model/onizleme verisi uretir |

### Sistem

| Method | Endpoint | Amac |
|---|---|---|
| GET | `/health` | Backend saglik kontrolu |

---

## 9. Dosya ve Modul Sorumluluklari

| Dosya | Sorumluluk |
|---|---|
| `backend/main.py` | FastAPI app ve router kayitlari |
| `backend/db.py` | PostgreSQL baglantisi, public tablolar, tenant migration loop |
| `backend/features.py` | CAD/PDF parse, istatistik, 128-D geometric vector, preview fallback |
| `backend/clip_encoder.py` | CLIP vector ve gorsel embedding |
| `backend/middleware/tenant.py` | JWT'den tenant okuma ve search_path uygulama |
| `backend/services/schema_manager.py` | Tenant schema olusturma ve schema guvenligi |
| `backend/services/auth_service.py` | Sifre hash, token olusturma/dogrulama |
| `backend/services/duplicate_service.py` | Hash, duplicate ve revizyon gruplama |
| `backend/services/job_service.py` | Job, job item ve payload yardimcilari |
| `backend/services/scan_foreground.py` | Teknik gorsellerde foreground/part izolasyonu |
| `backend/routes/index.py` | Dosya upload, arsiv preview, indexleme |
| `backend/routes/search.py` | Arama, dosya listesi, dosya detayi, duplicate grup islemleri |
| `backend/routes/categories.py` | Kategori CRUD ve Excel import |
| `backend/routes/history.py` | Arama gecmisi |
| `backend/routes/analytics.py` | Dashboard veri servisleri |
| `backend/routes/activity.py` | Aktivite loglari |
| `backend/routes/contour.py` | Gorsel -> kontur/DXF |
| `backend/routes/scan.py` | Scan -> entity listesi ve DXF export |
| `backend/routes/jobs.py` | Job kuyrugu endpointleri |
| `backend/routes/reports.py` | Excel/CSV raporlari |
| `backend/routes/model3d.py` | Dosyadan 3D model/onizleme |
| `backend/worker.py` | Arka plan job isleyicisi |
| `frontend/index.html` | Ana SPA, tum urun ekranlari |
| `frontend/login.html` | Login/register ekranlari |
| `frontend/i18n.js` | Dil metinleri |
| `ecosystem.config.js` | PM2 process tanimlari |
| `nginx.conf` | Nginx reverse proxy ornegi |
| `start-dev.sh` / `stop-dev.sh` | Local ortam baslatma/durdurma |

---

## 10. Guvenlik ve Izolasyon

Mevcut guvenlik mekanizmalari:

- JWT tabanli kimlik dogrulama.
- Tenant bazli PostgreSQL schema izolasyonu.
- Schema adi regex kontrolu: `^[a-z][a-z0-9_]{0,62}$`.
- Korumali endpointlerde `Authorization: Bearer <token>` zorunlulugu.
- Her requestte tenant `search_path` uygulanmasi.
- Dosya boyutu limitleri.
- Eski veya desteklenmeyen DWG dosyalari icin kullaniciya net hata donme.

Gelismeye acik alanlar:

- CORS su anda genis izinli.
- Rate limiting henuz yok.
- Tenant bazli kota henuz tamamlanmadi.
- MIME/magic byte validasyonlari daha da sertlestirilebilir.
- Otomatik test kapsami yok.

---

## 11. Performans Yaklasimi

Performans icin kullanilan ana teknikler:

- pgvector HNSW indexleri.
- Geometric vector ve CLIP vector ayrimi.
- CLIP basarisiz olursa geometric fallback.
- Bulk upload'da her dosya icin ayri try/except.
- Arka plan job sistemi ile agir islerin UI'i kilitlememesi.
- Preview ve CLIP backfill job'lariyla eksikleri sonradan tamamlama.
- Dosya listeleme endpointinde sayfalama ve filtreleme.

Hedeflenen arama davranisi:

- Binlerce CAD dosyasi arasinda hizli ilk aday secimi.
- Adaylar uzerinde gorsel ve geometrik re-rank.
- Kullaniciya sadece skor degil, "neden benzer" aciklamasi da sunma.

---

## 12. Local Gelistirme

Local ortam Docker kullanmadan calisir.

```bash
./start-dev.sh
```

Servisler:

```text
Frontend: http://localhost:8080/login.html
Backend:  http://localhost:8000
API Docs: http://localhost:8000/docs
```

Durdurmak icin:

```bash
./stop-dev.sh
```

Backend `.env` dosyasi:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=...
```

PostgreSQL ve pgvector sistem servisi olarak calismalidir.

---

## 13. VPS Operasyon Akisi

Bu projede Docker deploy akisi kullanilmaz.

Standart guncelleme:

```bash
cd ~/CadSource
git pull origin main
```

Sadece frontend degistiyse:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Backend veya dependency degistiyse:

```bash
cd ~/CadSource/backend
venv/bin/pip install -r requirements.txt
cd ..
pm2 restart cadsearch --update-env
pm2 restart cadsearch-worker --update-env
sudo nginx -t && sudo systemctl reload nginx
```

PM2 processleri:

```bash
pm2 status
pm2 logs cadsearch
pm2 logs cadsearch-worker
```

---

## 14. Bilinen Sinirlar

Bu proje guclu bir CAD arama ve dijitallestirme altyapisi sunar; fakat su noktalar bilinmelidir:

- Taranmis teknik resimlerden CAD uretimi her gorselde kusursuz sonuc vermez. Olculer, yazilar, teknik tablo, baslik blogu ve tarama kalitesi sonucu etkiler.
- DWG kapali bir formattir. Bazi eski veya bozuk DWG dosyalari `dwg2dxf` ile cevrilemeyebilir.
- CLIP modeli ilk calismada yuklenirken gecikme yaratabilir.
- Otomatik test paketi henuz yoktur.
- Frontend tek buyuk SPA dosyasinda ilerledigi icin ileride modulerlestirme gerekebilir.
- Guvenlik fazinda rate limiting, kota, CORS whitelist ve MIME dogrulama sertlestirilmelidir.

---

## 15. Projenin Bugunku Durumu

Tamamlanmis ana bolumler:

- SaaS auth ve multi-tenant schema mimarisi.
- CAD/PDF/gorsel upload ve indexleme.
- 128-D geometric vector.
- 512-D CLIP vector.
- Hibrit benzerlik aramasi.
- Preview uretimi.
- Dosya kutuphanesi.
- Kategori sistemi ve import.
- Onay/draft/uploaded is akisi.
- Dashboard ve analitik.
- Arama gecmisi ve aktivite loglari.
- Duplicate/revizyon adayi tespiti.
- Job kuyrugu ve worker.
- Raporlama.
- Gorsel -> Kontur.
- Scan -> CAD.
- CAD Pro editor.
- Basit 3D gorunum.
- Docker'siz VPS operasyon modeli.

Devam eden veya sonraki faz adaylari:

- Autodesk Vault / SharePoint entegrasyonu.
- API key ile dis sistemlerden sorgu.
- Redis query cache.
- Vector quantization.
- Tenant kota sistemi.
- Rate limiting ve monitoring.
- Otomatik test kapsami.

---

## 16. Tek Cumlelik Ozet

Profile Axis / CAD-Search, CAD arsivlerini akilli ve gorsel olarak aranabilir hale getiren; dosya yonetimi, benzerlik arama, duplicate kontrolu, onay akisi, raporlama ve teknik gorsel dijitallestirme ozelliklerini tek tarayici tabanli platformda birlestiren bir SaaS CAD analiz sistemidir.
