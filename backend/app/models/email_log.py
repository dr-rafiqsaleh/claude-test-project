"""A permanent record of each quote, invoice and report emailed to a customer.

Kept as evidence in case a customer later says they never received
something: what was sent (every address, the subject, the message and a copy
of the PDF exactly as attached, with a SHA-256 fingerprint of it), when, by
whom, and the mail server's own reference for accepting it. Failed attempts
are kept too. Nothing in the app edits or deletes these records.
"""

from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

#: Attachments up to this size are kept byte for byte; bigger ones keep only
#: their name, size and fingerprint (MongoDB documents are capped at 16 MB).
MAX_KEPT_ATTACHMENT = 12 * 1024 * 1024


class EmailLog(Document):
    """One email sent (or attempted) from QKil, with the document it carried."""

    document_type: str  # "quote", "invoice" or "report"
    document_id: PydanticObjectId
    document_number: str
    customer_id: Optional[PydanticObjectId] = None

    # Who and what
    status: str = "sent"  # "sent", or "failed" when the provider refused it
    error: Optional[str] = None  # why it failed, as shown to the office
    from_address: Optional[str] = None
    from_name: Optional[str] = None
    reply_to: Optional[str] = None
    to: List[str] = Field(default_factory=list)
    cc: List[str] = Field(default_factory=list)
    bcc: List[str] = Field(default_factory=list)  # the office's own copy
    subject: str
    body: str = ""  # the message exactly as sent, as plain text

    # The attachment exactly as sent
    attachment_name: Optional[str] = None
    attachment_type: Optional[str] = None
    attachment_size: int = 0
    attachment_sha256: Optional[str] = None
    attachment_content: Optional[bytes] = None

    # The provider's receipt
    provider: Optional[str] = None  # "smtp" or "microsoft365"
    message_id: Optional[str] = None  # the email's Message-ID header, when known
    provider_reference: Optional[str] = None  # the server's acceptance reply / request id

    sent_by: Optional[PydanticObjectId] = None
    sent_by_name: Optional[str] = None
    sent_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "email_logs"
        indexes = [
            IndexModel(
                [("document_type", 1), ("document_id", 1), ("sent_at", -1)],
                name="idx_document_sent",
            ),
            IndexModel([("customer_id", 1), ("sent_at", -1)], name="idx_customer_sent"),
        ]
