"""Sending quotes, invoices and inspection reports to customers by email.

Two ways to send, chosen in Settings:

* Microsoft 365, through the Microsoft Graph API with an app registration.
  This is what Microsoft recommends now that password-based SMTP is being
  retired for Microsoft 365 mailboxes.
* SMTP, for any other email provider.

Every problem is turned into a plain-English `EmailError`, because the person
seeing it is running a pest control business, not a mail server.
"""

import asyncio
import base64
import hashlib
import html
import logging
import re
import smtplib
import socket
import ssl
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.utils import format_datetime, formataddr, formatdate, make_msgid
from typing import Dict, List, Optional, Tuple

import httpx
from beanie import PydanticObjectId
from pydantic import BaseModel, Field

from app.core.secrets import decrypt_secret
from app.models.company_settings import CompanySettings, EmailProvider, EmailTemplates, SmtpSecurity
from app.models.email_log import MAX_KEPT_ATTACHMENT, EmailLog
from app.models.user import User

logger = logging.getLogger(__name__)

GRAPH_URL = "https://graph.microsoft.com/v1.0"
LOGIN_URL = "https://login.microsoftonline.com"

#: Graph's sendMail takes attachments inline up to about 3 MB; bigger ones
#: are uploaded in pieces first.
GRAPH_INLINE_LIMIT = 3 * 1024 * 1024
GRAPH_CHUNK = 320 * 1024 * 10  # upload pieces must be multiples of 320 KiB

#: How long to wait on a mail server or Microsoft before giving up, in seconds.
TIMEOUT = 30

#: The kinds of document that can be emailed.
DOCUMENT_KINDS = ("quote", "invoice", "report")

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")

#: Microsoft access tokens, reused until shortly before they expire.
_token_cache: Dict[Tuple[str, str], Tuple[str, float]] = {}


class EmailLogSummary(BaseModel):
    """An email record without its attachment, for listing."""

    id: PydanticObjectId = Field(alias="_id")
    document_type: str
    document_id: PydanticObjectId
    document_number: str
    status: str = "sent"
    error: Optional[str] = None
    from_address: Optional[str] = None
    to: List[str] = []
    cc: List[str] = []
    bcc: List[str] = []
    subject: str
    attachment_name: Optional[str] = None
    attachment_size: int = 0
    provider: Optional[str] = None
    sent_by_name: Optional[str] = None
    sent_at: datetime


class EmailError(Exception):
    """An email could not be sent. The message says why, and what to do."""


@dataclass
class Attachment:
    filename: str
    content: bytes
    content_type: str = "application/pdf"


@dataclass
class OutgoingEmail:
    to: List[str]
    subject: str
    body: str  # plain text; an HTML version is made from it
    cc: List[str] = field(default_factory=list)
    attachments: List[Attachment] = field(default_factory=list)


@dataclass
class SendReceipt:
    """What the provider said when it accepted an email, kept as evidence."""

    provider: str
    message_id: Optional[str] = None
    reference: Optional[str] = None


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def render(template: str, context: Dict[str, str]) -> str:
    """Fill in {placeholders}. Unknown ones are left as typed, so a typo shows."""
    return _PLACEHOLDER.sub(lambda match: context.get(match.group(1), match.group(0)), template)


def _html_body(text: str, settings: CompanySettings) -> str:
    """A simple HTML version of the message, so it reads well in any mail app."""
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text.strip()) if part.strip()]
    content = "".join(
        f'<p style="margin:0 0 14px">{html.escape(part).replace(chr(10), "<br>")}</p>'
        for part in paragraphs
    )
    footer = " · ".join(
        html.escape(part)
        for part in (settings.company_name, settings.phone, settings.email, settings.website)
        if part
    )
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;'
        'color:#0f172a;max-width:600px">'
        f"{content}"
        '<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #e2e8f0;'
        f'font-size:12px;color:#64748b">{footer}</p>'
        "</div>"
    )


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------


