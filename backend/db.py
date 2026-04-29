"""
db.py — PostgreSQL + pgvector bağlantısı ve şema
"""
import os
from sqlalchemy import create_engine, text, Column, Integer, String, Float, JSON, DateTime, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker
from pgvector.sqlalchemy import Vector
from dotenv import load_dotenv
import datetime
from services.job_service import ensure_job_tables

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/cad_search")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class CadFile(Base):
    """Her DWG/DXF dosyası için bir kayıt."""
    __tablename__ = "cad_files"

    id            = Column(Integer, primary_key=True, index=True)
    filename      = Column(String, nullable=False)
    filepath      = Column(String, nullable=False, unique=True)
    file_format   = Column(String, nullable=False)          # dwg | dxf
    indexed_at    = Column(DateTime, default=datetime.datetime.utcnow)

    # --- İstatistikler ---
    entity_count  = Column(Integer, default=0)
    layer_count   = Column(Integer, default=0)
    layers        = Column(JSON, default=list)              # ["walls","doors",...]
    entity_types  = Column(JSON, default=dict)              # {"LINE":120,"CIRCLE":40,...}
    bbox_width    = Column(Float, default=0.0)
    bbox_height   = Column(Float, default=0.0)
    bbox_area     = Column(Float, default=0.0)

    # --- Önizleme ---
    svg_preview    = Column(String, nullable=True)  # küçültülmüş SVG string

    # --- İş akışı ---
    approved      = Column(Boolean, default=False)
    approved_at   = Column(DateTime, nullable=True)
    approval_status = Column(String, default="uploaded")
    is_favorite   = Column(Boolean, default=False)

    # --- Özellik vektörleri (pgvector) ---
    # 128 boyutlu birleşik özellik vektörü
    # [geometri(64) | katman(32) | boyut(16) | thumbnail(16)]
    feature_vector = Column(Vector(128))


