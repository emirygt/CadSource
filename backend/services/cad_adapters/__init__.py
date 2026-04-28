from __future__ import annotations

from typing import Dict, List, Optional

from .base import BaseCADAdapter
from .cadquery_adapter import CadQueryAdapter
from .dxf_adapter import DxfAdapter
from .freecad_reference_adapter import FreeCadReferenceAdapter
from .mayo_adapter import MayoAdapter
from .occt_adapter import OcctAdapter


_ADAPTERS: Dict[str, BaseCADAdapter] = {
    "dxf": DxfAdapter(),
    "occt": OcctAdapter(),
    "mayo": MayoAdapter(),
    "cadquery": CadQueryAdapter(),
    "freecad_reference": FreeCadReferenceAdapter(),
}


def get_adapter(name: Optional[str], default: str = "dxf") -> BaseCADAdapter:
    adapter_name = (name or default).strip().lower()
    return _ADAPTERS.get(adapter_name, _ADAPTERS[default])


def list_adapter_health() -> List[dict]:
    return [adapter.health() for adapter in _ADAPTERS.values()]


def infer_convert_adapter(source_format: Optional[str], target_format: Optional[str]) -> str:
    formats = {str(source_format or "").lower(), str(target_format or "").lower()}
    if formats & {"dxf", "dwg", "svg"}:
        return "dxf"
    if formats & {"step", "stp", "iges", "igs", "stl", "obj", "glb", "gltf"}:
        return "mayo"
    return "dxf"
