"""
features.py — DXF/DWG/PDF/JPEG'den özellik vektörü çıkarma motoru

Vektör yapısı (128 boyut):
  [0:64]   geometri özellikleri
  [64:96]  katman özellikleri
  [96:112] boyut/ölçek özellikleri
  [112:128] görsel dağılım özellikleri
"""
import math
import os
import subprocess
import tempfile
from collections import Counter, deque
from typing import Optional
import numpy as np

from logger import get_logger as _get_logger
_log = _get_logger("features")

try:
    import ezdxf
    EZDXF_AVAILABLE = True
except ImportError:
    EZDXF_AVAILABLE = False

try:
    from pypdf import PdfReader
    PYPDF_AVAILABLE = True
except ImportError:
    PYPDF_AVAILABLE = False

# LibreDWG dwg2dxf binary — derlenen binary veya PATH'teki
_DWG2DXF_CANDIDATES = [
    "/tmp/libredwg-0.13.3/programs/dwg2dxf",
    "/usr/local/bin/dwg2dxf",
    "/opt/homebrew/bin/dwg2dxf",
    "dwg2dxf",  # PATH
]
DWG2DXF_BIN = None
for _c in _DWG2DXF_CANDIDATES:
    if os.path.isfile(_c) or _c == "dwg2dxf":
        try:
            subprocess.run([_c, "--version"], capture_output=True, timeout=3)
            DWG2DXF_BIN = _c
            break
        except Exception:
            continue


ENTITY_TYPES = [
    "LINE", "CIRCLE", "ARC", "POLYLINE", "LWPOLYLINE",
    "SPLINE", "ELLIPSE", "TEXT", "MTEXT", "INSERT",
    "HATCH", "DIMENSION", "LEADER", "SOLID", "TRACE",
    "POINT", "RAY", "XLINE", "3DFACE", "MESH",
]

COMMON_LAYERS = [
    "0", "walls", "doors", "windows", "dimensions",
    "annotations", "furniture", "electrical", "plumbing",
    "structural", "site", "landscape", "hvac", "text",
    "center", "hidden", "section", "detail", "grid",
    "boundary", "equipment", "floor", "ceiling", "roof",
    "stair", "column", "beam", "slab", "footing",
    "defpoints", "viewport",
]


class UnsupportedDWGVersionError(ValueError):
    """Raised when a binary DWG version is known to be unsupported."""


_DWG_VERSION_LABELS = {
    "AC1002": "AutoCAD R2.5",
    "AC1003": "AutoCAD R2.6",
    "AC1004": "AutoCAD R9",
    "AC1006": "AutoCAD R10",
    "AC1009": "AutoCAD R11/R12",
    "AC1012": "AutoCAD R13",
    "AC1014": "AutoCAD R14",
    "AC1015": "AutoCAD 2000",
    "AC1018": "AutoCAD 2004",
    "AC1021": "AutoCAD 2007",
    "AC1024": "AutoCAD 2010",
    "AC1027": "AutoCAD 2013",
    "AC1032": "AutoCAD 2018",
}


def _dwg_version_code(content: bytes) -> Optional[str]:
    if len(content) < 6 or content[:2] != b"AC":
        return None
    try:
        return content[:6].decode("ascii", errors="ignore")
    except Exception:
        return None


def _raise_if_unsupported_dwg(content: bytes, filename: str = "") -> None:
    code = _dwg_version_code(content)
    if not code or not code.startswith("AC"):
        return
    try:
        version_num = int(code[2:])
    except ValueError:
        return

    # AC1009 is AutoCAD R11/R12. Anything below that is pre-R12 and unsupported.
    if version_num < 1009:
        version_label = _DWG_VERSION_LABELS.get(code, code)
        prefix = f"'{filename}' okunamadı. " if filename else ""
        message = (
            f"{prefix}Bu DWG versiyonu desteklenmiyor (R12 öncesi). "
            f"Tespit edilen sürüm: {version_label} ({code})."
        )
        _log.warning("[DWG] %s", message)
        raise UnsupportedDWGVersionError(message)


def parse_dxf_file(filepath: str) -> Optional[dict]:
    """
    DXF dosyasını okuyup ham veri sözlüğü döndür.
    DWG için ezdxf otomatik dönüştürmeyi dener (ODA yoksa None döner).
    """
    if filepath.lower().endswith(".dwg"):
        try:
            with open(filepath, "rb") as f:
                _raise_if_unsupported_dwg(f.read(6), filepath)
        except UnsupportedDWGVersionError:
            raise
        except OSError as e:
            _log.warning("[DWG] sürüm başlığı okunamadı ('%s'): %s", filepath, e)

    if not EZDXF_AVAILABLE:
        return _parse_dxf_manual(filepath)

    try:
        doc = ezdxf.readfile(filepath)
        return _extract_from_doc(doc)
    except Exception:
        return _parse_dxf_manual(filepath)


def parse_pdf_bytes(content: bytes) -> Optional[dict]:
    """PDF'den boyut ve metin yoğunluğu bilgisiyle sahte CAD verisi üret."""
    if not PYPDF_AVAILABLE:
        return None
    try:
        import io
        reader = PdfReader(io.BytesIO(content))
        page_count = len(reader.pages)
        if page_count == 0:
            return None

        # İlk sayfanın boyutunu al
        first_page = reader.pages[0]
        w = float(first_page.mediabox.width)
        h = float(first_page.mediabox.height)

        # Tüm sayfadan metin çıkar
        all_text = ""
        for page in reader.pages:
            all_text += page.extract_text() or ""

        # Metin yoğunluğundan sahte entity listesi üret
        # Her satırı bir LINE entity gibi temsil et
        lines = [l.strip() for l in all_text.split("\n") if l.strip()]
        entities = []
        for i, line in enumerate(lines[:500]):  # max 500 entity
            y_pos = h * (1 - i / max(len(lines), 1))
            entities.append({
                "type": "LINE",
                "layer": "TEXT",
                "x1": 0, "y1": y_pos,
                "x2": min(len(line) * 6, w), "y2": y_pos,
                "length": min(len(line) * 6, w),
            })

        # Sayfa sayısına göre ek entity
        entities.append({"type": "TEXT", "layer": "0", "x1": 0, "y1": 0, "x2": 0, "y2": 0})
        for _ in range(min(page_count, 20)):
            entities.append({"type": "SOLID", "layer": "PAGES", "x1": 0, "y1": 0, "x2": w, "y2": h})

        return {
            "entities": entities,
            "layers": ["0", "TEXT", "PAGES"],
            "bbox": {"min_x": 0, "max_x": w, "min_y": 0, "max_y": h},
        }
    except Exception:
        return None


