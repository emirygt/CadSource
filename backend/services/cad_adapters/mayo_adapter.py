from __future__ import annotations

from typing import Any, Dict

from .base import BaseCADAdapter, CadAdapterResult


class MayoAdapter(BaseCADAdapter):
    """Adapter boundary for a Mayo-like viewer/converter service."""

    name = "mayo"
    display_name = "Mayo Converter Adapter"
    integration_mode = "external_cli_or_service"
    license_name = "BSD-2-Clause"
    license_risk = "low"
    capabilities = ["step_to_gltf", "iges_to_gltf", "stl_preview", "converter_pipeline"]

    def convert(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "convert",
            "Mayo-style converter boundary is ready; no binary is bundled or invoked in Phase 2.",
            supported=True,
            data={
                "source_format": payload.get("source_format"),
                "target_format": payload.get("target_format"),
                "future_boundary": "Queue large conversions as jobs and call an isolated converter process.",
            },
        )
