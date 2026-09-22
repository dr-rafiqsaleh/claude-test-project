"""Booking routes.

All routes require authentication.

* Admin and office staff manage the full schedule.
* Technicians see only the bookings assigned to them, and the only status
  change they may make is finishing a job they have already started
  (``in_progress`` -> ``completed``).
* Only admins may delete a booking.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import settings
from app.core.dependencies import get_current_user, require_admin, require_staff
from app.models.booking import Booking, BookingStatus
from app.models.user import User, UserRole
from app.schemas.booking import (
    BookingCreate,
    BookingListData,
    BookingListResponse,
    BookingResponse,
    BookingResponseEnvelope,
    BookingStatusUpdate,
    BookingUpdate,
    CalendarEvent,
    CalendarEventsResponse,
    QuoteToBookingRequest,
    TechnicianAvailability,
    TechnicianAvailabilityResponse,
)
from app.schemas.user import UserListData, UserListResponse, UserResponse
from app.services import assignment_service, booking_service, recurrence_service
from app.services.booking_service import (
    BookingNotFoundError,
    BookingStateError,
    CustomerNotFoundError,
    QuoteNotConvertibleError,
    QuoteNotFoundError,
    TechnicianNotFoundError,
    build_booking_payload,
)


router = APIRouter(prefix="/api/v1/bookings", tags=["bookings"])


def _is_technician(user: User) -> bool:
    return user.role == UserRole.TECHNICIAN


def _redact_for(user: User, payload: dict) -> dict:
    """Hide office-only notes from technicians."""
    if _is_technician(user):
        payload = dict(payload)
        payload["internal_notes"] = None
    return payload


async def _full_payload(booking, customer, technician, quote, notices=None) -> dict:
    """A booking with its series details and any notices from the save."""
    payload = build_booking_payload(booking, customer, technician, quote)
    payload.update(await recurrence_service.series_info(booking))
    payload["notices"] = [notice for notice in (notices or []) if notice]
    return payload


def _assert_can_view(user: User, payload: dict) -> None:
    """Technicians may only open bookings assigned to them."""
    if _is_technician(user) and payload.get("technician_id") != str(user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view bookings assigned to you",
        )


# ---------------------------------------------------------------------------
# Collection routes
# ---------------------------------------------------------------------------


@router.get("", response_model=BookingListResponse, summary="List bookings")
@router.get("/", response_model=BookingListResponse, include_in_schema=False)
async def list_bookings(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    booking_status: Optional[BookingStatus] = Query(None, alias="status", description="Filter by status"),
    technician_id: Optional[str] = Query(None, description="Filter by assigned technician"),
    customer_id: Optional[str] = Query(None, description="Filter by customer"),
    date_from: Optional[datetime] = Query(None, description="Only bookings starting on or after this date"),
    date_to: Optional[datetime] = Query(None, description="Only bookings starting on or before this date"),
    q: Optional[str] = Query(None, description="Search booking number, service type or customer name"),
    no_job: Optional[bool] = Query(
        None,
        description="True returns only bookings that have not been turned into a job yet",
    ),
    current_user: User = Depends(get_current_user),
) -> BookingListResponse:
    """Return a paginated, filterable list of bookings."""
    # Technicians are locked to their own schedule.
    if _is_technician(current_user):
        technician_id = str(current_user.id)

    payloads, total = await booking_service.list_bookings(
        page=page,
        page_size=page_size,
        status=booking_status,
        technician_id=technician_id,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
        q=q,
        no_job=no_job,
    )

    items = [BookingResponse.model_validate(_redact_for(current_user, p)) for p in payloads]

    return BookingListResponse(
        data=BookingListData(items=items, total=total, page=page, page_size=page_size),
        message=f"{total} booking(s) found",
        success=True,
    )


@router.post(
    "",
    response_model=BookingResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Create a booking",
)
@router.post(
    "/",
    response_model=BookingResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_booking(
    payload: BookingCreate,
    current_user: User = Depends(require_staff),
) -> BookingResponseEnvelope:
    """Create a booking with an auto-generated booking number.

    A repeating job books its later visits too, and a technician given the
    job is told about it.
    """
    notices: list = []
    try:
        booking, customer, technician, quote = await booking_service.create_booking(
            payload,
            created_by=current_user.id,
            notices=notices,
        )
    except (CustomerNotFoundError, TechnicianNotFoundError, QuoteNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    notices.append(await assignment_service.notify_if_assigned(booking, technician, customer, None))
    return BookingResponseEnvelope(
        data=BookingResponse.model_validate(
            await _full_payload(booking, customer, technician, quote, notices)
        ),
        message=f"Booking {booking.booking_number} created successfully",
        success=True,
    )


@router.post(
    "/from-quote/{quote_id}",
    response_model=BookingResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Convert an accepted quote into a booking",
)
async def create_booking_from_quote(
    quote_id: str,
    payload: QuoteToBookingRequest,
    current_user: User = Depends(require_staff),
) -> BookingResponseEnvelope:
    """Create a booking from an accepted quote and mark the quote as converted."""
    notices: list = []
    try:
        booking, customer, technician, quote = await booking_service.create_booking_from_quote(
            quote_id,
            payload,
            created_by=current_user.id,
            notices=notices,
        )
    except (QuoteNotFoundError, CustomerNotFoundError, TechnicianNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except QuoteNotConvertibleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    notices.append(await assignment_service.notify_if_assigned(booking, technician, customer, None))
    return BookingResponseEnvelope(
        data=BookingResponse.model_validate(
            await _full_payload(booking, customer, technician, quote, notices)
        ),
        message=(
            f"Quote {quote.quote_number} converted to booking {booking.booking_number}"
            if quote
            else f"Booking {booking.booking_number} created successfully"
        ),
        success=True,
    )


# ---------------------------------------------------------------------------
# Static sub-routes (must be declared before "/{booking_id}")
# ---------------------------------------------------------------------------


@router.get("/calendar", response_model=CalendarEventsResponse, summary="Calendar events")
async def get_calendar(
    date_from: Optional[datetime] = Query(None, description="Range start (inclusive)"),
    date_to: Optional[datetime] = Query(None, description="Range end (inclusive)"),
    technician_id: Optional[str] = Query(None, description="Filter by assigned technician"),
    current_user: User = Depends(get_current_user),
) -> CalendarEventsResponse:
    """Return bookings in a date range formatted for FullCalendar."""
    if _is_technician(current_user):
        technician_id = str(current_user.id)

    events = await booking_service.get_calendar_events(
        date_from=date_from,
        date_to=date_to,
        technician_id=technician_id,
    )

    return CalendarEventsResponse(
        data=[CalendarEvent.model_validate(event) for event in events],
        message=f"{len(events)} event(s) found",
        success=True,
    )


@router.get(
    "/technicians",
    response_model=UserListResponse,
    summary="List technicians available for assignment",
)
async def list_assignable_technicians(
    _current_user: User = Depends(require_staff),
) -> UserListResponse:
    """Return the active technicians, so office staff can assign a booking."""
    technicians = await booking_service.list_technicians()

    return UserListResponse(
        data=UserListData(
            items=[UserResponse.model_validate(t) for t in technicians],
            total=len(technicians),
            page=1,
            page_size=len(technicians) or 1,
        ),
        message=f"{len(technicians)} technician(s) found",
        success=True,
    )


@router.get(
    "/availability/{technician_id}",
    response_model=TechnicianAvailabilityResponse,
    summary="Booked slots for a technician on a given day",
)
async def get_technician_availability(
    technician_id: str,
    day: datetime = Query(..., alias="date", description="The day to inspect"),
    _current_user: User = Depends(get_current_user),
) -> TechnicianAvailabilityResponse:
    """Return the time slots a technician already has committed on `date`."""
    try:
        availability = await booking_service.get_technician_availability(technician_id, day)
    except TechnicianNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return TechnicianAvailabilityResponse(
        data=TechnicianAvailability.model_validate(availability),
        message=f"{len(availability['booked_slots'])} booked slot(s)",
        success=True,
    )


# ---------------------------------------------------------------------------
# Item routes
# ---------------------------------------------------------------------------


@router.get("/{booking_id}", response_model=BookingResponseEnvelope, summary="Get a booking by id")
async def get_booking(
    booking_id: str,
    current_user: User = Depends(get_current_user),
) -> BookingResponseEnvelope:
    """Fetch a single booking."""
    try:
        booking, customer, technician, quote = await booking_service.get_booking(booking_id)
    except BookingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    payload = await _full_payload(booking, customer, technician, quote)
    _assert_can_view(current_user, payload)

    return BookingResponseEnvelope(
        data=BookingResponse.model_validate(_redact_for(current_user, payload)),
        message="Booking retrieved",
        success=True,
    )


@router.put("/{booking_id}", response_model=BookingResponseEnvelope, summary="Update a booking")
async def update_booking(
    booking_id: str,
    payload: BookingUpdate,
    _current_user: User = Depends(require_staff),
) -> BookingResponseEnvelope:
    """Update a booking. Only scheduled or confirmed bookings can be edited."""
    try:
        before = await Booking.get(booking_id)
    except Exception:  # noqa: BLE001 - not an id; the update below reports it
        before = None
    previous_technician = before.technician_id if before else None
    notices: list = []
    try:
        booking, customer, technician, quote = await booking_service.update_booking(
            booking_id,
            payload,
            notices=notices,
        )
    except BookingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (CustomerNotFoundError, TechnicianNotFoundError, QuoteNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BookingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    notices.append(
        await assignment_service.notify_if_assigned(booking, technician, customer, previous_technician)
    )
    return BookingResponseEnvelope(
        data=BookingResponse.model_validate(
            await _full_payload(booking, customer, technician, quote, notices)
        ),
        message="Booking updated successfully",
        success=True,
    )


@router.patch(
    "/{booking_id}/status",
    response_model=BookingResponseEnvelope,
    summary="Update booking status",
)
async def update_booking_status(
    booking_id: str,
    payload: BookingStatusUpdate,
    current_user: User = Depends(get_current_user),
) -> BookingResponseEnvelope:
    """Move a booking through its lifecycle."""
    try:
        existing, _customer, _technician, _quote = await booking_service.get_booking(booking_id)
    except BookingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    if _is_technician(current_user):
        # A technician runs their own visits end to end: start on arrival,
        # complete once the report is filed.
        assigned = existing.technician_id is not None and str(existing.technician_id) == str(current_user.id)
        starting = (
            existing.status in (BookingStatus.SCHEDULED, BookingStatus.CONFIRMED)
            and payload.status == BookingStatus.IN_PROGRESS
        )
        finishing = (
            existing.status == BookingStatus.IN_PROGRESS
            and payload.status == BookingStatus.COMPLETED
        )
        if not assigned or not (starting or finishing):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Technicians can only start and complete visits assigned to them",
            )
    elif current_user.role not in (UserRole.ADMIN, UserRole.OFFICE_STAFF):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )

    try:
        booking, customer, technician, quote = await booking_service.update_status(
            booking_id,
            payload.status,
            reason=payload.reason,
            user_id=current_user.id,
        )
    except BookingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BookingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    payload_out = build_booking_payload(booking, customer, technician, quote)

    return BookingResponseEnvelope(
        data=BookingResponse.model_validate(_redact_for(current_user, payload_out)),
        message=f"Booking marked as {booking.status.value.replace('_', ' ')}",
        success=True,
    )


@router.post(
    "/{booking_id}/stop-repeating",
    response_model=BookingResponseEnvelope,
    summary="Stop a repeating job after this visit",
)
async def stop_repeating(
    booking_id: str,
    _current_user: User = Depends(require_staff),
) -> BookingResponseEnvelope:
    """Remove the later visits still waiting to be confirmed; keep confirmed ones."""
    try:
        booking, removed, kept = await booking_service.stop_repeating(booking_id)
        booking, customer, technician, quote = await booking_service.get_booking(booking.id)
    except BookingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    notice = f"No more visits after this one. {removed} unconfirmed visit(s) removed."
    if kept:
        notice += f" {kept} later visit(s) already confirmed with the customer were kept: cancel them if needed."
    return BookingResponseEnvelope(
        data=BookingResponse.model_validate(
            await _full_payload(booking, customer, technician, quote, [notice])
        ),
        message=notice,
        success=True,
    )


@router.delete("/{booking_id}", response_model=BookingResponseEnvelope, summary="Delete a booking")
async def delete_booking(
    booking_id: str,
    _current_user: User = Depends(require_admin),
) -> BookingResponseEnvelope:
    """Permanently delete a scheduled or cancelled booking."""
    try:
        booking = await booking_service.delete_booking(booking_id)
    except BookingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BookingStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return BookingResponseEnvelope(
        data=BookingResponse.model_validate(build_booking_payload(booking)),
        message=f"Booking {booking.booking_number} deleted",
        success=True,
    )
