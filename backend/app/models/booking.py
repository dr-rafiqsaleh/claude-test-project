"""Booking document model."""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel


class BookingStatus(str, Enum):
    """Lifecycle states for a booking."""

    SCHEDULED = "scheduled"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class RecurrenceType(str, Enum):
    """How often a booking repeats."""

    NONE = "none"
    WEEKLY = "weekly"
    FORTNIGHTLY = "fortnightly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"


#: Statuses a booking can no longer move out of.
TERMINAL_STATUSES = {BookingStatus.COMPLETED, BookingStatus.CANCELLED}

#: Statuses where the booking details are still editable.
EDITABLE_STATUSES = {BookingStatus.SCHEDULED, BookingStatus.CONFIRMED}

#: Calendar colour per status, shared with the frontend badge palette.
STATUS_COLORS: Dict[BookingStatus, str] = {
    BookingStatus.SCHEDULED: "#6366f1",
    BookingStatus.CONFIRMED: "#0ea5e9",
    BookingStatus.IN_PROGRESS: "#f59e0b",
    BookingStatus.COMPLETED: "#10b981",
    BookingStatus.CANCELLED: "#ef4444",
}


class Booking(Document):
    """A scheduled service visit for a customer."""

    booking_number: str  # e.g. "JOB-0001" - shown to users as the job number
    customer_id: PydanticObjectId
    quote_id: Optional[PydanticObjectId] = None
    job_id: Optional[PydanticObjectId] = None  # set once the visit becomes a job
    technician_id: Optional[PydanticObjectId] = None  # ref to User with role=technician
    status: BookingStatus = BookingStatus.SCHEDULED

    # Scheduling
    scheduled_start: datetime
    scheduled_end: datetime
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None

    # Service details
    service_type: str  # e.g. "General Pest Control", "Termite Inspection"
    pest_types: List[str] = Field(default_factory=list)  # e.g. ["Cockroach", "Ant"]
    service_address: Optional[dict] = None  # overrides the customer address when set
    site_contact_name: Optional[str] = None  # who will be on site, e.g. the tenant
    site_contact_phone: Optional[str] = None
    order_number: Optional[str] = None  # the customer's purchase order, if they use one

    # Recurrence. The first visit of a repeating job heads its series; the
    # later visits are generated from it, a year ahead, and point back to it.
    recurrence: RecurrenceType = RecurrenceType.NONE
    recurrence_until: Optional[datetime] = None  # no visits after this date
    parent_booking_id: Optional[PydanticObjectId] = None  # head of a recurring series
    series_index: int = 0  # 0 for the head, then 1, 2, 3... for later visits
    series_last_index: int = 0  # on the head: the last visit generated so far
    # On the head: when the pattern is counted from. Moving just the first
    # visit (the customer is busy that day) leaves the rest of the series put.
    series_anchor: Optional[datetime] = None

    # Notes
    technician_notes: Optional[str] = None  # visible to the assigned technician
    internal_notes: Optional[str] = None  # office only
    customer_notes: Optional[str] = None  # instructions for the customer

    # Pricing snapshot
    estimated_duration_minutes: int = 60
    quoted_amount: Optional[float] = None

    cancellation_reason: Optional[str] = None

    created_by: PydanticObjectId
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "bookings"
        indexes = [
            IndexModel([("booking_number", 1)], unique=True, name="uniq_booking_number"),
            IndexModel([("customer_id", 1)], name="idx_customer_id"),
            IndexModel([("technician_id", 1)], name="idx_technician_id"),
            IndexModel([("scheduled_start", 1)], name="idx_scheduled_start"),
            IndexModel([("status", 1)], name="idx_status"),
            IndexModel([("parent_booking_id", 1)], name="idx_parent_booking_id"),
        ]

    @property
    def duration_minutes(self) -> int:
        """Actual scheduled length in whole minutes."""
        delta = self.scheduled_end - self.scheduled_start
        return max(int(delta.total_seconds() // 60), 0)

    @property
    def color(self) -> str:
        """Calendar colour for the current status."""
        return STATUS_COLORS.get(self.status, "#6366f1")

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return f"{self.booking_number} ({self.status.value})"
