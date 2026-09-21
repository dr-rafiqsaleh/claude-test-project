"""Company settings - the single document holding branding and defaults.

There is only ever one of these. Everything that used to be a hard-coded
"QKil Pest Control" string in a PDF generator now reads from here.
"""

from datetime import datetime
from typing import List, Optional

from beanie import Document, PydanticObjectId
from pydantic import Field

#: Image types accepted for the company logo.
ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}

#: Hard cap on the uploaded logo, in bytes (2 MB).
MAX_LOGO_BYTES = 2 * 1024 * 1024


class CompanySettings(Document):
    """Singleton settings document."""

    # Identity
    company_name: str = "QKil Pest Control"
    company_number: Optional[str] = None  # Companies House number, e.g. "12345678"
    vat_number: Optional[str] = None  # UK VAT registration, e.g. "GB123456789"

    # Contact
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None

    # Address
    address_street: Optional[str] = None
    address_city: Optional[str] = None
    address_county: Optional[str] = None
    address_postcode: Optional[str] = None
    address_country: str = "United Kingdom"

    # Logo, stored inline as base64 so there is no object-store dependency.
    logo_data: Optional[str] = None
    logo_content_type: Optional[str] = None

    # Invoice defaults
    default_tax_rate: float = 0.20
    default_payment_terms_days: int = 14
    default_invoice_terms: str = (
        "Payment due within 14 days. VAT registered under GB123456789. "
        "Thank you for your business."
    )
    default_payment_instructions: Optional[str] = None  # bank details
    invoice_prefix: str = "INV"
    quote_prefix: str = "QTE"
    booking_prefix: str = "JOB"  # jobs (stored as bookings)
    job_prefix: str = "RPT"  # inspection reports

    # Quote defaults
    default_quote_valid_days: int = 30
    default_quote_terms: Optional[str] = None

    # Email (stored now, wired up in a later phase)
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None

    # Appearance
    primary_color: str = "#059669"  # emerald-600

    updated_at: datetime = Field(default_factory=datetime.utcnow)
    updated_by: Optional[PydanticObjectId] = None

    class Settings:
        name = "company_settings"

    @property
    def address_lines(self) -> List[str]:
        """The address as display lines, skipping anything not filled in."""
        locality = ", ".join(
            part for part in (self.address_city, self.address_county) if part
        ).strip()
        return [
            line
            for line in (
                self.address_street,
                locality,
                self.address_postcode,
                self.address_country,
            )
            if line
        ]

    @property
    def address_one_line(self) -> str:
        """The full address on a single line."""
        return ", ".join(self.address_lines)

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return self.company_name
