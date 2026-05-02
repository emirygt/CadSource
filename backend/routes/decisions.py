"""
decisions.py — Karşılaştırma kararları endpoint'leri
"""
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(tags=["decisions"])


def _ensure_table(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS comparison_decisions (
            id                  SERIAL PRIMARY KEY,
            reference_filename  VARCHAR(512) NOT NULL,
            compared_file_id    INTEGER,
            compared_filename   VARCHAR(512) NOT NULL,
            similarity_score    REAL,
            decision_type       VARCHAR(50) NOT NULL,
            decision_label      VARCHAR(200) NOT NULL,
            notes               TEXT,
            decided_by          VARCHAR(255),
            decided_at          TIMESTAMPTZ DEFAULT NOW()
        )
    """))


class DecisionIn(BaseModel):
    reference_filename: str
    compared_file_id: Optional[int] = None
    compared_filename: str
    similarity_score: Optional[float] = None
    decision_type: str          # usable | substitute | reject
    decision_label: str
    notes: Optional[str] = None


@router.post("/decisions", status_code=201)
def create_decision(
    body: DecisionIn,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    try:
        _ensure_table(db)
    except Exception:
        pass

    row = db.execute(
        text("""
            INSERT INTO comparison_decisions
                (reference_filename, compared_file_id, compared_filename,
                 similarity_score, decision_type, decision_label, notes, decided_by)
            VALUES
                (:ref_fn, :cmp_id, :cmp_fn,
                 :sim, :dtype, :dlabel, :notes, :by)
            RETURNING id, decided_at
        """),
        {
            "ref_fn":  body.reference_filename,
            "cmp_id":  body.compared_file_id,
            "cmp_fn":  body.compared_filename,
            "sim":     body.similarity_score,
            "dtype":   body.decision_type,
            "dlabel":  body.decision_label,
            "notes":   body.notes,
            "by":      tenant.get("email", ""),
        },
    ).fetchone()
    db.commit()
    return {
        "id": row.id,
        "decided_at": row.decided_at.isoformat() if row.decided_at else None,
    }


@router.get("/decisions")
def list_decisions(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    decision_type: Optional[str] = Query(default=None),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    try:
        _ensure_table(db)
    except Exception:
        return {"total": 0, "items": []}

    where = "WHERE 1=1"
    params: dict = {"limit": limit, "offset": offset}
    if decision_type:
        where += " AND decision_type = :dtype"
        params["dtype"] = decision_type

    total = db.execute(
        text(f"SELECT COUNT(*) FROM comparison_decisions {where}"), params
    ).scalar()

    rows = db.execute(
        text(f"""
            SELECT d.id, d.reference_filename, d.compared_file_id,
                   d.compared_filename, d.similarity_score,
                   d.decision_type, d.decision_label, d.notes,
                   d.decided_by, d.decided_at,
                   f.jpg_preview
            FROM comparison_decisions d
            LEFT JOIN cad_files f ON f.id = d.compared_file_id
            {where}
            ORDER BY d.decided_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()

    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "reference_filename": r.reference_filename,
                "compared_file_id": r.compared_file_id,
                "compared_filename": r.compared_filename,
                "similarity_score": r.similarity_score,
                "decision_type": r.decision_type,
                "decision_label": r.decision_label,
                "notes": r.notes,
                "decided_by": r.decided_by,
                "decided_at": r.decided_at.isoformat() if r.decided_at else None,
                "jpg_preview": r.jpg_preview,
            }
            for r in rows
        ],
    }


@router.delete("/decisions/{decision_id}")
def delete_decision(
    decision_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    _ensure_table(db)
    result = db.execute(
        text("DELETE FROM comparison_decisions WHERE id = :id RETURNING id"),
        {"id": decision_id},
    ).fetchone()
    if not result:
        raise HTTPException(status_code=404, detail="Karar bulunamadı")
    db.commit()
    return {"status": "deleted", "id": decision_id}
