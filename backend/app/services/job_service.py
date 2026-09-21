"""Job CRUD, lifecycle transitions and pest inspection report rendering."""

import base64
import binascii
import logging
from datetime import datetime
from io import BytesIO
from typing import Dict, List, Optional, Set, Tuple

from beanie import PydanticObjectId
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.booking import TERMINAL_STATUSES as BOOKING_TERMINAL_STATUSES
from app.models.booking import Booking, BookingStatus
from app.models.counter import JOB_COUNTER, Counter
from app.models.customer import Customer
from app.models.job import (
    DELETABLE_STATUSES,
    EDITABLE_STATUSES,
    InspectionFinding,
    Job,
    JobStatus,
    TERMINAL_STATUSES,
    RiskLevel,
    TreatmentApplied,
    TreatmentMethod,
)
from app.models.photo import Photo
from app.models.user import User, UserRole
from app.schemas.job import JobSignatureUpdate, JobUpdate

logger = logging.getLogger(__name__)

#: Company branding on the report reads from `company_settings_service`.
REPORT_DISCLAIMER = (
    "This report is confidential and prepared for the above client only."
)

#: Allowed status transitions for the job lifecycle.
ALLOWED_TRANSITIONS: Dict[JobStatus, Set[JobStatus]] = {
    JobStatus.PENDING: {JobStatus.IN_PROGRESS, JobStatus.CANCELLED},
    JobStatus.IN_PROGRESS: {JobStatus.COMPLETED, JobStatus.CANCELLED},
    JobStatus.COMPLETED: set(),
    JobStatus.CANCELLED: set(),
}


class JobNotFoundError(Exception):
    """Raised when a job cannot be located."""


class JobStateError(Exception):
    """Raised when an operation is not valid for the job's current status."""


class BookingNotFoundError(Exception):
    """Raised when the booking a job should be created from does not exist."""


class JobAlreadyExistsError(Exception):
    """Raised when a booking has already been turned into a job."""


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


