"""Invoice CRUD, payments, dashboard aggregation and PDF rendering."""

import logging
import uuid
from datetime import datetime, timedelta
from io import BytesIO
from typing import Dict, List, Optional, Set, Tuple

from beanie import PydanticObjectId
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.booking import Booking
from app.models.counter import INVOICE_COUNTER, Counter
from app.models.customer import Customer
from app.models.invoice import (
    DEFAULT_PAYMENT_TERM_DAYS,
    DEFAULT_TERMS,
    DELETABLE_STATUSES,
    EDITABLE_STATUSES,
    Invoice,
    InvoiceItem,
    InvoiceStatus,
    Payment,
    PaymentMethod,
)
from app.models.job import Job
from app.models.quote import Quote
from app.models.user import User
from app.schemas.invoice import (
    AddPaymentRequest,
    InvoiceCreate,
    InvoiceItemSchema,
    InvoiceSummary,
    InvoiceUpdate,
)

logger = logging.getLogger(__name__)

#: Fallback bank details, used until the company settings document is filled in.
#: Everything else customer-facing reads from `company_settings_service`.
DEFAULT_PAYMENT_INSTRUCTIONS = (
    "Bank transfer - Sort Code: 20-00-00  Account No: 12345678  "
    "Account Name: QKil Pest Control Ltd. Please quote the invoice number as the reference."
)

#: Allowed status transitions for the invoice lifecycle.
ALLOWED_TRANSITIONS: Dict[InvoiceStatus, Set[InvoiceStatus]] = {
    InvoiceStatus.DRAFT: {InvoiceStatus.SENT, InvoiceStatus.CANCELLED},
    InvoiceStatus.SENT: {
        InvoiceStatus.PAID,
        InvoiceStatus.PARTIALLY_PAID,
        InvoiceStatus.OVERDUE,
        InvoiceStatus.CANCELLED,
    },
    InvoiceStatus.PARTIALLY_PAID: {
        InvoiceStatus.PAID,
        InvoiceStatus.OVERDUE,
        InvoiceStatus.CANCELLED,
    },
    InvoiceStatus.OVERDUE: {
        InvoiceStatus.PAID,
        InvoiceStatus.PARTIALLY_PAID,
        InvoiceStatus.CANCELLED,
    },
    InvoiceStatus.PAID: set(),
    InvoiceStatus.CANCELLED: set(),
}

#: Statuses that still owe money.
OUTSTANDING_STATUSES = [
    InvoiceStatus.SENT.value,
    InvoiceStatus.PARTIALLY_PAID.value,
    InvoiceStatus.OVERDUE.value,
]


class InvoiceNotFoundError(Exception):
    """Raised when an invoice cannot be located."""


class InvoiceStateError(Exception):
    """Raised when an operation is not valid for the invoice's current status."""


class CustomerNotFoundError(Exception):
    """Raised when the referenced customer does not exist."""


class JobNotFoundError(Exception):
    """Raised when the job an invoice should be raised from does not exist."""


class InvoiceAlreadyExistsError(Exception):
    """Raised when a job has already been invoiced."""


