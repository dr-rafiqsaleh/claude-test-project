"""Job document model - the on-site work order and its inspection report."""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from beanie import PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel

from app.models.tenant import TenantDocument

from app.models.company_settings import ProductCategory


class JobStatus(str, Enum):
    """Lifecycle states for a job."""

    PENDING = "pending"  # created from booking, awaiting technician
    IN_PROGRESS = "in_progress"  # technician started
    COMPLETED = "completed"  # report submitted
    CANCELLED = "cancelled"


class TreatmentMethod(str, Enum):
    """How a treatment was applied on site."""

    SPRAY = "spray"
    BAIT = "bait"
    DUST = "dust"
    GEL = "gel"
    TRAP = "trap"
    FUMIGATION = "fumigation"
    HEAT = "heat"
    OTHER = "other"


class RiskLevel(str, Enum):
    """Severity of a finding, and the overall risk rating of a job."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class VisitType(str, Enum):
    """Why the technician is on site."""

    INITIAL = "initial"
    FOLLOW_UP = "follow_up"
    ROUTINE = "routine"
    REQUESTED = "requested"
    CONTRACT = "contract"
    OTHER = "other"


class ActivityLevel(str, Enum):
    """How much pest activity the technician found, across the whole site."""

    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class HygieneRating(str, Enum):
    """The state of the site's hygiene and housekeeping."""

    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"


class ResponsibleParty(str, Enum):
    """Who needs to act on a finding's recommendation."""

    CUSTOMER = "customer"
    LANDLORD = "landlord"
    CONTRACTOR = "contractor"  # the pest control company itself


class BaitStatus(str, Enum):
    """What happened to a bait point on this visit."""

    DEPOSITED = "deposited"
    CHECKED = "checked"
    TOPPED_UP = "topped_up"
    REMOVED = "removed"


class AssessmentAnswer(str, Enum):
    """Whether an assessment was in place for this visit."""

    YES = "yes"
    NO = "no"
    NOT_APPLICABLE = "n_a"


#: Statuses a job can no longer move out of.
TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.CANCELLED}

#: Statuses where the inspection report is still editable.
EDITABLE_STATUSES = {JobStatus.PENDING, JobStatus.IN_PROGRESS}

#: Statuses a job may be deleted from.
DELETABLE_STATUSES = {JobStatus.PENDING}

#: Badge colour per risk level, shared with the PDF report and the frontend.
RISK_COLORS: Dict[RiskLevel, str] = {
    RiskLevel.LOW: "#10b981",
    RiskLevel.MEDIUM: "#eab308",
    RiskLevel.HIGH: "#f97316",
    RiskLevel.CRITICAL: "#ef4444",
}

#: Calendar/status colour per job status.
STATUS_COLORS: Dict[JobStatus, str] = {
    JobStatus.PENDING: "#64748b",
    JobStatus.IN_PROGRESS: "#f59e0b",
    JobStatus.COMPLETED: "#10b981",
    JobStatus.CANCELLED: "#ef4444",
}


class InspectionFinding(BaseModel):
    """One observation recorded during the inspection."""

    area: str  # e.g. "Kitchen", "Roof void", "Subfloor"
    pest_type: str  # e.g. "Cockroach", "Termite"
    severity: RiskLevel = RiskLevel.LOW  # shown as the finding's priority
    evidence: List[str] = Field(default_factory=list)  # e.g. "Droppings", "Gnawing"
    description: str = ""
    recommendation: str = ""
    responsible_party: Optional[ResponsibleParty] = None
    photo_ids: List[str] = Field(default_factory=list)  # Photo document ids


class TreatmentApplied(BaseModel):
    """One product used on site.

    The product's details are copied from the company product list when it is
    picked, so later edits to that list never change a written report.
    """

    pest_type: str
    method: TreatmentMethod = TreatmentMethod.SPRAY
    product_id: Optional[str] = None  # the company product list entry it came from
    product_name: str = ""
    product_category: Optional[ProductCategory] = None
    active_ingredient: Optional[str] = None
    formulation: Optional[str] = None
    registration_number: Optional[str] = None  # HSE / MAPP number
    product_concentration: Optional[str] = None  # e.g. "0.5%"
    areas_treated: List[str] = Field(default_factory=list)
    quantity_used: Optional[str] = None  # e.g. "500ml"
    bait_status: Optional[BaitStatus] = None
    safety_data_sheet_ref: Optional[str] = None


