# PATTERNS — Kod Kalıpları

## Korumalı Endpoint Şablonu
Her route'da önce `apply_tenant_schema` çağrılır, yoksa sorgular public schema'ya düşer:
```python
@router.post("/endpoint")
def my_endpoint(
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)   # ← ZORUNLU, her zaman ilk satır
    # ... iş mantığı
```

## Yeni Tablo/Kolon Ekleme Sırası
1. `schema_manager.py → TENANT_SCHEMA_SQL` — yeni tenant'lar için
2. `db.py → init_db()` migration loop'u — mevcut tenant şemalarına ALTER TABLE
3. `ARCHITECTURE.md` ve `proje_plan.md` güncelle

## Upsert Kalıbı (index.py)
`filepath` unique olduğu için `_upsert_file()` helper var:
- SELECT id → varsa UPDATE, yoksa INSERT
- `clip_vec IS NOT NULL` koşullu CAST: CLIP yoksa mevcut clip_vector korunur

## Benzerlik Skoru Hesaplama
Katmanlı 3-aşamalı reranking (search.py):
1. **SQL hibrit skor**: `0.4*geo + 0.6*clip` (clip varsa), sadece `geo` (yoksa)
   - clip_similarity < 0.25 → `base_score * 0.65`
   - clip_similarity < 0.40 → `base_score * 0.85`
2. **Geometry guard** (`_geometry_guard`): aspect ratio + entity count farkına göre çarpan (max ceza %36)
3. **Görsel mask** (`_shape_similarity`): `0.65*sql_score + 0.35*visual` ile final skor

## CLIP Lazy Singleton
```python
_model = None  # modül global
def _load_model():
    global _model
    if _model is not None: return
    # ... CLIPModel.from_pretrained(...)
```
Her upload'da model tekrar yüklenmez, startup değil ilk çağrıda yüklenir.

## Schema Güvenliği
`schema_name` her zaman regex validate edilir, f-string SQL'e doğrudan girer (tablo/schema adı parametre kabul etmez):
```python
if not re.match(r"^[a-z][a-z0-9_]{0,62}$", schema_name):
    raise ValueError(...)
db.execute(text(f"SET search_path TO {schema_name}, public"))
```

## Route Sırası Kuralı
Named route'lar wildcard'dan önce tanımlanmalı:
```python
# DOĞRU
@router.post("/files/approve/bulk")   # önce
@router.get("/files/{file_id}")       # sonra
```

## Arşiv İşleme
`_iter_archive(content, filename)` hem ZIP hem RAR'ı destekler.
RAR için unrar binary gerekir; `_configure_rar_tooling()` PATH'te arar, yoksa ValueError.
Büyük arşivler için önce `_list_archive_entries()` ile preview, sonra gerçek extract.

## Frontend i18n
- `data-i18n="key"` → `el.textContent = t(key)`
- `data-i18n-placeholder="key"` → `el.placeholder = t(key)`
- `data-i18n-title="key"` → `el.title = t(key)`
- JS dinamik metinler: `t('key')` ile döndürülür, hardcoded Türkçe yok
- `applyI18n()` + `updateLangBtn()` her sayfa yükünde ve lang değişiminde çağrılır

## API URL Seçimi (Frontend)
`API_CANDIDATES` listesi: `window.API_URL` → `localStorage.api_base` → `/api` → `localhost:8000`
`ensureApiBase()` her birini `/health` endpoint'i ile dener, çalışanı `localStorage`'a yazar.

## Dosya Boyut Limitleri
- Tek dosya: 50 MB
- ZIP/RAR: 500 MB
- Kontrol: `len(content) > MAX_SINGLE_BYTES`

## Türkçe Case-Insensitive Karşılaştırma
SQL `LOWER()` C locale'de `İ→i` dönüşümü yapmaz. Python'da yapılmalı:
```python
_TR_UPPER = str.maketrans("İĞŞÇÜÖI", "iğşçüöı")

def _norm(s: str) -> str:
    return s.strip().translate(_TR_UPPER).lower()
```
Kategori lookup'ları DB'den çekilir, Python'da `_norm(row.name) == _norm(name)` ile karşılaştırılır.
`casefold()` kullanma — `'İ'.casefold()` = `'i̇'` (dotted i), `'i'` ile eşleşmez.

---
*Son güncelleme: 2026-04-26*
