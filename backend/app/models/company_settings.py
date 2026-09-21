"""Company settings - the single document holding branding and defaults.

There is only ever one of these. Everything that used to be a hard-coded
"QKil Pest Control" string in a PDF generator now reads from here.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import uuid4

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field

#: Image types accepted for the company logo.
ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}

#: Hard cap on the uploaded logo, in bytes (2 MB).
MAX_LOGO_BYTES = 2 * 1024 * 1024


class ProductCategory(str, Enum):
    """What kind of product it is - decides which safety advice a report prints."""

    INSECTICIDE = "insecticide"
    RODENTICIDE = "rodenticide"
    OTHER = "other"  # traps, monitors, repellents, proofing materials


class Product(BaseModel):
    """A product the technicians use, so a report never has its details typed by hand."""

    id: str = Field(default_factory=lambda: uuid4().hex)
    name: str
    category: ProductCategory = ProductCategory.OTHER
    active_ingredient: Optional[str] = None  # e.g. "Difenacoum 0.005%"
    formulation: Optional[str] = None  # e.g. "Wax block", "Gel", "Pre-filled bait box"
    registration_number: Optional[str] = None  # HSE / MAPP authorisation number
    safety_data_sheet_ref: Optional[str] = None


#: Printed on a report whenever an insecticide was used. One point per line.
DEFAULT_INSECTICIDE_GUIDANCE = "\n".join(
    [
        "Cover all food and fish tanks during the treatment.",
        "Stay out of the treated rooms for 2 hours after the treatment.",
        "Keep pets and children away from treated areas until they are dry.",
        "Do not vacuum treated areas for 2 weeks after the treatment.",
        "For fleas, pets must also be treated with a product from your vet.",
    ]
)

#: Printed on a report whenever a rodenticide was used. One point per line.
DEFAULT_RODENTICIDE_GUIDANCE = "\n".join(
    [
        "Do not touch or move the bait or bait boxes.",
        "Keep pets and children away from the bait.",
        "If bait may have been eaten, take this report to the doctor or vet straight away.",
        "Note to doctors and vets: the active ingredient of each product is listed on this "
        "report. For anticoagulant rodenticides, vitamin K1 (phytomenadione) is the antidote. "
        "Clinical advice is available from the National Poisons Information Service (NPIS).",
    ]
)

#: Closes every report, above the signatures.
DEFAULT_REPORT_DECLARATION = (
    "All products we use are authorised for professional use in the UK by the Health and "
    "Safety Executive (HSE), and rodenticides are used in line with the CRRU UK Code of Best "
    "Practice. Our recommendations are part of an integrated approach to pest control: "
    "please carry them out, so that any pest activity is brought under control quickly and "
    "does not return."
)


class CompanySettings(Document):
    """Singleton settings document."""

    # Identity
    company_name: str = "QKil Pest Control"  # the name customers know you by
    legal_name: Optional[str] = None  # registered company name, e.g. "Quikil Ltd"
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

    # VAT. Until the business registers, no quote or invoice charges VAT and
    # invoices are plain invoices rather than VAT invoices.
    vat_registered: bool = False
    default_tax_rate: float = 0.20  # the VAT rate charged once registered

    # Bank details, printed on every invoice
    bank_account_name: Optional[str] = None
    bank_sort_code: Optional[str] = None  # "12-34-56"
    bank_account_number: Optional[str] = None

    # Invoice defaults
    default_payment_terms_days: int = 14
    default_invoice_terms: str = "Payment due within 14 days. Thank you for your business."
    default_payment_instructions: Optional[str] = None  # anything beyond the bank details
    invoice_prefix: str = "INV"
    quote_prefix: str = "QTE"
    booking_prefix: str = "JOB"  # jobs (stored as bookings)
    job_prefix: str = "RPT"  # inspection reports

    # Quote defaults
    default_quote_valid_days: int = 30
    default_quote_terms: Optional[str] = None

    # Inspection reports
    products: List[Product] = Field(default_factory=list)
    report_insecticide_guidance: str = DEFAULT_INSECTICIDE_GUIDANCE
    report_rodenticide_guidance: str = DEFAULT_RODENTICIDE_GUIDANCE
    report_declaration: str = DEFAULT_REPORT_DECLARATION

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
    def vat_rate(self) -> float:
        """The VAT rate to charge: nothing at all until VAT registered."""
        return float(self.default_tax_rate or 0) if self.vat_registered else 0.0

    @property
    def address_one_line(self) -> str:
        """The full address on a single line."""
        return ", ".join(self.address_lines)

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return self.company_name
