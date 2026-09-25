"""A limit on how often one email address can be sent a sign-in code.

Sign-in is passwordless: asking to sign in makes PestBase send an email. Without a
limit, anyone who knows a colleague's address can have us mail them a code every
second - which is both a way to bury a real code among decoys and a good way to
get the company's sending domain blocked.

A collection with a TTL index rather than a counter in memory: uvicorn runs
several workers and restarts on deploy, and a per-process dict would reset on
both. Mongo expires the rows itself, so nothing has to be cleaned up.
"""

from datetime import datetime, timedelta
from typing import Optional

from beanie import Document
from pydantic import Field
from pymongo import IndexModel


class LoginAttempt(Document):
    """One request for a sign-in code.

    Not a TenantDocument: at this point we do not know which client the address
    belongs to, or whether it belongs to one at all.
    """

    email: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "login_attempts"
        indexes = [
            IndexModel([("email", 1), ("created_at", -1)], name="idx_attempt_window"),
            # Mongo deletes these itself an hour after they are written. The
            # window is much shorter than that; the margin just means a change
            # to the window needs no change to the index.
            IndexModel([("created_at", 1)], name="ttl_attempt", expireAfterSeconds=3600),
        ]


async def allow(email: str, max_attempts: int, window_seconds: int) -> bool:
    """Whether to send a code to this address, recording the attempt if so.

    Counts first and records second, so the request that reaches the limit is
    refused rather than being the one that sets it.
    """
    address = (email or "").strip().lower()
    if not address:
        return False

    since = datetime.utcnow() - timedelta(seconds=window_seconds)
    recent = await LoginAttempt.find(
        {"email": address, "created_at": {"$gte": since}}
    ).count()
    if recent >= max_attempts:
        return False

    await LoginAttempt(email=address).insert()
    return True


async def forget(email: Optional[str]) -> None:
    """Clear an address's attempts, after a sign-in that worked."""
    address = (email or "").strip().lower()
    if address:
        await LoginAttempt.find({"email": address}).delete()
