"""Job and inspection-photo routes.

All routes require authentication.

* Admin and office staff see and manage every job.
* Technicians see only the jobs assigned to them, and may start a job, fill in
  its report, capture signatures and complete it.
* Only admins may cancel or delete a job.
"""

from datetime import datetime
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response, StreamingResponse

from app.config import settings
from app.core.dependencies import (
    get_current_user,
    get_current_user_flexible,
    require_admin,
    require_staff,
)
from app.models.job import Job, JobStatus
from app.models.user import User, UserRole
from app.schemas.job import (
    JobListData,
    JobListResponse,
    JobResponse,
    JobResponseEnvelope,
    JobSignatureUpdate,
    JobStatusUpdate,
    JobUpdate,
    PhotoListData,
    PhotoListResponse,
    PhotoResponse,
    PhotoResponseEnvelope,
)
from app.services import job_service, photo_service
from app.services.job_service import (
    BookingNotFoundError,
    JobAlreadyExistsError,
    JobNotFoundError,
    JobStateError,
    build_job_payload,
)
from app.services.photo_service import InvalidPhotoError, PhotoNotFoundError

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


def _is_technician(user: User) -> bool:
    return user.role == UserRole.TECHNICIAN


def _is_assigned(user: User, job: Job) -> bool:
    return job.technician_id is not None and str(job.technician_id) == str(user.id)


def _assert_can_view(user: User, job: Job) -> None:
    """Technicians may only open jobs assigned to them."""
    if _is_technician(user) and not _is_assigned(user, job):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view jobs assigned to you",
        )


def _assert_can_edit(user: User, job: Job) -> None:
    """Office staff, admins and the assigned technician may edit the report."""
    if user.role in (UserRole.ADMIN, UserRole.OFFICE_STAFF):
        return
    if _is_technician(user) and _is_assigned(user, job):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You can only edit jobs assigned to you",
    )


async def _load_job_or_404(job_id: str) -> tuple:
    try:
        return await job_service.get_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Collection routes
# ---------------------------------------------------------------------------


@router.get("", response_model=JobListResponse, summary="List jobs")
@router.get("/", response_model=JobListResponse, include_in_schema=False)
async def list_jobs(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    job_status: Optional[JobStatus] = Query(None, alias="status", description="Filter by status"),
    technician_id: Optional[str] = Query(None, description="Filter by assigned technician"),
    customer_id: Optional[str] = Query(None, description="Filter by customer"),
    date_from: Optional[datetime] = Query(None, description="Only jobs starting on or after this date"),
    date_to: Optional[datetime] = Query(None, description="Only jobs starting on or before this date"),
    q: Optional[str] = Query(None, description="Search job number, service type or customer name"),
    current_user: User = Depends(get_current_user),
) -> JobListResponse:
    """Return a paginated, filterable list of jobs."""
    # Technicians are locked to their own work.
    if _is_technician(current_user):
        technician_id = str(current_user.id)

    payloads, total = await job_service.list_jobs(
        page=page,
        page_size=page_size,
        status=job_status,
        technician_id=technician_id,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
    )

    return JobListResponse(
        data=JobListData(
            items=[JobResponse.model_validate(payload) for payload in payloads],
            total=total,
            page=page,
            page_size=page_size,
        ),
        message=f"{total} job(s) found",
        success=True,
    )


@router.post(
    "/from-booking/{booking_id}",
    response_model=JobResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Create a job from a booking",
)
async def create_job_from_booking(
    booking_id: str,
    current_user: User = Depends(require_staff),
) -> JobResponseEnvelope:
    """Turn a booking into a job, copying across the service info and schedule."""
    try:
        job, customer, technician, booking = await job_service.create_job_from_booking(
            booking_id,
            user_id=current_user.id,
        )
    except BookingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except JobAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return JobResponseEnvelope(
        data=JobResponse.model_validate(build_job_payload(job, customer, technician, booking)),
        message=f"Job {job.job_number} created successfully",
        success=True,
    )


# ---------------------------------------------------------------------------
# Item routes
# ---------------------------------------------------------------------------


