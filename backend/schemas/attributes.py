from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AttributeDefCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    data_type: str = Field("text")  # text | number | boolean | select
    options: List[str] = []
    unit: str = ""
    required: bool = False
    sort_order: int = 0


class AttributeDefUpdate(BaseModel):
    name: Optional[str] = None
    data_type: Optional[str] = None
    options: Optional[List[str]] = None
    unit: Optional[str] = None
    required: Optional[bool] = None
    sort_order: Optional[int] = None


class AttributeDefOut(BaseModel):
    id: int
    name: str
    data_type: str
    options: List[str]
    unit: str
    required: bool
    sort_order: int


class FileAttributesResponse(BaseModel):
    file_id: int
    definitions: List[AttributeDefOut]
    values: Dict[str, Any]


class FileAttributesSave(BaseModel):
    values: Dict[str, Any]
