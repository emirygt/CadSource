"""
contour.py — AI kullanmadan görselden teknik kontur ve DXF üretir.
"""
from __future__ import annotations

from logger import get_logger as _get_logger
_log = _get_logger("routes.contour")

import asyncio
import base64
import io
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import ezdxf
import numpy as np
from contourpy import contour_generator
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image, ImageDraw, ImageFilter

from middleware.tenant import get_current_tenant
from services.scan_foreground import VALID_FOREGROUND_MODES, select_foreground_mask

router = APIRouter(prefix="/contour", tags=["contour"])

MAX_IMAGE_MB = 25
MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024
MAX_PREVIEW_SIDE = 1400
MAX_POINTS_PER_CONTOUR = 50000
MAX_SELF_INTERSECTION_SEGMENTS = 900

UNIT_CODES = {
    "unitless": 0,
    "in": 1,
    "inch": 1,
    "ft": 2,
    "mm": 4,
    "cm": 5,
    "m": 6,
}

ORIGIN_MODES = {"bottom_left", "top_left", "center"}
CALIBRATION_MODES = {"factor", "two_point", "auto_scan"}

LAYER_COLORS = {
    "OUTER": 3,
    "INNER": 1,
    "HOLES": 4,
    "REF": 2,
}

UNIT_TO_MM = {
    "unitless": 1.0,
    "mm": 1.0,
    "cm": 10.0,
    "m": 1000.0,
    "in": 25.4,
    "inch": 25.4,
    "ft": 304.8,
}

COMMON_SCAN_DPI = (96, 100, 120, 150, 200, 240, 300, 400, 600)
PAGE_CANDIDATES_MM = (
    ("A5", 148.0, 210.0),
    ("A4", 210.0, 297.0),
    ("A3", 297.0, 420.0),
    ("LETTER", 215.9, 279.4),
    ("LEGAL", 215.9, 355.6),
)


@dataclass
class ContourShape:
    points: np.ndarray  # Closed ring: first == last
    signed_area_px: float
    depth: int = 0
    layer: str = "OUTER"
    is_circle: bool = False
    circle_center_px: Optional[Tuple[float, float]] = None
    circle_radius_px: Optional[float] = None
    is_ellipse: bool = False
    ellipse_center_px: Optional[Tuple[float, float]] = None
    ellipse_semi_major_px: Optional[float] = None
    ellipse_semi_minor_px: Optional[float] = None
    ellipse_rotation_rad: Optional[float] = None

    @property
    def area_px(self) -> float:
        return abs(self.signed_area_px)


def _safe_otsu_threshold(gray: np.ndarray) -> int:
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = float(gray.size)
    if total <= 0:
        return 127

    sum_total = float(np.dot(np.arange(256, dtype=np.float64), hist))
    sum_bg = 0.0
    weight_bg = 0.0
    max_between = -1.0
    threshold = 127

    for t in range(256):
        weight_bg += hist[t]
        if weight_bg <= 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg <= 0:
            break

        sum_bg += t * hist[t]
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_total - sum_bg) / weight_fg
        between = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
        if between > max_between:
            max_between = between
            threshold = t
    return int(threshold)


def _adaptive_threshold(gray: np.ndarray, block_size: int = 0) -> np.ndarray:
    """Blok bazli adaptive Otsu. Her blogu ayri threshold'layip birlestir.
    Esit olmayan aydinlatmali taramalarda (golge, leke) global Otsu'dan iyi."""
    h, w = gray.shape
    if block_size <= 0:
        block_size = max(64, min(h, w) // 6)
    if block_size >= min(h, w):
        t = _safe_otsu_threshold(gray)
        return gray <= t

    result = np.zeros((h, w), dtype=bool)
    for y0 in range(0, h, block_size):
        y1 = min(y0 + block_size, h)
        for x0 in range(0, w, block_size):
            x1 = min(x0 + block_size, w)
            block = gray[y0:y1, x0:x1]
            if block.size == 0:
                continue
            std = float(np.std(block))
            if std < 5.0:
                # Neredeyse tek renk blok — tamamini background say.
                continue
            t = _safe_otsu_threshold(block)
            result[y0:y1, x0:x1] = block <= t
    return result


def _score_mask(mask: np.ndarray) -> float:
    """Maski puanla: ne cok bos ne cok dolu olan en iyi aday."""
    ratio = float(mask.mean())
    if ratio < 0.001 or ratio > 0.995:
        return -1.0
    return -abs(ratio - 0.18)


def _pick_foreground_mask(gray: np.ndarray, alpha: np.ndarray, blur_sigma: float = 0.0) -> np.ndarray:
    alpha_mask = alpha > 12
    alpha_ratio = float(alpha_mask.mean())
    if 0.002 < alpha_ratio < 0.98:
        return alpha_mask

    # Opsiyonel Gaussian blur: taranmis gorsellerdeki gurultu piksellerden
    # sahte mikro-konturlari onler.
    if blur_sigma > 0:
        from scipy.ndimage import gaussian_filter
        gray = gaussian_filter(gray.astype(np.float64), sigma=blur_sigma).astype(np.uint8)

    # Global Otsu
    t_global = _safe_otsu_threshold(gray)
    dark_global = gray <= t_global
    light_global = gray >= t_global

    # Adaptive (blok bazli) Otsu
    dark_adaptive = _adaptive_threshold(gray)

    candidates = [
        (dark_global, _score_mask(dark_global)),
        (light_global, _score_mask(light_global)),
        (dark_adaptive, _score_mask(dark_adaptive)),
    ]
    candidates.sort(key=lambda item: item[1], reverse=True)
    for mask, score in candidates:
        if score > -1.0 and np.any(mask):
            return mask

    if np.any(dark_global):
        return dark_global
    return light_global


def _clean_mask(mask: np.ndarray) -> np.ndarray:
    if mask.size == 0:
        return mask
    pil = Image.fromarray(mask.astype(np.uint8) * 255, mode="L")
    pil = pil.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))  # closing
    pil = pil.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))  # opening
    cleaned = np.array(pil, dtype=np.uint8) > 127
    return cleaned if np.any(cleaned) else mask


def _rational_to_float(value) -> Optional[float]:
    try:
        # PIL TiffImagePlugin IFDRational vs tuple/int/float.
        if hasattr(value, "numerator") and hasattr(value, "denominator"):
            den = float(value.denominator)
            if abs(den) <= 1e-12:
                return None
            return float(value.numerator) / den
        if isinstance(value, (tuple, list)) and len(value) == 2:
            den = float(value[1])
            if abs(den) <= 1e-12:
                return None
            return float(value[0]) / den
        return float(value)
    except Exception:
        return None


def _read_dpi_from_image(image: Image.Image) -> Optional[Tuple[float, float, str]]:
    info = image.info or {}
    dpi = info.get("dpi")
    if isinstance(dpi, (tuple, list)) and len(dpi) >= 2:
        dx = _rational_to_float(dpi[0])
        dy = _rational_to_float(dpi[1])
        if dx and dy and 50.0 <= dx <= 2400.0 and 50.0 <= dy <= 2400.0:
            return float(dx), float(dy), "metadata_dpi"

    try:
        exif = image.getexif()
    except Exception:
        exif = None
    if exif:
        x_res = _rational_to_float(exif.get(282))
        y_res = _rational_to_float(exif.get(283))
        unit = exif.get(296, 2)  # 2: inch, 3: cm
        if x_res and y_res and x_res > 0 and y_res > 0:
            if unit == 3:
                x_res *= 2.54
                y_res *= 2.54
            if 50.0 <= x_res <= 2400.0 and 50.0 <= y_res <= 2400.0:
                return float(x_res), float(y_res), "exif_resolution"
    return None


def _infer_scan_scale_from_page(image_w: int, image_h: int) -> Optional[Dict[str, float]]:
    w = float(image_w)
    h = float(image_h)
    if w <= 1 or h <= 1:
        return None

    best = None
    for page_name, mm_w, mm_h in PAGE_CANDIDATES_MM:
        for orient in ((mm_w, mm_h), (mm_h, mm_w)):
            p_w, p_h = orient
            for dpi in COMMON_SCAN_DPI:
                expected_w = (p_w / 25.4) * float(dpi)
                expected_h = (p_h / 25.4) * float(dpi)
                if expected_w <= 1 or expected_h <= 1:
                    continue
                err_w = abs(w - expected_w) / expected_w
                err_h = abs(h - expected_h) / expected_h
                score = max(err_w, err_h)
                if best is None or score < best["error"]:
                    best = {
                        "page_name": page_name,
                        "page_w_mm": float(p_w),
                        "page_h_mm": float(p_h),
                        "dpi_guess": float(dpi),
                        "error": float(score),
                    }

    if not best:
        return None
    if best["error"] > 0.035:
        return None
    return best


def _polygon_area_signed(points: np.ndarray) -> float:
    if points.shape[0] < 4:
        return 0.0
    x = points[:, 0]
    y = points[:, 1]
    return float(0.5 * (np.dot(x[:-1], y[1:]) - np.dot(y[:-1], x[1:])))


def _point_line_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    ab = b - a
    norm = float(np.hypot(ab[0], ab[1]))
    if norm <= 1e-12:
        return float(np.hypot(*(p - a)))
    return float(abs((p[0] - a[0]) * ab[1] - (p[1] - a[1]) * ab[0]) / norm)


