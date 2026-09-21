"""Company settings request/response schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.company_settings import ProductCategory
from app.schemas.common import ApiResponse

#: Longest a block of report wording may be.
MAX_REPORT_TEXT = 4000


def _clean_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


class ProductSchema(BaseModel):
    """One product in the company's product list (in and out).

    A new product may arrive without an id; the service gives it one.
    """

    id: Optional[str] = Field(None, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    category: ProductCategory = ProductCategory.OTHER
    active_ingredient: Optional[str] = Field(None, max_length=200)
    formulation: Optional[str] = Field(None, max_length=120)
    registration_number: Optional[str] = Field(None, max_length=60)
    safety_data_sheet_ref: Optional[str] = Field(None, max_length=200)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("A product needs a name")
        return cleaned

    @field_validator(
        "id", "active_ingredient", "formulation", "registration_number", "safety_data_sheet_ref"
    )
    @classmethod
    def _strip_optional(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional(value)


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

    products: Optional[List[ProductSchema]] = Field(None, max_length=300)
    report_insecticide_guidance: Optional[str] = Field(None, max_length=MAX_REPORT_TEXT)
    report_rodenticide_guidance: Optional[str] = Field(None, max_length=MAX_REPORT_TEXT)
    report_declaration: Optional[str] = Field(None, max_length=MAX_REPORT_TEXT)

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
    booking_prefix: str = "JOB"
    job_prefix: str = "RPT"

    default_quote_valid_days: int = 30
    default_quote_terms: Optional[str] = None

    products: List[ProductSchema] = Field(default_factory=list)
    report_insecticide_guidance: str = ""
    report_rodenticide_guidance: str = ""
    report_declaration: str = ""

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
