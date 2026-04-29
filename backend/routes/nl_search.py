"""
nl_search.py — Doğal dil araması: metin → CLIP vektör → pgvector cosine search
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema
import clip_encoder
from schemas.nl_search import NLSearchRequest, NLSearchResponse, NLSearchResultItem
from logger import get_logger as _get_logger

_log = _get_logger("routes.nl_search")

router = APIRouter(tags=["nl_search"])


@router.post("/nl-search", response_model=NLSearchResponse)
async def natural_language_search(
    body: NLSearchRequest,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)

    query_vec = clip_encoder.encode_text(body.query)
    if query_vec is None:
        raise HTTPException(status_code=500, detail="CLIP text encode başarısız")

    cat_filter = "AND cf.category_id = :cid" if body.category_id else ""
    sql = f"""
        SELECT cf.id, cf.filename, cf.file_format, cf.jpg_preview,
               cf.category_id, c.name AS category_name,
               cf.entity_count, cf.bbox_width, cf.bbox_height, cf.layers,
               1 - (cf.clip_vector <=> CAST(:qv AS vector)) AS similarity
        FROM cad_files cf
        LEFT JOIN categories c ON cf.category_id = c.id
        WHERE cf.clip_vector IS NOT NULL
          AND cf.approval_status = 'approved'
          {cat_filter}
        ORDER BY cf.clip_vector <=> CAST(:qv AS vector)
        LIMIT :top_k
    """
    params: dict = {"qv": str(query_vec.tolist()), "top_k": body.top_k}
    if body.category_id:
        params["cid"] = body.category_id

    rows = db.execute(text(sql), params).mappings().all()
    filtered = [r for r in rows if (r["similarity"] or 0) >= body.min_similarity]

    results = []
    for r in filtered:
        layers = r["layers"]
        if isinstance(layers, str):
            import json
            try:
                layers = json.loads(layers)
            except Exception:
                layers = None
        results.append(NLSearchResultItem(
            id=r["id"],
            filename=r["filename"],
            file_format=r["file_format"],
            similarity=round(float(r["similarity"] or 0), 4),
            jpg_preview=r["jpg_preview"],
            category_id=r["category_id"],
            category_name=r["category_name"],
            entity_count=r["entity_count"],
            bbox_width=r["bbox_width"],
            bbox_height=r["bbox_height"],
            layers=layers,
        ))

    _log.info("[NL-SEARCH] query=%r matches=%d", body.query, len(results))
    return NLSearchResponse(query=body.query, total_matches=len(results), results=results)
