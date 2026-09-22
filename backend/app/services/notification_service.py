"""In-app notifications: creation, retrieval and the passive reminder sweep.

There is no scheduler in QKil. `sweep_notifications()` is idempotent and cheap,
so it runs as a background task every time somebody opens their notifications -
which, in practice, is far more often than a cron job would fire.
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from beanie import PydanticObjectId

from app.models.booking import Booking, BookingStatus
from app.models.customer import Customer
from app.models.invoice import Invoice, InvoiceStatus
from app.models.job import Job
from app.models.notification import Notification, NotificationType
from app.models.quote import Quote, QuoteStatus
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

#: How far back the sweep looks when deciding whether a reminder is a duplicate.
DEDUPE_WINDOW_HOURS = 24

#: Default page size for the notifications list.
DEFAULT_LIMIT = 50
MAX_LIMIT = 200

#: Sweep windows.
BOOKING_REMINDER_FROM_HOURS = 20
BOOKING_REMINDER_TO_HOURS = 28
BOOKING_TODAY_HOURS = 2
INVOICE_DUE_SOON_DAYS = 3
JOB_FOLLOW_UP_DAYS = 7
QUOTE_EXPIRING_DAYS = 3


def _to_object_id(value: "PydanticObjectId | str | None") -> Optional[PydanticObjectId]:
    if value is None:
        return None
    try:
        return value if isinstance(value, PydanticObjectId) else PydanticObjectId(str(value))
    except Exception:  # noqa: BLE001 - invalid object id string
        return None


def build_notification_payload(notification: Notification) -> dict:
    """Flatten a notification into the shape NotificationResponse expects."""
    return {
        "id": str(notification.id),
        "type": notification.type,
        "category": notification.category,
        "title": notification.title,
        "message": notification.message,
        "link": notification.link,
        "related_id": notification.related_id,
        "related_type": notification.related_type,
        "is_read": notification.is_read,
        "created_at": notification.created_at,
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def create_notification(
    user_id: "PydanticObjectId | str",
    type: NotificationType,
    title: str,
    message: str,
    link: Optional[str] = None,
    related_id: Optional[str] = None,
    related_type: Optional[str] = None,
) -> Optional[Notification]:
    """Save one notification addressed to a single user."""
    oid = _to_object_id(user_id)
    if oid is None:
        return None

    notification = Notification(
        user_id=oid,
        type=type,
        title=title,
        message=message,
        link=link,
        related_id=str(related_id) if related_id is not None else None,
        related_type=related_type,
        is_read=False,
        created_at=datetime.utcnow(),
    )
    await notification.insert()
    return notification


async def get_notifications(
    user_id: "PydanticObjectId | str",
    unread_only: bool = False,
    limit: int = DEFAULT_LIMIT,
) -> List[Notification]:
    """The user's notifications, newest first."""
    oid = _to_object_id(user_id)
    if oid is None:
        return []

    criteria: dict = {"user_id": oid}
    if unread_only:
        criteria["is_read"] = False

    capped = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    return await Notification.find(criteria).sort("-created_at").limit(capped).to_list()


async def get_unread_count(user_id: "PydanticObjectId | str") -> int:
    """How many unread notifications the user has."""
    oid = _to_object_id(user_id)
    if oid is None:
        return 0
    return await Notification.find({"user_id": oid, "is_read": False}).count()


async def mark_read(
    notification_id: "PydanticObjectId | str",
    user_id: "PydanticObjectId | str",
) -> Optional[Notification]:
    """Mark one notification as read. Returns None when it is not the user's."""
    oid = _to_object_id(notification_id)
    user_oid = _to_object_id(user_id)
    if oid is None or user_oid is None:
        return None

    notification = await Notification.find_one({"_id": oid, "user_id": user_oid})
    if notification is None:
        return None

    if not notification.is_read:
        notification.is_read = True
        await notification.save()

    return notification


async def mark_all_read(user_id: "PydanticObjectId | str") -> int:
    """Mark every unread notification for this user as read."""
    oid = _to_object_id(user_id)
    if oid is None:
        return 0

    result = await Notification.get_motor_collection().update_many(
        {"user_id": oid, "is_read": False},
        {"$set": {"is_read": True}},
    )
    return int(getattr(result, "modified_count", 0) or 0)


