"""
activity.py — Activity log endpoint'leri
Kim dosya yukledi, kim draft/approved yaptı — sadece bu aksiyonlar loglanır.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(tags=["activity"])


def log_activity(db: Session, action: str, user_email: str,
                 filename: str = None, file_id: int = None, details: str = None):
    """Yardimci: activity_log tablosuna kayit ekler."""
    db.execute(text("""
        INSERT INTO activity_log (action, filename, file_id, user_email, details)
        VALUES (:action, :filename, :file_id, :user_email, :details)
    """), {
        "action": action,
        "filename": filename,
        "file_id": file_id,
        "user_email": user_email,
        "details": details,
    })


@router.get("/activity")
def get_activity(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)

    rows = db.execute(text("""
        SELECT id, action, filename, file_id, user_email, details, created_at
        FROM activity_log
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
    """), {"limit": limit, "offset": offset}).fetchall()

    total = db.execute(text("SELECT COUNT(*) FROM activity_log")).scalar() or 0

    return {
        "items": [
            {
                "id": r.id,
                "action": r.action,
                "filename": r.filename,
                "file_id": r.file_id,
                "user_email": r.user_email,
                "details": r.details,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "total": total,
    }