def _rdp(points: np.ndarray, epsilon: float) -> np.ndarray:
    """Iteratif Ramer-Douglas-Peucker. Recursive versiyonun aksine
    cok uzun konturlarda stack overflow riski yok."""
    n = points.shape[0]
    if n <= 2 or epsilon <= 0:
        return points

    keep = np.zeros(n, dtype=bool)
    keep[0] = True
    keep[n - 1] = True

    # Stack: (start_index, end_index) ciftleri
    stack = [(0, n - 1)]
    while stack:
        si, ei = stack.pop()
        if ei - si <= 1:
            continue

        start = points[si]
        end = points[ei]
        dmax = -1.0
        idx = si
        for i in range(si + 1, ei):
            d = _point_line_distance(points[i], start, end)
            if d > dmax:
                dmax = d
                idx = i

        if dmax > epsilon:
            keep[idx] = True
            stack.append((si, idx))
            stack.append((idx, ei))

    return points[keep]


def _simplify_closed(points: np.ndarray, epsilon: float) -> np.ndarray:
    if epsilon <= 0 or points.shape[0] < 5:
        return points
    ring = points[:-1]
    if ring.shape[0] < 3:
        return points

    centroid = ring.mean(axis=0)
    d = np.hypot(ring[:, 0] - centroid[0], ring[:, 1] - centroid[1])
    start_idx = int(np.argmax(d))
    rotated = np.vstack([ring[start_idx:], ring[:start_idx], ring[start_idx:start_idx + 1]])
    simplified = _rdp(rotated, epsilon)
    if simplified.shape[0] < 4:
        return points
    if not np.allclose(simplified[0], simplified[-1]):
        simplified = np.vstack([simplified, simplified[0:1]])
    return simplified


def _ring_perimeter(points_closed: np.ndarray) -> float:
    if points_closed.shape[0] < 2:
        return 0.0
    diffs = np.diff(points_closed, axis=0)
    return float(np.sum(np.hypot(diffs[:, 0], diffs[:, 1])))


def _prune_collinear_closed(
    points_closed: np.ndarray,
    dist_tol: float,
    curvature_tol_deg: float = 9.0,
    max_passes: int = 3,
) -> np.ndarray:
    """Kapali poligondaki neredeyse dogrusal ara noktalarni temizle.
    Keskin koseleri korurken 'nokta nokta' etkisini azaltir."""
    if points_closed.shape[0] < 6:
        return points_closed

    ring = points_closed[:-1]
    if ring.shape[0] < 4:
        return points_closed

    for _ in range(max_passes):
        n = ring.shape[0]
        keep = np.ones(n, dtype=bool)
        removed = 0

        for i in range(n):
            a = ring[(i - 1) % n]
            b = ring[i]
            c = ring[(i + 1) % n]

            d = _point_line_distance(b, a, c)
            v1 = a - b
            v2 = c - b
            n1 = float(np.hypot(v1[0], v1[1]))
            n2 = float(np.hypot(v2[0], v2[1]))
            if n1 <= 1e-9 or n2 <= 1e-9:
                keep[i] = False
                removed += 1
                continue

            cosang = float(np.dot(v1, v2) / (n1 * n2))
            cosang = max(-1.0, min(1.0, cosang))
            ang = math.degrees(math.acos(cosang))  # 180'e yakin ise dogrusal
            curvature = abs(180.0 - ang)

            if d <= dist_tol and curvature <= curvature_tol_deg:
                keep[i] = False
                removed += 1

        remain = int(np.sum(keep))
        if removed == 0 or remain < 3:
            break
        ring = ring[keep]

    if ring.shape[0] < 3:
        return points_closed
    return np.vstack([ring, ring[0:1]])


def _adaptive_simplify_closed(points_closed: np.ndarray, base_eps: float, target_points: int) -> np.ndarray:
    if points_closed.shape[0] < 6:
        return points_closed
    if (points_closed.shape[0] - 1) <= target_points:
        return points_closed

    low = max(base_eps, 0.01)
    high = max(low * 8.0, low + 8.0)
    best = None

    for _ in range(14):
        mid = (low + high) * 0.5
        cand = _simplify_closed(points_closed, mid)
        cnt = max(0, cand.shape[0] - 1)
        if 12 <= cnt <= target_points:
            best = cand
            high = mid
        else:
            low = mid

    if best is not None:
        return best
    return _simplify_closed(points_closed, high)


def _optimize_net_ring(points_closed: np.ndarray, simplify_px: float) -> np.ndarray:
    """Net DXF icin agresif ama kontrollu kontur optimizasyonu."""
    if points_closed.shape[0] < 6:
        return points_closed

    base = max(float(simplify_px), 2.2)
    out = _simplify_closed(points_closed, base)
    out = _prune_collinear_closed(
        out,
        dist_tol=max(0.8, base * 0.38),
        curvature_tol_deg=8.0,
        max_passes=3,
    )

    perim = _ring_perimeter(out)
    target_points = int(max(56, min(1600, perim / max(base * 1.55, 1.4))))
    out = _adaptive_simplify_closed(out, base_eps=max(1.2, base * 0.92), target_points=target_points)
    out = _prune_collinear_closed(
        out,
        dist_tol=max(1.0, base * 0.5),
        curvature_tol_deg=10.0,
        max_passes=2,
    )

    # Son emniyet: ekstrem yogun konturlari yumusak alt-ornekle.
    if out.shape[0] > 2200:
        step = int(math.ceil(out.shape[0] / 2200))
        out = out[::step]
        if out.shape[0] >= 2 and not np.allclose(out[0], out[-1]):
            out = np.vstack([out, out[0:1]])
    if out.shape[0] < 4:
        return points_closed
    return out


def _extract_contours(
    mask: np.ndarray,
    min_area_px: int,
    simplify_px: float,
    min_area_pct: float = 0.0,
) -> List[np.ndarray]:
    h, w = mask.shape
    image_area = float(h * w) if h > 0 and w > 0 else 1.0
    padded = np.pad(mask.astype(np.float64), 1, mode="constant", constant_values=0.0)
    gen = contour_generator(z=padded, name="serial")
    lines = gen.lines(0.5)

    # min_area_pct > 0 ise gorsel alaninin yuzdesini de esik olarak kullan.
    pct_threshold = (min_area_pct / 100.0) * image_area if min_area_pct > 0 else 0.0
    effective_min_area = max(float(max(1, min_area_px)), pct_threshold)

    contours: List[np.ndarray] = []
    for line in lines:
        if line.shape[0] < 4:
            continue
        pts = np.array(line, dtype=np.float64)
        pts[:, 0] -= 1.0
        pts[:, 1] -= 1.0
        pts[:, 0] = np.clip(pts[:, 0], 0.0, max(0.0, float(w - 1)))
        pts[:, 1] = np.clip(pts[:, 1], 0.0, max(0.0, float(h - 1)))

        if not np.allclose(pts[0], pts[-1]):
            pts = np.vstack([pts, pts[0:1]])
        if pts.shape[0] < 4:
            continue

        area = abs(_polygon_area_signed(pts))
        if area < effective_min_area:
            continue

        if simplify_px > 0:
            pts = _simplify_closed(pts, float(simplify_px))
        if pts.shape[0] > MAX_POINTS_PER_CONTOUR:
            step = int(math.ceil(pts.shape[0] / MAX_POINTS_PER_CONTOUR))
            pts = pts[::step]
            if not np.allclose(pts[0], pts[-1]):
                pts = np.vstack([pts, pts[0:1]])
            if pts.shape[0] < 4:
                continue

        contours.append(pts)
    return contours


def _point_in_ring(point: Tuple[float, float], ring: np.ndarray) -> bool:
    x, y = point
    inside = False
    n = ring.shape[0]
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        intersects = ((y1 > y) != (y2 > y)) and (x < ((x2 - x1) * (y - y1) / ((y2 - y1) + 1e-12) + x1))
        if intersects:
            inside = not inside
    return inside


def _sample_inside_point(points_closed: np.ndarray) -> Tuple[float, float]:
    ring = points_closed[:-1]
    if ring.shape[0] == 0:
        return 0.0, 0.0
    centroid = ring.mean(axis=0)
    d = np.hypot(ring[:, 0] - centroid[0], ring[:, 1] - centroid[1])
    idx = int(np.argmax(d))
    v = ring[idx]
    # Kenardan merkeze dogru biraz ilerleyip boundary'den uzak bir nokta sec.
    sample = (v * 0.72) + (centroid * 0.28)
    return float(sample[0]), float(sample[1])


def _assign_hierarchy_and_layers(shapes: List[ContourShape]) -> None:
    if not shapes:
        return
    rings = [s.points[:-1] for s in shapes]

    # Bounding box pre-filter: her shape icin bbox hesapla,
    # point-in-ring testini sadece bbox icinde olan ciftlere uygula.
    # O(k^2 * n) yerine cogu cifti O(1) bbox testi ile eler.
    bboxes: List[Tuple[float, float, float, float]] = []
    for ring in rings:
        if ring.size == 0:
            bboxes.append((0.0, 0.0, 0.0, 0.0))
        else:
            bboxes.append((
                float(np.min(ring[:, 0])),
                float(np.min(ring[:, 1])),
                float(np.max(ring[:, 0])),
                float(np.max(ring[:, 1])),
            ))

    for i, shape in enumerate(shapes):
        sample = _sample_inside_point(shape.points)
        sx, sy = sample
        depth = 0
        for j, ring in enumerate(rings):
            if i == j:
                continue
            # Bbox hizli eleme: sample nokta bbox disindaysa kesinlikle icinde degildir.
            bx0, by0, bx1, by1 = bboxes[j]
            if sx < bx0 or sx > bx1 or sy < by0 or sy > by1:
                continue
            if _point_in_ring(sample, ring):
                depth += 1
        shape.depth = depth

        base_layer = "OUTER" if shape.signed_area_px >= 0 else "INNER"
        parity_layer = "INNER" if (depth % 2 == 1) else "OUTER"
        shape.layer = base_layer if base_layer == parity_layer else parity_layer


