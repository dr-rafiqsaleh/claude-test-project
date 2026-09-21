"""Job document model - the on-site work order and its inspection report."""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel


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
    severity: RiskLevel = RiskLevel.LOW
    description: str = ""
    recommendation: str = ""
    photo_ids: List[str] = Field(default_factory=list)  # Photo document ids


class TreatmentApplied(BaseModel):
    """One treatment carried out on site."""

    pest_type: str
    method: TreatmentMethod = TreatmentMethod.SPRAY
    product_name: str = ""
    product_concentration: Optional[str] = None  # e.g. "0.5%"
    areas_treated: List[str] = Field(default_factory=list)
    quantity_used: Optional[str] = None  # e.g. "500ml"
    safety_data_sheet_ref: Optional[str] = None


class Job(Document):
    """A completed or in-flight service visit, with its pest inspection report."""

    job_number: str  # e.g. "JOB-0001"
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

    # Inspection report
    findings: List[InspectionFinding] = Field(default_factory=list)
    treatments: List[TreatmentApplied] = Field(default_factory=list)
    overall_risk_level: Optional[RiskLevel] = None
    inspection_notes: Optional[str] = None
    recommendations: Optional[str] = None
    follow_up_required: bool = False
    follow_up_notes: Optional[str] = None
    next_service_due: Optional[datetime] = None

    # Signature
    customer_name_signed: Optional[str] = None
    customer_signature: Optional[str] = None  # base64 PNG data URL
    signed_at: Optional[datetime] = None
    technician_signature: Optional[str] = None  # base64 PNG data URL

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
            IndexModel([("job_number", 1)], unique=True, name="uniq_job_number"),
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
