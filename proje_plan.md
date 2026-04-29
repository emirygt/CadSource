# CAD-Search — Proje Planı
> Son güncelleme: 2026-04-28

---

## Genel Durum: Faza 1 ✅, Faza 2 ✅, Faza 3.1-3.5 ✅, Faza 2.15 + Scan SVG ✅ — MVP hazır, arama kalitesi iyileştirildi, görsel diff + teknik çizim editörü eklendi; sıradaki odak ürün güvenilirliği ve satışa hazır deneyim

---

## FAZA 1 — SaaS Altyapısı ✅ TAMAMLANDI

| # | Görev | Durum | Not |
|---|-------|-------|-----|
| 1.1 | PostgreSQL + pgvector | ✅ | PostgreSQL servis |
| 1.2 | FastAPI backend (uvicorn) | ✅ | `backend/main.py`, port 8000 |
| 1.3 | Multi-tenant schema sistemi | ✅ | `services/schema_manager.py` — register → CREATE SCHEMA |
| 1.4 | JWT auth (register + login) | ✅ | `routes/auth.py`, JWT payload'da `schema_name` |
| 1.5 | `/index` tek dosya endpoint | ✅ | `routes/index.py` |
| 1.6 | `/index/bulk` toplu upload endpoint | ✅ | batch 10'lu gönderim |
| 1.7 | `/search` vektör benzerlik araması | ✅ | pgvector cosine, HNSW index |
| 1.8 | `/files` CRUD (list, get, delete) | ✅ | `routes/search.py` |
| 1.9 | `/stats` endpoint | ✅ | toplam / indexlenmiş dosya sayısı |
| 1.10 | 128-D feature vector (DXF/DWG) | ✅ | `features.py` — sabit, değişmeyecek |
| 1.11 | Frontend login/register sayfası | ✅ | `frontend/login.html` |
| 1.12 | Frontend arama arayüzü | ✅ | `frontend/index.html` — grid/liste view |
| 1.13 | Frontend DB sekmesi (upload + liste) | ✅ | index.html içinde 2. sekme |
| 1.14 | PDF desteği (upload + indexleme) | ✅ | `pypdf` — sayfa boyutu/metin → 128-D vektör |
| 1.15 | Local geliştirme scriptleri | ✅ | `start-dev.sh` / `stop-dev.sh` |

**Faza 1'de düzeltilen buglar:**
- `routes/index.py`: `:param::json` → `CAST(:param AS jsonb)` (SQLAlchemy çakışması)
- Tüm frontend path'leri absolute → relative (`/login.html` → `login.html`)
- PostgreSQL bağlantı ayarları ortam bazlı yönetildi

