from __future__ import annotations

from typing import Any, Dict, Optional


DXF_PIPELINE_FORMATS = {"dxf", "dwg", "svg"}
SCAN_PIPELINE_FORMATS = {"pdf", "png", "jpg", "jpeg", "bmp", "tif", "tiff", "webp"}
KERNEL_FORMATS = {"step", "stp", "iges", "igs", "stl", "obj", "glb", "gltf"}
PARAMETRIC_FORMATS = {"step", "stl", "dxf"}


def normalize_format(value: Optional[str]) -> str:
    return str(value or "").strip().lower().lstrip(".")


def classify_format(value: Optional[str]) -> str:
    fmt = normalize_format(value)
    if fmt in DXF_PIPELINE_FORMATS:
        return "dxf_pipeline"
    if fmt in SCAN_PIPELINE_FORMATS:
        return "scan_pipeline"
    if fmt in KERNEL_FORMATS:
        return "kernel_service"
    if fmt in PARAMETRIC_FORMATS:
        return "parametric_export"
    return "unknown"


def build_operation_boundary(operation: str, payload: Dict[str, Any], adapter_name: str) -> Dict[str, Any]:
    is_parametric = operation in {"generate-parametric", "export-parametric"}
    source = normalize_format(payload.get("source_format") or _format_from_filename(payload.get("filename")))
    target = normalize_format(payload.get("target_format") or payload.get("export_format"))
    source_kind = "parametric_template" if is_parametric else classify_format(source)
    target_kind = _classify_parametric_target(target) if is_parametric else classify_format(target)
    use_job = bool(payload.get("use_job"))
    kernel_involved = "kernel_service" in {source_kind, target_kind}

    return {
        "phase": "phase2",
        "operation": operation,
        "adapter": adapter_name,
        "source_format": source or None,
        "target_format": target or None,
        "source_kind": source_kind,
        "target_kind": target_kind,
        "active_pipeline": _active_pipeline(operation, source_kind, target_kind),
        "job_recommended": bool(use_job or kernel_involved),
        "job_hook": "routes.jobs enqueue_job/add_job_item" if (use_job or kernel_involved) else None,
        "crash_policy": "adapter must return structured JSON; do not raise raw parser/kernel errors to clients",
        "tenant_policy": "caller route keeps JWT tenant dependency; adapter receives no schema mutation authority",
        "isolation_policy": _isolation_policy(adapter_name, source_kind, target_kind),
    }


def _format_from_filename(filename: Any) -> str:
    name = str(filename or "")
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[-1]


def _active_pipeline(operation: str, source_kind: str, target_kind: str) -> str:
    if operation in {"generate-parametric", "export-parametric"}:
        return "CadQuery worker/module boundary"
    kinds = {source_kind, target_kind}
    if operation == "preview3d":
        return "routes.model3d for existing DXF/DWG profile preview; external OCCT/Mayo service for STEP/IGES/STL/OBJ/GLB"
    if "dxf_pipeline" in kinds:
        return "features.py + routes.scan for DXF/DWG/SVG parse/export/preview"
    if "scan_pipeline" in kinds:
        return "routes.scan converts PDF/images to editable scan entities"
    if "kernel_service" in kinds:
        return "external converter/kernel service boundary; do not load kernels in FastAPI request path"
    return "no active internal converter selected"


def _classify_parametric_target(target: str) -> str:
    if target in PARAMETRIC_FORMATS:
        return "parametric_export"
    return classify_format(target)


def _isolation_policy(adapter_name: str, source_kind: str, target_kind: str) -> str:
    if adapter_name == "cadquery":
        return "run as Python module or worker with whitelisted parametric templates"
    if adapter_name in {"occt", "mayo"} or "kernel_service" in {source_kind, target_kind}:
        return "run as separate CLI/service/worker with file handoff; FastAPI stores request/job metadata only"
    if adapter_name == "dxf":
        return "reuse internal ezdxf/features pipeline; GPL projects remain reference-only"
    return "reference-only or unsupported"
