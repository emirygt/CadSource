"""
attr_search.py — Attribute-based filter search across built-in + custom attributes
"""
import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema
from logger import get_logger as _get_logger

_log = _get_logger("routes.attr_search")
router = APIRouter(tags=["attr_search"])


class AttrFilter(BaseModel):
    name: str
    data_type: str          # text | number | boolean | select
    value: Optional[Any] = None   # text / boolean / select
    min: Optional[float] = None   # number range lower bound
    max: Optional[float] = None   # number range upper bound


class AttrSearchRequest(BaseModel):
    category_id: Optional[int] = None
    formats: List[str] = []
    entity_min: Optional[int] = None
    entity_max: Optional[int] = None
    bbox_w_min: Optional[float] = None
    bbox_w_max: Optional[float] = None
    bbox_h_min: Optional[float] = None
    bbox_h_max: Optional[float] = None
    layer: Optional[str] = None
    attr_filters: List[AttrFilter] = []
    page: int = Field(1, ge=1)
    per_page: int = Field(24, ge=1, le=100)


@router.post("/attr-search")
def attr_search(
    body: AttrSearchRequest,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)

    clauses: list[str] = []
    params: dict = {}

    if body.category_id is not None:
        clauses.append("f.category_id = :cat_id")
        params["cat_id"] = body.category_id

    if body.formats:
        fmts = [x.strip().lower() for x in body.formats if x.strip()]
        if fmts:
            clauses.append("LOWER(f.file_format) = ANY(CAST(:formats AS text[]))")
            params["formats"] = fmts

    if body.entity_min is not None:
        clauses.append("f.entity_count >= :entity_min")
        params["entity_min"] = body.entity_min
    if body.entity_max is not None:
        clauses.append("f.entity_count <= :entity_max")
        params["entity_max"] = body.entity_max

    if body.bbox_w_min is not None:
        clauses.append("f.bbox_width >= :bwmin")
        params["bwmin"] = body.bbox_w_min
    if body.bbox_w_max is not None:
        clauses.append("f.bbox_width <= :bwmax")
        params["bwmax"] = body.bbox_w_max
    if body.bbox_h_min is not None:
        clauses.append("f.bbox_height >= :bhmin")
        params["bhmin"] = body.bbox_h_min
    if body.bbox_h_max is not None:
        clauses.append("f.bbox_height <= :bhmax")
        params["bhmax"] = body.bbox_h_max

    if body.layer:
        clauses.append("f.layers::jsonb ? :layer_kw")
        params["layer_kw"] = body.layer

    for i, af in enumerate(body.attr_filters):
        has_value = af.value is not None and str(af.value).strip() != ""
        has_range = af.min is not None or af.max is not None
        if not has_value and not has_range:
            continue
        params[f"aname_{i}"] = af.name
        if af.data_type == "text":
            clauses.append(f"LOWER(COALESCE(f.attributes->>:aname_{i}, '')) LIKE :aval_{i}")
            params[f"aval_{i}"] = f"%{str(af.value).lower()}%"
        elif af.data_type == "select" and has_value:
            clauses.append(f"f.attributes->>:aname_{i} = :aval_{i}")
            params[f"aval_{i}"] = str(af.value)
        elif af.data_type == "boolean" and has_value:
            clauses.append(f"(f.attributes->>:aname_{i})::boolean = :aval_{i}")
            params[f"aval_{i}"] = bool(af.value)
        elif af.data_type == "number":
            if af.min is not None:
                clauses.append(f"(f.attributes->>:aname_{i})::float >= :amin_{i}")
                params[f"amin_{i}"] = af.min
            if af.max is not None:
                clauses.append(f"(f.attributes->>:aname_{i})::float <= :amax_{i}")
                params[f"amax_{i}"] = af.max

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    total = db.execute(text(f"SELECT COUNT(*) FROM cad_files f {where}"), params).scalar()

    list_sql = f"""
        SELECT f.id, f.filename, f.file_format, f.jpg_preview,
               f.entity_count, f.layer_count, f.bbox_width, f.bbox_height,
               f.indexed_at, f.category_id, f.approval_status,
               COALESCE(f.attributes, '{{}}') AS attributes,
               c.name AS category_name, c.color AS category_color
        FROM cad_files f
        LEFT JOIN categories c ON c.id = f.category_id
        {where}
        ORDER BY f.indexed_at DESC, f.id DESC
        OFFSET :offset LIMIT :per_page
    """
    params["offset"] = (body.page - 1) * body.per_page
    params["per_page"] = body.per_page

    rows = db.execute(text(list_sql), params).mappings().all()

    files = []
    for r in rows:
        attrs_raw = r["attributes"]
        attrs: dict = json.loads(attrs_raw) if isinstance(attrs_raw, str) else (attrs_raw or {})
        files.append({
            "id": r["id"],
            "filename": r["filename"],
            "file_format": r["file_format"],
            "jpg_preview": r["jpg_preview"],
            "entity_count": r["entity_count"],
            "layer_count": r["layer_count"],
            "bbox_width": r["bbox_width"],
            "bbox_height": r["bbox_height"],
            "indexed_at": r["indexed_at"].isoformat() if r["indexed_at"] else None,
            "category_id": r["category_id"],
            "category_name": r["category_name"],
            "category_color": r["category_color"],
            "approval_status": r["approval_status"],
            "attributes": attrs,
        })

    _log.info("[ATTR-SEARCH] filters=%d results=%d/%d", len(clauses), len(files), total)
    return {"total": total, "page": body.page, "per_page": body.per_page, "files": files}