async def delete_notification(
    notification_id: "PydanticObjectId | str",
    user_id: "PydanticObjectId | str",
) -> bool:
    """Delete one of the user's notifications. Returns whether anything went."""
    oid = _to_object_id(notification_id)
    user_oid = _to_object_id(user_id)
    if oid is None or user_oid is None:
        return False

    notification = await Notification.find_one({"_id": oid, "user_id": user_oid})
    if notification is None:
        return False

    await notification.delete()
    return True


# ---------------------------------------------------------------------------
# Recipients and de-duplication
# ---------------------------------------------------------------------------


async def _office_user_ids() -> List[PydanticObjectId]:
    """Every active admin and office staff member."""
    users = await User.find(
        {
            "role": {"$in": [UserRole.ADMIN.value, UserRole.OFFICE_STAFF.value]},
            "is_active": True,
        }
    ).to_list()
    return [user.id for user in users]


async def _recent_keys() -> Set[Tuple[str, str, str]]:
    """(user, type, related_id) triples already notified inside the dedupe window."""
    since = datetime.utcnow() - timedelta(hours=DEDUPE_WINDOW_HOURS)
    recent = await Notification.find({"created_at": {"$gte": since}}).to_list()
    return {
        (str(item.user_id), item.type.value, item.related_id or "")
        for item in recent
    }


async def _customer_names(documents: Iterable[object]) -> Dict[str, str]:
    """Batch-resolve the customer names referenced by a set of documents."""
    ids: Set[PydanticObjectId] = set()
    for document in documents:
        customer_id = getattr(document, "customer_id", None)
        if customer_id is not None:
            ids.add(customer_id)

    if not ids:
        return {}

    customers = await Customer.find({"_id": {"$in": list(ids)}}).to_list()
    return {str(customer.id): customer.full_name for customer in customers}


def _money(value: Optional[float]) -> str:
    return f"£{float(value or 0):,.2f}"


def _when(value: Optional[datetime]) -> str:
    return value.strftime("%d %b %Y at %I:%M %p").replace(" 0", " ") if value else "an unknown time"


def _day(value: Optional[datetime]) -> str:
    return value.strftime("%d %b %Y") if value else "an unknown date"


# ---------------------------------------------------------------------------
# The sweep
# ---------------------------------------------------------------------------


class _Batch:
    """Collects notifications to insert, skipping anything already sent."""

    def __init__(self, seen: Set[Tuple[str, str, str]]) -> None:
        self._seen = seen
        self.pending: List[Notification] = []

    def add(
        self,
        user_ids: Sequence[PydanticObjectId],
        type: NotificationType,
        title: str,
        message: str,
        link: Optional[str],
        related_id: Optional[str],
        related_type: Optional[str],
    ) -> None:
        now = datetime.utcnow()
        reference = str(related_id) if related_id is not None else None

        for user_id in user_ids:
            if user_id is None:
                continue

            key = (str(user_id), type.value, reference or "")
            if key in self._seen:
                continue
            self._seen.add(key)

            self.pending.append(
                Notification(
                    user_id=user_id,
                    type=type,
                    title=title,
                    message=message,
                    link=link,
                    related_id=reference,
                    related_type=related_type,
                    is_read=False,
                    created_at=now,
                )
            )


async def sweep_notifications() -> int:
    """Generate reminders for anything coming due. Returns how many were created.

    Safe to call as often as you like: every candidate is checked against the
    notifications already sent in the last 24 hours before anything is written.
    """
    now = datetime.utcnow()

    # Keep every repeating job booked a year ahead. Separate, so a problem
    # here never stops the reminders.
    try:
        from app.services import recurrence_service  # noqa: PLC0415

        await recurrence_service.extend_all_series(now)
    except Exception:  # noqa: BLE001 - must never break a request
        logger.exception("Could not top up repeating jobs")

    try:
        office_ids = await _office_user_ids()
        batch = _Batch(await _recent_keys())

        await _sweep_bookings(batch, office_ids, now)
        await _sweep_invoices(batch, office_ids, now)
        await _sweep_jobs(batch, office_ids, now)
        await _sweep_quotes(batch, office_ids, now)

        if not batch.pending:
            return 0

        await Notification.insert_many(batch.pending)
        logger.info("Notification sweep created %d notification(s)", len(batch.pending))
        return len(batch.pending)
    except Exception:  # noqa: BLE001 - a failed sweep must never break a request
        logger.exception("Notification sweep failed")
        return 0