def _fit_circle(points: np.ndarray, tolerance: float) -> Tuple[bool, Optional[Tuple[float, float]], Optional[float]]:
    ring = points[:-1]
    if ring.shape[0] < 10:
        return False, None, None

    center = ring.mean(axis=0)
    radii = np.hypot(ring[:, 0] - center[0], ring[:, 1] - center[1])
    mean_r = float(np.mean(radii))
    if mean_r <= 1.0:
        return False, None, None

    rel_std = float(np.std(radii) / mean_r)
    min_x, min_y = np.min(ring[:, 0]), np.min(ring[:, 1])
    max_x, max_y = np.max(ring[:, 0]), np.max(ring[:, 1])
    w = max(max_x - min_x, 1e-6)
    h = max(max_y - min_y, 1e-6)
    aspect = max(w, h) / min(w, h)

    diffs = np.diff(points, axis=0)
    perimeter = float(np.sum(np.hypot(diffs[:, 0], diffs[:, 1])))
    perim_ratio = perimeter / max(2.0 * math.pi * mean_r, 1e-6)
    area_ratio = abs(_polygon_area_signed(points)) / max(math.pi * mean_r * mean_r, 1e-6)

    ok = (
        rel_std <= tolerance
        and aspect <= 1.18
        and 0.84 <= perim_ratio <= 1.16
        and 0.74 <= area_ratio <= 1.26
    )
    if not ok:
        return False, None, None
    return True, (float(center[0]), float(center[1])), mean_r


def _fit_ellipse(
    points: np.ndarray, tolerance: float,
) -> Tuple[bool, Optional[Tuple[float, float]], Optional[float], Optional[float], Optional[float]]:
    """Least-squares ellipse fit. Returns (ok, center, semi_major, semi_minor, rotation_rad)."""
    ring = points[:-1]
    if ring.shape[0] < 12:
        return False, None, None, None, None

    # Algebraik ellipse fit: ax^2 + bxy + cy^2 + dx + ey + f = 0
    x = ring[:, 0].astype(np.float64)
    y = ring[:, 1].astype(np.float64)
    # Numerik stabilite icin merkezle
    mx, my = float(np.mean(x)), float(np.mean(y))
    x = x - mx
    y = y - my

    D = np.column_stack([x * x, x * y, y * y, x, y, np.ones(len(x))])
    try:
        _, _, Vt = np.linalg.svd(D, full_matrices=True)
    except np.linalg.LinAlgError:
        return False, None, None, None, None
    params = Vt[-1]
    a, b, c, d, e, f = params

    # Ellipse kosulu: 4ac - b^2 > 0 (gercek ellipse, hiperbol degil)
    disc = 4.0 * a * c - b * b
    if disc <= 1e-12:
        return False, None, None, None, None

    # Merkez
    cx = (b * e - 2.0 * c * d) / disc
    cy = (b * d - 2.0 * a * e) / disc

    # Semi-axis uzunluklari ve rotasyon
    # Matris formunda: M = [[a, b/2], [b/2, c]]
    M = np.array([[a, b / 2.0], [b / 2.0, c]], dtype=np.float64)
    try:
        eigenvalues, eigenvectors = np.linalg.eigh(M)
    except np.linalg.LinAlgError:
        return False, None, None, None, None

    if eigenvalues[0] <= 1e-12 or eigenvalues[1] <= 1e-12:
        return False, None, None, None, None

    # f_center = a*cx^2 + b*cx*cy + c*cy^2 + d*cx + e*cy + f
    f_center = a * cx * cx + b * cx * cy + c * cy * cy + d * cx + e * cy + f
    if abs(f_center) < 1e-12:
        return False, None, None, None, None

    semi_axes_sq = -f_center / eigenvalues
    if semi_axes_sq[0] <= 0 or semi_axes_sq[1] <= 0:
        return False, None, None, None, None

    semi1 = math.sqrt(semi_axes_sq[0])
    semi2 = math.sqrt(semi_axes_sq[1])
    semi_major = max(semi1, semi2)
    semi_minor = min(semi1, semi2)

    if semi_major <= 1.0 or semi_minor <= 1.0:
        return False, None, None, None, None

    # Aspect ratio — daire gibi olan zaten circle olarak yakalanir
    aspect = semi_major / max(semi_minor, 1e-6)
    if aspect < 1.15 or aspect > 5.0:
        return False, None, None, None, None

    # Rotasyon acisi
    if semi1 >= semi2:
        angle = math.atan2(float(eigenvectors[1, 0]), float(eigenvectors[0, 0]))
    else:
        angle = math.atan2(float(eigenvectors[1, 1]), float(eigenvectors[0, 1]))

    # Fit kalitesini kontrol et: noktalarin ellipse'e mesafesi
    abs_cx = cx + mx
    abs_cy = cy + my
    cos_a = math.cos(-angle)
    sin_a = math.sin(-angle)
    rx = ring[:, 0] - abs_cx
    ry = ring[:, 1] - abs_cy
    rot_x = rx * cos_a - ry * sin_a
    rot_y = rx * sin_a + ry * cos_a
    normalized = (rot_x / semi_major) ** 2 + (rot_y / semi_minor) ** 2
    fit_error = float(np.std(normalized))

    if fit_error > tolerance * 3.0:
        return False, None, None, None, None

    # Alan kontrolu
    ellipse_area = math.pi * semi_major * semi_minor
    polygon_area = abs(_polygon_area_signed(points))
    area_ratio = polygon_area / max(ellipse_area, 1e-6)
    if not (0.75 <= area_ratio <= 1.25):
        return False, None, None, None, None

    return True, (abs_cx, abs_cy), semi_major, semi_minor, angle


def _classify_circles(shapes: List[ContourShape], detect_circles: bool, circle_tolerance: float) -> None:
    if not detect_circles:
        return
    for shape in shapes:
        ok, center, radius = _fit_circle(shape.points, circle_tolerance)
        if ok:
            shape.is_circle = True
            shape.circle_center_px = center
            shape.circle_radius_px = radius
            if shape.layer == "INNER":
                shape.layer = "HOLES"
            continue

        # Daire degilse ellipse dene
        e_ok, e_center, e_major, e_minor, e_angle = _fit_ellipse(shape.points, circle_tolerance)
        if e_ok:
            shape.is_ellipse = True
            shape.ellipse_center_px = e_center
            shape.ellipse_semi_major_px = e_major
            shape.ellipse_semi_minor_px = e_minor
            shape.ellipse_rotation_rad = e_angle
            if shape.layer == "INNER":
                shape.layer = "HOLES"


def _to_cad_xy(
    x: float,
    y: float,
    image_w: int,
    image_h: int,
    scale_x: float,
    scale_y: float,
    origin_mode: str,
    flip_x: bool,
    flip_y: bool,
) -> Tuple[float, float]:
    if origin_mode == "bottom_left":
        bx = float(x)
        by = float(image_h - y)
    elif origin_mode == "top_left":
        bx = float(x)
        by = float(y)
    else:  # center
        bx = float(x - (image_w / 2.0))
        by = float((image_h / 2.0) - y)

    if flip_x:
        bx = -bx
    if flip_y:
        by = -by
    return round(bx * scale_x, 6), round(by * scale_y, 6)


@dataclass
class ArcSegment:
    """Polyline icerisinde tespit edilen yay segmenti."""
    start_idx: int
    end_idx: int
    center: Tuple[float, float]
    radius: float
    start_angle_deg: float
    end_angle_deg: float


def _fit_arc_to_points(pts: np.ndarray, tolerance: float) -> Optional[Tuple[Tuple[float, float], float]]:
    """3+ noktaya daire fit et, (center, radius) don. Fit kotu ise None."""
    if pts.shape[0] < 3:
        return None
    cx = float(np.mean(pts[:, 0]))
    cy = float(np.mean(pts[:, 1]))
    radii = np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)
    mean_r = float(np.mean(radii))
    if mean_r < 1.0:
        return None
    rel_std = float(np.std(radii) / mean_r)
    if rel_std > tolerance:
        return None
    return (cx, cy), mean_r


def _detect_arcs_in_ring(
    ring: np.ndarray,
    tolerance: float = 0.06,
    min_arc_points: int = 5,
    min_arc_angle_deg: float = 25.0,
) -> List[ArcSegment]:
    """Kapali polyline icerisinde yay segmentlerini tespit et.
    Greedy sliding window: pencereyi buyuterek fit kalitesi dusene kadar genislet."""
    n = ring.shape[0]
    if n < min_arc_points:
        return []

    arcs: List[ArcSegment] = []
    used = set()
    i = 0
    while i < n - min_arc_points + 1:
        if i in used:
            i += 1
            continue

        best_end = -1
        best_center = None
        best_radius = None

        for j in range(i + min_arc_points, min(i + 80, n + 1)):
            segment = ring[i:j]
            result = _fit_arc_to_points(segment, tolerance)
            if result is None:
                break
            best_end = j
            best_center, best_radius = result

        if best_end < 0 or best_center is None or best_radius is None:
            i += 1
            continue

        # Yay acisini hesapla
        p_start = ring[i]
        p_end = ring[best_end - 1]
        start_angle = math.degrees(math.atan2(
            float(p_start[1] - best_center[1]),
            float(p_start[0] - best_center[0]),
        ))
        end_angle = math.degrees(math.atan2(
            float(p_end[1] - best_center[1]),
            float(p_end[0] - best_center[0]),
        ))
        # Yay acisi yeterli mi?
        sweep = (end_angle - start_angle) % 360.0
        if sweep > 180.0:
            # Yonu kontrol et — noktalar saat yonunde mi?
            mid_idx = (i + best_end) // 2
            if mid_idx < n:
                mid_angle = math.degrees(math.atan2(
                    float(ring[mid_idx][1] - best_center[1]),
                    float(ring[mid_idx][0] - best_center[0]),
                ))
                # mid_angle sweep icerisinde degilse yonu cevir
                check = (mid_angle - start_angle) % 360.0
                if check > sweep:
                    start_angle, end_angle = end_angle, start_angle
                    sweep = 360.0 - sweep

        if sweep < min_arc_angle_deg:
            i += 1
            continue

        arcs.append(ArcSegment(
            start_idx=i,
            end_idx=best_end - 1,
            center=best_center,
            radius=best_radius,
            start_angle_deg=start_angle % 360.0,
            end_angle_deg=end_angle % 360.0,
        ))
        for k in range(i, best_end):
            used.add(k)
        i = best_end

    return arcs


