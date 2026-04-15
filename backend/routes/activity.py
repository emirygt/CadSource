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


def _ensure_activity_log_table(db: Session) -> None:
    """Aktif schema içinde activity_log tablosunu garanti eder."""
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS activity_log (
            id          SERIAL PRIMARY KEY,
            action      VARCHAR(50) NOT NULL,
            filename    VARCHAR,
            file_id     INTEGER,
            user_email  VARCHAR,
            details     VARCHAR,
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """))


def log_activity(db: Session, action: str, user_email: str,
                 filename: str = None, file_id: int = None, details: str = None):
    """
    Yardımcı: activity_log tablosuna kayıt ekler.
    Log başarısız olursa ana işlemi (upload/search vb.) bozmaz.
    """
    try:
        with db.begin_nested():
            _ensure_activity_log_table(db)
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
    except Exception as e:
        print(f"[activity_log] kayıt atılamadı (ana işlem devam ediyor): {e}")


@router.get("/activity")
def get_activity(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    try:
        _ensure_activity_log_table(db)
    except Exception:
        # Log tablosu oluşturulamazsa endpoint boş liste dönsün.
        return {"items": [], "total": 0}

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
