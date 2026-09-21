"""Job and photo request/response schemas."""

from datetime import datetime, timezone
from typing import Annotated, Any, Dict, List, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

from app.models.job import JobStatus, RiskLevel, TreatmentMethod
from app.schemas.common import ApiResponse

MAX_NOTE_LENGTH = 10000
MAX_SIGNATURE_LENGTH = 2_000_000  # ~1.5 MB of base64


def _assume_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Mongo hands back naive UTC datetimes; tag them so clients get an offset."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


#: A datetime that is always serialised with an explicit UTC offset.
UtcDateTime = Annotated[datetime, AfterValidator(_assume_utc)]


def _clean_optional_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _clean_string_list(values: Optional[List[str]]) -> List[str]:
    """Trim, de-duplicate and drop blanks while preserving order."""
    if not values:
        return []
    seen: set = set()
    cleaned: List[str] = []
    for value in values:
        item = str(value).strip()
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)
    return cleaned


# ---------------------------------------------------------------------------
# Embedded report structures
# ---------------------------------------------------------------------------


class InspectionFindingSchema(BaseModel):
    """One observation recorded during the inspection (in and out)."""

    model_config = ConfigDict(from_attributes=True)

    area: str = Field(min_length=1, max_length=120)
    pest_type: str = Field(min_length=1, max_length=120)
    severity: RiskLevel = RiskLevel.LOW
    description: str = Field(default="", max_length=MAX_NOTE_LENGTH)
    recommendation: str = Field(default="", max_length=MAX_NOTE_LENGTH)
    photo_ids: List[str] = Field(default_factory=list)

    @field_validator("area", "pest_type")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("This field is required")
        return cleaned

    @field_validator("description", "recommendation")
    @classmethod
    def _strip_text(cls, value: Optional[str]) -> str:
        return (value or "").strip()

    @field_validator("photo_ids", mode="before")
    @classmethod
    def _coerce_photo_ids(cls, value: object) -> List[str]:
        if not value:
            return []
        return [str(item) for item in value if item]


