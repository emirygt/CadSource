"""
model3d.py — DXF/DWG profilini 3D GLB'ye çeviren endpoint.
Akış: ham dosya → DXF → polygon çıkar → trimesh extrude → GLB
"""
import io
import math
from typing import Optional, List, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema
from features import _dwg_to_dxf_bytes, _is_binary_dwg
from logger import get_logger as _get_logger

_log = _get_logger("routes.model3d")
router = APIRouter(tags=["model3d"])

# Extrude uzunluğu: bbox'un kısa kenarının %80'i, min 5 max 60 birim
_MIN_DEPTH = 5.0
_MAX_DEPTH = 60.0
_DEPTH_RATIO = 0.8
_ARC_SEGS = 32  # Arc tessellasyon segmenti


# ── Yardımcı: arc → nokta listesi ────────────────────────────────────────────

def _arc_points(cx: float, cy: float, r: float,
                start_deg: float, end_deg: float) -> List[Tuple[float, float]]:
    start = math.radians(start_deg)
    end = math.radians(end_deg)
    if end <= start:
        end += 2 * math.pi
    pts = []
    for i in range(_ARC_SEGS + 1):
        a = start + (end - start) * i / _ARC_SEGS
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _circle_points(cx: float, cy: float, r: float) -> List[Tuple[float, float]]:
    return [(cx + r * math.cos(2 * math.pi * i / _ARC_SEGS),
             cy + r * math.sin(2 * math.pi * i / _ARC_SEGS))
            for i in range(_ARC_SEGS)]


# ── Yardımcı: LWPOLYLINE/POLYLINE → nokta listesi ────────────────────────────

def _lwpoly_points(entity) -> Optional[List[Tuple[float, float]]]:
    try:
        pts = []
        verts = list(entity.get_points("xyb"))
        for i, (x, y, bulge) in enumerate(verts):
            pts.append((x, y))
            if abs(bulge) > 1e-6:
                nx, ny, _ = verts[(i + 1) % len(verts)]
                # Bulge → arc
                d = math.hypot(nx - x, ny - y)
                if d < 1e-9:
                    continue
                r = d * (1 + bulge ** 2) / (4 * abs(bulge))
                theta = 2 * math.atan(abs(bulge))
                mid_angle = math.atan2(ny - y, nx - x)
                if bulge > 0:
                    center_angle = mid_angle - (math.pi / 2 - theta)
                else:
                    center_angle = mid_angle + (math.pi / 2 - theta)
                cx2 = x + r * math.cos(center_angle)
                cy2 = y + r * math.sin(center_angle)
                sa = math.degrees(math.atan2(y - cy2, x - cx2))
                ea = math.degrees(math.atan2(ny - cy2, nx - cx2))
                if bulge < 0:
                    sa, ea = ea, sa
                arc_pts = _arc_points(cx2, cy2, r, sa, ea)
                pts.extend(arc_pts[1:])
        return pts if len(pts) >= 3 else None
    except Exception:
        return None


def _poly_points(entity) -> Optional[List[Tuple[float, float]]]:
    try:
        verts = list(entity.vertices)
        pts = [(v.dxf.location.x, v.dxf.location.y) for v in verts]
        return pts if len(pts) >= 3 else None
    except Exception:
        return None


# ── LINE + ARC zinciri → kapalı halkalar ─────────────────────────────────────

def _chain_line_arc(msp) -> List[List[Tuple[float, float]]]:
    """
    LINE ve ARC entity'lerini shapely polygonize ile kapalı halkalara çevir.
    """
    from shapely.geometry import LineString
    from shapely.ops import unary_union, polygonize

    line_strings = []
    for ent in msp:
        etype = ent.dxftype()
        try:
            if etype == "LINE":
                s = ent.dxf.start
                e = ent.dxf.end
                if math.hypot(s.x - e.x, s.y - e.y) > 1e-9:
                    line_strings.append(LineString([(s.x, s.y), (e.x, e.y)]))
            elif etype == "ARC":
                c = ent.dxf.center
                r = ent.dxf.radius
                sa = ent.dxf.start_angle
                ea = ent.dxf.end_angle
                pts = _arc_points(c.x, c.y, r, sa, ea)
                if len(pts) >= 2:
                    line_strings.append(LineString(pts))
        except Exception:
            pass

    if not line_strings:
        return []

    merged = unary_union(line_strings)
    polys = list(polygonize(merged))
    rings = []
    for poly in polys:
        coords = list(poly.exterior.coords)
        if len(coords) >= 3:
            rings.append([(x, y) for x, y in coords])
    return rings


# ── Ana polygon çıkarıcı ──────────────────────────────────────────────────────