def _sender(settings: CompanySettings) -> Tuple[str, str]:
    """(from name, from address) for outgoing mail."""
    address = settings.smtp_from_email or (
        settings.m365_mailbox if settings.email_provider == EmailProvider.MICROSOFT_365 else None
    )
    if not address:
        raise EmailError("Add the address emails are sent from, in Settings > Email.")
    return settings.smtp_from_name or settings.company_name, address


async def send(
    settings: CompanySettings,
    email: OutgoingEmail,
    *,
    http_transport: Optional[httpx.AsyncBaseTransport] = None,
) -> SendReceipt:
    """Send one email with the provider chosen in Settings, returning its receipt."""
    if not email.to:
        raise EmailError("Add at least one address to send to.")

    if settings.email_provider == EmailProvider.MICROSOFT_365:
        return await _send_microsoft_365(settings, email, http_transport)
    if settings.email_provider == EmailProvider.SMTP:
        return await asyncio.to_thread(_send_smtp, settings, email)
    raise EmailError(
        "Email isn't set up yet. PestBase configures it for every client under "
        "Platform > Settings."
    )


# --- SMTP -----------------------------------------------------------------


def _explain_smtp(exc: Exception, settings: CompanySettings) -> str:
    """What an SMTP failure means, in plain English."""
    host = settings.smtp_host or ""
    detail = ""
    if isinstance(exc, smtplib.SMTPResponseException):
        detail = exc.smtp_error.decode(errors="replace") if isinstance(exc.smtp_error, bytes) else str(exc.smtp_error)
    microsoft = "office365" in host or "outlook" in host

    if isinstance(exc, smtplib.SMTPAuthenticationError):
        message = "The mail server refused the username or password."
        if microsoft:
            message += (
                " With Microsoft 365, the username must be the mailbox itself (such as "
                "info@yourdomain), not an alias, and SMTP AUTH must be switched on for that "
                "mailbox. Microsoft is also switching password sign-in off for SMTP, so the "
                "Microsoft 365 option in Settings > Email is the better choice."
            )
        return f"{message} (Server said: {detail})" if detail else message

    if "SendAsDenied" in detail or "5.2.252" in detail or isinstance(exc, smtplib.SMTPSenderRefused):
        address = settings.smtp_from_email or "that address"
        return (
            f"The mail server won't let this account send as {address}. Either send from the "
            "mailbox's own address, or allow it to send from this alias (in Microsoft 365, an "
            f"admin turns on 'send from aliases'). (Server said: {detail})"
        )

    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        refused = ", ".join(exc.recipients)
        return f"The mail server refused these addresses: {refused}."

    if isinstance(exc, (socket.gaierror, ConnectionRefusedError, TimeoutError, socket.timeout)):
        return (
            f"Couldn't reach the mail server {host} on port {settings.smtp_port or 587}. "
            "Check the server name and port."
        )

    if isinstance(exc, ssl.SSLError):
        return (
            "The secure connection to the mail server failed. Port 587 normally uses "
            "STARTTLS and port 465 uses SSL; check the security setting matches the port."
        )

    return f"The mail server couldn't send the email: {detail or exc}"


def _deliver(server: smtplib.SMTP, sender: str, recipients: List[str], message: EmailMessage) -> str:
    """Hand the message to the server step by step, keeping its final reply.

    That reply (such as "250 2.0.0 OK queued as 4Xy9") is the server's own
    record of accepting the email, so it is kept as evidence.
    """
    code, response = server.mail(sender)
    if code != 250:
        raise smtplib.SMTPSenderRefused(code, response, sender)
    refused = {}
    for recipient in recipients:
        code, response = server.rcpt(recipient)
        if code not in (250, 251):
            refused[recipient] = (code, response)
    if refused:
        server.rset()
        raise smtplib.SMTPRecipientsRefused(refused)
    code, response = server.data(message.as_bytes(policy=policy.SMTP))
    if code != 250:
        server.rset()
        raise smtplib.SMTPDataError(code, response)
    return f"{code} {response.decode(errors='replace')}"


