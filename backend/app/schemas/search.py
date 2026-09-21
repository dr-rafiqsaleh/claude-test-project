"""Schemas for the global search endpoint."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.common import ApiResponse


class SearchResultItem(BaseModel):
    """One row in the search results, whatever collection it came from."""

    id: str
    type: str  # "customer" | "quote" | "booking" | "job" | "invoice"
    title: str
    subtitle: str = ""
    status: Optional[str] = None
    url: str
    created_at: Optional[datetime] = None


class SearchResultGroups(BaseModel):
    """Results bucketed by collection, so the UI can render grouped headings."""

    customers: List[SearchResultItem] = Field(default_factory=list)
    quotes: List[SearchResultItem] = Field(default_factory=list)
    bookings: List[SearchResultItem] = Field(default_factory=list)
    jobs: List[SearchResultItem] = Field(default_factory=list)
    invoices: List[SearchResultItem] = Field(default_factory=list)


class SearchData(BaseModel):
    """Payload placed inside the standard response envelope."""

    results: SearchResultGroups = Field(default_factory=SearchResultGroups)
    total_count: int = 0
    query: str = ""


class SearchResponse(ApiResponse[SearchData]):
    """Envelope returned by GET /api/v1/search."""