class ReportAssessments(BaseModel):
    """The assessments in place for a visit, as ticked on the report."""

    risk_assessment: Optional[AssessmentAnswer] = None
    coshh_assessment: Optional[AssessmentAnswer] = None
    environmental_assessment: Optional[AssessmentAnswer] = None
    site_plan: Optional[AssessmentAnswer] = None


class Job(TenantDocument):
    """A completed or in-flight service visit, with its pest inspection report."""

    job_number: str  # e.g. "RPT-0001" - shown to users as the report number
    booking_id: PydanticObjectId
    customer_id: PydanticObjectId
    technician_id: Optional[PydanticObjectId] = None
    status: JobStatus = JobStatus.PENDING

    # Service info (copied from the booking)
    service_type: str
    pest_types: List[str] = Field(default_factory=list)
    service_address: Optional[dict] = None

    # Schedule (actual times from the booking)
    scheduled_start: datetime
    scheduled_end: datetime
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None

    # Inspection report, in the order it is filled in on site
    visit_type: Optional[VisitType] = None
    visit_type_other: Optional[str] = None  # when visit_type is OTHER
    activity_level: Optional[ActivityLevel] = None
    pests_found: List[str] = Field(default_factory=list)
    inspection_notes: Optional[str] = None  # the inspection summary
    findings: List[InspectionFinding] = Field(default_factory=list)
    hygiene_rating: Optional[HygieneRating] = None
    hygiene_notes: Optional[str] = None
    proofing_notes: Optional[str] = None
    action_taken: Optional[str] = None
    treatments: List[TreatmentApplied] = Field(default_factory=list)
    recommendations: Optional[str] = None
    follow_up_required: bool = False
    follow_up_notes: Optional[str] = None
    next_service_due: Optional[datetime] = None
    assessments: ReportAssessments = Field(default_factory=ReportAssessments)
    # Superseded by activity_level on the report; kept for older records.
    overall_risk_level: Optional[RiskLevel] = None

    # Signature
    customer_name_signed: Optional[str] = None
    customer_signature: Optional[str] = None  # base64 PNG data URL
    signed_at: Optional[datetime] = None
    technician_signature: Optional[str] = None  # base64 PNG data URL
    customer_unable_to_sign: bool = False
    customer_unable_reason: Optional[str] = None  # e.g. "Tenant not at home"

    # Report generated
    report_generated: bool = False
    report_generated_at: Optional[datetime] = None

    # Invoice (Phase 5)
    invoice_id: Optional[PydanticObjectId] = None

    created_by: PydanticObjectId
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "jobs"
        indexes = [
            IndexModel([("client_id", 1), ("job_number", 1)], unique=True, name="uniq_job_number"),
            IndexModel([("booking_id", 1)], name="idx_booking_id"),
            IndexModel([("customer_id", 1)], name="idx_customer_id"),
            IndexModel([("technician_id", 1)], name="idx_technician_id"),
            IndexModel([("status", 1)], name="idx_status"),
        ]

    @property
    def duration_minutes(self) -> int:
        """Actual on-site length in whole minutes, falling back to the schedule."""
        start = self.actual_start or self.scheduled_start
        end = self.actual_end or self.scheduled_end
        if start is None or end is None:
            return 0
        return max(int((end - start).total_seconds() // 60), 0)

    @property
    def color(self) -> str:
        """Palette colour for the current status."""
        return STATUS_COLORS.get(self.status, "#64748b")

    @property
    def is_signed(self) -> bool:
        """True once a customer signature has been captured."""
        return bool(self.customer_signature)

    @property
    def photo_count(self) -> int:
        """Number of photos linked to findings on this job."""
        return sum(len(finding.photo_ids or []) for finding in self.findings)

    def highest_severity(self) -> Optional[RiskLevel]:
        """The worst severity across all findings, or None when there are none."""
        order = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]
        worst: Optional[RiskLevel] = None
        for finding in self.findings:
            if worst is None or order.index(finding.severity) > order.index(worst):
                worst = finding.severity
        return worst

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return f"{self.job_number} ({self.status.value})"
