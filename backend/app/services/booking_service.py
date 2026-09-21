"""Booking CRUD, lifecycle transitions, calendar feed and availability."""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple

from beanie import PydanticObjectId

from app.models.booking import (
    EDITABLE_STATUSES,
    STATUS_COLORS,
    Booking,
    BookingStatus,
    RecurrenceType,
)
from app.models.counter import BOOKING_COUNTER, Counter
from app.models.customer import Customer
from app.models.quote import Quote, QuoteStatus
from app.models.user import User, UserRole
from app.schemas.booking import BookingCreate, BookingUpdate, QuoteToBookingRequest

#: Allowed status transitions for the booking lifecycle.
ALLOWED_TRANSITIONS: Dict[BookingStatus, Set[BookingStatus]] = {
    BookingStatus.SCHEDULED: {
        BookingStatus.CONFIRMED,
        BookingStatus.IN_PROGRESS,
        BookingStatus.CANCELLED,
    },
    BookingStatus.CONFIRMED: {BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED},
    BookingStatus.IN_PROGRESS: {BookingStatus.COMPLETED, BookingStatus.CANCELLED},
    BookingStatus.COMPLETED: set(),
    BookingStatus.CANCELLED: set(),
}

#: Statuses a booking may be deleted from.
DELETABLE_STATUSES = {BookingStatus.SCHEDULED, BookingStatus.CANCELLED}

DEFAULT_SERVICE_TYPE = "General Pest Control"


class BookingNotFoundError(Exception):
    """Raised when a booking cannot be located."""


class BookingStateError(Exception):
    """Raised when an operation is not valid for the booking's current status."""


class CustomerNotFoundError(Exception):
    """Raised when the referenced customer does not exist."""


class TechnicianNotFoundError(Exception):
    """Raised when the referenced technician does not exist or is not a technician."""


class QuoteNotFoundError(Exception):
    """Raised when the referenced quote does not exist."""


