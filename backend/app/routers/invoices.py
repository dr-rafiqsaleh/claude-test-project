"""Invoice and payment routes.

All routes require authentication.

* Admin and office staff manage every invoice.
* Technicians have no access to invoicing at all.
* Only admins may delete a draft invoice.
"""

from datetime import datetime
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.config import settings
from app.core.dependencies import (
    get_current_user_flexible,
    require_admin,
    require_staff,
)
from app.models.invoice import InvoiceStatus
from app.models.user import User, UserRole
from app.schemas.invoice import (
    AddPaymentRequest,
    InvoiceCreate,
    InvoiceListData,
    InvoiceListResponse,
    InvoiceResponse,
    InvoiceResponseEnvelope,
    InvoiceStatusUpdate,
    InvoiceSummaryResponse,
    InvoiceUpdate,
)
from app.services import invoice_service
from app.services.invoice_service import (
    CustomerNotFoundError,
    InvoiceAlreadyExistsError,
    InvoiceNotFoundError,
    InvoiceStateError,
    JobNotFoundError,
    PaymentError,
    build_invoice_payload,
)

router = APIRouter(prefix="/api/v1/invoices", tags=["invoices"])


def _assert_not_technician(user: User) -> None:
    """Invoicing is office-only; technicians never see money."""
    if user.role == UserRole.TECHNICIAN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Technicians do not have access to invoices",
        )


async def _payload_or_404(invoice_id: str) -> dict:
    try:
        return await invoice_service.get_invoice_payload(invoice_id)
    except InvoiceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Collection routes
# ---------------------------------------------------------------------------


@router.get("", response_model=InvoiceListResponse, summary="List invoices")
@router.get("/", response_model=InvoiceListResponse, include_in_schema=False)
async def list_invoices(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    invoice_status: Optional[InvoiceStatus] = Query(
        None, alias="status", description="Filter by status"
    ),
    customer_id: Optional[str] = Query(None, description="Filter by customer"),
    date_from: Optional[datetime] = Query(
        None, description="Only invoices issued on or after this date"
    ),
    date_to: Optional[datetime] = Query(
        None, description="Only invoices issued on or before this date"
    ),
    overdue_only: bool = Query(False, description="Only invoices past their due date"),
    q: Optional[str] = Query(None, description="Search invoice number or customer name"),
    current_user: User = Depends(require_staff),
) -> InvoiceListResponse:
    """Return a paginated, filterable list of invoices."""
    _assert_not_technician(current_user)

    payloads, total = await invoice_service.list_invoices(
        page=page,
        page_size=page_size,
        status=invoice_status,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
        overdue_only=overdue_only,
        q=q,
    )

    return InvoiceListResponse(
        data=InvoiceListData(
            items=[InvoiceResponse.model_validate(payload) for payload in payloads],
            total=total,
            page=page,
            page_size=page_size,
        ),
        message=f"{total} invoice(s) found",
        success=True,
    )


