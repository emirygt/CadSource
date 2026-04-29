from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .operation_boundary import classify_format, normalize_format


@dataclass(frozen=True)
class ConverterPlan:
    operation: str
    adapter: str
    strategy: str
    source_format: Optional[str]
    target_format: Optional[str]
    current_internal_paths: List[str] = field(default_factory=list)
    future_service: Optional[str] = None
    supported_boundary: bool = True
    job: Dict[str, Any] = field(default_factory=dict)
    license_policy: str = ""
    error_policy: str = "return structured JSON errors from the route; do not leak raw parser/kernel exceptions"
    notes: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "operation": self.operation,
            "adapter": self.adapter,
            "strategy": self.strategy,
            "source_format": self.source_format,
            "target_format": self.target_format,
            "current_internal_paths": self.current_internal_paths,
            "future_service": self.future_service,
            "supported_boundary": self.supported_boundary,
            "job": self.job,
            "license_policy": self.license_policy,
            "error_policy": self.error_policy,
            "notes": self.notes,
        }


def build_converter_plan(operation: str, payload: Dict[str, Any], adapter_name: str) -> Dict[str, Any]:
    source = normalize_format(payload.get("source_format") or _format_from_filename(payload.get("filename")))
    target = normalize_format(payload.get("target_format") or payload.get("export_format"))
    source_kind = classify_format(source)
    target_kind = classify_format(target)
    use_job = bool(payload.get("use_job"))

    if operation in {"generate-parametric", "export-parametric"}:
        return _parametric_plan(operation, payload, adapter_name, target, use_job).as_dict()

    if operation == "preview3d":
        return _preview_plan(operation, adapter_name, source, source_kind, use_job).as_dict()

    if "kernel_service" in {source_kind, target_kind} or adapter_name in {"occt", "mayo"}:
        return _kernel_plan(operation, adapter_name, source, target, use_job).as_dict()

    if "scan_pipeline" in {source_kind, target_kind}:
        return _scan_plan(operation, adapter_name, source, target, use_job).as_dict()

    if "dxf_pipeline" in {source_kind, target_kind} or adapter_name == "dxf":
        return _dxf_plan(operation, adapter_name, source, target, use_job).as_dict()

    return ConverterPlan(
        operation=operation,
        adapter=adapter_name,
        strategy="unsupported_boundary",
        source_format=source or None,
        target_format=target or None,
        supported_boundary=False,
        job=_job_descriptor(use_job=use_job, planned_type="cad_convert"),
        license_policy="No third-party runtime selected.",
        notes=["No internal converter is mapped for this format pair yet."],
    ).as_dict()


def _dxf_plan(operation: str, adapter_name: str, source: str, target: str, use_job: bool) -> ConverterPlan:
    paths = ["features.parse_dxf_bytes"]
    if target in {"svg", ""}:
        paths.append("features.generate_svg_preview")
    if target == "dxf" or operation == "convert":
        paths.append("routes.scan.scan_export_dxf")
    return ConverterPlan(
        operation=operation,
        adapter=adapter_name,
        strategy="internal_existing_pipeline",
        source_format=source or None,
        target_format=target or None,
        current_internal_paths=paths,
        job=_job_descriptor(use_job=use_job, planned_type="cad_convert", recommended=False),
        license_policy="Use internal ezdxf/features code only; LibreCAD/libdxfrw remains GPL reference-only.",
        notes=["DXF/DWG conversion quality can improve behind this adapter without changing upload/search/index routes."],
    )


def _scan_plan(operation: str, adapter_name: str, source: str, target: str, use_job: bool) -> ConverterPlan:
    return ConverterPlan(
        operation=operation,
        adapter=adapter_name,
        strategy="internal_existing_pipeline",
        source_format=source or None,
        target_format=target or None,
        current_internal_paths=["routes.scan.scan_convert", "routes.scan.scan_export_dxf"],
        job=_job_descriptor(use_job=use_job, planned_type="cad_scan_convert", recommended=use_job),
        license_policy="Use existing OpenCV/pdf2image/potrace pipeline as installed; no new CAD project code copied.",
        notes=["Large PDF/image vectorization should be queued once the worker supports cad_scan_convert."],
    )


def _preview_plan(operation: str, adapter_name: str, source: str, source_kind: str, use_job: bool) -> ConverterPlan:
    if source_kind == "kernel_service":
        return _kernel_plan(operation, adapter_name, source, "glb", use_job)
    return ConverterPlan(
        operation=operation,
        adapter=adapter_name,
        strategy="internal_existing_pipeline",
        source_format=source or None,
        target_format="glb",
        current_internal_paths=["routes.model3d.get_model3d"],
        job=_job_descriptor(use_job=use_job, planned_type="cad_preview3d", recommended=use_job),
        license_policy="Existing DXF/DWG extrusion uses internal Python geometry stack; no OCCT runtime is invoked.",
        notes=["This is suitable for simple closed profile extrusion, not full B-rep STEP/IGES preview."],
    )


def _kernel_plan(operation: str, adapter_name: str, source: str, target: str, use_job: bool) -> ConverterPlan:
    service = "mayo_converter_service" if adapter_name == "mayo" else "occt_kernel_service"
    return ConverterPlan(
        operation=operation,
        adapter=adapter_name,
        strategy="external_service_boundary",
        source_format=source or None,
        target_format=target or None,
        future_service=service,
        supported_boundary=True,
        job=_job_descriptor(use_job=True if use_job else False, planned_type="cad_kernel_convert", recommended=True),
        license_policy="Run OCCT/Mayo outside the FastAPI request path; review binary/runtime license before deployment.",
        notes=[
            "Use file handoff plus job status polling for STEP/IGES/STL/OBJ/GLB workloads.",
            "Do not couple this service to vector indexing, duplicate detection, or tenant schema migrations.",
        ],
    )


def _parametric_plan(
    operation: str,
    payload: Dict[str, Any],
    adapter_name: str,
    target: str,
    use_job: bool,
) -> ConverterPlan:
    profile_type = str(payload.get("profile_type") or "rectangular_profile")
    return ConverterPlan(
        operation=operation,
        adapter=adapter_name,
        strategy="parametric_worker_boundary",
        source_format=profile_type,
        target_format=target or None,
        future_service="cadquery_parametric_worker",
        supported_boundary=True,
        job=_job_descriptor(use_job=use_job, planned_type="cad_parametric", recommended=use_job),
        license_policy="CadQuery is Apache-2.0; keep execution behind whitelisted templates and resource limits.",
        notes=["Supported templates: rectangular_profile, circular_hole_profile, simple_extrusion, aluminum_profile."],
    )


def _job_descriptor(*, use_job: bool, planned_type: str, recommended: bool = False) -> Dict[str, Any]:
    return {
        "requested": bool(use_job),
        "recommended": bool(recommended),
        "planned_type": planned_type,
        "current_status": "planned_boundary_only",
        "enqueue_endpoint": "/jobs once worker supports this planned_type",
    }


def _format_from_filename(filename: Any) -> str:
    name = str(filename or "")
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[-1]
