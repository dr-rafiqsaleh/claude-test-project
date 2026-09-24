"""Invoice document model - billing raised against a customer, job or quote."""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from beanie import PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel

from app.models.tenant import TenantDocument


class InvoiceStatus(str, Enum):
    """Lifecycle states for an invoice."""

    DRAFT = "draft"
    SENT = "sent"
    PAID = "paid"
    PARTIALLY_PAID = "partially_paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class PaymentMethod(str, Enum):
    """How a payment was taken."""

    CASH = "cash"
    CARD = "card"
    BANK_TRANSFER = "bank_transfer"
    CHEQUE = "cheque"
    OTHER = "other"


#: Statuses an invoice can no longer move out of.
TERMINAL_STATUSES = {InvoiceStatus.PAID, InvoiceStatus.CANCELLED}

#: Statuses where the line items and details are still editable.
EDITABLE_STATUSES = {InvoiceStatus.DRAFT, InvoiceStatus.SENT}

#: Statuses an invoice may be deleted from.
DELETABLE_STATUSES = {InvoiceStatus.DRAFT}

#: Statuses that can accept a payment.
PAYABLE_STATUSES = {
    InvoiceStatus.SENT,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.OVERDUE,
}

#: Badge colour per status, shared with the PDF and the frontend palette.
STATUS_COLORS: Dict[InvoiceStatus, str] = {
    InvoiceStatus.DRAFT: "#64748b",
    InvoiceStatus.SENT: "#0ea5e9",
    InvoiceStatus.PAID: "#10b981",
    InvoiceStatus.PARTIALLY_PAID: "#14b8a6",
    InvoiceStatus.OVERDUE: "#ef4444",
    InvoiceStatus.CANCELLED: "#94a3b8",
}

#: Default number of days between issue date and due date.
DEFAULT_PAYMENT_TERM_DAYS = 14

DEFAULT_TERMS = "Payment due within 14 days. Thank you for your business."


class InvoiceItem(BaseModel):
    """A single billable line on an invoice.

    The computed columns are stored rather than derived so a re-rendered PDF
    always matches the figures the customer was originally sent.
    """

    description: str
    quantity: float = 1.0
    unit_price: float
    tax_rate: float = 0.20

    # Stored for PDF stability.
    subtotal: float = 0.0  # quantity * unit_price
    tax_amount: float = 0.0  # subtotal * tax_rate
    total: float = 0.0  # subtotal + tax_amount


class Payment(BaseModel):
    """One payment received against an invoice."""

    payment_id: str  # short UUID
    amount: float
    method: PaymentMethod = PaymentMethod.BANK_TRANSFER
    reference: Optional[str] = None  # bank transfer ref, receipt number, ...
    notes: Optional[str] = None
    paid_at: datetime = Field(default_factory=datetime.utcnow)
    recorded_by: PydanticObjectId


class Invoice(TenantDocument):
    """A tax invoice raised against a customer."""

    invoice_number: str  # e.g. "INV-0001"
    customer_id: PydanticObjectId
    job_id: Optional[PydanticObjectId] = None
    quote_id: Optional[PydanticObjectId] = None
    booking_id: Optional[PydanticObjectId] = None

    status: InvoiceStatus = InvoiceStatus.DRAFT
    items: List[InvoiceItem] = Field(default_factory=list)

    # Totals (recomputed whenever items or payments change)
    subtotal: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0
    amount_paid: float = 0.0
    amount_due: float = 0.0  # total - amount_paid

    payments: List[Payment] = Field(default_factory=list)

    # Dates
    issue_date: datetime = Field(default_factory=datetime.utcnow)
    due_date: datetime = Field(default_factory=datetime.utcnow)
    sent_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None  # set when fully paid

    # Notes
    notes: Optional[str] = None
    terms: str = DEFAULT_TERMS
    payment_instructions: Optional[str] = None  # e.g. bank details

    # Email
    email_sent_to: Optional[str] = None
    email_sent_at: Optional[datetime] = None

    # PDF
    report_generated: bool = False
    report_generated_at: Optional[datetime] = None

    created_by: PydanticObjectId
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "invoices"
        indexes = [
            IndexModel([("client_id", 1), ("invoice_number", 1)], unique=True, name="uniq_invoice_number"),
            IndexModel([("customer_id", 1)], name="idx_customer_id"),
            IndexModel([("job_id", 1)], name="idx_job_id"),
            IndexModel([("status", 1)], name="idx_status"),
            IndexModel([("due_date", 1)], name="idx_due_date"),
        ]

    @property
    def color(self) -> str:
        """Palette colour for the current status."""
        return STATUS_COLORS.get(self.status, "#64748b")

    @property
    def is_overdue(self) -> bool:
        """True when an unpaid invoice has passed its due date."""
        if self.status in TERMINAL_STATUSES:
            return False
        return self.amount_due > 0 and self.due_date < datetime.utcnow()

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return f"{self.invoice_number} ({self.status.value})"
