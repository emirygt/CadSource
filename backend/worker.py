"""
worker.py - PostgreSQL-backed background worker for CAD-Search.

Run with PM2 as a separate process:
python worker.py
"""
from __future__ import annotations

import os
import signal
import time
from typing import Optional

from sqlalchemy import text

from db import SessionLocal, init_db
from middleware.tenant import apply_tenant_schema
from routes.index import (
    MAX_SINGLE_BYTES,
    _iter_archive,
    _parse_error_detail,
    _unique_stored_path,
    _upsert_file,
    parse_dxf_bytes,
)
from routes.activity import log_activity
from services.job_service import ensure_job_tables, json_dumps, json_loads


POLL_SECONDS = float(os.getenv("JOB_WORKER_POLL_SECONDS", "2"))
JOB_WORKER_BATCH_SIZE = int(os.getenv("JOB_WORKER_BATCH_SIZE", "50"))
STOP = False


def _handle_stop(_signum, _frame):
    global STOP
    STOP = True


signal.signal(signal.SIGTERM, _handle_stop)
signal.signal(signal.SIGINT, _handle_stop)


def claim_job(db):
    ensure_job_tables(db)
    row = db.execute(text("""
        UPDATE public.jobs
        SET status = 'running',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
        WHERE id = (
            SELECT id FROM public.jobs
            WHERE status = 'queued'
            ORDER BY priority ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING *
    """)).fetchone()
    db.commit()
    return row


def is_cancelled(db, job_id: int) -> bool:
    status = db.execute(text("SELECT status FROM public.jobs WHERE id = :id"), {"id": job_id}).scalar()
    return status == "cancelled"


def mark_job_done(db, job_id: int, status: str, result: Optional[dict] = None, error: Optional[str] = None):
    if status in ("succeeded", "failed", "cancelled"):
        db.execute(text("DELETE FROM public.job_payloads WHERE job_id = :id"), {"id": job_id})
    db.execute(text("""
        UPDATE public.jobs
        SET status = :status,
            result = CAST(:result AS jsonb),
            error = :error,
            finished_at = NOW(),
            updated_at = NOW()
        WHERE id = :id
    """), {"id": job_id, "status": status, "result": json_dumps(result), "error": error})
    db.commit()


def mark_item(db, job_id: int, item_index: int, status: str, message: str = "", file_id: Optional[int] = None, result: Optional[dict] = None):
    db.execute(text("""
        UPDATE public.job_items
        SET status = :status,
            message = :message,
            file_id = COALESCE(:file_id, file_id),
            result = CASE WHEN :result IS NULL THEN result ELSE CAST(:result AS jsonb) END,
            started_at = COALESCE(started_at, NOW()),
            finished_at = CASE WHEN :status IN ('succeeded', 'failed', 'cancelled') THEN NOW() ELSE finished_at END
        WHERE job_id = :job_id AND item_index = :item_index
    """), {
        "job_id": job_id,
        "item_index": item_index,
        "status": status,
        "message": message,
        "file_id": file_id,
        "result": json_dumps(result) if result is not None else None,
    })
    if status == "succeeded":
        db.execute(text("""
            UPDATE public.jobs
            SET processed_items = processed_items + 1,
                succeeded_items = succeeded_items + 1,
                updated_at = NOW()
            WHERE id = :job_id
        """), {"job_id": job_id})
    elif status == "failed":
        db.execute(text("""
            UPDATE public.jobs
            SET processed_items = processed_items + 1,
                failed_items = failed_items + 1,
                updated_at = NOW()
            WHERE id = :job_id
        """), {"job_id": job_id})
    db.commit()


def _process_one_file(db, schema_name: str, user_email: str, filename: str, content: bytes, category_id, skip_clip: bool):
    if len(content) > MAX_SINGLE_BYTES:
        raise ValueError("Dosya cok buyuk")
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "dxf"
    data = parse_dxf_bytes(content, filename)
    if data is None:
        raise ValueError(_parse_error_detail(filename, ext))
    base_path = f"/uploads/{schema_name}/{filename}"
    stored_path = _unique_stored_path(base_path, db)
    result = _upsert_file(
        db,
        stored_path,
        filename,
        ext,
        data,
        category_id,
        skip_clip=skip_clip,
        raw_bytes=content,
    )
    log_activity(db, "upload", user_email, filename=filename, file_id=result.get("file_id"), details="background job")
    db.commit()
    return result


