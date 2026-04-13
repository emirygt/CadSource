"""
search.py — Vektör benzerlik araması (auth entegreli)
"""
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text, bindparam
from typing import Optional, Tuple, List
from pydantic import BaseModel
import base64
import io
import math
from collections import Counter, defaultdict

import numpy as np

from db import get_db
from features import (
    parse_dxf_bytes,
    extract_features,
    extract_stats,
    generate_jpg_preview_from_bytes,
    _dwg_to_dxf_bytes,
    _is_binary_dwg,
    _extract_from_doc,
    DWG2DXF_BIN,
)
from middleware.tenant import get_current_tenant, apply_tenant_schema
from clip_encoder import extract_clip_vector, extract_clip_vector_from_bytes

router = APIRouter(tags=["search"])


class BulkApprovePayload(BaseModel):
    file_ids: List[int]
    approved: Optional[bool] = None
    status: Optional[str] = None


def _normalize_status(status: Optional[str], approved: Optional[bool] = None) -> str:
    if status is not None:
        s = str(status).strip().lower()
        if s in ("uploaded", "yuklendi", "yüklendi"):
            return "uploaded"
        if s in ("approved", "onayli", "onaylı"):
            return "approved"
        if s in ("draft", "taslak"):
            return "draft"
        raise HTTPException(status_code=400, detail="Geçersiz status. 'uploaded', 'draft' veya 'approved' olmalı.")
    if approved is not None:
        return "approved" if approved else "draft"
    return "uploaded"


def _parse_error_detail(filename: str, is_dwg: bool) -> str:
    if is_dwg:
        if DWG2DXF_BIN is None:
            return (
                f"'{filename}' okunamadı. Sunucuda DWG dönüştürücü (dwg2dxf) kurulu değil. "
                "VPS/backend imajına LibreDWG kurup `dwg2dxf` komutunu erişilebilir yapın."
            )
        return (
            f"'{filename}' okunamadı. DWG dosyası bozuk olabilir veya sürümü desteklenmiyor "
            "(özellikle R12 ve öncesi)."
        )
    return f"'{filename}' okunamadı. Geçerli bir DXF/DWG dosyası yükleyin."


def _decode_image_data_url(data_url: Optional[str]) -> Optional[bytes]:
    if not data_url or not data_url.startswith("data:image/"):
        return None
    parts = data_url.split(",", 1)
    if len(parts) != 2:
        return None
    header, payload = parts
    if ";base64" not in header:
        return None
    try:
        return base64.b64decode(payload)
    except Exception:
        return None


def _to_silhouette_mask(image_bytes: Optional[bytes], size: int = 128) -> Optional[np.ndarray]:
    if image_bytes is None:
        return None
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("L")
        arr = np.array(img, dtype=np.uint8)
    except Exception:
        return None

    # Bu projedeki preview'ler açık zemin + koyu şekil.
    mask = arr < 170
    if not np.any(mask):
        return None

    ys, xs = np.where(mask)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    crop = mask[y0:y1, x0:x1]
    if crop.size == 0:
        return None

    h, w = crop.shape
    side = max(h, w)
    square = np.zeros((side, side), dtype=np.uint8)
    oy = (side - h) // 2
    ox = (side - w) // 2
    square[oy:oy + h, ox:ox + w] = crop.astype(np.uint8)

    # Nearest: siluet kenarlarını koru.
    from PIL import Image
    pil = Image.fromarray(square * 255, mode="L")
    if hasattr(Image, "Resampling"):
        pil = pil.resize((size, size), resample=Image.Resampling.NEAREST)
    else:
        pil = pil.resize((size, size), resample=Image.NEAREST)

    return (np.array(pil) > 0)


def _cosine_1d(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.clip(float(np.dot(a, b)) / (na * nb), 0.0, 1.0))


def _shape_similarity(mask_a: Optional[np.ndarray], mask_b: Optional[np.ndarray]) -> Optional[float]:
    if mask_a is None or mask_b is None:
        return None

    def _sim(a: np.ndarray, b: np.ndarray) -> float:
        inter = np.logical_and(a, b).sum()
        union = np.logical_or(a, b).sum()
        iou = float(inter / union) if union > 0 else 0.0

        ha = a.mean(axis=1)
        hb = b.mean(axis=1)
        va = a.mean(axis=0)
        vb = b.mean(axis=0)
        proj_h = _cosine_1d(ha, hb)
        proj_v = _cosine_1d(va, vb)

        fill_a = float(a.mean())
        fill_b = float(b.mean())
        fill_sim = max(0.0, 1.0 - abs(fill_a - fill_b) / max(fill_a, fill_b, 1e-6))
        return float(0.55 * iou + 0.25 * proj_h + 0.15 * proj_v + 0.05 * fill_sim)

    # Ayna toleransı: sağ-sol ters çizimlerde gereksiz ceza olmasın.
    s1 = _sim(mask_a, mask_b)
    s2 = _sim(mask_a, np.fliplr(mask_b))
    return max(s1, s2)