def _create_layers(doc: ezdxf.document.Drawing) -> None:
    for name, color in LAYER_COLORS.items():
        if name not in doc.layers:
            doc.layers.new(name, dxfattribs={"color": color})


def _build_svg_string(
    shapes: List[ContourShape],
    image_w: int,
    image_h: int,
    scale_x: float,
    scale_y: float,
    origin_mode: str,
    flip_x: bool,
    flip_y: bool,
) -> str:
    """Konturlari SVG string olarak uret. Web tabanli is akislari icin DXF'e alternatif."""
    svg_w = round(float(image_w) * abs(scale_x), 4)
    svg_h = round(float(image_h) * abs(scale_y), 4)

    layer_stroke = {
        "OUTER": "#22c55e",
        "INNER": "#ef4444",
        "HOLES": "#06b6d4",
    }
    parts: List[str] = []
    parts.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {svg_w} {svg_h}" '
        f'width="{svg_w}" height="{svg_h}">'
    )

    for shape in shapes:
        stroke = layer_stroke.get(shape.layer, "#facc15")

        if shape.is_circle and shape.circle_center_px and shape.circle_radius_px:
            cx, cy = _to_cad_xy(
                shape.circle_center_px[0], shape.circle_center_px[1],
                image_w, image_h, scale_x, scale_y, origin_mode, flip_x, flip_y,
            )
            r = abs(float(shape.circle_radius_px) * abs(scale_x))
            # SVG y ekseni asagi, cad y ekseni yukari — duzelt
            svg_cy = svg_h - cy if origin_mode != "top_left" else cy
            parts.append(
                f'<circle cx="{round(cx, 4)}" cy="{round(svg_cy, 4)}" '
                f'r="{round(r, 4)}" fill="none" stroke="{stroke}" stroke-width="0.5" '
                f'data-layer="{shape.layer}"/>'
            )
            continue

        if (
            shape.is_ellipse
            and shape.ellipse_center_px
            and shape.ellipse_semi_major_px
            and shape.ellipse_semi_minor_px
            and shape.ellipse_rotation_rad is not None
        ):
            cx, cy = _to_cad_xy(
                shape.ellipse_center_px[0], shape.ellipse_center_px[1],
                image_w, image_h, scale_x, scale_y, origin_mode, flip_x, flip_y,
            )
            svg_cy = svg_h - cy if origin_mode != "top_left" else cy
            rx = float(shape.ellipse_semi_major_px) * abs(scale_x)
            ry = float(shape.ellipse_semi_minor_px) * abs(scale_y)
            angle_deg = math.degrees(float(shape.ellipse_rotation_rad))
            parts.append(
                f'<ellipse cx="{round(cx, 4)}" cy="{round(svg_cy, 4)}" '
                f'rx="{round(rx, 4)}" ry="{round(ry, 4)}" '
                f'transform="rotate({round(-angle_deg, 4)} {round(cx, 4)} {round(svg_cy, 4)})" '
                f'fill="none" stroke="{stroke}" stroke-width="0.5" '
                f'data-layer="{shape.layer}"/>'
            )
            continue

        ring = shape.points[:-1] if np.allclose(shape.points[0], shape.points[-1]) else shape.points
        if ring.shape[0] < 3:
            continue
        path_d_parts: List[str] = []
        for idx, (px, py) in enumerate(ring):
            cad_x, cad_y = _to_cad_xy(
                float(px), float(py),
                image_w, image_h, scale_x, scale_y, origin_mode, flip_x, flip_y,
            )
            svg_y = svg_h - cad_y if origin_mode != "top_left" else cad_y
            cmd = "M" if idx == 0 else "L"
            path_d_parts.append(f"{cmd}{round(cad_x, 4)},{round(svg_y, 4)}")
        path_d_parts.append("Z")
        parts.append(
            f'<path d="{" ".join(path_d_parts)}" fill="none" stroke="{stroke}" '
            f'stroke-width="0.5" data-layer="{shape.layer}"/>'
        )

    parts.append("</svg>")
    return "\n".join(parts)


def _build_dxf_bytes(
    shapes: List[ContourShape],
    image_w: int,
    image_h: int,
    scale_x: float,
    scale_y: float,
    unit: str,
    origin_mode: str,
    flip_x: bool,
    flip_y: bool,
    calib_ref_line_px: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None,
    detect_arcs: bool = False,
    arc_tolerance: float = 0.06,
    force_continuous_linetype: bool = False,
) -> bytes:
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = UNIT_CODES[unit]
    doc.header["$LTSCALE"] = 1.0
    _create_layers(doc)
    msp = doc.modelspace()
    isotropic_scale = abs(scale_x - scale_y) <= (max(abs(scale_x), abs(scale_y), 1e-9) * 1e-6)

    def _entity_attrs(layer: str) -> Dict[str, object]:
        attrs: Dict[str, object] = {"layer": layer}
        if force_continuous_linetype:
            attrs["linetype"] = "CONTINUOUS"
        return attrs

    # İçi siyah boyalı (Solid Hatch) alanı oluşturalım
    try:
        hatch = msp.add_hatch(color=250)
        hatch.dxf.hatch_style = 0  # 0: Normal island detection (dışlar dolu, delikler boş)
    except Exception:
        hatch = None

    for shape in shapes:
        # Hatch için shape polygonunu ekleyelim (is_circle/is_ellipse olsa bile polyline olarak hatch'e veriyoruz)
        ring_for_hatch = shape.points[:-1] if np.allclose(shape.points[0], shape.points[-1]) else shape.points
        if ring_for_hatch.shape[0] >= 3 and hatch is not None:
            hatch_poly = [
                _to_cad_xy(
                    x=float(px), y=float(py),
                    image_w=image_w, image_h=image_h,
                    scale_x=scale_x, scale_y=scale_y,
                    origin_mode=origin_mode, flip_x=flip_x, flip_y=flip_y,
                )
                for px, py in ring_for_hatch
            ]
            try:
                hatch.paths.add_polyline_path(hatch_poly, is_closed=True)
            except Exception as e:
                _log.debug("Hatch polyline path eklenemedi, şekil atlandı: %s", e)

        if shape.is_circle and shape.circle_center_px and shape.circle_radius_px and isotropic_scale:
            cx, cy = _to_cad_xy(
                x=shape.circle_center_px[0],
                y=shape.circle_center_px[1],
                image_w=image_w,
                image_h=image_h,
                scale_x=scale_x,
                scale_y=scale_y,
                origin_mode=origin_mode,
                flip_x=flip_x,
                flip_y=flip_y,
            )
            radius = abs(float(shape.circle_radius_px) * scale_x)
            if radius > 0:
                msp.add_circle((cx, cy), radius, dxfattribs=_entity_attrs(shape.layer))
            continue

        if (
            shape.is_ellipse
            and shape.ellipse_center_px
            and shape.ellipse_semi_major_px
            and shape.ellipse_semi_minor_px
            and shape.ellipse_rotation_rad is not None
        ):
            cx, cy = _to_cad_xy(
                x=shape.ellipse_center_px[0],
                y=shape.ellipse_center_px[1],
                image_w=image_w,
                image_h=image_h,
                scale_x=scale_x,
                scale_y=scale_y,
                origin_mode=origin_mode,
                flip_x=flip_x,
                flip_y=flip_y,
            )
            angle = float(shape.ellipse_rotation_rad)
            # Flip'ler aciyi da etkiler
            if flip_x:
                angle = math.pi - angle
            if flip_y:
                angle = -angle
            major_len = float(shape.ellipse_semi_major_px) * abs(scale_x)
            ratio = float(shape.ellipse_semi_minor_px) / max(float(shape.ellipse_semi_major_px), 1e-9)
            # ezdxf ELLIPSE: center, major_axis (vektor), ratio
            major_axis = (major_len * math.cos(angle), major_len * math.sin(angle), 0.0)
            if major_len > 0 and 0.0 < ratio <= 1.0:
                msp.add_ellipse(
                    (cx, cy, 0.0),
                    major_axis=major_axis,
                    ratio=min(ratio, 1.0),
                    dxfattribs=_entity_attrs(shape.layer),
                )
            continue

        ring = shape.points[:-1] if np.allclose(shape.points[0], shape.points[-1]) else shape.points
        if ring.shape[0] < 3:
            continue

        if detect_arcs and isotropic_scale and ring.shape[0] >= 5:
            arcs = _detect_arcs_in_ring(ring, tolerance=arc_tolerance)
        else:
            arcs = []

        if not arcs:
            poly = [
                _to_cad_xy(
                    x=float(px), y=float(py),
                    image_w=image_w, image_h=image_h,
                    scale_x=scale_x, scale_y=scale_y,
                    origin_mode=origin_mode, flip_x=flip_x, flip_y=flip_y,
                )
                for px, py in ring
            ]
            msp.add_lwpolyline(poly, format="xy", close=True, dxfattribs=_entity_attrs(shape.layer))
        else:
            # Arc ve polyline segmentlerini karisik yaz.
            arc_indices = set()
            for arc in arcs:
                for k in range(arc.start_idx, arc.end_idx + 1):
                    arc_indices.add(k)

            # Arc olmayan ardisik noktalari polyline olarak yaz
            poly_buf: List[Tuple[float, float]] = []
            for k in range(ring.shape[0]):
                if k not in arc_indices:
                    poly_buf.append(_to_cad_xy(
                        x=float(ring[k][0]), y=float(ring[k][1]),
                        image_w=image_w, image_h=image_h,
                        scale_x=scale_x, scale_y=scale_y,
                        origin_mode=origin_mode, flip_x=flip_x, flip_y=flip_y,
                    ))
                else:
                    if len(poly_buf) >= 2:
                        msp.add_lwpolyline(poly_buf, format="xy", dxfattribs=_entity_attrs(shape.layer))
                    poly_buf = []
            if len(poly_buf) >= 2:
                msp.add_lwpolyline(poly_buf, format="xy", dxfattribs=_entity_attrs(shape.layer))

            # Arc'lari yaz
            scale_avg = abs(scale_x)
            for arc in arcs:
                cx_px, cy_px = arc.center
                cad_cx, cad_cy = _to_cad_xy(
                    x=cx_px, y=cy_px,
                    image_w=image_w, image_h=image_h,
                    scale_x=scale_x, scale_y=scale_y,
                    origin_mode=origin_mode, flip_x=flip_x, flip_y=flip_y,
                )
                r = arc.radius * scale_avg
                sa = arc.start_angle_deg
                ea = arc.end_angle_deg
                # Koordinat donusumleri acilari etkiler
                if origin_mode == "bottom_left" or origin_mode == "center":
                    sa = -sa
                    ea = -ea
                if flip_x:
                    sa = 180.0 - sa
                    ea = 180.0 - ea
                if flip_y:
                    sa = -sa
                    ea = -ea
                if r > 0:
                    msp.add_arc(
                        (cad_cx, cad_cy), r,
                        start_angle=sa % 360.0,
                        end_angle=ea % 360.0,
                        dxfattribs=_entity_attrs(shape.layer),
                    )

    if calib_ref_line_px is not None:
        (x1, y1), (x2, y2) = calib_ref_line_px
        p1 = _to_cad_xy(x1, y1, image_w, image_h, scale_x, scale_y, origin_mode, flip_x, flip_y)
        p2 = _to_cad_xy(x2, y2, image_w, image_h, scale_x, scale_y, origin_mode, flip_x, flip_y)
        msp.add_line(p1, p2, dxfattribs={"layer": "REF"})
        marker_r = max(((abs(scale_x) + abs(scale_y)) * 0.5) * 3.0, 0.5)
        msp.add_circle(p1, marker_r, dxfattribs={"layer": "REF"})
        msp.add_circle(p2, marker_r, dxfattribs={"layer": "REF"})

    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")


