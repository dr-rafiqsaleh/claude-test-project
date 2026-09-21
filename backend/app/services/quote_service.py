"""Quote CRUD, lifecycle transitions and PDF rendering."""

from datetime import datetime
from io import BytesIO
from typing import Dict, List, Optional, Tuple

from beanie import PydanticObjectId
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.counter import QUOTE_COUNTER, Counter
from app.models.customer import Customer
from app.models.quote import Quote, QuoteItem, QuoteStatus
from app.schemas.quote import QuoteCreate, QuoteItemSchema, QuoteUpdate

QUOTE_COUNTER_NAME = QUOTE_COUNTER

#: Fallback terms, used until the company settings document is filled in.
#: Company branding all reads from `company_settings_service`.
DEFAULT_TERMS = "Payment due within 14 days of the work being completed."

#: Width of the text column: A4 less 18mm margins, less the 6pt padding
#: reportlab's page frame keeps on each side, so tables line up with text.
CONTENT_WIDTH = A4[0] - 36 * mm - 12


def _columns(*widths: float) -> List[float]:
    """Column widths in the given proportions, filling the text column."""
    total = sum(widths)
    return [CONTENT_WIDTH * width / total for width in widths]

#: Allowed status transitions. `expired` is handled separately (admin only, from anywhere).
ALLOWED_TRANSITIONS: Dict[QuoteStatus, set] = {
    QuoteStatus.DRAFT: {QuoteStatus.SENT, QuoteStatus.ACCEPTED, QuoteStatus.EXPIRED},
    QuoteStatus.SENT: {QuoteStatus.ACCEPTED, QuoteStatus.REJECTED, QuoteStatus.EXPIRED},
    QuoteStatus.ACCEPTED: set(),
    QuoteStatus.REJECTED: set(),
    QuoteStatus.EXPIRED: set(),
}


class QuoteNotFoundError(Exception):
    """Raised when a quote cannot be located."""


class QuoteStateError(Exception):
    """Raised when an operation is not valid for the quote's current status."""


class CustomerNotFoundError(Exception):
    """Raised when the referenced customer does not exist."""


def _escape_regex(value: str) -> str:
    """Escape regex metacharacters so user input is treated literally."""
    specials = r"\^$.|?*+()[]{}"
    return "".join("\\" + ch if ch in specials else ch for ch in value)


def _to_object_id(value: "PydanticObjectId | str") -> Optional[PydanticObjectId]:
    try:
        return value if isinstance(value, PydanticObjectId) else PydanticObjectId(value)
    except Exception:  # noqa: BLE001 - invalid object id string
        return None


async def get_next_quote_number() -> str:
    """Atomically increment the quote counter and format it as QTE-0001.

    The prefix comes from company settings.
    """
    from app.services.company_settings_service import get_prefix  # noqa: PLC0415

    return await Counter.next_number(QUOTE_COUNTER_NAME, prefix=await get_prefix("quote"))


def calculate_totals(
    items: "List[QuoteItem] | List[QuoteItemSchema]",
    tax_rate: float,
) -> Tuple[float, float, float]:
    """Return (subtotal, tax_amount, total) for a set of line items."""
    subtotal = round(sum(round(item.quantity * item.unit_price, 2) for item in items), 2)
    tax_amount = round(subtotal * tax_rate, 2)
    total = round(subtotal + tax_amount, 2)
    return subtotal, tax_amount, total


def _to_model_items(items: List[QuoteItemSchema]) -> List[QuoteItem]:
    return [
        QuoteItem(
            description=item.description,
            pest_type=item.pest_type,
            service_type=item.service_type,
            quantity=item.quantity,
            unit=item.unit,
            unit_price=item.unit_price,
        )
        for item in items
    ]


