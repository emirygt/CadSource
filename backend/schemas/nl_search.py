from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class NLSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(20, ge=1, le=100)
    min_similarity: float = Field(0.15, ge=0.0, le=1.0)
    category_id: Optional[int] = None


class NLSearchResultItem(BaseModel):
    id: int
    filename: str
    file_format: str
    similarity: float
    jpg_preview: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    entity_count: Optional[int] = None
    bbox_width: Optional[float] = None
    bbox_height: Optional[float] = None
    layers: Optional[List[str]] = None


class NLSearchResponse(BaseModel):
    query: str
    total_matches: int
    results: List[NLSearchResultItem]
