"""A record of each quote, invoice and report emailed to a customer."""

from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel


class EmailLog(Document):
    """One email sent from QKil, with the document it carried."""

    document_type: str  # "quote", "invoice" or "report"
    document_id: PydanticObjectId
    document_number: str
    to: List[str] = Field(default_factory=list)
    cc: List[str] = Field(default_factory=list)
    subject: str
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
        ]