def build_quote_payload(quote: Quote, customer: Optional[Customer]) -> dict:
    """Flatten a quote (plus its customer) into the shape QuoteResponse expects."""
    return {
        "id": str(quote.id),
        "quote_number": quote.quote_number,
        "customer_id": str(quote.customer_id),
        "customer_name": customer.full_name if customer else None,
        "customer_phone": customer.phone if customer else None,
        "customer_address": customer.address.one_line() if customer else None,
        "status": quote.status,
        "items": [
            {
                "description": item.description,
                "pest_type": item.pest_type,
                "service_type": item.service_type,
                "quantity": item.quantity,
                "unit": item.unit,
                "unit_price": item.unit_price,
                "line_total": item.total,
            }
            for item in quote.items
        ],
        "subtotal": quote.subtotal,
        "tax_rate": quote.tax_rate,
        "tax_amount": quote.tax_amount,
        "total": quote.total,
        "notes": quote.notes,
        "terms": quote.terms,
        "valid_until": quote.valid_until,
        "sent_at": quote.sent_at,
        "accepted_at": quote.accepted_at,
        "rejected_at": quote.rejected_at,
        "rejection_reason": quote.rejection_reason,
        "converted_to_booking": quote.converted_to_booking,
        "booking_id": str(quote.booking_id) if quote.booking_id else None,
        "created_by": str(quote.created_by),
        "created_at": quote.created_at,
        "updated_at": quote.updated_at,
    }


async def _load_customers(quotes: List[Quote]) -> Dict[str, Customer]:
    """Bulk-load the customers referenced by a page of quotes."""
    ids = list({quote.customer_id for quote in quotes})
    if not ids:
        return {}
    customers = await Customer.find({"_id": {"$in": ids}}).to_list()
    return {str(customer.id): customer for customer in customers}


