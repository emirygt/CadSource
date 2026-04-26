"""
index.py — Dosya indexleme endpoint'leri (tek dosya + bulk upload + ZIP)
"""
from logger import get_logger as _get_logger
_log = _get_logger("routes.index")
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
import json
import zipfile
import io
import os
import tempfile
import shutil

try:
    import rarfile
    RARFILE_AVAILABLE = True
except ImportError:
    rarfile = None
    RARFILE_AVAILABLE = False

from db import get_db
from features import (
    parse_dxf_bytes,
    extract_features,
    extract_stats,
    generate_svg_preview,
    generate_jpg_preview,
    generate_jpg_preview_from_bytes,
    DWG2DXF_BIN,
    UnsupportedDWGVersionError,
)
from middleware.tenant import get_current_tenant, apply_tenant_schema
from clip_encoder import extract_clip_vector, extract_clip_vector_from_bytes
from routes.activity import log_activity
from services.duplicate_service import (
    compute_content_hash,
    compute_geometry_hash,
    update_duplicate_relationships,
)
from services.job_service import enqueue_clip_backfill

router = APIRouter(tags=["index"])

# Limitler
MAX_SINGLE_FILE_MB = 50
MAX_ZIP_FILE_MB = 500
MAX_SINGLE_BYTES = MAX_SINGLE_FILE_MB * 1024 * 1024
MAX_ZIP_BYTES = MAX_ZIP_FILE_MB * 1024 * 1024


def _configure_rar_tooling() -> bool:
    """
    rarfile'in extractor seçimini unrar'a sabitle.
    bsdtar bazı RAR'larda eksik/bozuk çıktı üretebildiği için devre dışı bırakılır.
    """
    if not RARFILE_AVAILABLE:
        return False

    candidates = [
        "/tmp/rarmacos_cli/rar/unrar",
        "/opt/homebrew/bin/unrar",
        "/usr/local/bin/unrar",
        "unrar",
    ]

    chosen = None
    for candidate in candidates:
        if os.path.isabs(candidate):
            if os.path.isfile(candidate):
                chosen = candidate
                break
        else:
            resolved = shutil.which(candidate)
            if resolved:
                chosen = resolved
                break

    if not chosen:
        return False

    rarfile.UNRAR_TOOL = chosen
    rarfile.UNAR_TOOL = "__disabled_unar__"
    rarfile.BSDTAR_TOOL = "__disabled_bsdtar__"
    rarfile.SEVENZIP_TOOL = "__disabled_7z__"
    rarfile.CURRENT_SETUP = None
    return True


def _parse_error_detail(filename: str, ext: str) -> str:
    if ext == "dwg":
        if DWG2DXF_BIN is None:
            return (
                f"'{filename}' okunamadı. DWG dönüştürücü (dwg2dxf) kurulu değil. "
                "Docker kullanmadan `scripts/setup-dwg2dxf.sh` çalıştırın ve backend'i yeniden başlatın."
            )
        return (
            f"'{filename}' okunamadı. DWG dosyası bozuk olabilir veya sürümü desteklenmiyor "
            "(özellikle R12 ve öncesi)."
        )
    return (
        f"'{filename}' okunamadı. Desteklenen formatlar: DXF, DWG, PDF, JPG, PNG."
    )


def _parse_error_status(ext: str) -> int:
    if ext == "dwg" and DWG2DXF_BIN is None:
        return 400
    return 400


