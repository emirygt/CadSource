"""
clip_encoder.py — CLIP görsel vektör çıkarma

DXF parse sonucu (ezdxf data) → normalize edilmiş PNG → CLIP → 512-D vektör

Model bellekte tutulur (lazy singleton), her upload'da tekrar yüklenmez.
CPU üzerinde çalışır, GPU gerekmez.
"""
import io
from typing import Optional
import numpy as np
from features import generate_jpg_preview, generate_jpg_preview_from_bytes
from logger import get_logger as _get_logger

_log = _get_logger("clip_encoder")

# Lazy globals — ilk çağrıda yüklenir
_processor = None
_model = None
_device = None


def _load_model():
    global _processor, _model, _device
    if _model is not None:
        return

    import torch
    from transformers import CLIPProcessor, CLIPModel

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    _log.info("[CLIP] Model yükleniyor (device=%s)...", _device)
    _model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(_device)
    _model.eval()
    _processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    _log.info("[CLIP] Model hazır.")


def render_dxf_to_png(data: dict, size: int = 224) -> Optional[bytes]:
    """
    features.py'nin JPG önizleme stilini yeniden kullanıp PNG'ye çevirir.
    Böylece CLIP'e verilen görüntü ile UI'da görülen preview daha tutarlı olur.

    data dict yapısı:
      - 'entities': [{"type": "LINE", "x1":..., "y1":..., "x2":..., "y2":...}, ...]
      - 'bbox': {"min_x":..., "max_x":..., "min_y":..., "max_y":...}
    """
    try:
        from PIL import Image

        jpg = generate_jpg_preview(data, size=max(size, 224))
        if jpg is None:
            return None

        img = Image.open(io.BytesIO(jpg)).convert("RGB")
        # CLIP için standardizasyon: uzun kenarı size'a indir.
        resample = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        if max(img.size) > size:
            img.thumbnail((size, size), resample=resample)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf.read()

    except Exception as e:
        _log.warning("[CLIP] render hatası: %s", e)
        return None


def encode_image_bytes(image_bytes: bytes) -> Optional[np.ndarray]:
    """Herhangi bir image bytes (png/jpg) -> 512-D L2-normalize numpy vektör."""
    try:
        _load_model()
        from PIL import Image
        import torch

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        inputs = _processor(images=img, return_tensors="pt").to(_device)

        with torch.no_grad():
            features = _model.get_image_features(**inputs)

        vec = features.squeeze().cpu().numpy().astype(np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec

    except Exception as e:
        _log.warning("[CLIP] encode hatası: %s", e)
        return None


def encode_png(png_bytes: bytes) -> Optional[np.ndarray]:
    """Geri uyumluluk: PNG bytes -> 512-D CLIP vektörü."""
    return encode_image_bytes(png_bytes)


def extract_clip_vector(data: dict) -> Optional[np.ndarray]:
    """
    Ana entry point: ezdxf data dict → 512-D CLIP vektörü.
    Başarısız olursa None döner (arama yine de geometric ile çalışır).
    """
    png = render_dxf_to_png(data)
    if png is None:
        return None
    return encode_png(png)


def extract_clip_vector_from_bytes(content: bytes, filename: str, data: Optional[dict] = None) -> Optional[np.ndarray]:
    """
    Ham dosyadan (DWG/DXF/JPG/PNG) gerçek preview üreterek CLIP vektörü çıkar.
    Başarısız olursa parse-data fallback kullanır.
    """
    try:
        jpg = generate_jpg_preview_from_bytes(content, filename, size=700)
        if jpg is not None:
            return encode_image_bytes(jpg)
    except Exception:
        pass

    if data is not None:
        return extract_clip_vector(data)
    return None
