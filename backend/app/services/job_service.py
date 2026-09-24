"""Job CRUD, lifecycle transitions and pest inspection report rendering."""

import base64
import binascii
import logging
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Dict, List, Optional, Set, Tuple

from beanie import PydanticObjectId
from PIL import Image as PILImage
from PIL import ImageOps
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

from app.core.uk_time import to_uk
from app.models.booking import TERMINAL_STATUSES as BOOKING_TERMINAL_STATUSES
from app.models.booking import Booking, BookingStatus, RecurrenceType
from app.models.company_settings import ProductCategory
from app.models.counter import JOB_COUNTER, Counter
from app.models.customer import Customer
from app.models.job import (
    DELETABLE_STATUSES,
    EDITABLE_STATUSES,
    ActivityLevel,
    AssessmentAnswer,
    BaitStatus,
    HygieneRating,
    InspectionFinding,
    Job,
    JobStatus,
    ReportAssessments,
    ResponsibleParty,
    TERMINAL_STATUSES,
    RiskLevel,
    TreatmentApplied,
    TreatmentMethod,
    VisitType,
)
from app.models.photo import Photo
from app.models.user import User, UserRole
from app.schemas.job import JobSignatureUpdate, JobUpdate

logger = logging.getLogger(__name__)

#: Company branding on the report reads from `company_settings_service`.
REPORT_DISCLAIMER = (
    "This report is confidential and prepared for the above client only."
)

#: A visit this soon after a completed one for the same site is a follow-up.
FOLLOW_UP_WINDOW_DAYS = 90

#: Plain-text report fields a partial update may set or clear.
REPORT_TEXT_FIELDS = (
    "visit_type_other",
    "inspection_notes",
    "hygiene_notes",
    "proofing_notes",
    "action_taken",
    "recommendations",
    "follow_up_notes",
    "customer_unable_reason",
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
        "customer_email": customer.email if customer else None,
        "customer_address": customer.address.one_line() if customer else None,
        "site_contact_name": booking.site_contact_name if booking else None,
        "site_contact_phone": booking.site_contact_phone if booking else None,
        "order_number": booking.order_number if booking else None,
        "technician_id": str(job.technician_id) if job.technician_id else None,
        "technician_name": technician.full_name if technician else None,
        "technician_job_title": technician.job_title if technician else None,
        "status": job.status,
        "service_type": job.service_type,
        "pest_types": list(job.pest_types or []),
        "service_address": job.service_address,
        "scheduled_start": job.scheduled_start,
        "scheduled_end": job.scheduled_end,
        "actual_start": job.actual_start,
        "actual_end": job.actual_end,
        "duration_minutes": job.duration_minutes,
        "visit_type": job.visit_type,
        "visit_type_other": job.visit_type_other,
        "activity_level": job.activity_level,
        "pests_found": list(job.pests_found or []),
        "inspection_notes": job.inspection_notes,
        "findings": [f.model_dump() for f in job.findings],
        "hygiene_rating": job.hygiene_rating,
        "hygiene_notes": job.hygiene_notes,
        "proofing_notes": job.proofing_notes,
        "action_taken": job.action_taken,
        "treatments": [t.model_dump() for t in job.treatments],
        "recommendations": job.recommendations,
        "follow_up_required": job.follow_up_required,
        "follow_up_notes": job.follow_up_notes,
        "next_service_due": job.next_service_due,
        "assessments": (job.assessments or ReportAssessments()).model_dump(),
        "overall_risk_level": job.overall_risk_level,
        "customer_name_signed": job.customer_name_signed,
        "customer_signature": job.customer_signature,
        "signed_at": job.signed_at,
        "technician_signature": job.technician_signature,
        "customer_unable_to_sign": job.customer_unable_to_sign,
        "customer_unable_reason": job.customer_unable_reason,
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


def _site_key(address: Optional[dict]) -> Tuple[str, str]:
    """A loose identity for a service address; None means the customer's own."""
    if not address:
        return ("", "")
    street = " ".join(str(address.get("street") or "").lower().split())
    postcode = str(address.get("postcode") or "").replace(" ", "").lower()
    return (street, postcode)


async def guess_visit_type(booking: Booking) -> VisitType:
    """A first guess at why the technician is going, changed with one tap on site.

    A repeating booking is a routine visit. A visit to a site that had a
    completed job in the last few months is a follow-up. Anything else is an
    initial visit.
    """
    if booking.recurrence != RecurrenceType.NONE or booking.parent_booking_id is not None:
        return VisitType.ROUTINE

    since = booking.scheduled_start - timedelta(days=FOLLOW_UP_WINDOW_DAYS)
    earlier = await Job.find(
        {
            "customer_id": booking.customer_id,
            "booking_id": {"$ne": booking.id},
            "status": JobStatus.COMPLETED.value,
            "scheduled_start": {"$gte": since, "$lte": booking.scheduled_start},
        }
    ).to_list()
    site = _site_key(booking.service_address)
    if any(_site_key(job.service_address) == site for job in earlier):
        return VisitType.FOLLOW_UP
    return VisitType.INITIAL


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
        # Pre-filled so the technician only has to correct them on site.
        visit_type=await guess_visit_type(booking),
        pests_found=list(booking.pest_types or []),
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
    include_unassigned: bool = False,
) -> Tuple[List[dict], int]:
    """Return a page of job payloads (names embedded) plus the total count.

    `include_unassigned` widens a technician filter to "theirs, plus the jobs
    nobody has been given yet".
    """
    criteria: dict = {}

    if status is not None:
        criteria["status"] = status.value

    if technician_id:
        technician_oid = _to_object_id(technician_id)
        if technician_oid is None:
            return [], 0
        # $in with None also matches jobs where the field was never set.
        criteria["technician_id"] = (
            {"$in": [technician_oid, None]} if include_unassigned else technician_oid
        )

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

    if "visit_type" in payload:
        value = payload["visit_type"]
        job.visit_type = VisitType(value) if value is not None else None

    if "activity_level" in payload:
        value = payload["activity_level"]
        job.activity_level = ActivityLevel(value) if value is not None else None

    if "hygiene_rating" in payload:
        value = payload["hygiene_rating"]
        job.hygiene_rating = HygieneRating(value) if value is not None else None

    if "pests_found" in payload and payload["pests_found"] is not None:
        job.pests_found = list(payload["pests_found"])

    if "assessments" in payload and payload["assessments"] is not None:
        job.assessments = ReportAssessments(**payload["assessments"])

    for field in REPORT_TEXT_FIELDS:
        if field in payload:
            setattr(job, field, payload[field])

    if "follow_up_required" in payload and payload["follow_up_required"] is not None:
        job.follow_up_required = bool(payload["follow_up_required"])

    if "customer_unable_to_sign" in payload and payload["customer_unable_to_sign"] is not None:
        job.customer_unable_to_sign = bool(payload["customer_unable_to_sign"])

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
            from app.services import role_service  # noqa: PLC0415

            if starter is not None and await role_service.has_permission(starter, "jobs.assignable"):
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