def _geometry_guard(query_stats: dict, row) -> float:
    q_w = max(float(query_stats.get("bbox_width") or 0.0), 1e-6)
    q_h = max(float(query_stats.get("bbox_height") or 0.0), 1e-6)
    q_e = max(float(query_stats.get("entity_count") or 0.0), 1.0)

    c_w = max(float(row.bbox_width or 0.0), 1e-6)
    c_h = max(float(row.bbox_height or 0.0), 1e-6)
    c_e = max(float(row.entity_count or 0.0), 1.0)

    q_ar = q_w / q_h
    c_ar = c_w / c_h
    ar_diff = abs(math.log(max(q_ar, 1e-6)) - math.log(max(c_ar, 1e-6)))
    ar_sim = math.exp(-1.2 * ar_diff)  # 1'e yakınsa oranlar yakın

    ent_ratio = min(q_e, c_e) / max(q_e, c_e)
    guard = (0.55 + 0.45 * ar_sim) * (0.65 + 0.35 * ent_ratio)

    # Çok uç farklarda ekstra fren
    if ent_ratio < 0.45:
        guard *= 0.8
    if ar_sim < 0.45:
        guard *= 0.8

    return float(max(0.0, min(1.0, guard)))


def _safe_round(value, digits: int = 6):
    try:
        v = float(value)
    except Exception:
        return None
    if not math.isfinite(v):
        return None
    return round(v, digits)


def _json_safe(value):
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return float(round(value, 6))
    return value


def _dwg_version_code(content: bytes) -> Optional[str]:
    if not content or len(content) < 6:
        return None
    if content[:2] != b"AC":
        return None
    try:
        return content[:6].decode("ascii", errors="ignore")
    except Exception:
        return None