def _is_binary_dwg(content: bytes) -> bool:
    """İlk 6 byte AC1xxx magic → binary DWG."""
    return content[:2] == b"AC" and len(content) >= 6


def _dwg_to_dxf_bytes(dwg_content: bytes, filename: str) -> Optional[bytes]:
    """
    dwg2dxf CLI ile binary DWG → DXF text dönüşümü.
    Geçici dosya kullanır, sonucu bytes olarak döner.
    """
    if DWG2DXF_BIN is None:
        return None
    try:
        # Geçici dizin: hem input hem output burada
        tmp_dir = tempfile.mkdtemp(prefix="cad_dwg_")
        safe_name = "input.dwg"
        dwg_path = os.path.join(tmp_dir, safe_name)
        dxf_path = os.path.join(tmp_dir, "input.dxf")

        with open(dwg_path, "wb") as f:
            f.write(dwg_content)

        result = subprocess.run(
            [DWG2DXF_BIN, "--minimal", safe_name],
            cwd=tmp_dir,
            capture_output=True,
            timeout=30,
        )

        if os.path.exists(dxf_path):
            with open(dxf_path, "rb") as f:
                return f.read()
        return None
    except Exception as e:
        _log.error("[DWG2DXF] dönüştürme hatası: %s", e)
        return None
    finally:
        # Temizlik
        try:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def parse_image_bytes(content: bytes, filename: str = "") -> Optional[dict]:
    """
    JPEG/PNG/BMP → görsel özellik vektörü için sahte CAD data.
    Pillow ile renk histogramı + grid yoğunluğunu entity listesine dönüştürür.
    """
    try:
        from PIL import Image
        import io as _io
        img = Image.open(_io.BytesIO(content)).convert("L")  # grayscale
        w, h = img.size

        # 8x8 grid — her hücrenin ortalama parlaklığı
        grid_size = 8
        entities = []
        import numpy as _np
        arr = _np.array(img, dtype=_np.float32) / 255.0

        cell_h = h // grid_size
        cell_w = w // grid_size
        for row in range(grid_size):
            for col in range(grid_size):
                y0, y1 = row * cell_h, (row + 1) * cell_h
                x0, x1 = col * cell_w, (col + 1) * cell_w
                density = float(arr[y0:y1, x0:x1].mean())
                # Yoğun hücreleri LINE entity olarak temsil et
                count = int(density * 20)
                for k in range(count):
                    entities.append({
                        "type": "LINE",
                        "layer": f"grid_{row}_{col}",
                        "x1": float(x0), "y1": float(y0),
                        "x2": float(x1), "y2": float(y1),
                        "length": float(cell_w),
                    })

        if not entities:
            # En az bir entity — boş görüntü olsa bile
            entities.append({"type": "LINE", "layer": "0",
                              "x1": 0.0, "y1": 0.0, "x2": float(w), "y2": float(h), "length": float(w)})

        return {
            "entities": entities,
            "layers": list({e["layer"] for e in entities}),
            "bbox": {"min_x": 0.0, "max_x": float(w), "min_y": 0.0, "max_y": float(h)},
        }
    except Exception as e:
        _log.warning("[IMAGE] parse hatası: %s", e)
        return None


