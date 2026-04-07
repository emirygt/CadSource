"""
auth.py — Register ve Login endpoint'leri
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from services.auth_service import hash_password, verify_password, create_token
from services.schema_manager import derive_schema_name, create_tenant_schema

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    company_name: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/register")
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    # Daha önce kayıtlı mı?
    existing = db.execute(
        text("SELECT id FROM public.users WHERE email = :email"),
        {"email": body.email},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Bu email zaten kayıtlı")

    # Schema adı türet
    schema_name = derive_schema_name(body.email, db)

    # Kullanıcıyı kaydet
    hashed = hash_password(body.password)
    result = db.execute(
        text("""
            INSERT INTO public.users (email, password_hash, schema_name, company_name)
            VALUES (:email, :password_hash, :schema_name, :company_name)
            RETURNING id
        """),
        {
            "email": body.email,
            "password_hash": hashed,
            "schema_name": schema_name,
            "company_name": body.company_name,
        },
    )
    db.commit()
    user_id = result.fetchone()[0]

    # Tenant schema oluştur
    create_tenant_schema(schema_name, db)

    # Token üret
    token = create_token(user_id, body.email, schema_name)
    return {"token": token, "schema_name": schema_name, "email": body.email}


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(
        text("SELECT id, password_hash, schema_name FROM public.users WHERE email = :email"),
        {"email": body.email},
    ).fetchone()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email veya şifre hatalı")

    token = create_token(user.id, body.email, user.schema_name)
    return {"token": token, "schema_name": user.schema_name, "email": body.email}