**Faza 1'de yapılmayan (ertelendi):**
- Nginx + SSL kurulumu → Faza 1 sonunda (VPS deploy henüz yapılmadı)
- PM2 config → VPS deploy ile birlikte
- `scripts/bulk_index.py` bug fix → düşük öncelikli (UI'dan upload yeterli)

---

## FAZA 2 — Kullanılabilir Ürün 🔄 DEVAM EDİYOR

| # | Görev | Durum | Açıklama |
|---|-------|-------|----------|
| 2.1 | CAD önizleme — sidebar (Ara sekmesi) | ✅ | Dosya seçilince tarayıcıda DXF parse → SVG render |
| 2.2 | CAD önizleme — DB sekmesi "Önizle" butonu | ✅ | Backend SVG üretir (upload sırasında), modal'da gösterilir |
| 2.3 | Kategori sistemi (backend + DB) | ✅ | `/categories` CRUD, `cad_files.category_id` kolonu |
| 2.4 | Kategoriler sekmesi (frontend) | ✅ | Ekle/düzenle/sil + renk seçici |
| 2.5 | Upload'da kategori seçimi | ✅ | DB sekmesinde dropdown, bulk upload'a category_id eklendi |
| 2.6 | DB tablosunda kategori badge | ✅ | Renk kodlu badge, her satırda görünür |
| 2.7 | Katman / entity tipi filtresi | ⬜ | Arama sidebar'a ek filtreler |
| 2.8 | Boyut aralığı filtresi | ⬜ | A3/A4/A2 format seçimi |
| 2.9 | Arama geçmişi | ✅ | `search_history` tablosu, `/history` CRUD, sidebar geçmiş bölümü |
| 2.10 | Favoriler | ⬜ | `favorites` tablosu + UI |
| 2.11 | İki çizimi yan yana karşılaştırma | ✅ | Sonuç kartına "Karşılaştır" butonu, yan yana modal, SVG lazy load |
| 2.12 | Dosya detay modalı | ✅ | DB tablosunda satıra tıkla → SVG + tüm metadata popup |
| 2.13 | DB toplu durum akışı | ✅ | DB tablosunda checkbox + status seçimi (`yüklendi/draft/onaylı`) |
| 2.14 | Ürün Durumları sekmesi | ✅ | Tek sayfa, filtreyle yüklendi/draft/onaylı listeleme + toplu durum atama |

**Sıradaki görev:** Faza 3.6 başladı — önce mevcut özellikler profesyonel seviyeye çıkarılacak; ilk odak CAD editör deneyimi.

---

## FAZA 3 — Akıllı Arama & Ölçek 🔄 DEVAM EDİYOR

| # | Görev | Durum |
|---|-------|-------|
| 3.1 | CLIP embeddings (CAD render → ML vektör) | ✅ | 512-D CLIP + 128-D concat → search route — tamamlandı |
| 3.2 | Analytics dashboard (en çok aranan, dağılım) | ✅ | `/analytics` route, Chart.js dashboard — tamamlandı |
| 3.3 | DWG/DXF gerçekçi JPEG preview pipeline | ✅ | `generate_jpg_preview_from_bytes` + DWG→DXF render + siluet dolgu |
| 3.4 | Hibrit skor sonrası kalite re-rank | ✅ | `visual_similarity` + `geometry_guard` ile false-positive azaltma |
| 3.5 | Aranan dosyanın görselini sonuç üstünde gösterme | ✅ | `/search` → `query_preview`, frontend "Aranan Dosya" kartı |
| 3.5e | **Neden benzer? — metinsel gerekçe** | ✅ | `buildMatchReasons(qs, r)` frontend: CLIP/siluet/oran/ölçek/katman/entity-tipi rozetleri · Grid kartta 3 rozet + "+N neden daha", List kartta 2 mini, Compare modal tam liste, `reasonModal` popup · backend dokunulmadı |
| 3.5b | Görsel fark (diff overlay) — yeşil/kırmızı/mavi piksel haritası | ✅ | Sonuç kartına "◐ Fark" butonu + `diffModal` + canvas piksel-bazlı diff (frontend, backend dokunulmadı) |
| 3.5c | Scan-CAD: SVG teknik çizim görünümü + düzenleyici | ✅ | `scanRenderSVG`, `toggleScanView`, arc-3-point + move tool + SVG export (frontend; mevcut canvas mode korundu) |
| 3.5d | **CAD Pro — Full AutoCAD klon editör** | ✅ | `#acadOverlay`: Çiz (Line/Circle/Arc/Rect/Polyline/Polygon/Ellipse/Point/Text/XLine/Ray/Leader), Değiştir (Move/Copy/Rotate/Erase/Trim/Extend/Offset/Mirror/Scale/Fillet/Chamfer/Break/Join/Explode/Lengthen/Array/Divide/Measure/Smooth/Matchprop), Ölçü (Linear/Aligned/Radius/Diameter/Angular), Inquiry (Dist/Id/Area/List/Properties), Özel (Regen/Purge), Katmanlar, Komut satırı (L/C/A/REC/PL/POL/EL/PO/T/XL/RAY/LE/M/CO/RO/E/TR/EX/OFF/MI/SC/F/CHA/BR/J/X/LEN/AR/DIV/ME/SM/MA/DLI/DAL/DRA/DDI/DAN/DI/ID/AA/LI/PR/REGEN/PURGE), Snap (endpoint/midpoint/center/intersection/grid), OSNAP/ORTHO/GSNAP, F3/F8/F9 + Ctrl+Z/Y kısayollar, Undo/Redo, koyu tema, DXF/SVG export (yeni tipler backend'e line/text olarak düzleştirilir) — **frontend-only, backend dokunulmadı** |
| 3.6 | Mevcut özellikleri profesyonel seviyeye çıkarma | 🔄 | CAD editör → Scan-CAD → arama → import → duplicate → modülerleşme → güvenlik |
| 3.7 | Autodesk Vault / SharePoint entegrasyonu | ⬜ |
| 3.8 | API key desteği (dışarıdan sorgu) | ⬜ |
| 3.9 | Redis query cache | ⬜ |
| 3.10 | Vector quantization (int8, 4x küçük) | ⬜ |

---

## FAZA 3.6 — Mevcut Özellikleri Profesyonel Seviyeye Çıkarma 🔄 DEVAM EDİYOR

> Amaç: Yeni modül eklemeden önce mevcut çekirdeği "demo çalışıyor" seviyesinden "her gün kullanılabilir profesyonel CAD ürünü" seviyesine taşımak.

### Öncelik Sırası

| Sıra | Başlık | Neden Öncelikli |
|---|---|---|
| 1 | CAD editör deneyimini güçlendirme | Kullanıcının üründeki profesyonellik hissini en hızlı artırır; AutoCAD benzeri temel çizim/edit akışı oturur |
| 2 | Scan → CAD kalite modu | Teknik resimlerden temiz profil çıkarma doğrudan değer üretir |
| 3 | Arama kalitesi ve açıklanabilirlik | Kullanıcı sonucun neden üstte olduğunu anlayınca aramaya daha kolay güvenir |
| 4 | Import / bulk upload kalite raporu | Toplu yükleme sonrası hangi dosya başarılı/hatalı netleşir |
| 5 | Duplicate / revizyon akışı | CAD kütüphanesi temizliği ve operasyonel fayda için güçlü ticari özellik |
| 6 | Frontend modülerleşme | Uzun vadeli bakım ve hız için gerekli; davranışlar oturduktan sonra yapılmalı |
| 7 | Güvenlik ve sağlamlık | Canlıya çıkış öncesi zorunlu kalite kapısı; geliştirme sırasında en sona alınacak |

### 3.6.1 CAD Editör Deneyimini Güçlendirme 🔄

| Alt Görev | Durum | Kapsam |
|---|---|---|
| 3.6.1.1 | 🔄 | CAD Editör girişini Dijitalleştirme içinde görünür yap; komut satırını profesyonelleştir: koordinat, göreli koordinat, polar giriş, son komutu tekrarlama, daha net hata mesajları |
| 3.6.1.2 | ⬜ | Seçim davranışını güçlendir: çoklu seçim, seçim kutusu, layer lock saygısı, seçim bilgi paneli |
| 3.6.1.3 | ⬜ | Snap/OSNAP kalitesini artır: endpoint, midpoint, center, intersection, nearest, perpendicular, tangent ayrımı |
| 3.6.1.4 | ⬜ | Modify komutlarını sağlamlaştır: move/copy/rotate/trim/extend/offset/fillet/chamfer/mirror/scale için geometri doğruluğu |
| 3.6.1.5 | ⬜ | Grip editing ekle: seçili çizgi uçlarını, çember merkez/radius noktalarını ve polyline vertex'lerini sürükleyerek düzenleme |
| 3.6.1.6 | ⬜ | Layer/properties panelini olgunlaştır: renk, görünürlük, kilit, aktif layer, entity layer değiştirme |
| 3.6.1.7 | ⬜ | DXF/SVG export temizliğini artır: layer bilgisi, text/dimension flatten, ölçü ve yardımcı çizgi ayrımı |
| 3.6.1.8 | ⬜ | Editör smoke test senaryoları: line/circle/polyline çiz, snap ile bağla, trim/extend yap, export al |

**Dokunulacak ana dosyalar:**
- `frontend/index.html`
- `frontend/i18n.js`
- Gerekirse `backend/routes/scan.py`

**Kabul kriteri:**
- Kullanıcı temel çizim ve düzenleme işlerini komut satırı + toolbar ile tutarlı şekilde yapabilmeli.
- Snap ve modify komutları üretim çizimini bozmayacak kadar öngörülebilir olmalı.
- Export edilen DXF/SVG tekrar açıldığında çizim temiz ve kullanılabilir görünmeli.
- Kötü/geçersiz komutlarda editör sessiz kalmamalı, kullanıcıya net geri bildirim vermeli.

### 3.6.2 Scan → CAD Kalite Modu ⬜

| Alt Görev | Durum | Kapsam |
|---|---|---|
| 3.6.2.1 | ⬜ | `foreground_mode` seçeneklerini kullanıcı diliyle netleştir: tüm çizim, sadece parça/profil, kırmızı/renkli kontur, siyah-beyaz kesit profili |
| 3.6.2.2 | ⬜ | Ölçü çizgisi, yazı, tablo, antet ve dış sayfa çerçevesini bastıran "teknik resim temizleme" modu ekle |
| 3.6.2.3 | ⬜ | Açık uç kapatma: yakın uçları toleransla bağla, küçük kopuklukları kapat, kapalı kontur kalitesini raporla |
| 3.6.2.4 | ⬜ | Küçük gürültü temizleme: minimum uzunluk, minimum alan, ince çizgi filtresi ve mikro kontur silme ayarları |
| 3.6.2.5 | ⬜ | Kullanıcıya "temizle", "konturu kapat", "ölçüleri yok say", "sadece profil" şeklinde 3-4 basit kontrol sun |
| 3.6.2.6 | ⬜ | Önizlemede orijinal/maske/vektör karşılaştırmalı görünüm ekle |
| 3.6.2.7 | ⬜ | Test görselleriyle kalite seti oluştur: kırmızı kontur, siyah-beyaz profil, ölçülü teknik pafta, düşük kontrast tarama |

**Dokunulacak ana dosyalar:**
- `backend/services/scan_foreground.py`
- `backend/routes/scan.py`
- `backend/routes/contour.py`
- `frontend/index.html`
- `frontend/i18n.js`

**Kabul kriteri:**
- Ölçülü teknik paftada dış çerçeve, yazı ve ölçü çizgileri ana profile dahil edilmemeli.
- Renkli kontur görselinde sadece gerçek parça konturu yakalanmalı.
- Açık uçlar tolerans içinde kapatılabilmeli ve kullanıcıya kaç kapatma yapıldığı gösterilmeli.
- Kötü sonuçta sistem sessizce yanlış DXF üretmek yerine kalite uyarısı göstermeli.

### 3.6.3 Arama Kalitesi ve Açıklanabilirlik ⬜

| Alt Görev | Durum | Kapsam |
|---|---|---|
| 3.6.3.1 | ⬜ | Sonuçlarda alt skorları standartlaştır: geometri, görsel, ölçek/oran, katman/entity |
| 3.6.3.2 | ⬜ | Backend response'a mümkünse `confidence_breakdown` alanı ekle |
| 3.6.3.3 | ⬜ | Frontend kartlarında tek yüzde yerine küçük skor barları göster |
| 3.6.3.4 | ⬜ | "Neden benzer?" metinlerini daha net hale getir: güçlü eşleşme, orta güven, dikkat |
| 3.6.3.5 | ⬜ | Katman/entity tipi filtresi ve boyut aralığı filtresini arama sidebar'ına ekle |
| 3.6.3.6 | ⬜ | Kullanıcı feedback'ini arama kalite raporuna bağla |
| 3.6.3.7 | ⬜ | Düşük güvenli sonuçları görsel olarak daha sakin göster; yüksek güvenli sonuçları öne çıkar |

**Dokunulacak ana dosyalar:**
- `backend/routes/search.py`
- `frontend/index.html`
- `frontend/i18n.js`

**Kabul kriteri:**
- Kullanıcı bir sonucun neden üst sırada olduğunu kart üzerinden anlayabilmeli.
- Sadece tek similarity yüzdesine bakmak zorunda kalmamalı.
- Yanlış sonuç feedback'i ileride kalite ölçümüne temel oluşturmalı.

### 3.6.4 Import / Bulk Upload Kalite Raporu ⬜

| Alt Görev | Durum | Kapsam |
|---|---|---|
| 3.6.4.1 | ⬜ | Bulk/job sonucu için özet metrikler üret: başarılı, hatalı, duplicate, preview yok, CLIP yok, file_data yok |
| 3.6.4.2 | ⬜ | Hatalı dosyaları sebebe göre grupla: eski DWG, parse edilemedi, dosya büyük, preview üretilemedi, CLIP üretilemedi |
| 3.6.4.3 | ⬜ | Job detay ekranına kalite raporu paneli ekle |
| 3.6.4.4 | ⬜ | "Eksikleri tamamla" aksiyonları ekle: preview backfill, CLIP backfill, duplicate rescan |
| 3.6.4.5 | ⬜ | Raporu Excel/CSV olarak dışa aktar |
| 3.6.4.6 | ⬜ | Upload tamamlanınca kullanıcıya yönlendirici banner göster |

**Dokunulacak ana dosyalar:**
- `backend/routes/jobs.py`
- `backend/worker.py`
- `backend/routes/reports.py`
- `frontend/index.html`

**Kabul kriteri:**
- Toplu yükleme bitince kullanıcı kaç dosyanın gerçekten kullanılabilir olduğunu tek bakışta görmeli.
- Hatalı dosyalarda "neden olmadı?" sorusu cevapsız kalmamalı.
- Eksik preview/CLIP gibi sonradan düzeltilebilir durumlar tek tık job'a dönüşmeli.

### 3.6.5 Duplicate / Revizyon Akışını Güçlendirme ⬜

| Alt Görev | Durum | Kapsam |
|---|---|---|
| 3.6.5.1 | ⬜ | Duplicate durumlarını kullanıcı diliyle ayır: birebir kopya, muhtemel revizyon, aynı profil farklı isim, benzersiz |
| 3.6.5.2 | ⬜ | Grup detayında ana dosya seçme akışı ekle |
| 3.6.5.3 | ⬜ | Seçili duplicate dosyaları arşivle/draft yap/onaydan çıkar aksiyonları ekle |
| 3.6.5.4 | ⬜ | Revizyon adaylarında farkları göster: dosya adı, tarih, entity farkı, bbox farkı, preview farkı |
| 3.6.5.5 | ⬜ | Duplicate raporunu operasyon diline çevir: "temizlenebilir kayıt", "inceleme gerekli", "güven yüksek/düşük" |
| 3.6.5.6 | ⬜ | Yanlış duplicate için "benzer değil" geri bildirimi ekle ve grubu dağıtma kararını logla |

**Dokunulacak ana dosyalar:**
- `backend/services/duplicate_service.py`
- `backend/routes/search.py`
- `backend/routes/reports.py`
- `frontend/index.html`

**Kabul kriteri:**
- Kullanıcı duplicate ekranından hangi dosyanın ana kayıt kalacağını seçebilmeli.
- Birebir kopya ile revizyon adayı açıkça ayrılmalı.
- Yanlış eşleşmeler kolayca temizlenebilmeli.

### 3.6.6 Frontend Modülerleşme ⬜

| Alt Görev | Durum | Kapsam |
|---|---|---|
| 3.6.6.1 | ⬜ | `frontend/index.html` içindeki CSS, JS ve HTML bloklarını envanterle |
| 3.6.6.2 | ⬜ | Önce davranış değiştirmeden CSS'i `frontend/theme.css` ve sayfa bazlı CSS bloklarına taşı |
| 3.6.6.3 | ⬜ | API helper, nav helper, modal helper, file library helper gibi JS modülleri çıkar |
| 3.6.6.4 | ⬜ | Scan/CAD editor kodunu ayrı dosyaya taşı |
| 3.6.6.5 | ⬜ | Her taşıma sonrası tarayıcı smoke test yap: login, dashboard, upload, search, contour, scan |
| 3.6.6.6 | ⬜ | React'e geçiş yapılacaksa bunu ayrı faz olarak değerlendir; mevcut stabil davranışı bozmadan ilerle |

**Dokunulacak ana dosyalar:**
- `frontend/index.html`
- `frontend/theme.css`
- Yeni frontend JS/CSS dosyaları

**Kabul kriteri:**
- Kullanıcı deneyimi değişmeden dosya boyutu ve bakım karmaşıklığı azalmalı.
- Her modül bağımsız okunabilir olmalı.
- Büyük görsel/UI değişiklikleri modülerleşme fazına karıştırılmamalı.

### Uygulama Stratejisi

1. Önce `3.6.1 CAD Editör Deneyimini Güçlendirme` yapılacak; çünkü mevcut ürünün profesyonellik hissini doğrudan etkiliyor.
2. Ardından `3.6.2 Scan → CAD Kalite Modu` yapılacak; çünkü teknik resimden temiz profil çıkarma gerçek kullanıcı problemini çözüyor.
3. Sonra `3.6.3 Arama Kalitesi ve Açıklanabilirlik` güçlendirilecek; çünkü arama sonucuna güven ürünün ana vaadi.
4. `3.6.4 Import / Bulk Upload Kalite Raporu` toplu yükleme sonrası güveni artıracak.
5. `3.6.5 Duplicate / Revizyon` CAD kütüphanesi temizliğini satılabilir özellik haline getirecek.
6. `3.6.6 Frontend Modülerleşme` davranışlar oturduktan sonra yapılacak.
7. `FAZA 4 Güvenlik ve Sağlamlık` canlıya çıkış öncesi kalite kapısı olarak en sona alınacak.

---

## FAZA 4 — Güvenlik ⬜ BAŞLANMADI

| # | Görev | Durum |
|---|-------|-------|
| 4.1 | Dosya boyutu kota (tenant başına) | ⬜ |
| 4.2 | MIME type + magic byte validasyonu | ⬜ |
| 4.3 | CORS whitelist (wildcard kaldır) | ⬜ |
| 4.4 | Rate limiting (tenant bazlı) | ⬜ |
| 4.5 | Prometheus metrics + Grafana | ⬜ |

---

## VPS Deploy (Faza 1 sonunda yapılacak)

| # | Görev | Durum |
|---|-------|-------|
| D.1 | VPS temin + SSH erişimi | ⬜ |
| D.2 | PostgreSQL servis kurulumu (Docker'sız) | ⬜ |
| D.3 | Backend venv + PM2 ecosystem config | ⬜ |
| D.4 | Nginx config + SSL (Let's Encrypt) | ⬜ |
| D.5 | Domain bağlama | ⬜ |
| D.6 | CI/CD (GitHub Actions → VPS deploy) | ⬜ |

---

## Bilinen Açık Buglar

| Dosya | Bug | Durum |
|-------|-----|---------|
| `scripts/bulk_index.py` | `init_db_engine()` undefined | ✅ Düzeltildi |
| `features.py` | ezdxf eski DWG versiyonlarını sessiz fail ediyor | ✅ R12 öncesi DWG için net hata mesajı |
| `backend/.env` | Port 5433 hardcode — VPS'te 5432 olacak | VPS deploy'da düzelt |

## MVP Olarak Tamamlananlar (bu oturumda)
- ZIP bulk upload (500 MB limit, iç içe klasör, çakışma önleme)
- Bulk upload'da CLIP skip (hızlı mod — varsayılan açık)
- Dosya boyutu limitleri (tekil 50 MB, ZIP 500 MB)
- Hata mesajları net hale getirildi (eski DWG, bozuk dosya)
- Min. benzerlik default %50 → %20
- Analytics boş veri graceful handling
- Sonuç bulunamadı mesajı yönlendirici hale getirildi
- Gerçek DWG/DXF tabanlı `jpg_preview` üretimi (Cloud-converter'a daha yakın render)
- Re-index/backfill akışı: mevcut kayıtlara `jpg_preview` ve CLIP güncelleme desteği
- `/files/{id}` JSON serileştirme düzeltmesi (`BYTEA` yerine `has_file_data` flag)
- `/files/{id}/download` ile orijinal dosya indirme
- Sonuç ekranında "Aranan Dosya" görsel kartı (`query_preview`)
- Search skorunda görsel karşılaştırma + geometri guard ile daha güvenli sıralama
- NO_DOCKER operasyon politikası dökümana işlendi (AI ajanlar Docker önermez/kurmaz)
- Docker'sız local DWG upload için `scripts/setup-dwg2dxf.sh` eklendi
- `scripts/bulk_index.py` `init_db_engine()` hatası düzeltildi
- Merkezi logging eklendi; hedef backend modüllerindeki `print()` ve silent exception noktaları logging'e taşındı
- R12 öncesi DWG dosyaları için kullanıcıya net hata mesajı döndürülüyor
- Kapsamlı ürün/proje dokümanı eklendi: `PROJE_DOKUMANI.md`

---

## Kritik Dosyalar

| Dosya | Ne yapar |
|-------|----------|
| `backend/main.py` | FastAPI app, router kayıtları |
| `backend/features.py` | 128-D vektör çıkarma — **DOKUNMA** |
| `backend/db.py` | SQLAlchemy model, `init_db()` |
| `backend/routes/auth.py` | Register / Login |
| `backend/routes/index.py` | `/index`, `/index/bulk` |
| `backend/routes/search.py` | `/search`, `/files`, `/stats` |
| `backend/middleware/tenant.py` | JWT doğrulama + search_path |
| `backend/services/schema_manager.py` | Tenant schema oluşturma |
| `frontend/index.html` | Ana uygulama (Ara + DB sekmeleri) |
| `frontend/login.html` | Login / register |
| `start-dev.sh` | Local ortamı tek komutla başlatır |

---

## Local Çalışma Hatırlatması

```bash
./start-dev.sh
# Frontend → http://localhost:8080/login.html
# Backend  → http://localhost:8000
# API Docs → http://localhost:8000/docs
# Login    → admin@example.com / admin123
```
