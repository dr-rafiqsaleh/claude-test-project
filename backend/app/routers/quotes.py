"""Quote routes.

All routes require authentication. Admin and office staff may create and edit;
only admins may delete a draft or force a quote to expired.
"""

from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.config import settings
from app.core.dependencies import can, require_permission
from app.models.quote import QuoteStatus
from app.models.user import User
from app.schemas.quote import (
    QuoteCreate,
    QuoteListData,
    QuoteListResponse,
    QuoteResponse,
    QuoteResponseEnvelope,
    QuoteStatusUpdate,
    QuoteUpdate,
)
from app.services import quote_service
from app.services.quote_service import (
    CustomerNotFoundError,
    QuoteNotFoundError,
    QuoteStateError,
    build_quote_payload,
)

router = APIRouter(prefix="/api/v1/quotes", tags=["quotes"])


@router.get("", response_model=QuoteListResponse, summary="List quotes")
@router.get("/", response_model=QuoteListResponse, include_in_schema=False)
async def list_quotes(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    quote_status: Optional[QuoteStatus] = Query(None, alias="status", description="Filter by status"),
    customer_id: Optional[str] = Query(None, description="Filter by customer"),
    q: Optional[str] = Query(None, description="Search quote number or customer name"),
    _current_user: User = Depends(require_permission("quotes.view")),
) -> QuoteListResponse:
    """Return a paginated, filterable list of quotes."""
    payloads, total = await quote_service.list_quotes(
        page=page,
        page_size=page_size,
        status=quote_status,
        customer_id=customer_id,
        q=q,
    )

    return QuoteListResponse(
        data=QuoteListData(
            items=[QuoteResponse.model_validate(payload) for payload in payloads],
            total=total,
            page=page,
            page_size=page_size,
        ),
        message=f"{total} quote(s) found",
        success=True,
    )


@router.post(
    "",
    response_model=QuoteResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Create a quote",
)
@router.post(
    "/",
    response_model=QuoteResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_quote(
    payload: QuoteCreate,
    current_user: User = Depends(require_permission("quotes.edit")),
) -> QuoteResponseEnvelope:
    """Create a quote with an auto-generated quote number."""
    try:
        quote, customer = await quote_service.create_quote(payload, created_by=current_user.id)
    except CustomerNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return QuoteResponseEnvelope(
        data=QuoteResponse.model_validate(build_quote_payload(quote, customer)),
        message=f"Quote {quote.quote_number} created successfully",
        success=True,
    )


@router.get("/{quote_id}", response_model=QuoteResponseEnvelope, summary="Get a quote by id")
async def get_quote(
    quote_id: str,
    _current_user: User = Depends(require_permission("quotes.view")),
) -> QuoteResponseEnvelope:
    """Fetch a single quote."""
    try:
        quote, customer = await quote_service.get_quote(quote_id)
    except QuoteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return QuoteResponseEnvelope(
        data=QuoteResponse.model_validate(build_quote_payload(quote, customer)),
        message="Quote retrieved",
        success=True,
    )


@router.put("/{quote_id}", response_model=QuoteResponseEnvelope, summary="Update a draft quote")
async def update_quote(
    quote_id: str,
    payload: QuoteUpdate,
    _current_user: User = Depends(require_permission("quotes.edit")),
) -> QuoteResponseEnvelope:
    """Update a quote. Only quotes still in draft can be edited."""
    try:
        quote, customer = await quote_service.update_quote(quote_id, payload)
    except QuoteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CustomerNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except QuoteStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return QuoteResponseEnvelope(
        data=QuoteResponse.model_validate(build_quote_payload(quote, customer)),
        message="Quote updated successfully",
        success=True,
    )


@router.delete("/{quote_id}", response_model=QuoteResponseEnvelope, summary="Delete a draft quote")
async def delete_quote(
    quote_id: str,
    _current_user: User = Depends(require_permission("quotes.delete")),
) -> QuoteResponseEnvelope:
    """Permanently delete a draft quote."""
    try:
        quote = await quote_service.delete_quote(quote_id)
    except QuoteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except QuoteStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return QuoteResponseEnvelope(
        data=QuoteResponse.model_validate(build_quote_payload(quote, None)),
        message=f"Quote {quote.quote_number} deleted",
        success=True,
    )


@router.patch("/{quote_id}/status", response_model=QuoteResponseEnvelope, summary="Update quote status")
async def update_quote_status(
    quote_id: str,
    payload: QuoteStatusUpdate,
    current_user: User = Depends(require_permission("quotes.edit")),
) -> QuoteResponseEnvelope:
    """Move a quote through its lifecycle (draft -> sent -> accepted/rejected)."""
    try:
        quote, customer = await quote_service.update_status(
            quote_id,
            payload.status,
            rejection_reason=payload.rejection_reason,
            is_admin=can(current_user, "quotes.delete"),
        )
    except QuoteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except QuoteStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    message = f"Quote marked as {quote.status.value}"
    if quote.status == QuoteStatus.ACCEPTED and not quote.converted_to_booking:
        message = "Quote accepted. Ready to convert to booking."

    return QuoteResponseEnvelope(
        data=QuoteResponse.model_validate(build_quote_payload(quote, customer)),
        message=message,
        success=True,
    )


@router.get("/{quote_id}/pdf", summary="Download a quote as PDF", response_class=StreamingResponse)
async def download_quote_pdf(
    quote_id: str,
    _current_user: User = Depends(require_permission("quotes.view")),
) -> StreamingResponse:
    """Render the quote as an A4 PDF and stream it back."""
    try:
        pdf_bytes, quote_number = await quote_service.generate_pdf(quote_id)
    except QuoteNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    filename = f"quote-{quote_number}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