def _dwg_version_label(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    mapping = {
        "AC1009": "AutoCAD R12",
        "AC1012": "AutoCAD R13",
        "AC1014": "AutoCAD R14",
        "AC1015": "AutoCAD 2000",
        "AC1018": "AutoCAD 2004",
        "AC1021": "AutoCAD 2007",
        "AC1024": "AutoCAD 2010",
        "AC1027": "AutoCAD 2013",
        "AC1032": "AutoCAD 2018+",
    }
    return mapping.get(code)


def _insunits_label(code) -> Optional[str]:
    if code is None:
        return None
    try:
        c = int(code)
    except Exception:
        return str(code)
    units = {
        0: "Unitless",
        1: "Inches",
        2: "Feet",
        3: "Miles",
        4: "Millimeters",
        5: "Centimeters",
        6: "Meters",
        7: "Kilometers",
        8: "Microinches",
        9: "Mils",
        10: "Yards",
        11: "Angstroms",
        12: "Nanometers",
        13: "Microns",
        14: "Decimeters",
        15: "Decameters",
        16: "Hectometers",
        17: "Gigameters",
        18: "Astronomical Units",
        19: "Light Years",
        20: "Parsecs",
    }
    return units.get(c, f"Code {c}")


def _arc_endpoints(cx: float, cy: float, r: float, start_deg: float, end_deg: float) -> Tuple[tuple, tuple]:
    s = math.radians(float(start_deg))
    e = math.radians(float(end_deg))
    return (
        (cx + r * math.cos(s), cy + r * math.sin(s)),
        (cx + r * math.cos(e), cy + r * math.sin(e)),
    )


def _arc_sweep_rad(start_deg: float, end_deg: float) -> float:
    s = math.radians(float(start_deg))
    e = math.radians(float(end_deg))
    while e <= s:
        e += 2 * math.pi
    return e - s


def _point_xy(value) -> Optional[tuple]:
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        try:
            return float(value[0]), float(value[1])
        except Exception:
            return None
    x = getattr(value, "x", None)
    y = getattr(value, "y", None)
    if x is None or y is None:
        return None
    try:
        return float(x), float(y)
    except Exception:
        return None


def _poly_area_abs(points: list) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return abs(0.5 * area)


def _build_segment_metrics(entities: list) -> dict:
    segments = []
    degree = Counter()
    node_index = {}
    circle_area_total = 0.0
    closed_contour_area_total = 0.0

    line_total = 0.0
    arc_total = 0.0
    circle_total = 0.0
    poly_total = 0.0

    unknown_arc_count = 0
    closed_entity_hints = 0

    def _node_id(pt: tuple) -> int:
        key = (round(pt[0], 6), round(pt[1], 6))
        if key not in node_index:
            node_index[key] = len(node_index)
        return node_index[key]

    def _add_seg(a: tuple, b: tuple):
        ia = _node_id(a)
        ib = _node_id(b)
        segments.append((ia, ib))
        degree[ia] += 1
        degree[ib] += 1

    for ent in entities:
        et = str(ent.get("type", "")).upper()

        if et == "LINE":
            try:
                x1, y1 = float(ent.get("x1", 0.0)), float(ent.get("y1", 0.0))
                x2, y2 = float(ent.get("x2", 0.0)), float(ent.get("y2", 0.0))
                _add_seg((x1, y1), (x2, y2))
                line_total += float(ent.get("length", math.hypot(x2 - x1, y2 - y1)))
            except Exception:
                continue
            continue

        if et == "ARC":
            try:
                if all(k in ent for k in ("cx", "cy", "r", "start_angle", "end_angle")):
                    cx = float(ent["cx"])
                    cy = float(ent["cy"])
                    r = abs(float(ent["r"]))
                    sa = float(ent["start_angle"])
                    ea = float(ent["end_angle"])
                    a, b = _arc_endpoints(cx, cy, r, sa, ea)
                    _add_seg(a, b)
                    arc_total += r * _arc_sweep_rad(sa, ea)
                else:
                    unknown_arc_count += 1
            except Exception:
                unknown_arc_count += 1
            continue

        if et == "CIRCLE":
            try:
                r = abs(float(ent.get("r", 0.0)))
                if r > 0:
                    circle_total += 2.0 * math.pi * r
                    circle_area_total += math.pi * r * r
                    closed_entity_hints += 1
            except Exception:
                pass
            continue

        if et in ("LWPOLYLINE", "POLYLINE"):
            raw_pts = ent.get("points", []) or []
            pts = [_point_xy(p) for p in raw_pts]
            pts = [p for p in pts if p is not None]
            if len(pts) >= 2:
                for i in range(len(pts) - 1):
                    _add_seg(pts[i], pts[i + 1])
                    poly_total += math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
                if bool(ent.get("closed")) and len(pts) >= 3:
                    _add_seg(pts[-1], pts[0])
                    poly_total += math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1])
                    closed_contour_area_total += _poly_area_abs(pts)
                    closed_entity_hints += 1
            continue

        if et == "HATCH":
            polys = ent.get("polygons", []) or []
            for poly in polys:
                pts = [_point_xy(p) for p in poly]
                pts = [p for p in pts if p is not None]
                if len(pts) < 3:
                    continue
                for i in range(len(pts)):
                    p1 = pts[i]
                    p2 = pts[(i + 1) % len(pts)]
                    _add_seg(p1, p2)
                    poly_total += math.hypot(p2[0] - p1[0], p2[1] - p1[1])
                closed_contour_area_total += _poly_area_abs(pts)
                closed_entity_hints += 1

    if segments:
        parent = {}

        def find(x: int) -> int:
            if parent[x] != x:
                parent[x] = find(parent[x])
            return parent[x]

        def union(a: int, b: int):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        for n in degree.keys():
            parent[n] = n
        for a, b in segments:
            union(a, b)
        components = len({find(n) for n in degree.keys()})
    else:
        components = 0

    node_count = len(degree)
    seg_count = len(segments)
    odd_node_count = sum(1 for v in degree.values() if v % 2 == 1)
    cycle_rank = max(seg_count - node_count + components, 0) if seg_count > 0 else 0

    return {
        "segment_count": seg_count,
        "node_count": node_count,
        "odd_node_count": odd_node_count,
        "component_count": components,
        "cycle_rank_estimate": cycle_rank,
        "closed_graph_hint": bool(seg_count > 0 and odd_node_count == 0),
        "closed_entity_hints": closed_entity_hints,
        "line_total_length": line_total,
        "arc_total_length": arc_total,
        "circle_total_length": circle_total,
        "polyline_total_length": poly_total,
        "path_total_length": (line_total + arc_total + circle_total + poly_total),
        "unknown_arc_count": unknown_arc_count,
        "circle_area_total": circle_area_total,
        "closed_contour_area_total": closed_contour_area_total,
    }


