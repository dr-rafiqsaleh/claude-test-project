"""A message sent through the contact form on the public website."""

from datetime import datetime
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import IndexModel


class ContactEnquiry(Document):
    """One contact-form submission.

    Kept as well as emailed: a mail outage must not lose an enquiry, and the
    `emailed` / `email_error` pair shows which ones still need forwarding by
    hand. Not a TenantDocument - it arrives before anyone is signed in and
    belongs to PestBase itself, not to a client.
    """

    name: str
    email: str
    company: Optional[str] = None
    phone: Optional[str] = None
    topic: str
    message: str

    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

    emailed: bool = False
    email_error: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "contact_enquiries"
        indexes = [
            IndexModel([("created_at", -1)], name="idx_enquiry_created"),
            # The rate limit counts recent enquiries from one address.
            IndexModel([("ip_address", 1), ("created_at", -1)], name="idx_enquiry_ip_window"),
        ]
