"""
jobs.py - background job API.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from middleware.tenant import apply_tenant_schema, get_current_tenant
from routes.index import (
    MAX_SINGLE_BYTES,
    MAX_SINGLE_FILE_MB,
    MAX_ZIP_BYTES,
    MAX_ZIP_FILE_MB,
    _list_archive_entries,
)
from services.job_service import (
    add_job_item,
    add_job_payload,
    create_job,
    ensure_job_tables,
    json_loads,
)

router = APIRouter(prefix="/jobs", tags=["jobs"])


class FileIdsPayload(BaseModel):
    file_ids: Optional[List[int]] = None


def _row_to_job(row) -> dict:
    m = row._mapping
    total = int(m["total_items"] or 0)
    processed = int(m["processed_items"] or 0)
    return {
        "id": m["id"],
        "schema_name": m["schema_name"],
        "user_email": m["user_email"],
        "type": m["type"],
        "status": m["status"],
        "priority": m["priority"],
        "total_items": total,
        "processed_items": processed,
        "succeeded_items": int(m["succeeded_items"] or 0),
        "failed_items": int(m["failed_items"] or 0),
        "progress": round((processed / total) * 100, 1) if total else (100.0 if m["status"] in ("succeeded", "failed", "cancelled") else 0.0),
        "payload": json_loads(m["payload"]),
        "result": json_loads(m["result"]),
        "error": m["error"],
        "created_at": m["created_at"].isoformat() if m["created_at"] else None,
        "started_at": m["started_at"].isoformat() if m["started_at"] else None,
        "finished_at": m["finished_at"].isoformat() if m["finished_at"] else None,
        "updated_at": m["updated_at"].isoformat() if m["updated_at"] else None,
    }


def _row_to_item(row) -> dict:
    m = row._mapping
    return {
        "id": m["id"],
        "job_id": m["job_id"],
        "item_index": m["item_index"],
        "file_id": m["file_id"],
        "filename": m["filename"],
        "status": m["status"],
        "action": m["action"],
        "message": m["message"],
        "result": json_loads(m["result"]),
        "created_at": m["created_at"].isoformat() if m["created_at"] else None,
        "started_at": m["started_at"].isoformat() if m["started_at"] else None,
        "finished_at": m["finished_at"].isoformat() if m["finished_at"] else None,
    }


@router.get("")
def list_jobs(
    status: Optional[str] = Query(default=None),
    type: Optional[str] = Query(default=None),
    file_id: Optional[int] = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    ensure_job_tables(db)
    params: dict = {"schema_name": tenant["schema_name"], "offset": (page - 1) * per_page, "limit": per_page}
    if file_id:
        clauses = ["j.schema_name = :schema_name"]
        if status:
            clauses.append("j.status = :status")
            params["status"] = status
        if type:
            clauses.append("j.type = :type")
            params["type"] = type
        params["file_id"] = file_id
        where = " AND ".join(clauses)
        total = db.execute(text(f"""
            SELECT COUNT(DISTINCT j.id) FROM public.jobs j
            JOIN public.job_items ji ON ji.job_id = j.id
            WHERE {where} AND ji.file_id = :file_id
        """), params).scalar() or 0
        rows = db.execute(text(f"""
            SELECT DISTINCT ON (j.id) j.* FROM public.jobs j
            JOIN public.job_items ji ON ji.job_id = j.id
            WHERE {where} AND ji.file_id = :file_id
            ORDER BY j.id DESC
            OFFSET :offset LIMIT :limit
        """), params).fetchall()
    else:
        clauses = ["schema_name = :schema_name"]
        if status:
            clauses.append("status = :status")
            params["status"] = status
        if type:
            clauses.append("type = :type")
            params["type"] = type
        where = " AND ".join(clauses)
        total = db.execute(text(f"SELECT COUNT(*) FROM public.jobs WHERE {where}"), params).scalar() or 0
        rows = db.execute(text(f"""
            SELECT * FROM public.jobs
            WHERE {where}
            ORDER BY created_at DESC
            OFFSET :offset LIMIT :limit
        """), params).fetchall()
    return {"total": int(total), "page": page, "per_page": per_page, "jobs": [_row_to_job(r) for r in rows]}


@router.get("/{job_id}")
def get_job(
    job_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    ensure_job_tables(db)
    row = db.execute(text("""
        SELECT * FROM public.jobs
        WHERE id = :id AND schema_name = :schema_name
    """), {"id": job_id, "schema_name": tenant["schema_name"]}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job bulunamadı")
    items = db.execute(text("""
        SELECT * FROM public.job_items
        WHERE job_id = :id
        ORDER BY item_index, id
        LIMIT 500
    """), {"id": job_id}).fetchall()
    return {"job": _row_to_job(row), "items": [_row_to_item(r) for r in items]}


@router.post("/{job_id}/cancel")
def cancel_job(
    job_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    ensure_job_tables(db)
    row = db.execute(text("""
        UPDATE public.jobs
        SET status = 'cancelled', finished_at = NOW(), updated_at = NOW()
        WHERE id = :id
          AND schema_name = :schema_name
          AND status IN ('queued', 'running')
        RETURNING id
    """), {"id": job_id, "schema_name": tenant["schema_name"]}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="İptal edilebilir job bulunamadı")
    db.execute(text("""
        UPDATE public.job_items
        SET status = 'cancelled', finished_at = NOW(), message = COALESCE(message, 'cancelled')
        WHERE job_id = :id AND status IN ('queued', 'running')
    """), {"id": job_id})
    db.execute(text("DELETE FROM public.job_payloads WHERE job_id = :id"), {"id": job_id})
    db.commit()
    return {"status": "cancelled", "job_id": job_id}


@router.post("/{job_id}/retry-failed")
def retry_failed_items(
    job_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Başarısız item'ları yeni bir reindex job'ı olarak yeniden kuyruğa al."""
    ensure_job_tables(db)
    apply_tenant_schema(tenant, db)
    job_row = db.execute(text("""
        SELECT * FROM public.jobs
        WHERE id = :id AND schema_name = :schema_name
    """), {"id": job_id, "schema_name": tenant["schema_name"]}).fetchone()
    if not job_row:
        raise HTTPException(status_code=404, detail="Job bulunamadı")
    failed_items = db.execute(text("""
        SELECT file_id, filename FROM public.job_items
        WHERE job_id = :job_id AND status = 'failed' AND file_id IS NOT NULL
    """), {"job_id": job_id}).fetchall()
    if not failed_items:
        raise HTTPException(status_code=400, detail="Yeniden denenecek başarısız item yok")
    file_ids = [r._mapping["file_id"] for r in failed_items]
    new_job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="reindex",
        payload={"file_ids": file_ids, "skip_clip": False, "retry_of": job_id},
        total_items=len(file_ids),
        priority=85,
    )
    for i, fid in enumerate(file_ids):
        add_job_item(db, job_id=new_job_id, item_index=i, file_id=fid, action="reindex")
    return {"job_id": new_job_id, "status": "queued", "total_items": len(file_ids)}


