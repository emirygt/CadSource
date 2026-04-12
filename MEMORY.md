# CAD-Search Memory

> Oluşturulma: 2026-04-08
> Amaç: Son kritik kararları ve beklentileri tek yerde saklamak.

## Ürün Davranışı (Beklenen)

- Arama ekranında sorgu dosyası sadece isimle değil görselle de görünür.
  - Backend `/search` cevabı: `query_preview`
  - Frontend: sonuç üstünde "Aranan Dosya" kartı
- Sonuç kartlarında `jpg_preview` tercih edilir; yoksa SVG/canvas fallback çalışır.
- `/files/{id}` ham `BYTEA` dönmez.
  - `has_file_data` ile var/yok bilgisi döner
  - İndirme için `/files/{id}/download` kullanılır

## Arama Kalitesi Kararları

- Hibrit skor tabanı:
  - CLIP varsa: `0.4 * geo_sim + 0.6 * clip_sim`
  - CLIP yoksa: `geo_sim`
- Re-rank:
  - `visual_similarity` (siluet maskesi)
  - `geometry_guard` (aspect ratio + entity oranı)
  - Nihai skor: `(0.65 * base + 0.35 * visual) * guard`

## Preview Üretim Kararları

- DWG/DXF için `generate_jpg_preview_from_bytes(...)` kullanılmalı.
- DWG parse akışı:
  - `dwg2dxf` (LibreDWG) ile DXF'e çevir
  - ezdxf drawing backend ile render
  - kontur + dolgu ile siluet görünüm üret
- Dönüşüm başarısızsa data tabanlı fallback `generate_jpg_preview(data)` kullanılmalı.

## Operasyonel Notlar

- "DB'deki kayıtların JPEG'i yok" durumunda mevcut kayıtlar için backfill/re-index çalıştır.
- CLIP vektörleri ayrı olarak tekrar üretilebilir; başarısız dosya tüm batch'i durdurmamalı.
- Tenant mimaride çalışırken her sorguda doğru `search_path` uygulandığından emin ol.
