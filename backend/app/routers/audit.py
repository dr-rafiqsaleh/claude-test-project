"""The audit trail. Needs 'Audit trail'."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.config import settings
from app.core.dependencies import require_permission
from app.schemas.common import ApiResponse
from app.services import audit_service

router = APIRouter(
    prefix="/api/v1/audit",
    tags=["audit"],
    dependencies=[Depends(require_permission("audit.view"))],
)


class AuditEventResponse(BaseModel):
    id: str
    seq: int
    event_type: str
    actor_name: Optional[str] = None
    actor_email: Optional[str] = None
    actor_role: Optional[str] = None
    actor_is_platform_staff: bool = False
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    ip_address: Optional[str] = None
    created_at: datetime


class AuditListData(BaseModel):
    items: List[AuditEventResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    event_types: List[str] = Field(default_factory=list)


class ChainStatus(BaseModel):
    """Whether the trail still hashes to what it stored."""

    valid: bool
    total_events: int
    last_seq: int
    broken_at_seq: Optional[int] = None
    detail: str = ""


class AuditListResponse(ApiResponse[AuditListData]):
    pass


class ChainStatusResponse(ApiResponse[ChainStatus]):
    pass


def _response(event) -> AuditEventResponse:
    return AuditEventResponse(
        id=str(event.id),
        seq=event.seq,
        event_type=event.event_type,
        actor_name=event.actor_name,
        actor_email=event.actor_email,
        actor_role=event.actor_role,
        actor_is_platform_staff=event.actor_is_platform_staff,
        resource_type=event.resource_type,
        resource_id=event.resource_id,
        resource_name=event.resource_name,
        metadata=event.metadata,
        ip_address=event.ip_address,
        created_at=event.created_at,
    )


@router.get("", response_model=AuditListResponse, summary="The audit trail, newest first")
@router.get("/", response_model=AuditListResponse, include_in_schema=False)
async def list_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=settings.MAX_PAGE_SIZE),
    event_type: Optional[str] = Query(None, description="Only this kind of event"),
    actor_id: Optional[str] = Query(None, description="Only this person's actions"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    platform_only: bool = Query(False, description="Only what QKil staff changed"),
) -> AuditListResponse:
    events, total = await audit_service.list_events(
        page=page,
        page_size=page_size,
        event_type=event_type,
        actor_id=actor_id,
        date_from=date_from,
        date_to=date_to,
        platform_only=platform_only,
    )
    return AuditListResponse(
        data=AuditListData(
            items=[_response(event) for event in events],
            total=total,
            page=page,
            page_size=page_size,
            event_types=await audit_service.event_types(),
        ),
        message=f"{total} entr{'y' if total == 1 else 'ies'}",
        success=True,
    )


@router.get(
    "/verify",
    response_model=ChainStatusResponse,
    summary="Check the trail has not been altered",
)
async def verify_chain() -> ChainStatusResponse:
    """Re-hash every entry and report the first that does not add up."""
    status_ = await audit_service.verify_chain()
    return ChainStatusResponse(
        data=ChainStatus(**status_),
        message=status_["detail"],
        success=True,
    )
