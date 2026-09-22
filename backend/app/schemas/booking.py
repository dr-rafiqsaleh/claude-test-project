"""Booking request/response schemas."""

from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.booking import BookingStatus, RecurrenceType
from app.schemas.common import ApiResponse

MAX_NOTE_LENGTH = 5000


def _assume_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Mongo hands back naive UTC datetimes; tag them so clients get an offset."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


#: A datetime that is always serialised with an explicit UTC offset. Without
#: this, browsers would read a naive timestamp as local time and shift every
#: booking by the user's UTC offset.
UtcDateTime = Annotated[datetime, AfterValidator(_assume_utc)]


def _clean_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _clean_string_list(values: Optional[List[str]]) -> List[str]:
    """Trim, de-duplicate and drop blanks while preserving order."""
    if not values:
        return []
    seen: set = set()
    cleaned: List[str] = []
    for value in values:
        item = str(value).strip()
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)
    return cleaned


class BookingCreate(BaseModel):
    """Payload for creating a booking."""

    customer_id: str
    quote_id: Optional[str] = None
    technician_id: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: datetime
    service_type: str = Field(min_length=1, max_length=120)
    pest_types: List[str] = Field(default_factory=list)
    service_address: Optional[Dict[str, Any]] = None
    site_contact_name: Optional[str] = Field(default=None, max_length=120)
    site_contact_phone: Optional[str] = Field(default=None, max_length=40)
    order_number: Optional[str] = Field(default=None, max_length=60)
    recurrence: RecurrenceType = RecurrenceType.NONE
    recurrence_until: Optional[datetime] = None
    technician_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    internal_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    customer_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    estimated_duration_minutes: int = Field(default=60, ge=5, le=1440)
    quoted_amount: Optional[float] = Field(default=None, ge=0)

    @field_validator("service_type")
    @classmethod
    def _strip_service_type(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Service type is required")
        return cleaned

    @field_validator("pest_types")
    @classmethod
    def _clean_pest_types(cls, value: Optional[List[str]]) -> List[str]:
        return _clean_string_list(value)

    @field_validator("quote_id", "technician_id")
    @classmethod
    def _strip_ids(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)

    @field_validator(
        "technician_notes",
        "internal_notes",
        "customer_notes",
        "site_contact_name",
        "site_contact_phone",
        "order_number",
    )
    @classmethod
    def _strip_notes(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)

    @model_validator(mode="after")
    def _check_window(self) -> "BookingCreate":
        if self.scheduled_end <= self.scheduled_start:
            raise ValueError("The end time must be after the start time")
        return self


class BookingUpdate(BaseModel):
    """Payload for partially updating a booking. All fields optional."""

    customer_id: Optional[str] = None
    quote_id: Optional[str] = None
    technician_id: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    service_type: Optional[str] = Field(default=None, min_length=1, max_length=120)
    pest_types: Optional[List[str]] = None
    service_address: Optional[Dict[str, Any]] = None
    site_contact_name: Optional[str] = Field(default=None, max_length=120)
    site_contact_phone: Optional[str] = Field(default=None, max_length=40)
    order_number: Optional[str] = Field(default=None, max_length=60)
    recurrence: Optional[RecurrenceType] = None
    recurrence_until: Optional[datetime] = None
    #: Also apply these changes to the later, not yet confirmed visits in its series.
    apply_to_series: bool = False
    technician_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    internal_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    customer_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    estimated_duration_minutes: Optional[int] = Field(default=None, ge=5, le=1440)
    quoted_amount: Optional[float] = Field(default=None, ge=0)

    @field_validator("service_type")
    @classmethod
    def _strip_service_type(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Service type cannot be empty")
        return cleaned

    @field_validator("pest_types")
    @classmethod
    def _clean_pest_types(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        return _clean_string_list(value)

    @field_validator(
        "technician_notes",
        "internal_notes",
        "customer_notes",
        "site_contact_name",
        "site_contact_phone",
        "order_number",
    )
    @classmethod
    def _strip_notes(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)

    @model_validator(mode="after")
    def _check_window(self) -> "BookingUpdate":
        if (
            self.scheduled_start is not None
            and self.scheduled_end is not None
            and self.scheduled_end <= self.scheduled_start
        ):
            raise ValueError("The end time must be after the start time")
        return self


class BookingStatusUpdate(BaseModel):
    """Payload for moving a booking through its lifecycle."""

    status: BookingStatus
    reason: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def _strip_reason(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)


class QuoteToBookingRequest(BaseModel):
    """Payload for converting an accepted quote into a booking."""

    technician_id: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: datetime
    service_type: Optional[str] = Field(default=None, max_length=120)
    pest_types: Optional[List[str]] = None
    service_address: Optional[Dict[str, Any]] = None
    site_contact_name: Optional[str] = Field(default=None, max_length=120)
    site_contact_phone: Optional[str] = Field(default=None, max_length=40)
    order_number: Optional[str] = Field(default=None, max_length=60)
    estimated_duration_minutes: Optional[int] = Field(default=None, ge=5, le=1440)
    quoted_amount: Optional[float] = Field(default=None, ge=0)
    customer_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    technician_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    internal_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    recurrence: RecurrenceType = RecurrenceType.NONE
    recurrence_until: Optional[datetime] = None

    @field_validator("technician_id")
    @classmethod
    def _strip_technician(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)

    @field_validator("pest_types")
    @classmethod
    def _clean_pest_types(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return None
        return _clean_string_list(value)

    @model_validator(mode="after")
    def _check_window(self) -> "QuoteToBookingRequest":
        if self.scheduled_end <= self.scheduled_start:
            raise ValueError("The end time must be after the start time")
        return self


class BookingResponse(BaseModel):
    """Public representation of a booking, with customer/technician names embedded."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    booking_number: str
    customer_id: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    quote_id: Optional[str] = None
    quote_number: Optional[str] = None
    job_id: Optional[str] = None
    technician_id: Optional[str] = None
    technician_name: Optional[str] = None
    status: BookingStatus

    scheduled_start: UtcDateTime
    scheduled_end: UtcDateTime
    actual_start: Optional[UtcDateTime] = None
    actual_end: Optional[UtcDateTime] = None

    service_type: str
    pest_types: List[str] = Field(default_factory=list)
    service_address: Optional[Dict[str, Any]] = None
    site_contact_name: Optional[str] = None
    site_contact_phone: Optional[str] = None
    order_number: Optional[str] = None

    recurrence: RecurrenceType = RecurrenceType.NONE
    recurrence_until: Optional[datetime] = None
    parent_booking_id: Optional[str] = None
    series_index: int = 0
    #: A visit generated for a repeating job, not yet confirmed with the customer.
    is_tentative: bool = False
    #: The series it belongs to, on a single booking's page.
    series_head_id: Optional[str] = None
    series_head_number: Optional[str] = None
    series_recurrence: Optional[RecurrenceType] = None
    series_until: Optional[datetime] = None
    series_upcoming: int = 0
    series_to_confirm: int = 0
    #: After a save, in words: what happened to the series, and whether the
    #: technician was told.
    notices: List[str] = Field(default_factory=list)

    technician_notes: Optional[str] = None
    internal_notes: Optional[str] = None
    customer_notes: Optional[str] = None

    estimated_duration_minutes: int = 60
    duration_minutes: int = 0
    quoted_amount: Optional[float] = None
    cancellation_reason: Optional[str] = None

    created_by: str
    created_at: UtcDateTime
    updated_at: UtcDateTime

    @field_validator("id", "customer_id", "created_by", mode="before")
    @classmethod
    def _coerce_object_id(cls, value: object) -> str:
        return str(value)

    @field_validator(
        "quote_id",
        "job_id",
        "technician_id",
        "parent_booking_id",
        mode="before",
    )
    @classmethod
    def _coerce_optional_object_id(cls, value: object) -> Optional[str]:
        return str(value) if value is not None else None


class BookingListData(BaseModel):
    """Paginated booking list payload."""

    items: List[BookingResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class CalendarEventProps(BaseModel):
    """Extra data FullCalendar carries on each event."""

    status: BookingStatus
    tentative: bool = False
    booking_number: str
    customer_name: Optional[str] = None
    technician_name: Optional[str] = None
    service_type: str


class CalendarEvent(BaseModel):
    """A single booking formatted for FullCalendar."""

    id: str
    title: str
    start: UtcDateTime
    end: UtcDateTime
    color: str
    extendedProps: CalendarEventProps


class TimeSlot(BaseModel):
    """A slice of a technician's day that is already committed."""

    booking_id: str
    booking_number: str
    start: UtcDateTime
    end: UtcDateTime
    status: BookingStatus
    service_type: str
    customer_name: Optional[str] = None


class TechnicianAvailability(BaseModel):
    """Booked slots for one technician on one day."""

    technician_id: str
    technician_name: Optional[str] = None
    date: str
    booked_slots: List[TimeSlot] = Field(default_factory=list)


class BookingResponseEnvelope(ApiResponse[BookingResponse]):
    """Envelope for a single booking."""


class BookingListResponse(ApiResponse[BookingListData]):
    """Envelope for a paginated list of bookings."""


class CalendarEventsResponse(ApiResponse[List[CalendarEvent]]):
    """Envelope for a list of calendar events."""


class TechnicianAvailabilityResponse(ApiResponse[TechnicianAvailability]):
    """Envelope for a technician's booked slots on a given day."""