def _send_smtp(settings: CompanySettings, email: OutgoingEmail) -> SendReceipt:
    if not settings.smtp_host:
        raise EmailError("Add the SMTP server name in Settings > Email.")

    from_name, from_address = _sender(settings)
    message = EmailMessage()
    message["Subject"] = email.subject
    message["From"] = formataddr((from_name, from_address))
    message["To"] = ", ".join(email.to)
    if email.cc:
        message["Cc"] = ", ".join(email.cc)
    if settings.email_reply_to:
        message["Reply-To"] = settings.email_reply_to
    message["Date"] = formatdate(localtime=True)
    message_id = make_msgid(domain=from_address.split("@")[-1])
    message["Message-ID"] = message_id
    message.set_content(email.body)
    message.add_alternative(_html_body(email.body, settings), subtype="html")
    for attachment in email.attachments:
        maintype, subtype = attachment.content_type.split("/", 1)
        message.add_attachment(
            attachment.content, maintype=maintype, subtype=subtype, filename=attachment.filename
        )

    recipients = email.to + email.cc + ([settings.email_bcc] if settings.email_bcc else [])
    security = settings.smtp_security or SmtpSecurity.STARTTLS
    port = settings.smtp_port or (465 if security == SmtpSecurity.SSL else 587)
    context = ssl.create_default_context()

    try:
        if security == SmtpSecurity.SSL:
            server = smtplib.SMTP_SSL(settings.smtp_host, port, timeout=TIMEOUT, context=context)
        else:
            server = smtplib.SMTP(settings.smtp_host, port, timeout=TIMEOUT)
        with server:
            server.ehlo()
            if security == SmtpSecurity.STARTTLS:
                server.starttls(context=context)
                server.ehlo()
            if settings.smtp_username:
                password = decrypt_secret(settings.smtp_password_encrypted)
                if password is None:
                    raise EmailError("Enter the email password in Settings > Email.")
                server.login(settings.smtp_username, password)
            reply = _deliver(server, from_address, recipients, message)
        return SendReceipt(provider="smtp", message_id=message_id, reference=reply)
    except EmailError:
        raise
    except (smtplib.SMTPException, OSError) as exc:
        logger.warning("SMTP send failed: %s", exc)
        raise EmailError(_explain_smtp(exc, settings)) from exc


# --- Microsoft 365 --------------------------------------------------------


def _graph_error(response: httpx.Response) -> Tuple[str, str]:
    """(code, message) from a Microsoft error response."""
    try:
        body = response.json()
    except ValueError:
        return "", response.text[:300]
    if "error" in body and isinstance(body["error"], dict):
        return body["error"].get("code", ""), body["error"].get("message", "")
    return body.get("error", ""), body.get("error_description", "")


def _explain_graph(response: httpx.Response, settings: CompanySettings) -> str:
    code, detail = _graph_error(response)
    mailbox = settings.m365_mailbox or "the mailbox"
    if "AADSTS7000215" in detail or "AADSTS7000222" in detail:
        return "Microsoft rejected the client secret: it's wrong or has expired. Create a new one and save it in Settings > Email."
    if "AADSTS700016" in detail:
        return "Microsoft doesn't recognise the application (client) ID in this tenant. Check both IDs in Settings > Email."
    if "AADSTS90002" in detail or "AADSTS900023" in detail:
        return "Microsoft doesn't recognise the tenant ID. Use the Directory (tenant) ID, or your domain name."
    if code == "ErrorSendAsDenied" or "SendAs" in code:
        return (
            f"Microsoft won't let {mailbox} send as {settings.smtp_from_email}. Either make the "
            "From address the mailbox itself, turn that address into a shared mailbox and send "
            "from it, or ask your Microsoft 365 admin to allow sending from aliases."
        )
    if response.status_code == 403 or code in ("ErrorAccessDenied", "Authorization_RequestDenied"):
        return (
            "Microsoft refused: the app doesn't have permission to send mail. In the app "
            "registration, add the Microsoft Graph 'Mail.Send' application permission and "
            f"click 'Grant admin consent'. ({detail})"
        )
    if response.status_code == 404 or code in ("ErrorInvalidUser", "ResourceNotFound", "MailboxNotEnabledForRESTAPI"):
        return (
            f"Microsoft can't find the mailbox {mailbox}. Use the mailbox's own address "
            "(not an alias), and check it has an Exchange Online licence or is a shared mailbox."
        )
    if response.status_code == 401:
        return f"Microsoft didn't accept the app's sign-in. Check the tenant ID, client ID and secret. ({detail})"
    return f"Microsoft couldn't send the email: {detail or response.status_code}"