def _upsert_file(db, stored_path, filename, ext, data, category_id, skip_clip: bool = False, raw_bytes: bytes = None):
    """Tek dosyayı DB'ye yaz (insert veya update). Ortak yardımcı."""
    import base64
    vec = extract_features(data)
    stats = extract_stats(data)
    content_hash = compute_content_hash(raw_bytes)
    geometry_hash = compute_geometry_hash(stats)
    svg = generate_svg_preview(data)

    # JPEG preview — önce gerçek DWG/DXF render dene, olmazsa data fallback.
    jpg = generate_jpg_preview_from_bytes(raw_bytes, filename) if raw_bytes else None
    if jpg is None:
        jpg = generate_jpg_preview(data)
    jpg_b64 = ("data:image/jpeg;base64," + base64.b64encode(jpg).decode()) if jpg else None

    clip_vec_str = None
    if not skip_clip:
        try:
            clip_vec = (
                extract_clip_vector_from_bytes(raw_bytes, filename, data)
                if raw_bytes is not None
                else extract_clip_vector(data)
            )
            clip_vec_str = str(clip_vec.tolist()) if clip_vec is not None else None
        except Exception as e:
            _log.warning("CLIP vektörü üretilemedi ('%s'): %s", filename, e)
            clip_vec_str = None

    params = {
        **stats,
        "vec": str(vec.tolist()),
        "clip_vec": clip_vec_str,
        "fp": stored_path,
        "svg": svg,
        "jpg": jpg_b64,
        "file_data": raw_bytes,
        "content_hash": content_hash,
        "geometry_hash": geometry_hash,
        "cat": category_id,
        "layers": json.dumps(stats["layers"]),
        "entity_types": json.dumps(stats["entity_types"]),
    }

    existing = db.execute(
        text("SELECT id FROM cad_files WHERE filepath = :fp"), {"fp": stored_path}
    ).fetchone()

    if existing:
        db.execute(text("""
            UPDATE cad_files SET
                feature_vector = CAST(:vec AS vector),
                clip_vector    = CASE WHEN :clip_vec IS NOT NULL THEN CAST(:clip_vec AS vector) ELSE clip_vector END,
                entity_count   = :entity_count,
                layer_count    = :layer_count,
                layers         = CAST(:layers AS jsonb),
                entity_types   = CAST(:entity_types AS jsonb),
                bbox_width     = :bbox_width,
                bbox_height    = :bbox_height,
                bbox_area      = :bbox_area,
                svg_preview    = :svg,
                jpg_preview    = :jpg,
                file_data      = CASE WHEN :file_data IS NOT NULL THEN :file_data ELSE file_data END,
                content_hash   = COALESCE(:content_hash, content_hash),
                geometry_hash  = :geometry_hash,
                category_id    = :cat,
                indexed_at     = NOW()
            WHERE filepath = :fp
        """), params)
        file_id = int(existing.id)
        status = "updated"
    else:
        inserted = db.execute(text("""
            INSERT INTO cad_files
                (filename, filepath, file_format, feature_vector, clip_vector,
                 entity_count, layer_count, layers, entity_types,
                 bbox_width, bbox_height, bbox_area, svg_preview, jpg_preview, file_data,
                 content_hash, geometry_hash, category_id)
            VALUES
                (:filename, :fp, :fmt, CAST(:vec AS vector),
                 CASE WHEN :clip_vec IS NOT NULL THEN CAST(:clip_vec AS vector) ELSE NULL END,
                 :entity_count, :layer_count, CAST(:layers AS jsonb), CAST(:entity_types AS jsonb),
                 :bbox_width, :bbox_height, :bbox_area, :svg, :jpg, :file_data,
                 :content_hash, :geometry_hash, :cat)
            RETURNING id
        """), {**params, "filename": filename, "fmt": ext})
        file_id = int(inserted.fetchone().id)
        status = "indexed"

    duplicate = update_duplicate_relationships(
        db,
        file_id=file_id,
        filename=filename,
        content_hash=content_hash,
        geometry_hash=geometry_hash,
        feature_vector=str(vec.tolist()),
    )
    return {
        "status": status,
        "file_id": file_id,
        "content_hash": content_hash,
        "geometry_hash": geometry_hash,
        **duplicate,
    }