def _orientation(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    return float((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))


def _on_segment(a: np.ndarray, b: np.ndarray, c: np.ndarray, eps: float = 1e-9) -> bool:
    return (
        min(a[0], c[0]) - eps <= b[0] <= max(a[0], c[0]) + eps
        and min(a[1], c[1]) - eps <= b[1] <= max(a[1], c[1]) + eps
    )


def _segments_intersect(p1: np.ndarray, p2: np.ndarray, q1: np.ndarray, q2: np.ndarray) -> bool:
    o1 = _orientation(p1, p2, q1)
    o2 = _orientation(p1, p2, q2)
    o3 = _orientation(q1, q2, p1)
    o4 = _orientation(q1, q2, p2)

    eps = 1e-9
    if (o1 * o2 < -eps) and (o3 * o4 < -eps):
        return True
    if abs(o1) <= eps and _on_segment(p1, q1, p2):
        return True
    if abs(o2) <= eps and _on_segment(p1, q2, p2):
        return True
    if abs(o3) <= eps and _on_segment(q1, p1, q2):
        return True
    if abs(o4) <= eps and _on_segment(q1, p2, q2):
        return True
    return False


def _count_self_intersections(points_closed: np.ndarray) -> Optional[int]:
    """Sweep line ile O(n log n) self-intersection sayimi.
    Y ekseninde kucukten buyuge ilerleyip, aktif segmentlerin x aralik
    cakismasini kontrol eder. Eski O(n^2) yerine cok daha hizli."""
    ring = points_closed[:-1]
    n = ring.shape[0]
    if n < 4:
        return 0
    # Segment sayisi cok yuksekse hala atla — ancak sinir arttirildi.
    if n > MAX_SELF_INTERSECTION_SEGMENTS * 4:
        return None

    # Her segment icin (min_y, max_y, min_x, max_x, index) hesapla.
    segments = []
    for i in range(n):
        x1, y1 = float(ring[i][0]), float(ring[i][1])
        x2, y2 = float(ring[(i + 1) % n][0]), float(ring[(i + 1) % n][1])
        segments.append((
            min(y1, y2), max(y1, y2),
            min(x1, x2), max(x1, x2),
            i,
        ))

    # Y min degerine gore sirala — sweep line.
    segments.sort(key=lambda s: s[0])

    count = 0
    active: List[Tuple[float, float, float, float, int]] = []
    for seg in segments:
        min_y, max_y, min_x, max_x, idx = seg
        # Sweep line'dan suresi dolanlari cikar.
        active = [a for a in active if a[1] >= min_y]

        for a in active:
            a_min_y, a_max_y, a_min_x, a_max_x, a_idx = a
            # Komsu segmentleri atla.
            diff = abs(idx - a_idx)
            if diff <= 1 or diff == n - 1:
                continue
            # X aralik cakismasi kontrolu — hizli eleme.
            if a_max_x < min_x or max_x < a_min_x:
                continue
            # Tam kesisim testi.
            a1 = ring[a_idx]
            a2 = ring[(a_idx + 1) % n]
            b1 = ring[idx]
            b2 = ring[(idx + 1) % n]
            if _segments_intersect(a1, a2, b1, b2):
                count += 1

        active.append(seg)
    return count


def _build_quality_report(
    shapes: List[ContourShape],
    scale_x: float,
    scale_y: float,
    min_segment_length: float,
) -> Dict[str, object]:
    short_segment_count = 0
    min_seg_found = None
    self_intersections = 0
    self_intersection_skipped = 0
    non_closed = 0

    for shape in shapes:
        pts = shape.points
        if not np.allclose(pts[0], pts[-1]):
            non_closed += 1

        diffs = np.diff(pts, axis=0)
        seg_lengths = np.hypot(diffs[:, 0] * scale_x, diffs[:, 1] * scale_y)
        if seg_lengths.size > 0:
            local_min = float(np.min(seg_lengths))
            min_seg_found = local_min if min_seg_found is None else min(min_seg_found, local_min)
            if min_segment_length > 0:
                short_segment_count += int(np.sum(seg_lengths < min_segment_length))

        isects = _count_self_intersections(pts)
        if isects is None:
            self_intersection_skipped += 1
        else:
            self_intersections += int(isects)

    layer_counts: Dict[str, int] = {}
    for shape in shapes:
        layer_counts[shape.layer] = layer_counts.get(shape.layer, 0) + 1

    warnings: List[str] = []
    if non_closed > 0:
        warnings.append(f"{non_closed} kontur tam kapanmamis olabilir.")
    if self_intersections > 0:
        warnings.append(f"{self_intersections} self-intersection bulundu.")
    if short_segment_count > 0 and min_segment_length > 0:
        warnings.append(
            f"{short_segment_count} segment, min segment limiti ({min_segment_length:g}) altinda."
        )
    if not warnings:
        warnings.append("Geometri temel kalite kontrollerinden gecti.")

    return {
        "non_closed_contours": non_closed,
        "self_intersections": self_intersections,
        "self_intersection_checks_skipped": self_intersection_skipped,
        "short_segments": short_segment_count,
        "min_segment_found": round(float(min_seg_found), 6) if min_seg_found is not None else None,
        "layer_counts": layer_counts,
        "warnings": warnings,
    }


def _draw_ellipse_outline(
    draw: ImageDraw.ImageDraw,
    shape: ContourShape,
    scale: float,
    color: Tuple[int, int, int, int],
    line_w: int,
    num_points: int = 72,
) -> None:
    """PIL'de rotasyonlu ellipse cizmek icin parametrik noktalar uret ve line olarak ciz."""
    assert shape.ellipse_center_px is not None
    assert shape.ellipse_semi_major_px is not None
    assert shape.ellipse_semi_minor_px is not None
    assert shape.ellipse_rotation_rad is not None
    cx = float(shape.ellipse_center_px[0] * scale)
    cy = float(shape.ellipse_center_px[1] * scale)
    a = float(shape.ellipse_semi_major_px * scale)
    b = float(shape.ellipse_semi_minor_px * scale)
    angle = float(shape.ellipse_rotation_rad)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    pts = []
    for i in range(num_points + 1):
        t = 2.0 * math.pi * i / num_points
        ex = a * math.cos(t)
        ey = b * math.sin(t)
        px = cx + ex * cos_a - ey * sin_a
        py = cy + ex * sin_a + ey * cos_a
        pts.append((px, py))
    if len(pts) >= 2:
        draw.line(pts, fill=color, width=line_w)


def _draw_ellipse_outline_padded(
    draw: ImageDraw.ImageDraw,
    shape: ContourShape,
    scale: float,
    pad: int,
    color: Tuple[int, int, int, int],
    line_w: int,
    num_points: int = 72,
) -> None:
    """Dimension overlay icin pad offset'li ellipse cizimi."""
    assert shape.ellipse_center_px is not None
    assert shape.ellipse_semi_major_px is not None
    assert shape.ellipse_semi_minor_px is not None
    assert shape.ellipse_rotation_rad is not None
    cx = float(shape.ellipse_center_px[0] * scale + pad)
    cy = float(shape.ellipse_center_px[1] * scale + pad)
    a = float(shape.ellipse_semi_major_px * scale)
    b = float(shape.ellipse_semi_minor_px * scale)
    angle = float(shape.ellipse_rotation_rad)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    pts = []
    for i in range(num_points + 1):
        t = 2.0 * math.pi * i / num_points
        ex = a * math.cos(t)
        ey = b * math.sin(t)
        px = cx + ex * cos_a - ey * sin_a
        py = cy + ex * sin_a + ey * cos_a
        pts.append((px, py))
    if len(pts) >= 2:
        draw.line(pts, fill=color, width=line_w)


def _build_preview_overlay(
    image: Image.Image,
    shapes: List[ContourShape],
    calib_points_px: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None,
) -> str:
    w, h = image.size
    scale = min(1.0, float(MAX_PREVIEW_SIDE) / float(max(w, h) or 1))
    if scale < 1.0:
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        canvas = image.convert("RGB").resize((nw, nh), resample=resample)
    else:
        canvas = image.convert("RGB").copy()

    draw = ImageDraw.Draw(canvas, mode="RGBA")
    line_w = max(6, int(round(6 * max(scale, 0.5))))
    layer_colors = {
        "OUTER": (34, 197, 94, 255),
        "INNER": (239, 68, 68, 255),
        "HOLES": (6, 182, 212, 255),
    }

    for shape in shapes:
        color = layer_colors.get(shape.layer, (250, 204, 21, 220))
        if shape.is_circle and shape.circle_center_px and shape.circle_radius_px:
            cx = float(shape.circle_center_px[0] * scale)
            cy = float(shape.circle_center_px[1] * scale)
            r = float(shape.circle_radius_px * scale)
            draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color, width=line_w)
            continue

        if (
            shape.is_ellipse
            and shape.ellipse_center_px
            and shape.ellipse_semi_major_px
            and shape.ellipse_semi_minor_px
            and shape.ellipse_rotation_rad is not None
        ):
            _draw_ellipse_outline(
                draw, shape, scale, color, line_w,
            )
            continue

        xy = [(float(p[0] * scale), float(p[1] * scale)) for p in shape.points]
        if len(xy) >= 2:
            draw.line(xy, fill=color, width=line_w)

    if calib_points_px is not None:
        (x1, y1), (x2, y2) = calib_points_px
        p1 = (float(x1 * scale), float(y1 * scale))
        p2 = (float(x2 * scale), float(y2 * scale))
        draw.line([p1, p2], fill=(250, 204, 21, 255), width=max(2, line_w))
        r = max(4, int(round(4 * max(scale, 0.6))))
        draw.ellipse((p1[0] - r, p1[1] - r, p1[0] + r, p1[1] + r), fill=(250, 204, 21, 255))
        draw.ellipse((p2[0] - r, p2[1] - r, p2[0] + r, p2[1] + r), fill=(250, 204, 21, 255))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _shape_bounds_px(shapes: List[ContourShape]) -> Optional[Tuple[float, float, float, float]]:
    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")
    found = False
    for shape in shapes:
        ring = shape.points[:-1] if np.allclose(shape.points[0], shape.points[-1]) else shape.points
        if ring.size == 0:
            continue
        found = True
        min_x = min(min_x, float(np.min(ring[:, 0])))
        min_y = min(min_y, float(np.min(ring[:, 1])))
        max_x = max(max_x, float(np.max(ring[:, 0])))
        max_y = max(max_y, float(np.max(ring[:, 1])))
    if not found:
        return None
    return min_x, min_y, max_x, max_y