#: Why a visit cannot be completed yet, shared by every route that completes one.
REPORT_EMPTY_MESSAGE = (
    "Record the pest activity, a finding or the action taken in the report "
    "before completing the job"
)


def report_has_content(job: Job) -> bool:
    """True once the report records what was found or done on the visit."""
    return bool(
        job.findings
        or job.activity_level is not None
        or (job.inspection_notes or "").strip()
        or (job.action_taken or "").strip()
    )


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
#
# One report for every visit, laid out in the order the technician works:
# who and where, what was found, what was done, what happens next, then the
# safety advice and sign-off. A section with nothing recorded is left out, so
# a quick visit still produces a short report.
# ---------------------------------------------------------------------------

EMERALD = colors.HexColor("#059669")
SLATE_900 = colors.HexColor("#0f172a")
SLATE_600 = colors.HexColor("#475569")
SLATE_300 = colors.HexColor("#cbd5e1")
SLATE_100 = colors.HexColor("#f1f5f9")
WHITE = colors.white

#: Fill colour used for each finding priority.
SEVERITY_FILL = {
    RiskLevel.LOW: colors.HexColor("#10b981"),
    RiskLevel.MEDIUM: colors.HexColor("#eab308"),
    RiskLevel.HIGH: colors.HexColor("#f97316"),
    RiskLevel.CRITICAL: colors.HexColor("#ef4444"),
}

#: A finding's severity is shown to customers as its priority.
PRIORITY_LABELS = {
    RiskLevel.LOW: "Low",
    RiskLevel.MEDIUM: "Medium",
    RiskLevel.HIGH: "High",
    RiskLevel.CRITICAL: "Urgent",
}

