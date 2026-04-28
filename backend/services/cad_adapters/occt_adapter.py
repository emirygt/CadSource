from __future__ import annotations

from typing import Any, Dict

from .base import BaseCADAdapter, CadAdapterResult


class OcctAdapter(BaseCADAdapter):
    """Adapter boundary for OCCT-backed 3D and CAD-kernel workflows."""

    name = "occt"
    display_name = "OCCT Adapter"
    integration_mode = "external_service_boundary"
    license_name = "LGPL-2.1 with Open CASCADE exception"
    license_risk = "medium"
    capabilities = ["step", "iges", "stl", "obj", "glb", "solid_analysis", "contour_extrusion"]

    def preview3d(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "preview3d",
            "OCCT 3D preview boundary is ready; current /files/{id}/model3d endpoint remains unchanged.",
            supported=True,
            data={
                "preferred_outputs": ["glb", "stl"],
                "current_internal_path": "routes.model3d",
                "future_boundary": "Run OCCT behind a CLI or worker service before wiring production traffic.",
            },
        )

    def analyze_model(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "analyze-model",
            "OCCT analysis boundary is ready for STEP/IGES topology and solid validation.",
            supported=True,
            data={
                "planned_metrics": ["volume", "surface_area", "bbox_3d", "face_count", "edge_count", "watertight"],
            },
        )
