"""
history.py — Arama geçmişi endpoint'leri
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(tags=["history"])


@router.get("/history")
def get_history(
    limit: int = Query(default=20, ge=1, le=100),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Son arama geçmişini döner (en yeni önce)."""
    apply_tenant_schema(tenant, db)

    rows = db.execute(
        text("""
            SELECT h.id, h.query_filename, h.top_k, h.min_similarity,
                   h.category_id, h.result_count, h.searched_at,
                   c.name AS category_name, c.color AS category_color
            FROM search_history h
            LEFT JOIN categories c ON c.id = h.category_id
            ORDER BY h.searched_at DESC
            LIMIT :limit
        """),
        {"limit": limit},
    ).fetchall()

    return [
        {
            "id": r.id,
            "query_filename": r.query_filename,
            "top_k": r.top_k,
            "min_similarity": r.min_similarity,
            "category_id": r.category_id,
            "category_name": r.category_name,
            "category_color": r.category_color,
            "result_count": r.result_count,
            "searched_at": r.searched_at.isoformat() if r.searched_at else None,
        }
        for r in rows
    ]


@router.delete("/history/{history_id}")
def delete_history_item(
    history_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Tek bir geçmiş kaydını sil."""
    apply_tenant_schema(tenant, db)
    db.execute(
        text("DELETE FROM search_history WHERE id = :id"),
        {"id": history_id},
    )
    db.commit()
    return {"status": "deleted", "id": history_id}


@router.delete("/history")
def clear_history(
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Tüm arama geçmişini temizle."""
    apply_tenant_schema(tenant, db)
    db.execute(text("DELETE FROM search_history"))
    db.commit()
    return {"status": "cleared"}