ACTIVITY_FILL = {
    ActivityLevel.NONE: colors.HexColor("#10b981"),
    ActivityLevel.LOW: colors.HexColor("#eab308"),
    ActivityLevel.MEDIUM: colors.HexColor("#f97316"),
    ActivityLevel.HIGH: colors.HexColor("#ef4444"),
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

VISIT_TYPE_LABELS = {
    VisitType.INITIAL: "Initial",
    VisitType.FOLLOW_UP: "Follow-up",
    VisitType.ROUTINE: "Routine",
    VisitType.REQUESTED: "Requested",
    VisitType.CONTRACT: "Contract",
    VisitType.OTHER: "Other",
}

HYGIENE_LABELS = {
    HygieneRating.GOOD: "Good",
    HygieneRating.FAIR: "Fair",
    HygieneRating.POOR: "Poor",
}

BAIT_STATUS_LABELS = {
    BaitStatus.DEPOSITED: "Deposited",
    BaitStatus.CHECKED: "Checked",
    BaitStatus.TOPPED_UP: "Topped up",
    BaitStatus.REMOVED: "Removed",
}

ASSESSMENT_LABELS = (
    ("risk_assessment", "Risk assessment"),
    ("coshh_assessment", "COSHH assessment"),
    ("environmental_assessment", "Environmental assessment"),
    ("site_plan", "Site plan in place"),
)

ANSWER_LABELS = {
    AssessmentAnswer.YES: "Yes",
    AssessmentAnswer.NO: "No",
    AssessmentAnswer.NOT_APPLICABLE: "N/A",
}

#: Pests whose bait is a rodenticide, for products typed in by hand.
RODENT_PESTS = {"rat", "rats", "mouse", "mice", "rodent", "rodents", "squirrel", "squirrels"}

#: Largest a report photo may be drawn, in points.
MAX_PHOTO_WIDTH = 400
MAX_PHOTO_HEIGHT = 300

#: Longest side a photo is stored at inside the PDF, in pixels: sharp when
#: printed at the size above, without a phone camera's full resolution
#: making the report too big to email.
PHOTO_MAX_PIXELS = 1400

#: Width of the text column: A4 less 18mm margins, less the 6pt padding
#: reportlab's page frame keeps on each side. Tables sized to this line up
#: with the paragraphs around them.
CONTENT_WIDTH = A4[0] - 36 * mm - 12


def _uk_time(value: datetime) -> datetime:
    """A stored UTC time as the clock read in the UK."""
    return to_uk(value)


def _pdf_date(value: Optional[datetime]) -> str:
    return _uk_time(value).strftime("%d %b %Y") if value else "--"


def _pdf_time(value: Optional[datetime]) -> str:
    return _uk_time(value).strftime("%H:%M") if value else "--"


def _pdf_datetime(value: Optional[datetime]) -> str:
    return _uk_time(value).strftime("%d %b %Y, %H:%M") if value else "--"


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


def _text(value: Optional[str]) -> str:
    """Escaped text with its line breaks kept."""
    return _escape(value).replace("\n", "<br/>")


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
        "draft": ParagraphStyle(
            "Draft",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=12,
            textColor=colors.HexColor("#b45309"),
            alignment=TA_RIGHT,
        ),
        "sectionHeading": ParagraphStyle(
            "SectionHeading",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=15,
            textColor=accent,
            spaceBefore=4,
            spaceAfter=5,
            keepWithNext=1,
        ),
        "subHeading": ParagraphStyle(
            "SubHeading",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=13,
            textColor=SLATE_900,
            spaceBefore=2,
            spaceAfter=3,
            keepWithNext=1,
        ),
        "label": ParagraphStyle(
            "Label",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=10,
            textColor=SLATE_600,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontSize=9.5,
            leading=13,
            textColor=SLATE_900,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontSize=9,
            leading=12.5,
            textColor=SLATE_900,
            leftIndent=10,
            bulletIndent=0,
            spaceAfter=1.5,
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
            fontSize=8,
            leading=10,
            textColor=WHITE,
            fontName="Helvetica-Bold",
            alignment=TA_CENTER,
        ),
        "badge": ParagraphStyle(
            "Badge",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=13,
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


def _plain_table(data: list, col_widths: list, extra_styles: Optional[list] = None) -> Table:
    """A table with no borders and tight padding, for laying things out."""
    table = Table(data, colWidths=col_widths)
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                *(extra_styles or []),
            ]
        )
    )
    return table


