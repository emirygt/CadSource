"""
analytics.py — Dashboard analitik endpoint'leri (Faza 3.2)

Tüm veriler tenant'a izole (search_path ile).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
def analytics_overview(
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """
    Genel istatistikler:
    - Toplam dosya, indexlenen, CLIP vektörü olan
    - Format dağılımı
    - En büyük / en küçük dosyalar (entity_count'a göre)
    - Kategori dağılımı
    """
    apply_tenant_schema(tenant, db)

    # Genel sayılar
    totals = db.execute(text("""
        SELECT
            COUNT(*)                                           AS total_files,
            COUNT(*) FILTER (WHERE feature_vector IS NOT NULL) AS indexed_files,
            COUNT(*) FILTER (WHERE clip_vector IS NOT NULL)    AS clip_files,
            COALESCE(SUM(entity_count), 0)                    AS total_entities,
            COALESCE(AVG(entity_count), 0)                    AS avg_entities,
            COALESCE(AVG(layer_count),  0)                    AS avg_layers
        FROM cad_files
    """)).fetchone()

    # Format dağılımı
    formats = db.execute(text("""
        SELECT file_format, COUNT(*) AS cnt
        FROM cad_files
        GROUP BY file_format
        ORDER BY cnt DESC
    """)).fetchall()

    # Kategori dağılımı
    categories = db.execute(text("""
        SELECT
            COALESCE(c.name, 'Kategorisiz') AS name,
            COALESCE(c.color, '#555e72')    AS color,
            COUNT(f.id)                     AS cnt
        FROM cad_files f
        LEFT JOIN categories c ON c.id = f.category_id
        GROUP BY c.name, c.color
        ORDER BY cnt DESC
        LIMIT 10
    """)).fetchall()

    # Entity tipi dağılımı (tüm dosyaların entity_types JSON'larını topla)
    entity_rows = db.execute(text("""
        SELECT entity_types FROM cad_files
        WHERE entity_types IS NOT NULL AND entity_types != '{}'::jsonb
        LIMIT 500
    """)).fetchall()

    entity_totals: dict = {}
    for row in entity_rows:
        et = row.entity_types or {}
        if isinstance(et, dict):
            for k, v in et.items():
                entity_totals[k] = entity_totals.get(k, 0) + (v if isinstance(v, (int, float)) else 0)

    # Top 10 entity tipi
    top_entities = sorted(entity_totals.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        "totals": {
            "total_files":   totals.total_files,
            "indexed_files": totals.indexed_files,
            "clip_files":    totals.clip_files,
            "total_entities": int(totals.total_entities),
            "avg_entities":   round(float(totals.avg_entities), 1),
            "avg_layers":     round(float(totals.avg_layers), 1),
        },
        "formats": [
            {"format": r.file_format, "count": r.cnt}
            for r in formats
        ],
        "categories": [
            {"name": r.name, "color": r.color, "count": r.cnt}
            for r in categories
        ],
        "top_entities": [
            {"type": k, "count": v}
            for k, v in top_entities
        ],
    }


@router.get("/uploads-trend")
def uploads_trend(
    days: int = 30,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """
    Son N günün günlük upload sayısı (grafik için).
    """
    apply_tenant_schema(tenant, db)

    rows = db.execute(text("""
        SELECT
            DATE(indexed_at) AS day,
            COUNT(*)         AS cnt
        FROM cad_files
        WHERE indexed_at >= NOW() - INTERVAL ':days days'
        GROUP BY DATE(indexed_at)
        ORDER BY day
    """.replace(":days", str(int(days))))).fetchall()

    return [{"day": str(r.day), "count": r.cnt} for r in rows]


@router.get("/search-stats")
def search_stats(
    limit: int = 10,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """
    En çok aranan dosyalar + arama geçmişi özeti.
    """
    apply_tenant_schema(tenant, db)

    # En çok aranan dosyalar
    top_searches = db.execute(text("""
        SELECT
            query_filename,
            COUNT(*)          AS search_count,
            AVG(result_count) AS avg_results,
            MAX(searched_at)  AS last_searched
        FROM search_history
        GROUP BY query_filename
        ORDER BY search_count DESC
        LIMIT :limit
    """), {"limit": limit}).fetchall()

    # Günlük arama trendi (son 30 gün)
    daily = db.execute(text("""
        SELECT
            DATE(searched_at) AS day,
            COUNT(*)          AS cnt
        FROM search_history
        WHERE searched_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(searched_at)
        ORDER BY day
    """)).fetchall()

    # Toplam istatistikler
    summary = db.execute(text("""
        SELECT
            COUNT(*)               AS total_searches,
            AVG(result_count)      AS avg_results,
            AVG(min_similarity)    AS avg_threshold
        FROM search_history
    """)).fetchone()

    return {
        "top_files": [
            {
                "filename":     r.query_filename,
                "search_count": r.search_count,
                "avg_results":  round(float(r.avg_results or 0), 1),
                "last_searched": str(r.last_searched) if r.last_searched else None,
            }
            for r in top_searches
        ],
        "daily_searches": [
            {"day": str(r.day), "count": r.cnt}
            for r in daily
        ],
        "summary": {
            "total_searches": summary.total_searches or 0,
            "avg_results":    round(float(summary.avg_results or 0), 1),
            "avg_threshold":  round(float(summary.avg_threshold or 0.5) * 100, 1),
        },
    }
