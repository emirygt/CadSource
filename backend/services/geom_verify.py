"""
geom_verify.py — Normalize edilmiş nokta bulutlarını geometrik olarak karşılaştırır.
3 metrik: IoU (convex hull), Hausdorff mesafesi, density grid korelasyonu.
"""
from __future__ import annotations

import math
from typing import Dict, Optional

import numpy as np
from scipy.spatial.distance import directed_hausdorff

_MAX_PTS = 1200  # alt örnekleme eşiği (hız/doğruluk dengesi)
_GRID = 8        # density grid boyutu


def _subsample(pts: np.ndarray, n: int) -> np.ndarray:
    if len(pts) <= n:
        return pts
    idx = np.random.default_rng(42).choice(len(pts), n, replace=False)
    return pts[idx]


def _hausdorff_score(pts_a: np.ndarray, pts_b: np.ndarray) -> float:
    """Simetrik Hausdorff → 0-1 skor (1=mükemmel eşleşme)."""
    if len(pts_a) == 0 or len(pts_b) == 0:
        return 0.0
    h1 = directed_hausdorff(pts_a, pts_b)[0]
    h2 = directed_hausdorff(pts_b, pts_a)[0]
    h = max(h1, h2)
    # normalize: unit kare diyagonali √2
    return float(max(0.0, 1.0 - h / math.sqrt(2)))


def _iou_score(pts_a: np.ndarray, pts_b: np.ndarray) -> float:
    """Convex hull IoU. Shapely yoksa bbox IoU fallback."""
    try:
        from shapely.geometry import MultiPoint
        poly_a = MultiPoint(pts_a).convex_hull
        poly_b = MultiPoint(pts_b).convex_hull
        if poly_a.is_empty or poly_b.is_empty:
            return 0.0
        inter = poly_a.intersection(poly_b).area
        union = poly_a.union(poly_b).area
        return float(inter / union) if union > 1e-9 else 0.0
    except Exception:
        return _bbox_iou(pts_a, pts_b)


def _bbox_iou(pts_a: np.ndarray, pts_b: np.ndarray) -> float:
    mn_a, mx_a = pts_a.min(axis=0), pts_a.max(axis=0)
    mn_b, mx_b = pts_b.min(axis=0), pts_b.max(axis=0)
    ix = max(0.0, float(min(mx_a[0], mx_b[0]) - max(mn_a[0], mn_b[0])))
    iy = max(0.0, float(min(mx_a[1], mx_b[1]) - max(mn_a[1], mn_b[1])))
    inter = ix * iy
    area_a = float((mx_a[0] - mn_a[0]) * (mx_a[1] - mn_a[1]))
    area_b = float((mx_b[0] - mn_b[0]) * (mx_b[1] - mn_b[1]))
    union = area_a + area_b - inter
    return float(inter / union) if union > 1e-9 else 0.0


def _density_score(pts_a: np.ndarray, pts_b: np.ndarray) -> float:
    """NxN yoğunluk grid histogramı → cosine benzerlik."""
    rng = [[-0.55, 0.55], [-0.55, 0.55]]

    def hist(pts: np.ndarray) -> np.ndarray:
        h, _, _ = np.histogram2d(pts[:, 0], pts[:, 1], bins=_GRID, range=rng)
        h = h.flatten().astype(np.float64)
        norm = np.linalg.norm(h)
        return h / norm if norm > 1e-9 else h

    ha, hb = hist(pts_a), hist(pts_b)
    return float(np.dot(ha, hb))


def verify_pair(norm_a: Dict, norm_b: Optional[Dict]) -> Dict:
    """
    İki normalize_data() çıktısını karşılaştır.
    Returns: {geom_score, iou, hausdorff, density, point_ratio}
    geom_score: 0.0–1.0 arası birleşik geometrik eşleşme skoru.
    """
    _zero = {"geom_score": 0.0, "iou": 0.0, "hausdorff": 0.0,
             "density": 0.0, "point_ratio": 0.0}

    if norm_a is None or norm_b is None:
        return _zero

    pts_a = np.array(norm_a["points"], dtype=np.float64)
    pts_b = np.array(norm_b["points"], dtype=np.float64)

    if len(pts_a) < 4 or len(pts_b) < 4:
        return _zero

    # Alt örnekleme
    pts_as = _subsample(pts_a, _MAX_PTS)
    pts_bs = _subsample(pts_b, _MAX_PTS)

    iou       = _iou_score(pts_as, pts_bs)
    hausdorff = _hausdorff_score(pts_as, pts_bs)
    density   = _density_score(pts_as, pts_bs)

    n_a, n_b = len(pts_a), len(pts_b)
    point_ratio = float(min(n_a, n_b) / max(n_a, n_b))

    geom_score = (
        0.35 * iou
        + 0.35 * hausdorff
        + 0.20 * density
        + 0.10 * point_ratio
    )

    return {
        "geom_score":   round(geom_score, 4),
        "iou":          round(iou, 4),
        "hausdorff":    round(hausdorff, 4),
        "density":      round(density, 4),
        "point_ratio":  round(point_ratio, 4),
    }