def _kv_table(rows: List[Tuple[str, str]], styles: dict) -> Table:
    """A two-column label/value block. Values may carry reportlab markup."""
    data = [
        [
            Paragraph(f"<b>{_escape(label)}</b>", styles["cell"]),
            Paragraph(value or "--", styles["cell"]),
        ]
        for label, value in rows
    ]
    return _plain_table(data, [38 * mm, CONTENT_WIDTH - 38 * mm])


def _pill(text: str, fill, styles: dict, width: float, style: str = "cellCentre") -> Table:
    """A small filled label, used for priorities and the activity level."""
    pill = Table([[Paragraph(_escape(text), styles[style])]], colWidths=[width])
    pill.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    return pill


def _grid_style(header: bool = True) -> list:
    """Row rules for a data table, with an optional shaded header row."""
    rules = [
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, SLATE_300),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        rules += [
            ("BACKGROUND", (0, 0), (-1, 0), SLATE_100),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, SLATE_300),
        ]
    return rules


def _decode_photo(photo: Photo) -> Optional[Image]:
    """Turn a stored base64 photo into a sized reportlab Image (None if unreadable)."""
    try:
        raw = base64.b64decode(photo.data, validate=False)
    except (binascii.Error, ValueError):
        logger.warning("Could not decode photo %s for the report", photo.id)
        return None

    try:
        raw = _shrink_photo(raw)
        reader = ImageReader(BytesIO(raw))
        width, height = reader.getSize()
    except Exception:  # noqa: BLE001 - unsupported or corrupt image payload
        logger.warning("Could not read photo %s for the report", photo.id)
        return None

    if not width or not height:
        return None

    scale = min(MAX_PHOTO_WIDTH / width, MAX_PHOTO_HEIGHT / height, 1.0)
    return Image(BytesIO(raw), width=width * scale, height=height * scale)


def _shrink_photo(raw: bytes) -> bytes:
    """A photo turned the way the camera held it, no bigger than it needs to be, as JPEG."""
    with PILImage.open(BytesIO(raw)) as original:
        picture = ImageOps.exif_transpose(original)
        picture.thumbnail((PHOTO_MAX_PIXELS, PHOTO_MAX_PIXELS))
        if picture.mode not in ("RGB", "L"):
            picture = picture.convert("RGB")
        out = BytesIO()
        picture.save(out, "JPEG", quality=80, optimize=True)
        return out.getvalue()


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


def treatment_category(treatment: TreatmentApplied) -> Optional[ProductCategory]:
    """Which safety advice a treatment calls for, if any.

    A product picked from the product list carries its category. One typed in
    by hand is judged by how it was used: bait laid for rodents is a
    rodenticide, and any other chemical treatment an insecticide. Traps and
    heat are not chemical, so they call for no advice.
    """
    if treatment.product_category is not None:
        return treatment.product_category
    if treatment.method in (TreatmentMethod.TRAP, TreatmentMethod.HEAT, TreatmentMethod.OTHER):
        return None
    if treatment.pest_type.strip().lower() in RODENT_PESTS:
        return ProductCategory.RODENTICIDE if treatment.method == TreatmentMethod.BAIT else None
    return ProductCategory.INSECTICIDE


def _guidance_points(text: Optional[str]) -> List[str]:
    """Report wording from settings, one point per line."""
    return [line.strip().lstrip("*-• ").strip() for line in (text or "").splitlines() if line.strip()]