def _preview_fill_ratio(image_bytes: Optional[bytes]) -> Optional[float]:
    if not image_bytes:
        return None
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("L")
        arr = np.array(img, dtype=np.uint8)
    except Exception:
        return None
    if arr.size == 0:
        return None
    mask = arr < 170
    return float(mask.mean())


def _try_parse_with_recover(content: bytes, filename: str) -> Tuple[Optional[dict], dict]:
    meta = {}
    try:
        from ezdxf import recover
    except Exception as e:
        meta["recover_error"] = f"ezdxf recover yok: {e}"
        return None, meta

    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    dxf_bytes = content
    if ext == "dwg" or _is_binary_dwg(content):
        dxf_bytes = _dwg_to_dxf_bytes(content, filename)
        if dxf_bytes is None:
            meta["recover_error"] = "dwg2dxf dönüşümü başarısız"
            return None, meta

    try:
        doc, _ = recover.read(io.BytesIO(dxf_bytes))
        data = _extract_from_doc(doc)
        meta["insunits_code"] = doc.header.get("$INSUNITS")
        meta["measurement_code"] = doc.header.get("$MEASUREMENT")
        return data, meta
    except Exception as e:
        meta["recover_error"] = str(e)
        return None, meta


def _parse_quality_score(data: Optional[dict]) -> int:
    if not data:
        return -1
    entities = data.get("entities", []) or []
    rich_arc = 0
    with_points = 0
    for e in entities:
        if e.get("type") == "ARC" and all(k in e for k in ("cx", "cy", "start_angle", "end_angle", "r")):
            rich_arc += 1
        if e.get("points"):
            with_points += 1
    return int(len(entities) * 10 + rich_arc * 5 + with_points)


def _parse_for_analysis(content: bytes, filename: str) -> Tuple[Optional[dict], dict]:
    primary = parse_dxf_bytes(content, filename)
    primary_score = _parse_quality_score(primary)

    recover_data, recover_meta = _try_parse_with_recover(content, filename)
    recover_score = _parse_quality_score(recover_data)

    parser_used = "parse_dxf_bytes"
    chosen = primary
    if recover_data is not None and recover_score > primary_score:
        chosen = recover_data
        parser_used = "recover"

    meta = {
        "parser_used": parser_used,
        "primary_quality_score": primary_score,
        "recover_quality_score": recover_score,
        "primary_entity_count": len((primary or {}).get("entities", []) or []),
        "recover_entity_count": len((recover_data or {}).get("entities", []) or []),
    }
    meta.update(recover_meta or {})
    return chosen, meta


