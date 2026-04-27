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


def select_foreground_mask(
    image: Image.Image,
    mode: str = "all",
) -> Tuple[Optional[np.ndarray], ForegroundSelection]:
    """
    Return a boolean mask for the physical part contour when requested.

    - all: no mask, caller should use its existing behavior.
    - part: prefer red technical contours, then saturated colored contours.
    - auto: apply colored contour isolation only when a useful colored layer exists.
    """
    mode = _validate_mode(mode)
    if mode == "all":
        return None, ForegroundSelection(mode, False, "legacy_all")

    rgba = image.convert("RGBA")
    red, colored, red_ratio, color_ratio = _colored_masks(rgba)
    min_pixels = max(20, int(red.size * 0.00025))

    source = None
    mask = None
    if int(red.sum()) >= min_pixels:
        source = "red_contour"
        mask = red
    elif int(colored.sum()) >= min_pixels:
        source = "colored_contour"
        mask = colored

    if mask is None:
        if mode == "auto":
            return None, ForegroundSelection(
                mode, False, "legacy_fallback",
                red_ratio=red_ratio, color_ratio=color_ratio,
                note="Renkli parca konturu tespit edilemedi.",
            )
        return None, ForegroundSelection(
            mode, False, "no_colored_contour",
            red_ratio=red_ratio, color_ratio=color_ratio,
            note="Renkli parca konturu tespit edilemedi; tum cizgiler modunu deneyin.",
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
