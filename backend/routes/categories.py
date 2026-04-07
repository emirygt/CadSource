"""
categories.py — Kategori CRUD endpoint'leri
Her tenant kendi kategorilerini yönetir.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(prefix="/categories", tags=["categories"])


class CategoryCreate(BaseModel):
    name: str
    color: Optional[str] = "#6366f1"


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


@router.get("")
def list_categories(
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    # categories tablosu yoksa oluştur (eski tenant'lar için)
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS categories (
            id         SERIAL PRIMARY KEY,
            name       VARCHAR NOT NULL,
            color      VARCHAR DEFAULT '#6366f1',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """))
    db.commit()
    rows = db.execute(text(
        "SELECT id, name, color, created_at FROM categories ORDER BY id"
    )).fetchall()
    # Her kategorideki dosya sayısını da getir
    counts = {
        r[0]: r[1]
        for r in db.execute(text(
            "SELECT category_id, COUNT(*) FROM cad_files WHERE category_id IS NOT NULL GROUP BY category_id"
        )).fetchall()
    }
    return [
        {
            "id": r.id,
            "name": r.name,
            "color": r.color,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "file_count": counts.get(r.id, 0),
        }
        for r in rows
    ]


@router.post("", status_code=201)
def create_category(
    body: CategoryCreate,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Kategori adı boş olamaz")
    existing = db.execute(
        text("SELECT id FROM categories WHERE LOWER(name) = LOWER(:name)"),
        {"name": name},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Bu isimde kategori zaten var")
    result = db.execute(
        text("INSERT INTO categories (name, color) VALUES (:name, :color) RETURNING id, name, color, created_at"),
        {"name": name, "color": body.color or "#6366f1"},
    ).fetchone()
    db.commit()
    return {"id": result.id, "name": result.name, "color": result.color,
            "created_at": result.created_at.isoformat(), "file_count": 0}


@router.put("/{cat_id}")
def update_category(
    cat_id: int,
    body: CategoryUpdate,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    existing = db.execute(
        text("SELECT id, name, color FROM categories WHERE id = :id"),
        {"id": cat_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori bulunamadı")
    new_name  = body.name.strip()  if body.name  else existing.name
    new_color = body.color.strip() if body.color else existing.color
    if not new_name:
        raise HTTPException(status_code=400, detail="Kategori adı boş olamaz")
    db.execute(
        text("UPDATE categories SET name = :name, color = :color WHERE id = :id"),
        {"name": new_name, "color": new_color, "id": cat_id},
    )
    db.commit()
    return {"id": cat_id, "name": new_name, "color": new_color}


@router.delete("/{cat_id}")
def delete_category(
    cat_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    existing = db.execute(
        text("SELECT id FROM categories WHERE id = :id"), {"id": cat_id}
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Kategori bulunamadı")
    # Dosyaların category_id'sini NULL yap (ON DELETE SET NULL yaptık ama
    # search_path üzerinden çalıştığımız için elle de yapalım)
    db.execute(
        text("UPDATE cad_files SET category_id = NULL WHERE category_id = :id"),
        {"id": cat_id},
    )
    db.execute(text("DELETE FROM categories WHERE id = :id"), {"id": cat_id})
    db.commit()
    return {"status": "deleted", "id": cat_id}


@router.patch("/files/{file_id}")
def set_file_category(
    file_id: int,
    body: dict,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Bir dosyanın kategorisini güncelle. body: {category_id: int|null}"""
    apply_tenant_schema(tenant, db)
    cat_id = body.get("category_id")
    if cat_id is not None:
        exists = db.execute(
            text("SELECT id FROM categories WHERE id = :id"), {"id": cat_id}
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Kategori bulunamadı")
    db.execute(
        text("UPDATE cad_files SET category_id = :cat_id WHERE id = :file_id"),
        {"cat_id": cat_id, "file_id": file_id},
    )
    db.commit()
    return {"status": "updated", "file_id": file_id, "category_id": cat_id}
