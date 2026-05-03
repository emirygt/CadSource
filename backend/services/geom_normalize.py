"""
geom_normalize.py — DWG/DXF entity verilerini ölçek/konum/rotasyon bağımsız hale getirir.
Hem indexleme hem aramada aynı pipeline çalışır; tutarlılık şarttır.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Optional, Dict, List, Tuple

import numpy as np

# Gürültü entity tipleri — geometric benzerlik için anlamsız
_NOISE_TYPES = frozenset({
    "DIMENSION", "TEXT", "MTEXT", "ATTDEF", "ATTRIB", "HATCH",
    "LEADER", "MULTILEADER", "TOLERANCE", "VIEWPORT", "XLINE", "RAY",
    "OLE2FRAME", "WIPEOUT",
})

# $INSUNITS → mm dönüşüm faktörü
_UNIT_TO_MM: Dict[int, float] = {
    0: 1.0,       # bilinmiyor — olduğu gibi bırak
    1: 25.4,      # inch
    2: 304.8,     # feet
    3: 1609344.0, # miles
    4: 1.0,       # mm
    5: 10.0,      # cm
    6: 1000.0,    # m
    7: 1e6,       # km
    8: 1e-6,      # mikron
    10: 0.001,    # µm
    11: 0.0254,   # mil (1/1000 inch)
    12: 0.254,    # 1/100 inch
    13: 25.4,     # inch tekrar
    14: 254.0,    # desimetre? (edge case)
}


def _entity_points(ent: dict) -> List[Tuple[float, float]]:
    """Entity dict'ten 2D nokta listesi üret."""
    t = ent.get("type", "")
    if t in _NOISE_TYPES:
        return []

    if t == "LINE":
        x1, y1 = ent.get("x1", 0), ent.get("y1", 0)
        x2, y2 = ent.get("x2", 0), ent.get("y2", 0)
        return [(x1, y1), (x2, y2)]

    if t == "CIRCLE":
        cx, cy, r = ent.get("cx", 0), ent.get("cy", 0), ent.get("r", 0)
        return [(cx + r * math.cos(math.pi * 2 * i / 16),
                 cy + r * math.sin(math.pi * 2 * i / 16)) for i in range(16)]

    if t == "ARC":
        cx, cy, r = ent.get("cx", 0), ent.get("cy", 0), ent.get("r", 0)
        sa = math.radians(ent.get("start_angle", 0))
        ea = math.radians(ent.get("end_angle", 360))
        if ea <= sa:
            ea += 2 * math.pi
        sweep = ea - sa
        n = max(4, int(sweep / math.pi * 8))
        return [(cx + r * math.cos(sa + sweep * i / n),
                 cy + r * math.sin(sa + sweep * i / n)) for i in range(n + 1)]

    if t in ("LWPOLYLINE", "POLYLINE"):
        raw = ent.get("points", [])
        return [(float(p[0]), float(p[1])) for p in raw if len(p) >= 2]

    if t == "POINT":
        x, y = ent.get("x", ent.get("cx", 0)), ent.get("y", ent.get("cy", 0))
        return [(x, y)]

    if t in ("SOLID", "TRACE", "3DFACE"):
        raw = ent.get("points", [])
        return [(float(p[0]), float(p[1])) for p in raw if len(p) >= 2]

    if t == "ELLIPSE":
        cx, cy = ent.get("cx", 0), ent.get("cy", 0)
        rx = ent.get("rx", ent.get("r", 1))
        ry = ent.get("ry", rx * ent.get("ratio", 0.5))
        return [(cx + rx * math.cos(math.pi * 2 * i / 16),
                 cy + ry * math.sin(math.pi * 2 * i / 16)) for i in range(16)]

    return []


def _extract_point_cloud(entities: list, unit_scale: float = 1.0) -> np.ndarray:
    """Entity listesinden ölçeklenmiş 2D nokta bulutu üret."""
    all_pts: List[Tuple[float, float]] = []
    for ent in entities:
        for pt in _entity_points(ent):
            all_pts.append((pt[0] * unit_scale, pt[1] * unit_scale))
    if not all_pts:
        return np.zeros((0, 2), dtype=np.float64)
    return np.array(all_pts, dtype=np.float64)


def _pca_align(pts: np.ndarray) -> np.ndarray:
    """
    PCA ile ana ekseni x'e hizala; median-sign flip ile ayna farkını da kapar.
    """
    if len(pts) < 3:
        return pts
    centered = pts - pts.mean(axis=0)
    cov = np.cov(centered.T)
    _, eigvecs = np.linalg.eigh(cov)
    # eigh küçükten büyüğe sıralar → ters çevir
    R = eigvecs[:, ::-1]
    aligned = centered @ R
    # Her eksen için median işaretine uygula (ayna bağımsızlığı)
    if np.median(aligned[:, 0]) < 0:
        aligned[:, 0] *= -1
    if np.median(aligned[:, 1]) < 0:
        aligned[:, 1] *= -1
    return aligned


def normalize_data(data: dict) -> Optional[Dict]:
    """
    parse_dxf_bytes çıktısını → normalize edilmiş temsile çevir.
    Dönen dict: {points, bbox, point_count, unit_scale}
    None → yeterli geometri yok.
    """
    entities = data.get("entities") or []
    if not entities:
        return None

    unit_code = int(data.get("insunits") or 0)
    unit_scale = _UNIT_TO_MM.get(unit_code, 1.0)

    pts = _extract_point_cloud(entities, unit_scale)
    if len(pts) < 4:
        return None

    mn = pts.min(axis=0)
    mx = pts.max(axis=0)
    span = mx - mn
    max_span = float(span.max())
    if max_span < 1e-9:
        return None

    # Bbox merkezine çek → birim kareye ölçekle
    pts = pts - (mn + span / 2)
    pts = pts / max_span

    # Rotasyon ve ayna normalizasyonu
    pts = _pca_align(pts)

    return {
        "points": pts.tolist(),
        "bbox": {
            "w": float(span[0]),
            "h": float(span[1]),
            "aspect": float(span[0] / span[1]) if span[1] > 1e-9 else 1.0,
        },
        "point_count": int(len(pts)),
        "unit_scale": float(unit_scale),
    }


def compute_fine_geom_hash(data: dict) -> Optional[str]:
    """
    Normalize nokta bulutundan deterministik SHA-256 hash.
    Aynı çizim farklı birim/konum/rotasyonda olsa bile aynı hash üretir.
    """
    norm = normalize_data(data)
    if norm is None:
        return None
    # 2 ondalık hassasiyet → küçük float sapmaları yutar
    rounded = sorted((round(x, 2), round(y, 2)) for x, y in norm["points"])
    payload = json.dumps(rounded, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()