def process_upload(db, job):
    payload = json_loads(job.payload)
    schema_name = job.schema_name
    user_email = job.user_email or ""
    category_id = payload.get("category_id")
    skip_clip = bool(payload.get("skip_clip", True))
    apply_tenant_schema({"schema_name": schema_name}, db)

    payload_rows = db.execute(text("""
        SELECT item_index, filename, data
        FROM public.job_payloads
        WHERE job_id = :job_id
        ORDER BY item_index
    """), {"job_id": job.id}).fetchall()

    succeeded_file_ids = []
    item_index = 0
    for payload_row in payload_rows:
        if is_cancelled(db, job.id):
            return {"cancelled": True, "file_ids": succeeded_file_ids}
        filename = payload_row.filename
        content = bytes(payload_row.data)
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        if ext in ("zip", "rar"):
            try:
                entries = list(_iter_archive(content, filename))
            except Exception as e:
                mark_item(db, job.id, item_index, "failed", str(e))
                item_index += 1
                continue
            for entry_name, entry_bytes in entries:
                if is_cancelled(db, job.id):
                    return {"cancelled": True, "file_ids": succeeded_file_ids}
                mark_item(db, job.id, item_index, "running", "processing")
                try:
                    result = _process_one_file(db, schema_name, user_email, entry_name, entry_bytes, category_id, skip_clip)
                    succeeded_file_ids.append(result.get("file_id"))
                    mark_item(db, job.id, item_index, "succeeded", result["status"], result.get("file_id"), result)
                except Exception as e:
                    db.rollback()
                    mark_item(db, job.id, item_index, "failed", str(e))
                item_index += 1
        else:
            mark_item(db, job.id, item_index, "running", "processing")
            try:
                result = _process_one_file(db, schema_name, user_email, filename, content, category_id, skip_clip)
                succeeded_file_ids.append(result.get("file_id"))
                mark_item(db, job.id, item_index, "succeeded", result["status"], result.get("file_id"), result)
            except Exception as e:
                db.rollback()
                mark_item(db, job.id, item_index, "failed", str(e))
            item_index += 1

    db.execute(text("DELETE FROM public.job_payloads WHERE job_id = :job_id"), {"job_id": job.id})
    db.commit()

    succeeded_file_ids = [int(x) for x in succeeded_file_ids if x]
    if skip_clip and succeeded_file_ids:
        from services.job_service import create_job, add_job_item

        clip_job_id = create_job(
            db,
            schema_name=schema_name,
            user_email=user_email,
            job_type="clip_backfill",
            payload={"file_ids": succeeded_file_ids, "source_job_id": job.id},
            total_items=len(succeeded_file_ids),
            priority=180,
        )
        for idx, file_id in enumerate(succeeded_file_ids):
            add_job_item(db, job_id=clip_job_id, item_index=idx, file_id=file_id, action="clip_backfill")
    return {"file_ids": succeeded_file_ids}


def _rows_for_file_ids(db, file_ids):
    if file_ids:
        from sqlalchemy import bindparam

        stmt = text("""
            SELECT id, filename, filepath, file_format, category_id, file_data
            FROM cad_files
            WHERE id IN :ids AND file_data IS NOT NULL
            ORDER BY id
        """).bindparams(bindparam("ids", expanding=True))
        return db.execute(stmt, {"ids": file_ids}).fetchall()
    return db.execute(text("""
        SELECT id, filename, filepath, file_format, category_id, file_data
        FROM cad_files
        WHERE clip_vector IS NULL AND file_data IS NOT NULL
        ORDER BY indexed_at DESC
        LIMIT 500
    """)).fetchall()


