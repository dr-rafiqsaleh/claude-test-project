"""Notification document model - in-app reminders, alerts and system messages.

Notifications are cheap, disposable rows: a TTL index drops anything older than
30 days so the collection never needs manual housekeeping.
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

#: How long a notification survives before MongoDB expires it (30 days).
NOTIFICATION_TTL_SECONDS = 30 * 24 * 60 * 60


class NotificationType(str, Enum):
    """What triggered a notification. Drives the icon shown in the UI."""

    BOOKING_REMINDER = "booking_reminder"  # booking tomorrow
    BOOKING_TODAY = "booking_today"  # booking in under 2 hours
    INVOICE_OVERDUE = "invoice_overdue"  # invoice past its due date
    INVOICE_DUE_SOON = "invoice_due_soon"  # invoice due within 3 days
    JOB_FOLLOW_UP = "job_follow_up"  # job follow-up coming due
    QUOTE_EXPIRING = "quote_expiring"  # quote valid_until within 3 days
    QUOTE_ACCEPTED = "quote_accepted"  # quote moved to accepted
    JOB_COMPLETED = "job_completed"  # job completed, invoice ready
    SYSTEM = "system"  # general system message


#: Which frontend section each type belongs to, used by the page filters.
NOTIFICATION_CATEGORY = {
    NotificationType.BOOKING_REMINDER: "bookings",
    NotificationType.BOOKING_TODAY: "bookings",
    NotificationType.INVOICE_OVERDUE: "invoices",
    NotificationType.INVOICE_DUE_SOON: "invoices",
    NotificationType.JOB_FOLLOW_UP: "jobs",
    NotificationType.JOB_COMPLETED: "jobs",
    NotificationType.QUOTE_EXPIRING: "quotes",
    NotificationType.QUOTE_ACCEPTED: "quotes",
    NotificationType.SYSTEM: "system",
}


class Notification(Document):
    """One notification addressed to a single staff member."""

    user_id: PydanticObjectId  # who receives this
    type: NotificationType = NotificationType.SYSTEM
    title: str
    message: str
    link: Optional[str] = None  # frontend route, e.g. "/invoices/abc123"
    related_id: Optional[str] = None  # id of the document that triggered it
    related_type: Optional[str] = None  # "invoice", "booking", "job", "quote"
    is_read: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "notifications"
        indexes = [
            IndexModel([("user_id", 1), ("is_read", 1)], name="idx_user_unread"),
            IndexModel([("user_id", 1), ("created_at", -1)], name="idx_user_created"),
            IndexModel(
                [("created_at", 1)],
                name="ttl_created_at",
                expireAfterSeconds=NOTIFICATION_TTL_SECONDS,
            ),
        ]

    @property
    def category(self) -> str:
        """Coarse grouping used by the notifications page filter tabs."""
        return NOTIFICATION_CATEGORY.get(self.type, "system")

    def __str__(self) -> str:
        return f"{self.type.value}: {self.title}"
