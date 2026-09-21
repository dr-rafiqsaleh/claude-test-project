"""Quote request/response schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.quote import QuoteStatus
from app.schemas.common import ApiResponse


class QuoteItemSchema(BaseModel):
    """A single line item, used for both input and output."""

    model_config = ConfigDict(from_attributes=True)

    description: str = Field(min_length=1, max_length=300)
    pest_type: Optional[str] = Field(default=None, max_length=100)
    service_type: Optional[str] = Field(default=None, max_length=100)
    quantity: float = Field(default=1, gt=0)
    unit: str = Field(default="service", max_length=30)
    unit_price: float = Field(gt=0)

    @field_validator("description")
    @classmethod
    def _strip_description(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Description cannot be empty")
        return cleaned

    @field_validator("pest_type", "service_type")
    @classmethod
    def _strip_optional(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("unit")
    @classmethod
    def _normalise_unit(cls, value: str) -> str:
        cleaned = value.strip().lower()
        return cleaned or "service"

    @property
    def total(self) -> float:
        return round(self.quantity * self.unit_price, 2)


class QuoteItemResponse(QuoteItemSchema):
    """Line item echoed back with its computed total."""

    line_total: float = 0.0


class QuoteCreate(BaseModel):
    """Payload for creating a quote."""

    customer_id: str
    items: List[QuoteItemSchema] = Field(min_length=1)
    notes: Optional[str] = Field(default=None, max_length=5000)
    terms: Optional[str] = Field(default=None, max_length=5000)
    valid_until: Optional[datetime] = None
    tax_rate: float = Field(default=0.20, ge=0, le=1)
    status: QuoteStatus = QuoteStatus.DRAFT

    @field_validator("status")
    @classmethod
    def _check_initial_status(cls, value: QuoteStatus) -> QuoteStatus:
        if value not in (QuoteStatus.DRAFT, QuoteStatus.SENT):
            raise ValueError("A new quote must start as draft or sent")
        return value

    @field_validator("notes", "terms")
    @classmethod
    def _strip_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class QuoteUpdate(BaseModel):
    """Payload for updating a draft quote. All fields optional."""

    customer_id: Optional[str] = None
    items: Optional[List[QuoteItemSchema]] = None
    notes: Optional[str] = Field(default=None, max_length=5000)
    terms: Optional[str] = Field(default=None, max_length=5000)
    valid_until: Optional[datetime] = None
    tax_rate: Optional[float] = Field(default=None, ge=0, le=1)

    @field_validator("items")
    @classmethod
    def _check_items(cls, value: Optional[List[QuoteItemSchema]]) -> Optional[List[QuoteItemSchema]]:
        if value is not None and len(value) == 0:
            raise ValueError("A quote must have at least one item")
        return value

    @field_validator("notes", "terms")
    @classmethod
    def _strip_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class QuoteStatusUpdate(BaseModel):
    """Payload for moving a quote through its lifecycle."""

    status: QuoteStatus
    rejection_reason: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("rejection_reason")
    @classmethod
    def _strip_reason(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class QuoteResponse(BaseModel):
    """Public representation of a quote, with the customer name embedded."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    quote_number: str
    customer_id: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    status: QuoteStatus
    items: List[QuoteItemResponse] = Field(default_factory=list)
    subtotal: float = 0.0
    tax_rate: float = 0.20
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
    booking_id: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime

    @field_validator("id", "customer_id", "created_by", mode="before")
    @classmethod
    def _coerce_object_id(cls, value: object) -> str:
        return str(value)

    @field_validator("booking_id", mode="before")
    @classmethod
    def _coerce_optional_object_id(cls, value: object) -> Optional[str]:
        return str(value) if value is not None else None


class QuoteListData(BaseModel):
    """Paginated quote list payload."""

    items: List[QuoteResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class QuoteResponseEnvelope(ApiResponse[QuoteResponse]):
    """Envelope for a single quote."""


class QuoteListResponse(ApiResponse[QuoteListData]):
    """Envelope for a paginated list of quotes."""
