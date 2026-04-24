"""
job_service.py - PostgreSQL backed background job helpers.

Jobs live in public schema so one worker can coordinate work for every tenant.
Each job still carries a schema_name, and workers switch search_path before
touching tenant data.
"""
from __future__ import annotations

import json
from typing import Any, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}


def json_dumps(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False)


def json_loads(value: Any) -> Any:
    if value is None:
        return {}
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return {}


def ensure_job_tables(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.jobs (
            id              SERIAL PRIMARY KEY,
            schema_name     VARCHAR NOT NULL,
            user_email      VARCHAR DEFAULT '',
            type            VARCHAR(50) NOT NULL,
            status          VARCHAR(20) NOT NULL DEFAULT 'queued',
            priority        INTEGER NOT NULL DEFAULT 100,
            total_items     INTEGER NOT NULL DEFAULT 0,
            processed_items INTEGER NOT NULL DEFAULT 0,
            succeeded_items INTEGER NOT NULL DEFAULT 0,
            failed_items    INTEGER NOT NULL DEFAULT 0,
            payload         JSONB DEFAULT '{}'::jsonb,
            result          JSONB DEFAULT '{}'::jsonb,
            error           TEXT,
            created_at      TIMESTAMP DEFAULT NOW(),
            started_at      TIMESTAMP,
            finished_at     TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.job_items (
            id          SERIAL PRIMARY KEY,
            job_id      INTEGER NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
            item_index  INTEGER NOT NULL DEFAULT 0,
            file_id     INTEGER,
            filename    VARCHAR,
            status      VARCHAR(20) NOT NULL DEFAULT 'queued',
            action      VARCHAR(50),
            message     TEXT,
            result      JSONB DEFAULT '{}'::jsonb,
            created_at  TIMESTAMP DEFAULT NOW(),
            started_at  TIMESTAMP,
            finished_at TIMESTAMP
        )
    """))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS public.job_payloads (
            id           SERIAL PRIMARY KEY,
            job_id       INTEGER NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
            item_index   INTEGER NOT NULL DEFAULT 0,
            filename     VARCHAR NOT NULL,
            content_type VARCHAR,
            file_size    INTEGER NOT NULL DEFAULT 0,
            data         BYTEA NOT NULL,
            created_at   TIMESTAMP DEFAULT NOW()
        )
    """))
    db.execute(text("CREATE INDEX IF NOT EXISTS jobs_pick_idx ON public.jobs (status, priority, created_at)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS jobs_schema_idx ON public.jobs (schema_name, created_at DESC)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS job_items_job_idx ON public.job_items (job_id, item_index)"))
    db.commit()


def create_job(
    db: Session,
    *,
    schema_name: str,
    user_email: str,
    job_type: str,
    payload: Optional[dict] = None,
    total_items: int = 0,
    priority: int = 100,
) -> int:
    ensure_job_tables(db)
    row = db.execute(text("""
        INSERT INTO public.jobs (schema_name, user_email, type, payload, total_items, priority)
        VALUES (:schema_name, :user_email, :type, CAST(:payload AS jsonb), :total_items, :priority)
        RETURNING id
    """), {
        "schema_name": schema_name,
        "user_email": user_email or "",
        "type": job_type,
        "payload": json_dumps(payload),
        "total_items": int(total_items or 0),
        "priority": int(priority),
    }).fetchone()
    db.commit()
    return int(row.id)


def add_job_item(
    db: Session,
    *,
    job_id: int,
    item_index: int,
    filename: Optional[str] = None,
    file_id: Optional[int] = None,
    action: Optional[str] = None,
    status: str = "queued",
    message: Optional[str] = None,
    result: Optional[dict] = None,
) -> int:
    row = db.execute(text("""
        INSERT INTO public.job_items
            (job_id, item_index, file_id, filename, status, action, message, result)
        VALUES
            (:job_id, :item_index, :file_id, :filename, :status, :action, :message, CAST(:result AS jsonb))
        RETURNING id
    """), {
        "job_id": int(job_id),
        "item_index": int(item_index),
        "file_id": file_id,
        "filename": filename,
        "status": status,
        "action": action,
        "message": message,
        "result": json_dumps(result),
    }).fetchone()
    db.commit()
    return int(row.id)


def add_job_payload(
    db: Session,
    *,
    job_id: int,
    item_index: int,
    filename: str,
    content_type: Optional[str],
    data: bytes,
) -> int:
    row = db.execute(text("""
        INSERT INTO public.job_payloads (job_id, item_index, filename, content_type, file_size, data)
        VALUES (:job_id, :item_index, :filename, :content_type, :file_size, :data)
        RETURNING id
    """), {
        "job_id": int(job_id),
        "item_index": int(item_index),
        "filename": filename,
        "content_type": content_type,
        "file_size": len(data or b""),
        "data": data,
    }).fetchone()
    db.commit()
    return int(row.id)


def enqueue_clip_backfill(
    db: Session,
    *,
    schema_name: str,
    user_email: str,
    file_ids: Optional[Iterable[int]] = None,
    priority: int = 180,
) -> Optional[int]:
    ensure_job_tables(db)
    payload = {"file_ids": [int(x) for x in (file_ids or []) if int(x) > 0]}
    total_items = len(payload["file_ids"])
    job_id = create_job(
        db,
        schema_name=schema_name,
        user_email=user_email,
        job_type="clip_backfill",
        payload=payload,
        total_items=total_items,
        priority=priority,
    )
    for idx, file_id in enumerate(payload["file_ids"]):
        add_job_item(db, job_id=job_id, item_index=idx, file_id=file_id, action="clip_backfill")
    return job_id