def _build_file_analysis(
    file_bytes: bytes,
    filename: str,
    jpg_preview_data_url: Optional[str] = None,
    include_entities: bool = False,
) -> dict:
    data, parser_meta = _parse_for_analysis(file_bytes, filename)
    if data is None:
        return {
            "available": False,
            "reason": "Dosya parse edilemedi",
            "parser": _json_safe(parser_meta),
        }

    stats = extract_stats(data)
    entities = data.get("entities", []) or []
    layers = data.get("layers", []) or []
    entity_types = stats.get("entity_types", {}) or {}
    bbox = data.get("bbox", {}) or {}

    dims_w = float(stats.get("bbox_width") or 0.0)
    dims_h = float(stats.get("bbox_height") or 0.0)
    bbox_area = float(stats.get("bbox_area") or 0.0)
    aspect_ratio = (dims_w / dims_h) if dims_h > 0 else None
    diagonal = math.hypot(dims_w, dims_h) if dims_w > 0 or dims_h > 0 else None

    seg = _build_segment_metrics(entities)

    dominant_type = None
    dominant_ratio = None
    if entity_types:
        dominant_type = max(entity_types.items(), key=lambda kv: kv[1])[0]
        total = max(sum(entity_types.values()), 1)
        dominant_ratio = float(entity_types.get(dominant_type, 0)) / float(total)

    preview_bytes = _decode_image_data_url(jpg_preview_data_url) if jpg_preview_data_url else None
    if preview_bytes is None:
        preview_bytes = generate_jpg_preview_from_bytes(file_bytes, filename, size=700)
    fill_ratio = _preview_fill_ratio(preview_bytes)

    estimated_profile_area = (bbox_area * fill_ratio) if (fill_ratio is not None and bbox_area > 0) else None
    estimated_void_area = (bbox_area - estimated_profile_area) if estimated_profile_area is not None else None

    contour_area_sum = float(seg["closed_contour_area_total"] + seg["circle_area_total"])
    net_area_best_effort = contour_area_sum if contour_area_sum > 0 else estimated_profile_area

    ins_code = parser_meta.get("insunits_code")
    parser_meta["insunits_label"] = _insunits_label(ins_code)
    parser_meta["dwg_version_code"] = _dwg_version_code(file_bytes)
    parser_meta["dwg_version_label"] = _dwg_version_label(parser_meta.get("dwg_version_code"))

    calculations = {
        "bbox_width": dims_w,
        "bbox_height": dims_h,
        "bbox_area": bbox_area,
        "bbox_perimeter": (2.0 * (dims_w + dims_h)) if (dims_w > 0 or dims_h > 0) else None,
        "aspect_ratio": aspect_ratio,
        "diagonal_length": diagonal,
        "entity_count": int(stats.get("entity_count") or len(entities)),
        "layer_count": int(stats.get("layer_count") or len(layers)),
        "entities_per_layer": (float(stats.get("entity_count") or 0.0) / max(float(stats.get("layer_count") or 1.0), 1.0)),
        "entities_per_bbox_area": ((float(stats.get("entity_count") or 0.0) / bbox_area) if bbox_area > 0 else None),
        "dominant_entity_type": dominant_type,
        "dominant_entity_ratio": dominant_ratio,
        "line_total_length": seg["line_total_length"],
        "arc_total_length": seg["arc_total_length"],
        "circle_total_length": seg["circle_total_length"],
        "polyline_total_length": seg["polyline_total_length"],
        "path_total_length": seg["path_total_length"],
        "unknown_arc_count": seg["unknown_arc_count"],
        "segment_count": seg["segment_count"],
        "node_count": seg["node_count"],
        "odd_node_count": seg["odd_node_count"],
        "component_count": seg["component_count"],
        "cycle_rank_estimate": seg["cycle_rank_estimate"],
        "closed_graph_hint": seg["closed_graph_hint"],
        "closed_entity_hints": seg["closed_entity_hints"],
        "preview_fill_ratio": fill_ratio,
        "estimated_profile_area": estimated_profile_area,
        "estimated_void_area": estimated_void_area,
        "closed_contour_area_sum": contour_area_sum if contour_area_sum > 0 else None,
        "net_area_best_effort": net_area_best_effort,
    }

    raw = {
        "bbox": {
            "min_x": _safe_round(bbox.get("min_x")),
            "max_x": _safe_round(bbox.get("max_x")),
            "min_y": _safe_round(bbox.get("min_y")),
            "max_y": _safe_round(bbox.get("max_y")),
        },
        "layers": layers,
        "entity_types": entity_types,
        "entities_included": bool(include_entities),
        "entity_count": len(entities),
        "layer_count": len(layers),
        "entities": entities if include_entities else None,
    }

    return {
        "available": True,
        "parser": _json_safe(parser_meta),
        "calculated": _json_safe(calculations),
        "raw": _json_safe(raw),
    }


