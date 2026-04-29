"""
attributes.py — Tenant-scoped custom attribute definitions + file attribute values
"""
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from db import get_db
from middleware.tenant import get_current_tenant, apply_tenant_schema
from schemas.attributes import (
    AttributeDefCreate, AttributeDefUpdate, AttributeDefOut,
    FileAttributesResponse, FileAttributesSave,
)
from logger import get_logger as _get_logger

_log = _get_logger("routes.attributes")
router = APIRouter(prefix="/attributes", tags=["attributes"])

_VALID_TYPES = {"text", "number", "boolean", "select"}


def _row_to_def(r: Any) -> AttributeDefOut:
    opts = r["options"]
    if isinstance(opts, str):
        try:
            opts = json.loads(opts)
        except Exception:
            opts = []
    return AttributeDefOut(
        id=r["id"],
        name=r["name"],
        data_type=r["data_type"],
        options=opts or [],
        unit=r["unit"] or "",
        required=bool(r["required"]),
        sort_order=r["sort_order"] or 0,
    )


# ── Definitions CRUD ──────────────────────────────────────────────────────────

@router.get("/definitions", response_model=list[AttributeDefOut])
def list_definitions(
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    rows = db.execute(
        text("SELECT * FROM attribute_definitions ORDER BY sort_order, id")
    ).mappings().all()
    return [_row_to_def(r) for r in rows]


@router.post("/definitions", response_model=AttributeDefOut, status_code=201)
def create_definition(
    body: AttributeDefCreate,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    if body.data_type not in _VALID_TYPES:
        raise HTTPException(400, f"data_type must be one of {sorted(_VALID_TYPES)}")
    row = db.execute(
        text("""
            INSERT INTO attribute_definitions (name, data_type, options, unit, required, sort_order)
            VALUES (:name, :dt, :opts, :unit, :req, :so)
            RETURNING *
        """),
        {
            "name": body.name, "dt": body.data_type,
            "opts": json.dumps(body.options), "unit": body.unit,
            "req": body.required, "so": body.sort_order,
        }
    ).mappings().fetchone()
    db.commit()
    return _row_to_def(row)


@router.put("/definitions/{def_id}", response_model=AttributeDefOut)
def update_definition(
    def_id: int,
    body: AttributeDefUpdate,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    existing = db.execute(
        text("SELECT * FROM attribute_definitions WHERE id = :id"),
        {"id": def_id}
    ).mappings().fetchone()
    if not existing:
        raise HTTPException(404, "Attribute tanımı bulunamadı")

    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.data_type is not None:
        if body.data_type not in _VALID_TYPES:
            raise HTTPException(400, f"data_type must be one of {sorted(_VALID_TYPES)}")
        updates["data_type"] = body.data_type
    if body.options is not None:
        updates["options"] = json.dumps(body.options)
    if body.unit is not None:
        updates["unit"] = body.unit
    if body.required is not None:
        updates["required"] = body.required
    if body.sort_order is not None:
        updates["sort_order"] = body.sort_order

    if not updates:
        return _row_to_def(existing)

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = def_id
    row = db.execute(
        text(f"UPDATE attribute_definitions SET {set_clause} WHERE id = :id RETURNING *"),
        updates
    ).mappings().fetchone()
    db.commit()
    return _row_to_def(row)


@router.delete("/definitions/{def_id}", status_code=204)
def delete_definition(
    def_id: int,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    result = db.execute(
        text("DELETE FROM attribute_definitions WHERE id = :id"), {"id": def_id}
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Attribute tanımı bulunamadı")


# ── File attribute values ─────────────────────────────────────────────────────

@router.get("/files/{file_id}", response_model=FileAttributesResponse)
def get_file_attributes(
    file_id: int,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    file_row = db.execute(
        text("SELECT id, attributes FROM cad_files WHERE id = :id"), {"id": file_id}
    ).mappings().fetchone()
    if not file_row:
        raise HTTPException(404, "Dosya bulunamadı")

    raw = file_row["attributes"]
    if isinstance(raw, str):
        try:
            values = json.loads(raw)
        except Exception:
            values = {}
    else:
        values = raw or {}

    defs = db.execute(
        text("SELECT * FROM attribute_definitions ORDER BY sort_order, id")
    ).mappings().all()

    return FileAttributesResponse(
        file_id=file_id,
        definitions=[_row_to_def(d) for d in defs],
        values=values,
    )


@router.put("/files/{file_id}", response_model=FileAttributesResponse)
def save_file_attributes(
    file_id: int,
    body: FileAttributesSave,
    tenant=Depends(get_current_tenant),
    db: Session = Depends(get_db),
):
    apply_tenant_schema(tenant, db)
    exists = db.execute(
        text("SELECT id FROM cad_files WHERE id = :id"), {"id": file_id}
    ).fetchone()
    if not exists:
        raise HTTPException(404, "Dosya bulunamadı")

    db.execute(
        text("UPDATE cad_files SET attributes = :attrs WHERE id = :id"),
        {"attrs": json.dumps(body.values), "id": file_id}
    )
    db.commit()

    defs = db.execute(
        text("SELECT * FROM attribute_definitions ORDER BY sort_order, id")
    ).mappings().all()

    return FileAttributesResponse(
        file_id=file_id,
        definitions=[_row_to_def(d) for d in defs],
        values=body.values,
    )
