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
    content_hash    VARCHAR(64),
    geometry_hash   VARCHAR(64),
    fine_geom_hash  VARCHAR(64),
    normalized_geom JSONB,
    duplicate_status VARCHAR(32) DEFAULT 'unique',
    duplicate_group_id INTEGER,
    is_favorite     BOOLEAN DEFAULT FALSE,
    category_id     INTEGER REFERENCES {schema}.categories(id) ON DELETE SET NULL,
    approved        BOOLEAN DEFAULT FALSE,
    approved_at     TIMESTAMP,
    approval_status VARCHAR(20) DEFAULT 'uploaded',
    attributes      JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS {schema}.cad_file_groups (
    id           SERIAL PRIMARY KEY,
    group_type   VARCHAR(30) NOT NULL DEFAULT 'duplicate',
    title        VARCHAR,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {schema}.cad_file_group_members (
    id         SERIAL PRIMARY KEY,
    group_id   INTEGER NOT NULL REFERENCES {schema}.cad_file_groups(id) ON DELETE CASCADE,
    file_id    INTEGER NOT NULL REFERENCES {schema}.cad_files(id) ON DELETE CASCADE,
    role       VARCHAR(30) DEFAULT 'member',
    score      FLOAT,
    reason     VARCHAR,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_id, file_id)
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

CREATE INDEX IF NOT EXISTS {schema}_cad_files_content_hash_idx
    ON {schema}.cad_files (content_hash);

CREATE INDEX IF NOT EXISTS {schema}_cad_files_geometry_hash_idx
    ON {schema}.cad_files (geometry_hash);

CREATE INDEX IF NOT EXISTS {schema}_cad_files_duplicate_status_idx
    ON {schema}.cad_files (duplicate_status);

CREATE INDEX IF NOT EXISTS {schema}_cad_files_category_id_idx
    ON {schema}.cad_files (category_id);

CREATE INDEX IF NOT EXISTS {schema}_cad_files_indexed_at_idx
    ON {schema}.cad_files (indexed_at);

CREATE INDEX IF NOT EXISTS {schema}_cad_files_approval_idx
    ON {schema}.cad_files (approval_status);

CREATE TABLE IF NOT EXISTS {schema}.search_feedback (
    id               SERIAL PRIMARY KEY,
    query_file_id    INTEGER REFERENCES {schema}.cad_files(id) ON DELETE SET NULL,
    result_file_id   INTEGER REFERENCES {schema}.cad_files(id) ON DELETE SET NULL,
    similarity_score REAL,
    is_relevant      BOOLEAN NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {schema}.tenant_members (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    email        VARCHAR(255) NOT NULL,
    role         VARCHAR(30) NOT NULL DEFAULT 'Mühendis',
    status       VARCHAR(20) NOT NULL DEFAULT 'active',
    search_count INTEGER DEFAULT 0,
    last_active  TIMESTAMP,
    created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {schema}.attribute_definitions (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    data_type  VARCHAR(20) NOT NULL DEFAULT 'text',
    options    JSONB DEFAULT '[]',
    unit       VARCHAR(50) DEFAULT '',
    required   BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO {schema}.attribute_definitions (name, data_type, options, required, sort_order)
SELECT t.name, t.dt, t.opts::jsonb, TRUE, t.so
FROM (VALUES
    ('Application',   'text',   '[]',                                                       10),
    ('Function',      'text',   '[]',                                                       20),
    ('Product Form',  'text',   '[]',                                                       30),
    ('Malzeme',       'text',   '[]',                                                       40),
    ('Kesit tipi',    'text',   '[]',                                                       50),
    ('Seri / sistem', 'text',   '[]',                                                       60),
    ('Kod',           'text',   '[]',                                                       70),
    ('Onay durumu',   'select', '["Taslak","Incelemede","Onayli","Reddedildi"]',            80),
    ('Revizyon',      'text',   '[]',                                                       90),
    ('Belge tipi',    'select', '["Teknik Cizim","Montaj Cizimi","Parca Listesi","Sema"]', 100)
) AS t(name, dt, opts, so)
WHERE NOT EXISTS (
    SELECT 1 FROM {schema}.attribute_definitions WHERE name = t.name
);

CREATE TABLE IF NOT EXISTS {schema}.comparison_decisions (
    id                  SERIAL PRIMARY KEY,
    reference_filename  VARCHAR(512) NOT NULL,
    compared_file_id    INTEGER REFERENCES {schema}.cad_files(id) ON DELETE SET NULL,
    compared_filename   VARCHAR(512) NOT NULL,
    similarity_score    REAL,
    decision_type       VARCHAR(50) NOT NULL,
    decision_label      VARCHAR(200) NOT NULL,
    notes               TEXT,
    decided_by          VARCHAR(255),
    decided_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {schema}.role_nav_permissions (
    role       VARCHAR(30) PRIMARY KEY,
    nav_items  JSONB NOT NULL DEFAULT '[]'
);

INSERT INTO {schema}.role_nav_permissions (role, nav_items) VALUES
    ('Admin',         '["nav-search","nav-compare","nav-filter","nav-db-upload","nav-db","nav-cat","nav-attr-defs","nav-duplicates","nav-contour","nav-scan","nav-reports","nav-activity","nav-analytics","nav-report","nav-admin","nav-admin-roles","nav-logs"]'),
    ('Mühendis',      '["nav-search","nav-compare","nav-filter","nav-db-upload","nav-db","nav-duplicates","nav-reports"]'),
    ('Görüntüleyici', '["nav-search","nav-db"]')
ON CONFLICT DO NOTHING;
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
