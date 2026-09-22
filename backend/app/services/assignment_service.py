"""Telling a technician they have been given a job.

Always in the app (their notification bell); by email as well when email is
set up and switched on for technicians. Telling them never stops the job
being saved: a failed email comes back as a notice for the office instead.
"""

import logging
import re
from typing import Optional

from beanie import PydanticObjectId

from app.config import settings as app_settings
from app.core.uk_time import to_uk
from app.models.booking import Booking, BookingStatus, RecurrenceType
from app.models.company_settings import EmailProvider, EmailTemplates
from app.models.customer import Customer
from app.models.notification import NotificationType
from app.models.user import User
from app.services import email_service, notification_service, recurrence_service
from app.services.email_service import EmailError, OutgoingEmail

logger = logging.getLogger(__name__)

REPEAT_WORDS = {
    RecurrenceType.WEEKLY: "weekly",
    RecurrenceType.FORTNIGHTLY: "fortnightly",
    RecurrenceType.MONTHLY: "monthly",
    RecurrenceType.QUARTERLY: "quarterly",
}


def _day(value) -> str:
    return to_uk(value).strftime("%A %d %B %Y").replace(" 0", " ")


def _clock(value) -> str:
    return to_uk(value).strftime("%H:%M")


def _address(booking: Booking, customer: Optional[Customer]) -> str:
    address = booking.service_address or {}
    parts = [str(address.get(key)).strip() for key in ("street", "city", "postcode") if address.get(key)]
    if parts:
        return ", ".join(parts)
    return customer.address.one_line() if customer else "Address not recorded"


async def _repeats_line(booking: Booking) -> str:
    """"This is a monthly job: 11 more visits are booked, the next on ..." or ""."""
    head = await recurrence_service.series_head(booking)
    if head is None:
        return ""
    later = await Booking.find(
        {
            "parent_booking_id": head.id,
            "scheduled_start": {"$gt": booking.scheduled_start},
            "status": {"$in": [BookingStatus.SCHEDULED.value, BookingStatus.CONFIRMED.value]},
            "technician_id": booking.technician_id,
        }
    ).sort("scheduled_start").to_list()
    if not later:
        return f"This visit is part of a {REPEAT_WORDS.get(head.recurrence, 'repeating')} job."
    visits = "visit is" if len(later) == 1 else "visits are"
    return (
        f"This is a {REPEAT_WORDS.get(head.recurrence, 'repeating')} job: {len(later)} more "
        f"{visits} booked for you, the next on {_day(later[0].scheduled_start)}. Dates may still "
        "change until the office confirms them with the customer."
    )


async def notify_if_assigned(
    booking: Booking,
    technician: Optional[User],
    customer: Optional[Customer],
    previous_technician_id: Optional[PydanticObjectId],
) -> Optional[str]:
    """Tell the technician if this save gave them the job. Returns a notice for the office."""
    if technician is None or booking.technician_id is None:
        return None
    if booking.technician_id == previous_technician_id:
        return None
    if booking.status in (BookingStatus.COMPLETED, BookingStatus.CANCELLED):
        return None

    customer_name = customer.full_name if customer else "a customer"
    when = f"{_day(booking.scheduled_start)} at {_clock(booking.scheduled_start)}"
    repeats = await _repeats_line(booking)

    try:
        await notification_service.create_notification(
            technician.id,
            NotificationType.JOB_ASSIGNED,
            title=f"New job {booking.booking_number}",
            message=f"{booking.service_type} for {customer_name}, {when}. {repeats}".strip(),
            link=f"/bookings/{booking.id}",
            related_id=str(booking.id),
            related_type="booking",
        )
    except Exception:  # noqa: BLE001 - the job is saved either way
        logger.exception("Could not notify technician %s in the app", technician.id)

    from app.services.company_settings_service import get_settings  # noqa: PLC0415

    company = await get_settings()
    if not company.email_technicians:
        return f"{technician.full_name} can see it in QKil (emailing technicians is switched off)."
    if company.email_provider == EmailProvider.NONE:
        return f"{technician.full_name} can see it in QKil. Set up email to email them too."

    template = (company.email_templates or EmailTemplates()).job_assigned
    site_contact = ", ".join(
        part for part in (booking.site_contact_name, booking.site_contact_phone) if part
    )
    context = {
        "technician_name": technician.full_name.split(" ")[0],
        "job_number": booking.booking_number,
        "job_date": _day(booking.scheduled_start),
        "job_time": f"{_clock(booking.scheduled_start)} to {_clock(booking.scheduled_end)}",
        "service_type": booking.service_type,
        "pest_types": ", ".join(booking.pest_types) or "not specified",
        "site_address": _address(booking, customer),
        "site_contact": site_contact or "the customer",
        "customer_name": customer_name,
        "customer_phone": customer.phone if customer else "",
        "technician_notes": booking.technician_notes or "None",
        "repeats": repeats,
        "job_link": f"{app_settings.FRONTEND_URL.rstrip('/')}/bookings/{booking.id}",
        "company_name": company.company_name,
        "company_phone": company.phone or "",
        "company_email": company.email or "",
        "sender_name": company.company_name,
    }
    body = re.sub(r"\n{3,}", "\n\n", email_service.render(template.body, context)).strip()

    try:
        await email_service.send(
            company,
            OutgoingEmail(
                to=[technician.email],
                subject=email_service.render(template.subject, context),
                body=body,
            ),
        )
    except EmailError as exc:
        logger.warning("Could not email technician %s: %s", technician.email, exc)
        return f"{technician.full_name} can see it in QKil, but couldn't be emailed: {exc}"
    return f"{technician.full_name} has been emailed the details."
