"""Permission for PestBase staff to work inside one client, for a while.

A client's records are their own customers' details. PestBase staff can reach every
client because supporting them requires it, but reaching and reading are not the
same thing, so the door is shut by default and the client opens it.

Time-boxed rather than a switch. A switch gets flipped once during a support
call and never flipped back; a year later it is on everywhere and the control
has quietly become the thing it replaced. A grant that runs out on its own
returns to the safe state without anyone having to remember.

Break-glass is the same mechanism with a different author, for the cases consent
cannot cover - data broken by a bug, a legal hold, an account being abused -
because a rule with no exception grows an undocumented back door instead. It is
shorter, and it is recorded plainly enough that using it routinely would be
obvious to the client.
"""

from datetime import datetime, timedelta
from typing import Optional

from beanie import PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

from app.models.tenant import TenantDocument

#: How long a grant lasts when the client does not say.
DEFAULT_HOURS = 72
#: A ceiling, so "leave it open while you look into it" cannot mean forever.
MAX_HOURS = 24 * 14
#: Shorter on purpose: acting without being asked should be brief.
BREAK_GLASS_HOURS = 24


class SupportGrant(TenantDocument):
    """One period during which PestBase staff may work inside this client."""

    #: Who opened it. For a client grant, someone at the client; for
    #: break-glass, the PestBase account that opened it without being asked.
    granted_by: Optional[PydanticObjectId] = None
    granted_by_name: Optional[str] = None
    granted_by_email: Optional[str] = None
    #: Why, in the client's or the operator's own words.
    reason: Optional[str] = None
    #: True when PestBase opened this itself rather than being asked.
    break_glass: bool = False

    expires_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)
    revoked_at: Optional[datetime] = None
    revoked_by: Optional[PydanticObjectId] = None

    class Settings:
        name = "support_grants"
        indexes = [
            IndexModel([("client_id", 1), ("expires_at", -1)], name="idx_grant_window"),
        ]

    def is_active(self, at: Optional[datetime] = None) -> bool:
        moment = at or datetime.utcnow()
        return self.revoked_at is None and self.expires_at > moment

    @property
    def hours_left(self) -> float:
        remaining = (self.expires_at - datetime.utcnow()) / timedelta(hours=1)
        return max(0.0, round(remaining, 1))

    def __str__(self) -> str:
        kind = "break-glass" if self.break_glass else "grant"
        return f"{kind} until {self.expires_at:%Y-%m-%d %H:%M}"
