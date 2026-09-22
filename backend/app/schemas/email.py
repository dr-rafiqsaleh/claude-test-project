"""Email request/response schemas."""

import re
from datetime import datetime, timezone
from typing import List, Literal

from pydantic import BaseModel, Field, field_validator

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
    """One email already sent for a document."""

    to: List[str]
    cc: List[str] = Field(default_factory=list)
    subject: str
    sent_by_name: str | None = None
    sent_at: datetime

    @field_validator("sent_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class EmailDraft(BaseModel):
    """A ready-to-send email for a document, filled in from its template."""

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
