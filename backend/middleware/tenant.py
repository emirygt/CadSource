"""
tenant.py — Her request'te JWT'den schema_name alıp search_path set eder.
"""
from fastapi import Request, HTTPException
from services.auth_service import decode_token
from services.schema_manager import set_search_path


def get_current_tenant(request: Request) -> dict:
    """
    Authorization: Bearer <token> header'ından tenant bilgisini çıkarır.
    Korumalı endpoint'lerde Depends() ile kullanılır.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token gerekli")
    token = auth.removeprefix("Bearer ").strip()
    try:
        return decode_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


def apply_tenant_schema(tenant: dict, db) -> None:
    """search_path'i tenant schema'sına set eder. Route'larda kullanılır."""
    set_search_path(tenant["schema_name"], db)
