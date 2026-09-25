"""Company settings - the single document holding branding and defaults.

There is only ever one of these. Everything that used to be a hard-coded
"PestBase Pest Control" string in a PDF generator now reads from here.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import uuid4

from beanie import PydanticObjectId
from pydantic import BaseModel, Field

from app.models.tenant import TenantDocument

# These describe how mail is sent, which is now the platform's setting rather
# than a client's - see app.models.platform_settings. Re-exported here because
# the schemas and the sending code have always imported them from this module,
# and one definition is what stops the two drifting apart.
from app.models.platform_settings import EmailProvider, SmtpSecurity  # noqa: E402,F401

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


class EmailTemplate(BaseModel):
    """The subject and message used when emailing one kind of document."""

    subject: str
    body: str


#: Placeholders a template can use, by the kind of document it sends.
EMAIL_PLACEHOLDERS = {
    "common": ["customer_name", "company_name", "company_phone", "company_email", "sender_name"],
    "quote": ["quote_number", "quote_total", "valid_until"],
    "invoice": ["invoice_number", "invoice_total", "amount_due", "due_date", "job_number"],
    "payment_reminder": [
        "invoice_number",
        "invoice_total",
        "amount_due",
        "due_date",
        "days_until_due",
        "job_number",
    ],
    "report": ["report_number", "job_number", "service_date", "service_type", "site_address"],
    "job_assigned": [
        "technician_name",
        "job_number",
        "job_date",
        "job_time",
        "service_type",
        "pest_types",
        "site_address",
        "site_contact",
        "customer_phone",
        "technician_notes",
        "repeats",
        "job_link",
    ],
}

DEFAULT_QUOTE_EMAIL = EmailTemplate(
    subject="Your quote {quote_number} from {company_name}",
    body=(
        "Dear {customer_name},\n\n"
        "Thank you for your enquiry. Please find attached our quote {quote_number} for "
        "{quote_total}, valid until {valid_until}.\n\n"
        "To go ahead, just reply to this email or call us on {company_phone}.\n\n"
        "Kind regards,\n{sender_name}\n{company_name}"
    ),
)

DEFAULT_INVOICE_EMAIL = EmailTemplate(
    subject="Invoice {invoice_number} from {company_name}",
    body=(
        "Dear {customer_name},\n\n"
        "Please find attached invoice {invoice_number} for {amount_due}, due by {due_date}.\n\n"
        "Our bank details are on the invoice. Please use {invoice_number} as the reference "
        "when you pay.\n\n"
        "Thank you for your business.\n\n"
        "Kind regards,\n{sender_name}\n{company_name}"
    ),
)

#: Sent automatically, once, when an unpaid invoice comes within three days of
#: its due date. Nothing is attached: the customer already has the invoice, and
#: this is a nudge rather than a second copy.
DEFAULT_PAYMENT_REMINDER_EMAIL = EmailTemplate(
    subject="Reminder: invoice {invoice_number} is due on {due_date}",
    body=(
        "Dear {customer_name},\n\n"
        "A friendly reminder that invoice {invoice_number} for {amount_due} falls due on "
        "{due_date} ({days_until_due}).\n\n"
        "Our bank details are on the invoice. Please use {invoice_number} as the reference "
        "when you pay.\n\n"
        "If you have already sent payment, or there is anything wrong with the invoice, "
        "just reply to this email or call us on {company_phone} and we will sort it out.\n\n"
        # No {sender_name}: nobody sends this one, so it would only repeat the
        # company name underneath itself.
        "Kind regards,\n{company_name}"
    ),
)

DEFAULT_REPORT_EMAIL = EmailTemplate(
    subject="Your pest control report for {site_address}",
    body=(
        "Dear {customer_name},\n\n"
        "Please find attached the report from our visit on {service_date} to "
        "{site_address}.\n\n"
        "It sets out what we found, what we did and our recommendations. If you have any "
        "questions, just reply to this email or call us on {company_phone}.\n\n"
        "Kind regards,\n{sender_name}\n{company_name}"
    ),
)


DEFAULT_JOB_ASSIGNED_EMAIL = EmailTemplate(
    subject="New job {job_number}: {service_type} on {job_date}",
    body=(
        "Hi {technician_name},\n\n"
        "You've been given a job.\n\n"
        "When: {job_date}, {job_time}\n"
        "Where: {site_address}\n"
        "Customer: {customer_name}, {customer_phone}\n"
        "On site: {site_contact}\n"
        "Service: {service_type} ({pest_types})\n"
        "Notes: {technician_notes}\n"
        "{repeats}\n\n"
        "Open the job: {job_link}\n\n"
        "{company_name}"
    ),
)


class EmailTemplates(BaseModel):
    """The editable emails for quotes, invoices, reports and new jobs."""

    quote: EmailTemplate = Field(default_factory=lambda: DEFAULT_QUOTE_EMAIL.model_copy())
    invoice: EmailTemplate = Field(default_factory=lambda: DEFAULT_INVOICE_EMAIL.model_copy())
    payment_reminder: EmailTemplate = Field(
        default_factory=lambda: DEFAULT_PAYMENT_REMINDER_EMAIL.model_copy()
    )
    report: EmailTemplate = Field(default_factory=lambda: DEFAULT_REPORT_EMAIL.model_copy())
    job_assigned: EmailTemplate = Field(
        default_factory=lambda: DEFAULT_JOB_ASSIGNED_EMAIL.model_copy()
    )


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


class CompanySettings(TenantDocument):
    """Singleton settings document."""

    # Identity
    company_name: str = "PestBase Pest Control"  # the name customers know you by
    legal_name: Optional[str] = None  # registered company name, e.g. "Acme Pest Control Ltd"
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

    # Email. How it is sent - provider, server, credentials, the From address -
    # is the platform's, in app.models.platform_settings: one mail account serves
    # every client. What stays here is what this client's own customers see and
    # act on, which has to differ per client.
    email_reply_to: Optional[str] = None
    email_bcc: Optional[str] = None  # a copy of every email sent, e.g. for the office
    email_templates: EmailTemplates = Field(default_factory=EmailTemplates)
    email_technicians: bool = True  # email a technician when they are given a job
    #: Email the customer once when an unpaid invoice is three days from due.
    #: Off by default on purpose: switching it on starts sending mail to this
    #: client's customers without them doing anything, and that is their call.
    email_payment_reminders: bool = False
    #: How many days before the due date the reminder goes. One email, once.
    payment_reminder_days: int = 3

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