class QuoteNotConvertibleError(Exception):
    """Raised when a quote cannot be turned into a booking."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _escape_regex(value: str) -> str:
    """Escape regex metacharacters so user input is treated literally."""
    specials = r"\^$.|?*+()[]{}"
    return "".join("\\" + ch if ch in specials else ch for ch in value)


def _to_object_id(value: "PydanticObjectId | str | None") -> Optional[PydanticObjectId]:
    if value is None:
        return None
    try:
        return value if isinstance(value, PydanticObjectId) else PydanticObjectId(str(value))
    except Exception:  # noqa: BLE001 - invalid object id string
        return None


async def _resolve_customer(customer_id: "PydanticObjectId | str") -> Customer:
    oid = _to_object_id(customer_id)
    if oid is None:
        raise CustomerNotFoundError("Customer not found")
    customer = await Customer.get(oid)
    if customer is None:
        raise CustomerNotFoundError("Customer not found")
    return customer


async def _resolve_technician(technician_id: "PydanticObjectId | str") -> User:
    oid = _to_object_id(technician_id)
    if oid is None:
        raise TechnicianNotFoundError("Technician not found")
    technician = await User.get(oid)
    if technician is None:
        raise TechnicianNotFoundError("Technician not found")
    if technician.role != UserRole.TECHNICIAN:
        raise TechnicianNotFoundError(f"{technician.full_name} is not a technician")
    return technician


def build_booking_payload(
    booking: Booking,
    customer: Optional[Customer] = None,
    technician: Optional[User] = None,
    quote: Optional[Quote] = None,
) -> dict:
    """Flatten a booking (plus its relations) into the shape BookingResponse expects."""
    return {
        "id": str(booking.id),
        "booking_number": booking.booking_number,
        "customer_id": str(booking.customer_id),
        "customer_name": customer.full_name if customer else None,
        "customer_phone": customer.phone if customer else None,
        "customer_address": customer.address.one_line() if customer else None,
        "quote_id": str(booking.quote_id) if booking.quote_id else None,
        "quote_number": quote.quote_number if quote else None,
        "job_id": str(booking.job_id) if booking.job_id else None,
        "technician_id": str(booking.technician_id) if booking.technician_id else None,
        "technician_name": technician.full_name if technician else None,
        "status": booking.status,
        "scheduled_start": booking.scheduled_start,
        "scheduled_end": booking.scheduled_end,
        "actual_start": booking.actual_start,
        "actual_end": booking.actual_end,
        "service_type": booking.service_type,
        "pest_types": list(booking.pest_types or []),
        "service_address": booking.service_address,
        "site_contact_name": booking.site_contact_name,
        "site_contact_phone": booking.site_contact_phone,
        "order_number": booking.order_number,
        "recurrence": booking.recurrence,
        "parent_booking_id": str(booking.parent_booking_id) if booking.parent_booking_id else None,
        "technician_notes": booking.technician_notes,
        "internal_notes": booking.internal_notes,
        "customer_notes": booking.customer_notes,
        "estimated_duration_minutes": booking.estimated_duration_minutes,
        "duration_minutes": booking.duration_minutes,
        "quoted_amount": booking.quoted_amount,
        "cancellation_reason": booking.cancellation_reason,
        "created_by": str(booking.created_by),
        "created_at": booking.created_at,
        "updated_at": booking.updated_at,
    }


async def _load_relations(
    bookings: List[Booking],
) -> Tuple[Dict[str, Customer], Dict[str, User], Dict[str, Quote]]:
    """Bulk-load the customers, technicians and quotes referenced by a page of bookings."""
    customer_ids = list({booking.customer_id for booking in bookings})
    technician_ids = list({b.technician_id for b in bookings if b.technician_id is not None})
    quote_ids = list({b.quote_id for b in bookings if b.quote_id is not None})

    customers: Dict[str, Customer] = {}
    technicians: Dict[str, User] = {}
    quotes: Dict[str, Quote] = {}

    if customer_ids:
        found = await Customer.find({"_id": {"$in": customer_ids}}).to_list()
        customers = {str(item.id): item for item in found}

    if technician_ids:
        found = await User.find({"_id": {"$in": technician_ids}}).to_list()
        technicians = {str(item.id): item for item in found}

    if quote_ids:
        found = await Quote.find({"_id": {"$in": quote_ids}}).to_list()
        quotes = {str(item.id): item for item in found}

    return customers, technicians, quotes


# ---------------------------------------------------------------------------
# Numbering
# ---------------------------------------------------------------------------


async def get_next_booking_number() -> str:
    """Atomically increment the booking counter and format it as JOB-0001.

    The prefix comes from company settings.
    """
    from app.services.company_settings_service import get_prefix  # noqa: PLC0415

    return await Counter.next_number(BOOKING_COUNTER, prefix=await get_prefix("booking"))


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def create_booking(
    payload: BookingCreate,
    created_by: PydanticObjectId,
) -> Tuple[Booking, Optional[Customer], Optional[User], Optional[Quote]]:
    """Create a booking with an auto-generated booking number."""
    customer = await _resolve_customer(payload.customer_id)

    technician: Optional[User] = None
    if payload.technician_id:
        technician = await _resolve_technician(payload.technician_id)

    quote: Optional[Quote] = None
    quote_oid = _to_object_id(payload.quote_id) if payload.quote_id else None
    if payload.quote_id:
        if quote_oid is None:
            raise QuoteNotFoundError("Quote not found")
        quote = await Quote.get(quote_oid)
        if quote is None:
            raise QuoteNotFoundError("Quote not found")

    now = datetime.utcnow()
    booking = Booking(
        booking_number=await get_next_booking_number(),
        customer_id=customer.id,
        quote_id=quote.id if quote else None,
        technician_id=technician.id if technician else None,
        status=BookingStatus.SCHEDULED,
        scheduled_start=payload.scheduled_start,
        scheduled_end=payload.scheduled_end,
        service_type=payload.service_type,
        pest_types=payload.pest_types,
        service_address=payload.service_address,
        site_contact_name=payload.site_contact_name,
        site_contact_phone=payload.site_contact_phone,
        order_number=payload.order_number,
        recurrence=payload.recurrence,
        technician_notes=payload.technician_notes,
        internal_notes=payload.internal_notes,
        customer_notes=payload.customer_notes,
        estimated_duration_minutes=payload.estimated_duration_minutes,
        quoted_amount=payload.quoted_amount,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    await booking.insert()

    # Keep the quote in sync when a booking is created straight against it.
    if quote is not None and not quote.converted_to_booking:
        quote.converted_to_booking = True
        quote.booking_id = booking.id
        quote.touch()
        await quote.save()

    return booking, customer, technician, quote


def _derive_from_quote(quote: Quote) -> Tuple[str, List[str]]:
    """Pull a sensible service type and pest list out of a quote's line items."""
    service_type = DEFAULT_SERVICE_TYPE
    for item in quote.items:
        if item.service_type:
            service_type = item.service_type
            break

    pest_types: List[str] = []
    seen: Set[str] = set()
    for item in quote.items:
        if not item.pest_type:
            continue
        key = item.pest_type.strip().lower()
        if key and key not in seen:
            seen.add(key)
            pest_types.append(item.pest_type.strip())

    return service_type, pest_types


