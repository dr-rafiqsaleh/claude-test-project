"""Invoice request/response schemas."""

from datetime import datetime, timezone
from typing import Annotated, Dict, List, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from app.models.invoice import DEFAULT_TERMS, InvoiceStatus, PaymentMethod
from app.schemas.common import ApiResponse

MAX_NOTE_LENGTH = 5000


def _assume_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Mongo hands back naive UTC datetimes; tag them so clients get an offset."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


#: A datetime that is always serialised with an explicit UTC offset.
UtcDateTime = Annotated[datetime, AfterValidator(_assume_utc)]


def _clean_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


# ---------------------------------------------------------------------------
# Line items
# ---------------------------------------------------------------------------


class InvoiceItemSchema(BaseModel):
    """A single line item as supplied by the client."""

    model_config = ConfigDict(from_attributes=True)

    description: str = Field(min_length=1, max_length=300)
    quantity: float = Field(default=1.0, gt=0)
    unit_price: float = Field(ge=0)
    tax_rate: float = Field(default=0.20, ge=0, le=1)

    @field_validator("description")
    @classmethod
    def _strip_description(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Description cannot be empty")
        return cleaned


class InvoiceItemResponse(InvoiceItemSchema):
    """Line item echoed back with its stored computed columns."""

    subtotal: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


class AddPaymentRequest(BaseModel):
    """Payload for recording a payment against an invoice."""

    amount: float = Field(gt=0, description="Amount received, in GBP")
    method: PaymentMethod = PaymentMethod.BANK_TRANSFER
    reference: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    paid_at: Optional[datetime] = None

    @field_validator("reference", "notes")
    @classmethod
    def _strip_optional(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)


class PaymentResponse(BaseModel):
    """One payment received against an invoice."""

    model_config = ConfigDict(from_attributes=True)

    payment_id: str
    amount: float
    method: PaymentMethod
    reference: Optional[str] = None
    notes: Optional[str] = None
    paid_at: UtcDateTime
    recorded_by: Optional[str] = None
    recorded_by_name: Optional[str] = None

    @field_validator("recorded_by", mode="before")
    @classmethod
    def _coerce_optional_object_id(cls, value: object) -> Optional[str]:
        return str(value) if value is not None else None


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class InvoiceCreate(BaseModel):
    """Payload for creating an invoice by hand."""

    customer_id: str
    job_id: Optional[str] = None
    quote_id: Optional[str] = None
    booking_id: Optional[str] = None
    items: List[InvoiceItemSchema] = Field(min_length=1)
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    terms: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    payment_instructions: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    status: InvoiceStatus = InvoiceStatus.DRAFT

    @field_validator("status")
    @classmethod
    def _check_initial_status(cls, value: InvoiceStatus) -> InvoiceStatus:
        if value not in (InvoiceStatus.DRAFT, InvoiceStatus.SENT):
            raise ValueError("A new invoice must start as draft or sent")
        return value

    @field_validator("customer_id")
    @classmethod
    def _strip_customer_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A customer is required")
        return cleaned

    @field_validator("job_id", "quote_id", "booking_id")
    @classmethod
    def _strip_optional_ids(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)

    @field_validator("notes", "terms", "payment_instructions")
    @classmethod
    def _strip_text(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)


class InvoiceUpdate(BaseModel):
    """Partial update of a draft or sent invoice. All fields optional."""

    items: Optional[List[InvoiceItemSchema]] = None
    notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    terms: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    payment_instructions: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    issue_date: Optional[datetime] = None
    due_date: Optional[datetime] = None

    @field_validator("items")
    @classmethod
    def _check_items(
        cls, value: Optional[List[InvoiceItemSchema]]
    ) -> Optional[List[InvoiceItemSchema]]:
        if value is not None and len(value) == 0:
            raise ValueError("An invoice must have at least one item")
        return value

    @field_validator("notes", "terms", "payment_instructions")
    @classmethod
    def _strip_text(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)


class InvoiceStatusUpdate(BaseModel):
    """Payload for moving an invoice through its lifecycle."""

    status: InvoiceStatus


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class InvoiceResponse(BaseModel):
    """Public representation of an invoice, with related names embedded."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    invoice_number: str

    customer_id: str
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None

    job_id: Optional[str] = None
    job_number: Optional[str] = None
    quote_id: Optional[str] = None
    quote_number: Optional[str] = None
    booking_id: Optional[str] = None

    status: InvoiceStatus
    items: List[InvoiceItemResponse] = Field(default_factory=list)

    subtotal: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0
    amount_paid: float = 0.0
    amount_due: float = 0.0

    payments: List[PaymentResponse] = Field(default_factory=list)

    issue_date: UtcDateTime
    due_date: UtcDateTime
    sent_at: Optional[UtcDateTime] = None
    paid_at: Optional[UtcDateTime] = None
    is_overdue: bool = False

    notes: Optional[str] = None
    terms: str = DEFAULT_TERMS
    payment_instructions: Optional[str] = None

    email_sent_to: Optional[str] = None
    email_sent_at: Optional[UtcDateTime] = None

    report_generated: bool = False
    report_generated_at: Optional[UtcDateTime] = None

    created_by: str
    created_at: UtcDateTime
    updated_at: UtcDateTime

    @field_validator("id", "customer_id", "created_by", mode="before")
    @classmethod
    def _coerce_object_id(cls, value: object) -> str:
        return str(value)

    @field_validator("job_id", "quote_id", "booking_id", mode="before")
    @classmethod
    def _coerce_optional_object_id(cls, value: object) -> Optional[str]:
        return str(value) if value is not None else None


class InvoiceListData(BaseModel):
    """Paginated invoice list payload."""

    items: List[InvoiceResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class InvoiceSummary(BaseModel):
    """Aggregated invoicing figures for the dashboard."""

    total_invoiced: float = 0.0
    total_paid: float = 0.0
    total_overdue: float = 0.0
    total_outstanding: float = 0.0
    collected_this_month: float = 0.0
    overdue_count: int = 0
    invoice_count: int = 0
    invoice_count_by_status: Dict[str, int] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Envelopes
# ---------------------------------------------------------------------------


class InvoiceResponseEnvelope(ApiResponse[InvoiceResponse]):
    """Envelope for a single invoice."""


class InvoiceListResponse(ApiResponse[InvoiceListData]):
    """Envelope for a paginated list of invoices."""


class InvoiceSummaryResponse(ApiResponse[InvoiceSummary]):
    """Envelope for the dashboard summary."""
