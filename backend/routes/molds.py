"""
molds.py — Kalıp CRUD endpoint'leri
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
from datetime import date

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(prefix="/molds", tags=["molds"])


class MoldIn(BaseModel):
    numara: str
    tip: Optional[str] = None
    lokasyon: Optional[str] = None
    durum: Optional[str] = "Aktif"
    revizyon_no: Optional[str] = "R0"
    acilis_tarihi: Optional[date] = None
    son_kullanim: Optional[date] = None
    acilis_maliyeti: Optional[float] = None
    tedarikci: Optional[str] = None
    notlar: Optional[str] = None


def _row(r) -> dict:
    return {
        "id":              r.id,
        "numara":          r.numara,
        "tip":             r.tip,
        "lokasyon":        r.lokasyon,
        "durum":           r.durum,
        "revizyon_no":     r.revizyon_no,
        "acilis_tarihi":   r.acilis_tarihi.isoformat() if r.acilis_tarihi else None,
        "son_kullanim":    r.son_kullanim.isoformat() if r.son_kullanim else None,
        "acilis_maliyeti": float(r.acilis_maliyeti) if r.acilis_maliyeti else None,
        "tedarikci":       r.tedarikci,
        "notlar":          r.notlar,
        "olusturulma":     r.olusturulma.isoformat() if r.olusturulma else None,
    }


@router.get("")
def list_molds(
    durum: Optional[str] = Query(default=None),
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
    if q:
        where.append("(numara ILIKE :q OR tedarikci ILIKE :q)"); params["q"] = f"%{q}%"

    rows = db.execute(
        text(f"SELECT * FROM molds WHERE {' AND '.join(where)} ORDER BY olusturulma DESC LIMIT :limit OFFSET :offset"),
        params,
    ).fetchall()
    total = db.execute(
        text(f"SELECT COUNT(*) FROM molds WHERE {' AND '.join(where)}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    ).scalar()
    return {"total": total, "items": [_row(r) for r in rows]}


@router.post("", status_code=201)
def create_mold(
    body: MoldIn,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    if db.execute(text("SELECT id FROM molds WHERE numara = :n"), {"n": body.numara.strip()}).fetchone():
        raise HTTPException(status_code=400, detail="Bu numara zaten kullanımda")

    row = db.execute(text("""
        INSERT INTO molds (numara, tip, lokasyon, durum, revizyon_no, acilis_tarihi,
            son_kullanim, acilis_maliyeti, tedarikci, notlar)
        VALUES (:numara, :tip, :lok, :durum, :rev, :acilis, :son, :maliyet, :ted, :notlar)
        RETURNING *
    """), {
        "numara": body.numara.strip(), "tip": body.tip, "lok": body.lokasyon,
        "durum": body.durum, "rev": body.revizyon_no, "acilis": body.acilis_tarihi,
        "son": body.son_kullanim, "maliyet": body.acilis_maliyeti,
        "ted": body.tedarikci, "notlar": body.notlar,
    }).fetchone()
    db.commit()
    return _row(row)


@router.get("/{mold_id}")
def get_mold(
    mold_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(text("SELECT * FROM molds WHERE id = :id"), {"id": mold_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Kalıp bulunamadı")
    return _row(row)


@router.put("/{mold_id}")
def update_mold(
    mold_id: int,
    body: MoldIn,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    if not db.execute(text("SELECT id FROM molds WHERE id = :id"), {"id": mold_id}).fetchone():
        raise HTTPException(status_code=404, detail="Kalıp bulunamadı")
    if db.execute(text("SELECT id FROM molds WHERE numara = :n AND id != :id"), {"n": body.numara.strip(), "id": mold_id}).fetchone():
        raise HTTPException(status_code=400, detail="Bu numara zaten kullanımda")

    row = db.execute(text("""
        UPDATE molds SET numara=:numara, tip=:tip, lokasyon=:lok, durum=:durum,
            revizyon_no=:rev, acilis_tarihi=:acilis, son_kullanim=:son,
            acilis_maliyeti=:maliyet, tedarikci=:ted, notlar=:notlar, guncelleme=NOW()
        WHERE id=:id RETURNING *
    """), {
        "id": mold_id, "numara": body.numara.strip(), "tip": body.tip,
        "lok": body.lokasyon, "durum": body.durum, "rev": body.revizyon_no,
        "acilis": body.acilis_tarihi, "son": body.son_kullanim,
        "maliyet": body.acilis_maliyeti, "ted": body.tedarikci, "notlar": body.notlar,
    }).fetchone()
    db.commit()
    return _row(row)


@router.delete("/{mold_id}", status_code=204)
def delete_mold(
    mold_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    if not db.execute(text("SELECT id FROM molds WHERE id = :id"), {"id": mold_id}).fetchone():
        raise HTTPException(status_code=404, detail="Kalıp bulunamadı")
    db.execute(text("DELETE FROM molds WHERE id = :id"), {"id": mold_id})
    db.commit()