def parse_dxf_bytes(content: bytes, filename: str = "") -> Optional[dict]:
    """Bellek içi DXF/DWG/PDF/JPEG içeriğinden veri çıkar."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""

    if ext == "pdf":
        return parse_pdf_bytes(content)

    if ext in ("jpg", "jpeg", "png", "bmp", "webp"):
        return parse_image_bytes(content, filename)

    # Binary DWG → dwg2dxf ile DXF'e çevir
    if _is_binary_dwg(content):
        _raise_if_unsupported_dwg(content, filename)
        dxf_bytes = _dwg_to_dxf_bytes(content, filename)
        if dxf_bytes is not None:
            # Önce ezdxf ile dene, olmadı manual parse
            result = _try_ezdxf_bytes(dxf_bytes)
            if result and result["entities"]:
                return result
            return _parse_dxf_manual_bytes(dxf_bytes)
        # dwg2dxf yoksa veya başarısız — None döndür
        _log.warning("[DWG] '%s' binary DWG, dwg2dxf bulunamadı veya dönüştürme başarısız.", filename)
        return None

    # DXF text
    result = _try_ezdxf_bytes(content)
    if result and result["entities"]:
        return result
    return _parse_dxf_manual_bytes(content)


def _try_ezdxf_bytes(content: bytes) -> Optional[dict]:
    """ezdxf ile parse dene, başarısız olursa None döner."""
    if not EZDXF_AVAILABLE:
        return None
    try:
        import io
        doc = ezdxf.read(io.StringIO(content.decode("utf-8", errors="replace")))
        return _extract_from_doc(doc)
    except Exception:
        try:
            from ezdxf import recover
            import io
            doc, _ = recover.read(io.BytesIO(content))
            return _extract_from_doc(doc)
        except Exception:
            return None


def _safe_xy(point) -> Optional[tuple]:
    """Vec2/Vec3/tuple benzeri bir objeden (x, y) float döndür."""
    if point is None:
        return None
    if isinstance(point, (list, tuple)) and len(point) >= 2:
        try:
            return float(point[0]), float(point[1])
        except Exception:
            return None
    x = getattr(point, "x", None)
    y = getattr(point, "y", None)
    if x is None or y is None:
        return None
    try:
        return float(x), float(y)
    except Exception:
        return None


def _same_point(a: tuple, b: tuple, eps: float = 1e-6) -> bool:
    return abs(a[0] - b[0]) <= eps and abs(a[1] - b[1]) <= eps


def _sample_arc_points(cx: float, cy: float, r: float,
                       start_angle: float, end_angle: float,
                       segments: int = 24) -> list:
    """CAD açılarından (derece) yaklaşık yay noktaları üret."""
    if r <= 0:
        return []
    start = math.radians(float(start_angle))
    end = math.radians(float(end_angle))
    while end <= start:
        end += 2 * math.pi
    sweep = end - start
    steps = max(4, int(segments * sweep / (2 * math.pi)))
    pts = []
    for i in range(steps + 1):
        t = start + sweep * (i / steps)
        pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts


def _extract_hatch_polygons(entity) -> list:
    """HATCH path'lerini yaklaşık çokgene çevir."""
    polygons = []
    try:
        paths = entity.paths
    except Exception:
        return polygons

    for path in paths:
        pts = []
        if hasattr(path, "vertices"):
            for v in path.vertices:
                xy = _safe_xy(v)
                if xy is not None:
                    pts.append(xy)
                elif isinstance(v, (list, tuple)) and len(v) >= 2:
                    try:
                        pts.append((float(v[0]), float(v[1])))
                    except Exception:
                        pass
        elif hasattr(path, "edges"):
            for edge in path.edges:
                # Line edge
                if hasattr(edge, "start") and hasattr(edge, "end"):
                    s = _safe_xy(edge.start)
                    e = _safe_xy(edge.end)
                    if s is not None:
                        if not pts or not _same_point(pts[-1], s):
                            pts.append(s)
                    if e is not None:
                        pts.append(e)
                    continue

                # Arc edge
                if all(hasattr(edge, k) for k in ("center", "radius", "start_angle", "end_angle")):
                    c = _safe_xy(edge.center)
                    if c is None:
                        continue
                    arc_pts = _sample_arc_points(
                        c[0], c[1], float(edge.radius),
                        float(edge.start_angle), float(edge.end_angle),
                        segments=48,
                    )
                    if not getattr(edge, "ccw", True):
                        arc_pts = list(reversed(arc_pts))
                    if not arc_pts:
                        continue
                    if pts and _same_point(pts[-1], arc_pts[0]):
                        pts.extend(arc_pts[1:])
                    else:
                        pts.extend(arc_pts)
                    continue

                # Spline/Ellipse fallback: control pointleri line-strip kullan
                cps = []
                for cp in getattr(edge, "control_points", []):
                    xy = _safe_xy(cp)
                    if xy is not None:
                        cps.append(xy)
                if cps:
                    if pts and _same_point(pts[-1], cps[0]):
                        pts.extend(cps[1:])
                    else:
                        pts.extend(cps)

        if len(pts) >= 3:
            polygons.append(pts)

    return polygons


def _entity_bbox_points(ent: dict) -> list:
    """Entity'den bbox hesabında kullanılacak temsil noktaları çıkar."""
    etype = ent.get("type", "")
    pts = []

    if etype == "LINE":
        pts.extend([
            (ent.get("x1", 0.0), ent.get("y1", 0.0)),
            (ent.get("x2", 0.0), ent.get("y2", 0.0)),
        ])
    elif etype == "CIRCLE":
        cx = ent.get("cx", 0.0)
        cy = ent.get("cy", 0.0)
        r = abs(ent.get("r", 0.0))
        pts.extend([(cx - r, cy), (cx + r, cy), (cx, cy - r), (cx, cy + r)])
    elif etype == "ARC":
        cx = ent.get("cx", 0.0)
        cy = ent.get("cy", 0.0)
        r = abs(ent.get("r", 0.0))
        pts.extend(_sample_arc_points(
            cx, cy, r,
            ent.get("start_angle", 0.0),
            ent.get("end_angle", 90.0),
            segments=36,
        ))

    for p in ent.get("points", []):
        xy = _safe_xy(p)
        if xy is not None:
            pts.append(xy)

    for poly in ent.get("polygons", []):
        for p in poly:
            xy = _safe_xy(p)
            if xy is not None:
                pts.append(xy)

    return pts


def _robust_bbox(points: list) -> tuple:
    """
    Aykırı noktaları (çok uzak tekil entity) yumuşatmak için robust bbox hesapla.
    Standart bbox'ı aşırı şişiriyorsa quantile kırpma uygular.
    """
    if not points:
        return 0.0, 0.0, 0.0, 0.0
    xs = np.array([p[0] for p in points], dtype=np.float64)
    ys = np.array([p[1] for p in points], dtype=np.float64)

    raw_min_x, raw_max_x = float(xs.min()), float(xs.max())
    raw_min_y, raw_max_y = float(ys.min()), float(ys.max())

    if len(points) < 60:
        return raw_min_x, raw_max_x, raw_min_y, raw_max_y

    q_min_x, q_max_x = np.percentile(xs, [1.0, 99.0])
    q_min_y, q_max_y = np.percentile(ys, [1.0, 99.0])
    raw_w = max(raw_max_x - raw_min_x, 1e-9)
    raw_h = max(raw_max_y - raw_min_y, 1e-9)
    q_w = max(float(q_max_x - q_min_x), 1e-9)
    q_h = max(float(q_max_y - q_min_y), 1e-9)

    use_qx = (raw_w / q_w) > 8.0
    use_qy = (raw_h / q_h) > 8.0
    return (
        float(q_min_x) if use_qx else raw_min_x,
        float(q_max_x) if use_qx else raw_max_x,
        float(q_min_y) if use_qy else raw_min_y,
        float(q_max_y) if use_qy else raw_max_y,
    )


