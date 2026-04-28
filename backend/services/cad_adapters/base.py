"""
CAD tools adapter contracts.

Faz 1 bu adapterleri bilincli olarak hafif tutar: harici CAD kernel veya
GPL kodu yuklenmez, route'lar stabil JSON sozlesmesi dondurur.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class CadAdapterResult:
    """Standard response envelope produced by CAD adapters."""

    adapter: str
    operation: str
    status: str
    message: str
    supported: bool = False
    job_ready: bool = True
    data: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.status not in {"error", "failed"},
            "status": self.status,
            "adapter": self.adapter,
            "operation": self.operation,
            "supported": self.supported,
            "job_ready": self.job_ready,
            "message": self.message,
            "data": self.data,
            "warnings": self.warnings,
        }


class BaseCADAdapter:
    """Base class for isolated CAD tool integrations."""

    name = "base"
    display_name = "Base CAD Adapter"
    integration_mode = "placeholder"
    license_name = "internal"
    license_risk = "low"
    capabilities: List[str] = []

    def health(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "display_name": self.display_name,
            "integration_mode": self.integration_mode,
            "license": self.license_name,
            "license_risk": self.license_risk,
            "capabilities": self.capabilities,
            "available": True,
        }

    def _placeholder(
        self,
        operation: str,
        message: str,
        *,
        supported: bool = False,
        data: Dict[str, Any] | None = None,
        warnings: List[str] | None = None,
    ) -> CadAdapterResult:
        return CadAdapterResult(
            adapter=self.name,
            operation=operation,
            status="placeholder",
            message=message,
            supported=supported,
            data=data or {},
            warnings=warnings or [],
        )

    def convert(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder("convert", "Convert operation is not implemented for this adapter.")

    def preview3d(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder("preview3d", "3D preview operation is not implemented for this adapter.")

    def analyze_model(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder("analyze-model", "Model analysis operation is not implemented for this adapter.")

    def generate_parametric(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "generate-parametric",
            "Parametric generation operation is not implemented for this adapter.",
        )

    def export_parametric(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "export-parametric",
            "Parametric export operation is not implemented for this adapter.",
        )