def _format_dim_value(value: float, unit: str) -> str:
    u = unit if unit != "unitless" else "u"
    v = abs(float(value))
    if v >= 1000:
        s = f"{v:.1f}"
    elif v >= 100:
        s = f"{v:.2f}"
    else:
        s = f"{v:.3f}"
    return f"{s} {u}"


def _draw_text_tag(draw: ImageDraw.ImageDraw, x: float, y: float, text: str) -> None:
    try:
        left, top, right, bottom = draw.textbbox((x, y), text)
        w = max(1.0, float(right - left))
        h = max(1.0, float(bottom - top))
    except Exception:
        w = max(1.0, float(len(text) * 7))
        h = 12.0
    pad_x = 4.0
    pad_y = 3.0
    draw.rounded_rectangle(
        (x - pad_x, y - pad_y, x + w + pad_x, y + h + pad_y),
        radius=4,
        fill=(3, 7, 18, 225),
        outline=(99, 102, 241, 190),
        width=1,
    )
    draw.text((x, y), text, fill=(255, 255, 255, 255))


def _draw_arrow(draw: ImageDraw.ImageDraw, x: float, y: float, horizontal: bool, direction: int, size: float) -> None:
    if horizontal:
        points = [
            (x, y),
            (x + (size * direction), y - (size * 0.55)),
            (x + (size * direction), y + (size * 0.55)),
        ]
    else:
        points = [
            (x, y),
            (x - (size * 0.55), y + (size * direction)),
            (x + (size * 0.55), y + (size * direction)),
        ]
    draw.polygon(points, fill=(250, 204, 21, 255))


def _build_dimension_overlay(
    image: Image.Image,
    shapes: List[ContourShape],
    scale_x: float,
    scale_y: float,
    unit: str,
    calib_points_px: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None,
) -> Tuple[str, Optional[Dict[str, float]]]:
    w, h = image.size
    scale = min(1.0, float(MAX_PREVIEW_SIDE) / float(max(w, h) or 1))
    if scale < 1.0:
        nw = max(1, int(round(w * scale)))
        nh = max(1, int(round(h * scale)))
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        base = image.convert("RGB").resize((nw, nh), resample=resample)
    else:
        base = image.convert("RGB").copy()
        nw, nh = base.size

    pad = max(58, int(round(68 * max(scale, 0.6))))
    canvas = Image.new("RGB", (nw + pad * 2, nh + pad * 2), color=(5, 8, 16))
    canvas.paste(base, (pad, pad))
    draw = ImageDraw.Draw(canvas, mode="RGBA")
    line_w = max(6, int(round(6 * max(scale, 0.55))))

    layer_colors = {
        "OUTER": (34, 197, 94, 255),
        "INNER": (239, 68, 68, 255),
        "HOLES": (6, 182, 212, 255),
    }

    for shape in shapes:
        color = layer_colors.get(shape.layer, (250, 204, 21, 220))
        if shape.is_circle and shape.circle_center_px and shape.circle_radius_px:
            cx = float(shape.circle_center_px[0] * scale + pad)
            cy = float(shape.circle_center_px[1] * scale + pad)
            r = float(shape.circle_radius_px * scale)
            draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color, width=line_w)
            continue
        if (
            shape.is_ellipse
            and shape.ellipse_center_px
            and shape.ellipse_semi_major_px
            and shape.ellipse_semi_minor_px
            and shape.ellipse_rotation_rad is not None
        ):
            _draw_ellipse_outline_padded(draw, shape, scale, pad, color, line_w)
            continue
        xy = [(float(p[0] * scale + pad), float(p[1] * scale + pad)) for p in shape.points]
        if len(xy) >= 2:
            draw.line(xy, fill=color, width=line_w)

    bounds = _shape_bounds_px(shapes)
    dimension_summary: Optional[Dict[str, float]] = None
    if bounds is not None:
        min_x_px, min_y_px, max_x_px, max_y_px = bounds
        min_x = float(min_x_px * scale + pad)
        min_y = float(min_y_px * scale + pad)
        max_x = float(max_x_px * scale + pad)
        max_y = float(max_y_px * scale + pad)

        bbox_w = max(0.0, (max_x_px - min_x_px) * abs(scale_x))
        bbox_h = max(0.0, (max_y_px - min_y_px) * abs(scale_y))
        dimension_summary = {
            "bbox_width": round(float(bbox_w), 6),
            "bbox_height": round(float(bbox_h), 6),
        }

        draw.rectangle((min_x, min_y, max_x, max_y), outline=(148, 163, 184, 210), width=max(1, line_w - 1))

        dim_margin = max(24, int(round(28 * max(scale, 0.55))))
        arrow_size = max(7.0, float(7 * max(scale, 0.65)))

        # Width dimension line (below)
        y_dim = min(float(canvas.height - 12), max_y + dim_margin)
        draw.line([(min_x, max_y), (min_x, y_dim)], fill=(148, 163, 184, 215), width=1)
        draw.line([(max_x, max_y), (max_x, y_dim)], fill=(148, 163, 184, 215), width=1)
        draw.line([(min_x, y_dim), (max_x, y_dim)], fill=(250, 204, 21, 245), width=max(2, line_w))
        _draw_arrow(draw, min_x, y_dim, horizontal=True, direction=1, size=arrow_size)
        _draw_arrow(draw, max_x, y_dim, horizontal=True, direction=-1, size=arrow_size)
        w_text = f"W = {_format_dim_value(bbox_w, unit)}"
        _draw_text_tag(draw, (min_x + max_x) * 0.5 - 40, y_dim + 8, w_text)

        # Height dimension line (right)
        x_dim = min(float(canvas.width - 12), max_x + dim_margin)
        draw.line([(max_x, min_y), (x_dim, min_y)], fill=(148, 163, 184, 215), width=1)
        draw.line([(max_x, max_y), (x_dim, max_y)], fill=(148, 163, 184, 215), width=1)
        draw.line([(x_dim, min_y), (x_dim, max_y)], fill=(250, 204, 21, 245), width=max(2, line_w))
        _draw_arrow(draw, x_dim, min_y, horizontal=False, direction=1, size=arrow_size)
        _draw_arrow(draw, x_dim, max_y, horizontal=False, direction=-1, size=arrow_size)
        h_text = f"H = {_format_dim_value(bbox_h, unit)}"
        _draw_text_tag(draw, x_dim + 8, (min_y + max_y) * 0.5 - 8, h_text)

    # Circle diameter tags for production readability.
    circles = [s for s in shapes if s.is_circle and s.circle_center_px and s.circle_radius_px]
    circles.sort(key=lambda s: float(s.circle_radius_px or 0.0), reverse=True)
    dia_scale = (abs(scale_x) + abs(scale_y)) * 0.5
    for idx, shape in enumerate(circles[:6]):
        assert shape.circle_center_px is not None and shape.circle_radius_px is not None
        cx = float(shape.circle_center_px[0] * scale + pad)
        cy = float(shape.circle_center_px[1] * scale + pad)
        dia = max(0.0, 2.0 * float(shape.circle_radius_px) * dia_scale)
        tx = min(float(canvas.width - 110), cx + 24.0 + (idx % 2) * 18.0)
        ty = max(12.0, cy - 18.0 - idx * 12.0)
        draw.line([(cx, cy), (tx, ty)], fill=(59, 130, 246, 240), width=max(1, line_w - 1))
        _draw_text_tag(draw, tx + 3.0, ty - 8.0, f"D = {_format_dim_value(dia, unit)}")

    if calib_points_px is not None:
        (x1, y1), (x2, y2) = calib_points_px
        p1 = (float(x1 * scale + pad), float(y1 * scale + pad))
        p2 = (float(x2 * scale + pad), float(y2 * scale + pad))
        draw.line([p1, p2], fill=(99, 102, 241, 255), width=max(2, line_w))
        ref_dist = math.hypot((x2 - x1) * abs(scale_x), (y2 - y1) * abs(scale_y))
        tx = (p1[0] + p2[0]) * 0.5 + 8.0
        ty = (p1[1] + p2[1]) * 0.5 + 8.0
        _draw_text_tag(draw, tx, ty, f"REF = {_format_dim_value(ref_dist, unit)}")

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"), dimension_summary


