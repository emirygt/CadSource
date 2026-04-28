"""
cad_tools.py - isolated CAD tool adapter endpoints.

Faz 1: adapter skeleton + stable JSON responses. Existing upload/search/scan
and 3D endpoints are intentionally left untouched.
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

_log = _get_logger("routes.cad_tools")
router = APIRouter(prefix="/cad", tags=["cad-tools"])


def _payload(model) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _response(result) -> CadToolOperationResponse:
    return CadToolOperationResponse(**result.as_dict())


@router.get("/tools/health", response_model=CadToolHealthResponse)
def cad_tools_health() -> CadToolHealthResponse:
    adapters = list_adapter_health()
    return CadToolHealthResponse(
        adapters=adapters,
        warnings=[
            "Faz 1 only exposes adapter skeletons; no external CAD kernel is bundled or invoked.",
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
    return _response(adapter.convert(payload))


@router.post("/preview3d", response_model=CadToolOperationResponse)
def cad_preview3d(
    request: CadPreview3DRequest,
    tenant: dict = Depends(get_current_tenant),
) -> CadToolOperationResponse:
    payload = _payload(request)
    adapter = get_adapter(request.adapter, default="occt")
    _log.info("CAD preview3d placeholder requested adapter=%s tenant=%s", adapter.name, tenant.get("schema_name"))
    return _response(adapter.preview3d(payload))


@router.post("/analyze-model", response_model=CadToolOperationResponse)
def cad_analyze_model(
    request: CadAnalyzeModelRequest,
    tenant: dict = Depends(get_current_tenant),
) -> CadToolOperationResponse:
    payload = _payload(request)
    adapter = get_adapter(request.adapter, default="occt")
    _log.info("CAD analyze-model placeholder requested adapter=%s tenant=%s", adapter.name, tenant.get("schema_name"))
    try:
        return _response(adapter.analyze_model(payload))
    except Exception as exc:
        _log.exception("CAD analyze-model failed")
        raise HTTPException(status_code=422, detail=f"Model analysis failed: {exc}") from exc


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
    return _response(adapter.generate_parametric(payload))


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
    return _response(adapter.export_parametric(payload))
