"""
nl_search.py — Doğal dil araması: CLIP + metadata keyword hybrid search
"""
import json
import re
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema
import clip_encoder
from schemas.nl_search import NLSearchRequest, NLSearchResponse, NLSearchResultItem
from logger import get_logger as _get_logger

_log = _get_logger("routes.nl_search")

router = APIRouter(tags=["nl_search"])

_STOPWORDS = {"bir", "var", "var", "mı", "mi", "mu", "mü", "de", "da", "ile", "ve", "veya",
              "olan", "gibi", "olan", "için", "bu", "şu", "o", "the", "a", "an", "with",
              "and", "or", "for", "in", "on", "of", "is", "are", "any", "have", "has"}


def _keywords(query: str) -> list[str]:
    tokens = re.findall(r"[a-zA-ZğüşöçıİĞÜŞÖÇ0-9]+", query.lower())
    return [t for t in tokens if len(t) >= 2 and t not in _STOPWORDS]


def _parse_layers(val) -> list[str] | None:
    if val is None:
        return None
    if isinstance(val, list):
        return val
    try:
        return json.loads(val)
    except Exception:
        return None


def _build_item(r: dict, score: float) -> NLSearchResultItem:
    return NLSearchResultItem(
        id=r["id"],
        filename=r["filename"],
        file_format=r["file_format"],
        similarity=round(score, 4),
        jpg_preview=r["jpg_preview"],
        category_id=r["category_id"],
        category_name=r["category_name"],
        entity_count=r["entity_count"],
        bbox_width=r["bbox_width"],
        bbox_height=r["bbox_height"],
        layers=_parse_layers(r["layers"]),
    )


@router.post("/nl-search", response_model=NLSearchResponse)
async def natural_language_search(
    body: NLSearchRequest,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)

    keywords = _keywords(body.query)
    cat_filter = "AND cf.category_id = :cid" if body.category_id else ""

    # ── 1) CLIP search ──────────────────────────────────────────────────────
    clip_rows: dict[int, dict] = {}
    clip_scores: dict[int, float] = {}

    query_vec = clip_encoder.encode_text(body.query)
    if query_vec is not None:
        sql_clip = f"""
            SELECT cf.id, cf.filename, cf.file_format, cf.jpg_preview,
                   cf.category_id, c.name AS category_name,
                   cf.entity_count, cf.bbox_width, cf.bbox_height, cf.layers,
                   1 - (cf.clip_vector <=> CAST(:qv AS vector)) AS clip_sim
            FROM cad_files cf
            LEFT JOIN categories c ON cf.category_id = c.id
            WHERE cf.clip_vector IS NOT NULL
              {cat_filter}
            ORDER BY cf.clip_vector <=> CAST(:qv AS vector)
            LIMIT :top_k
        """
        params_clip: dict = {"qv": str(query_vec.tolist()), "top_k": body.top_k * 3}
        if body.category_id:
            params_clip["cid"] = body.category_id

        for r in db.execute(text(sql_clip), params_clip).mappings().all():
            rid = r["id"]
            clip_rows[rid] = dict(r)
            clip_scores[rid] = float(r["clip_sim"] or 0)

    # ── 2) Keyword search on filename / layers / category_name ──────────────
    kw_rows: dict[int, dict] = {}
    kw_scores: dict[int, float] = {}

    if keywords:
        ilike_parts = []
        kw_params: dict = {}
        for i, kw in enumerate(keywords[:10]):
            k = f"kw{i}"
            kw_params[k] = f"%{kw}%"
            ilike_parts.append(
                f"(LOWER(cf.filename) LIKE :{k} OR LOWER(c.name) LIKE :{k} OR LOWER(cf.layers::text) LIKE :{k})"
            )
        where_kw = "(" + " OR ".join(ilike_parts) + ")"
        if body.category_id:
            kw_params["cid"] = body.category_id

        sql_kw = f"""
            SELECT cf.id, cf.filename, cf.file_format, cf.jpg_preview,
                   cf.category_id, c.name AS category_name,
                   cf.entity_count, cf.bbox_width, cf.bbox_height, cf.layers
            FROM cad_files cf
            LEFT JOIN categories c ON cf.category_id = c.id
            WHERE {where_kw}
              {cat_filter}
            LIMIT :top_k
        """
        kw_params["top_k"] = body.top_k * 3

        for r in db.execute(text(sql_kw), kw_params).mappings().all():
            rid = r["id"]
            kw_rows[rid] = dict(r)
            # count how many keywords match across all text fields
            combined_text = " ".join(filter(None, [
                (r["filename"] or "").lower(),
                (r["category_name"] or "").lower(),
                (r["layers"] or "").lower() if isinstance(r["layers"], str) else "",
            ]))
            hit_count = sum(1 for kw in keywords if kw in combined_text)
            kw_scores[rid] = min(hit_count / max(len(keywords), 1), 1.0)

    # ── 3) Merge: score = max(clip * 0.5, kw * 0.8) so keyword wins for metadata
    all_ids = set(clip_rows) | set(kw_rows)
    merged: list[tuple[float, dict]] = []
    for rid in all_ids:
        cs = clip_scores.get(rid, 0.0)
        ks = kw_scores.get(rid, 0.0)
        # keyword hit is weighted higher since CLIP text→image is weak for TR
        score = max(cs * 0.5, ks * 0.8)
        row = clip_rows.get(rid) or kw_rows[rid]
        if score >= body.min_similarity * 0.5 or ks > 0:
            merged.append((score, row))

    merged.sort(key=lambda x: x[0], reverse=True)
    merged = merged[:body.top_k]

    results = [_build_item(row, score) for score, row in merged]
    _log.info("[NL-SEARCH] query=%r clip=%d kw=%d merged=%d", body.query, len(clip_rows), len(kw_rows), len(results))
    return NLSearchResponse(query=body.query, total_matches=len(results), results=results)
