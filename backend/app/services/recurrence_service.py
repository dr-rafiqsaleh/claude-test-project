"""Repeating jobs: booking the visits of a series ahead of time.

The first visit of a repeating job heads its series. From it, QKil books every
later visit up to a year ahead, as tentative ("scheduled") visits the office
confirms with the customer, or moves, before the day. The series tops itself
up as time passes (from the reminder sweep), so there is always a year booked,
until an optional end date.

Visits are worked out in UK clock time, so a 10:00 visit stays at 10:00 when
the clocks change. Monthly visits keep their day of the month, falling back to
the last day in shorter months (31 January, then 28 February, then 31 March).
"""

import calendar
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from app.core.uk_time import from_uk, to_uk
from app.models.booking import Booking, BookingStatus, RecurrenceType

logger = logging.getLogger(__name__)

#: How far ahead a series is booked.
HORIZON_DAYS = 365

#: A visit the office has not confirmed yet, and nothing has happened to.
TENTATIVE = BookingStatus.SCHEDULED

#: Fields copied from the head to each generated visit.
COPIED_FIELDS = (
    "customer_id",
    "technician_id",
    "service_type",
    "pest_types",
    "service_address",
    "site_contact_name",
    "site_contact_phone",
    "order_number",
    "technician_notes",
    "internal_notes",
    "customer_notes",
    "estimated_duration_minutes",
    "quoted_amount",
    "created_by",
)

#: Fields "apply to later visits" copies across, besides the time of day.
SHARED_FIELDS = tuple(field for field in COPIED_FIELDS if field not in ("customer_id", "created_by"))


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def occurrence_start(anchor: datetime, recurrence: RecurrenceType, index: int) -> datetime:
    """When visit `index` of a series starts (UTC), counted from its anchor."""
    local = to_uk(anchor)
    if recurrence == RecurrenceType.WEEKLY:
        local = local + timedelta(days=7 * index)
    elif recurrence == RecurrenceType.FORTNIGHTLY:
        local = local + timedelta(days=14 * index)
    elif recurrence == RecurrenceType.MONTHLY:
        local = _add_months(local, index)
    elif recurrence == RecurrenceType.QUARTERLY:
        local = _add_months(local, 3 * index)
    return from_uk(local)


def _horizon(head: Booking, now: datetime) -> datetime:
    horizon = max(head.scheduled_start, now) + timedelta(days=HORIZON_DAYS)
    if head.recurrence_until is not None:
        # The end date is a day: visits on it still count.
        horizon = min(horizon, head.recurrence_until.replace(hour=23, minute=59) + timedelta(seconds=59))
    return horizon


async def series_head(booking: Booking) -> Optional[Booking]:
    """The first visit of the series a booking belongs to, or None for a one-off."""
    if booking.parent_booking_id is not None:
        return await Booking.get(booking.parent_booking_id)
    return booking if booking.recurrence != RecurrenceType.NONE else None


async def extend_series(head: Booking, now: Optional[datetime] = None) -> List[Booking]:
    """Book any missing visits of a series up to a year ahead. Returns the new ones.

    Visits are only ever added after the last one generated, so a visit the
    office deleted (a month the customer skipped) is never booked again, and
    a visit that was moved stays where it was moved to.
    """
    from app.services.booking_service import get_next_booking_number  # noqa: PLC0415

    if head.recurrence == RecurrenceType.NONE or head.parent_booking_id is not None:
        return []
    if head.status == BookingStatus.CANCELLED:
        return []

    now = now or datetime.utcnow()
    horizon = _horizon(head, now)
    duration = head.scheduled_end - head.scheduled_start
    created: List[Booking] = []
    changed = head.series_anchor is None
    if changed:
        head.series_anchor = head.scheduled_start

    index = head.series_last_index + 1
    while True:
        start = occurrence_start(head.series_anchor, head.recurrence, index)
        # A year ahead means up to, not including, the same day next year.
        if start >= horizon:
            break
        visit = Booking(
            booking_number=await get_next_booking_number(),
            status=TENTATIVE,
            scheduled_start=start,
            scheduled_end=start + duration,
            parent_booking_id=head.id,
            series_index=index,
            **{field: getattr(head, field) for field in COPIED_FIELDS},
        )
        await visit.insert()
        created.append(visit)
        head.series_last_index = index
        index += 1

    if created or changed:
        head.touch()
        await head.save()
    if created:
        logger.info("Booked %d visit(s) ahead for series %s", len(created), head.booking_number)
    return created


async def later_tentative_visits(head: Booking, after: datetime) -> List[Booking]:
    """The series' visits after `after` that are still waiting to be confirmed."""
    return await Booking.find(
        {
            "parent_booking_id": head.id,
            "status": TENTATIVE.value,
            "job_id": None,
            "scheduled_start": {"$gt": after},
        }
    ).sort("scheduled_start").to_list()