async def _graph_token(settings: CompanySettings, client: httpx.AsyncClient) -> str:
    tenant = settings.m365_tenant_id
    client_id = settings.m365_client_id
    secret = decrypt_secret(settings.m365_client_secret_encrypted)
    if not (tenant and client_id and secret):
        raise EmailError(
            "Microsoft 365 needs the tenant ID, the application (client) ID and a client "
            "secret. Add them in Settings > Email."
        )

    key = (tenant, client_id)
    cached = _token_cache.get(key)
    if cached and cached[1] > time.time() + 60:
        return cached[0]

    response = await client.post(
        f"{LOGIN_URL}/{tenant}/oauth2/v2.0/token",
        data={
            "client_id": client_id,
            "client_secret": secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
    )
    if response.status_code != 200:
        raise EmailError(_explain_graph(response, settings))
    body = response.json()
    _token_cache[key] = (body["access_token"], time.time() + int(body.get("expires_in", 3600)))
    return body["access_token"]


def _graph_message(settings: CompanySettings, email: OutgoingEmail) -> dict:
    from_name, from_address = _sender(settings)
    recipients = lambda addresses: [{"emailAddress": {"address": address}} for address in addresses]  # noqa: E731
    message: dict = {
        "subject": email.subject,
        "body": {"contentType": "HTML", "content": _html_body(email.body, settings)},
        "toRecipients": recipients(email.to),
        "from": {"emailAddress": {"address": from_address, "name": from_name}},
    }
    if email.cc:
        message["ccRecipients"] = recipients(email.cc)
    if settings.email_bcc:
        message["bccRecipients"] = recipients([settings.email_bcc])
    if settings.email_reply_to:
        message["replyTo"] = recipients([settings.email_reply_to])
    return message


def _graph_reference(response: httpx.Response) -> str:
    """Microsoft's own id for a request, which its support can trace."""
    request_id = response.headers.get("request-id") or response.headers.get("client-request-id")
    reference = f"Accepted by Microsoft 365 (HTTP {response.status_code})"
    return f"{reference}, request id {request_id}" if request_id else reference


async def _send_microsoft_365(
    settings: CompanySettings,
    email: OutgoingEmail,
    transport: Optional[httpx.AsyncBaseTransport],
) -> SendReceipt:
    mailbox = settings.m365_mailbox
    if not mailbox:
        raise EmailError("Add the mailbox to send from, in Settings > Email.")

    try:
        async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT) as client:
            token = await _graph_token(settings, client)
            headers = {"Authorization": f"Bearer {token}"}
            user_url = f"{GRAPH_URL}/users/{mailbox}"
            message = _graph_message(settings, email)
            total = sum(len(attachment.content) for attachment in email.attachments)

            if total <= GRAPH_INLINE_LIMIT:
                message["attachments"] = [
                    {
                        "@odata.type": "#microsoft.graph.fileAttachment",
                        "name": attachment.filename,
                        "contentType": attachment.content_type,
                        "contentBytes": base64.b64encode(attachment.content).decode(),
                    }
                    for attachment in email.attachments
                ]
                response = await client.post(
                    f"{user_url}/sendMail",
                    headers=headers,
                    json={"message": message, "saveToSentItems": True},
                )
                if response.status_code != 202:
                    raise EmailError(_explain_graph(response, settings))
                return SendReceipt(provider="microsoft365", reference=_graph_reference(response))

            # Large attachments: save a draft, upload each file in pieces, then send it.
            response = await client.post(f"{user_url}/messages", headers=headers, json=message)
            if response.status_code != 201:
                raise EmailError(_explain_graph(response, settings))
            draft = response.json()
            message_url = f"{user_url}/messages/{draft['id']}"

            for attachment in email.attachments:
                size = len(attachment.content)
                response = await client.post(
                    f"{message_url}/attachments/createUploadSession",
                    headers=headers,
                    json={
                        "AttachmentItem": {
                            "attachmentType": "file",
                            "name": attachment.filename,
                            "size": size,
                            "contentType": attachment.content_type,
                        }
                    },
                )
                if response.status_code != 201:
                    raise EmailError(_explain_graph(response, settings))
                upload_url = response.json()["uploadUrl"]
                for start in range(0, size, GRAPH_CHUNK):
                    chunk = attachment.content[start : start + GRAPH_CHUNK]
                    end = start + len(chunk) - 1
                    # The upload URL carries its own authorisation.
                    response = await client.put(
                        upload_url,
                        content=chunk,
                        headers={
                            "Content-Range": f"bytes {start}-{end}/{size}",
                            "Content-Type": "application/octet-stream",
                        },
                    )
                    if response.status_code not in (200, 201):
                        raise EmailError(_explain_graph(response, settings))

            response = await client.post(f"{message_url}/send", headers=headers)
            if response.status_code != 202:
                raise EmailError(_explain_graph(response, settings))
            return SendReceipt(
                provider="microsoft365",
                message_id=draft.get("internetMessageId"),
                reference=_graph_reference(response),
            )
    except EmailError:
        raise
    except httpx.HTTPError as exc:
        logger.warning("Microsoft Graph send failed: %s", exc)
        raise EmailError("Couldn't reach Microsoft to send the email. Check the internet connection and try again.") from exc


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