def _extract_from_doc(doc) -> dict:
    """ezdxf dökümanından entity ve katman verisi çıkar."""
    msp = doc.modelspace()
    entities = []
    layers = set()

    for entity in msp:
        etype = entity.dxftype()
        layer = entity.dxf.get("layer", "0")
        layers.add(layer)

        props = {"type": etype, "layer": layer}

        if etype == "LINE":
            s, e = entity.dxf.start, entity.dxf.end
            props.update({"x1": s.x, "y1": s.y, "x2": e.x, "y2": e.y,
                          "length": math.hypot(e.x - s.x, e.y - s.y)})
        elif etype == "CIRCLE":
            c = entity.dxf.center
            props.update({"cx": c.x, "cy": c.y, "r": entity.dxf.radius})
        elif etype == "ARC":
            c = entity.dxf.center
            props.update({"cx": c.x, "cy": c.y, "r": entity.dxf.radius,
                          "start_angle": entity.dxf.start_angle,
                          "end_angle": entity.dxf.end_angle})
        elif etype == "LWPOLYLINE":
            try:
                raw_pts = list(entity.get_points("xyb"))
                pts = [(float(p[0]), float(p[1])) for p in raw_pts]
                props["point_count"] = len(pts)
                if pts:
                    props["points"] = pts
                flags = getattr(entity.dxf, "flags", 0)
                props["closed"] = bool(getattr(entity, "closed", False) or (flags & 1))
                bulges = []
                for p in raw_pts:
                    b = float(p[2]) if len(p) >= 3 and p[2] is not None else 0.0
                    bulges.append(b)
                if any(abs(b) > 1e-9 for b in bulges):
                    props["bulges"] = bulges
            except Exception:
                props["point_count"] = 0
        elif etype == "POLYLINE":
            try:
                pts = []
                for v in entity.vertices:
                    xy = _safe_xy(getattr(v.dxf, "location", None))
                    if xy is not None:
                        pts.append(xy)
                props["point_count"] = len(pts)
                if pts:
                    props["points"] = pts
                closed = False
                try:
                    closed = bool(entity.is_closed)
                except Exception:
                    pass
                try:
                    closed = closed or bool(entity.dxf.flags & 1)
                except Exception:
                    pass
                props["closed"] = closed
            except Exception:
                props["point_count"] = 0
        elif etype == "HATCH":
            polys = _extract_hatch_polygons(entity)
            if polys:
                props["polygons"] = polys
                props["point_count"] = sum(len(p) for p in polys)
            else:
                props["point_count"] = 0
        elif etype in ("SOLID", "TRACE", "3DFACE"):
            pts = []
            try:
                if hasattr(entity, "wcs_vertices"):
                    for v in entity.wcs_vertices():
                        xy = _safe_xy(v)
                        if xy is not None:
                            pts.append(xy)
            except Exception:
                pass
            if not pts:
                for key in ("vtx0", "vtx1", "vtx2", "vtx3"):
                    try:
                        if entity.dxf.hasattr(key):
                            xy = _safe_xy(getattr(entity.dxf, key))
                            if xy is not None:
                                pts.append(xy)
                    except Exception:
                        continue
            if pts:
                props["points"] = pts
                props["point_count"] = len(pts)
                props["closed"] = True

        entities.append(props)

    points = []
    for ent in entities:
        points.extend(_entity_bbox_points(ent))

    min_x, max_x, min_y, max_y = _robust_bbox(points)

    return {
        "entities": entities,
        "layers": list(layers),
        "bbox": {"min_x": min_x, "max_x": max_x, "min_y": min_y, "max_y": max_y},
    }


def _parse_dxf_manual(filepath: str) -> Optional[dict]:
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            return _parse_dxf_manual_bytes(f.read().encode())
    except Exception:
        return None


def _parse_dxf_manual_bytes(content: bytes) -> dict:
    """Hızlı manuel DXF ayrıştırıcı — ezdxf yokken kullanılır."""
    text = content.decode("utf-8", errors="replace")
    lines = text.split("\n")
    entities = []
    layers = set()
    in_entities = False
    i = 0

    while i < len(lines):
        ln = lines[i].strip()
        if ln == "ENTITIES":
            in_entities = True
        if ln == "ENDSEC" and in_entities:
            in_entities = False
        if not in_entities:
            i += 1
            continue

        if ln in ("LINE", "CIRCLE", "ARC", "POLYLINE", "LWPOLYLINE",
                  "SPLINE", "TEXT", "MTEXT", "INSERT", "HATCH"):
            etype = ln
            ent = {"type": etype, "layer": "0", "x1": 0, "y1": 0,
                   "x2": 0, "y2": 0, "r": 0}
            i += 1
            depth = 0
            while i < len(lines) and depth < 100:
                try:
                    code = int(lines[i].strip())
                    val = lines[i + 1].strip() if i + 1 < len(lines) else ""
                    i += 2
                except (ValueError, IndexError):
                    break
                if code == 0:
                    break
                if code == 8:
                    ent["layer"] = val
                    layers.add(val)
                elif code == 10:
                    ent["x1"] = float(val) if val else 0
                elif code == 20:
                    ent["y1"] = float(val) if val else 0
                elif code == 11:
                    ent["x2"] = float(val) if val else 0
                elif code == 21:
                    ent["y2"] = float(val) if val else 0
                elif code == 40:
                    ent["r"] = float(val) if val else 0
                depth += 1
            if etype == "LINE":
                ent["length"] = math.hypot(ent["x2"] - ent["x1"], ent["y2"] - ent["y1"])
            entities.append(ent)
        else:
            i += 1

    xs = [e.get("x1", 0) for e in entities] + [e.get("x2", 0) for e in entities]
    ys = [e.get("y1", 0) for e in entities] + [e.get("y2", 0) for e in entities]

    return {
        "entities": entities,
        "layers": list(layers),
        "bbox": {
            "min_x": min(xs) if xs else 0,
            "max_x": max(xs) if xs else 0,
            "min_y": min(ys) if ys else 0,
            "max_y": max(ys) if ys else 0,
        },
    }


