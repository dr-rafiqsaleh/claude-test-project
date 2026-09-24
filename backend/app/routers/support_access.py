"""Letting QKil support into a client's records, and shutting the door again.

Two audiences, two rules. A client opens and closes their own access, which
needs 'QKil support access'. QKil staff can open it themselves only as
break-glass - shorter, reason required, and recorded in the client's own trail
where they will see it.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.dependencies import require_permission, require_platform_staff
from app.models.support_grant import BREAK_GLASS_HOURS, DEFAULT_HOURS, MAX_HOURS
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services import client_service, support_access_service
from app.services.support_access_service import SupportAccessError

router = APIRouter(prefix="/api/v1/support-access", tags=["support access"])


class GrantResponse(BaseModel):
    id: str
    granted_by_name: Optional[str] = None
    granted_by_email: Optional[str] = None
    reason: Optional[str] = None
    break_glass: bool = False
    created_at: datetime
    expires_at: datetime
    revoked_at: Optional[datetime] = None
    active: bool = False
    hours_left: float = 0


class AccessState(BaseModel):
    """Whether QKil can currently work in this client, and the history."""

    open: bool = False
    current: Optional[GrantResponse] = None
    history: List[GrantResponse] = Field(default_factory=list)
    default_hours: int = DEFAULT_HOURS
    max_hours: int = MAX_HOURS
    break_glass_hours: int = BREAK_GLASS_HOURS


class GrantRequest(BaseModel):
    hours: int = Field(DEFAULT_HOURS, ge=1, le=MAX_HOURS)
    reason: Optional[str] = Field(None, max_length=500)


class BreakGlassRequest(BaseModel):
    client_id: str
    hours: int = Field(BREAK_GLASS_HOURS, ge=1, le=BREAK_GLASS_HOURS)
    #: Required: acting without being asked has to say why, on the record.
    reason: str = Field(min_length=3, max_length=500)


class AccessStateResponse(ApiResponse[AccessState]):
    pass


class GrantEnvelope(ApiResponse[GrantResponse]):
    pass


def _response(record) -> GrantResponse:
    return GrantResponse(
        id=str(record.id),
        granted_by_name=record.granted_by_name,
        granted_by_email=record.granted_by_email,
        reason=record.reason,
        break_glass=record.break_glass,
        created_at=record.created_at,
        expires_at=record.expires_at,
        revoked_at=record.revoked_at,
        active=record.is_active(),
        hours_left=record.hours_left,
    )


def _own_client(user: User):
    if user.client_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only a client's own team can open or close their support access",
        )
    return user.client_id


@router.get("", response_model=AccessStateResponse, summary="Is QKil support able to help right now")
@router.get("/", response_model=AccessStateResponse, include_in_schema=False)
async def get_state(
    current_user: User = Depends(require_permission("support.manage")),
) -> AccessStateResponse:
    client_id = _own_client(current_user)
    current = await support_access_service.active_grant(client_id)
    history = await support_access_service.list_grants(client_id)
    return AccessStateResponse(
        data=AccessState(
            open=current is not None,
            current=_response(current) if current else None,
            history=[_response(record) for record in history],
        ),
        message="Support access is open" if current else "Support access is closed",
        success=True,
    )


@router.post(
    "",
    response_model=GrantEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Let QKil support into your records for a while",
)
@router.post("/", response_model=GrantEnvelope, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def open_access(
    payload: GrantRequest,
    current_user: User = Depends(require_permission("support.manage")),
) -> GrantEnvelope:
    client_id = _own_client(current_user)
    try:
        record = await support_access_service.grant(
            client_id, granted_by=current_user, hours=payload.hours, reason=payload.reason
        )
    except SupportAccessError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return GrantEnvelope(
        data=_response(record),
        message=f"QKil support can help until {record.expires_at:%d %b %Y, %H:%M}. It closes on its own.",
        success=True,
    )


@router.delete("", response_model=AccessStateResponse, summary="Close support access now")
@router.delete("/", response_model=AccessStateResponse, include_in_schema=False)
async def close_access(
    current_user: User = Depends(require_permission("support.manage")),
) -> AccessStateResponse:
    client_id = _own_client(current_user)
    await support_access_service.revoke(client_id, revoked_by=current_user)
    history = await support_access_service.list_grants(client_id)
    return AccessStateResponse(
        data=AccessState(open=False, current=None, history=[_response(r) for r in history]),
        message="Support access is closed",
        success=True,
    )


@router.post(
    "/break-glass",
    response_model=GrantEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="QKil opens a client without being asked",
)
async def break_glass(
    payload: BreakGlassRequest,
    current_user: User = Depends(require_platform_staff),
) -> GrantEnvelope:
    """For what consent cannot cover. Short, reasoned, and on the client's record."""
    try:
        client = await client_service.get_client(payload.client_id)
    except client_service.ClientNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    try:
        record = await support_access_service.grant(
            client.id,
            granted_by=current_user,
            hours=payload.hours,
            reason=payload.reason,
            break_glass=True,
        )
    except SupportAccessError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return GrantEnvelope(
        data=_response(record),
        message=(
            f"Break-glass access to {client.name} is open until "
            f"{record.expires_at:%d %b %Y, %H:%M}, and is on their audit trail."
        ),
        success=True,
    )
