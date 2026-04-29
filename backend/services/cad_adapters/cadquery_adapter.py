from __future__ import annotations

from typing import Any, Dict

from .base import BaseCADAdapter, CadAdapterResult


class CadQueryAdapter(BaseCADAdapter):
    """Adapter boundary for prompt/parameter driven CAD generation."""

    name = "cadquery"
    display_name = "CadQuery Parametric Adapter"
    integration_mode = "python_module_or_worker_boundary"
    license_name = "Apache-2.0"
    license_risk = "low"
    capabilities = ["rectangular_profile", "circular_hole_profile", "simple_extrusion", "aluminum_profile"]

    def generate_parametric(self, payload: Dict[str, Any]) -> CadAdapterResult:
        profile_type = payload.get("profile_type") or "rectangular_profile"
        return self._placeholder(
            "generate-parametric",
            "CadQuery adapter boundary is ready; Phase 2 returns a deterministic fallback plan.",
            supported=True,
            data={
                "profile_type": profile_type,
                "parameters": payload.get("parameters") or {},
                "planned_exports": payload.get("export_formats") or ["step", "stl", "dxf"],
                "fallback_model": {
                    "kind": profile_type,
                    "status": "not_generated",
                    "reason": "CadQuery runtime is intentionally not wired in Phase 2.",
                },
            },
        )

    def export_parametric(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "export-parametric",
            "Parametric export boundary is ready for STEP/STL/DXF once CadQuery runtime is enabled.",
            supported=True,
            data={
                "export_format": payload.get("export_format") or "step",
                "profile_type": payload.get("profile_type") or "rectangular_profile",
            },
        )