@router.get("/{job_id}", response_model=JobResponseEnvelope, summary="Get a job by id")
async def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> JobResponseEnvelope:
    """Fetch a single job with its report."""
    job, customer, technician, booking = await _load_job_or_404(job_id)
    _assert_can_view(current_user, job)

    return JobResponseEnvelope(
        data=JobResponse.model_validate(build_job_payload(job, customer, technician, booking)),
        message="Job retrieved",
        success=True,
    )


@router.put("/{job_id}", response_model=JobResponseEnvelope, summary="Update the inspection report")
async def update_job(
    job_id: str,
    payload: JobUpdate,
    current_user: User = Depends(get_current_user),
) -> JobResponseEnvelope:
    """Update the report fields. Allowed while the job is pending or in progress."""
    existing, _customer, _technician, _booking = await _load_job_or_404(job_id)
    _assert_can_edit(current_user, existing)

    try:
        job, customer, technician, booking = await job_service.update_job(job_id, payload)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except JobStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return JobResponseEnvelope(
        data=JobResponse.model_validate(build_job_payload(job, customer, technician, booking)),
        message="Report saved",
        success=True,
    )


@router.patch(
    "/{job_id}/status",
    response_model=JobResponseEnvelope,
    summary="Update job status",
)
async def update_job_status(
    job_id: str,
    payload: JobStatusUpdate,
    current_user: User = Depends(get_current_user),
) -> JobResponseEnvelope:
    """Move a job through its lifecycle."""
    existing, _customer, _technician, _booking = await _load_job_or_404(job_id)

    if payload.status == JobStatus.CANCELLED and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an admin can cancel a job",
        )

    if _is_technician(current_user):
        allowed_for_technician = (
            existing.status == JobStatus.PENDING and payload.status == JobStatus.IN_PROGRESS
        ) or (
            existing.status == JobStatus.IN_PROGRESS and payload.status == JobStatus.COMPLETED
        )
        if not _is_assigned(current_user, existing) or not allowed_for_technician:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Technicians can only start and complete jobs assigned to them",
            )
    elif current_user.role not in (UserRole.ADMIN, UserRole.OFFICE_STAFF):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )

    if payload.status == JobStatus.COMPLETED and not (
        existing.findings or (existing.inspection_notes or "").strip()
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record at least one finding or some inspection notes before completing the job",
        )

    try:
        job, customer, technician, booking = await job_service.update_status(
            job_id,
            payload.status,
            user_id=current_user.id,
        )
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except JobStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return JobResponseEnvelope(
        data=JobResponse.model_validate(build_job_payload(job, customer, technician, booking)),
        message=f"Job marked as {job.status.value.replace('_', ' ')}",
        success=True,
    )


@router.patch(
    "/{job_id}/signature",
    response_model=JobResponseEnvelope,
    summary="Save the customer and technician signatures",
)
async def update_job_signature(
    job_id: str,
    payload: JobSignatureUpdate,
    current_user: User = Depends(get_current_user),
) -> JobResponseEnvelope:
    """Capture the on-site sign-off."""
    existing, _customer, _technician, _booking = await _load_job_or_404(job_id)
    _assert_can_edit(current_user, existing)

    try:
        job, customer, technician, booking = await job_service.update_signature(job_id, payload)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except JobStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return JobResponseEnvelope(
        data=JobResponse.model_validate(build_job_payload(job, customer, technician, booking)),
        message="Signatures saved",
        success=True,
    )


@router.get(
    "/{job_id}/report",
    summary="Download the pest inspection report as PDF",
    response_class=StreamingResponse,
)
async def download_job_report(
    job_id: str,
    current_user: User = Depends(get_current_user_flexible),
) -> StreamingResponse:
    """Render the inspection report as an A4 PDF and stream it back."""
    job, _customer, _technician, _booking = await _load_job_or_404(job_id)
    _assert_can_view(current_user, job)

    pdf_bytes, job_number = await job_service.generate_report_pdf(job_id)

    filename = f"job-{job_number}-report.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.delete("/{job_id}", response_model=JobResponseEnvelope, summary="Delete a job")