def _validate_point(x: Optional[float], y: Optional[float], image_w: int, image_h: int, name: str) -> Tuple[float, float]:
    if x is None or y is None:
        raise HTTPException(status_code=400, detail=f"{name} nokta koordinati eksik")
    px = float(x)
    py = float(y)
    if not (0.0 <= px <= float(image_w) and 0.0 <= py <= float(image_h)):
        raise HTTPException(status_code=400, detail=f"{name} koordinati gorsel siniri disinda")
    return px, py


@router.post("/vectorize")
async def vectorize_to_dxf(
    file: UploadFile = File(...),
    scale_factor: float = Form(default=1.0),
    unit: str = Form(default="unitless"),
    min_area_px: int = Form(default=16),
    min_area_pct: float = Form(default=0.0),
    blur_sigma: float = Form(default=0.0),
    simplify_px: float = Form(default=0.0),
    detect_circles: bool = Form(default=True),
    circle_tolerance: float = Form(default=0.08),
    detect_arcs: bool = Form(default=False),
    arc_tolerance: float = Form(default=0.06),
    export_svg: bool = Form(default=False),
    min_segment_length: float = Form(default=0.0),
    origin_mode: str = Form(default="bottom_left"),
    flip_x: bool = Form(default=False),
    flip_y: bool = Form(default=False),
    calibration_mode: str = Form(default="auto_scan"),
    calib_p1_x: Optional[float] = Form(default=None),
    calib_p1_y: Optional[float] = Form(default=None),
    calib_p2_x: Optional[float] = Form(default=None),
    calib_p2_y: Optional[float] = Form(default=None),
    calib_distance: Optional[float] = Form(default=None),
    foreground_mode: str = Form(default="all"),
    _tenant: dict = Depends(get_current_tenant),
):
    if unit not in UNIT_CODES:
        raise HTTPException(status_code=400, detail=f"Gecersiz unit: {unit}")
    if origin_mode not in ORIGIN_MODES:
        raise HTTPException(status_code=400, detail=f"Gecersiz origin_mode: {origin_mode}")
    if calibration_mode not in CALIBRATION_MODES:
        raise HTTPException(status_code=400, detail=f"Gecersiz calibration_mode: {calibration_mode}")
    foreground_mode = (foreground_mode or "all").strip().lower()
    if foreground_mode not in VALID_FOREGROUND_MODES:
        raise HTTPException(status_code=400, detail=f"Gecersiz foreground_mode: {foreground_mode}")
    if not (0.000001 <= float(scale_factor) <= 1000000):
        raise HTTPException(status_code=400, detail="scale_factor 0'dan buyuk olmali")
    if not (0 <= int(min_area_px) <= 5_000_000):
        raise HTTPException(status_code=400, detail="min_area_px aralik disinda")
    if not (0.0 <= float(min_area_pct) <= 50.0):
        raise HTTPException(status_code=400, detail="min_area_pct 0-50 araliginda olmali")
    if not (0.0 <= float(blur_sigma) <= 10.0):
        raise HTTPException(status_code=400, detail="blur_sigma 0-10 araliginda olmali")
    if not (0.0 <= float(simplify_px) <= 50.0):
        raise HTTPException(status_code=400, detail="simplify_px aralik disinda")
    if not (0.0 <= float(circle_tolerance) <= 0.5):
        raise HTTPException(status_code=400, detail="circle_tolerance aralik disinda")
    if not (0.0 <= float(arc_tolerance) <= 0.5):
        raise HTTPException(status_code=400, detail="arc_tolerance aralik disinda")
    if not (0.0 <= float(min_segment_length) <= 1_000_000):
        raise HTTPException(status_code=400, detail="min_segment_length aralik disinda")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Dosya cok buyuk. Maksimum {MAX_IMAGE_MB} MB.")

    try:
        image = Image.open(io.BytesIO(content))
        image.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Gorsel okunamadi veya desteklenmiyor")

    rgba = image.convert("RGBA")

    def _cpu_bound_processing() -> Tuple[List[ContourShape], List[ContourShape], np.ndarray, np.ndarray, Optional[Dict[str, object]]]:
        gray = np.array(rgba.convert("L"), dtype=np.uint8)
        alpha_ch = np.array(rgba.getchannel("A"), dtype=np.uint8)
        foreground_info: Optional[Dict[str, object]] = None
        m = None
        used_color_mask = False
        if foreground_mode != "all":
            try:
                color_mask, selection = select_foreground_mask(rgba, mode=foreground_mode)
                foreground_info = selection.as_dict()
                if color_mask is not None:
                    m = color_mask
                    used_color_mask = True
            except Exception as e:
                foreground_info = {
                    "requested_mode": foreground_mode,
                    "applied": False,
                    "source": "error_fallback",
                    "note": str(e),
                }
        if m is None:
            m = _pick_foreground_mask(gray, alpha_ch, blur_sigma=float(blur_sigma))
        if not used_color_mask:
            m = _clean_mask(m)
        if not np.any(m):
            return [], [], gray, alpha_ch, foreground_info
        cpts = _extract_contours(
            m, int(min_area_px), float(simplify_px), min_area_pct=float(min_area_pct),
        )
        sh: List[ContourShape] = [
            ContourShape(points=pts, signed_area_px=_polygon_area_signed(pts)) for pts in cpts
        ]
        _assign_hierarchy_and_layers(sh)
        _classify_circles(sh, detect_circles=bool(detect_circles), circle_tolerance=float(circle_tolerance))

        m_net = m.copy()
        try:
            # Ultra netlestirme: once yumusak blur, sonra mode filter ile capak temizligi.
            pil_net = Image.fromarray(m_net.astype(np.uint8) * 255, mode="L")
            pil_net = pil_net.filter(ImageFilter.GaussianBlur(radius=1.1))
            pil_net = pil_net.filter(ImageFilter.ModeFilter(size=13))
            m_net = np.array(pil_net, dtype=np.uint8) > 127
        except Exception as e:
            _log.warning("Net netlestirme filtresi uygulanamadı, ham maske kullanılıyor: %s", e)

        # Net DXF tarafında "nokta nokta" görünümü azaltmak için,
        # net kontur sadeleştirmeyi daha agresif bir tabanla uygula.
        net_simplify_px = max(float(simplify_px), 3.0)
        cpts_net = _extract_contours(
            m_net, int(min_area_px), net_simplify_px, min_area_pct=float(min_area_pct),
        )
        cpts_net = [_optimize_net_ring(pts, net_simplify_px) for pts in cpts_net]
        cpts_net = [pts for pts in cpts_net if pts.shape[0] >= 4]
        sh_net: List[ContourShape] = [
            ContourShape(points=pts, signed_area_px=_polygon_area_signed(pts)) for pts in cpts_net
        ]
        _assign_hierarchy_and_layers(sh_net)
        _classify_circles(sh_net, detect_circles=True, circle_tolerance=max(float(circle_tolerance), 0.15))

        return sh, sh_net, gray, alpha_ch, foreground_info

    loop = asyncio.get_event_loop()
    shapes, shapes_net, gray, alpha, foreground_info = await loop.run_in_executor(None, _cpu_bound_processing)

    if not shapes:
        raise HTTPException(status_code=422, detail="Kontur cikarilacak foreground bulunamadi veya kontur cikarilamadi")

    calibration_info: Dict[str, object] = {"mode": calibration_mode}
    calib_line_px: Optional[Tuple[Tuple[float, float], Tuple[float, float]]] = None

    scale_factor_input = float(scale_factor)
    scale_x = scale_factor_input
    scale_y = scale_factor_input
    if calibration_mode == "two_point":
        p1 = _validate_point(calib_p1_x, calib_p1_y, rgba.width, rgba.height, "P1")
        p2 = _validate_point(calib_p2_x, calib_p2_y, rgba.width, rgba.height, "P2")
        if calib_distance is None or float(calib_distance) <= 0:
            raise HTTPException(status_code=400, detail="calib_distance 0'dan buyuk olmali")
        pixel_distance = float(math.hypot(p2[0] - p1[0], p2[1] - p1[1]))
        if pixel_distance <= 1e-9:
            raise HTTPException(status_code=400, detail="Kalibrasyon noktalarinin mesafesi sifir olamaz")
        measured_scale = float(calib_distance) / pixel_distance
        scale_x = measured_scale * scale_factor_input
        scale_y = measured_scale * scale_factor_input
        calibration_info = {
            "mode": calibration_mode,
            "p1_px": [round(p1[0], 4), round(p1[1], 4)],
            "p2_px": [round(p2[0], 4), round(p2[1], 4)],
            "pixel_distance": round(pixel_distance, 6),
            "real_distance": float(calib_distance),
            "measured_scale": round(measured_scale, 12),
            "manual_scale_factor": scale_factor_input,
            "effective_scale_x": round(scale_x, 12),
            "effective_scale_y": round(scale_y, 12),
            "effective_scale": round((scale_x + scale_y) * 0.5, 12),
            "source": "two_point_reference",
        }
        calib_line_px = (p1, p2)
    elif calibration_mode == "auto_scan":
        unit_to_mm = UNIT_TO_MM.get(unit, 1.0)
        dpi_info = _read_dpi_from_image(image)
        if dpi_info is not None:
            dpi_x, dpi_y, source = dpi_info
            mm_per_px_x = 25.4 / float(dpi_x)
            mm_per_px_y = 25.4 / float(dpi_y)
            scale_x = (mm_per_px_x / unit_to_mm) * scale_factor_input
            scale_y = (mm_per_px_y / unit_to_mm) * scale_factor_input
            calibration_info = {
                "mode": calibration_mode,
                "source": source,
                "dpi_x": round(float(dpi_x), 6),
                "dpi_y": round(float(dpi_y), 6),
                "manual_scale_factor": scale_factor_input,
                "effective_scale_x": round(scale_x, 12),
                "effective_scale_y": round(scale_y, 12),
                "effective_scale": round((scale_x + scale_y) * 0.5, 12),
                "confidence": "high",
            }
        else:
            guessed = _infer_scan_scale_from_page(rgba.width, rgba.height)
            if guessed is not None:
                mm_per_px_x = guessed["page_w_mm"] / float(rgba.width)
                mm_per_px_y = guessed["page_h_mm"] / float(rgba.height)
                scale_x = (mm_per_px_x / unit_to_mm) * scale_factor_input
                scale_y = (mm_per_px_y / unit_to_mm) * scale_factor_input
                calibration_info = {
                    "mode": calibration_mode,
                    "source": "page_guess",
                    "guessed_page": guessed["page_name"],
                    "guessed_dpi": guessed["dpi_guess"],
                    "match_error": round(float(guessed["error"]), 6),
                    "manual_scale_factor": scale_factor_input,
                    "effective_scale_x": round(scale_x, 12),
                    "effective_scale_y": round(scale_y, 12),
                    "effective_scale": round((scale_x + scale_y) * 0.5, 12),
                    "confidence": "medium",
                }
            else:
                scale_x = scale_factor_input
                scale_y = scale_factor_input
                calibration_info = {
                    "mode": calibration_mode,
                    "source": "fallback_factor",
                    "manual_scale_factor": scale_factor_input,
                    "effective_scale_x": round(scale_x, 12),
                    "effective_scale_y": round(scale_y, 12),
                    "effective_scale": round((scale_x + scale_y) * 0.5, 12),
                    "confidence": "low",
                    "warning": "DPI veya sayfa olcegi otomatik tespit edilemedi, manual factor kullanildi.",
                }
    else:
        calibration_info = {
            "mode": calibration_mode,
            "source": "manual_factor",
            "manual_scale_factor": scale_factor_input,
            "effective_scale_x": round(scale_x, 12),
            "effective_scale_y": round(scale_y, 12),
            "effective_scale": round((scale_x + scale_y) * 0.5, 12),
        }

    def _cpu_bound_output() -> Tuple[str, Tuple[str, Optional[Dict[str, float]]], bytes, Optional[str], str, bytes]:
        po = _build_preview_overlay(rgba, shapes, calib_points_px=calib_line_px)
        pd = _build_dimension_overlay(
            rgba, shapes,
            scale_x=scale_x, scale_y=scale_y, unit=unit,
            calib_points_px=calib_line_px,
        )
        db = _build_dxf_bytes(
            shapes=shapes,
            image_w=rgba.width, image_h=rgba.height,
            scale_x=scale_x, scale_y=scale_y, unit=unit,
            origin_mode=origin_mode,
            flip_x=bool(flip_x), flip_y=bool(flip_y),
            calib_ref_line_px=calib_line_px,
            detect_arcs=bool(detect_arcs),
            arc_tolerance=float(arc_tolerance),
        )
        po_net = _build_preview_overlay(rgba, shapes_net, calib_points_px=calib_line_px)
        db_net = _build_dxf_bytes(
            shapes=shapes_net,
            image_w=rgba.width, image_h=rgba.height,
            scale_x=scale_x, scale_y=scale_y, unit=unit,
            origin_mode=origin_mode,
            flip_x=bool(flip_x), flip_y=bool(flip_y),
            calib_ref_line_px=calib_line_px,
            # Net DXF'te tek parça/sürekli çizgi davranışı için arc segmentasyonunu kapat.
            detect_arcs=False,
            arc_tolerance=float(arc_tolerance),
            force_continuous_linetype=True,
        )
        svg = None
        if bool(export_svg):
            svg = _build_svg_string(
                shapes=shapes,
                image_w=rgba.width, image_h=rgba.height,
                scale_x=scale_x, scale_y=scale_y,
                origin_mode=origin_mode,
                flip_x=bool(flip_x), flip_y=bool(flip_y),
            )
        return po, pd, db, svg, po_net, db_net

    preview_overlay, (preview_dimension, dimension_summary), dxf_bytes, svg_string, preview_net, dxf_net_bytes = await loop.run_in_executor(
        None, _cpu_bound_output,
    )

    total_points = int(sum(max(0, shape.points.shape[0] - 1) for shape in shapes))
    stem = Path(file.filename or "contour").stem or "contour"
    dxf_filename = f"{stem}_contour.dxf"
    quality = _build_quality_report(
        shapes=shapes,
        scale_x=scale_x,
        scale_y=scale_y,
        min_segment_length=float(min_segment_length),
    )
    if bool(detect_circles):
        circle_count = sum(1 for s in shapes if s.is_circle)
        anisotropic = abs(scale_x - scale_y) > (max(abs(scale_x), abs(scale_y), 1e-9) * 1e-6)
        if circle_count > 0 and anisotropic:
            quality["warnings"].append(
                "X/Y olcek farkli oldugu icin CIRCLE adaylari polyline olarak yazildi."
            )
    if calibration_info.get("confidence") == "low":
        quality["warnings"].append(
            "Otomatik kalibrasyon guveni dusuk; kritik olculer icin manuel referans onerilir."
        )
    if foreground_info and foreground_info.get("requested_mode") != "all" and not foreground_info.get("applied"):
        quality["warnings"].append(
            "Renkli parca konturu tespit edilemedi; mevcut gri esikleme ile devam edildi."
        )

    area_total_px = float(sum(shape.area_px for shape in shapes))
    area_total_unit = area_total_px * (scale_x * scale_y)

    return {
        "status": "ok",
        "source_filename": file.filename or "upload",
        "dxf_filename": dxf_filename,
        "dxf_base64": base64.b64encode(dxf_bytes).decode("ascii"),
        "dxf_net_base64": base64.b64encode(dxf_net_bytes).decode("ascii"),
        "svg_base64": base64.b64encode(svg_string.encode("utf-8")).decode("ascii") if svg_string else None,
        "preview_contour": preview_overlay,
        "preview_dimension": preview_dimension,
        "preview_net": preview_net,
        "calibration": calibration_info,
        "quality": quality,
        "foreground": foreground_info,
        "dimensions": {
            "bbox_width": dimension_summary["bbox_width"] if dimension_summary else None,
            "bbox_height": dimension_summary["bbox_height"] if dimension_summary else None,
            "unit": unit,
        },
        "stats": {
            "image_width": rgba.width,
            "image_height": rgba.height,
            "contour_count": len(shapes),
            "total_points": total_points,
            "scale_factor": round((scale_x + scale_y) * 0.5, 12),
            "scale_factor_x": round(scale_x, 12),
            "scale_factor_y": round(scale_y, 12),
            "unit": unit,
            "min_area_px": int(min_area_px),
            "simplify_px": float(simplify_px),
            "origin_mode": origin_mode,
            "flip_x": bool(flip_x),
            "flip_y": bool(flip_y),
            "detect_circles": bool(detect_circles),
            "circle_tolerance": float(circle_tolerance),
            "area_total_px": round(area_total_px, 6),
            "area_total_unit2": round(area_total_unit, 6),
            "bbox_width": dimension_summary["bbox_width"] if dimension_summary else None,
            "bbox_height": dimension_summary["bbox_height"] if dimension_summary else None,
            "layer_counts": quality["layer_counts"],
        },
    }
