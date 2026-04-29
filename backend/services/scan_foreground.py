"""
Foreground isolation helpers for scan-to-CAD image inputs.

This module is intentionally separate from the route code so the legacy
grayscale vectorization path can stay available as a fallback.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
from PIL import Image, ImageFilter


VALID_FOREGROUND_MODES = {"all", "part", "auto"}


@dataclass
class ForegroundSelection:
    requested_mode: str
    applied: bool
    source: str
    mask_ratio: float = 0.0
    red_ratio: float = 0.0
    color_ratio: float = 0.0
    note: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "requested_mode": self.requested_mode,
            "applied": self.applied,
            "source": self.source,
            "mask_ratio": round(float(self.mask_ratio), 6),
            "red_ratio": round(float(self.red_ratio), 6),
            "color_ratio": round(float(self.color_ratio), 6),
            "note": self.note,
        }


def _validate_mode(mode: str) -> str:
    mode = (mode or "all").strip().lower()
    if mode not in VALID_FOREGROUND_MODES:
        raise ValueError(f"Gecersiz foreground_mode: {mode}")
    return mode


def _ratio(mask: np.ndarray) -> float:
    return float(mask.mean()) if mask.size else 0.0


def _morph_close(mask: np.ndarray) -> np.ndarray:
    if mask.size == 0:
        return mask
    pil = Image.fromarray(mask.astype(np.uint8) * 255, mode="L")
    # Join anti-aliased colored contour pixels and small scan/color dropouts.
    # The kernel is capped so nearby distinct details are not broadly merged.
    close_px = max(3, min(15, int(round(min(mask.shape) * 0.02))))
    if close_px % 2 == 0:
        close_px += 1
    pil = pil.filter(ImageFilter.MaxFilter(close_px)).filter(ImageFilter.MinFilter(close_px))
    return np.array(pil, dtype=np.uint8) > 127


def _filter_small_components(mask: np.ndarray) -> np.ndarray:
    if mask.size == 0 or not np.any(mask):
        return mask
    try:
        from scipy import ndimage
    except Exception:
        return mask

    labels, count = ndimage.label(mask)
    if count <= 1:
        return mask

    areas = np.bincount(labels.ravel())
    if len(areas) <= 1:
        return mask

    largest = int(areas[1:].max())
    min_area = max(8, int(mask.size * 0.000015), int(largest * 0.015))
    keep = np.zeros_like(mask, dtype=bool)
    for idx, area in enumerate(areas):
        if idx == 0:
            continue
        if area >= min_area:
            keep |= labels == idx
    return keep if np.any(keep) else mask


def _odd_kernel(value: int, minimum: int = 3, maximum: int = 21) -> int:
    value = max(minimum, min(maximum, int(value)))
    return value + 1 if value % 2 == 0 else value


def _colored_masks(rgba: Image.Image) -> Tuple[np.ndarray, np.ndarray, float, float]:
    arr = np.array(rgba.convert("RGBA"), dtype=np.uint8)
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3] > 12

    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]
    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    sat = (maxc - minc) / np.maximum(maxc, 1)

    colored = alpha & (maxc > 50) & (sat > 0.16)
    red = (
        colored
        & (r > 70)
        & ((r - g) > 18)
        & ((r - b) > 18)
        & (r >= (np.maximum(g, b) * 1.10))
    )
    return red, colored, _ratio(red), _ratio(colored)


def _select_bw_section_profile_mask(rgba: Image.Image) -> Tuple[Optional[np.ndarray], Optional[str]]:
    """Best-effort section profile extraction for monochrome technical drawings."""
    try:
        import cv2
    except Exception:
        return None, "opencv kullanilamiyor."

    gray = np.array(rgba.convert("L"), dtype=np.uint8)
    image_h, image_w = gray.shape
    if image_h <= 20 or image_w <= 20:
        return None, "Gorsel boyutu cok kucuk."

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Technical sheets usually place notes/title blocks in the lower third.
    # Hatch candidates in the upper drawing area are a stronger profile signal.
    crop_h = max(20, int(image_h * 0.70))
    drawing = binary[:crop_h, :]

    lines = cv2.HoughLinesP(
        drawing,
        rho=1,
        theta=np.pi / 180,
        threshold=20,
        minLineLength=10,
        maxLineGap=2,
    )
    hatch_points = []
    if lines is not None:
        for raw in lines[:, 0, :]:
            x1, y1, x2, y2 = [int(v) for v in raw]
            length = float(np.hypot(x2 - x1, y2 - y1))
            if length < 8.0 or length > 90.0:
                continue
            angle = abs(float(np.degrees(np.arctan2(y2 - y1, x2 - x1))))
            if angle > 90.0:
                angle = 180.0 - angle
            if not (30.0 <= angle <= 75.0):
                continue
            mx = (x1 + x2) * 0.5
            my = (y1 + y2) * 0.5
            if not (image_w * 0.22 <= mx <= image_w * 0.80):
                continue
            if not (image_h * 0.08 <= my <= image_h * 0.60):
                continue
            hatch_points.append((x1, y1))
            hatch_points.append((x2, y2))

    if len(hatch_points) < 8:
        return None, "Kesit tarama/hatch bolgesi tespit edilemedi."

    xs = [p[0] for p in hatch_points]
    ys = [p[1] for p in hatch_points]
    pad_x = max(40, int(round(image_w * 0.055)))
    pad_y = max(30, int(round(image_h * 0.030)))
    x0 = max(0, min(xs) - pad_x)
    x1 = min(image_w, max(xs) + pad_x)
    y0 = max(0, min(ys) - pad_y)
    y1 = min(crop_h, max(ys) + pad_y)
    if x1 - x0 < 40 or y1 - y0 < 40:
        return None, "Profil ilgi alani cok kucuk."

    roi = binary[y0:y1, x0:x1]
    close_k = _odd_kernel(round(min(roi.shape) * 0.022), minimum=7, maximum=15)
    open_k = _odd_kernel(close_k - 4, minimum=5, maximum=7)
    material = cv2.morphologyEx(roi, cv2.MORPH_CLOSE, np.ones((close_k, close_k), np.uint8), iterations=1)
    material = cv2.morphologyEx(material, cv2.MORPH_OPEN, np.ones((open_k, open_k), np.uint8), iterations=1)

    num, labels, stats, _ = cv2.connectedComponentsWithStats((material > 0).astype(np.uint8), 8)
    if num <= 1:
        return None, "Profil malzeme bolgesi bulunamadi."

    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = int(areas.max())
    min_area = max(500, int(largest * 0.10))
    roi_mask = np.zeros_like(material, dtype=bool)
    for idx in range(1, num):
        area = int(stats[idx, cv2.CC_STAT_AREA])
        if area >= min_area:
            roi_mask |= labels == idx

    if not np.any(roi_mask):
        return None, "Profil malzeme maskesi bos kaldi."

    full = np.zeros_like(binary, dtype=bool)
    full[y0:y1, x0:x1] = roi_mask
    return full, None


def _select_solid_bw_profile_mask(rgba: Image.Image) -> Tuple[Optional[np.ndarray], Optional[str]]:
    """Detect a single filled monochrome part silhouette without cropping it."""
    try:
        import cv2
    except Exception:
        return None, "opencv kullanilamiyor."

    gray = np.array(rgba.convert("L"), dtype=np.uint8)
    image_h, image_w = gray.shape
    if image_h <= 20 or image_w <= 20:
        return None, "Gorsel boyutu cok kucuk."

    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    foreground = (binary > 0).astype(np.uint8)
    ink_ratio = float(foreground.mean())
    if ink_ratio < 0.004 or ink_ratio > 0.40:
        return None, "Siyah-beyaz dolu profil icin uygun doluluk orani yok."

    num, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if num <= 1:
        return None, "Siyah-beyaz profil bileseni bulunamadi."

    areas = stats[1:, cv2.CC_STAT_AREA]
    total_area = int(areas.sum())
    if total_area <= 0:
        return None, "Siyah-beyaz profil maskesi bos."

    largest_offset = int(np.argmax(areas)) + 1
    largest_area = int(stats[largest_offset, cv2.CC_STAT_AREA])
    x = int(stats[largest_offset, cv2.CC_STAT_LEFT])
    y = int(stats[largest_offset, cv2.CC_STAT_TOP])
    w = int(stats[largest_offset, cv2.CC_STAT_WIDTH])
    h = int(stats[largest_offset, cv2.CC_STAT_HEIGHT])
    dominance = largest_area / max(total_area, 1)
    bbox_fill = largest_area / max(w * h, 1)
    width_ratio = w / image_w
    height_ratio = h / image_h

    touches_page_frame = (
        x <= image_w * 0.02
        and y <= image_h * 0.02
        and (x + w) >= image_w * 0.98
        and (y + h) >= image_h * 0.98
    )
    if touches_page_frame:
        return None, "Sayfa cercevesi profil olarak secilmedi."

    if dominance < 0.65 or bbox_fill < 0.08 or width_ratio < 0.20 or height_ratio < 0.06:
        return None, "Tek parca dolu profil guveni dusuk."

    return labels == largest_offset, None


def select_foreground_mask(
    image: Image.Image,
    mode: str = "all",
) -> Tuple[Optional[np.ndarray], ForegroundSelection]:
    """
    Return a boolean mask for the physical part contour when requested.

    - all: no mask, caller should use its existing behavior.
    - part: prefer colored part contours, then monochrome section profiles.
    - auto: apply profile isolation only when a useful layer/profile exists.
    """
    mode = _validate_mode(mode)
    if mode == "all":
        return None, ForegroundSelection(mode, False, "legacy_all")

    rgba = image.convert("RGBA")
    red, colored, red_ratio, color_ratio = _colored_masks(rgba)
    min_pixels = max(20, int(red.size * 0.00025))
    colored_min_pixels = max(min_pixels, int(red.size * 0.002))

    source = None
    mask = None
    if int(red.sum()) >= min_pixels:
        source = "red_contour"
        mask = red
    elif int(colored.sum()) >= colored_min_pixels:
        source = "colored_contour"
        mask = colored

    if mask is None:
        bw_mask, bw_note = _select_solid_bw_profile_mask(rgba)
        if bw_mask is not None:
            mask = bw_mask
            source = "solid_bw_profile"
        else:
            bw_mask, bw_note = _select_bw_section_profile_mask(rgba)
        if bw_mask is not None:
            mask = bw_mask
            if source is None:
                source = "bw_section_profile"
        elif mode == "auto":
            return None, ForegroundSelection(
                mode, False, "legacy_fallback",
                red_ratio=red_ratio, color_ratio=color_ratio,
                note=bw_note or "Renkli parca konturu tespit edilemedi.",
            )
        else:
            return None, ForegroundSelection(
                mode, False, "no_profile_contour",
                red_ratio=red_ratio, color_ratio=color_ratio,
                note=bw_note or "Parca konturu tespit edilemedi; tum cizgiler modunu deneyin.",
            )

    mask = _filter_small_components(_morph_close(mask))
    mask_ratio = _ratio(mask)
    if mask_ratio <= 0:
        return None, ForegroundSelection(
            mode, False, "empty_mask",
            red_ratio=red_ratio, color_ratio=color_ratio,
            note="Renk maskesi bos kaldi.",
        )

    return mask, ForegroundSelection(
        mode, True, source,
        mask_ratio=mask_ratio,
        red_ratio=red_ratio,
        color_ratio=color_ratio,
    )


def isolated_grayscale_from_mask(mask: np.ndarray) -> np.ndarray:
    """Build a white-background grayscale image with the selected mask in black."""
    gray = np.full(mask.shape, 255, dtype=np.uint8)
    gray[mask] = 0
    return gray


def isolate_foreground_grayscale_from_bytes(
    content: bytes,
    mode: str = "all",
) -> Tuple[Optional[np.ndarray], ForegroundSelection]:
    image = Image.open(io.BytesIO(content))
    image.load()
    mask, selection = select_foreground_mask(image, mode=mode)
    if mask is None:
        return None, selection
    return isolated_grayscale_from_mask(mask), selection
