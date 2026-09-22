"""Email request/response schemas."""

import re
from datetime import datetime, timezone
from typing import List, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import ApiResponse

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

DocumentKind = Literal["quote", "invoice", "report"]


def _addresses(values: List[str]) -> List[str]:
    """Trim, drop blanks and duplicates, and refuse anything that isn't an address."""
    cleaned: List[str] = []
    for value in values:
        for part in re.split(r"[,;\s]+", value or ""):
            address = part.strip().lower()
            if not address:
                continue
            if not EMAIL_PATTERN.match(address):
                raise ValueError(f"'{address}' is not an email address")
            if address not in cleaned:
                cleaned.append(address)
    return cleaned


class EmailLogResponse(BaseModel):
    """One email sent (or attempted) for a document, as listed."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    document_type: str
    document_id: str
    document_number: str
    status: str = "sent"
    error: str | None = None
    from_address: str | None = None
    to: List[str]
    cc: List[str] = Field(default_factory=list)
    bcc: List[str] = Field(default_factory=list)
    subject: str
    attachment_name: str | None = None
    attachment_size: int = 0
    provider: str | None = None
    sent_by_name: str | None = None
    sent_at: datetime

    @field_validator("id", "document_id", mode="before")
    @classmethod
    def _to_str(cls, value: object) -> str:
        return str(value)

    @field_validator("sent_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class EmailLogDetail(EmailLogResponse):
    """The full record of one email: everything needed to show what was sent."""

    from_name: str | None = None
    reply_to: str | None = None
    body: str = ""
    attachment_type: str | None = None
    attachment_sha256: str | None = None
    attachment_kept: bool = False
    message_id: str | None = None
    provider_reference: str | None = None


class EmailDraft(BaseModel):
    """A ready-to-send email for a document, filled in from its template."""

    customer_id: str | None = None
    customer_name: str | None = None
    customer_has_email: bool = False
    to: List[str]
    cc: List[str] = Field(default_factory=list)
    subject: str
    body: str
    attachment_name: str
    configured: bool
    history: List[EmailLogResponse] = Field(default_factory=list)


class SendDocumentEmail(BaseModel):
    """Email a quote, invoice or report to the customer, with its PDF."""

    kind: DocumentKind
    id: str
    to: List[str] = Field(min_length=1, max_length=10)
    cc: List[str] = Field(default_factory=list, max_length=10)
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    #: For a customer with no email address saved: keep the first "to" address.
    save_to_customer: bool = False

    @field_validator("to", "cc")
    @classmethod
    def _check(cls, value: List[str]) -> List[str]:
        return _addresses(value)

    @field_validator("to")
    @classmethod
    def _need_one(cls, value: List[str]) -> List[str]:
        if not value:
            raise ValueError("Add at least one address to send to")
        return value


class TestEmailRequest(BaseModel):
    """Where to send a test email."""

    to: str = Field(min_length=3, max_length=200)

    @field_validator("to")
    @classmethod
    def _check(cls, value: str) -> str:
        cleaned = _addresses([value])
        if not cleaned:
            raise ValueError("Add an address to send the test to")
        return cleaned[0]


class EmailDraftEnvelope(ApiResponse[EmailDraft]):
    """Envelope for a composed email."""


class EmailLogEnvelope(ApiResponse[EmailLogResponse]):
    """Envelope for a sent email."""


class EmailHistoryEnvelope(ApiResponse[List[EmailLogResponse]]):
    """Envelope for a document's sent emails."""


class EmailLogDetailEnvelope(ApiResponse[EmailLogDetail]):
    """Envelope for one email's full record."""
