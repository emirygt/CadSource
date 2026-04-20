"""
schema_manager.py — Multi-tenant PostgreSQL schema yönetimi

Her müşteri kendi schema'sında izole çalışır.
Middleware SET search_path ile doğru schema'ya yönlendirir.
"""
import re
from sqlalchemy import text
from sqlalchemy.orm import Session


# Tenant schema'sında oluşturulacak tablolar
TENANT_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS {schema}.categories (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR NOT NULL,
    parent_id  INTEGER REFERENCES {schema}.categories(id) ON DELETE SET NULL,
    color      VARCHAR DEFAULT '#6366f1',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {schema}.search_history (
    id             SERIAL PRIMARY KEY,
    query_filename VARCHAR NOT NULL,
    top_k          INTEGER DEFAULT 10,
    min_similarity FLOAT DEFAULT 0.5,
    category_id    INTEGER,
    result_count   INTEGER DEFAULT 0,
    searched_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {schema}.cad_files (
    id              SERIAL PRIMARY KEY,
    filename        VARCHAR NOT NULL,
    filepath        VARCHAR NOT NULL UNIQUE,
    file_format     VARCHAR NOT NULL,
    indexed_at      TIMESTAMP DEFAULT NOW(),
    entity_count    INTEGER DEFAULT 0,
    layer_count     INTEGER DEFAULT 0,
    layers          JSON DEFAULT '[]',
    entity_types    JSON DEFAULT '{{}}',
    bbox_width      FLOAT DEFAULT 0.0,
    bbox_height     FLOAT DEFAULT 0.0,
    bbox_area       FLOAT DEFAULT 0.0,
    feature_vector  vector(128),
    clip_vector     vector(512),
    svg_preview     TEXT,
    jpg_preview     TEXT,
    file_data       BYTEA,
    category_id     INTEGER REFERENCES {schema}.categories(id) ON DELETE SET NULL,
    approved        BOOLEAN DEFAULT FALSE,
    approved_at     TIMESTAMP,
    approval_status VARCHAR(20) DEFAULT 'uploaded'
);

CREATE TABLE IF NOT EXISTS {schema}.activity_log (
    id          SERIAL PRIMARY KEY,
    action      VARCHAR(50) NOT NULL,
    filename    VARCHAR,
    file_id     INTEGER,
    user_email  VARCHAR,
    details     VARCHAR,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS {schema}_vector_idx
    ON {schema}.cad_files
    USING hnsw (feature_vector vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS {schema}_clip_vector_idx
    ON {schema}.cad_files
    USING hnsw (clip_vector vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
"""


def derive_schema_name(email: str, db: Session) -> str:
    """
    Email'den schema adı türetir.
    ali@acmemuh.com → "acmemuh"
    ali@my-company.com → "mycompany"
    Çakışma varsa: "acmemuh_2"
    """
    domain_part = email.split("@")[-1].split(".")[0]
    # Sadece harf ve rakam bırak, lowercase
    base = re.sub(r"[^a-z0-9]", "", domain_part.lower())
    if not base:
        base = "tenant"

    # Çakışma kontrolü
    candidate = base
    counter = 2
    while schema_exists(candidate, db):
        candidate = f"{base}_{counter}"
        counter += 1

    return candidate


def schema_exists(schema_name: str, db: Session) -> bool:
    result = db.execute(
        text("SELECT 1 FROM information_schema.schemata WHERE schema_name = :name"),
        {"name": schema_name},
    ).fetchone()
    return result is not None


def create_tenant_schema(schema_name: str, db: Session) -> None:
    """
    Yeni tenant için schema ve standart tabloları oluşturur.
    Register sırasında bir kez çağrılır.
    """
    # Schema adı sadece harf, rakam ve _ içerebilir (SQL injection koruması)
    if not re.match(r"^[a-z][a-z0-9_]{0,62}$", schema_name):
        raise ValueError(f"Geçersiz schema adı: {schema_name}")

    db.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema_name}"))
    db.execute(text(TENANT_SCHEMA_SQL.format(schema=schema_name)))
    db.commit()


def drop_tenant_schema(schema_name: str, db: Session) -> None:
    """Tenant iptalinde schema'yı siler. DİKKATLİ KUL."""
    if not re.match(r"^[a-z][a-z0-9_]{0,62}$", schema_name):
        raise ValueError(f"Geçersiz schema adı: {schema_name}")
    db.execute(text(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE"))
    db.commit()


def set_search_path(schema_name: str, db: Session) -> None:
    """Her request başında çağrılır — doğru schema'ya yönlendirir."""
    if not re.match(r"^[a-z][a-z0-9_]{0,62}$", schema_name):
        raise ValueError(f"Geçersiz schema adı: {schema_name}")
    db.execute(text(f"SET search_path TO {schema_name}, public"))
