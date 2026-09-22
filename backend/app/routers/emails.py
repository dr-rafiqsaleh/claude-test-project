"""Emailing quotes, invoices and reports to customers.

Office staff and admins only: technicians have no access to money, and the
office decides what goes to the customer.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.dependencies import require_staff
from app.models.user import User
from app.schemas.email import (
    DocumentKind,
    EmailDraft,
    EmailDraftEnvelope,
    EmailHistoryEnvelope,
    EmailLogEnvelope,
    EmailLogResponse,
    SendDocumentEmail,
)
from app.services import email_service
from app.services.email_service import EmailError
from app.services.invoice_service import InvoiceNotFoundError
from app.services.job_service import JobNotFoundError
from app.services.quote_service import QuoteNotFoundError

router = APIRouter(prefix="/api/v1/emails", tags=["emails"])

NOT_FOUND = (QuoteNotFoundError, InvoiceNotFoundError, JobNotFoundError)


@router.get("/compose", response_model=EmailDraftEnvelope, summary="Prepare an email for a document")
async def compose_email(
    kind: DocumentKind = Query(...),
    id: str = Query(..., min_length=1),
    current_user: User = Depends(require_staff),
) -> EmailDraftEnvelope:
    """The email a document would be sent with: recipient, subject and message from its template."""
    try:
        draft = await email_service.compose(kind, id, current_user)
    except NOT_FOUND as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmailError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    draft["history"] = [EmailLogResponse.model_validate(log.model_dump()) for log in draft["history"]]
    return EmailDraftEnvelope(data=EmailDraft(**draft), message="Email ready", success=True)


@router.post("/send", response_model=EmailLogEnvelope, summary="Email a document to the customer")
async def send_email(
    payload: SendDocumentEmail,
    current_user: User = Depends(require_staff),
) -> EmailLogEnvelope:
    """Send the document as a PDF attachment. A draft quote or invoice becomes sent."""
    try:
        log = await email_service.send_document(
            payload.kind,
            payload.id,
            current_user,
            to=payload.to,
            cc=payload.cc,
            subject=payload.subject,
            body=payload.body,
        )
    except NOT_FOUND as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmailError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return EmailLogEnvelope(
        data=EmailLogResponse.model_validate(log.model_dump()),
        message=f"Emailed to {', '.join(log.to)}",
        success=True,
    )


@router.get("/history", response_model=EmailHistoryEnvelope, summary="Emails sent for a document")
async def email_history(
    kind: DocumentKind = Query(...),
    id: str = Query(..., min_length=1),
    _current_user: User = Depends(require_staff),
) -> EmailHistoryEnvelope:
    logs = await email_service.history(kind, id)
    return EmailHistoryEnvelope(
        data=[EmailLogResponse.model_validate(log.model_dump()) for log in logs],
        message="Email history retrieved",
        success=True,
    )