def _extract_rings(dxf_bytes: bytes) -> Tuple[Optional[List], List[List]]:
    """
    DXF bytes'tan kapalı konturları çıkar.
    Dönüş: (outer_ring, [hole_ring, ...])
    outer_ring = en büyük alan kapalı çokgen
    """
    import ezdxf
    from ezdxf import recover

    try:
        doc, _ = recover.read(io.BytesIO(dxf_bytes))
    except Exception:
        try:
            doc = ezdxf.read(io.StringIO(dxf_bytes.decode("utf-8", errors="replace")))
        except Exception as e:
            _log.warning("DXF parse hatası: %s", e)
            return None, []

    msp = doc.modelspace()
    rings = []
    etype_counts: dict = {}

    for ent in msp:
        etype = ent.dxftype()
        etype_counts[etype] = etype_counts.get(etype, 0) + 1
        pts = None

        if etype == "LWPOLYLINE":
            flag_closed = bool(getattr(ent, 'closed', False)) or bool(ent.dxf.get('flags', 0) & 1)
            raw_pts = list(ent.get_points("xy"))
            geo_closed = (len(raw_pts) >= 3 and
                          math.hypot(raw_pts[0][0] - raw_pts[-1][0],
                                     raw_pts[0][1] - raw_pts[-1][1]) < 1e-3)
            if flag_closed or geo_closed:
                pts = _lwpoly_points(ent)

        elif etype == "POLYLINE":
            closed = False
            try:
                closed = bool(ent.is_closed)
            except Exception:
                pass
            try:
                closed = closed or bool(ent.dxf.flags & 1)
            except Exception:
                pass
            if not closed:
                raw_v = list(ent.vertices)
                if len(raw_v) >= 3:
                    p0 = raw_v[0].dxf.location
                    p1 = raw_v[-1].dxf.location
                    if math.hypot(p0.x - p1.x, p0.y - p1.y) < 1e-3:
                        closed = True
            if closed:
                pts = _poly_points(ent)

        elif etype == "CIRCLE":
            try:
                c = ent.dxf.center
                r = ent.dxf.radius
                pts = _circle_points(c.x, c.y, r)
            except Exception:
                pass

        if pts and len(pts) >= 3:
            rings.append(pts)

    # LINE + ARC entity'lerden kapalı halka oluştur (LWPOLYLINE yoksa)
    if not rings:
        rings = _chain_line_arc(msp)

    _log.info("[3D] entity tipleri: %s | bulunan ring: %d", etype_counts, len(rings))

    if not rings:
        return None, []

    # Alan hesapla → Shoelace
    def area(pts):
        n = len(pts)
        s = sum(pts[i][0] * pts[(i+1) % n][1] - pts[(i+1) % n][0] * pts[i][1]
                for i in range(n))
        return abs(s) / 2

    rings.sort(key=area, reverse=True)
    outer = rings[0]
    holes = rings[1:]  # küçük olanlar delik

    # Delik olma kriteri: dış konturun alanının %80'inden küçük
    outer_area = area(outer)
    holes = [h for h in holes if area(h) < outer_area * 0.8]

    return outer, holes


# ── Extrude depth hesabı ──────────────────────────────────────────────────────

def _calc_depth(outer: List[Tuple[float, float]]) -> float:
    xs = [p[0] for p in outer]
    ys = [p[1] for p in outer]
    short_side = min(max(xs) - min(xs), max(ys) - min(ys))
    depth = short_side * _DEPTH_RATIO
    return max(_MIN_DEPTH, min(_MAX_DEPTH, depth))


# ── GLB üretici ──────────────────────────────────────────────────────────────

def _build_glb(outer: List, holes: List[List], depth: float) -> bytes:
    from shapely.geometry import Polygon
    import trimesh

    poly = Polygon(outer, holes)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty:
        raise ValueError("Geçersiz polygon")

    mesh = trimesh.creation.extrude_polygon(poly, height=depth)

    # Malzeme: koyu gri (kauçuk tonu)
    mesh.visual = trimesh.visual.ColorVisuals(
        mesh=mesh,
        vertex_colors=[52, 52, 56, 255],
    )

    glb = mesh.export(file_type="glb")
    return glb if isinstance(glb, bytes) else bytes(glb)


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/files/{file_id}/model3d")
def get_model3d(
    file_id: int,
    tenant: dict = Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    row = db.execute(
        text("SELECT filename, file_format, file_data FROM cad_files WHERE id = :id"),
        {"id": file_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    if not row.file_data:
        raise HTTPException(status_code=404, detail="Dosya verisi yok")

    content = bytes(row.file_data)
    filename = row.filename or ""

    # DWG → DXF dönüşümü
    dxf_bytes = content
    if _is_binary_dwg(content) or filename.lower().endswith(".dwg"):
        dxf_bytes = _dwg_to_dxf_bytes(content, filename)
        if dxf_bytes is None:
            raise HTTPException(status_code=422, detail="DWG→DXF dönüşümü başarısız")

    try:
        outer, holes = _extract_rings(dxf_bytes)
    except Exception as e:
        _log.warning("[3D] Ring çıkarma hatası: %s", e)
        raise HTTPException(status_code=422, detail="Kontur çıkarılamadı")

    if outer is None or len(outer) < 3:
        raise HTTPException(status_code=422, detail="Kapalı kontur bulunamadı")

    depth = _calc_depth(outer)

    try:
        glb = _build_glb(outer, holes, depth)
    except Exception as e:
        _log.warning("[3D] GLB üretme hatası: %s", e)
        raise HTTPException(status_code=422, detail=f"3D model üretilemedi: {e}")

    return Response(
        content=glb,
        media_type="model/gltf-binary",
        headers={
            "Content-Disposition": f'inline; filename="{file_id}.glb"',
            "Cache-Control": "public, max-age=3600",
        },
    )
