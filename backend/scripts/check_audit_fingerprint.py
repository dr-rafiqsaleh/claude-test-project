"""Prove an audit entry still hashes to the same value after a trip through BSON.

The bug this exists for: the fingerprint was taken in memory before the insert
and re-taken after re-reading the entry, and the two sides disagreed. BSON dates
keep milliseconds while `datetime.utcnow()` keeps microseconds, so every entry in
every trail reported "contents no longer match its own fingerprint" - an audit
trail that cried tampering about itself, forever.

It is checked with the real BSON codec, which is what the driver uses, so no
database and no mock are involved. A mock that stores Python objects as they are
cannot catch this: it is the encoding that loses the precision.

    python scripts/check_audit_fingerprint.py
"""

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from beanie import PydanticObjectId  # noqa: E402
from bson import BSON  # noqa: E402

from app.models.audit_event import AuditEvent  # noqa: E402
from app.services.audit_service import HASHED_FIELDS, _fingerprint  # noqa: E402


def sample() -> AuditEvent:
    """An entry whose every hashed field is awkward on purpose.

    `model_construct`, not the constructor: Beanie's `__init__` reaches for the
    collection and raises without a database behind it, and this check exists
    precisely so it needs no database. Nothing here is validated or saved.
    """
    return AuditEvent.model_construct(
        client_id=PydanticObjectId(),
        seq=1,
        prev_hash=None,
        hash=None,
        event_type="client.created",
        actor_id=PydanticObjectId(),
        actor_name="Ada Lovelace",
        actor_email="ada@example.com",
        actor_role="admin",
        actor_is_platform_staff=True,
        resource_type="client",
        resource_id=str(PydanticObjectId()),
        resource_name="Acme Pest Control",
        # 999 microseconds is the worst case: it survives nowhere but memory.
        created_at=datetime(2026, 9, 25, 10, 15, 41, 127999),
        metadata={
            "hours": 72,
            "nested": {"when": datetime(2026, 9, 25, 10, 15, 41, 999999)},
            "list": [datetime(2026, 9, 25, 10, 15, 41, 500001), "text"],
        },
        ip_address="203.0.113.7",
        user_agent="Mozilla/5.0",
    )


def after_bson(event: AuditEvent) -> AuditEvent:
    """The same entry as the database would give it back."""
    stored = BSON.encode({field: getattr(event, field) for field in HASHED_FIELDS}).decode()
    reread = event.model_copy(deep=True)
    for field, value in stored.items():
        setattr(reread, field, value)
    return reread


def main() -> int:
    event = sample()
    event.hash = _fingerprint(event)

    reread = after_bson(event)
    recomputed = _fingerprint(reread)

    if event.created_at == reread.created_at:
        print("inconclusive: BSON did not round the timestamp, so nothing was proved")
        return 2

    print(f"ok  BSON rounds {event.created_at} to {reread.created_at}")

    if recomputed != event.hash:
        print("FAIL  the entry does not hash to the same value once re-read.")
        print(f"      stored     {event.hash}")
        print(f"      recomputed {recomputed}")
        print("      verify_chain will report every entry as altered.")
        print("      The fingerprint must be taken over the stored form; see _as_stored.")
        return 1

    print("ok  the fingerprint survives the round trip, so verify_chain can trust it")
    print(f"ok  {len(HASHED_FIELDS)} hashed field(s) checked, nested datetimes included")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
