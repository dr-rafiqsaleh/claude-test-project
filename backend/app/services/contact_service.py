"""The public website's contact form: keep the enquiry, then email it to us.

The form is open to anyone, so it is rate limited per IP address and carries a
honeypot field (see routers/contact.py). Storing comes first and emailing
second, so a mail outage costs a notification, never the enquiry itself.
"""

import logging
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.config import settings
from app.models.company_settings import CompanySettings
from app.models.contact_enquiry import ContactEnquiry
from app.models.user import User
from app.services import email_service

logger = logging.getLogger(__name__)

#: What the form offers. The website pre-selects one from ?topic=, so the
#: privacy policy can link straight to a privacy request.
TOPICS = {
    "demo": "Book a demo",
    "sales": "Pricing and plans",
    "support": "Help with PestBase",
    "privacy": "Privacy or data request",
    "other": "Something else",
}


class ContactRateLimitError(Exception):
    """Too many enquiries from one address in the window."""


async def _within_limit(ip_address: Optional[str]) -> bool:
    if not ip_address:
        return True
    since = datetime.utcnow() - timedelta(seconds=settings.CONTACT_RATE_LIMIT_WINDOW_SECONDS)
    recent = await ContactEnquiry.find(
        {"ip_address": ip_address, "created_at": {"$gte": since}}
    ).count()
    return recent < settings.CONTACT_RATE_LIMIT_MAX


def _body(enquiry: ContactEnquiry) -> str:
    lines = [
        f"A new enquiry from the PestBase website ({TOPICS.get(enquiry.topic, enquiry.topic)}).",
        "",
        f"Name:    {enquiry.name}",
        f"Email:   {enquiry.email}",
        f"Company: {enquiry.company or '-'}",
        f"Phone:   {enquiry.phone or '-'}",
        "",
        enquiry.message,
        "",
        "Reply to this email to answer them directly.",
    ]
    return "\n".join(lines)


async def _notify(enquiry: ContactEnquiry) -> None:
    """Email the enquiry to CONTACT_INBOX. Records the outcome; never raises."""
    from app.services.platform_settings_service import sending_config  # noqa: PLC0415

    if not settings.CONTACT_INBOX:
        enquiry.email_error = "CONTACT_INBOX is not set"
        return

    try:
        # The platform's mail transport, with the enquirer as the reply-to so
        # answering the notification answers them.
        config = await sending_config(
            CompanySettings(company_name="PestBase website", email_reply_to=enquiry.email)
        )
        await email_service.send(
            config,
            email_service.OutgoingEmail(
                to=[settings.CONTACT_INBOX],
                subject=f"Website enquiry: {TOPICS.get(enquiry.topic, enquiry.topic)} - {enquiry.name}",
                body=_body(enquiry),
            ),
        )
        enquiry.emailed = True
    except Exception as exc:  # noqa: BLE001 - the enquiry is kept either way
        logger.warning("Could not email contact enquiry %s: %s", enquiry.id, exc)
        enquiry.email_error = str(exc)[:500]


async def submit(data: dict, ip_address: Optional[str], user_agent: Optional[str]) -> ContactEnquiry:
    """Store an enquiry and try to email it. Raises ContactRateLimitError."""
    if not await _within_limit(ip_address):
        raise ContactRateLimitError()

    enquiry = ContactEnquiry(
        **data,
        ip_address=ip_address,
        user_agent=(user_agent or "")[:300] or None,
    )
    await enquiry.insert()

    await _notify(enquiry)
    await enquiry.save()
    logger.info("Contact enquiry %s (%s), emailed=%s", enquiry.id, enquiry.topic, enquiry.emailed)
    return enquiry


# ---------------------------------------------------------------------------
# For platform staff: the enquiries list
# ---------------------------------------------------------------------------


class EnquiryNotFoundError(Exception):
    """No enquiry with that id."""


async def list_enquiries(
    page: int, page_size: int, status: Optional[str] = None
) -> Tuple[List[ContactEnquiry], int]:
    """Newest first. `status` is "open", "handled" or None for all."""
    criteria: dict = {}
    if status == "open":
        criteria["handled_at"] = None
    elif status == "handled":
        criteria["handled_at"] = {"$ne": None}

    query = ContactEnquiry.find(criteria)
    total = await query.count()
    items = await query.sort("-created_at").skip((page - 1) * page_size).limit(page_size).to_list()
    return items, total


async def count_open() -> int:
    return await ContactEnquiry.find({"handled_at": None}).count()


async def _get(enquiry_id: str) -> ContactEnquiry:
    try:
        enquiry = await ContactEnquiry.get(PydanticObjectId(enquiry_id))
    except Exception:  # noqa: BLE001 - a malformed id is simply not found
        enquiry = None
    if enquiry is None:
        raise EnquiryNotFoundError("That enquiry no longer exists.")
    return enquiry


async def set_handled(enquiry_id: str, handled: bool, user: User) -> ContactEnquiry:
    """Mark an enquiry answered, or open it again."""
    enquiry = await _get(enquiry_id)
    if handled:
        enquiry.handled_at = datetime.utcnow()
        enquiry.handled_by = user.id
        enquiry.handled_by_name = user.full_name
    else:
        enquiry.handled_at = None
        enquiry.handled_by = None
        enquiry.handled_by_name = None
    await enquiry.save()
    return enquiry


async def resend(enquiry_id: str) -> ContactEnquiry:
    """Try the notification email again, e.g. once mail settings are fixed."""
    enquiry = await _get(enquiry_id)
    enquiry.email_error = None
    await _notify(enquiry)
    await enquiry.save()
    return enquiry