class PaymentError(Exception):
    """Raised when a payment cannot be recorded."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _escape_regex(value: str) -> str:
    """Escape regex metacharacters so user input is treated literally."""
    specials = r"\^$.|?*+()[]{}"
    return "".join("\\" + ch if ch in specials else ch for ch in value)


def _to_object_id(value: "PydanticObjectId | str | None") -> Optional[PydanticObjectId]:
    if value is None:
        return None
    try:
        return value if isinstance(value, PydanticObjectId) else PydanticObjectId(str(value))
    except Exception:  # noqa: BLE001 - invalid object id string
        return None


def _end_of_day(value: datetime) -> datetime:
    """Push a date-only filter out to the last microsecond of that day."""
    if value.hour or value.minute or value.second or value.microsecond:
        return value
    return value.replace(hour=23, minute=59, second=59, microsecond=999999)


def _money2(value: float) -> float:
    """Round to cents, so float drift never creeps into a stored total."""
    return round(float(value or 0.0), 2)


def _start_of_month(value: Optional[datetime] = None) -> datetime:
    now = value or datetime.utcnow()
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


# ---------------------------------------------------------------------------
# Numbering and totals
# ---------------------------------------------------------------------------


async def get_next_invoice_number() -> str:
    """Atomically increment the invoice counter and format it as INV-0001.

    The prefix comes from company settings, so changing it there applies to
    every invoice raised from that point on.
    """
    from app.services.company_settings_service import get_prefix  # noqa: PLC0415

    return await Counter.next_number(INVOICE_COUNTER, prefix=await get_prefix("invoice"))


def compute_item(item_data: "InvoiceItemSchema | InvoiceItem | dict") -> InvoiceItem:
    """Build an InvoiceItem with its subtotal, tax and total filled in."""
    if isinstance(item_data, dict):
        description = str(item_data.get("description", "")).strip()
        quantity = float(item_data.get("quantity", 1) or 0)
        unit_price = float(item_data.get("unit_price", 0) or 0)
        tax_rate = float(item_data.get("tax_rate", 0.20) or 0)
    else:
        description = str(item_data.description).strip()
        quantity = float(item_data.quantity or 0)
        unit_price = float(item_data.unit_price or 0)
        tax_rate = float(item_data.tax_rate or 0)

    subtotal = _money2(quantity * unit_price)
    tax_amount = _money2(subtotal * tax_rate)
    total = _money2(subtotal + tax_amount)

    return InvoiceItem(
        description=description,
        quantity=quantity,
        unit_price=unit_price,
        tax_rate=tax_rate,
        subtotal=subtotal,
        tax_amount=tax_amount,
        total=total,
    )


def recompute_totals(invoice: Invoice) -> Invoice:
    """Recalculate the invoice totals from its line items and payments."""
    invoice.items = [compute_item(item) for item in invoice.items]

    invoice.subtotal = _money2(sum(item.subtotal for item in invoice.items))
    invoice.tax_amount = _money2(sum(item.tax_amount for item in invoice.items))
    invoice.total = _money2(invoice.subtotal + invoice.tax_amount)

    invoice.amount_paid = _money2(sum(payment.amount for payment in invoice.payments))
    invoice.amount_due = _money2(invoice.total - invoice.amount_paid)
    return invoice


# ---------------------------------------------------------------------------
# Payload building
# ---------------------------------------------------------------------------


def build_invoice_payload(
    invoice: Invoice,
    customer: Optional[Customer] = None,
    job: Optional[Job] = None,
    quote: Optional[Quote] = None,
    users: Optional[Dict[str, User]] = None,
) -> dict:
    """Flatten an invoice (plus its relations) into the shape InvoiceResponse expects."""
    user_map = users or {}

    return {
        "id": str(invoice.id),
        "invoice_number": invoice.invoice_number,
        "customer_id": str(invoice.customer_id),
        "customer_name": customer.full_name if customer else None,
        "customer_email": customer.email if customer else None,
        "customer_phone": customer.phone if customer else None,
        "customer_address": customer.address.one_line() if customer else None,
        "job_id": str(invoice.job_id) if invoice.job_id else None,
        "job_number": job.job_number if job else None,
        "quote_id": str(invoice.quote_id) if invoice.quote_id else None,
        "quote_number": quote.quote_number if quote else None,
        "booking_id": str(invoice.booking_id) if invoice.booking_id else None,
        "status": invoice.status,
        "items": [
            {
                "description": item.description,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "tax_rate": item.tax_rate,
                "subtotal": item.subtotal,
                "tax_amount": item.tax_amount,
                "total": item.total,
            }
            for item in invoice.items
        ],
        "subtotal": invoice.subtotal,
        "tax_amount": invoice.tax_amount,
        "total": invoice.total,
        "amount_paid": invoice.amount_paid,
        "amount_due": invoice.amount_due,
        "payments": [
            {
                "payment_id": payment.payment_id,
                "amount": payment.amount,
                "method": payment.method,
                "reference": payment.reference,
                "notes": payment.notes,
                "paid_at": payment.paid_at,
                "recorded_by": str(payment.recorded_by) if payment.recorded_by else None,
                "recorded_by_name": (
                    user_map[str(payment.recorded_by)].full_name
                    if payment.recorded_by and str(payment.recorded_by) in user_map
                    else None
                ),
            }
            for payment in invoice.payments
        ],
        "issue_date": invoice.issue_date,
        "due_date": invoice.due_date,
        "sent_at": invoice.sent_at,
        "paid_at": invoice.paid_at,
        "is_overdue": invoice.is_overdue,
        "notes": invoice.notes,
        "terms": invoice.terms or DEFAULT_TERMS,
        "payment_instructions": invoice.payment_instructions,
        "email_sent_to": invoice.email_sent_to,
        "email_sent_at": invoice.email_sent_at,
        "report_generated": invoice.report_generated,
        "report_generated_at": invoice.report_generated_at,
        "created_by": str(invoice.created_by),
        "created_at": invoice.created_at,
        "updated_at": invoice.updated_at,
    }


async def _load_relations(
    invoices: List[Invoice],
) -> Tuple[Dict[str, Customer], Dict[str, Job], Dict[str, Quote]]:
    """Bulk-load the customers, jobs and quotes referenced by a page of invoices."""
    customer_ids = list({inv.customer_id for inv in invoices})
    job_ids = list({inv.job_id for inv in invoices if inv.job_id is not None})
    quote_ids = list({inv.quote_id for inv in invoices if inv.quote_id is not None})

    customers: Dict[str, Customer] = {}
    jobs: Dict[str, Job] = {}
    quotes: Dict[str, Quote] = {}

    if customer_ids:
        found = await Customer.find({"_id": {"$in": customer_ids}}).to_list()
        customers = {str(item.id): item for item in found}

    if job_ids:
        found = await Job.find({"_id": {"$in": job_ids}}).to_list()
        jobs = {str(item.id): item for item in found}

    if quote_ids:
        found = await Quote.find({"_id": {"$in": quote_ids}}).to_list()
        quotes = {str(item.id): item for item in found}

    return customers, jobs, quotes


async def _load_payment_users(invoice: Invoice) -> Dict[str, User]:
    """Load the staff who recorded each payment on one invoice."""
    ids = list({p.recorded_by for p in invoice.payments if p.recorded_by is not None})
    if not ids:
        return {}
    found = await User.find({"_id": {"$in": ids}}).to_list()
    return {str(user.id): user for user in found}


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def create_invoice(
    data: InvoiceCreate,
    user_id: PydanticObjectId,
) -> Tuple[Invoice, Optional[Customer], Optional[Job], Optional[Quote]]:
    """Create an invoice from a hand-built payload."""
    customer_oid = _to_object_id(data.customer_id)
    if customer_oid is None:
        raise CustomerNotFoundError("Customer not found")

    customer = await Customer.get(customer_oid)
    if customer is None:
        raise CustomerNotFoundError("Customer not found")

    job_oid = _to_object_id(data.job_id)
    quote_oid = _to_object_id(data.quote_id)
    booking_oid = _to_object_id(data.booking_id)

    job = await Job.get(job_oid) if job_oid else None
    quote = await Quote.get(quote_oid) if quote_oid else None

    now = datetime.utcnow()
    issue_date = data.issue_date or now
    due_date = data.due_date or (issue_date + timedelta(days=DEFAULT_PAYMENT_TERM_DAYS))

    invoice = Invoice(
        invoice_number=await get_next_invoice_number(),
        customer_id=customer_oid,
        job_id=job.id if job else None,
        quote_id=quote.id if quote else None,
        booking_id=booking_oid,
        status=data.status,
        items=[compute_item(item) for item in data.items],
        issue_date=issue_date,
        due_date=due_date,
        sent_at=now if data.status == InvoiceStatus.SENT else None,
        notes=data.notes,
        terms=data.terms or DEFAULT_TERMS,
        payment_instructions=data.payment_instructions,
        created_by=user_id,
        created_at=now,
        updated_at=now,
    )
    recompute_totals(invoice)
    await invoice.insert()

    # Keep the job's back-reference in step when one was supplied.
    if job is not None and job.invoice_id is None:
        job.invoice_id = invoice.id
        job.touch()
        await job.save()

    return invoice, customer, job, quote


def _line_items_from_job(job: Job, booking: Optional[Booking], quote: Optional[Quote]) -> List[InvoiceItem]:
    """Build invoice line items from a completed job.

    Preference order:

    1. The accepted quote's line items, when the job traces back to one.
    2. The booking's quoted amount as a single service line.
    3. One line for the service itself, plus one per distinct treatment applied.
    """
    if quote is not None and quote.items:
        return [
            compute_item(
                {
                    "description": item.description,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "tax_rate": quote.tax_rate if quote.tax_rate is not None else 0.20,
                }
            )
            for item in quote.items
        ]

    if booking is not None and booking.quoted_amount:
        return [
            compute_item(
                {
                    "description": f"Pest Control Services - {job.service_type}",
                    "quantity": 1,
                    "unit_price": float(booking.quoted_amount),
                    "tax_rate": 0.20,
                }
            )
        ]

    items: List[InvoiceItem] = [
        compute_item(
            {
                "description": f"Pest Control Services - {job.service_type}",
                "quantity": 1,
                "unit_price": 0.0,
                "tax_rate": 0.20,
            }
        )
    ]

    seen: Set[str] = set()
    for treatment in job.treatments or []:
        label = (treatment.product_name or treatment.pest_type or "").strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        description = f"Treatment - {treatment.pest_type}"
        if treatment.product_name:
            description += f" ({treatment.product_name})"
        items.append(
            compute_item(
                {
                    "description": description,
                    "quantity": 1,
                    "unit_price": 0.0,
                    "tax_rate": 0.20,
                }
            )
        )

    return items


async def create_invoice_from_job(
    job_id: "PydanticObjectId | str",
    user_id: PydanticObjectId,
) -> Tuple[Invoice, Optional[Customer], Optional[Job], Optional[Quote]]:
    """Raise a draft invoice against a completed job."""
    job_oid = _to_object_id(job_id)
    if job_oid is None:
        raise JobNotFoundError("Job not found")

    job = await Job.get(job_oid)
    if job is None:
        raise JobNotFoundError("Job not found")

    if job.invoice_id is not None:
        existing = await Invoice.get(job.invoice_id)
        if existing is not None:
            raise InvoiceAlreadyExistsError(
                f"Job {job.job_number} already has invoice {existing.invoice_number}"
            )

    # Guard against a stale/missing invoice_id link by checking the collection too.
    duplicate = await Invoice.find_one({"job_id": job.id})
    if duplicate is not None:
        job.invoice_id = duplicate.id
        job.touch()
        await job.save()
        raise InvoiceAlreadyExistsError(
            f"Job {job.job_number} already has invoice {duplicate.invoice_number}"
        )

    booking = await Booking.get(job.booking_id) if job.booking_id else None
    quote = None
    if booking is not None and booking.quote_id is not None:
        quote = await Quote.get(booking.quote_id)

    customer = await Customer.get(job.customer_id)

    # Terms, payment window and bank details all come from company settings.
    from app.services.company_settings_service import (  # noqa: PLC0415
        get_settings_for_pdf,
    )

    branding = await get_settings_for_pdf()
    term_days = int(branding.get("default_payment_terms_days") or DEFAULT_PAYMENT_TERM_DAYS)
    terms = branding.get("default_invoice_terms") or DEFAULT_TERMS
    instructions = branding.get("default_payment_instructions") or DEFAULT_PAYMENT_INSTRUCTIONS

    now = datetime.utcnow()
    invoice = Invoice(
        invoice_number=await get_next_invoice_number(),
        customer_id=job.customer_id,
        job_id=job.id,
        quote_id=quote.id if quote else None,
        booking_id=job.booking_id,
        status=InvoiceStatus.DRAFT,
        items=_line_items_from_job(job, booking, quote),
        issue_date=now,
        due_date=now + timedelta(days=term_days),
        notes=(
            f"Raised automatically on completion of job {job.job_number} "
            f"({job.service_type})."
        ),
        terms=terms,
        payment_instructions=instructions,
        created_by=user_id,
        created_at=now,
        updated_at=now,
    )
    recompute_totals(invoice)
    await invoice.insert()

    job.invoice_id = invoice.id
    job.touch()
    await job.save()

    logger.info("Invoice %s raised for job %s", invoice.invoice_number, job.job_number)
    return invoice, customer, job, quote


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


async def list_invoices(
    page: int = 1,
    page_size: int = 20,
    status: Optional[InvoiceStatus] = None,
    customer_id: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    overdue_only: bool = False,
    q: Optional[str] = None,
) -> Tuple[List[dict], int]:
    """Return a page of invoice payloads (names embedded) plus the total count."""
    criteria: dict = {}

    if status is not None:
        criteria["status"] = status.value

    if customer_id:
        customer_oid = _to_object_id(customer_id)
        if customer_oid is None:
            return [], 0
        criteria["customer_id"] = customer_oid

    date_filter: dict = {}
    if date_from is not None:
        date_filter["$gte"] = date_from
    if date_to is not None:
        date_filter["$lte"] = _end_of_day(date_to)
    if date_filter:
        criteria["issue_date"] = date_filter

    if overdue_only:
        criteria["due_date"] = {"$lt": datetime.utcnow()}
        criteria["amount_due"] = {"$gt": 0}
        if status is None:
            criteria["status"] = {"$in": OUTSTANDING_STATUSES}

    if q and q.strip():
        escaped = _escape_regex(q.strip())
        matching_customers = await Customer.find(
            {
                "$or": [
                    {"first_name": {"$regex": escaped, "$options": "i"}},
                    {"last_name": {"$regex": escaped, "$options": "i"}},
                ]
            }
        ).to_list()
        matched_ids = [customer.id for customer in matching_customers]

        or_clauses: List[dict] = [{"invoice_number": {"$regex": escaped, "$options": "i"}}]
        if matched_ids:
            or_clauses.append({"customer_id": {"$in": matched_ids}})
        criteria["$or"] = or_clauses

    query = Invoice.find(criteria) if criteria else Invoice.find_all()

    total = await query.count()
    skip = max(page - 1, 0) * page_size
    invoices = await query.sort("-issue_date", "-created_at").skip(skip).limit(page_size).to_list()

    customers, jobs, quotes = await _load_relations(invoices)
    payloads = [
        build_invoice_payload(
            invoice,
            customers.get(str(invoice.customer_id)),
            jobs.get(str(invoice.job_id)) if invoice.job_id else None,
            quotes.get(str(invoice.quote_id)) if invoice.quote_id else None,
        )
        for invoice in invoices
    ]
    return payloads, total


async def get_invoice(
    invoice_id: "PydanticObjectId | str",
) -> Tuple[Invoice, Optional[Customer], Optional[Job], Optional[Quote]]:
    """Fetch an invoice with its customer, job and quote."""
    oid = _to_object_id(invoice_id)
    if oid is None:
        raise InvoiceNotFoundError("Invoice not found")

    invoice = await Invoice.get(oid)
    if invoice is None:
        raise InvoiceNotFoundError("Invoice not found")

    customer = await Customer.get(invoice.customer_id)
    job = await Job.get(invoice.job_id) if invoice.job_id else None
    quote = await Quote.get(invoice.quote_id) if invoice.quote_id else None
    return invoice, customer, job, quote


async def get_invoice_payload(invoice_id: "PydanticObjectId | str") -> dict:
    """Fetch an invoice already flattened, with payment authors resolved."""
    invoice, customer, job, quote = await get_invoice(invoice_id)
    users = await _load_payment_users(invoice)
    return build_invoice_payload(invoice, customer, job, quote, users)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


async def update_invoice(
    invoice_id: "PydanticObjectId | str",
    data: InvoiceUpdate,
) -> Tuple[Invoice, Optional[Customer], Optional[Job], Optional[Quote]]:
    """Apply a partial update, recomputing totals whenever the items change."""
    invoice, customer, job, quote = await get_invoice(invoice_id)

    if invoice.status not in EDITABLE_STATUSES:
        raise InvoiceStateError(f"A {invoice.status.value} invoice can no longer be edited")

    payload = data.model_dump(exclude_unset=True)

    if "items" in payload and data.items is not None:
        invoice.items = [compute_item(item) for item in data.items]

    for field in ("notes", "terms", "payment_instructions"):
        if field in payload:
            setattr(invoice, field, payload[field])

    if not invoice.terms:
        invoice.terms = DEFAULT_TERMS

    if "issue_date" in payload and payload["issue_date"] is not None:
        invoice.issue_date = payload["issue_date"]

    if "due_date" in payload and payload["due_date"] is not None:
        invoice.due_date = payload["due_date"]

    if invoice.due_date < invoice.issue_date:
        raise InvoiceStateError("The due date must fall on or after the issue date")

    recompute_totals(invoice)
    invoice.touch()
    await invoice.save()
    return invoice, customer, job, quote


async def update_status(
    invoice_id: "PydanticObjectId | str",
    status: InvoiceStatus,
) -> Tuple[Invoice, Optional[Customer], Optional[Job], Optional[Quote]]:
    """Move an invoice to a new status, enforcing the lifecycle state machine."""
    invoice, customer, job, quote = await get_invoice(invoice_id)

    if status == invoice.status:
        raise InvoiceStateError(f"Invoice is already {status.value.replace('_', ' ')}")

    allowed = ALLOWED_TRANSITIONS.get(invoice.status, set())
    if status not in allowed:
        raise InvoiceStateError(
            f"Cannot change a {invoice.status.value.replace('_', ' ')} invoice to "
            f"{status.value.replace('_', ' ')}"
        )

    now = datetime.utcnow()

    if status == InvoiceStatus.PAID and invoice.amount_paid + 0.005 < invoice.total:
        raise InvoiceStateError(
            "Record the outstanding payments before marking this invoice as paid"
        )

    invoice.status = status

    if status == InvoiceStatus.SENT:
        invoice.sent_at = now
    elif status == InvoiceStatus.PAID:
        invoice.paid_at = now
    elif status == InvoiceStatus.CANCELLED:
        invoice.paid_at = None

    invoice.touch()
    await invoice.save()
    return invoice, customer, job, quote


async def add_payment(
    invoice_id: "PydanticObjectId | str",
    payment_data: AddPaymentRequest,
    user_id: PydanticObjectId,
) -> Tuple[Invoice, Optional[Customer], Optional[Job], Optional[Quote]]:
    """Record a payment and roll the invoice forward to partially paid / paid."""
    invoice, customer, job, quote = await get_invoice(invoice_id)

    if invoice.status == InvoiceStatus.CANCELLED:
        raise InvoiceStateError("A cancelled invoice cannot take payments")

    if invoice.status == InvoiceStatus.DRAFT:
        raise InvoiceStateError("Send the invoice before recording a payment against it")

    if invoice.status == InvoiceStatus.PAID:
        raise InvoiceStateError("This invoice is already paid in full")

    amount = _money2(payment_data.amount)
    if amount <= 0:
        raise PaymentError("The payment amount must be greater than zero")

    if amount - invoice.amount_due > 0.005:
        raise PaymentError(
            f"The payment cannot exceed the balance due of £{invoice.amount_due:,.2f}"
        )

    now = datetime.utcnow()
    payment = Payment(
        payment_id=uuid.uuid4().hex[:12],
        amount=amount,
        method=payment_data.method or PaymentMethod.BANK_TRANSFER,
        reference=payment_data.reference,
        notes=payment_data.notes,
        paid_at=payment_data.paid_at or now,
        recorded_by=user_id,
    )
    invoice.payments.append(payment)

    recompute_totals(invoice)

    if invoice.amount_due <= 0.005:
        invoice.amount_due = 0.0
        invoice.status = InvoiceStatus.PAID
        invoice.paid_at = now
    elif invoice.amount_paid > 0:
        invoice.status = InvoiceStatus.PARTIALLY_PAID
        invoice.paid_at = None

    invoice.touch()
    await invoice.save()
    return invoice, customer, job, quote


async def mark_overdue(
    invoice_id: "PydanticObjectId | str",
) -> Tuple[Invoice, Optional[Customer], Optional[Job], Optional[Quote]]:
    """Flag one past-due invoice as overdue."""
    invoice, customer, job, quote = await get_invoice(invoice_id)

    if invoice.status not in (InvoiceStatus.SENT, InvoiceStatus.PARTIALLY_PAID):
        raise InvoiceStateError(
            f"A {invoice.status.value.replace('_', ' ')} invoice cannot be marked overdue"
        )

    if invoice.due_date >= datetime.utcnow():
        raise InvoiceStateError("This invoice is not past its due date yet")

    invoice.status = InvoiceStatus.OVERDUE
    invoice.touch()
    await invoice.save()
    return invoice, customer, job, quote


async def get_overdue_invoices() -> List[Invoice]:
    """Every sent or partially paid invoice whose due date has passed."""
    return await Invoice.find(
        {
            "status": {"$in": [InvoiceStatus.SENT.value, InvoiceStatus.PARTIALLY_PAID.value]},
            "due_date": {"$lt": datetime.utcnow()},
        }
    ).to_list()


async def sweep_overdue_invoices() -> int:
    """Flip every past-due invoice to overdue. Returns how many changed."""
    invoices = await get_overdue_invoices()
    for invoice in invoices:
        invoice.status = InvoiceStatus.OVERDUE
        invoice.touch()
        await invoice.save()
    return len(invoices)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


async def get_dashboard_summary() -> InvoiceSummary:
    """Aggregate the invoicing figures shown on the dashboard."""
    now = datetime.utcnow()
    month_start = _start_of_month(now)

    collection = Invoice.get_motor_collection()

    by_status_cursor = collection.aggregate(
        [
            {
                "$group": {
                    "_id": "$status",
                    "count": {"$sum": 1},
                    "total": {"$sum": "$total"},
                    "paid": {"$sum": "$amount_paid"},
                    "due": {"$sum": "$amount_due"},
                }
            }
        ]
    )
    by_status = await by_status_cursor.to_list(length=None)

    counts: Dict[str, int] = {}
    total_invoiced = 0.0
    total_paid = 0.0
    total_outstanding = 0.0
    invoice_count = 0

    for row in by_status:
        status = str(row.get("_id") or "")
        count = int(row.get("count", 0) or 0)
        counts[status] = count
        invoice_count += count

        if status == InvoiceStatus.CANCELLED.value:
            continue

        total_invoiced += float(row.get("total", 0) or 0)
        total_paid += float(row.get("paid", 0) or 0)

        if status in OUTSTANDING_STATUSES:
            total_outstanding += float(row.get("due", 0) or 0)

    # Make sure every status appears, even at zero.
    for status in InvoiceStatus:
        counts.setdefault(status.value, 0)

    overdue_cursor = collection.aggregate(
        [
            {
                "$match": {
                    "status": {"$in": OUTSTANDING_STATUSES},
                    "due_date": {"$lt": now},
                    "amount_due": {"$gt": 0},
                }
            },
            {"$group": {"_id": None, "count": {"$sum": 1}, "due": {"$sum": "$amount_due"}}},
        ]
    )
    overdue_rows = await overdue_cursor.to_list(length=1)
    total_overdue = float(overdue_rows[0].get("due", 0) or 0) if overdue_rows else 0.0
    overdue_count = int(overdue_rows[0].get("count", 0) or 0) if overdue_rows else 0

    collected_cursor = collection.aggregate(
        [
            {"$match": {"status": {"$ne": InvoiceStatus.CANCELLED.value}}},
            {"$unwind": "$payments"},
            {"$match": {"payments.paid_at": {"$gte": month_start}}},
            {"$group": {"_id": None, "collected": {"$sum": "$payments.amount"}}},
        ]
    )
    collected_rows = await collected_cursor.to_list(length=1)
    collected_this_month = (
        float(collected_rows[0].get("collected", 0) or 0) if collected_rows else 0.0
    )

    return InvoiceSummary(
        total_invoiced=_money2(total_invoiced),
        total_paid=_money2(total_paid),
        total_overdue=_money2(total_overdue),
        total_outstanding=_money2(total_outstanding),
        collected_this_month=_money2(collected_this_month),
        overdue_count=overdue_count,
        invoice_count=invoice_count,
        invoice_count_by_status=counts,
    )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def delete_invoice(invoice_id: "PydanticObjectId | str") -> Invoice:
    """Hard-delete a draft invoice, releasing the job's invoice link."""
    invoice, _customer, job, _quote = await get_invoice(invoice_id)

    if invoice.status not in DELETABLE_STATUSES:
        raise InvoiceStateError(f"A {invoice.status.value} invoice cannot be deleted")

    if job is not None and job.invoice_id == invoice.id:
        job.invoice_id = None
        job.touch()
        await job.save()

    await invoice.delete()
    return invoice