def init_db():
    """pgvector uzantısını etkinleştir, public tabloları ve HNSW indexi oluştur."""
    with engine.connect() as conn:
        # pgvector extension
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        # Kullanıcı tablosu (tüm tenant'lar için ortak)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.users (
                id           SERIAL PRIMARY KEY,
                email        VARCHAR NOT NULL UNIQUE,
                password_hash VARCHAR NOT NULL,
                schema_name  VARCHAR NOT NULL UNIQUE,
                company_name VARCHAR DEFAULT '',
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """))
        # Fallback: search_path public'e düşerse activity endpoint'leri patlamasın.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS public.activity_log (
                id          SERIAL PRIMARY KEY,
                action      VARCHAR(50) NOT NULL,
                filename    VARCHAR,
                file_id     INTEGER,
                user_email  VARCHAR,
                details     VARCHAR,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()
    with SessionLocal() as db:
        ensure_job_tables(db)
    Base.metadata.create_all(bind=engine)
    # Yeni kolonları mevcut tenant schema'larına ekle
    with engine.connect() as conn:
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS svg_preview TEXT;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS category_id INTEGER;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS clip_vector vector(512);
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS jpg_preview TEXT;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS file_data BYTEA;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'uploaded';
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ALTER COLUMN approval_status SET DEFAULT 'uploaded';
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            UPDATE cad_files
            SET approval_status = CASE WHEN approved THEN 'approved' ELSE 'uploaded' END
            WHERE approval_status IS NULL OR approval_status = '';
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cad_file_groups (
                id           SERIAL PRIMARY KEY,
                group_type   VARCHAR(30) NOT NULL DEFAULT 'duplicate',
                title        VARCHAR,
                created_at   TIMESTAMP DEFAULT NOW(),
                updated_at   TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cad_file_group_members (
                id         SERIAL PRIMARY KEY,
                group_id   INTEGER NOT NULL REFERENCES cad_file_groups(id) ON DELETE CASCADE,
                file_id    INTEGER NOT NULL REFERENCES cad_files(id) ON DELETE CASCADE,
                role       VARCHAR(30) DEFAULT 'member',
                score      FLOAT,
                reason     VARCHAR,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(group_id, file_id)
            )
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS geometry_hash VARCHAR(64);
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS duplicate_status VARCHAR(32) DEFAULT 'unique';
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS duplicate_group_id INTEGER;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("""
            DO $$ BEGIN
                ALTER TABLE cad_files ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;
            EXCEPTION WHEN others THEN NULL; END $$;
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS cad_files_content_hash_idx ON cad_files (content_hash)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS cad_files_geometry_hash_idx ON cad_files (geometry_hash)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS cad_files_duplicate_status_idx ON cad_files (duplicate_status)"))
        conn.commit()
    # Mevcut tenant schema'larına search_history tablosunu ekle
    with engine.connect() as conn:
        schemas = conn.execute(text("""
            SELECT schema_name FROM information_schema.schemata
            WHERE schema_name NOT IN ('public','pg_catalog','information_schema','pg_toast')
              AND schema_name NOT LIKE 'pg_%'
        """)).fetchall()
        for (schema,) in schemas:
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.search_history (
                    id             SERIAL PRIMARY KEY,
                    query_filename VARCHAR NOT NULL,
                    top_k          INTEGER DEFAULT 10,
                    min_similarity FLOAT DEFAULT 0.5,
                    category_id    INTEGER,
                    result_count   INTEGER DEFAULT 0,
                    searched_at    TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS clip_vector vector(512);
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS jpg_preview TEXT;
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS file_data BYTEA;
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) DEFAULT 'uploaded';
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ALTER COLUMN approval_status SET DEFAULT 'uploaded';
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                UPDATE {schema}.cad_files
                SET approval_status = CASE WHEN approved THEN 'approved' ELSE 'uploaded' END
                WHERE approval_status IS NULL OR approval_status = '';
            """))
            conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {schema}_clip_vector_idx
                ON {schema}.cad_files
                USING hnsw (clip_vector vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.categories ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES {schema}.categories(id) ON DELETE SET NULL;
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.activity_log (
                    id          SERIAL PRIMARY KEY,
                    action      VARCHAR(50) NOT NULL,
                    filename    VARCHAR,
                    file_id     INTEGER,
                    user_email  VARCHAR,
                    details     VARCHAR,
                    created_at  TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.cad_file_groups (
                    id           SERIAL PRIMARY KEY,
                    group_type   VARCHAR(30) NOT NULL DEFAULT 'duplicate',
                    title        VARCHAR,
                    created_at   TIMESTAMP DEFAULT NOW(),
                    updated_at   TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.cad_file_group_members (
                    id         SERIAL PRIMARY KEY,
                    group_id   INTEGER NOT NULL REFERENCES {schema}.cad_file_groups(id) ON DELETE CASCADE,
                    file_id    INTEGER NOT NULL REFERENCES {schema}.cad_files(id) ON DELETE CASCADE,
                    role       VARCHAR(30) DEFAULT 'member',
                    score      FLOAT,
                    reason     VARCHAR,
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(group_id, file_id)
                )
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS geometry_hash VARCHAR(64);
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS duplicate_status VARCHAR(32) DEFAULT 'unique';
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS duplicate_group_id INTEGER;
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {schema}_cad_files_content_hash_idx
                ON {schema}.cad_files (content_hash)
            """))
            conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {schema}_cad_files_geometry_hash_idx
                ON {schema}.cad_files (geometry_hash)
            """))
            conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {schema}_cad_files_duplicate_status_idx
                ON {schema}.cad_files (duplicate_status)
            """))
            conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {schema}_cad_files_category_id_idx
                ON {schema}.cad_files (category_id)
            """))
            conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {schema}_cad_files_indexed_at_idx
                ON {schema}.cad_files (indexed_at)
            """))
            conn.execute(text(f"""
                CREATE INDEX IF NOT EXISTS {schema}_cad_files_approval_idx
                ON {schema}.cad_files (approval_status)
            """))
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.search_feedback (
                    id               SERIAL PRIMARY KEY,
                    query_file_id    INTEGER REFERENCES {schema}.cad_files(id) ON DELETE SET NULL,
                    result_file_id   INTEGER REFERENCES {schema}.cad_files(id) ON DELETE SET NULL,
                    similarity_score REAL,
                    is_relevant      BOOLEAN NOT NULL,
                    created_at       TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {schema}.attribute_definitions (
                    id         SERIAL PRIMARY KEY,
                    name       VARCHAR(100) NOT NULL,
                    data_type  VARCHAR(20) NOT NULL DEFAULT 'text',
                    options    JSONB DEFAULT '[]',
                    unit       VARCHAR(50) DEFAULT '',
                    required   BOOLEAN DEFAULT FALSE,
                    sort_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text(f"""
                DO $$ BEGIN
                    ALTER TABLE {schema}.cad_files ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{{}}';
                EXCEPTION WHEN others THEN NULL; END $$;
            """))
            conn.execute(text(f"""
                INSERT INTO {schema}.attribute_definitions (name, data_type, options, required, sort_order)
                SELECT t.name, t.dt, t.opts::jsonb, TRUE, t.so
                FROM (VALUES
                    ('Application',   'text',   '[]',                                                        10),
                    ('Function',      'text',   '[]',                                                        20),
                    ('Product Form',  'text',   '[]',                                                        30),
                    ('Malzeme',       'text',   '[]',                                                        40),
                    ('Kesit tipi',    'text',   '[]',                                                        50),
                    ('Seri / sistem', 'text',   '[]',                                                        60),
                    ('Kod',           'text',   '[]',                                                        70),
                    ('Onay durumu',   'select', '["Taslak","Incelemede","Onayli","Reddedildi"]',             80),
                    ('Revizyon',      'text',   '[]',                                                        90),
                    ('Belge tipi',    'select', '["Teknik Cizim","Montaj Cizimi","Parca Listesi","Sema"]',  100)
                ) AS t(name, dt, opts, so)
                WHERE NOT EXISTS (
                    SELECT 1 FROM {schema}.attribute_definitions WHERE name = t.name
                )
            """))
        conn.commit()

    # Default schema (public) için HNSW — tenant schema'larında schema_manager kurar
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS cad_files_vector_idx
            ON cad_files
            USING hnsw (feature_vector vector_cosine_ops)
            WITH (m = 16, ef_construction = 64)
        """))
        conn.commit()
    print("Veritabani hazir.")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