def extract_features(data: dict) -> np.ndarray:
    """
    Ham CAD verisinden 128 boyutlu normalize edilmiş özellik vektörü üret.
    """
    vec = np.zeros(128, dtype=np.float32)

    entities = data.get("entities", [])
    layers = data.get("layers", [])
    bbox = data.get("bbox", {})
    n = max(len(entities), 1)

    # ── Bölüm 1: Geometri özellikleri [0:64] ──────────────────────────────
    # Entity tip dağılımı (0:20)
    type_counts = Counter(e["type"] for e in entities)
    for i, t in enumerate(ENTITY_TYPES):
        vec[i] = type_counts.get(t, 0) / n

    # Açı histogramı — yönelim dağılımı (20:36)
    angles = []
    for e in entities:
        if e["type"] == "LINE":
            dx = e.get("x2", 0) - e.get("x1", 0)
            dy = e.get("y2", 0) - e.get("y1", 0)
            if abs(dx) + abs(dy) > 0.001:
                angles.append(math.atan2(dy, dx) % math.pi)
    if angles:
        hist, _ = np.histogram(angles, bins=16, range=(0, math.pi))
        vec[20:36] = hist / max(hist.sum(), 1)

    # Uzunluk histogramı (36:52)
    lengths = [e.get("length", 0) for e in entities if e["type"] == "LINE"]
    if lengths:
        max_len = max(lengths) or 1
        norm_lengths = [l / max_len for l in lengths]
        hist, _ = np.histogram(norm_lengths, bins=16, range=(0, 1))
        vec[36:52] = hist / max(hist.sum(), 1)

    # Daire yarıçap histogramı (52:60)
    radii = [e.get("r", 0) for e in entities if e["type"] in ("CIRCLE", "ARC") and e.get("r", 0) > 0]
    if radii:
        max_r = max(radii) or 1
        norm_r = [r / max_r for r in radii]
        hist, _ = np.histogram(norm_r, bins=8, range=(0, 1))
        vec[52:60] = hist / max(hist.sum(), 1)

    # Entity yoğunluğu ve çeşitlilik (60:64)
    bbox_w = (bbox.get("max_x", 0) - bbox.get("min_x", 0)) or 1
    bbox_h = (bbox.get("max_y", 0) - bbox.get("min_y", 0)) or 1
    bbox_area = bbox_w * bbox_h or 1
    vec[60] = min(len(entities) / 1000, 1.0)
    vec[61] = min(len(type_counts) / len(ENTITY_TYPES), 1.0)
    vec[62] = min(math.log1p(len(entities)) / 10, 1.0)
    vec[63] = min(len(entities) / bbox_area * 1000, 1.0)

    # ── Bölüm 2: Katman özellikleri [64:96] ───────────────────────────────
    layer_set = set(l.lower() for l in layers)
    for i, lname in enumerate(COMMON_LAYERS):
        vec[64 + i] = 1.0 if lname in layer_set else 0.0

    # Katman sayısı normalize (64+32-2 slotları kullanıldı, son 2'ye genel stat)
    vec[94] = min(len(layers) / 50, 1.0)
    # Ortalama katman başına entity
    vec[95] = min((len(entities) / max(len(layers), 1)) / 100, 1.0)

    # ── Bölüm 3: Boyut/ölçek özellikleri [96:112] ─────────────────────────
    aspect = bbox_w / bbox_h if bbox_h > 0 else 1
    vec[96] = min(aspect / 10, 1.0)
    vec[97] = min(1 / aspect / 10, 1.0) if aspect > 0 else 0
    vec[98] = min(math.log1p(bbox_w) / 15, 1.0)
    vec[99] = min(math.log1p(bbox_h) / 15, 1.0)
    vec[100] = min(math.log1p(bbox_area) / 25, 1.0)

    # Boyut kategorisi (A0/A1/A2/A3/A4 benzeri oranlar)
    std_ratios = [1.414, 1.189, 1.0, 0.841]
    for i, r in enumerate(std_ratios):
        vec[101 + i] = max(0, 1 - abs(aspect - r) / r)

    # Normalize edilmiş merkez noktası
    cx = (bbox.get("min_x", 0) + bbox.get("max_x", 0)) / 2
    cy = (bbox.get("min_y", 0) + bbox.get("max_y", 0)) / 2
    vec[105] = (math.sin(cx / 1000) + 1) / 2
    vec[106] = (math.sin(cy / 1000) + 1) / 2

    # ── Bölüm 4: Görsel dağılım [112:128] ─────────────────────────────────
    # Bounding box'ı 4x4 hücreye böl, entity yoğunluğunu hesapla
    if entities and bbox_w > 0 and bbox_h > 0:
        grid = np.zeros((4, 4), dtype=np.float32)
        min_x = bbox.get("min_x", 0)
        min_y = bbox.get("min_y", 0)
        for e in entities:
            ex = e.get("x1", e.get("cx", 0))
            ey = e.get("y1", e.get("cy", 0))
            gx = min(int((ex - min_x) / bbox_w * 4), 3)
            gy = min(int((ey - min_y) / bbox_h * 4), 3)
            grid[gy][gx] += 1
        grid = grid / max(grid.max(), 1)
        vec[112:128] = grid.flatten()

    # Son normalize — vektörü birim uzunluğa getir (cosine similarity için)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm

    return vec