async def create_booking_from_quote(
    quote_id: "PydanticObjectId | str",
    payload: QuoteToBookingRequest,
    created_by: PydanticObjectId,
) -> Tuple[Booking, Optional[Customer], Optional[User], Optional[Quote]]:
    """Convert an accepted quote into a booking and flag the quote as converted."""
    quote_oid = _to_object_id(quote_id)
    if quote_oid is None:
        raise QuoteNotFoundError("Quote not found")

    quote = await Quote.get(quote_oid)
    if quote is None:
        raise QuoteNotFoundError("Quote not found")

    if quote.status != QuoteStatus.ACCEPTED:
        raise QuoteNotConvertibleError("Only an accepted quote can be converted to a booking")

    if quote.converted_to_booking:
        raise QuoteNotConvertibleError("This quote has already been converted to a booking")

    customer = await _resolve_customer(quote.customer_id)

    technician: Optional[User] = None
    if payload.technician_id:
        technician = await _resolve_technician(payload.technician_id)

    derived_service_type, derived_pest_types = _derive_from_quote(quote)
    duration = payload.estimated_duration_minutes
    if duration is None:
        delta = payload.scheduled_end - payload.scheduled_start
        duration = max(int(delta.total_seconds() // 60), 5)

    now = datetime.utcnow()
    booking = Booking(
        booking_number=await get_next_booking_number(),
        customer_id=customer.id,
        quote_id=quote.id,
        technician_id=technician.id if technician else None,
        status=BookingStatus.SCHEDULED,
        scheduled_start=payload.scheduled_start,
        scheduled_end=payload.scheduled_end,
        service_type=payload.service_type or derived_service_type,
        pest_types=payload.pest_types if payload.pest_types is not None else derived_pest_types,
        service_address=payload.service_address,
        site_contact_name=payload.site_contact_name,
        site_contact_phone=payload.site_contact_phone,
        order_number=payload.order_number,
        recurrence=payload.recurrence,
        technician_notes=payload.technician_notes,
        internal_notes=payload.internal_notes,
        customer_notes=payload.customer_notes or quote.notes,
        estimated_duration_minutes=duration,
        quoted_amount=payload.quoted_amount if payload.quoted_amount is not None else quote.total,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    await booking.insert()

    quote.converted_to_booking = True
    quote.booking_id = booking.id
    quote.touch()
    await quote.save()

    return booking, customer, technician, quote


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


def _end_of_day(value: datetime) -> datetime:
    """Push a date-only filter out to the last microsecond of that day."""
    if value.hour or value.minute or value.second or value.microsecond:
        return value
    # replace() keeps any tzinfo the client sent, unlike datetime.combine().
    return value.replace(hour=23, minute=59, second=59, microsecond=999999)


async def list_bookings(
    page: int = 1,
    page_size: int = 20,
    status: Optional[BookingStatus] = None,
    technician_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    q: Optional[str] = None,
    no_job: Optional[bool] = None,
) -> Tuple[List[dict], int]:
    """Return a page of booking payloads (names embedded) plus the total count."""
    criteria: dict = {}

    if status is not None:
        criteria["status"] = status.value

    if no_job is True:
        criteria["job_id"] = None
    elif no_job is False:
        criteria["job_id"] = {"$ne": None}

    if technician_id:
        technician_oid = _to_object_id(technician_id)
        if technician_oid is None:
            return [], 0
        criteria["technician_id"] = technician_oid

    if customer_id:
        customer_oid = _to_object_id(customer_id)
        if customer_oid is None:
            return [], 0
        criteria["customer_id"] = customer_oid

    date_filter: dict = {}
    if date_from is not None:
        date_filter["$gte"] = date_from
    if date_to is not None:
        date_filter["$lte"] = _end_of_day(date_to)
    if date_filter:
        criteria["scheduled_start"] = date_filter

    if q and q.strip():
        escaped = _escape_regex(q.strip())
        matching_customers = await Customer.find(
            {
                "$or": [
                    {"first_name": {"$regex": escaped, "$options": "i"}},
                    {"last_name": {"$regex": escaped, "$options": "i"}},
                ]
            }
        ).to_list()
        matched_ids = [customer.id for customer in matching_customers]

        or_clauses: List[dict] = [
            {"booking_number": {"$regex": escaped, "$options": "i"}},
            {"service_type": {"$regex": escaped, "$options": "i"}},
        ]
        if matched_ids:
            or_clauses.append({"customer_id": {"$in": matched_ids}})
        criteria["$or"] = or_clauses

    query = Booking.find(criteria) if criteria else Booking.find_all()

    total = await query.count()
    skip = max(page - 1, 0) * page_size
    bookings = await query.sort("-scheduled_start").skip(skip).limit(page_size).to_list()

    customers, technicians, quotes = await _load_relations(bookings)
    payloads = [
        build_booking_payload(
            booking,
            customers.get(str(booking.customer_id)),
            technicians.get(str(booking.technician_id)) if booking.technician_id else None,
            quotes.get(str(booking.quote_id)) if booking.quote_id else None,
        )
        for booking in bookings
    ]
    return payloads, total


async def get_booking(
    booking_id: "PydanticObjectId | str",
) -> Tuple[Booking, Optional[Customer], Optional[User], Optional[Quote]]:
    """Fetch a booking with its customer, technician and quote."""
    oid = _to_object_id(booking_id)
    if oid is None:
        raise BookingNotFoundError("Booking not found")

    booking = await Booking.get(oid)
    if booking is None:
        raise BookingNotFoundError("Booking not found")

    customer = await Customer.get(booking.customer_id)
    technician = await User.get(booking.technician_id) if booking.technician_id else None
    quote = await Quote.get(booking.quote_id) if booking.quote_id else None
    return booking, customer, technician, quote


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


async def update_booking(
    booking_id: "PydanticObjectId | str",
    payload: BookingUpdate,
) -> Tuple[Booking, Optional[Customer], Optional[User], Optional[Quote]]:
    """Apply a partial update. Only scheduled or confirmed bookings can be edited."""
    booking, customer, technician, quote = await get_booking(booking_id)

    if booking.status not in EDITABLE_STATUSES:
        raise BookingStateError(f"A {booking.status.value} booking can no longer be edited")

    data = payload.model_dump(exclude_unset=True)

    if "customer_id" in data and data["customer_id"]:
        customer = await _resolve_customer(str(data["customer_id"]))
        booking.customer_id = customer.id

    if "technician_id" in data:
        if data["technician_id"]:
            technician = await _resolve_technician(str(data["technician_id"]))
            booking.technician_id = technician.id
        else:
            technician = None
            booking.technician_id = None

    if "quote_id" in data:
        if data["quote_id"]:
            quote_oid = _to_object_id(str(data["quote_id"]))
            if quote_oid is None:
                raise QuoteNotFoundError("Quote not found")
            next_quote = await Quote.get(quote_oid)
            if next_quote is None:
                raise QuoteNotFoundError("Quote not found")
            quote = next_quote
            booking.quote_id = next_quote.id
        else:
            quote = None
            booking.quote_id = None

    start = data.get("scheduled_start") or booking.scheduled_start
    end = data.get("scheduled_end") or booking.scheduled_end
    if end <= start:
        raise BookingStateError("The end time must be after the start time")
    booking.scheduled_start = start
    booking.scheduled_end = end

    if "service_type" in data and data["service_type"]:
        booking.service_type = data["service_type"]

    if "pest_types" in data and data["pest_types"] is not None:
        booking.pest_types = data["pest_types"]

    if "service_address" in data:
        booking.service_address = data["service_address"]

    if "recurrence" in data and data["recurrence"] is not None:
        booking.recurrence = RecurrenceType(data["recurrence"])

    for field in (
        "technician_notes",
        "internal_notes",
        "customer_notes",
        "site_contact_name",
        "site_contact_phone",
        "order_number",
    ):
        if field in data:
            setattr(booking, field, data[field])

    if "estimated_duration_minutes" in data and data["estimated_duration_minutes"] is not None:
        booking.estimated_duration_minutes = int(data["estimated_duration_minutes"])

    if "quoted_amount" in data:
        booking.quoted_amount = data["quoted_amount"]

    booking.touch()
    await booking.save()
    return booking, customer, technician, quote


async def update_status(
    booking_id: "PydanticObjectId | str",
    status: BookingStatus,
    reason: Optional[str] = None,
    user_id: Optional[PydanticObjectId] = None,
) -> Tuple[Booking, Optional[Customer], Optional[User], Optional[Quote]]:
    """Move a booking to a new status, enforcing the lifecycle state machine.

    The booking's job follows it (see job_service.sync_job_with_booking), and a
    visit can only be completed once its report has something in it.
    """
    # Imported lazily: job_service imports the booking model at module scope.
    from app.services import job_service  # noqa: PLC0415

    booking, customer, technician, quote = await get_booking(booking_id)

    if status == booking.status:
        raise BookingStateError(f"Booking is already {status.value}")

    allowed = ALLOWED_TRANSITIONS.get(booking.status, set())
    if status not in allowed:
        raise BookingStateError(
            f"Cannot change a {booking.status.value} booking to {status.value}"
        )

    if status == BookingStatus.COMPLETED:
        job = await job_service.find_job_for_booking(booking)
        if job is None or not job_service.report_has_content(job):
            raise BookingStateError(job_service.REPORT_EMPTY_MESSAGE)

    now = datetime.utcnow()
    booking.status = status

    if status == BookingStatus.IN_PROGRESS:
        booking.actual_start = now
    elif status == BookingStatus.COMPLETED:
        booking.actual_end = now
        if booking.actual_start is None:
            booking.actual_start = booking.scheduled_start
    elif status == BookingStatus.CANCELLED:
        booking.cancellation_reason = reason

    booking.touch()
    await booking.save()
    await job_service.sync_job_with_booking(booking, user_id or booking.created_by)
    return booking, customer, technician, quote


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------


async def get_calendar_events(
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    technician_id: Optional[str] = None,
) -> List[dict]:
    """Return bookings in a date range, shaped for FullCalendar."""
    criteria: dict = {}

    date_filter: dict = {}
    if date_from is not None:
        date_filter["$gte"] = date_from
    if date_to is not None:
        date_filter["$lte"] = _end_of_day(date_to)
    if date_filter:
        criteria["scheduled_start"] = date_filter

    if technician_id:
        technician_oid = _to_object_id(technician_id)
        if technician_oid is None:
            return []
        criteria["technician_id"] = technician_oid

    query = Booking.find(criteria) if criteria else Booking.find_all()
    bookings = await query.sort("scheduled_start").to_list()

    customers, technicians, _quotes = await _load_relations(bookings)

    events: List[dict] = []
    for booking in bookings:
        customer = customers.get(str(booking.customer_id))
        technician = (
            technicians.get(str(booking.technician_id)) if booking.technician_id else None
        )
        customer_name = customer.full_name if customer else "Unknown customer"

        events.append(
            {
                "id": str(booking.id),
                "title": f"{customer_name} - {booking.service_type}",
                "start": booking.scheduled_start,
                "end": booking.scheduled_end,
                "color": STATUS_COLORS.get(booking.status, "#6366f1"),
                "extendedProps": {
                    "status": booking.status,
                    "booking_number": booking.booking_number,
                    "customer_name": customer_name,
                    "technician_name": technician.full_name if technician else None,
                    "service_type": booking.service_type,
                },
            }
        )

    return events


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def delete_booking(booking_id: "PydanticObjectId | str") -> Booking:
    """Hard-delete a booking. Only scheduled or cancelled bookings can be removed."""
    booking, _customer, _technician, quote = await get_booking(booking_id)

    if booking.status not in DELETABLE_STATUSES:
        raise BookingStateError(
            f"A {booking.status.value} booking cannot be deleted"
        )

    # Release the quote so it can be converted again.
    if quote is not None and quote.booking_id == booking.id:
        quote.converted_to_booking = False
        quote.booking_id = None
        quote.touch()
        await quote.save()

    await booking.delete()
    return booking


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------


async def get_technician_availability(
    technician_id: "PydanticObjectId | str",
    day: datetime,
) -> dict:
    """Return the booked time slots for one technician on one day."""
    technician_oid = _to_object_id(technician_id)
    if technician_oid is None:
        raise TechnicianNotFoundError("Technician not found")

    technician = await User.get(technician_oid)
    if technician is None:
        raise TechnicianNotFoundError("Technician not found")

    # replace() keeps any tzinfo the caller sent, unlike datetime.combine().
    day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    bookings = await Booking.find(
        {
            "technician_id": technician_oid,
            "scheduled_start": {"$gte": day_start, "$lt": day_end},
            "status": {"$ne": BookingStatus.CANCELLED.value},
        }
    ).sort("scheduled_start").to_list()

    customers, _technicians, _quotes = await _load_relations(bookings)

    slots = [
        {
            "booking_id": str(booking.id),
            "booking_number": booking.booking_number,
            "start": booking.scheduled_start,
            "end": booking.scheduled_end,
            "status": booking.status,
            "service_type": booking.service_type,
            "customer_name": (
                customers[str(booking.customer_id)].full_name
                if str(booking.customer_id) in customers
                else None
            ),
        }
        for booking in bookings
    ]

    return {
        "technician_id": str(technician.id),
        "technician_name": technician.full_name,
        "date": day_start.date().isoformat(),
        "booked_slots": slots,
    }


async def count_bookings(status: Optional[BookingStatus] = None) -> int:
    """Count bookings, optionally filtered by status."""
    if status is None:
        return await Booking.find_all().count()
    return await Booking.find({"status": status.value}).count()


async def list_technicians() -> List[User]:
    """Return the active technicians available for assignment."""
    return await User.find(
        {"role": UserRole.TECHNICIAN.value, "is_active": True}
    ).sort("full_name").to_list()