class TreatmentAppliedSchema(BaseModel):
    """One treatment carried out on site (in and out)."""

    model_config = ConfigDict(from_attributes=True)

    pest_type: str = Field(min_length=1, max_length=120)
    method: TreatmentMethod = TreatmentMethod.SPRAY
    product_name: str = Field(default="", max_length=200)
    product_concentration: Optional[str] = Field(default=None, max_length=60)
    areas_treated: List[str] = Field(default_factory=list)
    quantity_used: Optional[str] = Field(default=None, max_length=60)
    safety_data_sheet_ref: Optional[str] = Field(default=None, max_length=200)

    @field_validator("pest_type")
    @classmethod
    def _strip_pest_type(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Pest type is required")
        return cleaned

    @field_validator("product_name")
    @classmethod
    def _strip_product(cls, value: Optional[str]) -> str:
        return (value or "").strip()

    @field_validator("product_concentration", "quantity_used", "safety_data_sheet_ref")
    @classmethod
    def _strip_optional(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)

    @field_validator("areas_treated")
    @classmethod
    def _clean_areas(cls, value: Optional[List[str]]) -> List[str]:
        return _clean_string_list(value)


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class JobCreate(BaseModel):
    """Payload for creating a job from a booking."""

    booking_id: str

    @field_validator("booking_id")
    @classmethod
    def _strip_booking_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A booking id is required")
        return cleaned


class JobUpdate(BaseModel):
    """Partial update of the inspection report. All fields optional."""

    findings: Optional[List[InspectionFindingSchema]] = None
    treatments: Optional[List[TreatmentAppliedSchema]] = None
    overall_risk_level: Optional[RiskLevel] = None
    inspection_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    recommendations: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    follow_up_required: Optional[bool] = None
    follow_up_notes: Optional[str] = Field(default=None, max_length=MAX_NOTE_LENGTH)
    next_service_due: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None

    @field_validator("inspection_notes", "recommendations", "follow_up_notes")
    @classmethod
    def _strip_notes(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)


class JobSignatureUpdate(BaseModel):
    """Payload for capturing the customer and technician sign-off."""

    customer_name_signed: Optional[str] = Field(default=None, max_length=200)
    customer_signature: Optional[str] = Field(default=None, max_length=MAX_SIGNATURE_LENGTH)
    technician_signature: Optional[str] = Field(default=None, max_length=MAX_SIGNATURE_LENGTH)

    @field_validator("customer_name_signed")
    @classmethod
    def _strip_name(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional_text(value)

    @field_validator("customer_signature", "technician_signature")
    @classmethod
    def _check_data_url(cls, value: Optional[str]) -> Optional[str]:
        cleaned = _clean_optional_text(value)
        if cleaned is None:
            return None
        if not cleaned.startswith("data:image/"):
            raise ValueError("A signature must be a base64 image data URL")
        return cleaned


class JobStatusUpdate(BaseModel):
    """Payload for moving a job through its lifecycle."""

    status: JobStatus


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class JobResponse(BaseModel):
    """Public representation of a job, with related names embedded."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    job_number: str
    booking_id: str
    booking_number: Optional[str] = None
    customer_id: str
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    technician_id: Optional[str] = None
    technician_name: Optional[str] = None
    status: JobStatus

    service_type: str
    pest_types: List[str] = Field(default_factory=list)
    service_address: Optional[Dict[str, Any]] = None

    scheduled_start: UtcDateTime
    scheduled_end: UtcDateTime
    actual_start: Optional[UtcDateTime] = None
    actual_end: Optional[UtcDateTime] = None
    duration_minutes: int = 0

    findings: List[InspectionFindingSchema] = Field(default_factory=list)
    treatments: List[TreatmentAppliedSchema] = Field(default_factory=list)
    overall_risk_level: Optional[RiskLevel] = None
    inspection_notes: Optional[str] = None
    recommendations: Optional[str] = None
    follow_up_required: bool = False
    follow_up_notes: Optional[str] = None
    next_service_due: Optional[UtcDateTime] = None

    customer_name_signed: Optional[str] = None
    customer_signature: Optional[str] = None
    signed_at: Optional[UtcDateTime] = None
    technician_signature: Optional[str] = None

    report_generated: bool = False
    report_generated_at: Optional[UtcDateTime] = None

    invoice_id: Optional[str] = None
    photo_count: int = 0

    created_by: str
    created_at: UtcDateTime
    updated_at: UtcDateTime

    @field_validator("id", "booking_id", "customer_id", "created_by", mode="before")
    @classmethod
    def _coerce_object_id(cls, value: object) -> str:
        return str(value)

    @field_validator("technician_id", "invoice_id", mode="before")
    @classmethod
    def _coerce_optional_object_id(cls, value: object) -> Optional[str]:
        return str(value) if value is not None else None


class JobListData(BaseModel):
    """Paginated job list payload."""

    items: List[JobResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class PhotoResponse(BaseModel):
    """Photo metadata. The base64 payload is served by its own endpoint."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    filename: str
    content_type: str
    size_bytes: int
    uploaded_by: Optional[str] = None
    uploaded_at: UtcDateTime

    @field_validator("id", "job_id", mode="before")
    @classmethod
    def _coerce_object_id(cls, value: object) -> str:
        return str(value)

    @field_validator("uploaded_by", mode="before")
    @classmethod
    def _coerce_optional_object_id(cls, value: object) -> Optional[str]:
        return str(value) if value is not None else None


class PhotoListData(BaseModel):
    """All photos attached to one job."""

    items: List[PhotoResponse] = Field(default_factory=list)
    total: int = 0


# ---------------------------------------------------------------------------
# Envelopes
# ---------------------------------------------------------------------------


class JobResponseEnvelope(ApiResponse[JobResponse]):
    """Envelope for a single job."""


class JobListResponse(ApiResponse[JobListData]):
    """Envelope for a paginated list of jobs."""


class PhotoResponseEnvelope(ApiResponse[PhotoResponse]):
    """Envelope for a single photo."""


class PhotoListResponse(ApiResponse[PhotoListData]):
    """Envelope for a job's photos."""
