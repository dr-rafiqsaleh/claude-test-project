"""The audit trail: what was done, by whom, and proof it has not been edited.

Each entry hashes its own contents together with the previous entry's hash, so
the entries form a chain. Changing an old entry, or lifting one out, changes a
hash that the next entry has already committed to, and `verify_chain` reports
where. That is what "tamper-evident" means here: not that nobody can edit the
collection, but that nobody can edit it without it showing.

`record` never raises. An audit write must not be able to fail the action it is
describing - a failed save leaves a warning in the logs and the action stands.
The alternative, a customer unable to book a job because the audit collection
is full, is worse than a gap in the trail.
"""

import hashlib
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from beanie import PydanticObjectId
from pymongo.errors import DuplicateKeyError

from app.core.tenancy import current_client_id
from app.models.audit_event import AuditEvent
from app.models.user import User

logger = logging.getLogger(__name__)

#: The fields the hash is taken over. Listed rather than "everything except
#: hash", so a field added later cannot silently change what a stored hash was
#: computed over and make every existing entry look tampered with.
HASHED_FIELDS = (
    "client_id",
    "seq",
    "prev_hash",
    "event_type",
    "actor_id",
    "actor_name",
    "actor_email",
    "actor_role",
    "actor_is_platform_staff",
    "resource_type",
    "resource_id",
    "resource_name",
    "metadata",
    "ip_address",
    "user_agent",
    "created_at",
)

#: How many times to retry when another request took the same seq.
SEQ_ATTEMPTS = 5


def _as_stored(value: Any) -> Any:
    """A value as MongoDB will hand it back, not as Python happens to hold it.

    The fingerprint is taken once before the insert and again after re-reading,
    so anything the database rounds has to be rounded here or the two disagree.
    BSON dates keep milliseconds; `datetime.utcnow()` keeps microseconds. That
    one difference made every entry ever written report itself as altered - the
    hash was over ...127160 and the re-read was over ...127000.

    Applied recursively, so a caller putting a datetime in `metadata` does not
    quietly reintroduce the same false alarm.
    """
    if isinstance(value, datetime):
        return value.replace(microsecond=(value.microsecond // 1000) * 1000)
    if isinstance(value, dict):
        return {key: _as_stored(inner) for key, inner in value.items()}
    if isinstance(value, (list, tuple)):
        return [_as_stored(inner) for inner in value]
    return value


def _fingerprint(event: AuditEvent) -> str:
    """A deterministic SHA-256 over the entry's contents."""
    payload = {field: _as_stored(getattr(event, field)) for field in HASHED_FIELDS}
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


async def _last_entry(client_id: PydanticObjectId) -> Optional[AuditEvent]:
    return await AuditEvent.find({"client_id": client_id}).sort("-seq").first_or_none()


async def record(
    event_type: str,
    actor: Optional[User] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[Any] = None,
    resource_name: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[AuditEvent]:
    """Add an entry to the current client's trail. Never raises.

    The client comes from the request's scope, so a caller cannot record against
    the wrong client by passing the wrong id. Returns None when there was no
    client in scope, or when the write failed.
    """
    try:
        client_id = current_client_id()
        if client_id is None:
            # Nothing to attach it to. A cross-client action is recorded by
            # whatever chose the client, not here.
            return None

        event = AuditEvent(
            client_id=client_id,
            event_type=event_type,
            actor_id=getattr(actor, "id", None),
            actor_name=getattr(actor, "full_name", None),
            actor_email=getattr(actor, "email", None),
            actor_role=str(getattr(actor, "role", "") or "") or None,
            actor_is_platform_staff=bool(getattr(actor, "is_platform_staff", False)),
            resource_type=resource_type,
            resource_id=None if resource_id is None else str(resource_id),
            resource_name=resource_name,
            metadata=metadata or {},
            ip_address=ip_address,
            user_agent=user_agent,
            created_at=datetime.utcnow(),
        )

        # Two requests can reach for the same seq. The unique index refuses the
        # loser, which then re-reads the tail and tries again - so the chain
        # stays a chain under concurrency instead of forking.
        for attempt in range(SEQ_ATTEMPTS):
            previous = await _last_entry(client_id)
            event.seq = (previous.seq + 1) if previous else 1
            event.prev_hash = previous.hash if previous else None
            event.hash = _fingerprint(event)
            try:
                await event.insert()
                return event
            except DuplicateKeyError:
                if attempt == SEQ_ATTEMPTS - 1:
                    raise
        return None
    except Exception as exc:  # noqa: BLE001 - never fail the action being recorded
        logger.warning("Could not record the audit entry %s: %s", event_type, exc)
        return None


async def list_events(
    page: int = 1,
    page_size: int = 50,
    event_type: Optional[str] = None,
    actor_id: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    platform_only: bool = False,
) -> Tuple[List[AuditEvent], int]:
    """A page of the current client's trail, newest first."""
    criteria: dict = {}
    if event_type:
        criteria["event_type"] = event_type
    if actor_id:
        try:
            criteria["actor_id"] = PydanticObjectId(actor_id)
        except Exception:  # noqa: BLE001 - an unparseable id matches nothing
            return [], 0
    if platform_only:
        criteria["actor_is_platform_staff"] = True
    window: dict = {}
    if date_from is not None:
        window["$gte"] = date_from
    if date_to is not None:
        window["$lte"] = date_to
    if window:
        criteria["created_at"] = window

    query = AuditEvent.find(criteria) if criteria else AuditEvent.find_all()
    total = await query.count()
    skip = max(page - 1, 0) * page_size
    events = await query.sort("-seq").skip(skip).limit(page_size).to_list()
    return events, total


async def event_types() -> List[str]:
    """Every event type this client has, for the filter."""
    return sorted({event.event_type for event in await AuditEvent.find_all().to_list()})


async def verify_chain() -> dict:
    """Re-hash the current client's chain and report the first break.

    Walks in `seq` order checking three things at each step: the sequence has no
    gap, the entry still hashes to what it stored, and it points at the previous
    entry's hash. Any one of those failing means the collection has been changed
    outside the app.
    """
    events = await AuditEvent.find_all().sort("+seq").to_list()

    previous_hash: Optional[str] = None
    expected_seq = 1

    for event in events:
        if event.seq != expected_seq:
            return _broken(events, event, f"expected entry {expected_seq}, found {event.seq}")
        if event.prev_hash != previous_hash:
            return _broken(events, event, "does not follow on from the entry before it")
        if _fingerprint(event) != event.hash:
            return _broken(events, event, "contents no longer match its own fingerprint")
        previous_hash = event.hash
        expected_seq += 1

    return {
        "valid": True,
        "total_events": len(events),
        "last_seq": events[-1].seq if events else 0,
        "broken_at_seq": None,
        "detail": "Every entry follows on from the one before it.",
    }


def _broken(events: list, event: AuditEvent, detail: str) -> dict:
    return {
        "valid": False,
        "total_events": len(events),
        "last_seq": events[-1].seq if events else 0,
        "broken_at_seq": event.seq,
        "detail": f"Entry {event.seq} ({event.event_type}) {detail}.",
    }