def _money(value: Optional[float]) -> str:
    return f"£{float(value or 0):,.2f}"


def _date(value: Optional[datetime]) -> str:
    return value.strftime("%d %B %Y").lstrip("0") if value else ""


def _address(address: Optional[dict]) -> str:
    if not address:
        return ""
    return ", ".join(
        str(address.get(part)).strip() for part in ("street", "city", "postcode") if address.get(part)
    )


async def _document(kind: str, document_id: str) -> dict:
    """The document's number, customer, PDF maker and template placeholders.

    Imported lazily: the document services import models that import this one's
    neighbours, and nothing here is needed until an email is actually sent.
    """
    from app.services import invoice_service, job_service, quote_service  # noqa: PLC0415

    if kind == "quote":
        quote, customer = await quote_service.get_quote(document_id)
        return {
            "number": quote.quote_number,
            "customer": customer,
            "pdf": lambda: quote_service.generate_pdf(quote.id),
            "filename": f"Quote {quote.quote_number}.pdf",
            "context": {
                "quote_number": quote.quote_number,
                "quote_total": _money(quote.total),
                "valid_until": _date(quote.valid_until) or "30 days from today",
            },
            "record": quote,
        }

    if kind == "invoice":
        invoice, customer, job, _quote = await invoice_service.get_invoice(document_id)
        job_number = ""
        if job is not None:
            from app.models.booking import Booking  # noqa: PLC0415

            booking = await Booking.get(job.booking_id) if job.booking_id else None
            job_number = booking.booking_number if booking else job.job_number
        return {
            "number": invoice.invoice_number,
            "customer": customer,
            "pdf": lambda: invoice_service.generate_invoice_pdf(invoice.id),
            "filename": f"Invoice {invoice.invoice_number}.pdf",
            "context": {
                "invoice_number": invoice.invoice_number,
                "invoice_total": _money(invoice.total),
                "amount_due": _money(invoice.amount_due),
                "due_date": _date(invoice.due_date),
                "job_number": job_number,
            },
            "record": invoice,
        }

    if kind == "report":
        job, customer, _technician, booking = await job_service.get_job(document_id)
        site = _address(job.service_address) or (customer.address.one_line() if customer else "")
        return {
            "number": job.job_number,
            "customer": customer,
            "pdf": lambda: job_service.generate_report_pdf(job.id),
            "filename": f"Report {job.job_number}.pdf",
            "context": {
                "report_number": job.job_number,
                "job_number": booking.booking_number if booking else job.job_number,
                "service_date": _date(job.actual_start or job.scheduled_start),
                "service_type": job.service_type,
                "site_address": site,
            },
            "record": job,
        }

    raise EmailError(f"Only {', '.join(DOCUMENT_KINDS)} can be emailed.")