async def delete_job(
    job_id: str,
    _current_user: User = Depends(require_admin),
) -> JobResponseEnvelope:
    """Permanently delete a pending job and its photos."""
    try:
        job = await job_service.delete_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except JobStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return JobResponseEnvelope(
        data=JobResponse.model_validate(build_job_payload(job)),
        message=f"Job {job.job_number} deleted",
        success=True,
    )


# ---------------------------------------------------------------------------
# Photo routes
# ---------------------------------------------------------------------------


@router.post(
    "/{job_id}/photos",
    response_model=PhotoResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Upload an inspection photo",
)
async def upload_job_photo(
    job_id: str,
    file: UploadFile = File(..., description="A JPEG, PNG or WebP image under 10 MB"),
    current_user: User = Depends(get_current_user),
) -> PhotoResponseEnvelope:
    """Attach a photo to a job."""
    job, _customer, _technician, _booking = await _load_job_or_404(job_id)
    _assert_can_edit(current_user, job)

    try:
        payload = await photo_service.upload_photo(job.id, file, user_id=current_user.id)
    except InvalidPhotoError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except PhotoNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return PhotoResponseEnvelope(
        data=PhotoResponse.model_validate(payload),
        message="Photo uploaded",
        success=True,
    )


@router.get(
    "/{job_id}/photos",
    response_model=PhotoListResponse,
    summary="List a job's inspection photos",
)
async def list_job_photos(
    job_id: str,
    current_user: User = Depends(get_current_user),
) -> PhotoListResponse:
    """Return the metadata for every photo on a job (image data is served separately)."""
    job, _customer, _technician, _booking = await _load_job_or_404(job_id)
    _assert_can_view(current_user, job)

    payloads = await photo_service.list_photos(job.id)

    return PhotoListResponse(
        data=PhotoListData(
            items=[PhotoResponse.model_validate(p) for p in payloads],
            total=len(payloads),
        ),
        message=f"{len(payloads)} photo(s) found",
        success=True,
    )


@router.get(
    "/{job_id}/photos/{photo_id}",
    summary="Get the image data for one photo",
    response_class=Response,
)
async def get_job_photo(
    job_id: str,
    photo_id: str,
    current_user: User = Depends(get_current_user_flexible),
) -> Response:
    """Serve the raw image, so it can be used directly as an `<img>` source."""
    job, _customer, _technician, _booking = await _load_job_or_404(job_id)
    _assert_can_view(current_user, job)

    try:
        raw, content_type, filename = await photo_service.get_photo_data(photo_id)
    except PhotoNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return Response(
        content=raw,
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.delete(
    "/{job_id}/photos/{photo_id}",
    response_model=PhotoResponseEnvelope,
    summary="Delete an inspection photo",
)
async def delete_job_photo(
    job_id: str,
    photo_id: str,
    current_user: User = Depends(get_current_user),
) -> PhotoResponseEnvelope:
    """Delete a photo and unlink it from any finding that referenced it."""
    job, customer, technician, booking = await _load_job_or_404(job_id)
    _assert_can_edit(current_user, job)

    try:
        photo = await photo_service.get_photo(photo_id)
    except PhotoNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    if str(photo.job_id) != str(job.id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This photo does not belong to that job",
        )

    is_uploader = str(photo.uploaded_by) == str(current_user.id)
    if not is_uploader and current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the uploader or an admin can delete this photo",
        )

    payload = photo_service.build_photo_payload(photo)
    await photo_service.delete_photo(photo.id, user_id=current_user.id)

    # Drop the reference from any finding that pointed at it.
    changed = False
    for finding in job.findings:
        if photo_id in finding.photo_ids:
            finding.photo_ids = [pid for pid in finding.photo_ids if pid != photo_id]
            changed = True
    if changed:
        job.touch()
        await job.save()

    return PhotoResponseEnvelope(
        data=PhotoResponse.model_validate(payload),
        message="Photo deleted",
        success=True,
    )