@router.post("/gen-missing-preview")
def enqueue_gen_preview_job(
    payload: Optional[FileIdsPayload] = Body(default=None),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """jpg_preview eksik olan dosyalar için preview üret."""
    apply_tenant_schema(tenant, db)
    payload = payload or FileIdsPayload()
    file_ids = sorted({int(x) for x in (payload.file_ids or []) if int(x) > 0})
    if file_ids:
        total = len(file_ids)
    else:
        total = db.execute(text(
            "SELECT COUNT(*) FROM cad_files WHERE jpg_preview IS NULL AND file_data IS NOT NULL"
        )).scalar() or 0
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="gen_preview",
        payload={"file_ids": file_ids},
        total_items=int(total),
        priority=150,
    )
    for i, fid in enumerate(file_ids):
        add_job_item(db, job_id=job_id, item_index=i, file_id=fid, action="gen_preview")
    return {"job_id": job_id, "status": "queued", "total_items": int(total)}


@router.post("/check-file-data")
def enqueue_check_file_data_job(
    payload: Optional[FileIdsPayload] = Body(default=None),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """file_data alanını doğrula, bozuk dosyaları raporla."""
    apply_tenant_schema(tenant, db)
    payload = payload or FileIdsPayload()
    file_ids = sorted({int(x) for x in (payload.file_ids or []) if int(x) > 0})
    if file_ids:
        total = len(file_ids)
    else:
        total = db.execute(text(
            "SELECT COUNT(*) FROM cad_files WHERE file_data IS NOT NULL"
        )).scalar() or 0
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="check_file_data",
        payload={"file_ids": file_ids},
        total_items=int(total),
        priority=200,
    )
    for i, fid in enumerate(file_ids):
        add_job_item(db, job_id=job_id, item_index=i, file_id=fid, action="check_file_data")
    return {"job_id": job_id, "status": "queued", "total_items": int(total)}


@router.post("/duplicate-rescan")
def enqueue_duplicate_rescan_job(
    payload: Optional[FileIdsPayload] = Body(default=None),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Duplicate ilişkilerini tüm/seçili dosyalar için yeniden hesapla."""
    apply_tenant_schema(tenant, db)
    payload = payload or FileIdsPayload()
    file_ids = sorted({int(x) for x in (payload.file_ids or []) if int(x) > 0})
    if file_ids:
        total = len(file_ids)
    else:
        total = db.execute(text("SELECT COUNT(*) FROM cad_files")).scalar() or 0
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="duplicate_rescan",
        payload={"file_ids": file_ids},
        total_items=int(total),
        priority=170,
    )
    for i, fid in enumerate(file_ids):
        add_job_item(db, job_id=job_id, item_index=i, file_id=fid, action="duplicate_rescan")
    return {"job_id": job_id, "status": "queued", "total_items": int(total)}


@router.post("/cleanup-payloads")
def enqueue_cleanup_payloads_job(
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """7 günden eski job payload'larını temizle."""
    ensure_job_tables(db)
    total = db.execute(text("""
        SELECT COUNT(*) FROM public.job_payloads jp
        JOIN public.jobs j ON j.id = jp.job_id
        WHERE j.schema_name = :schema_name
          AND j.finished_at < NOW() - INTERVAL '7 days'
    """), {"schema_name": tenant["schema_name"]}).scalar() or 0
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="cleanup_payloads",
        payload={},
        total_items=int(total),
        priority=250,
    )
    return {"job_id": job_id, "status": "queued", "total_items": int(total)}


