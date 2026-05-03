"""
requests.py — Talep (iş talebi) CRUD endpoint'leri
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(prefix="/requests", tags=["requests"])


class RequestIn(BaseModel):
    baslik: str
    aciklama: Optional[str] = None
    talep_tipi: Optional[str] = None
    oncelik: Optional[str] = "Orta"
    durum: Optional[str] = "Açık"
    talep_eden: Optional[str] = None
    atanan: Optional[str] = None
    son_tarih: Optional[str] = None
    notlar: Optional[str] = None


def _row(r) -> dict:
    return {
        "id":          r.id,
        "baslik":      r.baslik,
        "aciklama":    r.aciklama,
        "talep_tipi":  r.talep_tipi,
        "oncelik":     r.oncelik,
        "durum":       r.durum,
        "talep_eden":  r.talep_eden,
        "atanan":      r.atanan,
        "son_tarih":   r.son_tarih.isoformat() if r.son_tarih else None,
        "notlar":      r.notlar,
        "olusturulma": r.olusturulma.isoformat() if r.olusturulma else None,
        "guncelleme":  r.guncelleme.isoformat() if r.guncelleme else None,
    }


@router.get("")
def list_requests(
    durum: Optional[str] = Query(default=None),
    oncelik: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    where, params = ["1=1"], {"limit": limit, "offset": offset}

    if durum:
        where.append("durum = :durum"); params["durum"] = durum
    if oncelik:
        where.append("oncelik = :oncelik"); params["oncelik"] = oncelik
    if q:
        where.append("(baslik ILIKE :q OR talep_eden ILIKE :q)"); params["q"] = f"%{q}%"

    sql = f"SELECT * FROM talepler WHERE {' AND '.join(where)} ORDER BY olusturulma DESC LIMIT :limit OFFSET :offset"
    count_sql = f"SELECT COUNT(*) FROM talepler WHERE {' AND '.join(where)}"

    rows = db.execute(text(sql), params).fetchall()
    total = db.execute(text(count_sql), {k: v for k, v in params.items() if k not in ("limit", "offset")}).scalar()
    return {"items": [_row(r) for r in rows], "total": total}


@router.post("", status_code=201)
def create_request(
    body: RequestIn,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(text("""
        INSERT INTO talepler (baslik, aciklama, talep_tipi, oncelik, durum, talep_eden, atanan, son_tarih, notlar)
        VALUES (:baslik, :aciklama, :talep_tipi, :oncelik, :durum, :talep_eden, :atanan, :son_tarih::date, :notlar)
        RETURNING *
    """), body.model_dump()).fetchone()
    db.commit()
    return _row(row)


@router.get("/{rid}")
def get_request(
    rid: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(text("SELECT * FROM talepler WHERE id = :id"), {"id": rid}).fetchone()
    if not row:
        raise HTTPException(404, "Talep bulunamadı")
    return _row(row)


@router.put("/{rid}")
def update_request(
    rid: int,
    body: RequestIn,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(text("""
        UPDATE talepler SET
            baslik=:baslik, aciklama=:aciklama, talep_tipi=:talep_tipi,
            oncelik=:oncelik, durum=:durum, talep_eden=:talep_eden,
            atanan=:atanan, son_tarih=:son_tarih::date, notlar=:notlar,
            guncelleme=NOW()
        WHERE id=:id RETURNING *
    """), {**body.model_dump(), "id": rid}).fetchone()
    if not row:
        raise HTTPException(404, "Talep bulunamadı")
    db.commit()
    return _row(row)


@router.delete("/{rid}", status_code=204)
def delete_request(
    rid: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    result = db.execute(text("DELETE FROM talepler WHERE id=:id"), {"id": rid})
    if result.rowcount == 0:
        raise HTTPException(404, "Talep bulunamadı")
    db.commit()
