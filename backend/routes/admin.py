from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(prefix="/admin", tags=["admin"])

VALID_ROLES = {"Admin", "Mühendis", "Görüntüleyici"}
VALID_STATUSES = {"active", "passive"}


class MemberIn(BaseModel):
    name: str
    email: EmailStr
    role: str = "Mühendis"


class MemberUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    status: Optional[str] = None


@router.get("/stats")
def admin_stats(tenant=Depends(get_current_tenant), db: Session = Depends(get_db)):
    apply_tenant_schema(tenant, db)
    total_files = db.execute(text("SELECT COUNT(*) FROM cad_files")).scalar() or 0
    monthly_ops = db.execute(text(
        "SELECT COUNT(*) FROM activity_log WHERE created_at >= date_trunc('month', NOW())"
    )).scalar() or 0
    active_members = db.execute(text(
        "SELECT COUNT(*) FROM tenant_members WHERE status = 'active'"
    )).scalar() or 0
    return {
        "active_users": int(active_members) + 1,
        "total_files": int(total_files),
        "monthly_ops": int(monthly_ops),
        "license_status": "Aktif",
    }


@router.get("/members")
def list_members(tenant=Depends(get_current_tenant), db: Session = Depends(get_db)):
    apply_tenant_schema(tenant, db)
    rows = db.execute(text("""
        SELECT id, name, email, role, status, search_count,
               to_char(last_active, 'DD Mon YYYY HH24:MI') AS last_active,
               to_char(created_at, 'DD Mon YYYY HH24:MI') AS created_at
        FROM tenant_members
        ORDER BY created_at ASC
    """)).fetchall()
    return [dict(r._mapping) for r in rows]


@router.post("/members", status_code=201)
def create_member(body: MemberIn, tenant=Depends(get_current_tenant), db: Session = Depends(get_db)):
    apply_tenant_schema(tenant, db)
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"Geçersiz rol. Geçerli değerler: {VALID_ROLES}")
    exists = db.execute(
        text("SELECT id FROM tenant_members WHERE email = :e"), {"e": body.email}
    ).fetchone()
    if exists:
        raise HTTPException(400, "Bu e-posta zaten kayıtlı")
    row = db.execute(text("""
        INSERT INTO tenant_members (name, email, role, status)
        VALUES (:name, :email, :role, 'active')
        RETURNING id, name, email, role, status, search_count,
                  to_char(last_active, 'DD Mon YYYY HH24:MI') AS last_active,
                  to_char(created_at, 'DD Mon YYYY HH24:MI') AS created_at
    """), {"name": body.name, "email": body.email, "role": body.role}).fetchone()
    db.commit()
    return dict(row._mapping)


@router.put("/members/{mid}")
def update_member(mid: int, body: MemberUpdate, tenant=Depends(get_current_tenant), db: Session = Depends(get_db)):
    apply_tenant_schema(tenant, db)
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.email is not None:
        updates["email"] = body.email
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(400, "Geçersiz rol")
        updates["role"] = body.role
    if body.status is not None:
        if body.status not in VALID_STATUSES:
            raise HTTPException(400, "Geçersiz durum")
        updates["status"] = body.status
    if not updates:
        raise HTTPException(400, "Güncellenecek alan yok")

    sets = ", ".join(f"{k}=:{k}" for k in updates)
    updates["mid"] = mid
    row = db.execute(text(f"""
        UPDATE tenant_members SET {sets} WHERE id=:mid
        RETURNING id, name, email, role, status, search_count,
                  to_char(last_active, 'DD Mon YYYY HH24:MI') AS last_active,
                  to_char(created_at, 'DD Mon YYYY HH24:MI') AS created_at
    """), updates).fetchone()
    db.commit()
    if not row:
        raise HTTPException(404, "Üye bulunamadı")
    return dict(row._mapping)


@router.delete("/members/{mid}")
def delete_member(mid: int, tenant=Depends(get_current_tenant), db: Session = Depends(get_db)):
    apply_tenant_schema(tenant, db)
    r = db.execute(text("DELETE FROM tenant_members WHERE id=:id RETURNING id"), {"id": mid}).fetchone()
    db.commit()
    if not r:
        raise HTTPException(404, "Üye bulunamadı")
    return {"ok": True}