async def _sweep_bookings(
    batch: _Batch,
    office_ids: Sequence[PydanticObjectId],
    now: datetime,
) -> None:
    """Reminders for bookings tomorrow and for bookings starting within 2 hours."""
    upcoming_statuses = [BookingStatus.SCHEDULED.value, BookingStatus.CONFIRMED.value]

    tomorrow = await Booking.find(
        {
            "status": {"$in": upcoming_statuses},
            "scheduled_start": {
                "$gte": now + timedelta(hours=BOOKING_REMINDER_FROM_HOURS),
                "$lte": now + timedelta(hours=BOOKING_REMINDER_TO_HOURS),
            },
        }
    ).to_list()

    imminent = await Booking.find(
        {
            "status": {"$in": upcoming_statuses},
            "scheduled_start": {
                "$gte": now,
                "$lte": now + timedelta(hours=BOOKING_TODAY_HOURS),
            },
        }
    ).to_list()

    names = await _customer_names([*tomorrow, *imminent])

    def recipients(booking: Booking) -> List[PydanticObjectId]:
        people = list(office_ids)
        if booking.technician_id is not None and booking.technician_id not in people:
            people.append(booking.technician_id)
        return people

    for booking in tomorrow:
        customer = names.get(str(booking.customer_id), "a customer")
        batch.add(
            recipients(booking),
            NotificationType.BOOKING_REMINDER,
            f"Job tomorrow: {booking.booking_number}",
            f"{booking.service_type} for {customer}, {_when(booking.scheduled_start)}.",
            f"/bookings/{booking.id}",
            str(booking.id),
            "booking",
        )

    for booking in imminent:
        customer = names.get(str(booking.customer_id), "a customer")
        batch.add(
            recipients(booking),
            NotificationType.BOOKING_TODAY,
            f"Starting soon: {booking.booking_number}",
            f"{booking.service_type} for {customer} starts at {_when(booking.scheduled_start)}.",
            f"/bookings/{booking.id}",
            str(booking.id),
            "booking",
        )


async def _sweep_invoices(
    batch: _Batch,
    office_ids: Sequence[PydanticObjectId],
    now: datetime,
) -> None:
    """Alerts for invoices past their due date, and those due within 3 days."""
    owing = [InvoiceStatus.SENT.value, InvoiceStatus.PARTIALLY_PAID.value]

    overdue = await Invoice.find(
        {"status": {"$in": owing}, "due_date": {"$lt": now}}
    ).to_list()

    due_soon = await Invoice.find(
        {
            "status": {"$in": owing},
            "due_date": {
                "$gte": now,
                "$lte": now + timedelta(days=INVOICE_DUE_SOON_DAYS),
            },
        }
    ).to_list()

    names = await _customer_names([*overdue, *due_soon])

    for invoice in overdue:
        customer = names.get(str(invoice.customer_id), "a customer")
        days = max((now - invoice.due_date).days, 0)
        overdue_by = "today" if days == 0 else f"{days} day(s) ago"
        batch.add(
            office_ids,
            NotificationType.INVOICE_OVERDUE,
            f"Invoice overdue: {invoice.invoice_number}",
            (
                f"{_money(invoice.amount_due)} is outstanding from {customer}. "
                f"Due {overdue_by}."
            ),
            f"/invoices/{invoice.id}",
            str(invoice.id),
            "invoice",
        )

    for invoice in due_soon:
        customer = names.get(str(invoice.customer_id), "a customer")
        batch.add(
            office_ids,
            NotificationType.INVOICE_DUE_SOON,
            f"Invoice due soon: {invoice.invoice_number}",
            (
                f"{_money(invoice.amount_due)} from {customer} falls due on "
                f"{_day(invoice.due_date)}."
            ),
            f"/invoices/{invoice.id}",
            str(invoice.id),
            "invoice",
        )


