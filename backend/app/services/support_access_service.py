"""Opening and closing a client to QKil staff."""

from datetime import datetime, timedelta
from typing import List, Optional

from beanie import PydanticObjectId

from app.core.tenancy import acting_as
from app.models.support_grant import (
    BREAK_GLASS_HOURS,
    DEFAULT_HOURS,
    MAX_HOURS,
    SupportGrant,
)
from app.models.user import User
from app.services import audit_service


class SupportAccessError(Exception):
    """A grant that can't be made, with the reason in plain English."""


async def active_grant(client_id: PydanticObjectId) -> Optional[SupportGrant]:
    """The grant currently letting QKil staff into this client, if any."""
    now = datetime.utcnow()
    with acting_as(client_id):
        grants = await SupportGrant.find(
            {"revoked_at": None, "expires_at": {"$gt": now}}
        ).sort("-expires_at").to_list()
    return grants[0] if grants else None


async def is_open(client_id: PydanticObjectId) -> bool:
    return await active_grant(client_id) is not None


async def list_grants(client_id: PydanticObjectId, limit: int = 20) -> List[SupportGrant]:
    """This client's recent grants, newest first, including expired ones.

    The expired ones are the point as much as the live one: a client should be
    able to see every period we were let in, not just whether we are in now.
    """
    with acting_as(client_id):
        return await SupportGrant.find_all().sort("-created_at").limit(limit).to_list()


async def grant(
    client_id: PydanticObjectId,
    granted_by: Optional[User] = None,
    hours: int = DEFAULT_HOURS,
    reason: Optional[str] = None,
    break_glass: bool = False,
) -> SupportGrant:
    """Open this client to QKil staff for a set number of hours."""
    ceiling = BREAK_GLASS_HOURS if break_glass else MAX_HOURS
    if hours < 1:
        raise SupportAccessError("Access has to be open for at least an hour")
    if hours > ceiling:
        raise SupportAccessError(f"Access can be open for at most {ceiling} hours at a time")
    if break_glass and not (reason or "").strip():
        raise SupportAccessError("Opening access without being asked needs a reason on the record")

    record = SupportGrant(
        client_id=client_id,
        granted_by=getattr(granted_by, "id", None),
        granted_by_name=getattr(granted_by, "full_name", None),
        granted_by_email=getattr(granted_by, "email", None),
        reason=(reason or "").strip() or None,
        break_glass=break_glass,
        expires_at=datetime.utcnow() + timedelta(hours=hours),
    )
    with acting_as(client_id):
        await record.insert()
        # In the client's own trail, so they can see it whether we opened it or
        # they did. Not suppressible.
        await audit_service.record(
            "support_access.break_glass" if break_glass else "support_access.granted",
            actor=granted_by,
            resource_type="support_grant",
            resource_id=record.id,
            metadata={
                "hours": hours,
                "expires_at": record.expires_at.isoformat(),
                "reason": record.reason,
                "break_glass": break_glass,
            },
        )
    return record


async def revoke(
    client_id: PydanticObjectId,
    revoked_by: Optional[User] = None,
) -> Optional[SupportGrant]:
    """Shut the door now, without waiting for the grant to run out."""
    existing = await active_grant(client_id)
    if existing is None:
        return None

    existing.revoked_at = datetime.utcnow()
    existing.revoked_by = getattr(revoked_by, "id", None)
    with acting_as(client_id):
        await existing.save()
        await audit_service.record(
            "support_access.revoked",
            actor=revoked_by,
            resource_type="support_grant",
            resource_id=existing.id,
            metadata={"was_break_glass": existing.break_glass},
        )
    return existing
