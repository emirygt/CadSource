from __future__ import annotations

from typing import Any, Dict

from .base import BaseCADAdapter, CadAdapterResult


class DxfAdapter(BaseCADAdapter):
    """Adapter boundary for the existing DXF/DWG/SVG pipeline."""

    name = "dxf"
    display_name = "DXF/DWG Adapter"
    integration_mode = "internal_adapter"
    license_name = "internal ezdxf pipeline; LibreCAD/libdxfrw only as GPL reference"
    license_risk = "medium"
    capabilities = ["dxf_parse", "dwg_to_dxf_boundary", "svg_preview", "dxf_export"]

    def convert(self, payload: Dict[str, Any]) -> CadAdapterResult:
        source = str(payload.get("source_format") or "dxf").lower()
        target = str(payload.get("target_format") or "svg").lower()
        return self._placeholder(
            "convert",
            "DXF adapter boundary is ready; existing features.py and /scan/export-dxf remain the active pipeline.",
            supported=True,
            data={
                "source_format": source,
                "target_format": target,
                "active_internal_paths": ["features.py", "routes.scan"],
                "service_boundary": "Use this adapter for future safer DXF/SVG/export upgrades.",
            },
            warnings=[
                "LibreCAD/libdxfrw is GPL; do not copy or embed its code into this SaaS backend.",
            ],
        )

    def analyze_model(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "analyze-model",
            "DXF model analysis adapter is reserved for entity/layer/bbox audit expansion.",
            supported=True,
            data={
                "planned_metrics": ["entity_counts", "layers", "bbox", "geometry_hash", "repair_hints"],
            },
        )
