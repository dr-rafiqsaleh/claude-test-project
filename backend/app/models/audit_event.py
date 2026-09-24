"""One entry in a client's audit trail.

Each entry carries the hash of the one before it, so altering or removing an
entry after the fact breaks the chain and `verify_chain` can say exactly where.
Nothing in the app edits or deletes these.

`seq` is per client and unique with it, which is what makes a silently removed
entry detectable: the gap is visible, and two writers cannot both claim the
same position.
"""

from datetime import datetime
from typing import Any, Dict, Optional

from beanie import PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

from app.models.tenant import TenantDocument


class AuditEvent(TenantDocument):
    """A recorded action, belonging to the client it happened to."""

    #: Where this entry sits in its client's chain, from 1.
    seq: int = 0
    prev_hash: Optional[str] = None
    hash: Optional[str] = None

    #: e.g. "user.created", "role.updated", "platform.client_write"
    event_type: str

    # Who did it. Copied in rather than joined, so the record still reads
    # correctly after the account is renamed or deleted.
    actor_id: Optional[PydanticObjectId] = None
    actor_name: Optional[str] = None
    actor_email: Optional[str] = None
    actor_role: Optional[str] = None
    #: True when the actor was QKil staff rather than someone at the client.
    actor_is_platform_staff: bool = False

    # What it was done to.
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None

    metadata: Dict[str, Any] = Field(default_factory=dict)
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "audit_events"
        indexes = [
            IndexModel([("client_id", 1), ("seq", 1)], unique=True, name="uniq_audit_seq"),
            IndexModel([("client_id", 1), ("created_at", -1)], name="idx_audit_recent"),
            IndexModel([("client_id", 1), ("event_type", 1)], name="idx_audit_event_type"),
        ]

    def __str__(self) -> str:
        return f"#{self.seq} {self.event_type}"