async def create_quote(payload: QuoteCreate, created_by: PydanticObjectId) -> Tuple[Quote, Optional[Customer]]:
    """Create a quote with an auto-generated quote number."""
    customer_oid = _to_object_id(payload.customer_id)
    if customer_oid is None:
        raise CustomerNotFoundError("Customer not found")

    customer = await Customer.get(customer_oid)
    if customer is None:
        raise CustomerNotFoundError("Customer not found")

    # Fall back to the configured quote defaults when the caller left them out.
    from app.services.company_settings_service import (  # noqa: PLC0415
        get_settings_for_pdf,
    )

    branding = await get_settings_for_pdf()
    default_terms = branding.get("default_quote_terms") or DEFAULT_TERMS

    # No VAT is charged until the business is VAT registered.
    tax_rate = payload.tax_rate if branding.get("vat_registered") else 0.0
    items = _to_model_items(payload.items)
    subtotal, tax_amount, total = calculate_totals(items, tax_rate)

    now = datetime.utcnow()
    quote = Quote(
        quote_number=await get_next_quote_number(),
        customer_id=customer_oid,
        status=payload.status,
        items=items,
        subtotal=subtotal,
        tax_rate=tax_rate,
        tax_amount=tax_amount,
        total=total,
        notes=payload.notes,
        terms=payload.terms or default_terms,
        valid_until=payload.valid_until,
        sent_at=now if payload.status == QuoteStatus.SENT else None,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    await quote.insert()
    return quote, customer


async def list_quotes(
    page: int = 1,
    page_size: int = 20,
    status: Optional[QuoteStatus] = None,
    customer_id: Optional[str] = None,
    q: Optional[str] = None,
) -> Tuple[List[dict], int]:
    """Return a page of quote payloads (customer name embedded) plus the total count."""
    criteria: dict = {}

    if status is not None:
        criteria["status"] = status.value

    if customer_id:
        customer_oid = _to_object_id(customer_id)
        if customer_oid is None:
            return [], 0
        criteria["customer_id"] = customer_oid

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

        or_clauses: List[dict] = [{"quote_number": {"$regex": escaped, "$options": "i"}}]
        if matched_ids:
            or_clauses.append({"customer_id": {"$in": matched_ids}})
        criteria["$or"] = or_clauses

    query = Quote.find(criteria) if criteria else Quote.find_all()

    total = await query.count()
    skip = max(page - 1, 0) * page_size
    quotes = await query.sort("-created_at").skip(skip).limit(page_size).to_list()

    customers = await _load_customers(quotes)
    payloads = [build_quote_payload(quote, customers.get(str(quote.customer_id))) for quote in quotes]
    return payloads, total


async def get_quote(quote_id: "PydanticObjectId | str") -> Tuple[Quote, Optional[Customer]]:
    """Fetch a quote and its customer, raising QuoteNotFoundError if missing."""
    oid = _to_object_id(quote_id)
    if oid is None:
        raise QuoteNotFoundError("Quote not found")

    quote = await Quote.get(oid)
    if quote is None:
        raise QuoteNotFoundError("Quote not found")

    customer = await Customer.get(quote.customer_id)
    return quote, customer


async def update_quote(
    quote_id: "PydanticObjectId | str",
    payload: QuoteUpdate,
) -> Tuple[Quote, Optional[Customer]]:
    """Apply a partial update. Only draft quotes can be edited."""
    quote, customer = await get_quote(quote_id)

    if quote.status != QuoteStatus.DRAFT:
        raise QuoteStateError("Only draft quotes can be edited")

    data = payload.model_dump(exclude_unset=True)

    if "customer_id" in data and data["customer_id"] is not None:
        customer_oid = _to_object_id(str(data["customer_id"]))
        if customer_oid is None:
            raise CustomerNotFoundError("Customer not found")
        next_customer = await Customer.get(customer_oid)
        if next_customer is None:
            raise CustomerNotFoundError("Customer not found")
        quote.customer_id = customer_oid
        customer = next_customer

    if "items" in data and payload.items is not None:
        quote.items = _to_model_items(payload.items)

    if "tax_rate" in data and data["tax_rate"] is not None:
        from app.services.company_settings_service import get_settings  # noqa: PLC0415

        # No VAT is charged until the business is VAT registered.
        vat_registered = (await get_settings()).vat_registered
        quote.tax_rate = float(data["tax_rate"]) if vat_registered else 0.0

    if "notes" in data:
        quote.notes = data["notes"]

    if "terms" in data:
        quote.terms = data["terms"]

    if "valid_until" in data:
        quote.valid_until = data["valid_until"]

    quote.subtotal, quote.tax_amount, quote.total = calculate_totals(quote.items, quote.tax_rate)
    quote.touch()
    await quote.save()
    return quote, customer


async def update_status(
    quote_id: "PydanticObjectId | str",
    status: QuoteStatus,
    rejection_reason: Optional[str] = None,
    is_admin: bool = False,
) -> Tuple[Quote, Optional[Customer]]:
    """Move a quote to a new status, enforcing the lifecycle state machine."""
    quote, customer = await get_quote(quote_id)

    if status == quote.status:
        raise QuoteStateError(f"Quote is already {status.value}")

    if status == QuoteStatus.EXPIRED and not is_admin:
        raise QuoteStateError("Only an administrator can expire a quote")

    allowed = ALLOWED_TRANSITIONS.get(quote.status, set())
    if status not in allowed:
        raise QuoteStateError(f"Cannot change a {quote.status.value} quote to {status.value}")

    if status == QuoteStatus.REJECTED and not rejection_reason:
        raise QuoteStateError("A rejection reason is required")

    now = datetime.utcnow()
    quote.status = status

    if status == QuoteStatus.SENT:
        quote.sent_at = now
    elif status == QuoteStatus.ACCEPTED:
        quote.accepted_at = now
    elif status == QuoteStatus.REJECTED:
        quote.rejected_at = now
        quote.rejection_reason = rejection_reason

    quote.touch()
    await quote.save()

    if status == QuoteStatus.ACCEPTED:
        # Imported lazily to keep the service import graph acyclic.
        from app.services import notification_service  # noqa: PLC0415

        await notification_service.notify_quote_accepted(quote.id)

    return quote, customer


async def delete_quote(quote_id: "PydanticObjectId | str") -> Quote:
    """Hard-delete a quote. Only draft quotes can be deleted."""
    quote, _ = await get_quote(quote_id)

    if quote.status != QuoteStatus.DRAFT:
        raise QuoteStateError("Only draft quotes can be deleted")

    await quote.delete()
    return quote


async def count_quotes(status: Optional[QuoteStatus] = None) -> int:
    """Count quotes, optionally filtered by status."""
    if status is None:
        return await Quote.find_all().count()
    return await Quote.find({"status": status.value}).count()


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------

EMERALD = colors.HexColor("#059669")
SLATE_900 = colors.HexColor("#0f172a")
SLATE_600 = colors.HexColor("#475569")
SLATE_300 = colors.HexColor("#cbd5e1")
SLATE_100 = colors.HexColor("#f1f5f9")


def _money(value: float) -> str:
    return f"£{value:,.2f}"


def _pdf_date(value: Optional[datetime]) -> str:
    return value.strftime("%d %b %Y") if value else "--"


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
        "label": ParagraphStyle(
            "Label",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=SLATE_900,
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
        "quoteNumber": ParagraphStyle(
            "QuoteNumber",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=20,
            textColor=SLATE_900,
            alignment=TA_RIGHT,
        ),
        "sectionHeading": ParagraphStyle(
            "SectionHeading",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=14,
            textColor=SLATE_900,
            spaceAfter=4,
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
        "footer": ParagraphStyle(
            "Footer",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=SLATE_600,
            alignment=1,
        ),
    }


async def generate_pdf(quote_id: "PydanticObjectId | str") -> Tuple[bytes, str]:
    """Render a quote as an A4 PDF. Returns (pdf_bytes, quote_number)."""
    quote, customer = await get_quote(quote_id)

    # Company name, contact details, logo and accent colour come from the
    # company settings document. Imported lazily to avoid an import cycle.
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
        bottomMargin=18 * mm,
        title=f"Quote {quote.quote_number}",
        author=company_name,
        subject=f"Quote {quote.quote_number}",
    )

    story: list = []

    # --- Header: company on the left, quote meta on the right -------------
    company_block: list = []
    logo = pdf_branding.logo_flowable(branding)
    if logo is not None:
        company_block.append(logo)
        company_block.append(Spacer(1, 5))
        company_block.append(Paragraph(company_name, styles["label"]))
    else:
        company_block.append(Paragraph(company_name, styles["company"]))

    for line in pdf_branding.contact_lines(branding):
        company_block.append(Paragraph(line, styles["small"]))

    identity = pdf_branding.identity_line(branding)
    if identity:
        company_block.append(Paragraph(identity.replace("\n", "<br/>"), styles["small"]))

    meta_block = [
        Paragraph("QUOTE", styles["smallRight"]),
        Paragraph(quote.quote_number, styles["quoteNumber"]),
        Spacer(1, 4),
        Paragraph(f"Date: {_pdf_date(quote.created_at)}", styles["smallRight"]),
        Paragraph(f"Valid until: {_pdf_date(quote.valid_until)}", styles["smallRight"]),
        Paragraph(f"Status: {quote.status.value.title()}", styles["smallRight"]),
    ]

    header = Table([[company_block, meta_block]], colWidths=_columns(100, 74))
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

    # --- Customer ---------------------------------------------------------
    story.append(Paragraph("Prepared for", styles["sectionHeading"]))
    if customer is not None:
        story.append(Paragraph(customer.full_name, styles["body"]))
        story.append(Paragraph(customer.address.one_line(), styles["small"]))
        contact = f"Phone: {customer.phone}"
        if customer.email:
            contact += f"  |  Email: {customer.email}"
        story.append(Paragraph(contact, styles["small"]))
    else:
        story.append(Paragraph("Customer record unavailable", styles["small"]))
    story.append(Spacer(1, 14))

    # --- Line items -------------------------------------------------------
    table_data = [
        [
            Paragraph("<b>Description</b>", styles["cell"]),
            Paragraph("<b>Pest type</b>", styles["cell"]),
            Paragraph("<b>Qty</b>", styles["cell"]),
            Paragraph("<b>Unit price</b>", styles["cell"]),
            Paragraph("<b>Total</b>", styles["cell"]),
        ]
    ]

    for item in quote.items:
        description = item.description
        if item.service_type:
            description = f"{description}<br/><font size=8 color='#475569'>{item.service_type}</font>"
        table_data.append(
            [
                Paragraph(description, styles["cell"]),
                Paragraph(item.pest_type or "--", styles["cell"]),
                Paragraph(f"{item.quantity:g} {item.unit}", styles["cell"]),
                Paragraph(_money(item.unit_price), styles["cell"]),
                Paragraph(_money(item.total), styles["cell"]),
            ]
        )

    items_table = Table(
        table_data,
        colWidths=_columns(70, 30, 24, 25, 25),
        repeatRows=1,
    )
    items_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), SLATE_100),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, SLATE_300),
                ("LINEBELOW", (0, 1), (-1, -1), 0.4, SLATE_300),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(items_table)
    story.append(Spacer(1, 12))

    # --- Totals -----------------------------------------------------------
    # A quote only shows VAT when it charges some, or the business is registered.
    show_vat = bool(branding.get("vat_registered")) or quote.tax_amount > 0
    rows = [["Total", _money(quote.total)]]
    if show_vat:
        rows = [
            ["Subtotal", _money(quote.subtotal)],
            [f"VAT ({quote.tax_rate * 100:g}%)", _money(quote.tax_amount)],
        ] + rows
    last = len(rows) - 1
    totals_style = [
        ("FONTNAME", (0, last), (-1, last), "Helvetica-Bold"),
        ("FONTSIZE", (0, last), (-1, last), 11),
        ("TEXTCOLOR", (0, last), (-1, last), SLATE_900),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, last), (-1, last), 0.8, accent),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    if last:
        totals_style += [
            ("FONTNAME", (0, 0), (-1, last - 1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, last - 1), 9.5),
            ("TEXTCOLOR", (0, 0), (-1, last - 1), SLATE_600),
        ]
    totals_table = Table(rows, colWidths=[35 * mm, 32 * mm], hAlign="RIGHT")
    totals_table.setStyle(TableStyle(totals_style))
    story.append(totals_table)
    story.append(Spacer(1, 18))

    # --- Notes and terms --------------------------------------------------
    if quote.notes:
        story.append(Paragraph("Notes", styles["sectionHeading"]))
        story.append(Paragraph(quote.notes.replace("\n", "<br/>"), styles["small"]))
        story.append(Spacer(1, 12))

    terms_text = quote.terms or branding.get("default_quote_terms") or DEFAULT_TERMS
    story.append(Paragraph("Terms &amp; conditions", styles["sectionHeading"]))
    story.append(Paragraph(terms_text.replace("\n", "<br/>"), styles["small"]))

    if quote.status == QuoteStatus.REJECTED and quote.rejection_reason:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Rejection reason", styles["sectionHeading"]))
        story.append(Paragraph(quote.rejection_reason, styles["small"]))

    def _draw_footer(canvas, document) -> None:
        """Rule + footer text on every page."""
        canvas.saveState()
        width, _height = A4
        y = 13 * mm
        canvas.setStrokeColor(SLATE_300)
        canvas.setLineWidth(0.5)
        left, right = 18 * mm + 6, width - 18 * mm - 6  # the text column's edges
        canvas.line(left, y + 6 * mm, right, y + 6 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(SLATE_600)
        canvas.drawString(
            left,
            y,
            f"{company_name}  |  {quote.quote_number}  |  Thank you for your business.",
        )
        canvas.drawRightString(right, y, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_draw_footer, onLaterPages=_draw_footer)

    buffer.seek(0)
    return buffer.getvalue(), quote.quote_number
