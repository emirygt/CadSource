"""
products.py — Ürün CRUD endpoint'leri
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional, List

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(prefix="/products", tags=["products"])


class ProductIn(BaseModel):
    kod: str
    ad: str
    kategori_id: Optional[int] = None
    seri: Optional[str] = None
    sistem_ailesi: Optional[str] = None
    alt_fonksiyon: Optional[str] = None
    en: Optional[float] = None
    yukseklik: Optional[float] = None
    et_kalinligi: Optional[float] = None
    agirlik_m: Optional[float] = None
    malzeme: Optional[str] = None
    durum: Optional[str] = "Aktif"
    etiketler: Optional[List[str]] = []
    aciklama: Optional[str] = None


def _row(r) -> dict:
    return {
        "id":            r.id,
        "kod":           r.kod,
        "ad":            r.ad,
        "kategori_id":   r.kategori_id,
        "kategori_adi":  getattr(r, "kategori_adi", None),
        "seri":          r.seri,
        "sistem_ailesi": r.sistem_ailesi,
        "alt_fonksiyon": r.alt_fonksiyon,
        "en":            float(r.en) if r.en else None,
        "yukseklik":     float(r.yukseklik) if r.yukseklik else None,
        "et_kalinligi":  float(r.et_kalinligi) if r.et_kalinligi else None,
        "agirlik_m":     float(r.agirlik_m) if r.agirlik_m else None,
        "malzeme":       r.malzeme,
        "durum":         r.durum,
        "etiketler":     r.etiketler or [],
        "aciklama":      r.aciklama,
        "olusturan":     r.olusturan,
        "olusturulma":   r.olusturulma.isoformat() if r.olusturulma else None,
        "guncelleme":    r.guncelleme.isoformat() if r.guncelleme else None,
    }


@router.get("")
def list_products(
    durum: Optional[str] = Query(default=None),
    kategori_id: Optional[int] = Query(default=None),
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    where, params = ["1=1"], {"limit": limit, "offset": offset}

    if durum:
        where.append("p.durum = :durum"); params["durum"] = durum
    if kategori_id:
        where.append("p.kategori_id = :kat"); params["kat"] = kategori_id
    if q:
        where.append("(p.kod ILIKE :q OR p.ad ILIKE :q)"); params["q"] = f"%{q}%"

    sql = f"""
        SELECT p.*, c.name AS kategori_adi
        FROM products p
        LEFT JOIN categories c ON c.id = p.kategori_id
        WHERE {' AND '.join(where)}
        ORDER BY p.olusturulma DESC
        LIMIT :limit OFFSET :offset
    """
    rows = db.execute(text(sql), params).fetchall()
    total = db.execute(
        text(f"SELECT COUNT(*) FROM products p WHERE {' AND '.join(where)}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    ).scalar()
    return {"total": total, "items": [_row(r) for r in rows]}


@router.post("", status_code=201)
def create_product(
    body: ProductIn,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    import json
    existing = db.execute(
        text("SELECT id FROM products WHERE kod = :kod"), {"kod": body.kod.strip()}
    ).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Bu kod zaten kullanımda")

    row = db.execute(text("""
        INSERT INTO products (kod, ad, kategori_id, seri, sistem_ailesi, alt_fonksiyon,
            en, yukseklik, et_kalinligi, agirlik_m, malzeme, durum, etiketler, aciklama, olusturan)
        VALUES (:kod, :ad, :kat, :seri, :sis, :alt, :en, :yuk, :et, :agr, :mal, :durum,
            :etiketler::jsonb, :aciklama, :olusturan)
        RETURNING *
    """), {
        "kod": body.kod.strip(), "ad": body.ad.strip(), "kat": body.kategori_id,
        "seri": body.seri, "sis": body.sistem_ailesi, "alt": body.alt_fonksiyon,
        "en": body.en, "yuk": body.yukseklik, "et": body.et_kalinligi,
        "agr": body.agirlik_m, "mal": body.malzeme, "durum": body.durum,
        "etiketler": json.dumps(body.etiketler or []),
        "aciklama": body.aciklama,
        "olusturan": tenant.get("email", ""),
    }).fetchone()
    db.commit()
    return _row(row)


@router.get("/{product_id}")
def get_product(
    product_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(
        text("SELECT p.*, c.name AS kategori_adi FROM products p LEFT JOIN categories c ON c.id = p.kategori_id WHERE p.id = :id"),
        {"id": product_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    return _row(row)


@router.put("/{product_id}")
def update_product(
    product_id: int,
    body: ProductIn,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    import json
    existing = db.execute(text("SELECT id FROM products WHERE id = :id"), {"id": product_id}).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")

    conflict = db.execute(
        text("SELECT id FROM products WHERE kod = :kod AND id != :id"),
        {"kod": body.kod.strip(), "id": product_id},
    ).fetchone()
    if conflict:
        raise HTTPException(status_code=400, detail="Bu kod zaten kullanımda")

    row = db.execute(text("""
        UPDATE products SET
            kod=:kod, ad=:ad, kategori_id=:kat, seri=:seri, sistem_ailesi=:sis,
            alt_fonksiyon=:alt, en=:en, yukseklik=:yuk, et_kalinligi=:et,
            agirlik_m=:agr, malzeme=:mal, durum=:durum,
            etiketler=:etiketler::jsonb, aciklama=:aciklama, guncelleme=NOW()
        WHERE id=:id
        RETURNING *
    """), {
        "id": product_id, "kod": body.kod.strip(), "ad": body.ad.strip(),
        "kat": body.kategori_id, "seri": body.seri, "sis": body.sistem_ailesi,
        "alt": body.alt_fonksiyon, "en": body.en, "yuk": body.yukseklik,
        "et": body.et_kalinligi, "agr": body.agirlik_m, "mal": body.malzeme,
        "durum": body.durum, "etiketler": json.dumps(body.etiketler or []),
        "aciklama": body.aciklama,
    }).fetchone()
    db.commit()
    return _row(row)


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    existing = db.execute(text("SELECT id FROM products WHERE id = :id"), {"id": product_id}).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    db.execute(text("DELETE FROM products WHERE id = :id"), {"id": product_id})
    db.commit()
