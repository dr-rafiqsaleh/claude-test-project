"""Quote document model."""

from datetime import datetime
from enum import Enum
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel


class QuoteStatus(str, Enum):
    """Lifecycle states for a quote."""

    DRAFT = "draft"
    SENT = "sent"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"


#: Statuses that can no longer transition anywhere else.
TERMINAL_STATUSES = {QuoteStatus.ACCEPTED, QuoteStatus.REJECTED, QuoteStatus.EXPIRED}


class QuoteItem(BaseModel):
    """A single billable line on a quote."""

    description: str
    pest_type: Optional[str] = None  # e.g. "Cockroach", "Termite"
    service_type: Optional[str] = None  # e.g. "Treatment", "Inspection"
    quantity: float = 1
    unit: str = "service"  # "service", "sqm", "hour"
    unit_price: float

    @property
    def total(self) -> float:
        return round(self.quantity * self.unit_price, 2)


class Quote(Document):
    """A quote raised against a customer."""

    quote_number: str  # e.g. "QTE-0001"
    customer_id: PydanticObjectId
    status: QuoteStatus = QuoteStatus.DRAFT
    items: List[QuoteItem] = Field(default_factory=list)
    subtotal: float = 0.0
    tax_rate: float = 0.20  # 20% VAT
    tax_amount: float = 0.0
    total: float = 0.0
    notes: Optional[str] = None
    terms: Optional[str] = None
    valid_until: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    accepted_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    converted_to_booking: bool = False
    booking_id: Optional[PydanticObjectId] = None
    created_by: PydanticObjectId
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "quotes"
        indexes = [
            IndexModel([("quote_number", 1)], unique=True, name="uniq_quote_number"),
            IndexModel([("customer_id", 1)], name="idx_customer_id"),
            IndexModel([("status", 1)], name="idx_status"),
            IndexModel([("created_at", -1)], name="idx_created_at"),
        ]

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return f"{self.quote_number} ({self.status.value})"
