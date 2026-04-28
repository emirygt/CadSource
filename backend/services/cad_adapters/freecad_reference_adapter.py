from __future__ import annotations

from typing import Any, Dict

from .base import BaseCADAdapter, CadAdapterResult


class FreeCadReferenceAdapter(BaseCADAdapter):
    """Reference-only adapter for FreeCAD-inspired UX/workbench concepts."""

    name = "freecad_reference"
    display_name = "FreeCAD Reference Adapter"
    integration_mode = "reference_only"
    license_name = "LGPL-2.1 reference; no code or assets copied"
    license_risk = "medium"
    capabilities = ["workbench_ux_reference", "model_tree_reference", "properties_panel_reference"]

    def convert(self, payload: Dict[str, Any]) -> CadAdapterResult:
        return self._placeholder(
            "convert",
            "FreeCAD is reference-only in this project; no FreeCAD code path is executable here.",
            supported=False,
            data={"allowed_use": "UI/UX and workbench concept reference only"},
            warnings=["Do not copy FreeCAD C++/Qt code or assets into the web SaaS project."],
        )