def process_reindex_like(db, job, *, action: str):
    payload = json_loads(job.payload)
    schema_name = job.schema_name
    user_email = job.user_email or ""
    apply_tenant_schema({"schema_name": schema_name}, db)
    file_ids = [int(x) for x in payload.get("file_ids", []) if int(x) > 0]
    rows = _rows_for_file_ids(db, file_ids)
    if not file_ids:
        db.execute(text("UPDATE public.jobs SET total_items = :n WHERE id = :id"), {"n": len(rows), "id": job.id})
        db.commit()
        for idx, row in enumerate(rows):
            db.execute(text("""
                INSERT INTO public.job_items (job_id, item_index, file_id, filename, action)
                VALUES (:job_id, :idx, :file_id, :filename, :action)
            """), {
                "job_id": job.id,
                "idx": idx,
                "file_id": row.id,
                "filename": row.filename,
                "action": action,
            })
        db.commit()

    item_rows = db.execute(text("""
        SELECT file_id, item_index
        FROM public.job_items
        WHERE job_id = :job_id AND file_id IS NOT NULL
    """), {"job_id": job.id}).fetchall()
    item_index_by_file_id = {int(r.file_id): int(r.item_index) for r in item_rows}

    if file_ids:
        found_ids = {int(row.id) for row in rows}
        for missing_id in sorted(set(file_ids) - found_ids):
            item_index = item_index_by_file_id.get(missing_id)
            if item_index is not None:
                mark_item(db, job.id, item_index, "failed", "file not found or file_data missing", missing_id)

    processed = []
    for idx, row in enumerate(rows):
        item_index = item_index_by_file_id.get(int(row.id), idx)
        if is_cancelled(db, job.id):
            return {"cancelled": True, "file_ids": processed}
        mark_item(db, job.id, item_index, "running", "processing", row.id)
        try:
            raw = bytes(row.file_data)
            data = parse_dxf_bytes(raw, row.filename)
            if data is None:
                raise ValueError(_parse_error_detail(row.filename, row.file_format))
            result = _upsert_file(
                db,
                row.filepath,
                row.filename,
                row.file_format,
                data,
                row.category_id,
                skip_clip=False,
                raw_bytes=raw,
            )
            log_activity(db, action, user_email, filename=row.filename, file_id=row.id)
            db.commit()
            processed.append(row.id)
            mark_item(db, job.id, item_index, "succeeded", result["status"], row.id, result)
        except Exception as e:
            db.rollback()
            mark_item(db, job.id, item_index, "failed", str(e), row.id)
    return {"file_ids": processed}


def heartbeat(db, job_id: int):
    """Job'ın updated_at alanını güncelle (stuck job tespiti için)."""
    try:
        db.execute(text("UPDATE public.jobs SET updated_at=NOW() WHERE id=:id"), {"id": job_id})
        db.commit()
    except Exception:
        pass


def recover_stuck_jobs(db):
    """1 saatten uzun süre 'running' kalan job'ları failed olarak işaretle."""
    try:
        db.execute(text("""
            UPDATE public.jobs
            SET status='failed', error='Worker yeniden başlatıldı, job yarıda kesildi',
                finished_at=NOW(), updated_at=NOW()
            WHERE status='running' AND updated_at < NOW() - INTERVAL '1 hour'
        """))
        db.commit()
    except Exception:
        pass


def process_gen_preview(db, job):
    """jpg_preview eksik dosyalar için preview üret."""
    from routes.index import generate_jpg_preview_from_bytes as _gen_jpg
    apply_tenant_schema({"schema_name": job.schema_name}, db)
    payload = json_loads(job.payload) or {}
    file_ids = payload.get("file_ids") or []
    if file_ids:
        rows = db.execute(text(
            "SELECT id, filename, file_data, file_format FROM cad_files WHERE id = ANY(:ids)"
        ), {"ids": file_ids}).fetchall()
    else:
        rows = db.execute(text(
            "SELECT id, filename, file_data, file_format FROM cad_files WHERE jpg_preview IS NULL AND file_data IS NOT NULL LIMIT 5000"
        )).fetchall()
    processed = []
    for idx, row in enumerate(rows):
        if is_cancelled(db, job.id): return {"cancelled": True, "file_ids": processed}
        try:
            file_bytes = bytes(row.file_data)
            jpg_b64 = _gen_jpg(file_bytes, row.filename or "")
            if jpg_b64:
                db.execute(text("UPDATE cad_files SET jpg_preview=:p WHERE id=:id"), {"p": jpg_b64, "id": row.id})
                db.commit()
                mark_item(db, job.id, idx, "succeeded", "preview üretildi", row.id)
                processed.append(row.id)
            else:
                mark_item(db, job.id, idx, "failed", "preview üretilemedi", row.id)
        except Exception as e:
            db.rollback()
            mark_item(db, job.id, idx, "failed", str(e), row.id)
        heartbeat(db, job.id)
    return {"file_ids": processed}


def process_check_file_data(db, job):
    """file_data alanını doğrula, decode edilemeyen/boş olanları raporla."""
    apply_tenant_schema({"schema_name": job.schema_name}, db)
    payload = json_loads(job.payload) or {}
    file_ids = payload.get("file_ids") or []
    if file_ids:
        rows = db.execute(text(
            "SELECT id, filename, file_data FROM cad_files WHERE id = ANY(:ids)"
        ), {"ids": file_ids}).fetchall()
    else:
        rows = db.execute(text(
            "SELECT id, filename, file_data FROM cad_files WHERE file_data IS NOT NULL LIMIT 10000"
        )).fetchall()
    processed = []
    for idx, row in enumerate(rows):
        if is_cancelled(db, job.id): return {"cancelled": True, "file_ids": processed}
        try:
            data = bytes(row.file_data)
            if len(data) < 4:
                db.execute(text("UPDATE cad_files SET approval_status='error' WHERE id=:id"), {"id": row.id})
                db.commit()
                mark_item(db, job.id, idx, "failed", "file_data çok küçük veya boş", row.id)
            else:
                mark_item(db, job.id, idx, "succeeded", f"{len(data)} bytes OK", row.id)
                processed.append(row.id)
        except Exception as e:
            db.rollback()
            mark_item(db, job.id, idx, "failed", str(e), row.id)
        heartbeat(db, job.id)
    return {"file_ids": processed}


