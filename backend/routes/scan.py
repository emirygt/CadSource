"""
scan.py — Scan-to-CAD endpoint'leri
Herhangi bir görsel/CAD dosyasını vektör DXF'e çevirir ve
editlenebilir entity listesi olarak döner.

Pipeline: görsel → Sauvola binarize → potrace SVG → path analiz → DXF entity
Desteklenen girişler: JPG, PNG, BMP, TIFF, PDF, DXF, DWG
"""
from logger import get_logger as _get_logger
_log = _get_logger("routes.scan")
import io
import base64
import tempfile
import os
import json
import math
import subprocess
import shutil
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response
import numpy as np

try:
    import cv2
    CV2_OK = True
except ImportError:
    CV2_OK = False

try:
    from pdf2image import convert_from_bytes
    PDF2IMAGE_OK = True
except ImportError:
    PDF2IMAGE_OK = False

import ezdxf
from ezdxf.enums import TextEntityAlignment

from features import (
    parse_dxf_bytes,
    DWG2DXF_BIN,
    UnsupportedDWGVersionError,
    _raise_if_unsupported_dwg,
)

router = APIRouter(prefix="/scan", tags=["scan"])

# ─────────────────────────────────────────────
# Yardımcı: herhangi formattan numpy görsel üret
# ─────────────────────────────────────────────