def _context(settings: CompanySettings, document: dict, user: Optional[User]) -> Dict[str, str]:
    customer = document["customer"]
    return {
        "customer_name": customer.full_name if customer else "Customer",
        "company_name": settings.company_name,
        "company_phone": settings.phone or "",
        "company_email": settings.email or "",
        # None when the app sent it rather than a person, which is what the
        # automatic payment reminder does. Signing off as the company is the
        # honest version of "from nobody".
        "sender_name": user.full_name if user else settings.company_name,
        **document["context"],
    }


def _oid(value: str):
    from beanie import PydanticObjectId  # noqa: PLC0415

    try:
        return PydanticObjectId(value)
    except Exception:  # noqa: BLE001 - not an object id
        return None


#: The attachment itself is only loaded when asked for.
_WITHOUT_CONTENT = {"attachment_content": 0}


async def history(kind: str, document_id: str) -> List[EmailLog]:
    """Emails sent (or attempted) for a document, newest first."""
    oid = _oid(document_id)
    if oid is None:
        return []
    return await (
        EmailLog.find({"document_type": kind, "document_id": oid})
        .sort("-sent_at")
        .project(EmailLogSummary)
        .to_list()
    )


async def customer_history(customer_id: str) -> List[EmailLog]:
    """Every email sent (or attempted) to a customer, newest first."""
    oid = _oid(customer_id)
    if oid is None:
        return []
    return await EmailLog.find({"customer_id": oid}).sort("-sent_at").project(EmailLogSummary).to_list()


async def get_log(log_id: str) -> Optional[EmailLog]:
    """One email record in full, including the attachment as sent."""
    oid = _oid(log_id)
    return await EmailLog.get(oid) if oid else None


def as_eml(log: EmailLog) -> bytes:
    """The recorded email rebuilt as a .eml file, which opens in Outlook or any mail app.

    Rebuilt from the record: the addresses, subject, message and attachment
    are exactly those sent; mail-server headers added in transit are not.
    """
    message = EmailMessage()
    message["Subject"] = log.subject
    message["From"] = formataddr((log.from_name or "", log.from_address or ""))
    message["To"] = ", ".join(log.to)
    if log.cc:
        message["Cc"] = ", ".join(log.cc)
    if log.reply_to:
        message["Reply-To"] = log.reply_to
    message["Date"] = format_datetime(log.sent_at.replace(tzinfo=timezone.utc))
    if log.message_id:
        message["Message-ID"] = log.message_id
    message["X-PestBase-Record"] = (
        f"{log.status}; {log.provider or 'unknown provider'}; {log.provider_reference or 'no reference'}"
    )
    message.set_content(log.body)
    if log.attachment_content:
        maintype, subtype = (log.attachment_type or "application/pdf").split("/", 1)
        message.add_attachment(
            log.attachment_content,
            maintype=maintype,
            subtype=subtype,
            filename=log.attachment_name or "attachment.pdf",
        )
    return message.as_bytes(policy=policy.SMTP)


