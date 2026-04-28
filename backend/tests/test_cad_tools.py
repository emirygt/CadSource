from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from middleware.tenant import get_current_tenant  # noqa: E402
from routes.cad_tools import router  # noqa: E402


def _tenant_override() -> dict:
    return {"user_id": 1, "schema_name": "testtenant", "email": "test@example.com"}


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_tenant] = _tenant_override
    return TestClient(app)


def test_cad_tools_health_lists_adapters():
    client = _client()
    response = client.get("/cad/tools/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    names = {adapter["name"] for adapter in body["adapters"]}
    assert {"dxf", "occt", "mayo", "cadquery", "freecad_reference"}.issubset(names)


def test_cad_convert_returns_placeholder_response():
    client = _client()
    response = client.post(
        "/cad/convert",
        json={"source_format": "dxf", "target_format": "svg", "filename": "sample.dxf"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["status"] == "placeholder"
    assert body["adapter"] == "dxf"
    assert body["operation"] == "convert"


def test_cad_generate_parametric_uses_cadquery_boundary():
    client = _client()
    response = client.post(
        "/cad/generate-parametric",
        json={
            "profile_type": "circular_hole_profile",
            "parameters": {"width": 80, "height": 40, "hole_diameter": 12},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["adapter"] == "cadquery"
    assert body["data"]["profile_type"] == "circular_hole_profile"


if __name__ == "__main__":
    test_cad_tools_health_lists_adapters()
    test_cad_convert_returns_placeholder_response()
    test_cad_generate_parametric_uses_cadquery_boundary()
    print("cad_tools tests passed")