@router.post("/search")
async def search_similar(
    file: UploadFile = File(...),
    top_k: int = Query(default=10, ge=1, le=50),
    min_similarity: float = Query(default=0.2, ge=0.0, le=1.0),
    category_id: Optional[int] = Query(default=None),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """
    Yüklenen DXF dosyasına en benzer çizimleri bul.
    category_id verilirse sadece o kategori içinde arar.
    """
    apply_tenant_schema(tenant, db)

    content = await file.read()
    filename = file.filename or "upload.dxf"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    is_dwg = ext == "dwg" or _is_binary_dwg(content)

    data = parse_dxf_bytes(content, filename)
    if data is None:
        raise HTTPException(
            status_code=500 if (is_dwg and DWG2DXF_BIN is None) else 400,
            detail=_parse_error_detail(filename, is_dwg),
        )

    query_vec = extract_features(data)
    stats = extract_stats(data)
    vec_list = query_vec.tolist()

    # CLIP vektörü — yoksa sadece geometric kullan
    clip_vec = extract_clip_vector_from_bytes(content, filename, data)
    clip_vec_str = str(clip_vec.tolist()) if clip_vec is not None else None

    candidate_k = max(top_k * 6, 40)
    params: dict = {
        "vec": str(vec_list),
        "clip_vec": clip_vec_str,
        "min_sim": min_similarity,
        "candidate_k": candidate_k,
    }
    cat_clause = ""
    if category_id is not None:
        cat_clause = "AND category_id = :cat_id"
        params["cat_id"] = category_id

    # Hibrit skor: clip varsa 0.4*geo + 0.6*clip, yoksa sadece geo
    if clip_vec_str is not None:
        geo_sim_expr = "1 - (f.feature_vector <=> CAST(:vec AS vector))"
        clip_sim_expr = "1 - (f.clip_vector <=> CAST(:clip_vec AS vector))"
        base_score_expr = f"(0.4 * ({geo_sim_expr}) + 0.6 * ({clip_sim_expr}))"
        # Görsel benzerlik düşükse (render uyumsuzluğu) final skoru aşağı çek.
        similarity_expr = f"""
            CASE
                WHEN ({clip_sim_expr}) < 0.25 THEN ({base_score_expr}) * 0.65
                WHEN ({clip_sim_expr}) < 0.40 THEN ({base_score_expr}) * 0.85
                ELSE ({base_score_expr})
            END
        """
        clip_similarity_select = f"({clip_sim_expr}) AS clip_similarity,"
        where_clip = "AND f.clip_vector IS NOT NULL"
    else:
        similarity_expr = "1 - (f.feature_vector <=> CAST(:vec AS vector))"
        clip_similarity_select = "NULL::float AS clip_similarity,"
        where_clip = ""

    results = db.execute(
        text(f"""
            SELECT
                f.id, f.filename, f.filepath, f.file_format,
                f.entity_count, f.layer_count, f.layers, f.entity_types,
                f.bbox_width, f.bbox_height, f.bbox_area,
                f.jpg_preview,
                f.category_id, c.name AS category_name, c.color AS category_color,
                {clip_similarity_select}
                ({similarity_expr}) AS similarity
            FROM cad_files f
            LEFT JOIN categories c ON c.id = f.category_id
            WHERE f.feature_vector IS NOT NULL
              {where_clip}
              AND ({similarity_expr}) >= :min_sim
              {cat_clause}
            ORDER BY ({similarity_expr}) DESC
            LIMIT :candidate_k
        """),
        params,
    ).fetchall()

    query_jpg = generate_jpg_preview_from_bytes(content, filename, size=700)
    query_preview = (
        "data:image/jpeg;base64," + base64.b64encode(query_jpg).decode("ascii")
        if query_jpg else None
    )
    query_mask = _to_silhouette_mask(query_jpg) if query_jpg else None

    reranked = []
    for row in results:
        base_score = float(row.similarity)
        guard = _geometry_guard(stats, row)
        final_score = base_score * guard
        visual_similarity = None

        if query_mask is not None:
            cand_img = _decode_image_data_url(row.jpg_preview)
            cand_mask = _to_silhouette_mask(cand_img) if cand_img else None
            visual_similarity = _shape_similarity(query_mask, cand_mask)
            if visual_similarity is not None:
                # Nihai skor: SQL hibrit + görsel maske karşılaştırması + geometri guard
                final_score = (0.65 * base_score + 0.35 * visual_similarity) * guard

        if final_score >= min_similarity:
            reranked.append((row, final_score, visual_similarity, guard))

    reranked.sort(key=lambda x: x[1], reverse=True)
    reranked = reranked[:top_k]

    matches = []
    for row, final_score, visual_similarity, guard in reranked:
        matches.append({
            "id": row.id,
            "filename": row.filename,
            "filepath": row.filepath,
            "file_format": row.file_format,
            "similarity": round(float(final_score) * 100, 1),
            "entity_count": row.entity_count,
            "layer_count": row.layer_count,
            "layers": row.layers,
            "entity_types": row.entity_types,
            "bbox_width": row.bbox_width,
            "bbox_height": row.bbox_height,
            "bbox_area": row.bbox_area,
            "category_id": row.category_id,
            "category_name": row.category_name,
            "category_color": row.category_color,
            "jpg_preview": row.jpg_preview,
            "clip_similarity": round(float(row.clip_similarity) * 100, 1) if row.clip_similarity is not None else None,
            "visual_similarity": round(float(visual_similarity) * 100, 1) if visual_similarity is not None else None,
            "geometry_guard": round(float(guard) * 100, 1),
        })

    # Arama geçmişine kaydet
    try:
        db.execute(
            text("""
                INSERT INTO search_history (query_filename, top_k, min_similarity, category_id, result_count)
                VALUES (:fn, :top_k, :min_sim, :cat_id, :cnt)
            """),
            {
                "fn": filename,
                "top_k": top_k,
                "min_sim": min_similarity,
                "cat_id": category_id,
                "cnt": len(matches),
            },
        )
        db.commit()
    except Exception:
        db.rollback()

    return {
        "query_file": filename,
        "query_preview": query_preview,
        "query_stats": stats,
        "total_matches": len(matches),
        "results": matches,
    }


@router.get("/files")
def list_files(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    search: Optional[str] = Query(default=None),
    approved: Optional[bool] = Query(default=None),
    status: Optional[str] = Query(default=None),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Tenant'a ait indexlenmiş dosyaları listele."""
    apply_tenant_schema(tenant, db)

    count_q = "SELECT COUNT(*) FROM cad_files"
    params: dict = {}
    count_clauses = []
    list_clauses = []

    if search:
        params["search"] = f"%{search}%"
        count_clauses.append("filename ILIKE :search")
        list_clauses.append("f.filename ILIKE :search")
    if approved is not None:
        params["approved"] = approved
        count_clauses.append("approved = :approved")
        list_clauses.append("f.approved = :approved")
    if status is not None:
        status_norm = _normalize_status(status)
        params["status"] = status_norm
        count_clauses.append("approval_status = :status")
        list_clauses.append("f.approval_status = :status")

    if count_clauses:
        count_q += " WHERE " + " AND ".join(count_clauses)

    total = db.execute(text(count_q), params).scalar()

    list_q = """
        SELECT f.id, f.filename, f.filepath, f.file_format,
               f.entity_count, f.layer_count, f.bbox_width, f.bbox_height,
               f.indexed_at, f.svg_preview, f.jpg_preview,
               f.approved, f.approved_at, f.approval_status,
               (f.file_data IS NOT NULL) AS has_file_data,
               f.category_id,
               c.name AS category_name, c.color AS category_color
        FROM cad_files f
        LEFT JOIN categories c ON c.id = f.category_id
    """
    if list_clauses:
        list_q += " WHERE " + " AND ".join(list_clauses)
    list_q += " ORDER BY f.indexed_at DESC OFFSET :offset LIMIT :limit"
    params["offset"] = (page - 1) * per_page
    params["limit"] = per_page

    files = db.execute(text(list_q), params).fetchall()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "files": [
            {
                "id": f.id,
                "filename": f.filename,
                "filepath": f.filepath,
                "file_format": f.file_format,
                "entity_count": f.entity_count,
                "layer_count": f.layer_count,
                "bbox_width": f.bbox_width,
                "bbox_height": f.bbox_height,
                "indexed_at": f.indexed_at.isoformat() if f.indexed_at else None,
                "svg_preview": f.svg_preview,
                "jpg_preview": f.jpg_preview,
                "approved": bool(f.approved),
                "approved_at": f.approved_at.isoformat() if f.approved_at else None,
                "approval_status": f.approval_status or ("approved" if f.approved else "uploaded"),
                "has_file_data": f.has_file_data,
                "category_id": f.category_id,
                "category_name": f.category_name,
                "category_color": f.category_color,
            }
            for f in files
        ],
    }


@router.post("/files/approve/bulk")
def bulk_approve_files(
    payload: BulkApprovePayload,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)

    ids = sorted({int(x) for x in payload.file_ids if int(x) > 0})
    if not ids:
        raise HTTPException(status_code=400, detail="file_ids boş olamaz")

    status_norm = _normalize_status(payload.status, payload.approved)
    approved_bool = status_norm == "approved"

    stmt = text("""
        UPDATE cad_files
        SET
            approval_status = :approval_status,
            approved = :approved,
            approved_at = CASE WHEN :approved THEN NOW() ELSE NULL END
        WHERE id IN :ids
    """).bindparams(bindparam("ids", expanding=True))

    try:
        result = db.execute(stmt, {
            "approval_status": status_norm,
            "approved": approved_bool,
            "ids": ids,
        })
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Toplu durum atama başarısız")

    return {
        "status": "ok",
        "approved": approved_bool,
        "approval_status": status_norm,
        "updated_count": int(result.rowcount or 0),
    }


@router.get("/files/{file_id}")
def get_file(
    file_id: int,
    include_analysis: bool = Query(default=False),
    include_entities: bool = Query(default=False),
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(
        text("""
            SELECT
                f.id, f.filename, f.filepath, f.file_format, f.indexed_at,
                f.entity_count, f.layer_count, f.layers, f.entity_types,
                f.bbox_width, f.bbox_height, f.bbox_area,
                f.approved, f.approved_at, f.approval_status,
                f.svg_preview, f.jpg_preview, f.category_id,
                c.name AS category_name, c.color AS category_color,
                (f.file_data IS NOT NULL) AS has_file_data,
                OCTET_LENGTH(f.file_data) AS file_size_bytes
            FROM cad_files f
            LEFT JOIN categories c ON c.id = f.category_id
            WHERE f.id = :id
        """),
        {"id": file_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    m = row._mapping
    # file_data (BYTEA) JSON serileştirmesinde sorun çıkardığı için ham bytes dönmüyoruz.
    # Frontend uyumluluğu için file_data alanını yalnızca "var/yok" flag gibi set ediyoruz.
    response = {
        "id": m["id"],
        "filename": m["filename"],
        "filepath": m["filepath"],
        "file_format": m["file_format"],
        "indexed_at": m["indexed_at"].isoformat() if m["indexed_at"] else None,
        "entity_count": m["entity_count"],
        "layer_count": m["layer_count"],
        "layers": m["layers"],
        "entity_types": m["entity_types"],
        "bbox_width": m["bbox_width"],
        "bbox_height": m["bbox_height"],
        "bbox_area": m["bbox_area"],
        "approved": bool(m["approved"]),
        "approved_at": m["approved_at"].isoformat() if m["approved_at"] else None,
        "approval_status": m["approval_status"] or ("approved" if m["approved"] else "uploaded"),
        "svg_preview": m["svg_preview"],
        "jpg_preview": m["jpg_preview"],
        "category_id": m["category_id"],
        "category_name": m["category_name"],
        "category_color": m["category_color"],
        "has_file_data": bool(m["has_file_data"]),
        "file_size_bytes": int(m["file_size_bytes"] or 0),
        "file_data": 1 if m["has_file_data"] else None,
    }
    if include_analysis:
        if not m["has_file_data"]:
            response["analysis"] = {
                "available": False,
                "reason": "Bu kayıtta ham dosya verisi yok (file_data boş).",
            }
        else:
            raw_row = db.execute(
                text("SELECT file_data FROM cad_files WHERE id = :id"),
                {"id": file_id},
            ).fetchone()
            file_bytes = bytes(raw_row.file_data) if raw_row and raw_row.file_data else None
            if not file_bytes:
                response["analysis"] = {
                    "available": False,
                    "reason": "Ham dosya verisi okunamadı.",
                }
            else:
                analysis = _build_file_analysis(
                    file_bytes=file_bytes,
                    filename=str(m["filename"] or ""),
                    jpg_preview_data_url=m["jpg_preview"],
                    include_entities=include_entities,
                )
                analysis["file_size_bytes"] = len(file_bytes)
                response["analysis"] = analysis
    return response


@router.get("/files/{file_id}/download")
def download_file(
    file_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Orijinal dosyayı indir (DB'de saklanan ham bytes)."""
    apply_tenant_schema(tenant, db)
    row = db.execute(
        text("SELECT filename, file_format, file_data FROM cad_files WHERE id = :id"),
        {"id": file_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    if not row.file_data:
        raise HTTPException(status_code=404, detail="Bu dosya için indirme verisi mevcut değil.")

    ext = (row.file_format or "dwg").lower()
    mime_map = {
        "dwg": "application/acad",
        "dxf": "application/dxf",
        "pdf": "application/pdf",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
    }
    media_type = mime_map.get(ext, "application/octet-stream")
    filename = row.filename or f"file_{file_id}.{ext}"

    return Response(
        content=bytes(row.file_data),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/files/{file_id}")
def delete_file(
    file_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    existing = db.execute(
        text("SELECT id FROM cad_files WHERE id = :id"),
        {"id": file_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    db.execute(text("DELETE FROM cad_files WHERE id = :id"), {"id": file_id})
    db.commit()
    return {"status": "deleted", "id": file_id}


@router.get("/stats")
def get_stats(
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    total = db.execute(text("SELECT COUNT(*) FROM cad_files")).scalar()
    indexed = db.execute(
        text("SELECT COUNT(*) FROM cad_files WHERE feature_vector IS NOT NULL")
    ).scalar()
    formats = db.execute(
        text("SELECT file_format, COUNT(*) FROM cad_files GROUP BY file_format")
    ).fetchall()
    return {
        "total_files": total,
        "indexed_files": indexed,
        "formats": {row[0]: row[1] for row in formats},
        "ready": total > 0,
    }