def process_duplicate_rescan(db, job):
    """Tüm/seçili dosyalar için duplicate ilişkilerini yeniden hesapla."""
    from services.duplicate_service import update_duplicate_relationships
    apply_tenant_schema({"schema_name": job.schema_name}, db)
    payload = json_loads(job.payload) or {}
    file_ids = payload.get("file_ids") or []
    if file_ids:
        rows = db.execute(text(
            "SELECT id FROM cad_files WHERE id = ANY(:ids)"
        ), {"ids": file_ids}).fetchall()
    else:
        rows = db.execute(text("SELECT id FROM cad_files")).fetchall()
    processed = []
    for idx, row in enumerate(rows):
        if is_cancelled(db, job.id): return {"cancelled": True, "file_ids": processed}
        try:
            update_duplicate_relationships(db, row.id, job.schema_name)
            mark_item(db, job.id, idx, "succeeded", "duplicate ilişkileri güncellendi", row.id)
            processed.append(row.id)
        except Exception as e:
            db.rollback()
            mark_item(db, job.id, idx, "failed", str(e), row.id)
        if idx % 10 == 0:
            heartbeat(db, job.id)
    return {"file_ids": processed}


def process_cleanup_payloads(db, job):
    """7 günden eski job_payloads'ı temizle."""
    deleted = db.execute(text("""
        DELETE FROM public.job_payloads
        WHERE job_id IN (
            SELECT id FROM public.jobs
            WHERE schema_name = :schema AND finished_at < NOW() - INTERVAL '7 days'
        )
    """), {"schema": job.schema_name}).rowcount
    db.commit()
    mark_item(db, job.id, 0, "succeeded", f"{deleted} payload silindi")
    return {"deleted_count": deleted}


def process_report_broken(db, job):
    """Hatalı veya eksik feature_vector olan dosyaları işaretle."""
    apply_tenant_schema({"schema_name": job.schema_name}, db)
    rows = db.execute(text(
        "SELECT id, filename FROM cad_files WHERE approval_status='error' OR feature_vector IS NULL"
    )).fetchall()
    for idx, row in enumerate(rows):
        if is_cancelled(db, job.id): return {"cancelled": True}
        mark_item(db, job.id, idx, "failed", f"Bozuk dosya: {row.filename}", row.id)
    return {"broken_count": len(rows)}


def process_job(db, job):
    if job.type == "upload":
        return process_upload(db, job)
    if job.type == "clip_backfill":
        return process_reindex_like(db, job, action="clip_backfill")
    if job.type == "reindex":
        return process_reindex_like(db, job, action="reindex")
    if job.type == "gen_preview":
        return process_gen_preview(db, job)
    if job.type == "check_file_data":
        return process_check_file_data(db, job)
    if job.type == "duplicate_rescan":
        return process_duplicate_rescan(db, job)
    if job.type == "cleanup_payloads":
        return process_cleanup_payloads(db, job)
    if job.type == "report_broken":
        return process_report_broken(db, job)
    raise ValueError(f"Bilinmeyen job tipi: {job.type}")


def run_once() -> bool:
    with SessionLocal() as db:
        job = claim_job(db)
        if not job:
            return False
        try:
            result = process_job(db, job)
            if result.get("cancelled") or is_cancelled(db, job.id):
                mark_job_done(db, job.id, "cancelled", result=result)
                return True
            failed = db.execute(text("SELECT failed_items FROM public.jobs WHERE id = :id"), {"id": job.id}).scalar() or 0
            mark_job_done(db, job.id, "failed" if failed else "succeeded", result=result)
        except Exception as e:
            db.rollback()
            mark_job_done(db, job.id, "failed", error=str(e))
        return True


def main():
    init_db()
    with SessionLocal() as db:
        recover_stuck_jobs(db)
    print("CAD-Search worker hazir.")
    while not STOP:
        worked = run_once()
        if not worked:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