async def _sweep_jobs(
    batch: _Batch,
    office_ids: Sequence[PydanticObjectId],
    now: datetime,
) -> None:
    """Reminders for jobs whose follow-up service is coming due."""
    jobs = await Job.find(
        {
            "follow_up_required": True,
            "next_service_due": {
                "$gte": now,
                "$lte": now + timedelta(days=JOB_FOLLOW_UP_DAYS),
            },
        }
    ).to_list()

    names = await _customer_names(jobs)
    # Title each by the job's number (JOB-...), which is what people know it by.
    job_numbers = {
        booking.id: booking.booking_number
        for booking in await Booking.find({"_id": {"$in": [job.booking_id for job in jobs]}}).to_list()
    }

    for job in jobs:
        customer = names.get(str(job.customer_id), "a customer")
        batch.add(
            office_ids,
            NotificationType.JOB_FOLLOW_UP,
            f"Follow-up due: {job_numbers.get(job.booking_id, job.job_number)}",
            (
                f"{job.service_type} for {customer} is due for a follow-up on "
                f"{_day(job.next_service_due)}."
            ),
            f"/jobs/{job.id}",
            str(job.id),
            "job",
        )


async def _sweep_quotes(
    batch: _Batch,
    office_ids: Sequence[PydanticObjectId],
    now: datetime,
) -> None:
    """Reminders for sent quotes about to lapse."""
    quotes = await Quote.find(
        {
            "status": QuoteStatus.SENT.value,
            "valid_until": {
                "$gte": now,
                "$lte": now + timedelta(days=QUOTE_EXPIRING_DAYS),
            },
        }
    ).to_list()

    names = await _customer_names(quotes)

    for quote in quotes:
        customer = names.get(str(quote.customer_id), "a customer")
        batch.add(
            office_ids,
            NotificationType.QUOTE_EXPIRING,
            f"Quote expiring: {quote.quote_number}",
            (
                f"{_money(quote.total)} for {customer} lapses on "
                f"{_day(quote.valid_until)}. Follow it up before it expires."
            ),
            f"/quotes/{quote.id}",
            str(quote.id),
            "quote",
        )


# ---------------------------------------------------------------------------
# Event hooks, called from the job and quote services
# ---------------------------------------------------------------------------


async def notify_job_completed(
    job_id: "PydanticObjectId | str",
    user_ids: Optional[Sequence[PydanticObjectId]] = None,
) -> int:
    """Tell the office a job finished and its invoice is ready to send."""
    oid = _to_object_id(job_id)
    if oid is None:
        return 0

    try:
        job = await Job.get(oid)
        if job is None:
            return 0

        recipients = list(user_ids) if user_ids else await _office_user_ids()
        if not recipients:
            return 0

        customer = await Customer.get(job.customer_id)
        customer_name = customer.full_name if customer else "a customer"
        booking = await Booking.get(job.booking_id)

        batch = _Batch(await _recent_keys())
        batch.add(
            recipients,
            NotificationType.JOB_COMPLETED,
            f"Job completed: {booking.booking_number if booking else job.job_number}",
            (
                f"{job.service_type} for {customer_name} is finished. "
                "The draft invoice is ready to review and send."
            ),
            f"/jobs/{job.id}",
            str(job.id),
            "job",
        )

        if not batch.pending:
            return 0

        await Notification.insert_many(batch.pending)
        return len(batch.pending)
    except Exception:  # noqa: BLE001 - notifying must never break job completion
        logger.exception("Could not raise a job-completed notification for %s", job_id)
        return 0


async def notify_quote_accepted(
    quote_id: "PydanticObjectId | str",
    user_ids: Optional[Sequence[PydanticObjectId]] = None,
) -> int:
    """Tell the office a quote was accepted and a job can be booked."""
    oid = _to_object_id(quote_id)
    if oid is None:
        return 0

    try:
        quote = await Quote.get(oid)
        if quote is None:
            return 0

        recipients = list(user_ids) if user_ids else await _office_user_ids()
        if not recipients:
            return 0

        customer = await Customer.get(quote.customer_id)
        customer_name = customer.full_name if customer else "a customer"

        batch = _Batch(await _recent_keys())
        batch.add(
            recipients,
            NotificationType.QUOTE_ACCEPTED,
            f"Quote accepted: {quote.quote_number}",
            (
                f"{customer_name} accepted {_money(quote.total)}. "
                "Convert it to a booking to get the work scheduled."
            ),
            f"/quotes/{quote.id}",
            str(quote.id),
            "quote",
        )

        if not batch.pending:
            return 0

        await Notification.insert_many(batch.pending)
        return len(batch.pending)
    except Exception:  # noqa: BLE001 - notifying must never break the transition
        logger.exception("Could not raise a quote-accepted notification for %s", quote_id)
        return 0