def _unique_stored_path(base_path: str, db) -> str:
    """Aynı filepath varsa _2, _3 ekleyerek benzersiz yol üret."""
    if not db.execute(text("SELECT id FROM cad_files WHERE filepath = :fp"), {"fp": base_path}).fetchone():
        return base_path
    root, ext = os.path.splitext(base_path)
    counter = 2
    while True:
        candidate = f"{root}_{counter}{ext}"
        if not db.execute(text("SELECT id FROM cad_files WHERE filepath = :fp"), {"fp": candidate}).fetchone():
            return candidate
        counter += 1


@router.post("/index")
async def index_file(
    file: UploadFile = File(...),
    filepath: str = Query(default=""),
    category_id: Optional[int] = Query(default=None),
    skip_clip: bool = Query(default=False, description="CLIP vektörü atla (hızlı indexleme için)"),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Tek bir DXF/DWG/PDF dosyasını indexle."""
    apply_tenant_schema(tenant, db)
    content = await file.read()

    if len(content) > MAX_SINGLE_BYTES:
        raise HTTPException(status_code=413,
            detail=f"Dosya çok büyük. Maksimum {MAX_SINGLE_FILE_MB} MB.")

    filename = file.filename or "unknown.dxf"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "dxf"
    stored_path = filepath or f"/uploads/{tenant['schema_name']}/{filename}"

    try:
        data = parse_dxf_bytes(content, filename)
    except UnsupportedDWGVersionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if data is None:
        raise HTTPException(
            status_code=_parse_error_status(ext),
            detail=_parse_error_detail(filename, ext),
        )

    result = _upsert_file(db, stored_path, filename, ext, data, category_id, skip_clip=skip_clip, raw_bytes=content)
    log_activity(db, "upload", tenant.get("email", ""), filename=filename)
    if skip_clip and result.get("file_id"):
        enqueue_clip_backfill(
            db,
            schema_name=tenant["schema_name"],
            user_email=tenant.get("email", ""),
            file_ids=[result["file_id"]],
        )
    db.commit()
    return {"status": result["status"], "filename": filename, **result}


@router.post("/index/bulk")
async def bulk_index(
    files: List[UploadFile] = File(...),
    category_id: Optional[int] = Query(default=None),
    skip_clip: bool = Query(default=True, description="Bulk upload'da CLIP varsayılan olarak atlanır"),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """
    Çoklu dosya yükle ve indexle.
    skip_clip=True (varsayılan): sadece geometric vektör → çok daha hızlı.
    """
    apply_tenant_schema(tenant, db)
    results = {"total": len(files), "success": 0, "failed": 0, "errors": []}

    for upload in files:
        filename = upload.filename or "unknown.dxf"
        try:
            content = await upload.read()

            if len(content) > MAX_SINGLE_BYTES:
                raise ValueError(f"Dosya çok büyük (maks {MAX_SINGLE_FILE_MB} MB)")

            ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "dxf"
            base_path = f"/uploads/{tenant['schema_name']}/{filename}"
            stored_path = _unique_stored_path(base_path, db)

            try:
                data = parse_dxf_bytes(content, filename)
            except UnsupportedDWGVersionError as e:
                raise ValueError(str(e))
            if data is None:
                raise ValueError(_parse_error_detail(filename, ext))

            result = _upsert_file(db, stored_path, filename, ext, data, category_id, skip_clip=skip_clip, raw_bytes=content)
            log_activity(db, "upload", tenant.get("email", ""), filename=filename)
            if skip_clip and result.get("file_id"):
                enqueue_clip_backfill(
                    db,
                    schema_name=tenant["schema_name"],
                    user_email=tenant.get("email", ""),
                    file_ids=[result["file_id"]],
                )
            db.commit()
            results["success"] += 1
        except Exception as e:
            db.rollback()
            results["failed"] += 1
            results["errors"].append({"filename": filename, "reason": str(e)})

    return results


def _iter_archive(content: bytes, filename: str):
    """
    ZIP veya RAR arşivinden (name, bytes) ikililerini yield eder.
    Sadece DWG/DXF/PDF dosyaları döner.
    """
    ext = filename.lower().rsplit(".", 1)[-1]
    CAD_EXTS = {"dwg", "dxf", "pdf", "jpg", "jpeg", "png"}

    def _entry_basename(path: str) -> str:
        # Bazı arşivler Windows ayıracı (\) ile gelir; normalize edip sadece dosya adını al.
        normalized = path.replace("\\", "/").strip("/")
        return normalized.split("/")[-1] if normalized else ""

    if ext == "zip":
        if not zipfile.is_zipfile(io.BytesIO(content)):
            raise ValueError("Geçerli bir ZIP dosyası değil.")
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for name in zf.namelist():
                if name.endswith("/"):
                    continue
                if name.lower().rsplit(".", 1)[-1] in CAD_EXTS:
                    base_name = _entry_basename(name)
                    if base_name:
                        yield base_name, zf.read(name)

    elif ext == "rar":
        if not _configure_rar_tooling():
            raise ValueError("RAR desteği sunucuda kurulu değil (unrar gerekli).")
        tmp_rar_path = None
        try:
            # rarfile bazı RAR sürümlerinde file-like stream ile sorun yaşayabiliyor.
            # Bu yüzden içeriği geçici dosyaya yazıp dosya yolu üzerinden açıyoruz.
            with tempfile.NamedTemporaryFile(delete=False, suffix=".rar") as tmp:
                tmp.write(content)
                tmp_rar_path = tmp.name

            with rarfile.RarFile(tmp_rar_path) as rf:
                for info in rf.infolist():
                    if info.is_dir():
                        continue
                    if info.filename.lower().rsplit(".", 1)[-1] in CAD_EXTS:
                        base_name = _entry_basename(info.filename)
                        if base_name:
                            yield base_name, rf.read(info)
        except rarfile.Error as e:
            raise ValueError(f"RAR arşivi okunamadı: {e}")
        finally:
            if tmp_rar_path and os.path.exists(tmp_rar_path):
                try:
                    os.remove(tmp_rar_path)
                except OSError as _e:
                    _log.warning("Geçici RAR dosyası silinemedi (%s): %s", tmp_rar_path, _e)
    else:
        raise ValueError(f"Desteklenmeyen arşiv formatı: .{ext} (ZIP veya RAR bekleniyor)")


def _list_archive_entries(content: bytes, filename: str):
    """
    ZIP veya RAR arşivinden CAD dosya listesini çıkar.
    Yalnızca metadata döner (dosya adları + boyut), içerik okumaz.
    """
    ext = filename.lower().rsplit(".", 1)[-1]
    CAD_EXTS = {"dwg", "dxf", "pdf", "jpg", "jpeg", "png"}

    def _entry_basename(path: str) -> str:
        normalized = path.replace("\\", "/").strip("/")
        return normalized.split("/")[-1] if normalized else ""

    entries = []

    if ext == "zip":
        if not zipfile.is_zipfile(io.BytesIO(content)):
            raise ValueError("Geçerli bir ZIP dosyası değil.")
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                raw_name = info.filename
                file_ext = raw_name.lower().rsplit(".", 1)[-1] if "." in raw_name else ""
                if file_ext not in CAD_EXTS:
                    continue
                base_name = _entry_basename(raw_name)
                if not base_name:
                    continue
                entries.append({
                    "name": base_name,
                    "ext": file_ext,
                    "size": int(info.file_size or 0),
                })
    elif ext == "rar":
        if not _configure_rar_tooling():
            raise ValueError("RAR desteği sunucuda kurulu değil (unrar gerekli).")
        tmp_rar_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".rar") as tmp:
                tmp.write(content)
                tmp_rar_path = tmp.name

            with rarfile.RarFile(tmp_rar_path) as rf:
                for info in rf.infolist():
                    if info.is_dir():
                        continue
                    raw_name = info.filename
                    file_ext = raw_name.lower().rsplit(".", 1)[-1] if "." in raw_name else ""
                    if file_ext not in CAD_EXTS:
                        continue
                    base_name = _entry_basename(raw_name)
                    if not base_name:
                        continue
                    entries.append({
                        "name": base_name,
                        "ext": file_ext,
                        "size": int(info.file_size or 0),
                    })
        except rarfile.Error as e:
            raise ValueError(f"RAR arşivi okunamadı: {e}")
        finally:
            if tmp_rar_path and os.path.exists(tmp_rar_path):
                try:
                    os.remove(tmp_rar_path)
                except OSError as _e:
                    _log.warning("Geçici RAR dosyası silinemedi (%s): %s", tmp_rar_path, _e)
    else:
        raise ValueError(f"Desteklenmeyen arşiv formatı: .{ext} (ZIP veya RAR bekleniyor)")

    return entries


@router.post("/index/archive/preview")
async def preview_archive(
    file: UploadFile = File(...),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """
    ZIP/RAR içindeki desteklenen CAD dosyalarını indexleme yapmadan listeler.
    Frontend yükleme önizlemesi için kullanılır.
    """
    apply_tenant_schema(tenant, db)
    content = await file.read()
    upload_filename = file.filename or "archive.zip"

    if len(content) > MAX_ZIP_BYTES:
        raise HTTPException(status_code=413,
            detail=f"Arşiv çok büyük. Maksimum {MAX_ZIP_FILE_MB} MB.")

    try:
        entries = _list_archive_entries(content, upload_filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "archive": upload_filename,
        "total": len(entries),
        "entries": entries,
    }


@router.post("/index/bulk-zip")
async def bulk_index_zip(
    file: UploadFile = File(...),
    category_id: Optional[int] = Query(default=None),
    skip_clip: bool = Query(default=True, description="Bulk upload'da CLIP varsayılan olarak atlanır"),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """
    ZIP veya RAR arşivi yükle → içindeki DWG/DXF/PDF dosyalarını indexle.
    İç içe klasörler desteklenir; aynı adlı dosyalar otomatik yeniden adlandırılır.
    """
    apply_tenant_schema(tenant, db)

    content = await file.read()
    upload_filename = file.filename or "archive.zip"

    if len(content) > MAX_ZIP_BYTES:
        raise HTTPException(status_code=413,
            detail=f"Arşiv çok büyük. Maksimum {MAX_ZIP_FILE_MB} MB.")

    results = {"total": 0, "success": 0, "failed": 0, "errors": []}

    try:
        entries = list(_iter_archive(content, upload_filename))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    results["total"] = len(entries)

    for filename, file_bytes in entries:
        ext = filename.lower().rsplit(".", 1)[-1]
        base_path = f"/uploads/{tenant['schema_name']}/{filename}"
        stored_path = _unique_stored_path(base_path, db)
        try:
            if len(file_bytes) > MAX_SINGLE_BYTES:
                raise ValueError(f"Dosya çok büyük (maks {MAX_SINGLE_FILE_MB} MB)")

            try:
                data = parse_dxf_bytes(file_bytes, filename)
            except UnsupportedDWGVersionError as e:
                raise ValueError(str(e))
            if data is None:
                raise ValueError(_parse_error_detail(filename, ext))

            result = _upsert_file(db, stored_path, filename, ext, data, category_id, skip_clip=skip_clip, raw_bytes=file_bytes)
            log_activity(db, "upload", tenant.get("email", ""), filename=filename)
            if skip_clip and result.get("file_id"):
                enqueue_clip_backfill(
                    db,
                    schema_name=tenant["schema_name"],
                    user_email=tenant.get("email", ""),
                    file_ids=[result["file_id"]],
                )
            db.commit()
            results["success"] += 1
        except Exception as e:
            db.rollback()
            results["failed"] += 1
            results["errors"].append({"filename": filename, "reason": str(e)})

    return results
