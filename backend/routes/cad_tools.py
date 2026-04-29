"""
cad_tools.py - isolated CAD tool adapter endpoints.

Phase 2: adapter skeleton + service-boundary metadata. Existing upload/search/scan
and 3D endpoints remain intentionally untouched.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from logger import get_logger as _get_logger
from middleware.tenant import get_current_tenant
from schemas.cad_tools import (
    CadAnalyzeModelRequest,
    CadConvertRequest,
    CadExportParametricRequest,
    CadGenerateParametricRequest,
    CadPreview3DRequest,
    CadToolHealthResponse,
    CadToolOperationResponse,
)
from services.cad_adapters import get_adapter, infer_convert_adapter, list_adapter_health
from services.cad_adapters.converter_boundary import build_converter_plan
from services.cad_adapters.operation_boundary import build_operation_boundary

_log = _get_logger("routes.cad_tools")
router = APIRouter(prefix="/cad", tags=["cad-tools"])


def _payload(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _response(result) -> CadToolOperationResponse:
    return CadToolOperationResponse(**result.as_dict())


def _attach_boundary(result, operation: str, payload: dict) -> CadToolOperationResponse:
    data = dict(result.data or {})
    existing_boundary = data.get("service_boundary")
    if existing_boundary is not None and not isinstance(existing_boundary, dict):
        data["adapter_boundary_note"] = existing_boundary
    data["service_boundary"] = build_operation_boundary(operation, payload, result.adapter)
    data["converter_plan"] = build_converter_plan(operation, payload, result.adapter)
    result.data = data
    return _response(result)


def _adapter_error(operation: str, adapter_name: str, exc: Exception) -> HTTPException:
    _log.exception("CAD adapter operation failed adapter=%s operation=%s", adapter_name, operation)
    return HTTPException(
        status_code=422,
        detail={
            "ok": False,
            "status": "error",
            "code": "CAD_ADAPTER_ERROR",
            "adapter": adapter_name,
            "operation": operation,
            "message": str(exc),
        },
    )


@router.get("/tools/health", response_model=CadToolHealthResponse)
def cad_tools_health() -> CadToolHealthResponse:
    adapters = list_adapter_health()
    return CadToolHealthResponse(
        adapters=adapters,
        warnings=[
            "Phase 2 exposes service-boundary metadata; no external CAD kernel is bundled or invoked.",
            "GPL CAD projects are reference-only unless isolated behind a reviewed service boundary.",
        ],
    )


@router.post("/convert", response_model=CadToolOperationResponse)
def cad_convert(
    request: CadConvertRequest,
    tenant: dict = Depends(get_current_tenant),
) -> CadToolOperationResponse:
    payload = _payload(request)
    default_adapter = infer_convert_adapter(request.source_format, request.target_format)
    adapter = get_adapter(request.adapter, default=default_adapter)
    _log.info(
        "CAD convert placeholder requested adapter=%s tenant=%s source=%s target=%s",
        adapter.name,
        tenant.get("schema_name"),
        request.source_format,
        request.target_format,
    )
    try:
        return _attach_boundary(adapter.convert(payload), "convert", payload)
    except Exception as exc:
        raise _adapter_error("convert", adapter.name, exc) from exc


@router.post("/preview3d", response_model=CadToolOperationResponse)
def cad_preview3d(
    request: CadPreview3DRequest,
    tenant: dict = Depends(get_current_tenant),
) -> CadToolOperationResponse:
    payload = _payload(request)
    adapter = get_adapter(request.adapter, default="occt")
    _log.info("CAD preview3d placeholder requested adapter=%s tenant=%s", adapter.name, tenant.get("schema_name"))
    try:
        return _attach_boundary(adapter.preview3d(payload), "preview3d", payload)
    except Exception as exc:
        raise _adapter_error("preview3d", adapter.name, exc) from exc


@router.post("/analyze-model", response_model=CadToolOperationResponse)
def cad_analyze_model(
    request: CadAnalyzeModelRequest,
    tenant: dict = Depends(get_current_tenant),
) -> CadToolOperationResponse:
    payload = _payload(request)
    adapter = get_adapter(request.adapter, default="occt")
    _log.info("CAD analyze-model placeholder requested adapter=%s tenant=%s", adapter.name, tenant.get("schema_name"))
    try:
        return _attach_boundary(adapter.analyze_model(payload), "analyze-model", payload)
    except Exception as exc:
        raise _adapter_error("analyze-model", adapter.name, exc) from exc


@router.post("/generate-parametric", response_model=CadToolOperationResponse)
def cad_generate_parametric(
    request: CadGenerateParametricRequest,
    tenant: dict = Depends(get_current_tenant),
) -> CadToolOperationResponse:
    payload = _payload(request)
    adapter = get_adapter(request.adapter, default="cadquery")
    _log.info(
        "CAD generate-parametric placeholder requested adapter=%s tenant=%s profile=%s",
        adapter.name,
        tenant.get("schema_name"),
        request.profile_type,
    )
    try:
        return _attach_boundary(adapter.generate_parametric(payload), "generate-parametric", payload)
    except Exception as exc:
        raise _adapter_error("generate-parametric", adapter.name, exc) from exc


@router.post("/export-parametric", response_model=CadToolOperationResponse)
def cad_export_parametric(
    request: CadExportParametricRequest,
    tenant: dict = Depends(get_current_tenant),
) -> CadToolOperationResponse:
    payload = _payload(request)
    adapter = get_adapter(request.adapter, default="cadquery")
    _log.info(
        "CAD export-parametric placeholder requested adapter=%s tenant=%s format=%s",
        adapter.name,
        tenant.get("schema_name"),
        request.export_format,
    )
    try:
        return _attach_boundary(adapter.export_parametric(payload), "export-parametric", payload)
    except Exception as exc:
        raise _adapter_error("export-parametric", adapter.name, exc) from exc