def _to_image(content: bytes, filename: str):
    """Dosya içeriğini gri numpy array'e çevirir."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    # DXF → önce SVG/raster render
    if ext in ("dxf", "dwg"):
        dxf_bytes = content
        if ext == "dwg":
            try:
                _raise_if_unsupported_dwg(content, filename)
            except UnsupportedDWGVersionError as e:
                raise HTTPException(400, str(e))
            if DWG2DXF_BIN is None:
                raise HTTPException(400, "DWG dönüştürücü (dwg2dxf) kurulu değil.")
            import subprocess, shutil
            with tempfile.TemporaryDirectory() as td:
                inp = os.path.join(td, "in.dwg")
                with open(inp, "wb") as f:
                    f.write(content)
                r = subprocess.run([DWG2DXF_BIN, inp], capture_output=True, cwd=td)
                out = os.path.join(td, "in.dxf")
                if not os.path.exists(out):
                    raise HTTPException(400, "DWG dönüştürme başarısız.")
                dxf_bytes = open(out, "rb").read()

        # DXF → matplotlib render
        try:
            from features import parse_dxf_bytes, generate_jpg_preview_from_bytes
            try:
                data = parse_dxf_bytes(dxf_bytes, filename)
            except UnsupportedDWGVersionError as e:
                raise HTTPException(400, str(e))
            if data is None:
                raise HTTPException(400, "DXF parse edilemedi.")
            from features import generate_jpg_preview
            jpg = generate_jpg_preview(data)
            if jpg is None:
                raise HTTPException(400, "DXF önizleme üretilemedi.")
            arr = np.frombuffer(jpg, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
            return img, dxf_bytes  # ham DXF de dön (entity çıkarımı için)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(400, f"DXF render hatası: {e}")

    # PDF → görsel
    if ext == "pdf":
        if not PDF2IMAGE_OK:
            raise HTTPException(400, "pdf2image kurulu değil.")
        pages = convert_from_bytes(content, dpi=150, first_page=1, last_page=1)
        import io as _io
        buf = _io.BytesIO()
        pages[0].save(buf, format="JPEG")
        arr = np.frombuffer(buf.getvalue(), dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        return img, None

    # Raster (JPG/PNG/BMP/TIFF)
    arr = np.frombuffer(content, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise HTTPException(400, "Görsel okunamadı.")
    return img, None


# ─────────────────────────────────────────────
# Görsel → entity listesi (vectorize)
# ─────────────────────────────────────────────

POTRACE_BIN = shutil.which("potrace")


def _smooth_binarize(img: np.ndarray) -> np.ndarray:
    """
    Agresif temizleme + smooth binary — gürültü noktalarını yok eder,
    ana hatları kalın ve pürüzsüz bırakır. potrace bu girişle
    maksimum smooth bezier eğriler üretir.
    """
    h, w = img.shape

    # 1) Otsu global threshold — teknik çizimlerde çizgi/arka plan net ayrılır
    blur = cv2.GaussianBlur(img, (3, 3), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # 2) Küçük gürültü noktalarını sil (turdsize potrace'de de var ama önce burada temizle)
    open_k = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, open_k, iterations=1)

    # 3) Ana hatları biraz şişir — ince kırık çizgileri birleştir
    dilate_k = np.ones((2, 2), np.uint8)
    binary = cv2.dilate(binary, dilate_k, iterations=1)

    # 4) Gaussian blur → binary yeniden threshold
    # Bu adım kenar piksellerini yumuşatır, potrace smooth bezier üretir
    blurred = cv2.GaussianBlur(binary, (5, 5), 1.5)
    _, binary = cv2.threshold(blurred, 127, 255, cv2.THRESH_BINARY)

    return binary


def _potrace_vectorize(binary: np.ndarray, img_h: int, smooth: bool = False) -> dict:
    """
    potrace ile bitmap → SVG → entity listesi.
    smooth=False: hızlı, ham çıktı
    smooth=True : maksimum smooth bezier (scan2cad smooth modu)
    """
    if not POTRACE_BIN:
        raise HTTPException(500, "potrace kurulu değil. `brew install potrace` çalıştırın.")

    with tempfile.TemporaryDirectory() as td:
        bmp_path = os.path.join(td, "input.bmp")
        svg_path = os.path.join(td, "output.svg")

        cv2.imwrite(bmp_path, binary)

        if smooth:
            args = [POTRACE_BIN, "-s",
                    "--alphamax",    "1",    # tam smooth köşeler
                    "--opttolerance","0.4",  # eğri sadeleştirme
                    "--turdsize",    "5",    # küçük leke eşiği
                    "-o", svg_path, bmp_path]
        else:
            args = [POTRACE_BIN, "-s",
                    "--alphamax",    "0.5",  # orta smooth
                    "--opttolerance","0.2",
                    "--turdsize",    "2",
                    "-o", svg_path, bmp_path]

        r = subprocess.run(args, capture_output=True)
        if not os.path.exists(svg_path):
            raise HTTPException(500, f"potrace başarısız: {r.stderr.decode()}")

        svg_content = open(svg_path).read()

    return _svg_to_entities(svg_content, img_h)


def _svg_to_entities(svg_content: str, img_h: int) -> dict:
    """
    potrace SVG'sindeki path'leri ayrıştır → LINE / ARC / SPLINE entity listesi.
    potrace cubic bezier (C komutu) ve doğrusal (L) segmentler üretir.
    """
    import xml.etree.ElementTree as ET
    from svgpathtools import parse_path, Line, CubicBezier, QuadraticBezier

    root = ET.fromstring(svg_content)
    ns = {"svg": "http://www.w3.org/2000/svg"}

    # SVG viewport boyutunu al
    vb = root.get("viewBox", "")
    svg_h = img_h
    try:
        parts = [float(x) for x in vb.split()]
        svg_h = parts[3] if len(parts) >= 4 else img_h
    except Exception as e:
        _log.debug("SVG viewBox ayrıştırılamadı, varsayılan yükseklik kullanılıyor: %s", e)

    lines, splines = [], []

    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        if tag != "path":
            continue
        d = elem.get("d", "")
        if not d:
            continue
        try:
            path = parse_path(d)
        except Exception:
            continue

        for seg in path:
            if isinstance(seg, Line):
                x1, y1 = seg.start.real, svg_h - seg.start.imag
                x2, y2 = seg.end.real,   svg_h - seg.end.imag
                # Çok kısa segmentleri atla (gürültü)
                if math.hypot(x2 - x1, y2 - y1) < 2:
                    continue
                lines.append({
                    "type": "LINE",
                    "x1": round(x1, 2), "y1": round(y1, 2),
                    "x2": round(x2, 2), "y2": round(y2, 2),
                })
            elif isinstance(seg, (CubicBezier, QuadraticBezier)):
                # Bezier → SPLINE (4 kontrol noktası)
                if isinstance(seg, CubicBezier):
                    pts = [seg.start, seg.control1, seg.control2, seg.end]
                else:
                    pts = [seg.start, seg.control, seg.end]
                cp = [{"x": round(p.real, 2), "y": round(svg_h - p.imag, 2)} for p in pts]
                splines.append({"type": "SPLINE", "points": cp})

    # Boyut hesapla
    all_x = [l["x1"] for l in lines] + [l["x2"] for l in lines]
    all_y = [l["y1"] for l in lines] + [l["y2"] for l in lines]
    w = round(max(all_x) - min(all_x), 2) if all_x else img_h
    h = round(max(all_y) - min(all_y), 2) if all_y else img_h

    return {
        "lines": lines,
        "circles": [],
        "arcs": [],
        "splines": splines,
        "width":  w,
        "height": h,
    }


def _basic_binarize(img: np.ndarray) -> np.ndarray:
    """Ham binarize — gürültü temizleme yok, orijinal pikselleri koru."""
    blur = cv2.GaussianBlur(img, (3, 3), 0)
    _, binary = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return binary


def _vectorize(img: np.ndarray, smooth: bool = False) -> dict:
    """
    smooth=False → ham potrace (hızlı, orijinale yakın)
    smooth=True  → agresif temizleme + maksimum smooth bezier
    """
    binary = _smooth_binarize(img) if smooth else _basic_binarize(img)
    # potrace parametreleri de smooth'a göre değişsin
    return _potrace_vectorize(binary, img.shape[0], smooth=smooth)


def _dxf_entities_from_file(dxf_bytes: bytes) -> dict:
    """
    Mevcut DXF dosyasından entity listesi çıkar (edit için).
    """
    try:
        doc = ezdxf.read(io.StringIO(dxf_bytes.decode("utf-8", errors="replace")))
    except Exception:
        try:
            doc = ezdxf.from_bytes(dxf_bytes)
        except Exception as e:
            raise HTTPException(400, f"DXF okunamadı: {e}")

    msp = doc.modelspace()
    lines, circles, arcs, texts = [], [], [], []

    for e in msp:
        t = e.dxftype()
        try:
            if t == "LINE":
                s, end = e.dxf.start, e.dxf.end
                lines.append({"type":"LINE",
                    "x1":round(s.x,2),"y1":round(s.y,2),
                    "x2":round(end.x,2),"y2":round(end.y,2)})
            elif t == "CIRCLE":
                c = e.dxf.center
                circles.append({"type":"CIRCLE",
                    "cx":round(c.x,2),"cy":round(c.y,2),
                    "r":round(e.dxf.radius,2)})
            elif t == "ARC":
                c = e.dxf.center
                arcs.append({"type":"ARC",
                    "cx":round(c.x,2),"cy":round(c.y,2),
                    "r":round(e.dxf.radius,2),
                    "start_angle":round(e.dxf.start_angle,2),
                    "end_angle":round(e.dxf.end_angle,2)})
            elif t in ("TEXT","MTEXT"):
                try:
                    ins = e.dxf.insert
                    txt = e.dxf.text if t == "TEXT" else e.text
                    texts.append({"type":"TEXT",
                        "x":round(ins.x,2),"y":round(ins.y,2),
                        "text":txt,"height":round(getattr(e.dxf,"height",2.5),2)})
                except Exception as e:
                    _log.debug("TEXT entity atlandı: %s", e)
        except Exception:
            continue

    # bbox
    all_x = ([l["x1"] for l in lines] + [l["x2"] for l in lines] +
              [c["cx"] for c in circles] + [a["cx"] for a in arcs])
    all_y = ([l["y1"] for l in lines] + [l["y2"] for l in lines] +
              [c["cy"] for c in circles] + [a["cy"] for a in arcs])
    w = round(max(all_x) - min(all_x), 2) if all_x else 500
    h = round(max(all_y) - min(all_y), 2) if all_y else 500

    return {"lines": lines, "circles": circles, "arcs": arcs,
            "texts": texts, "width": w, "height": h}


# ─────────────────────────────────────────────
# Entity listesi → DXF bytes
# ─────────────────────────────────────────────

def _entities_to_dxf(entities: dict) -> bytes:
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    for l in entities.get("lines", []):
        msp.add_line((l["x1"], l["y1"]), (l["x2"], l["y2"]))

    for c in entities.get("circles", []):
        msp.add_circle((c["cx"], c["cy"]), c["r"])

    for a in entities.get("arcs", []):
        msp.add_arc((a["cx"], a["cy"]), a["r"],
                    a.get("start_angle", 0), a.get("end_angle", 360))

    for t in entities.get("texts", []):
        msp.add_text(t.get("text",""),
                     dxf={"insert": (t["x"], t["y"]),
                           "height": t.get("height", 2.5)})

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


# ─────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────

@router.post("/convert")
async def scan_convert(
    file: UploadFile = File(...),
    smooth: bool = False,
):
    """
    Dosyayı yükle → entity listesi + önizleme döner.
    smooth=false (varsayılan): ham vektör
    smooth=true: agresif temizleme + pürüzsüz bezier
    Desteklenir: JPG, PNG, BMP, TIFF, PDF, DXF, DWG
    """
    if not CV2_OK:
        raise HTTPException(500, "opencv kurulu değil.")

    content = await file.read()
    filename = file.filename or "upload"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    # DXF/DWG → direkt entity çıkar, görsel vektörizasyona gerek yok
    if ext in ("dxf", "dwg"):
        dxf_bytes = content
        if ext == "dwg":
            if DWG2DXF_BIN is None:
                raise HTTPException(400, "DWG dönüştürücü kurulu değil.")
            import subprocess
            with tempfile.TemporaryDirectory() as td:
                inp = os.path.join(td, "in.dwg")
                open(inp, "wb").write(content)
                subprocess.run([DWG2DXF_BIN, inp], capture_output=True, cwd=td)
                out = os.path.join(td, "in.dxf")
                if not os.path.exists(out):
                    raise HTTPException(400, "DWG dönüştürme başarısız.")
                dxf_bytes = open(out, "rb").read()
        entities = _dxf_entities_from_file(dxf_bytes)
    else:
        img, dxf_bytes = _to_image(content, filename)
        entities = _vectorize(img, smooth=smooth)

    # Önizleme: beyaz zemin üzerine mavi vektör çizgiler
    preview_b64 = None
    try:
        if ext not in ("dxf", "dwg"):
            h_img, w_img = img.shape
            canvas = np.full((h_img, w_img, 3), 255, dtype=np.uint8)
            for l in entities["lines"]:
                cv2.line(canvas,
                    (int(l["x1"]), int(h_img - l["y1"])),
                    (int(l["x2"]), int(h_img - l["y2"])),
                    (26, 115, 232), 1)
            for sp in entities.get("splines", []):
                pts = sp["points"]
                for i in range(len(pts) - 1):
                    cv2.line(canvas,
                        (int(pts[i]["x"]), int(h_img - pts[i]["y"])),
                        (int(pts[i+1]["x"]), int(h_img - pts[i+1]["y"])),
                        (124, 58, 237), 1)
            _, buf = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
            preview_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
    except Exception as e:
        _log.warning("Scan önizleme üretilemedi ('%s'): %s", filename, e)

    total = (len(entities["lines"]) + len(entities["circles"]) +
             len(entities.get("arcs", [])) + len(entities.get("splines", [])))

    return {
        "filename": filename,
        "entity_count": total,
        "entities": entities,
        "preview": preview_b64,
    }


@router.post("/export-dxf")
async def scan_export_dxf(request: dict):
    """
    Frontend'den gelen entity listesini DXF olarak döner.
    Body: { "entities": {...}, "filename": "output.dxf" }
    """
    entities = request.get("entities", {})
    filename = request.get("filename", "scan_output.dxf")
    dxf_bytes = _entities_to_dxf(entities)
    return Response(
        content=dxf_bytes,
        media_type="application/dxf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
