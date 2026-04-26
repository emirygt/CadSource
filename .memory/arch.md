# ARCH — Mimari Kararlar

## Temel Prensipler
- Her müşteri = kendi PostgreSQL schema'sı (aynı DB instance, sıfır çapraz erişim)
- JWT payload'da `schema_name` claim'i taşır; her request'te `SET search_path TO {schema}` çalıştırılır
- Docker yok: deploy = `git pull` + `pm2 restart cadsearch`
- features.py geometrik vektörü sabittir, değişmez
- CLIP başarısız olursa indexleme/arama yine de geometric ile çalışmaya devam eder

## Veri Akışı

### Register
```
POST /auth/register
→ public.users INSERT
→ derive_schema_name(email) → "acmemuh" (domain part, dedup)
→ CREATE SCHEMA acmemuh
→ TENANT_SCHEMA_SQL: cad_files, categories, search_history, activity_log, HNSW index
→ JWT {user_id, email, schema_name}
```

### Dosya Indexleme
```
POST /index (veya /index/bulk, /index/bulk-zip)
→ apply_tenant_schema → SET search_path TO {schema}
→ parse_dxf_bytes(content) → entity list + bbox
→ extract_features(data) → 128-D geometric vector (L2 normalized)
→ generate_jpg_preview_from_bytes → JPEG base64
→ extract_clip_vector_from_bytes → 512-D CLIP vector (nullable)
→ _upsert_file → INSERT / UPDATE cad_files
```

### Arama
```
POST /search (multipart DXF/DWG upload)
→ apply_tenant_schema
→ parse_dxf_bytes → extract_features → 128-D query vec
→ extract_clip_vector_from_bytes → 512-D CLIP query vec (nullable)
→ SQL: candidate_k = max(top_k*6, 40) aday seç
   hibrit skor: clip varsa 0.4*geo + 0.6*clip, yoksa geo
   clip_sim < 0.25 → *0.65, < 0.40 → *0.85
→ Python reranking:
   1. _geometry_guard: aspect_ratio + entity_count farkı penalty
   2. _shape_similarity: silhouette mask IoU + projection cosine
   final = (0.65*sql_score + 0.35*visual) * guard
→ min_similarity filtresi → top_k döndür
→ search_history INSERT
```

## Schema Yapısı
```
public.users          (tüm tenantlar)
public.activity_log   (fallback)

{schema_name}.cad_files
  - feature_vector vector(128)   HNSW index
  - clip_vector    vector(512)   HNSW index (nullable)
  - file_data      BYTEA         ham dosya (indirme + analiz için)
  - jpg_preview    TEXT          base64 data URL
  - approval_status VARCHAR(20)  uploaded | draft | approved
  - category_id    INTEGER FK → {schema}.categories

{schema_name}.categories
  - parent_id INTEGER FK → categories(id)  (3-seviye hiyerarşi)

{schema_name}.search_history
{schema_name}.activity_log
```

## Kritik Kararlar
| Karar | Neden |
|-------|-------|
| Multi-tenant schema izolasyonu (schema-per-tenant) | Veri sızıntısı imkansız, RLS karmaşıklığı yok |
| features.py donduruldu (128-D sabit) | Vektör boyutu değişirse tüm indexler geçersiz olur |
| CLIP lazy singleton | İlk upload'da ~2-3s yükleme, sonrasında anında |
| skip_clip=True bulk upload default | Bulk'da hız öncelikli; kullanıcı sonra CLIP ekleyebilir |
| file_data BYTEA DB'de | Dosya sistemi yönetimi yok, S3 bağımlılığı yok |
| Nginx /api → localhost:8000 proxy | Frontend /api ile relative URL kullanır, CORS sorunu yok |
| PM2 + venv (Docker'sız) | Infra sadeliği, Docker overhead yok |

## init_db() Migration Döngüsü
Startup'ta `information_schema.schemata`'dan tüm tenant şemalarını çeker, her birine `ALTER TABLE IF NOT EXISTS` çalıştırır. Yeni kolon ekleme bu şablona uymalı — hem `TENANT_SCHEMA_SQL`'e hem migration loop'a eklenmeli.

## Anti-Patterns (YAPMA)
- Docker önermek veya kurmak
- features.py'deki vektör boyutunu veya formülü değiştirmek
- `schema_manager.py → TENANT_SCHEMA_SQL`'i migration loop yazmadan değiştirmek
- `apply_tenant_schema()` çağırmadan DB sorgusu yazmak
- f-string SQL'e kullanıcı girdisi eklemek (schema_name regex dışında)
- `.env` dosyasını değiştirmek

---
*Son güncelleme: 2026-04-24*
