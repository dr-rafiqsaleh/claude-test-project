"""Emailing quotes, invoices and reports to customers, and the record of it.

Office staff and admins only: technicians have no access to money, and the
office decides what goes to the customer. The record of each email can be
read and downloaded, never changed or deleted.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from app.core.dependencies import require_permission
from app.models.user import User
from app.schemas.email import (
    DocumentKind,
    EmailDraft,
    EmailDraftEnvelope,
    EmailHistoryEnvelope,
    EmailLogDetail,
    EmailLogDetailEnvelope,
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


def _listed(log) -> EmailLogResponse:
    return EmailLogResponse.model_validate(log.model_dump())


def _detail(log) -> EmailLogDetail:
    data = log.model_dump(exclude={"attachment_content"})
    data["attachment_kept"] = bool(log.attachment_content)
    return EmailLogDetail.model_validate(data)


@router.get("/compose", response_model=EmailDraftEnvelope, summary="Prepare an email for a document")
async def compose_email(
    kind: DocumentKind = Query(...),
    id: str = Query(..., min_length=1),
    current_user: User = Depends(require_permission("emails.send")),
) -> EmailDraftEnvelope:
    """The email a document would be sent with: recipient, subject and message from its template."""
    try:
        draft = await email_service.compose(kind, id, current_user)
    except NOT_FOUND as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmailError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    draft["history"] = [_listed(log) for log in draft["history"]]
    return EmailDraftEnvelope(data=EmailDraft(**draft), message="Email ready", success=True)


@router.post("/send", response_model=EmailLogEnvelope, summary="Email a document to the customer")
async def send_email(
    payload: SendDocumentEmail,
    current_user: User = Depends(require_permission("emails.send")),
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
            save_to_customer=payload.save_to_customer,
        )
    except NOT_FOUND as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmailError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return EmailLogEnvelope(data=_listed(log), message=f"Emailed to {', '.join(log.to)}", success=True)


@router.get("/history", response_model=EmailHistoryEnvelope, summary="Emails sent for a document")
async def email_history(
    kind: DocumentKind = Query(...),
    id: str = Query(..., min_length=1),
    _current_user: User = Depends(require_permission("emails.send")),
) -> EmailHistoryEnvelope:
    logs = await email_service.history(kind, id)
    return EmailHistoryEnvelope(
        data=[_listed(log) for log in logs],
        message="Email history retrieved",
        success=True,
    )


@router.get(
    "/customer/{customer_id}",
    response_model=EmailHistoryEnvelope,
    summary="Every email sent to a customer",
)
async def customer_email_history(
    customer_id: str,
    _current_user: User = Depends(require_permission("emails.send")),
) -> EmailHistoryEnvelope:
    logs = await email_service.customer_history(customer_id)
    return EmailHistoryEnvelope(
        data=[_listed(log) for log in logs],
        message="Email history retrieved",
        success=True,
    )


async def _log_or_404(log_id: str):
    log = await email_service.get_log(log_id)
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email record not found")
    return log


@router.get("/{log_id}", response_model=EmailLogDetailEnvelope, summary="The full record of one email")
async def email_record(
    log_id: str,
    _current_user: User = Depends(require_permission("emails.send")),
) -> EmailLogDetailEnvelope:
    log = await _log_or_404(log_id)
    return EmailLogDetailEnvelope(data=_detail(log), message="Email record retrieved", success=True)


@router.get("/{log_id}/attachment", summary="The attachment exactly as it was sent")
async def email_attachment(
    log_id: str,
    _current_user: User = Depends(require_permission("emails.send")),
) -> Response:
    log = await _log_or_404(log_id)
    if not log.attachment_content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This email's attachment was too large to keep; its fingerprint is on the record.",
        )
    return Response(
        content=log.attachment_content,
        media_type=log.attachment_type or "application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{log.attachment_name or "attachment.pdf"}"'},
    )


@router.get("/{log_id}/eml", summary="The email as a .eml file, for Outlook or any mail app")
async def email_eml(
    log_id: str,
    _current_user: User = Depends(require_permission("emails.send")),
) -> Response:
    log = await _log_or_404(log_id)
    stamp = log.sent_at.strftime("%Y-%m-%d %H%M")
    return Response(
        content=email_service.as_eml(log),
        media_type="message/rfc822",
        headers={"Content-Disposition": f'attachment; filename="Email {log.document_number} {stamp}.eml"'},
    )