def build_job_payload(
    job: Job,
    customer: Optional[Customer] = None,
    technician: Optional[User] = None,
    booking: Optional[Booking] = None,
) -> dict:
    """Flatten a job (plus its relations) into the shape JobResponse expects."""
    return {
        "id": str(job.id),
        "job_number": job.job_number,
        "booking_id": str(job.booking_id),
        "booking_number": booking.booking_number if booking else None,
        "customer_id": str(job.customer_id),
        "customer_name": customer.full_name if customer else None,
        "customer_phone": customer.phone if customer else None,
        "customer_address": customer.address.one_line() if customer else None,
        "technician_id": str(job.technician_id) if job.technician_id else None,
        "technician_name": technician.full_name if technician else None,
        "status": job.status,
        "service_type": job.service_type,
        "pest_types": list(job.pest_types or []),
        "service_address": job.service_address,
        "scheduled_start": job.scheduled_start,
        "scheduled_end": job.scheduled_end,
        "actual_start": job.actual_start,
        "actual_end": job.actual_end,
        "duration_minutes": job.duration_minutes,
        "findings": [f.model_dump() for f in job.findings],
        "treatments": [t.model_dump() for t in job.treatments],
        "overall_risk_level": job.overall_risk_level,
        "inspection_notes": job.inspection_notes,
        "recommendations": job.recommendations,
        "follow_up_required": job.follow_up_required,
        "follow_up_notes": job.follow_up_notes,
        "next_service_due": job.next_service_due,
        "customer_name_signed": job.customer_name_signed,
        "customer_signature": job.customer_signature,
        "signed_at": job.signed_at,
        "technician_signature": job.technician_signature,
        "report_generated": job.report_generated,
        "report_generated_at": job.report_generated_at,
        "invoice_id": str(job.invoice_id) if job.invoice_id else None,
        "photo_count": job.photo_count,
        "created_by": str(job.created_by),
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


async def _load_relations(
    jobs: List[Job],
) -> Tuple[Dict[str, Customer], Dict[str, User], Dict[str, Booking]]:
    """Bulk-load the customers, technicians and bookings referenced by a page of jobs."""
    customer_ids = list({job.customer_id for job in jobs})
    technician_ids = list({j.technician_id for j in jobs if j.technician_id is not None})
    booking_ids = list({job.booking_id for job in jobs})

    customers: Dict[str, Customer] = {}
    technicians: Dict[str, User] = {}
    bookings: Dict[str, Booking] = {}

    if customer_ids:
        found = await Customer.find({"_id": {"$in": customer_ids}}).to_list()
        customers = {str(item.id): item for item in found}

    if technician_ids:
        found = await User.find({"_id": {"$in": technician_ids}}).to_list()
        technicians = {str(item.id): item for item in found}

    if booking_ids:
        found = await Booking.find({"_id": {"$in": booking_ids}}).to_list()
        bookings = {str(item.id): item for item in found}

    return customers, technicians, bookings


# ---------------------------------------------------------------------------
# Numbering
# ---------------------------------------------------------------------------


async def get_next_job_number() -> str:
    """Atomically increment the job counter and format it as RPT-0001.

    The prefix comes from company settings.
    """
    from app.services.company_settings_service import get_prefix  # noqa: PLC0415

    return await Counter.next_number(JOB_COUNTER, prefix=await get_prefix("job"))


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def create_job_from_booking(
    booking_id: "PydanticObjectId | str",
    user_id: PydanticObjectId,
) -> Tuple[Job, Optional[Customer], Optional[User], Optional[Booking]]:
    """Create a job from a booking, copying across the service and schedule info."""
    booking_oid = _to_object_id(booking_id)
    if booking_oid is None:
        raise BookingNotFoundError("Booking not found")

    booking = await Booking.get(booking_oid)
    if booking is None:
        raise BookingNotFoundError("Booking not found")

    if booking.job_id is not None:
        existing = await Job.get(booking.job_id)
        if existing is not None:
            raise JobAlreadyExistsError(
                f"Booking {booking.booking_number} already has job {existing.job_number}"
            )

    # Guard against a stale/missing job_id link by checking the collection too.
    duplicate = await Job.find_one({"booking_id": booking.id})
    if duplicate is not None:
        booking.job_id = duplicate.id
        booking.touch()
        await booking.save()
        raise JobAlreadyExistsError(
            f"Booking {booking.booking_number} already has job {duplicate.job_number}"
        )

    now = datetime.utcnow()
    job = Job(
        job_number=await get_next_job_number(),
        booking_id=booking.id,
        customer_id=booking.customer_id,
        technician_id=booking.technician_id,
        status=JobStatus.PENDING,
        service_type=booking.service_type,
        pest_types=list(booking.pest_types or []),
        service_address=booking.service_address,
        scheduled_start=booking.scheduled_start,
        scheduled_end=booking.scheduled_end,
        actual_start=booking.actual_start,
        actual_end=booking.actual_end,
        created_by=user_id,
        created_at=now,
        updated_at=now,
    )
    await job.insert()

    booking.job_id = job.id
    booking.touch()
    await booking.save()

    customer = await Customer.get(job.customer_id)
    technician = await User.get(job.technician_id) if job.technician_id else None
    return job, customer, technician, booking


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


async def list_jobs(
    page: int = 1,
    page_size: int = 20,
    status: Optional[JobStatus] = None,
    technician_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    q: Optional[str] = None,
) -> Tuple[List[dict], int]:
    """Return a page of job payloads (names embedded) plus the total count."""
    criteria: dict = {}

    if status is not None:
        criteria["status"] = status.value

    if technician_id:
        technician_oid = _to_object_id(technician_id)
        if technician_oid is None:
            return [], 0
        criteria["technician_id"] = technician_oid

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
        criteria["scheduled_start"] = date_filter

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

        or_clauses: List[dict] = [
            {"job_number": {"$regex": escaped, "$options": "i"}},
            {"service_type": {"$regex": escaped, "$options": "i"}},
        ]
        if matched_ids:
            or_clauses.append({"customer_id": {"$in": matched_ids}})
        criteria["$or"] = or_clauses

    query = Job.find(criteria) if criteria else Job.find_all()

    total = await query.count()
    skip = max(page - 1, 0) * page_size
    jobs = await query.sort("-scheduled_start").skip(skip).limit(page_size).to_list()

    customers, technicians, bookings = await _load_relations(jobs)
    payloads = [
        build_job_payload(
            job,
            customers.get(str(job.customer_id)),
            technicians.get(str(job.technician_id)) if job.technician_id else None,
            bookings.get(str(job.booking_id)),
        )
        for job in jobs
    ]
    return payloads, total


async def get_job(
    job_id: "PydanticObjectId | str",
) -> Tuple[Job, Optional[Customer], Optional[User], Optional[Booking]]:
    """Fetch a job with its customer, technician and booking."""
    oid = _to_object_id(job_id)
    if oid is None:
        raise JobNotFoundError("Job not found")

    job = await Job.get(oid)
    if job is None:
        raise JobNotFoundError("Job not found")

    customer = await Customer.get(job.customer_id)
    technician = await User.get(job.technician_id) if job.technician_id else None
    booking = await Booking.get(job.booking_id)
    return job, customer, technician, booking


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


async def update_job(
    job_id: "PydanticObjectId | str",
    data: JobUpdate,
) -> Tuple[Job, Optional[Customer], Optional[User], Optional[Booking]]:
    """Apply a partial update to the inspection report."""
    job, customer, technician, booking = await get_job(job_id)

    if job.status not in EDITABLE_STATUSES:
        raise JobStateError(f"A {job.status.value} job's report can no longer be edited")

    payload = data.model_dump(exclude_unset=True)

    if "findings" in payload and payload["findings"] is not None:
        job.findings = [InspectionFinding(**item) for item in payload["findings"]]

    if "treatments" in payload and payload["treatments"] is not None:
        job.treatments = [TreatmentApplied(**item) for item in payload["treatments"]]

    if "overall_risk_level" in payload:
        value = payload["overall_risk_level"]
        job.overall_risk_level = RiskLevel(value) if value is not None else None

    for field in ("inspection_notes", "recommendations", "follow_up_notes"):
        if field in payload:
            setattr(job, field, payload[field])

    if "follow_up_required" in payload and payload["follow_up_required"] is not None:
        job.follow_up_required = bool(payload["follow_up_required"])

    if "next_service_due" in payload:
        job.next_service_due = payload["next_service_due"]

    if "actual_start" in payload:
        job.actual_start = payload["actual_start"]

    if "actual_end" in payload:
        job.actual_end = payload["actual_end"]

    if job.actual_start and job.actual_end and job.actual_end < job.actual_start:
        raise JobStateError("The actual end time must be after the actual start time")

    job.touch()
    await job.save()
    return job, customer, technician, booking


async def _raise_invoice_for_job(job: Job, user_id: Optional[PydanticObjectId]) -> None:
    """Raise a draft invoice when a job is completed.

    Imported lazily: ``invoice_service`` imports the job model, so a top-level
    import here would be circular. Invoicing must never block the completion of
    a job, so any failure is logged and swallowed.
    """
    if job.invoice_id is not None:
        return

    from app.services import invoice_service  # noqa: PLC0415 - avoids a circular import

    try:
        invoice, _customer, _job, _quote = await invoice_service.create_invoice_from_job(
            job.id,
            user_id=user_id or job.created_by,
        )
    except invoice_service.InvoiceAlreadyExistsError:
        logger.info("Job %s already has an invoice - skipping", job.job_number)
        return
    except Exception:  # noqa: BLE001 - invoicing must not fail job completion
        logger.exception("Could not raise an invoice for job %s", job.job_number)
        return

    job.invoice_id = invoice.id
    logger.info(
        "Job %s completed - invoice %s raised (customer=%s)",
        job.job_number,
        invoice.invoice_number,
        job.customer_id,
    )


async def update_status(
    job_id: "PydanticObjectId | str",
    status: JobStatus,
    user_id: Optional[PydanticObjectId] = None,
) -> Tuple[Job, Optional[Customer], Optional[User], Optional[Booking]]:
    """Move a job to a new status, enforcing the lifecycle state machine."""
    job, customer, technician, booking = await get_job(job_id)

    if status == job.status:
        raise JobStateError(f"Job is already {status.value.replace('_', ' ')}")

    allowed = ALLOWED_TRANSITIONS.get(job.status, set())
    if status not in allowed:
        raise JobStateError(f"Cannot change a {job.status.value} job to {status.value}")

    now = datetime.utcnow()
    job.status = status

    if status == JobStatus.IN_PROGRESS:
        job.actual_start = now
        if user_id is not None and job.technician_id is None:
            # A technician starting an unassigned job takes ownership of it.
            starter = await User.get(user_id)
            if starter is not None and starter.role == UserRole.TECHNICIAN:
                job.technician_id = starter.id
                technician = starter
    elif status == JobStatus.COMPLETED:
        job.actual_end = now
        if job.actual_start is None:
            job.actual_start = job.scheduled_start
        if job.overall_risk_level is None:
            job.overall_risk_level = job.highest_severity()

    job.touch()
    await job.save()
    booking = await _sync_booking_from_job(job) or booking

    if status == JobStatus.COMPLETED:
        await _raise_invoice_for_job(job, user_id)

        # Imported lazily so the notification service can keep importing models
        # without the two modules racing each other at import time.
        from app.services import notification_service  # noqa: PLC0415

        await notification_service.notify_job_completed(job.id)

    return job, customer, technician, booking


# ---------------------------------------------------------------------------
# Visit sync
#
# A booking and its job are one site visit: the booking is the appointment,
# the job is the report. Their statuses move together - whichever side is
# changed, the other follows - so nobody has to push the same visit through
# two separate lifecycles.
# ---------------------------------------------------------------------------

#: The booking status that mirrors each job status. A pending job belongs to a
#: visit that has not started yet, so it leaves the booking alone.
_BOOKING_STATUS_FOR_JOB: Dict[JobStatus, BookingStatus] = {
    JobStatus.IN_PROGRESS: BookingStatus.IN_PROGRESS,
    JobStatus.COMPLETED: BookingStatus.COMPLETED,
    JobStatus.CANCELLED: BookingStatus.CANCELLED,
}


def report_has_content(job: Job) -> bool:
    """True once the report holds a finding or some inspection notes."""
    return bool(job.findings or (job.inspection_notes or "").strip())


async def find_job_for_booking(booking: Booking) -> Optional[Job]:
    """The job carrying a booking's report, or None if the visit has not started."""
    if booking.job_id is not None:
        job = await Job.get(booking.job_id)
        if job is not None:
            return job
    return await Job.find_one({"booking_id": booking.id})


async def sync_job_with_booking(booking: Booking, user_id: PydanticObjectId) -> Optional[Job]:
    """Bring a visit's job in line after its booking changed status.

    Starting the visit opens its job, so the technician has a report to fill
    in straight away. Completing or cancelling the visit takes the job with it.
    """
    job = await find_job_for_booking(booking)

    if booking.status == BookingStatus.CANCELLED:
        if job is not None and job.status not in TERMINAL_STATUSES:
            job, *_ = await update_status(job.id, JobStatus.CANCELLED, user_id)
        return job

    if booking.status not in (BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED):
        return job

    if job is None:
        job, *_ = await create_job_from_booking(booking.id, user_id)
    booking.job_id = job.id  # keep the caller's copy current for its response

    if job.status == JobStatus.PENDING:
        job, *_ = await update_status(job.id, JobStatus.IN_PROGRESS, user_id)
    if booking.status == BookingStatus.COMPLETED and job.status == JobStatus.IN_PROGRESS:
        job, *_ = await update_status(job.id, JobStatus.COMPLETED, user_id)
    return job


async def _sync_booking_from_job(job: Job) -> Optional[Booking]:
    """Move a visit's booking to match its job, which has just changed status.

    Writes the booking directly: going through booking_service would sync
    straight back to this job.
    """
    booking = await Booking.get(job.booking_id)
    target = _BOOKING_STATUS_FOR_JOB.get(job.status)
    if booking is None or target is None or booking.status == target:
        return booking
    if booking.status in BOOKING_TERMINAL_STATUSES:
        return booking

    booking.status = target
    booking.job_id = job.id
    if target == BookingStatus.IN_PROGRESS:
        booking.actual_start = job.actual_start
    elif target == BookingStatus.COMPLETED:
        booking.actual_start = booking.actual_start or job.actual_start
        booking.actual_end = job.actual_end
    booking.touch()
    await booking.save()
    return booking


async def update_signature(
    job_id: "PydanticObjectId | str",
    data: JobSignatureUpdate,
) -> Tuple[Job, Optional[Customer], Optional[User], Optional[Booking]]:
    """Save the customer and technician signatures against a job."""
    job, customer, technician, booking = await get_job(job_id)

    if job.status == JobStatus.CANCELLED:
        raise JobStateError("A cancelled job cannot be signed")

    payload = data.model_dump(exclude_unset=True)

    if "customer_name_signed" in payload:
        job.customer_name_signed = payload["customer_name_signed"]

    if "customer_signature" in payload:
        job.customer_signature = payload["customer_signature"]
        job.signed_at = datetime.utcnow() if payload["customer_signature"] else None

    if "technician_signature" in payload:
        job.technician_signature = payload["technician_signature"]

    job.touch()
    await job.save()
    return job, customer, technician, booking


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def delete_job(job_id: "PydanticObjectId | str") -> Job:
    """Hard-delete a pending job, releasing the booking's job link."""
    job, _customer, _technician, booking = await get_job(job_id)

    if job.status not in DELETABLE_STATUSES:
        raise JobStateError(f"A {job.status.value} job cannot be deleted")

    if booking is not None and booking.job_id == job.id:
        booking.job_id = None
        booking.touch()
        await booking.save()

    await Photo.find({"job_id": job.id}).delete()
    await job.delete()
    return job


async def count_jobs(status: Optional[JobStatus] = None) -> int:
    """Count jobs, optionally filtered by status."""
    if status is None:
        return await Job.find_all().count()
    return await Job.find({"status": status.value}).count()


# ---------------------------------------------------------------------------
# PDF report
# ---------------------------------------------------------------------------

EMERALD = colors.HexColor("#059669")
SLATE_900 = colors.HexColor("#0f172a")
SLATE_600 = colors.HexColor("#475569")
SLATE_300 = colors.HexColor("#cbd5e1")
SLATE_100 = colors.HexColor("#f1f5f9")
WHITE = colors.white

#: Fill colour used for each severity in the findings table.
SEVERITY_FILL = {
    RiskLevel.LOW: colors.HexColor("#10b981"),
    RiskLevel.MEDIUM: colors.HexColor("#eab308"),
    RiskLevel.HIGH: colors.HexColor("#f97316"),
    RiskLevel.CRITICAL: colors.HexColor("#ef4444"),
}

METHOD_LABELS = {
    TreatmentMethod.SPRAY: "Spray",
    TreatmentMethod.BAIT: "Bait",
    TreatmentMethod.DUST: "Dust",
    TreatmentMethod.GEL: "Gel",
    TreatmentMethod.TRAP: "Trap",
    TreatmentMethod.FUMIGATION: "Fumigation",
    TreatmentMethod.HEAT: "Heat",
    TreatmentMethod.OTHER: "Other",
}

#: Largest a report photo may be drawn, in points.
MAX_PHOTO_WIDTH = 400
MAX_PHOTO_HEIGHT = 300


def _pdf_date(value: Optional[datetime]) -> str:
    return value.strftime("%d %b %Y") if value else "--"


def _pdf_datetime(value: Optional[datetime]) -> str:
    return value.strftime("%d %b %Y, %I:%M %p") if value else "--"


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
        "companyName": ParagraphStyle(
            "CompanyName",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=SLATE_900,
        ),
        "reportTitle": ParagraphStyle(
            "ReportTitle",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=19,
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
        "jobNumber": ParagraphStyle(
            "JobNumber",
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
            fontSize=11,
            leading=15,
            textColor=SLATE_900,
            spaceBefore=4,
            spaceAfter=5,
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
            fontSize=8.5,
            leading=11,
            textColor=SLATE_900,
        ),
        "cellCentre": ParagraphStyle(
            "CellCentre",
            parent=base["Normal"],
            fontSize=8.5,
            leading=11,
            textColor=WHITE,
            fontName="Helvetica-Bold",
            alignment=TA_CENTER,
        ),
        "badge": ParagraphStyle(
            "Badge",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=20,
            textColor=WHITE,
            alignment=TA_CENTER,
        ),
        "caption": ParagraphStyle(
            "Caption",
            parent=base["Normal"],
            fontSize=8.5,
            leading=12,
            textColor=SLATE_600,
            alignment=TA_CENTER,
            spaceBefore=4,
        ),
        "footer": ParagraphStyle(
            "Footer",
            parent=base["Normal"],
            fontSize=8,
            leading=11,
            textColor=SLATE_600,
            alignment=TA_CENTER,
        ),
    }


def _address_lines(job: Job, customer: Optional[Customer]) -> List[str]:
    """Prefer the job's service address, falling back to the customer record."""
    address = job.service_address or {}
    if address:
        street = address.get("street") or ""
        locality = ", ".join(
            part
            for part in (
                address.get("city"),
                address.get("county"),
                address.get("postcode"),
            )
            if part
        )
        lines = [line for line in (street, locality) if line]
        if lines:
            return lines
    if customer is not None:
        return [customer.address.one_line()]
    return ["Address not recorded"]


def _kv_table(rows: List[Tuple[str, str]], styles: dict, col_widths=None) -> Table:
    """A two-column label/value block."""
    data = [
        [
            Paragraph(f"<b>{_escape(label)}</b>", styles["cell"]),
            Paragraph(_escape(value) or "--", styles["cell"]),
        ]
        for label, value in rows
    ]
    table = Table(data, colWidths=col_widths or [38 * mm, 136 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return table


def _decode_photo(photo: Photo) -> Optional[Image]:
    """Turn a stored base64 photo into a sized reportlab Image (None if unreadable)."""
    try:
        raw = base64.b64decode(photo.data, validate=False)
    except (binascii.Error, ValueError):
        logger.warning("Could not decode photo %s for the report", photo.id)
        return None

    try:
        reader = ImageReader(BytesIO(raw))
        width, height = reader.getSize()
    except Exception:  # noqa: BLE001 - unsupported or corrupt image payload
        logger.warning("Could not read photo %s for the report", photo.id)
        return None

    if not width or not height:
        return None

    scale = min(MAX_PHOTO_WIDTH / width, MAX_PHOTO_HEIGHT / height, 1.0)
    return Image(BytesIO(raw), width=width * scale, height=height * scale)


def _signature_image(data_url: Optional[str], max_width: float = 60 * mm) -> Optional[Image]:
    """Decode a base64 PNG data URL into a reportlab Image."""
    if not data_url or "," not in data_url:
        return None

    try:
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=False)
        reader = ImageReader(BytesIO(raw))
        width, height = reader.getSize()
    except Exception:  # noqa: BLE001 - malformed signature payload
        return None

    if not width or not height:
        return None

    scale = min(max_width / width, (24 * mm) / height, 1.0)
    return Image(BytesIO(raw), width=width * scale, height=height * scale)


def _severity_badge(level: RiskLevel, styles: dict, width: float = 22 * mm) -> Table:
    """A small filled pill showing a finding's severity."""
    badge = Table(
        [[Paragraph(level.value.upper(), styles["cellCentre"])]],
        colWidths=[width],
    )
    badge.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SEVERITY_FILL.get(level, SLATE_600)),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return badge


def _page_furniture(company_name: str):
    """Build the per-page footer callback for a given company name."""

    def _draw(canvas, _doc) -> None:
        """Footer disclaimer and page numbering on every page."""
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(SLATE_600)
        canvas.setStrokeColor(SLATE_300)
        canvas.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
        canvas.drawCentredString(A4[0] / 2, 10 * mm, REPORT_DISCLAIMER)
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {canvas.getPageNumber()}")
        canvas.drawString(18 * mm, 10 * mm, company_name)
        canvas.restoreState()

    return _draw


async def generate_report_pdf(job_id: "PydanticObjectId | str") -> Tuple[bytes, str]:
    """Render the full pest inspection report as an A4 PDF.

    Returns ``(pdf_bytes, job_number)`` and marks the job as having had its
    report generated.
    """
    job, customer, technician, booking = await get_job(job_id)

    # Company name, contact details, logo and accent colour come from the
    # company settings document. Imported lazily to avoid an import cycle.
    from app.services import pdf_branding  # noqa: PLC0415

    branding = await pdf_branding.load_branding()
    accent = pdf_branding.accent_color(branding)
    company_name = pdf_branding.company_name(branding)
    styles = _build_styles(accent)

    # Pull every photo referenced by a finding in one query.
    photo_ids = [
        oid
        for oid in (_to_object_id(pid) for finding in job.findings for pid in finding.photo_ids)
        if oid is not None
    ]
    photos: Dict[str, Photo] = {}
    if photo_ids:
        found = await Photo.find({"_id": {"$in": photo_ids}}).to_list()
        photos = {str(item.id): item for item in found}

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=22 * mm,
        title=f"Pest Control Inspection Report {job.job_number}",
        author=company_name,
        subject=f"Inspection report for job {booking.booking_number if booking else job.job_number}",
    )

    story: list = []

    # --- Header -----------------------------------------------------------
    company_block: list = []
    logo = pdf_branding.logo_flowable(branding)
    if logo is not None:
        company_block.append(logo)
        company_block.append(Spacer(1, 5))
        company_block.append(Paragraph(_escape(company_name), styles["companyName"]))
    else:
        company_block.append(Paragraph(_escape(company_name), styles["company"]))

    for line in pdf_branding.contact_lines(branding):
        company_block.append(Paragraph(_escape(line), styles["small"]))

    identity = pdf_branding.identity_line(branding)
    if identity:
        company_block.append(Paragraph(_escape(identity), styles["small"]))

    meta_block = [
        Paragraph("INSPECTION REPORT", styles["smallRight"]),
        Paragraph(job.job_number, styles["jobNumber"]),
        Spacer(1, 4),
        Paragraph(f"Date: {_pdf_date(job.actual_end or job.scheduled_start)}", styles["smallRight"]),
        Paragraph(
            f"Technician: {_escape(technician.full_name) if technician else 'Unassigned'}",
            styles["smallRight"],
        ),
        Paragraph(f"Status: {job.status.value.replace('_', ' ').title()}", styles["smallRight"]),
    ]

    header = Table([[company_block, meta_block]], colWidths=[100 * mm, 74 * mm])
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
    story.append(HRFlowable(width="100%", thickness=1.2, color=accent, spaceAfter=10))

    story.append(Paragraph("Pest Control Inspection Report", styles["reportTitle"]))
    story.append(Spacer(1, 10))

    # --- Customer + address ----------------------------------------------
    story.append(Paragraph("Client &amp; site", styles["sectionHeading"]))
    customer_rows: List[Tuple[str, str]] = [
        ("Client", customer.full_name if customer else "Customer record unavailable"),
        ("Phone", customer.phone if customer else "--"),
    ]
    if customer is not None and customer.email:
        customer_rows.append(("Email", customer.email))
    customer_rows.append(("Service address", ", ".join(_address_lines(job, customer))))
    if booking is not None:
        customer_rows.append(("Job reference", booking.booking_number))
    story.append(_kv_table(customer_rows, styles))
    story.append(Spacer(1, 12))

    # --- Service summary --------------------------------------------------
    story.append(Paragraph("Service summary", styles["sectionHeading"]))
    story.append(
        _kv_table(
            [
                ("Service type", job.service_type),
                ("Target pests", ", ".join(job.pest_types) if job.pest_types else "--"),
                (
                    "Scheduled",
                    f"{_pdf_datetime(job.scheduled_start)} to {_pdf_datetime(job.scheduled_end)}",
                ),
                (
                    "On site",
                    f"{_pdf_datetime(job.actual_start)} to {_pdf_datetime(job.actual_end)}"
                    if job.actual_start
                    else "Not recorded",
                ),
                ("Time on site", f"{job.duration_minutes} minutes"),
            ],
            styles,
        )
    )
    story.append(Spacer(1, 14))

    # --- Findings ---------------------------------------------------------
    story.append(Paragraph("Inspection findings", styles["sectionHeading"]))
    if job.findings:
        findings_data = [
            [
                Paragraph("<b>Area</b>", styles["cell"]),
                Paragraph("<b>Pest</b>", styles["cell"]),
                Paragraph("<b>Severity</b>", styles["cell"]),
                Paragraph("<b>Description</b>", styles["cell"]),
                Paragraph("<b>Recommendation</b>", styles["cell"]),
            ]
        ]
        for finding in job.findings:
            findings_data.append(
                [
                    Paragraph(_escape(finding.area), styles["cell"]),
                    Paragraph(_escape(finding.pest_type), styles["cell"]),
                    _severity_badge(finding.severity, styles, width=18 * mm),
                    Paragraph(_escape(finding.description) or "--", styles["cell"]),
                    Paragraph(_escape(finding.recommendation) or "--", styles["cell"]),
                ]
            )

        findings_table = Table(
            findings_data,
            colWidths=[26 * mm, 24 * mm, 20 * mm, 52 * mm, 52 * mm],
            repeatRows=1,
        )
        findings_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), SLATE_100),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.8, SLATE_300),
                    ("LINEBELOW", (0, 1), (-1, -1), 0.4, SLATE_300),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(findings_table)
    else:
        story.append(Paragraph("No findings were recorded for this visit.", styles["body"]))
    story.append(Spacer(1, 14))

    # --- Treatments -------------------------------------------------------
    story.append(Paragraph("Treatments applied", styles["sectionHeading"]))
    if job.treatments:
        treatment_data = [
            [
                Paragraph("<b>Pest</b>", styles["cell"]),
                Paragraph("<b>Method</b>", styles["cell"]),
                Paragraph("<b>Product</b>", styles["cell"]),
                Paragraph("<b>Conc.</b>", styles["cell"]),
                Paragraph("<b>Areas treated</b>", styles["cell"]),
                Paragraph("<b>Qty used</b>", styles["cell"]),
            ]
        ]
        for treatment in job.treatments:
            product = _escape(treatment.product_name) or "--"
            if treatment.safety_data_sheet_ref:
                product += (
                    f"<br/><font size=7 color='#475569'>SDS: "
                    f"{_escape(treatment.safety_data_sheet_ref)}</font>"
                )
            treatment_data.append(
                [
                    Paragraph(_escape(treatment.pest_type), styles["cell"]),
                    Paragraph(
                        METHOD_LABELS.get(treatment.method, treatment.method.value.title()),
                        styles["cell"],
                    ),
                    Paragraph(product, styles["cell"]),
                    Paragraph(_escape(treatment.product_concentration) or "--", styles["cell"]),
                    Paragraph(
                        _escape(", ".join(treatment.areas_treated)) or "--", styles["cell"]
                    ),
                    Paragraph(_escape(treatment.quantity_used) or "--", styles["cell"]),
                ]
            )

        treatments_table = Table(
            treatment_data,
            colWidths=[24 * mm, 22 * mm, 40 * mm, 18 * mm, 46 * mm, 24 * mm],
            repeatRows=1,
        )
        treatments_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), SLATE_100),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.8, SLATE_300),
                    ("LINEBELOW", (0, 1), (-1, -1), 0.4, SLATE_300),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(treatments_table)
    else:
        story.append(Paragraph("No treatments were applied during this visit.", styles["body"]))
    story.append(Spacer(1, 14))

    # --- Overall risk badge ----------------------------------------------
    risk = job.overall_risk_level or job.highest_severity()
    if risk is not None:
        badge = Table(
            [[Paragraph(f"OVERALL RISK: {risk.value.upper()}", styles["badge"])]],
            colWidths=[90 * mm],
            hAlign="LEFT",
        )
        badge.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), SEVERITY_FILL.get(risk, SLATE_600)),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ]
            )
        )
        story.append(badge)
        story.append(Spacer(1, 14))

    # --- Notes + recommendations -----------------------------------------
    story.append(Paragraph("Inspection notes", styles["sectionHeading"]))
    story.append(
        Paragraph(
            _escape(job.inspection_notes).replace("\n", "<br/>")
            if job.inspection_notes
            else "No additional notes recorded.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 12))

    story.append(Paragraph("Recommendations", styles["sectionHeading"]))
    story.append(
        Paragraph(
            _escape(job.recommendations).replace("\n", "<br/>")
            if job.recommendations
            else "No further recommendations.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 12))

    # --- Follow-up --------------------------------------------------------
    if job.follow_up_required:
        follow_rows: List[Tuple[str, str]] = [("Follow-up required", "Yes")]
        if job.follow_up_notes:
            follow_rows.append(("Details", job.follow_up_notes))
        if job.next_service_due:
            follow_rows.append(("Next service due", _pdf_date(job.next_service_due)))
        story.append(
            KeepTogether(
                [
                    Paragraph("Follow-up", styles["sectionHeading"]),
                    _kv_table(follow_rows, styles),
                ]
            )
        )
        story.append(Spacer(1, 12))

    # --- Photo pages ------------------------------------------------------
    photo_flowables: list = []
    for index, finding in enumerate(job.findings, start=1):
        finding_photos = [photos[pid] for pid in finding.photo_ids if pid in photos]
        if not finding_photos:
            continue

        photo_flowables.append(
            Paragraph(
                f"Finding {index}: {_escape(finding.area)} - {_escape(finding.pest_type)}",
                styles["sectionHeading"],
            )
        )
        for photo in finding_photos:
            image = _decode_photo(photo)
            if image is None:
                continue
            photo_flowables.append(
                KeepTogether(
                    [
                        image,
                        Paragraph(
                            f"{_escape(photo.filename)} - {_escape(finding.area)} "
                            f"({finding.severity.value})",
                            styles["caption"],
                        ),
                        Spacer(1, 12),
                    ]
                )
            )

    if photo_flowables:
        story.append(PageBreak())
        story.append(Paragraph("Photographic evidence", styles["reportTitle"]))
        story.append(Spacer(1, 10))
        story.extend(photo_flowables)

    # --- Signatures -------------------------------------------------------
    customer_sig = _signature_image(job.customer_signature)
    technician_sig = _signature_image(job.technician_signature)

    signature_column_customer: list = [
        Paragraph("<b>Customer</b>", styles["cell"]),
        Spacer(1, 4),
    ]
    if customer_sig is not None:
        signature_column_customer.append(customer_sig)
    else:
        signature_column_customer.append(Paragraph("Not signed", styles["small"]))
    signature_column_customer.extend(
        [
            HRFlowable(width="90%", thickness=0.6, color=SLATE_300, spaceBefore=4, spaceAfter=4),
            Paragraph(_escape(job.customer_name_signed) or "--", styles["cell"]),
            Paragraph(f"Signed: {_pdf_datetime(job.signed_at)}", styles["small"]),
        ]
    )

    signature_column_technician: list = [
        Paragraph("<b>Technician</b>", styles["cell"]),
        Spacer(1, 4),
    ]
    if technician_sig is not None:
        signature_column_technician.append(technician_sig)
    else:
        signature_column_technician.append(Paragraph("Not signed", styles["small"]))
    signature_column_technician.extend(
        [
            HRFlowable(width="90%", thickness=0.6, color=SLATE_300, spaceBefore=4, spaceAfter=4),
            Paragraph(
                _escape(technician.full_name) if technician else "Unassigned", styles["cell"]
            ),
            Paragraph(f"Completed: {_pdf_datetime(job.actual_end)}", styles["small"]),
        ]
    )

    signature_table = Table(
        [[signature_column_customer, signature_column_technician]],
        colWidths=[87 * mm, 87 * mm],
    )
    signature_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    story.append(
        KeepTogether(
            [
                Paragraph("Sign-off", styles["sectionHeading"]),
                signature_table,
            ]
        )
    )

    draw_furniture = _page_furniture(company_name)
    doc.build(story, onFirstPage=draw_furniture, onLaterPages=draw_furniture)

    job.report_generated = True
    job.report_generated_at = datetime.utcnow()
    job.touch()
    await job.save()

    return buffer.getvalue(), job.job_number