async def count_invoices(status: Optional[InvoiceStatus] = None) -> int:
    """Count invoices, optionally filtered by status."""
    if status is None:
        return await Invoice.find_all().count()
    return await Invoice.find({"status": status.value}).count()


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

EMERALD = colors.HexColor("#059669")
EMERALD_DARK = colors.HexColor("#047857")
RED = colors.HexColor("#dc2626")
SLATE_900 = colors.HexColor("#0f172a")
SLATE_600 = colors.HexColor("#475569")
SLATE_300 = colors.HexColor("#cbd5e1")
SLATE_100 = colors.HexColor("#f1f5f9")
SLATE_50 = colors.HexColor("#f8fafc")
WHITE = colors.white

METHOD_LABELS = {
    PaymentMethod.CASH: "Cash",
    PaymentMethod.CARD: "Card (EFTPOS)",
    PaymentMethod.BANK_TRANSFER: "Bank Transfer",
    PaymentMethod.CHEQUE: "Cheque",
    PaymentMethod.OTHER: "Other",
}


def _money(value: float) -> str:
    return f"£{float(value or 0):,.2f}"


def _pdf_date(value: Optional[datetime]) -> str:
    return value.strftime("%d %b %Y") if value else "--"


def _escape(value: Optional[str]) -> str:
    """Escape the handful of characters reportlab's mini-HTML treats specially."""
    if not value:
        return ""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _build_styles(accent=EMERALD) -> dict:
    base = getSampleStyleSheet()
    return {
        "company": ParagraphStyle(
            "Company",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            alignment=0,
            textColor=accent,
            spaceAfter=2,
        ),
        "docTitle": ParagraphStyle(
            "DocTitle",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=SLATE_900,
            spaceAfter=2,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["Normal"],
            fontSize=8.5,
            leading=12,
            textColor=SLATE_600,
        ),
        "smallRight": ParagraphStyle(
            "SmallRight",
            parent=base["Normal"],
            fontSize=8.5,
            leading=12,
            textColor=SLATE_600,
            alignment=TA_RIGHT,
        ),
        "sectionHeading": ParagraphStyle(
            "SectionHeading",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=14,
            textColor=SLATE_900,
            spaceBefore=2,
            spaceAfter=5,
        ),
        "label": ParagraphStyle(
            "Label",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=11,
            textColor=SLATE_600,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontSize=9.5,
            leading=13,
            textColor=SLATE_900,
        ),
        "cell": ParagraphStyle(
            "Cell",
            parent=base["Normal"],
            fontSize=9,
            leading=12,
            textColor=SLATE_900,
        ),
        "cellRight": ParagraphStyle(
            "CellRight",
            parent=base["Normal"],
            fontSize=9,
            leading=12,
            textColor=SLATE_900,
            alignment=TA_RIGHT,
        ),
        "footer": ParagraphStyle(
            "Footer",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=SLATE_600,
            alignment=1,
        ),
    }