async def restart_series(head: Booking, now: Optional[datetime] = None) -> Tuple[int, List[Booking]]:
    """After the repeat pattern changes: rebook the unconfirmed future visits.

    Confirmed, started and finished visits are kept. Returns
    (visits removed, visits booked).
    """
    now = now or datetime.utcnow()
    removed = await later_tentative_visits(head, now)
    for visit in removed:
        await visit.delete()

    if head.recurrence == RecurrenceType.NONE:
        head.series_last_index = 0
        head.series_anchor = None
        head.touch()
        await head.save()
        return len(removed), []

    # The new pattern counts from the first visit as it now stands, and
    # carries on after the last visit that is staying.
    head.series_anchor = head.scheduled_start
    kept = await Booking.find({"parent_booking_id": head.id}).sort("-scheduled_start").limit(1).to_list()
    after = max([now] + [visit.scheduled_start for visit in kept])
    index = 1
    while occurrence_start(head.series_anchor, head.recurrence, index) <= after:
        index += 1
    head.series_last_index = index - 1
    head.touch()
    await head.save()
    return len(removed), await extend_series(head, now)


async def apply_to_later_visits(visit: Booking, changed: dict) -> int:
    """Copy a visit's changes to the later, unconfirmed visits of its series.

    `changed` holds the fields that were edited. A new time of day moves each
    later visit to that time on its own date. Returns how many were updated.
    """
    head = await series_head(visit)
    if head is None:
        return 0

    fields = [field for field in SHARED_FIELDS if field in changed]
    move_time = "scheduled_start" in changed or "scheduled_end" in changed
    local_start = to_uk(visit.scheduled_start)
    duration = visit.scheduled_end - visit.scheduled_start

    updated = 0
    for later in await later_tentative_visits(head, visit.scheduled_start):
        for field in fields:
            setattr(later, field, getattr(visit, field))
        if move_time:
            day = to_uk(later.scheduled_start)
            start = from_uk(day.replace(hour=local_start.hour, minute=local_start.minute, second=0, microsecond=0))
            later.scheduled_start = start
            later.scheduled_end = start + duration
        later.touch()
        await later.save()
        updated += 1

    # Visits booked from now on follow the change too.
    if head.id != visit.id and fields:
        for field in fields:
            setattr(head, field, getattr(visit, field))
        head.touch()
        await head.save()
    return updated


async def stop_series(booking: Booking, now: Optional[datetime] = None) -> Tuple[int, int]:
    """Stop a repeating job after this visit. Returns (removed, kept confirmed).

    Later visits still waiting to be confirmed are removed; later visits
    already confirmed with the customer are kept, and counted, so the office
    can deal with them.
    """
    now = now or datetime.utcnow()
    head = await series_head(booking)
    if head is None:
        return 0, 0

    cut_off = max(booking.scheduled_start, now)
    removed = await later_tentative_visits(head, cut_off)
    for visit in removed:
        await visit.delete()

    kept = await Booking.find(
        {
            "parent_booking_id": head.id,
            "scheduled_start": {"$gt": cut_off},
            "status": {"$in": [BookingStatus.CONFIRMED.value]},
        }
    ).count()

    head.recurrence_until = booking.scheduled_start
    head.touch()
    await head.save()
    return len(removed), kept


async def extend_all_series(now: Optional[datetime] = None) -> int:
    """Top up every repeating job to a year ahead. Safe to call as often as you like."""
    now = now or datetime.utcnow()
    heads = await Booking.find(
        {
            "parent_booking_id": None,
            "recurrence": {"$ne": RecurrenceType.NONE.value},
            "status": {"$ne": BookingStatus.CANCELLED.value},
            "$or": [{"recurrence_until": None}, {"recurrence_until": {"$gte": now}}],
        }
    ).to_list()
    total = 0
    for head in heads:
        total += len(await extend_series(head, now))
    return total


async def series_info(booking: Booking) -> dict:
    """What a booking's page shows about the series it belongs to."""
    head = await series_head(booking)
    if head is None:
        return {}
    upcoming = await Booking.find(
        {
            "parent_booking_id": head.id,
            "scheduled_start": {"$gt": datetime.utcnow()},
            "status": {"$in": [BookingStatus.SCHEDULED.value, BookingStatus.CONFIRMED.value]},
        }
    ).to_list()
    return {
        "series_head_id": str(head.id),
        "series_head_number": head.booking_number,
        "series_recurrence": head.recurrence,
        "series_until": head.recurrence_until,
        "series_upcoming": len(upcoming),
        "series_to_confirm": sum(1 for visit in upcoming if visit.status == TENTATIVE),
    }