def generate_svg_preview(data: dict, width: int = 400, height: int = 300) -> str:
    """
    Ham CAD verisinden küçük SVG önizleme üret.
    Maksimum 2000 entity çizer, boyutu normalize eder.
    """
    entities = data.get("entities", [])
    bbox = data.get("bbox", {})
    bx0 = bbox.get("min_x", 0)
    by0 = bbox.get("min_y", 0)
    bw = (bbox.get("max_x", 0) - bx0) or 1
    bh = (bbox.get("max_y", 0) - by0) or 1

    pad = 12
    vw = width - pad * 2
    vh = height - pad * 2

    # Koordinatı SVG alanına ölçekle (Y ekseni ters)
    def sx(x): return pad + (x - bx0) / bw * vw
    def sy(y): return pad + (1 - (y - by0) / bh) * vh

    lines_svg = []
    # Katman başına renk — ilk 8 katman için sabit palet
    layer_colors = [
        "#60a5fa", "#34d399", "#f59e0b", "#f87171",
        "#a78bfa", "#38bdf8", "#fb923c", "#4ade80",
    ]
    layer_index: dict = {}

    def layer_color(layer: str) -> str:
        if layer not in layer_index:
            layer_index[layer] = len(layer_index) % len(layer_colors)
        return layer_colors[layer_index[layer]]

    drawn = 0
    max_entities = 2000

    for e in entities:
        if drawn >= max_entities:
            break
        etype = e.get("type", "")
        color = layer_color(e.get("layer", "0"))

        if etype == "LINE":
            x1, y1 = sx(e.get("x1", 0)), sy(e.get("y1", 0))
            x2, y2 = sx(e.get("x2", 0)), sy(e.get("y2", 0))
            lines_svg.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" stroke-width="0.7"/>')
            drawn += 1

        elif etype in ("CIRCLE",):
            cx, cy = sx(e.get("cx", 0)), sy(e.get("cy", 0))
            r_px = e.get("r", 0) / bw * vw
            if 0.5 < r_px < vw:
                lines_svg.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r_px:.1f}" stroke="{color}" fill="none" stroke-width="0.7"/>')
            drawn += 1

        elif etype == "ARC":
            cx0, cy0 = e.get("cx", 0), e.get("cy", 0)
            r = e.get("r", 0)
            r_px = r / bw * vw
            if r_px < 1 or r_px > vw:
                drawn += 1
                continue
            sa = math.radians(e.get("start_angle", 0))
            ea = math.radians(e.get("end_angle", 90))
            # Sweep küçükse büyük yay flag = 0
            sweep = ea - sa
            if sweep < 0:
                sweep += 2 * math.pi
            large = 1 if sweep > math.pi else 0
            x1a = sx(cx0 + r * math.cos(sa))
            y1a = sy(cy0 + r * math.sin(sa))
            x2a = sx(cx0 + r * math.cos(ea))
            y2a = sy(cy0 + r * math.sin(ea))
            lines_svg.append(
                f'<path d="M{x1a:.1f},{y1a:.1f} A{r_px:.1f},{r_px:.1f} 0 {large},0 {x2a:.1f},{y2a:.1f}" '
                f'stroke="{color}" fill="none" stroke-width="0.7"/>'
            )
            drawn += 1

        elif etype in ("POLYLINE", "LWPOLYLINE"):
            pts = e.get("points", [])
            if len(pts) >= 2:
                d = "M" + " L".join(f"{sx(p[0]):.1f},{sy(p[1]):.1f}" for p in pts)
                lines_svg.append(f'<path d="{d}" stroke="{color}" fill="none" stroke-width="0.7"/>')
            drawn += 1

    content = "\n".join(lines_svg)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" '
        f'style="background:#0f1117">'
        f'{content}'
        f'</svg>'
    )


def _flood_outside(open_mask: np.ndarray) -> np.ndarray:
    """Açık alan maskesinde sınırdan erişilen (dış) pikselleri bul."""
    h, w = open_mask.shape
    outside = np.zeros_like(open_mask, dtype=bool)
    q = deque()

    def push(y: int, x: int):
        if 0 <= y < h and 0 <= x < w and open_mask[y, x] and not outside[y, x]:
            outside[y, x] = True
            q.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)

    while q:
        y, x = q.popleft()
        push(y - 1, x)
        push(y + 1, x)
        push(y, x - 1)
        push(y, x + 1)
    return outside