async def _sending_settings():
    """This client's settings, with the platform's mail transport over the top.

    Which provider and server email goes through is the platform's setting now;
    the reply-to address, the office BCC, the templates and the company name in
    the body are still this client's. Everything below reads one object, as it
    always did - see app.services.platform_settings_service.
    """
    from app.services.company_settings_service import get_settings  # noqa: PLC0415
    from app.services.platform_settings_service import sending_config  # noqa: PLC0415

    return await sending_config(await get_settings())


async def compose(kind: str, document_id: str, user: User) -> dict:
    """A ready-to-send email for a document, from its template."""
    settings = await _sending_settings()
    document = await _document(kind, document_id)
    template = getattr(settings.email_templates or EmailTemplates(), kind)
    context = _context(settings, document, user)
    customer = document["customer"]
    return {
        "customer_id": str(customer.id) if customer else None,
        "customer_name": customer.full_name if customer else None,
        "customer_has_email": bool(customer and customer.email),
        "to": [customer.email] if customer and customer.email else [],
        "cc": [],
        "subject": render(template.subject, context),
        "body": render(template.body, context),
        "attachment_name": document["filename"],
        "configured": settings.email_provider != EmailProvider.NONE,
        "history": await history(kind, document_id),
    }


async def send_document(
    kind: str,
    document_id: str,
    user: User,
    to: List[str],
    cc: List[str],
    subject: str,
    body: str,
    *,
    save_to_customer: bool = False,
    http_transport: Optional[httpx.AsyncBaseTransport] = None,
) -> EmailLog:
    """Email a document as a PDF, mark it sent, and keep a full record of it.

    The record is written whether the provider accepts the email or not, so
    a failed attempt is on file too. `save_to_customer` stores the first
    address on a customer who had none.
    """
    from app.models.invoice import InvoiceStatus  # noqa: PLC0415
    from app.models.job import JobStatus  # noqa: PLC0415
    from app.models.quote import QuoteStatus  # noqa: PLC0415
    from app.services import invoice_service, quote_service  # noqa: PLC0415
    settings = await _sending_settings()
    document = await _document(kind, document_id)
    record = document["record"]

    if kind == "report" and record.status != JobStatus.COMPLETED:
        raise EmailError("Complete the job before emailing its report.")
    if kind == "invoice" and record.status == InvoiceStatus.CANCELLED:
        raise EmailError("A cancelled invoice can't be emailed.")

    pdf, _number = await document["pdf"]()
    customer = document["customer"]
    from_name, from_address = _sender(settings)
    log = EmailLog(
        document_type=kind,
        document_id=record.id,
        document_number=document["number"],
        customer_id=customer.id if customer else None,
        from_address=from_address,
        from_name=from_name,
        reply_to=settings.email_reply_to,
        to=to,
        cc=cc,
        bcc=[settings.email_bcc] if settings.email_bcc else [],
        subject=subject,
        body=body,
        attachment_name=document["filename"],
        attachment_type="application/pdf",
        attachment_size=len(pdf),
        attachment_sha256=hashlib.sha256(pdf).hexdigest(),
        attachment_content=pdf if len(pdf) <= MAX_KEPT_ATTACHMENT else None,
        provider=settings.email_provider.value,
        sent_by=user.id,
        sent_by_name=user.full_name,
    )

    try:
        receipt = await send(
            settings,
            OutgoingEmail(
                to=to,
                cc=cc,
                subject=subject,
                body=body,
                attachments=[Attachment(document["filename"], pdf)],
            ),
            http_transport=http_transport,
        )
    except EmailError as exc:
        log.status = "failed"
        log.error = str(exc)
        await log.insert()
        raise

    log.message_id = receipt.message_id
    log.provider_reference = receipt.reference
    await log.insert()

    if save_to_customer and customer is not None and not customer.email and to:
        customer.email = to[0]
        customer.touch()
        await customer.save()

    # A draft that has gone to the customer is now sent.
    if kind == "quote" and record.status == QuoteStatus.DRAFT:
        await quote_service.update_status(record.id, QuoteStatus.SENT)
    if kind == "invoice" and record.status == InvoiceStatus.DRAFT:
        await invoice_service.update_status(record.id, InvoiceStatus.SENT)

    logger.info("Emailed %s %s to %s", kind, document["number"], ", ".join(to))
    return log