@router.post("/report-broken")
def enqueue_report_broken_job(
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Hatalı veya eksik feature_vector'u olan dosyaları raporla."""
    apply_tenant_schema(tenant, db)
    total = db.execute(text("""
        SELECT COUNT(*) FROM cad_files
        WHERE approval_status = 'error' OR feature_vector IS NULL
    """)).scalar() or 0
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="report_broken",
        payload={},
        total_items=int(total),
        priority=240,
    )
    return {"job_id": job_id, "status": "queued", "total_items": int(total)}


@router.post("/clip-backfill")
def enqueue_clip_backfill_job(
    payload: Optional[FileIdsPayload] = Body(default=None),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    payload = payload or FileIdsPayload()
    file_ids = sorted({int(x) for x in (payload.file_ids or []) if int(x) > 0})
    if file_ids:
        total = len(file_ids)
    else:
        total = db.execute(text("SELECT COUNT(*) FROM cad_files WHERE clip_vector IS NULL AND file_data IS NOT NULL")).scalar() or 0
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="clip_backfill",
        payload={"file_ids": file_ids},
        total_items=int(total),
        priority=180,
    )
    for i, fid in enumerate(file_ids):
        add_job_item(db, job_id=job_id, item_index=i, file_id=fid, action="clip_backfill")
    return {"job_id": job_id, "status": "queued", "total_items": int(total)}


@router.post("/reindex")
def enqueue_reindex_job(
    payload: FileIdsPayload,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    file_ids = sorted({int(x) for x in (payload.file_ids or []) if int(x) > 0})
    if not file_ids:
        raise HTTPException(status_code=400, detail="file_ids boş olamaz")
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="reindex",
        payload={"file_ids": file_ids, "skip_clip": False},
        total_items=len(file_ids),
        priority=90,
    )
    for i, fid in enumerate(file_ids):
        add_job_item(db, job_id=job_id, item_index=i, file_id=fid, action="reindex")
    return {"job_id": job_id, "status": "queued", "total_items": len(file_ids)}


@router.post("/upload")
async def enqueue_upload_job(
    files: List[UploadFile] = File(...),
    category_id: Optional[int] = Query(default=None),
    skip_clip: bool = Query(default=True),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=400, detail="Dosya seçilmedi")
    job_id = create_job(
        db,
        schema_name=tenant["schema_name"],
        user_email=tenant.get("email", ""),
        job_type="upload",
        payload={"category_id": category_id, "skip_clip": bool(skip_clip)},
        total_items=0,
        priority=80,
    )

    total_items = 0
    payload_index = 0
    for upload in files:
        filename = upload.filename or "unknown.dxf"
        content = await upload.read()
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        is_archive = ext in ("zip", "rar")
        if is_archive:
            if len(content) > MAX_ZIP_BYTES:
                raise HTTPException(status_code=413, detail=f"{filename}: arşiv çok büyük. Maksimum {MAX_ZIP_FILE_MB} MB.")
            try:
                entries = _list_archive_entries(content, filename)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=f"{filename}: {e}")
            add_job_payload(
                db,
                job_id=job_id,
                item_index=payload_index,
                filename=filename,
                content_type=upload.content_type,
                data=content,
            )
            for entry in entries:
                add_job_item(
                    db,
                    job_id=job_id,
                    item_index=total_items,
                    filename=entry["name"],
                    action="upload",
                    result={"archive": filename, "payload_index": payload_index, "entry_name": entry["name"]},
                )
                total_items += 1
        else:
            if len(content) > MAX_SINGLE_BYTES:
                raise HTTPException(status_code=413, detail=f"{filename}: dosya çok büyük. Maksimum {MAX_SINGLE_FILE_MB} MB.")
            add_job_payload(
                db,
                job_id=job_id,
                item_index=payload_index,
                filename=filename,
                content_type=upload.content_type,
                data=content,
            )
            add_job_item(
                db,
                job_id=job_id,
                item_index=total_items,
                filename=filename,
                action="upload",
                result={"payload_index": payload_index},
            )
            total_items += 1
        payload_index += 1

    db.execute(text("""
        UPDATE public.jobs
        SET total_items = :total_items, updated_at = NOW()
        WHERE id = :job_id
    """), {"job_id": job_id, "total_items": total_items})
    db.commit()
    return {"job_id": job_id, "status": "queued", "total_items": total_items}