def _flood_from_seeds(open_mask: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """Belirtilen seed piksellerinden open_mask içinde flood fill yap."""
    h, w = open_mask.shape
    reached = np.zeros_like(open_mask, dtype=bool)
    q = deque()
    ys, xs = np.where(seeds & open_mask)
    for y, x in zip(ys.tolist(), xs.tolist()):
        if not reached[y, x]:
            reached[y, x] = True
            q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and open_mask[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                q.append((ny, nx))
    return reached


def _remove_interior_holes(edge_mask: np.ndarray, interior: np.ndarray, outside: np.ndarray) -> np.ndarray:
    """
    interior içindeki iç delikleri (inner hole) tespit edip çıkar.
    Yöntem: dış konturun iç yüzüne değen interior piksellerinden flood yap;
    erişilemeyen interior pikseller = delik.
    """
    if not interior.any():
        return interior

    # Dış bölgeyi 1 piksel genişlet → dış kontur kenarlarını bul
    outside_d = outside.copy()
    outside_d[1:] |= outside[:-1]
    outside_d[:-1] |= outside[1:]
    outside_d[:, 1:] |= outside[:, :-1]
    outside_d[:, :-1] |= outside[:, 1:]

    # Dış konturun dış yüzündeki edge pikseller
    outer_edge = edge_mask & outside_d

    # Bu outer_edge'e komşu interior pikseller = "gerçek interior" tohumları
    outer_edge_d = outer_edge.copy()
    outer_edge_d[1:] |= outer_edge[:-1]
    outer_edge_d[:-1] |= outer_edge[1:]
    outer_edge_d[:, 1:] |= outer_edge[:, :-1]
    outer_edge_d[:, :-1] |= outer_edge[:, 1:]

    seeds = interior & outer_edge_d
    if not seeds.any():
        # Interior'a komşu outer-face edge yok → tüm interior aslında iç delik
        # (örn. HATCH solid fill durumu). Hiç dolgu yapma.
        return np.zeros_like(interior, dtype=bool)

    reachable = _flood_from_seeds(interior, seeds)
    return interior & reachable


def _resolve_preview_bbox(data: dict, entities: list) -> tuple:
    """Önizleme için bbox hesapla; bozuk/şişkin bbox'larda entity noktalarına düş."""
    bbox = data.get("bbox", {}) or {}
    min_x = float(bbox.get("min_x", 0.0))
    max_x = float(bbox.get("max_x", 0.0))
    min_y = float(bbox.get("min_y", 0.0))
    max_y = float(bbox.get("max_y", 0.0))

    pts = []
    for ent in entities:
        pts.extend(_entity_bbox_points(ent))
    p_min_x, p_max_x, p_min_y, p_max_y = _robust_bbox(pts)
    if max_x > min_x and max_y > min_y:
        p_w = max(p_max_x - p_min_x, 1e-9)
        p_h = max(p_max_y - p_min_y, 1e-9)
        raw_w = max(max_x - min_x, 1e-9)
        raw_h = max(max_y - min_y, 1e-9)
        if (raw_w / p_w) <= 8.0 and (raw_h / p_h) <= 8.0:
            return min_x, max_x, min_y, max_y
    return p_min_x, p_max_x, p_min_y, p_max_y


def generate_jpg_preview_from_bytes(content: Optional[bytes], filename: str = "", size: int = 700) -> Optional[bytes]:
    """
    Yüklenen ham dosyadan (özellikle DWG/DXF) daha gerçekçi JPG preview üret.
    Akış:
      1) DWG ise DWG->DXF (dwg2dxf)
      2) DXF'i ezdxf drawing backend ile render et
      3) Raster üstünde kontur+dolgu ile siluet görünüm çıkar
    """
    if not content:
        return None

    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    try:
        from PIL import Image, ImageFilter
        import io as _io
    except Exception:
        return None

    # Görsel dosyaları doğrudan normalize edip JPEG'e çevir.
    if ext in ("jpg", "jpeg", "png", "bmp", "webp"):
        try:
            img = Image.open(_io.BytesIO(content)).convert("RGB")
            limit = max(320, min(int(size), 1800))
            if max(img.size) > limit:
                resample = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
                img.thumbnail((limit, limit), resample=resample)
            buf = _io.BytesIO()
            img.save(buf, format="JPEG", quality=92, optimize=True)
            buf.seek(0)
            return buf.read()
        except Exception:
            return None

    # DWG/DXF dışındaki formatlarda bu renderer kullanılmaz.
    if ext not in ("dwg", "dxf") and not _is_binary_dwg(content):
        return None

    dxf_bytes = content
    if ext == "dwg" or _is_binary_dwg(content):
        dxf_bytes = _dwg_to_dxf_bytes(content, filename)
        if dxf_bytes is None:
            return None

    try:
        import ezdxf
        from ezdxf import recover
        from ezdxf.addons.drawing import RenderContext, Frontend
        from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
        from ezdxf.addons.drawing.config import (
            Configuration,
            BackgroundPolicy,
            ColorPolicy,
            HatchPolicy,
            LinePolicy,
        )
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        # DXF bellekten yükle: recover.read çoğu DWG->DXF çıktısında daha güvenilir.
        try:
            doc, _ = recover.read(_io.BytesIO(dxf_bytes))
        except Exception:
            doc = ezdxf.read(_io.StringIO(dxf_bytes.decode("utf-8", errors="replace")))

        render_px = max(420, min(int(size), 1600))
        dpi = 160
        fig_size = max(render_px / dpi, 2.5)
        fig = plt.figure(figsize=(fig_size, fig_size), dpi=dpi)
        ax = fig.add_axes([0, 0, 1, 1])
        fig.patch.set_facecolor("#e9e9ea")
        ax.set_facecolor("#e9e9ea")
        ax.set_aspect("equal")
        ax.axis("off")

        cfg = Configuration.defaults().with_changes(
            background_policy=BackgroundPolicy.WHITE,
            color_policy=ColorPolicy.BLACK,
            hatch_policy=HatchPolicy.SHOW_SOLID,
            line_policy=LinePolicy.ACCURATE,
            lineweight_scaling=1.6,
        )

        ctx = RenderContext(doc)
        backend = MatplotlibBackend(ax)
        Frontend(ctx, backend, config=cfg).draw_layout(doc.modelspace(), finalize=True)
        ax.autoscale_view()
        ax.margins(0.01)

        tmp_png = _io.BytesIO()
        fig.savefig(
            tmp_png,
            format="png",
            dpi=dpi,
            bbox_inches="tight",
            pad_inches=0.02,
            facecolor="#e9e9ea",
        )
        plt.close(fig)
        tmp_png.seek(0)
        line_img = Image.open(tmp_png).convert("L")

    except Exception as e:
        _log.warning("[JPG_PREVIEW_REAL] render hatası: %s", e)
        return None

    # Kontur + dolgu (küçük açıklıkları kapatıp iç bölgeleri doldur)
    arr = np.array(line_img, dtype=np.uint8)
    edge_mask = arr < 145
    if not edge_mask.any():
        return None

    min_dim = min(arr.shape[0], arr.shape[1])
    grow = max(3, min(13, int(min_dim * 0.015)))
    if grow % 2 == 0:
        grow += 1

    edge_img = Image.fromarray((edge_mask.astype(np.uint8) * 255), mode="L")
    edge_img = edge_img.filter(ImageFilter.MaxFilter(grow))
    edge_mask = np.array(edge_img) > 0

    open_mask = ~edge_mask
    outside = _flood_outside(open_mask)
    interior = open_mask & ~outside
    interior = _remove_interior_holes(edge_mask, interior, outside)
    interior_ratio = float(interior.sum()) / float(interior.size)

    # Çok az dolgu çıkarsa kontur bırak; makulse siluet yap.
    if 0.02 <= interior_ratio <= 0.85:
        shape_mask = edge_mask | interior
    else:
        shape_mask = edge_mask

    bg_rgb = np.array([234, 234, 234], dtype=np.uint8)
    fg_rgb = np.array([52, 52, 56], dtype=np.uint8)
    out_rgb = np.empty((arr.shape[0], arr.shape[1], 3), dtype=np.uint8)
    out_rgb[:, :] = bg_rgb
    out_rgb[shape_mask] = fg_rgb

    out_img = Image.fromarray(out_rgb, mode="RGB")
    if max(out_img.size) > size:
        resample = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        out_img.thumbnail((size, size), resample=resample)

    buf = _io.BytesIO()
    out_img.save(buf, format="JPEG", quality=92, optimize=True)
    buf.seek(0)
    return buf.read()


def generate_jpg_preview(data: dict, size: int = 400) -> Optional[bytes]:
    """
    Ham CAD verisinden daha "gerçek ürün görseli" hissine yakın JPEG üretir:
    açık gri arka plan + koyu dolu/siluet çizim.
    """
    try:
        from PIL import Image, ImageDraw, ImageFilter
        import io as _io

        entities = data.get("entities", [])
        if not entities:
            return None

        min_x, max_x, min_y, max_y = _resolve_preview_bbox(data, entities)
        bw = max(max_x - min_x, 1e-6)
        bh = max(max_y - min_y, 1e-6)
        aspect = bw / bh

        max_dim = max(220, min(int(size), 1200))
        if aspect >= 1.0:
            out_w = max_dim
            out_h = max(140, int(max_dim / aspect))
        else:
            out_h = max_dim
            out_w = max(140, int(max_dim * aspect))

        aa = 2  # supersampling ile daha temiz kenar
        canvas_w, canvas_h = out_w * aa, out_h * aa
        pad = max(18, int(min(canvas_w, canvas_h) * 0.08))
        draw_w = max(canvas_w - 2 * pad, 1)
        draw_h = max(canvas_h - 2 * pad, 1)
        scale = min(draw_w / bw, draw_h / bh)
        x_off = (canvas_w - bw * scale) / 2.0
        y_off = (canvas_h - bh * scale) / 2.0

        def tx(x: float) -> int:
            return int(round(x_off + (x - min_x) * scale))

        def ty(y: float) -> int:
            return int(round(canvas_h - (y_off + (y - min_y) * scale)))

        def poly_to_pixels(poly: list) -> list:
            pix = []
            for p in poly:
                xy = _safe_xy(p)
                if xy is not None:
                    pix.append((tx(xy[0]), ty(xy[1])))
            return pix

        img = Image.new("L", (canvas_w, canvas_h), 255)
        draw = ImageDraw.Draw(img)
        stroke = max(2, int(round(min(canvas_w, canvas_h) * 0.006)))
        drawn = 0

        for ent in entities[:6000]:
            etype = ent.get("type", "")
            try:
                if etype == "LINE":
                    draw.line(
                        [(tx(ent["x1"]), ty(ent["y1"])), (tx(ent["x2"]), ty(ent["y2"]))],
                        fill=0,
                        width=stroke,
                    )
                    drawn += 1

                elif etype == "CIRCLE":
                    cx, cy = tx(ent["cx"]), ty(ent["cy"])
                    r_px = max(int(round(abs(ent.get("r", 0.0)) * scale)), 1)
                    draw.ellipse(
                        [cx - r_px, cy - r_px, cx + r_px, cy + r_px],
                        outline=0,
                        width=stroke,
                    )
                    drawn += 1

                elif etype == "ARC":
                    cx, cy = tx(ent["cx"]), ty(ent["cy"])
                    r_px = max(int(round(abs(ent.get("r", 0.0)) * scale)), 1)
                    # CAD (Y yukarı) -> görüntü (Y aşağı) dönüşümü için açıları ters çevir.
                    start = -float(ent.get("end_angle", 90.0))
                    end = -float(ent.get("start_angle", 0.0))
                    draw.arc(
                        [cx - r_px, cy - r_px, cx + r_px, cy + r_px],
                        start=start,
                        end=end,
                        fill=0,
                        width=stroke,
                    )
                    drawn += 1

                elif etype in ("POLYLINE", "LWPOLYLINE"):
                    pix = poly_to_pixels(ent.get("points", []))
                    if len(pix) >= 2:
                        draw.line(pix, fill=0, width=stroke)
                        if ent.get("closed"):
                            draw.line([pix[-1], pix[0]], fill=0, width=stroke)
                        drawn += 1

                elif etype in ("SOLID", "TRACE", "3DFACE"):
                    pix = poly_to_pixels(ent.get("points", []))
                    if len(pix) >= 3:
                        draw.polygon(pix, fill=0, outline=0)
                        drawn += 1

                # HATCH sınırlarını doğrudan dolguya çevir
                for poly in ent.get("polygons", []):
                    pix = poly_to_pixels(poly)
                    if len(pix) >= 3:
                        draw.polygon(pix, fill=0, outline=0)
                        drawn += 1

            except Exception:
                continue

        if drawn == 0:
            return None

        arr = np.array(img, dtype=np.uint8)
        edge_mask = arr < 230
        if not edge_mask.any():
            return None

        # Küçük açıklıkları kapatıp iç bölgeleri doldur.
        edge_img = Image.fromarray((edge_mask.astype(np.uint8) * 255), mode="L")
        grow = 3 if stroke <= 3 else 5
        edge_img = edge_img.filter(ImageFilter.MaxFilter(grow))
        edge_mask = np.array(edge_img) > 0

        open_mask = ~edge_mask
        outside = _flood_outside(open_mask)
        interior = open_mask & ~outside
        interior = _remove_interior_holes(edge_mask, interior, outside)
        interior_ratio = float(interior.sum()) / float(interior.size)
        if 0.001 <= interior_ratio <= 0.60:
            shape_mask = edge_mask | interior
        else:
            shape_mask = edge_mask

        # Referans görsele yakın tonlar
        bg_rgb = np.array([234, 234, 234], dtype=np.uint8)
        fg_rgb = np.array([52, 52, 56], dtype=np.uint8)
        out_rgb = np.empty((canvas_h, canvas_w, 3), dtype=np.uint8)
        out_rgb[:, :] = bg_rgb
        out_rgb[shape_mask] = fg_rgb

        out_img = Image.fromarray(out_rgb, mode="RGB")
        if aa > 1:
            resample = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
            out_img = out_img.resize((out_w, out_h), resample=resample)

        buf = _io.BytesIO()
        out_img.save(buf, format="JPEG", quality=92, optimize=True)
        buf.seek(0)
        return buf.read()

    except Exception as e:
        _log.warning("[JPG_PREVIEW] render hatası: %s", e)
        return None


def compute_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """Cosine benzerliği [0,1] aralığında döndür."""
    dot = np.dot(vec_a, vec_b)
    na, nb = np.linalg.norm(vec_a), np.linalg.norm(vec_b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.clip(dot / (na * nb), 0, 1))


def extract_stats(data: dict) -> dict:
    """Veritabanında saklanacak özet istatistikleri döndür."""
    entities = data.get("entities", [])
    bbox = data.get("bbox", {})
    bbox_w = (bbox.get("max_x", 0) - bbox.get("min_x", 0))
    bbox_h = (bbox.get("max_y", 0) - bbox.get("min_y", 0))
    return {
        "entity_count": len(entities),
        "layer_count": len(data.get("layers", [])),
        "layers": data.get("layers", []),
        "entity_types": dict(Counter(e["type"] for e in entities)),
        "bbox_width": round(bbox_w, 4),
        "bbox_height": round(bbox_h, 4),
        "bbox_area": round(bbox_w * bbox_h, 4),
    }