def _days_until(due: datetime) -> str:
    """Reads inside a sentence: "in 3 days", "tomorrow", "today"."""
    days = (due.date() - datetime.utcnow().date()).days
    if days <= 0:
        return "today"
    if days == 1:
        return "tomorrow"
    return f"in {days} days"


async def send_payment_reminder(settings: CompanySettings, invoice) -> Optional[EmailLog]:
    """Email the customer that an unpaid invoice is coming due. Never raises.

    Returns the log when an email was attempted, or None when the customer has
    no address - the caller leaves that invoice unstamped, so the reminder can
    still go if somebody fills the address in later.

    A refused email is logged as failed and the invoice is stamped anyway. The
    office already gets the "due soon" alert in the app, and the alternative is
    retrying on every health check for as long as the mail server is unhappy.

    Nothing is attached. The customer has the invoice; this is a nudge.
    """
    document = await _document("invoice", str(invoice.id))
    customer = document["customer"]
    if customer is None or not customer.email:
        return None

    template = (settings.email_templates or EmailTemplates()).payment_reminder
    context = _context(settings, document, None)
    context["days_until_due"] = _days_until(invoice.due_date)

    subject = render(template.subject, context)
    body = re.sub(r"\n{3,}", "\n\n", render(template.body, context)).strip()
    from_name, from_address = _sender(settings)

    log = EmailLog(
        document_type="invoice",
        document_id=invoice.id,
        document_number=invoice.invoice_number,
        customer_id=customer.id,
        from_address=from_address,
        from_name=from_name,
        reply_to=settings.email_reply_to,
        to=[customer.email],
        bcc=[settings.email_bcc] if settings.email_bcc else [],
        subject=subject,
        body=body,
        provider=settings.email_provider.value,
        sent_by=None,
        sent_by_name="Automatic payment reminder",
    )

    try:
        receipt = await send(settings, OutgoingEmail(to=[customer.email], subject=subject, body=body))
    except EmailError as exc:
        log.status = "failed"
        log.error = str(exc)
        await log.insert()
        logger.warning("Payment reminder for %s refused: %s", invoice.invoice_number, exc)
        return log

    log.message_id = receipt.message_id
    log.provider_reference = receipt.reference
    await log.insert()
    logger.info("Reminded %s about invoice %s", customer.email, invoice.invoice_number)
    return log


async def send_platform_test(
    to: str,
    user: User,
    *,
    http_transport: Optional[httpx.AsyncBaseTransport] = None,
) -> None:
    """Send a test email using only the platform's mail settings.

    For the platform page, where there is no client in scope. An unsaved
    CompanySettings supplies the defaults a message needs - a name for the body,
    no reply-to, no BCC - so this proves the transport works without borrowing
    any client's configuration.
    """
    from app.services.platform_settings_service import sending_config  # noqa: PLC0415

    settings = await sending_config(CompanySettings(company_name="PestBase"))
    await send(
        settings,
        OutgoingEmail(
            to=[to],
            subject="Test email from PestBase",
            body=(
                f"This is a test of PestBase's platform email settings, sent by "
                f"{user.full_name}.\n\nIf you are reading this, sending works for "
                f"every client.\n"
            ),
        ),
        http_transport=http_transport,
    )


async def send_test(
    to: str,
    user: User,
    *,
    http_transport: Optional[httpx.AsyncBaseTransport] = None,
) -> None:
    """Send a short test email with the saved settings."""
    settings = await _sending_settings()
    await send(
        settings,
        OutgoingEmail(
            to=[to],
            subject=f"Test email from {settings.company_name}",
            body=(
                f"This is a test email from PestBase, sent by {user.full_name}.\n\n"
                "If you're reading this, email is set up correctly: quotes, invoices and "
                "reports can now be emailed to customers."
            ),
        ),
        http_transport=http_transport,
    )