def _page_furniture(company_name: str, report_number: str):
    """Build the per-page footer callback."""

    def _draw(canvas, _doc) -> None:
        """Confidentiality note, report number and page number on every page."""
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(SLATE_600)
        canvas.setStrokeColor(SLATE_300)
        left, right = 18 * mm + 6, A4[0] - 18 * mm - 6  # the text column's edges
        canvas.line(left, 15 * mm, right, 15 * mm)
        canvas.drawCentredString(A4[0] / 2, 11 * mm, REPORT_DISCLAIMER)
        canvas.drawString(left, 7 * mm, f"{company_name}  |  Report {report_number}")
        canvas.drawRightString(right, 7 * mm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    return _draw


def _header(job: Job, booking: Optional[Booking], branding: dict, styles: dict, pdf_branding) -> list:
    """Company details on the left, the report's numbers and date on the right."""
    company_name = pdf_branding.company_name(branding)
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
        company_block.append(Paragraph(_escape(identity).replace("\n", "<br/>"), styles["small"]))

    meta_block: list = [
        Paragraph("REPORT", styles["smallRight"]),
        Paragraph(_escape(job.job_number), styles["jobNumber"]),
        Spacer(1, 4),
    ]
    if booking is not None:
        meta_block.append(Paragraph(f"Job {_escape(booking.booking_number)}", styles["smallRight"]))
    meta_block.append(
        Paragraph(f"Date {_pdf_date(job.actual_start or job.scheduled_start)}", styles["smallRight"])
    )
    if booking is not None and booking.order_number:
        meta_block.append(
            Paragraph(f"Order no. {_escape(booking.order_number)}", styles["smallRight"])
        )
    if job.status == JobStatus.CANCELLED:
        meta_block.append(Paragraph("CANCELLED", styles["draft"]))
    elif job.status != JobStatus.COMPLETED:
        meta_block.append(Paragraph("DRAFT - job not yet completed", styles["draft"]))

    header = _plain_table(
        [[company_block, meta_block]],
        [CONTENT_WIDTH - 72 * mm, 72 * mm],
        [("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0)],
    )
    accent = pdf_branding.accent_color(branding)
    return [
        header,
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=1.2, color=accent, spaceAfter=8),
        Paragraph("Pest Control Inspection &amp; Treatment Report", styles["reportTitle"]),
        Spacer(1, 8),
    ]


def _details(
    job: Job,
    customer: Optional[Customer],
    technician: Optional[User],
    booking: Optional[Booking],
    styles: dict,
) -> list:
    """Client, site and visit side by side, like the top of a paper report."""

    def column(title: str, lines: List[str]) -> list:
        return [Paragraph(title.upper(), styles["label"]), Spacer(1, 2)] + [
            Paragraph(line, styles["cell"]) for line in lines if line
        ]

    client_lines: List[str] = []
    if customer is not None:
        client_lines = [
            f"<b>{_escape(customer.full_name)}</b>",
            _escape(customer.address.one_line()),
            _escape(customer.phone),
            _escape(customer.email),
        ]
    else:
        client_lines = ["Customer record unavailable"]

    site_lines = [_escape(line) for line in _address_lines(job, customer)]
    if booking is not None and (booking.site_contact_name or booking.site_contact_phone):
        contact = ", ".join(
            part for part in (booking.site_contact_name, booking.site_contact_phone) if part
        )
        site_lines.append(f"<b>Site contact:</b> {_escape(contact)}")

    visit_type = VISIT_TYPE_LABELS.get(job.visit_type) if job.visit_type else None
    if job.visit_type == VisitType.OTHER and job.visit_type_other:
        visit_type = job.visit_type_other
    visit_lines = [
        f"<b>Type:</b> {_escape(visit_type)}" if visit_type else "",
        f"<b>Service:</b> {_escape(job.service_type)}",
        f"<b>Date:</b> {_pdf_date(job.actual_start or job.scheduled_start)}",
    ]
    if job.actual_start:
        time_out = _pdf_time(job.actual_end) if job.actual_end else "on site"
        visit_lines.append(f"<b>Time in:</b> {_pdf_time(job.actual_start)}  <b>Out:</b> {time_out}")
    if technician is not None:
        title = technician.job_title or "Technician"
        visit_lines.append(f"<b>{_escape(title)}:</b> {_escape(technician.full_name)}")

    width = CONTENT_WIDTH / 3
    table = Table(
        [[column("Client", client_lines), column("Site", site_lines), column("Visit", visit_lines)]],
        colWidths=[width, width, width],
    )
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, SLATE_300),
                ("LINEBEFORE", (1, 0), (-1, -1), 0.6, SLATE_300),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return [table, Spacer(1, 12)]


def _activity(job: Job, styles: dict) -> list:
    """The headline: how much activity, and which pests."""
    if job.activity_level is None and not job.pests_found:
        return []

    if job.activity_level == ActivityLevel.NONE:
        pill_text = "NO ACTIVITY"
        summary = "No pest activity was found on this visit."
    else:
        pill_text = (
            f"ACTIVITY: {job.activity_level.value.upper()}" if job.activity_level else "ACTIVITY FOUND"
        )
        pests = ", ".join(job.pests_found) if job.pests_found else "Not recorded"
        summary = f"<b>Pests found:</b> {_escape(pests)}"

    fill = ACTIVITY_FILL.get(job.activity_level, SLATE_600) if job.activity_level else SLATE_600
    row = _plain_table(
        [[_pill(pill_text, fill, styles, 40 * mm, "badge"), Paragraph(summary, styles["body"])]],
        [44 * mm, CONTENT_WIDTH - 44 * mm],
        [("VALIGN", (0, 0), (-1, -1), "MIDDLE")],
    )
    return [Paragraph("Pest activity", styles["sectionHeading"]), row, Spacer(1, 12)]


def _findings(job: Job, styles: dict, company_name: str) -> list:
    """The inspection summary, then each finding with its evidence and advice."""
    if not job.findings and not (job.inspection_notes or "").strip():
        return []

    flowables: list = [Paragraph("Inspection findings", styles["sectionHeading"])]
    if job.inspection_notes:
        flowables += [Paragraph(_text(job.inspection_notes), styles["body"]), Spacer(1, 6)]

    responsible = {
        ResponsibleParty.CUSTOMER: "Customer",
        ResponsibleParty.LANDLORD: "Landlord",
        ResponsibleParty.CONTRACTOR: company_name,
    }
    rows: list = []
    for finding in job.findings:
        where = [
            Paragraph(f"<b>{_escape(finding.area)}</b>", styles["cell"]),
            Paragraph(_escape(finding.pest_type), styles["cell"]),
            Spacer(1, 4),
            _pill(
                PRIORITY_LABELS.get(finding.severity, finding.severity.value).upper(),
                SEVERITY_FILL.get(finding.severity, SLATE_600),
                styles,
                20 * mm,
            ),
        ]
        detail: list = []
        if finding.description:
            detail.append(Paragraph(_text(finding.description), styles["cell"]))
        if finding.evidence:
            detail.append(
                Paragraph(f"<b>Evidence:</b> {_escape(', '.join(finding.evidence))}", styles["cell"])
            )
        if finding.recommendation:
            detail.append(
                Paragraph(f"<b>Recommendation:</b> {_text(finding.recommendation)}", styles["cell"])
            )
        if finding.responsible_party:
            detail.append(
                Paragraph(
                    f"<b>Action by:</b> {_escape(responsible[finding.responsible_party])}",
                    styles["cell"],
                )
            )
        rows.append([where, detail or [Paragraph("--", styles["cell"])]])

    if rows:
        table = Table(rows, colWidths=[40 * mm, CONTENT_WIDTH - 40 * mm])
        table.setStyle(TableStyle(_grid_style(header=False) + [
            ("LINEABOVE", (0, 0), (-1, 0), 0.4, SLATE_300),
        ]))
        flowables.append(table)
    flowables.append(Spacer(1, 12))
    return flowables


def _conditions(job: Job, styles: dict) -> list:
    """Hygiene and proofing: what the customer needs to put right."""
    rows: List[Tuple[str, str]] = []
    if job.hygiene_rating or job.hygiene_notes:
        rating = HYGIENE_LABELS.get(job.hygiene_rating, "") if job.hygiene_rating else ""
        notes = _text(job.hygiene_notes)
        rows.append(("Hygiene", " - ".join(part for part in (f"<b>{rating}</b>" if rating else "", notes) if part)))
    if job.proofing_notes:
        rows.append(("Proofing", _text(job.proofing_notes)))
    if not rows:
        return []
    return [
        Paragraph("Hygiene &amp; proofing", styles["sectionHeading"]),
        _kv_table(rows, styles),
        Spacer(1, 12),
    ]


def _treatment(job: Job, styles: dict) -> list:
    """What was done, and every product used with its registration details."""
    if not job.treatments and not (job.action_taken or "").strip():
        return []

    flowables: list = [Paragraph("Action taken &amp; products used", styles["sectionHeading"])]
    if job.action_taken:
        flowables += [Paragraph(_text(job.action_taken), styles["body"]), Spacer(1, 6)]

    if job.treatments:
        data = [
            [
                Paragraph(f"<b>{heading}</b>", styles["cell"])
                for heading in (
                    "Product",
                    "Active ingredient",
                    "HSE/MAPP no.",
                    "Quantity",
                    "Location",
                    "Bait status",
                )
            ]
        ]
        for treatment in job.treatments:
            details = [
                treatment.formulation,
                METHOD_LABELS.get(treatment.method, treatment.method.value.title()),
                f"for {treatment.pest_type}",
            ]
            product = (
                f"<b>{_escape(treatment.product_name) or '--'}</b><br/>"
                f"<font size=7.5 color='#475569'>{_escape(', '.join(d for d in details if d))}</font>"
            )
            if treatment.safety_data_sheet_ref:
                product += (
                    f"<br/><font size=7.5 color='#475569'>SDS: "
                    f"{_escape(treatment.safety_data_sheet_ref)}</font>"
                )
            ingredient = _escape(treatment.active_ingredient) or "--"
            if treatment.product_concentration:
                ingredient += f" ({_escape(treatment.product_concentration)})"
            data.append(
                [
                    Paragraph(product, styles["cell"]),
                    Paragraph(ingredient, styles["cell"]),
                    Paragraph(_escape(treatment.registration_number) or "--", styles["cell"]),
                    Paragraph(_escape(treatment.quantity_used) or "--", styles["cell"]),
                    Paragraph(_escape(", ".join(treatment.areas_treated)) or "--", styles["cell"]),
                    Paragraph(
                        BAIT_STATUS_LABELS.get(treatment.bait_status, "--")
                        if treatment.bait_status
                        else "--",
                        styles["cell"],
                    ),
                ]
            )
        shares = (42, 32, 22, 20, 36, 22)  # of 174
        table = Table(
            data,
            colWidths=[CONTENT_WIDTH * share / sum(shares) for share in shares],
            repeatRows=1,
        )
        table.setStyle(TableStyle(_grid_style()))
        flowables.append(table)
    flowables.append(Spacer(1, 12))
    return flowables


def _next_steps(job: Job, styles: dict) -> list:
    """Recommendations, and whether we are coming back."""
    flowables: list = [Paragraph("Recommendations &amp; follow-up", styles["sectionHeading"])]
    if job.recommendations:
        flowables += [Paragraph(_text(job.recommendations), styles["body"]), Spacer(1, 6)]

    if job.follow_up_required:
        due = "Yes"
        if job.next_service_due:
            due += f", by {_pdf_date(job.next_service_due)}"
        rows: List[Tuple[str, str]] = [("Follow-up due", due)]
        if job.follow_up_notes:
            rows.append(("Details", _text(job.follow_up_notes)))
    else:
        rows = [("Follow-up due", "No")]
    flowables += [_kv_table(rows, styles), Spacer(1, 12)]
    return flowables


def _assessments(job: Job, styles: dict) -> list:
    """The assessments in place for this visit, as the technician recorded them."""
    answers = job.assessments or ReportAssessments()
    if not any(getattr(answers, key) for key, _label in ASSESSMENT_LABELS):
        return []

    cells = []
    for key, label in ASSESSMENT_LABELS:
        answer = getattr(answers, key)
        cells.append(
            [
                Paragraph(label.upper(), styles["label"]),
                Paragraph(f"<b>{ANSWER_LABELS[answer]}</b>" if answer else "Not recorded", styles["cell"]),
            ]
        )
    width = CONTENT_WIDTH / len(cells)
    table = Table([cells], colWidths=[width] * len(cells))
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, SLATE_300),
                ("LINEBEFORE", (1, 0), (-1, -1), 0.6, SLATE_300),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return [Paragraph("Assessments", styles["sectionHeading"]), table, Spacer(1, 12)]


