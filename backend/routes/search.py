"""
search.py — Vektör benzerlik araması (auth entegreli)
"""
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional
import base64
import io
import math

import numpy as np

from db import get_db
from features import parse_dxf_bytes, extract_features, extract_stats, generate_jpg_preview_from_bytes
from middleware.tenant import get_current_tenant, apply_tenant_schema
from clip_encoder import extract_clip_vector, extract_clip_vector_from_bytes

router = APIRouter(tags=["search"])


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

    data = parse_dxf_bytes(content, filename)
    if data is None:
        raise HTTPException(
            status_code=400,
            detail=f"'{filename}' okunamadı. Geçerli bir DXF/DWG dosyası yükleyin."
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
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    """Tenant'a ait indexlenmiş dosyaları listele."""
    apply_tenant_schema(tenant, db)

    count_q = "SELECT COUNT(*) FROM cad_files"
    params: dict = {}

    if search:
        count_q += " WHERE filename ILIKE :search"
        params["search"] = f"%{search}%"

    total = db.execute(text(count_q), params).scalar()

    list_q = """
        SELECT f.id, f.filename, f.filepath, f.file_format,
               f.entity_count, f.layer_count, f.bbox_width, f.bbox_height,
               f.indexed_at, f.svg_preview, f.jpg_preview,
               (f.file_data IS NOT NULL) AS has_file_data,
               f.category_id,
               c.name AS category_name, c.color AS category_color
        FROM cad_files f
        LEFT JOIN categories c ON c.id = f.category_id
    """
    if search:
        list_q += " WHERE f.filename ILIKE :search"
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
                "has_file_data": f.has_file_data,
                "category_id": f.category_id,
                "category_name": f.category_name,
                "category_color": f.category_color,
            }
            for f in files
        ],
    }


@router.get("/files/{file_id}")
def get_file(
    file_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(
        text("""
            SELECT
                id, filename, filepath, file_format, indexed_at,
                entity_count, layer_count, layers, entity_types,
                bbox_width, bbox_height, bbox_area,
                svg_preview, jpg_preview, category_id,
                (file_data IS NOT NULL) AS has_file_data
            FROM cad_files
            WHERE id = :id
        """),
        {"id": file_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    m = row._mapping
    # file_data (BYTEA) JSON serileştirmesinde sorun çıkardığı için ham bytes dönmüyoruz.
    # Frontend uyumluluğu için file_data alanını yalnızca "var/yok" flag gibi set ediyoruz.
    return {
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
        "svg_preview": m["svg_preview"],
        "jpg_preview": m["jpg_preview"],
        "category_id": m["category_id"],
        "has_file_data": bool(m["has_file_data"]),
        "file_data": 1 if m["has_file_data"] else None,
    }


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