def _meta_column(label: str, value: str, styles: dict) -> list:
    return [
        Paragraph(_escape(label).upper(), styles["label"]),
        Paragraph(_escape(value) or "--", styles["body"]),
    ]


async def generate_invoice_pdf(invoice_id: "PydanticObjectId | str") -> Tuple[bytes, str]:
    """Render an invoice as a professional A4 PDF.

    Returns ``(pdf_bytes, invoice_number)`` and marks the invoice as having had
    its PDF generated.
    """
    invoice, customer, job, quote = await get_invoice(invoice_id)

    # Company name, company number, contact details, logo and accent colour come from
    # the company settings document. Imported lazily to keep the invoice
    # service free of a settings dependency at import time.
    from app.services import pdf_branding  # noqa: PLC0415

    branding = await pdf_branding.load_branding()
    accent = pdf_branding.accent_color(branding)
    company_name = pdf_branding.company_name(branding)
    styles = _build_styles(accent)

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=22 * mm,
        title=f"Tax Invoice {invoice.invoice_number}",
        author=company_name,
        subject=f"Tax invoice {invoice.invoice_number}",
    )

    story: list = []

    # --- Header -----------------------------------------------------------
    company_block: list = []
    logo = pdf_branding.logo_flowable(branding)
    if logo is not None:
        company_block.append(logo)
        company_block.append(Spacer(1, 5))
        company_block.append(Paragraph(_escape(company_name), styles["label"]))
    else:
        company_block.append(Paragraph(_escape(company_name), styles["company"]))

    identity = pdf_branding.identity_line(branding)
    if identity:
        company_block.append(Paragraph(_escape(identity), styles["small"]))

    contact_lines = pdf_branding.contact_lines(branding)
    contact_block = [
        Paragraph(_escape(line), styles["smallRight"]) for line in contact_lines
    ] or [Paragraph("", styles["smallRight"])]

    header = Table([[company_block, contact_block]], colWidths=[95 * mm, 79 * mm])
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(header)
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1.2, color=accent, spaceAfter=12))

    # --- Title + key dates -------------------------------------------------
    story.append(Paragraph("TAX INVOICE", styles["docTitle"]))
    story.append(Spacer(1, 8))

    meta = Table(
        [
            [
                _meta_column("Invoice number", invoice.invoice_number, styles),
                _meta_column("Issue date", _pdf_date(invoice.issue_date), styles),
                _meta_column("Due date", _pdf_date(invoice.due_date), styles),
            ]
        ],
        colWidths=[58 * mm, 58 * mm, 58 * mm],
    )
    meta.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, -1), SLATE_50),
                ("BOX", (0, 0), (-1, -1), 0.5, SLATE_300),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, SLATE_300),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(meta)
    story.append(Spacer(1, 14))

    # --- Bill to + references ---------------------------------------------
    bill_block: list = [Paragraph("BILL TO", styles["label"]), Spacer(1, 3)]
    if customer is not None:
        bill_block.append(Paragraph(_escape(customer.full_name), styles["body"]))
        bill_block.append(Paragraph(_escape(customer.address.one_line()), styles["small"]))
        if customer.email:
            bill_block.append(Paragraph(f"Email: {_escape(customer.email)}", styles["small"]))
        bill_block.append(Paragraph(f"Phone: {_escape(customer.phone)}", styles["small"]))
    else:
        bill_block.append(Paragraph("Customer record unavailable", styles["small"]))

    reference_block: list = [Paragraph("REFERENCES", styles["label"]), Spacer(1, 3)]
    if job is not None:
        reference_block.append(Paragraph(f"Job: {_escape(job.job_number)}", styles["small"]))
        reference_block.append(
            Paragraph(f"Service: {_escape(job.service_type)}", styles["small"])
        )
    if quote is not None:
        reference_block.append(Paragraph(f"Quote: {_escape(quote.quote_number)}", styles["small"]))
    if job is None and quote is None:
        reference_block.append(Paragraph("No linked job or quote", styles["small"]))

    parties = Table([[bill_block, reference_block]], colWidths=[100 * mm, 74 * mm])
    parties.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(parties)
    story.append(Spacer(1, 16))

    # --- Line items --------------------------------------------------------
    items_data = [
        [
            Paragraph("<b>Description</b>", styles["cell"]),
            Paragraph("<b>Qty</b>", styles["cellRight"]),
            Paragraph("<b>Unit price</b>", styles["cellRight"]),
            Paragraph("<b>VAT</b>", styles["cellRight"]),
            Paragraph("<b>Total</b>", styles["cellRight"]),
        ]
    ]
    for item in invoice.items:
        items_data.append(
            [
                Paragraph(_escape(item.description), styles["cell"]),
                Paragraph(f"{item.quantity:g}", styles["cellRight"]),
                Paragraph(_money(item.unit_price), styles["cellRight"]),
                Paragraph(_money(item.tax_amount), styles["cellRight"]),
                Paragraph(_money(item.total), styles["cellRight"]),
            ]
        )

    items_table = Table(
        items_data,
        colWidths=[78 * mm, 16 * mm, 26 * mm, 24 * mm, 30 * mm],
        repeatRows=1,
    )
    item_style = [
        ("BACKGROUND", (0, 0), (-1, 0), SLATE_100),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, SLATE_300),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, SLATE_300),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    # Alternating row shading, starting with the first data row.
    for row_index in range(2, len(items_data), 2):
        item_style.append(("BACKGROUND", (0, row_index), (-1, row_index), SLATE_50))
    items_table.setStyle(TableStyle(item_style))

    story.append(items_table)
    story.append(Spacer(1, 12))

    # --- Totals ------------------------------------------------------------
    balance_due = invoice.amount_due
    item_rates = {item.tax_rate for item in invoice.items if item.tax_rate is not None}
    if len(item_rates) == 1:
        tax_label = f"VAT ({next(iter(item_rates)) * 100:g}%)"
    else:
        tax_label = "VAT total"
    totals_rows = [
        ["Subtotal", _money(invoice.subtotal)],
        [tax_label, _money(invoice.tax_amount)],
        ["TOTAL DUE", _money(invoice.total)],
        ["Amount paid", _money(invoice.amount_paid)],
        ["Balance due", _money(balance_due)],
    ]
    totals_table = Table(totals_rows, colWidths=[42 * mm, 34 * mm], hAlign="RIGHT")
    totals_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, 1), 9.5),
                ("TEXTCOLOR", (0, 0), (-1, 1), SLATE_600),
                ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"),
                ("FONTSIZE", (0, 2), (-1, 2), 12),
                ("TEXTCOLOR", (0, 2), (-1, 2), SLATE_900),
                ("LINEABOVE", (0, 2), (-1, 2), 0.9, accent),
                ("FONTNAME", (0, 3), (-1, 3), "Helvetica"),
                ("FONTSIZE", (0, 3), (-1, 4), 9.5),
                ("TEXTCOLOR", (0, 3), (-1, 3), EMERALD_DARK),
                ("FONTNAME", (0, 4), (-1, 4), "Helvetica-Bold"),
                ("TEXTCOLOR", (0, 4), (-1, 4), RED if balance_due > 0 else EMERALD_DARK),
                ("LINEABOVE", (0, 3), (-1, 3), 0.4, SLATE_300),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(totals_table)
    story.append(Spacer(1, 16))

    # --- Payments received -------------------------------------------------
    if invoice.payments:
        payment_data = [
            [
                Paragraph("<b>Date</b>", styles["cell"]),
                Paragraph("<b>Method</b>", styles["cell"]),
                Paragraph("<b>Reference</b>", styles["cell"]),
                Paragraph("<b>Amount</b>", styles["cellRight"]),
            ]
        ]
        for payment in invoice.payments:
            payment_data.append(
                [
                    Paragraph(_pdf_date(payment.paid_at), styles["cell"]),
                    Paragraph(
                        METHOD_LABELS.get(payment.method, payment.method.value.title()),
                        styles["cell"],
                    ),
                    Paragraph(_escape(payment.reference) or "--", styles["cell"]),
                    Paragraph(_money(payment.amount), styles["cellRight"]),
                ]
            )

        payments_table = Table(
            payment_data,
            colWidths=[30 * mm, 40 * mm, 74 * mm, 30 * mm],
            repeatRows=1,
        )
        payments_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), SLATE_100),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.8, SLATE_300),
                    ("LINEBELOW", (0, 1), (-1, -1), 0.4, SLATE_300),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(
            KeepTogether(
                [Paragraph("Payments received", styles["sectionHeading"]), payments_table]
            )
        )
        story.append(Spacer(1, 16))

    # --- Notes -------------------------------------------------------------
    if invoice.notes:
        story.append(
            KeepTogether(
                [
                    Paragraph("Notes", styles["sectionHeading"]),
                    Paragraph(_escape(invoice.notes).replace("\n", "<br/>"), styles["small"]),
                ]
            )
        )
        story.append(Spacer(1, 12))

    # --- Terms -------------------------------------------------------------
    story.append(
        KeepTogether(
            [
                Paragraph("Terms &amp; conditions", styles["sectionHeading"]),
                Paragraph(
                    _escape(
                        invoice.terms
                        or branding.get("default_invoice_terms")
                        or DEFAULT_TERMS
                    ).replace("\n", "<br/>"),
                    styles["small"],
                ),
            ]
        )
    )
    story.append(Spacer(1, 12))

    # --- Payment instructions ---------------------------------------------
    instructions_text = invoice.payment_instructions or branding.get(
        "default_payment_instructions"
    )
    if instructions_text:
        instructions = Table(
            [
                [
                    Paragraph(
                        _escape(instructions_text).replace("\n", "<br/>"),
                        styles["small"],
                    )
                ]
            ],
            colWidths=[174 * mm],
        )
        instructions.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), SLATE_50),
                    ("BOX", (0, 0), (-1, -1), 0.5, SLATE_300),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(
            KeepTogether(
                [Paragraph("Payment instructions", styles["sectionHeading"]), instructions]
            )
        )

    def _draw_footer(canvas, document) -> None:
        """Rule + footer text on every page."""
        canvas.saveState()
        width, _height = A4
        y = 13 * mm
        canvas.setStrokeColor(SLATE_300)
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, y + 6 * mm, width - 18 * mm, y + 6 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(SLATE_600)
        canvas.drawString(
            18 * mm,
            y,
            f"Thank you for your business.  |  {pdf_branding.footer_line(branding)}",
        )
        canvas.drawRightString(
            width - 18 * mm, y, f"{invoice.invoice_number}  |  Page {document.page}"
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=_draw_footer, onLaterPages=_draw_footer)

    invoice.report_generated = True
    invoice.report_generated_at = datetime.utcnow()
    invoice.touch()
    await invoice.save()

    return buffer.getvalue(), invoice.invoice_number
