"""Photo document model - inspection photos stored inline as base64."""

from datetime import datetime

from beanie import PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

from app.models.tenant import TenantDocument

#: Content types accepted by the photo upload endpoint.
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}

#: Hard upload limit, in bytes (10 MB).
MAX_PHOTO_BYTES = 10 * 1024 * 1024


class Photo(TenantDocument):
    """An inspection photo attached to a job."""

    job_id: PydanticObjectId
    filename: str
    content_type: str  # e.g. "image/jpeg"
    data: str  # base64-encoded image data (no data-url prefix)
    size_bytes: int
    uploaded_by: PydanticObjectId
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "photos"
        indexes = [
            IndexModel([("job_id", 1)], name="idx_job_id"),
        ]

    @property
    def data_url(self) -> str:
        """The photo as a data URL, for embedding straight into HTML."""
        return f"data:{self.content_type};base64,{self.data}"

    def __str__(self) -> str:
        return f"{self.filename} ({self.size_bytes} bytes)"
