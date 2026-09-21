"""Company settings request/response schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.common import ApiResponse


class CompanySettingsUpdate(BaseModel):
    """Partial update - every field is optional."""

    company_name: Optional[str] = Field(None, min_length=1, max_length=160)
    company_number: Optional[str] = Field(None, max_length=40)
    vat_number: Optional[str] = Field(None, max_length=40)

    phone: Optional[str] = Field(None, max_length=40)
    email: Optional[str] = Field(None, max_length=160)
    website: Optional[str] = Field(None, max_length=200)

    address_street: Optional[str] = Field(None, max_length=200)
    address_city: Optional[str] = Field(None, max_length=100)
    address_county: Optional[str] = Field(None, max_length=40)
    address_postcode: Optional[str] = Field(None, max_length=20)
    address_country: Optional[str] = Field(None, max_length=100)

    default_tax_rate: Optional[float] = Field(None, ge=0, le=1)
    default_payment_terms_days: Optional[int] = Field(None, ge=0, le=365)
    default_invoice_terms: Optional[str] = Field(None, max_length=4000)
    default_payment_instructions: Optional[str] = Field(None, max_length=4000)
    invoice_prefix: Optional[str] = Field(None, min_length=1, max_length=8)
    quote_prefix: Optional[str] = Field(None, min_length=1, max_length=8)
    booking_prefix: Optional[str] = Field(None, min_length=1, max_length=8)
    job_prefix: Optional[str] = Field(None, min_length=1, max_length=8)

    default_quote_valid_days: Optional[int] = Field(None, ge=1, le=365)
    default_quote_terms: Optional[str] = Field(None, max_length=4000)

    smtp_host: Optional[str] = Field(None, max_length=200)
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_username: Optional[str] = Field(None, max_length=200)
    smtp_from_email: Optional[str] = Field(None, max_length=200)
    smtp_from_name: Optional[str] = Field(None, max_length=200)

    primary_color: Optional[str] = Field(None, max_length=9)


class CompanySettingsResponse(BaseModel):
    """Full settings, minus the base64 logo (served from its own endpoint)."""

    id: str
    company_name: str
    company_number: Optional[str] = None
    vat_number: Optional[str] = None

    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None

    address_street: Optional[str] = None
    address_city: Optional[str] = None
    address_county: Optional[str] = None
    address_postcode: Optional[str] = None
    address_country: str = "United Kingdom"
    address_one_line: str = ""

    has_logo: bool = False
    logo_content_type: Optional[str] = None

    default_tax_rate: float = 0.20
    default_payment_terms_days: int = 14
    default_invoice_terms: str = ""
    default_payment_instructions: Optional[str] = None
    invoice_prefix: str = "INV"
    quote_prefix: str = "QTE"
    booking_prefix: str = "BKG"
    job_prefix: str = "JOB"

    default_quote_valid_days: int = 30
    default_quote_terms: Optional[str] = None

    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None

    primary_color: str = "#059669"

    updated_at: datetime
    updated_by: Optional[str] = None


class CompanySettingsEnvelope(ApiResponse[CompanySettingsResponse]):
    """Envelope for the settings endpoints."""