@router.post(
    "",
    response_model=InvoiceResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Create an invoice",
)
@router.post(
    "/",
    response_model=InvoiceResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_invoice(
    payload: InvoiceCreate,
    current_user: User = Depends(require_staff),
) -> InvoiceResponseEnvelope:
    """Create an invoice with an auto-generated invoice number."""
    try:
        invoice, customer, job, quote = await invoice_service.create_invoice(
            payload,
            user_id=current_user.id,
        )
    except CustomerNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return InvoiceResponseEnvelope(
        data=InvoiceResponse.model_validate(
            build_invoice_payload(invoice, customer, job, quote)
        ),
        message=f"Invoice {invoice.invoice_number} created successfully",
        success=True,
    )


@router.post(
    "/from-job/{job_id}",
    response_model=InvoiceResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Create an invoice from a job",
)
async def create_invoice_from_job(
    job_id: str,
    current_user: User = Depends(require_staff),
) -> InvoiceResponseEnvelope:
    """Raise a draft invoice against a job, pulling in its quoted pricing."""
    try:
        invoice, customer, job, quote = await invoice_service.create_invoice_from_job(
            job_id,
            user_id=current_user.id,
        )
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvoiceAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return InvoiceResponseEnvelope(
        data=InvoiceResponse.model_validate(
            build_invoice_payload(invoice, customer, job, quote)
        ),
        message=f"Invoice {invoice.invoice_number} raised for job {job.job_number if job else ''}".strip(),
        success=True,
    )


# Declared before /{invoice_id} so "summary" is never read as an id.
@router.get(
    "/summary",
    response_model=InvoiceSummaryResponse,
    summary="Invoicing summary for the dashboard",
)
async def get_invoice_summary(
    current_user: User = Depends(require_staff),
) -> InvoiceSummaryResponse:
    """Aggregate totals: invoiced, paid, outstanding and overdue."""
    _assert_not_technician(current_user)

    summary = await invoice_service.get_dashboard_summary()
    return InvoiceSummaryResponse(
        data=summary,
        message="Invoice summary retrieved",
        success=True,
    )


# ---------------------------------------------------------------------------
# Item routes
# ---------------------------------------------------------------------------


@router.get(
    "/{invoice_id}",
    response_model=InvoiceResponseEnvelope,
    summary="Get an invoice by id",
)
async def get_invoice(
    invoice_id: str,
    current_user: User = Depends(require_staff),
) -> InvoiceResponseEnvelope:
    """Fetch a single invoice with its line items and payments."""
    _assert_not_technician(current_user)

    payload = await _payload_or_404(invoice_id)
    return InvoiceResponseEnvelope(
        data=InvoiceResponse.model_validate(payload),
        message="Invoice retrieved",
        success=True,
    )


@router.put(
    "/{invoice_id}",
    response_model=InvoiceResponseEnvelope,
    summary="Update a draft or sent invoice",
)
async def update_invoice(
    invoice_id: str,
    payload: InvoiceUpdate,
    _current_user: User = Depends(require_staff),
) -> InvoiceResponseEnvelope:
    """Update the line items and details. Allowed while draft or sent."""
    try:
        invoice, customer, job, quote = await invoice_service.update_invoice(invoice_id, payload)
    except InvoiceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvoiceStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return InvoiceResponseEnvelope(
        data=InvoiceResponse.model_validate(
            build_invoice_payload(invoice, customer, job, quote)
        ),
        message="Invoice updated successfully",
        success=True,
    )


@router.patch(
    "/{invoice_id}/status",
    response_model=InvoiceResponseEnvelope,
    summary="Update invoice status",
)
async def update_invoice_status(
    invoice_id: str,
    payload: InvoiceStatusUpdate,
    current_user: User = Depends(require_staff),
) -> InvoiceResponseEnvelope:
    """Move an invoice through its lifecycle."""
    if payload.status == InvoiceStatus.CANCELLED and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin can cancel an invoice",
        )

    try:
        invoice, customer, job, quote = await invoice_service.update_status(
            invoice_id,
            payload.status,
        )
    except InvoiceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvoiceStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return InvoiceResponseEnvelope(
        data=InvoiceResponse.model_validate(
            build_invoice_payload(invoice, customer, job, quote)
        ),
        message=f"Invoice marked as {invoice.status.value.replace('_', ' ')}",
        success=True,
    )


@router.post(
    "/{invoice_id}/payments",
    response_model=InvoiceResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment",
)
async def add_invoice_payment(
    invoice_id: str,
    payload: AddPaymentRequest,
    current_user: User = Depends(require_staff),
) -> InvoiceResponseEnvelope:
    """Record money received against an invoice."""
    try:
        invoice, _customer, _job, _quote = await invoice_service.add_payment(
            invoice_id,
            payload,
            user_id=current_user.id,
        )
    except InvoiceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvoiceStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except PaymentError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    payload_out = await invoice_service.get_invoice_payload(invoice.id)
    return InvoiceResponseEnvelope(
        data=InvoiceResponse.model_validate(payload_out),
        message=f"Payment recorded. Balance due ${invoice.amount_due:,.2f}",
        success=True,
    )


@router.get(
    "/{invoice_id}/pdf",
    summary="Download an invoice as PDF",
    response_class=StreamingResponse,
)
async def download_invoice_pdf(
    invoice_id: str,
    current_user: User = Depends(get_current_user_flexible),
) -> StreamingResponse:
    """Render the invoice as an A4 PDF and stream it back.

    Accepts the access token as a `?token=` query parameter so an
    `<a download>` link can pull the file without an Authorization header.
    """
    _assert_not_technician(current_user)

    try:
        pdf_bytes, invoice_number = await invoice_service.generate_invoice_pdf(invoice_id)
    except InvoiceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    filename = f"invoice-{invoice_number}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.delete(
    "/{invoice_id}",
    response_model=InvoiceResponseEnvelope,
    summary="Delete a draft invoice",
)
async def delete_invoice(
    invoice_id: str,
    _current_user: User = Depends(require_admin),
) -> InvoiceResponseEnvelope:
    """Permanently delete a draft invoice."""
    try:
        invoice = await invoice_service.delete_invoice(invoice_id)
    except InvoiceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvoiceStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return InvoiceResponseEnvelope(
        data=InvoiceResponse.model_validate(build_invoice_payload(invoice)),
        message=f"Invoice {invoice.invoice_number} deleted",
        success=True,
    )
