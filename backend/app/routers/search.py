"""Global search route.

A single endpoint backs both the header quick-search dropdown and the full
search results page. Invoices are only searched for admins and office staff -
technicians never see money anywhere in PestBase.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.dependencies import can, get_current_user
from app.models.user import User
from app.schemas.search import SearchData, SearchResponse
from app.services import search_service

router = APIRouter(prefix="/api/v1/search", tags=["search"])


@router.get("", response_model=SearchResponse, summary="Search across PestBase")
@router.get("/", response_model=SearchResponse, include_in_schema=False)
async def search(
    q: str = Query(..., min_length=2, max_length=120, description="Search term"),
    types: Optional[str] = Query(
        None,
        description=(
            "Comma-separated collections to search, e.g. `customers,invoices`. "
            "Defaults to all of them."
        ),
    ),
    limit: int = Query(5, ge=1, le=20, description="Maximum results per collection"),
    current_user: User = Depends(get_current_user),
) -> SearchResponse:
    """Search customers, quotes, bookings, jobs and invoices in one call."""
    selected = search_service.parse_types(types)

    # Only search what this person may see.
    hidden = {name for name, permission in (("invoices", "invoices.view"), ("quotes", "quotes.view"))
              if not can(current_user, permission)}
    selected = [name for name in selected if name not in hidden]

    payload = await search_service.search_all(q, selected, limit)
    data = SearchData.model_validate(payload)

    return SearchResponse(
        data=data,
        message=f"{data.total_count} result(s) for '{data.query}'",
        success=True,
    )