def _safety(job: Job, branding: dict, styles: dict) -> list:
    """Safety advice for the kinds of product used, then the declaration."""
    used = {treatment_category(treatment) for treatment in job.treatments}
    groups = [
        ("Insecticide treatments", ProductCategory.INSECTICIDE, "report_insecticide_guidance"),
        ("Rodenticide treatments", ProductCategory.RODENTICIDE, "report_rodenticide_guidance"),
    ]

    flowables: list = []
    for title, category, key in groups:
        points = _guidance_points(branding.get(key))
        if category not in used or not points:
            continue
        flowables.append(Paragraph(title, styles["subHeading"]))
        flowables += [Paragraph(_escape(point), styles["bullet"], bulletText="•") for point in points]
        flowables.append(Spacer(1, 4))
    if flowables:
        flowables = [Paragraph("Safety advice", styles["sectionHeading"])] + flowables + [Spacer(1, 8)]

    declaration = (branding.get("report_declaration") or "").strip()
    if declaration:
        flowables += [
            Paragraph("Declaration", styles["sectionHeading"]),
            Paragraph(_text(declaration), styles["body"]),
            Spacer(1, 12),
        ]
    return flowables


def _sign_off(job: Job, technician: Optional[User], styles: dict) -> KeepTogether:
    """Technician and customer signatures, side by side."""
    rule = HRFlowable(width="90%", thickness=0.6, color=SLATE_300, spaceBefore=4, spaceAfter=4)

    technician_column: list = [Paragraph("<b>Technician</b>", styles["cell"]), Spacer(1, 4)]
    technician_sig = _signature_image(job.technician_signature)
    technician_column.append(
        technician_sig if technician_sig is not None else Paragraph("Not signed", styles["small"])
    )
    technician_column += [
        rule,
        Paragraph(_escape(technician.full_name) if technician else "Unassigned", styles["cell"]),
        Paragraph(
            _escape(technician.job_title) if technician and technician.job_title else "Technician",
            styles["small"],
        ),
        Paragraph(f"Date: {_pdf_datetime(job.actual_end)}", styles["small"]),
    ]

    customer_column: list = [
        Paragraph("<b>Customer</b>", styles["cell"]),
        Paragraph("I have read and understood this report.", styles["small"]),
        Spacer(1, 4),
    ]
    if job.customer_unable_to_sign and not job.customer_signature:
        reason = _escape(job.customer_unable_reason) or "No reason given"
        customer_column += [
            Paragraph("<b>Customer not available to sign</b>", styles["cell"]),
            Paragraph(reason, styles["small"]),
        ]
    else:
        customer_sig = _signature_image(job.customer_signature)
        customer_column += [
            customer_sig if customer_sig is not None else Paragraph("Not signed", styles["small"]),
            HRFlowable(width="90%", thickness=0.6, color=SLATE_300, spaceBefore=4, spaceAfter=4),
            Paragraph(_escape(job.customer_name_signed) or "--", styles["cell"]),
            Paragraph(f"Date: {_pdf_datetime(job.signed_at)}", styles["small"]),
        ]

    table = _plain_table(
        [[technician_column, customer_column]],
        [CONTENT_WIDTH / 2, CONTENT_WIDTH / 2],
        [("RIGHTPADDING", (0, 0), (-1, -1), 8)],
    )
    return KeepTogether([Paragraph("Sign-off", styles["sectionHeading"]), table])


