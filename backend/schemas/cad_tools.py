from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CadToolOperationResponse(BaseModel):
    ok: bool
    status: str
    adapter: str
    operation: str
    supported: bool
    job_ready: bool
    message: str
    data: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)


class CadToolHealthResponse(BaseModel):
    ok: bool = True
    status: str = "ok"
    service: str = "cad_tools"
    version: str = "phase2"
    adapters: List[Dict[str, Any]] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class CadBaseRequest(BaseModel):
    adapter: Optional[str] = Field(default=None, description="Adapter name override.")
    file_id: Optional[int] = Field(default=None, ge=1)
    filename: Optional[str] = None
    source_format: Optional[str] = None
    options: Dict[str, Any] = Field(default_factory=dict)
    use_job: bool = Field(default=False, description="Reserve operation for background job flow.")


class CadConvertRequest(CadBaseRequest):
    target_format: str = Field(default="svg")


class CadPreview3DRequest(CadBaseRequest):
    target_format: str = Field(default="glb")


class CadAnalyzeModelRequest(CadBaseRequest):
    analysis_level: str = Field(default="basic")


class CadGenerateParametricRequest(BaseModel):
    adapter: Optional[str] = None
    profile_type: str = Field(default="rectangular_profile")
    parameters: Dict[str, Any] = Field(default_factory=dict)
    export_formats: List[str] = Field(default_factory=lambda: ["step", "stl", "dxf"])
    use_job: bool = False


class CadExportParametricRequest(BaseModel):
    adapter: Optional[str] = None
    profile_type: str = Field(default="rectangular_profile")
    parameters: Dict[str, Any] = Field(default_factory=dict)
    export_format: str = Field(default="step")
    use_job: bool = False
