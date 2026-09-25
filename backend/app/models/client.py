"""A client company using PestBase.

One row per business paying for the app. Every other collection points back
here through `client_id`, and `status` is what stops a closed client's people
signing in.

This is not a `TenantDocument`: the client list is the platform's own record,
not any one client's.
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import IndexModel


class ClientStatus(str, Enum):
    """Whether the client may use PestBase."""

    ACTIVE = "active"
    #: Temporarily switched off - nobody can sign in, nothing is deleted.
    SUSPENDED = "suspended"
    #: Gone for good as far as the app is concerned; kept for the record.
    CLOSED = "closed"


class Client(Document):
    """One client company."""

    name: str
    #: Short url-safe handle, unique across the platform, e.g. "acme-pest".
    slug: str
    status: ClientStatus = ClientStatus.ACTIVE
    #: Who to contact about the account, not a customer-facing address.
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "clients"
        indexes = [
            IndexModel([("slug", 1)], unique=True, name="uniq_client_slug"),
            IndexModel([("status", 1)], name="idx_client_status"),
        ]

    @property
    def is_usable(self) -> bool:
        return self.status == ClientStatus.ACTIVE

    def touch(self) -> None:
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"
