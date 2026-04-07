"""
auth_service.py — Şifre hash ve JWT üretimi
"""
import os
import hashlib
import hmac
import time
import base64
import json

JWT_SECRET = os.getenv("JWT_SECRET", "change-this-secret")
JWT_EXPIRE_SECONDS = 60 * 60 * 24 * 7  # 7 gün


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260000)
    return base64.b64encode(salt + key).decode()


def verify_password(password: str, hashed: str) -> bool:
    raw = base64.b64decode(hashed.encode())
    salt, key = raw[:16], raw[16:]
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260000)
    return hmac.compare_digest(key, check)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def create_token(user_id: int, email: str, schema_name: str) -> str:
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps({
        "user_id": user_id,
        "email": email,
        "schema_name": schema_name,
        "exp": int(time.time()) + JWT_EXPIRE_SECONDS,
    }).encode())
    sig = _b64url(hmac.new(
        JWT_SECRET.encode(),
        f"{header}.{payload}".encode(),
        hashlib.sha256,
    ).digest())
    return f"{header}.{payload}.{sig}"


def decode_token(token: str) -> dict:
    """Token doğrula ve payload'ı döndür. Hatalıysa ValueError fırlatır."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Geçersiz token formatı")

    header, payload, sig = parts
    expected_sig = _b64url(hmac.new(
        JWT_SECRET.encode(),
        f"{header}.{payload}".encode(),
        hashlib.sha256,
    ).digest())

    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Token imzası geçersiz")

    # Padding ekle
    padded = payload + "=" * (4 - len(payload) % 4)
    data = json.loads(base64.urlsafe_b64decode(padded))

    if data.get("exp", 0) < time.time():
        raise ValueError("Token süresi dolmuş")

    return data
