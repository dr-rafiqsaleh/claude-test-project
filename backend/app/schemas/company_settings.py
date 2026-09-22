"""Company settings request/response schemas."""

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.company_settings import (
    EMAIL_PLACEHOLDERS,
    EmailProvider,
    EmailTemplates,
    ProductCategory,
    SmtpSecurity,
)
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


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_email_address(value: Optional[str]) -> Optional[str]:
    cleaned = _clean_optional(value)
    if cleaned is None:
        return None
    if not EMAIL_PATTERN.match(cleaned):
        raise ValueError(f"'{cleaned}' is not an email address")
    return cleaned.lower()


class EmailTemplateSchema(BaseModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=10000)


class EmailTemplatesSchema(BaseModel):
    quote: EmailTemplateSchema
    invoice: EmailTemplateSchema
    report: EmailTemplateSchema


def _digits(value: str) -> str:
    return re.sub(r"[\s-]", "", value)


class CompanySettingsUpdate(BaseModel):
    """Partial update - every field is optional."""

    company_name: Optional[str] = Field(None, min_length=1, max_length=160)
    legal_name: Optional[str] = Field(None, max_length=160)
    company_number: Optional[str] = Field(None, max_length=40)
    vat_number: Optional[str] = Field(None, max_length=40)
    vat_registered: Optional[bool] = None

    bank_account_name: Optional[str] = Field(None, max_length=120)
    bank_sort_code: Optional[str] = Field(None, max_length=20)
    bank_account_number: Optional[str] = Field(None, max_length=20)

    #: The number the next invoice will get. It can only move forward.
    next_invoice_number: Optional[int] = Field(None, ge=1, le=9_999_999)

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

    email_provider: Optional[EmailProvider] = None
    smtp_host: Optional[str] = Field(None, max_length=200)
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_security: Optional[SmtpSecurity] = None
    smtp_username: Optional[str] = Field(None, max_length=200)
    #: Write-only. Left out or blank keeps the password already saved.
    smtp_password: Optional[str] = Field(None, max_length=500)
    m365_tenant_id: Optional[str] = Field(None, max_length=200)
    m365_client_id: Optional[str] = Field(None, max_length=100)
    #: Write-only. Left out or blank keeps the secret already saved.
    m365_client_secret: Optional[str] = Field(None, max_length=500)
    m365_mailbox: Optional[str] = Field(None, max_length=200)
    smtp_from_email: Optional[str] = Field(None, max_length=200)
    smtp_from_name: Optional[str] = Field(None, max_length=200)
    email_reply_to: Optional[str] = Field(None, max_length=200)
    email_bcc: Optional[str] = Field(None, max_length=200)
    email_templates: Optional[EmailTemplatesSchema] = None

    primary_color: Optional[str] = Field(None, max_length=9)

    @field_validator("m365_mailbox", "smtp_from_email", "email_reply_to", "email_bcc")
    @classmethod
    def _check_addresses(cls, value: Optional[str]) -> Optional[str]:
        return _check_email_address(value)

    @field_validator("smtp_host", "smtp_username", "m365_tenant_id", "m365_client_id")
    @classmethod
    def _strip_email_text(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional(value)

    @field_validator("legal_name", "bank_account_name")
    @classmethod
    def _strip_text(cls, value: Optional[str]) -> Optional[str]:
        return _clean_optional(value)

    @field_validator("bank_sort_code")
    @classmethod
    def _check_sort_code(cls, value: Optional[str]) -> Optional[str]:
        cleaned = _clean_optional(value)
        if cleaned is None:
            return None
        digits = _digits(cleaned)
        if not re.fullmatch(r"\d{6}", digits):
            raise ValueError("A sort code is 6 digits, e.g. 12-34-56")
        return f"{digits[:2]}-{digits[2:4]}-{digits[4:]}"

    @field_validator("bank_account_number")
    @classmethod
    def _check_account_number(cls, value: Optional[str]) -> Optional[str]:
        cleaned = _clean_optional(value)
        if cleaned is None:
            return None
        digits = _digits(cleaned)
        if not re.fullmatch(r"\d{7,8}", digits):
            raise ValueError("A UK account number is 8 digits")
        return digits.zfill(8)  # 7-digit accounts are written with a leading 0


class CompanySettingsResponse(BaseModel):
    """Full settings, minus the base64 logo (served from its own endpoint)."""

    id: str
    company_name: str
    legal_name: Optional[str] = None
    company_number: Optional[str] = None
    vat_number: Optional[str] = None
    vat_registered: bool = False

    bank_account_name: Optional[str] = None
    bank_sort_code: Optional[str] = None
    bank_account_number: Optional[str] = None
    next_invoice_number: int = 1

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

    email_provider: EmailProvider = EmailProvider.NONE
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_security: SmtpSecurity = SmtpSecurity.STARTTLS
    smtp_username: Optional[str] = None
    smtp_password_set: bool = False
    m365_tenant_id: Optional[str] = None
    m365_client_id: Optional[str] = None
    m365_client_secret_set: bool = False
    m365_mailbox: Optional[str] = None
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None
    email_reply_to: Optional[str] = None
    email_bcc: Optional[str] = None
    email_templates: EmailTemplatesSchema
    default_email_templates: EmailTemplatesSchema
    email_placeholders: dict = Field(default_factory=lambda: EMAIL_PLACEHOLDERS)

    primary_color: str = "#059669"

    updated_at: datetime
    updated_by: Optional[str] = None


class CompanySettingsEnvelope(ApiResponse[CompanySettingsResponse]):
    """Envelope for the settings endpoints."""