def _photo_pages(job: Job, photos: Dict[str, Photo], styles: dict) -> list:
    """Every finding's photos, at the back of the report."""
    flowables: list = []
    for index, finding in enumerate(job.findings, start=1):
        finding_photos = [photos[pid] for pid in finding.photo_ids if pid in photos]
        if not finding_photos:
            continue
        flowables.append(
            Paragraph(
                f"Finding {index}: {_escape(finding.area)} - {_escape(finding.pest_type)}",
                styles["sectionHeading"],
            )
        )
        for photo in finding_photos:
            image = _decode_photo(photo)
            if image is None:
                continue
            flowables.append(
                KeepTogether(
                    [
                        image,
                        Paragraph(
                            f"{_escape(photo.filename)} - {_escape(finding.area)} "
                            f"(priority: {PRIORITY_LABELS.get(finding.severity, '').lower()})",
                            styles["caption"],
                        ),
                        Spacer(1, 12),
                    ]
                )
            )
    if not flowables:
        return []
    return [
        PageBreak(),
        Paragraph("Photographic evidence", styles["reportTitle"]),
        Spacer(1, 10),
        *flowables,
    ]


async def generate_report_pdf(job_id: "PydanticObjectId | str") -> Tuple[bytes, str]:
    """Render the inspection and treatment report as an A4 PDF.

    Returns ``(pdf_bytes, job_number)`` and marks the job as having had its
    report generated.
    """
    job, customer, technician, booking = await get_job(job_id)

    # Company name, contact details, logo, accent colour and report wording
    # come from the company settings. Imported lazily to avoid an import cycle.
    from app.services import pdf_branding  # noqa: PLC0415

    branding = await pdf_branding.load_branding()
    company_name = pdf_branding.company_name(branding)
    styles = _build_styles(pdf_branding.accent_color(branding))

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
        title=f"Pest Control Inspection & Treatment Report {job.job_number}",
        author=company_name,
        subject=f"Inspection report for job {booking.booking_number if booking else job.job_number}",
    )

    story: list = [
        *_header(job, booking, branding, styles, pdf_branding),
        *_details(job, customer, technician, booking, styles),
        *_activity(job, styles),
        *_findings(job, styles, company_name),
        *_conditions(job, styles),
        *_treatment(job, styles),
        *_next_steps(job, styles),
        *_assessments(job, styles),
        *_safety(job, branding, styles),
        _sign_off(job, technician, styles),
        *_photo_pages(job, photos, styles),
    ]

    draw_furniture = _page_furniture(company_name, job.job_number)
    doc.build(story, onFirstPage=draw_furniture, onLaterPages=draw_furniture)

    job.report_generated = True
    job.report_generated_at = datetime.utcnow()
    job.touch()
    await job.save()

    return buffer.getvalue(), job.job_number
