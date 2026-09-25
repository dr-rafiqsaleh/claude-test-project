"""
Self-check for the audit trail and support access, through the real API.

Three things worth proving, because each is a promise rather than a feature:

  the trail records what happened      changes to users and roles appear
  the trail says when it was altered   editing a stored entry is detected
  support access is the client's       PestBase is locked out until let in, every
                                       visit is time-boxed, and every change
                                       PestBase makes shows up on the client's trail

Runs against a throwaway database, which it creates and drops; your own
database is never touched. From backend/:

    python scripts/check_audit_and_support.py

Prints each step and exits non-zero on the first failure.
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

CHECK_DB = "pestbase_audit_check"
os.environ["DATABASE_NAME"] = CHECK_DB  # before the app reads its settings

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core.tenancy import acting_as  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.audit_event import AuditEvent  # noqa: E402
from app.models.support_grant import SupportGrant  # noqa: E402
from app.models.user import User  # noqa: E402
from scripts._signin import CoreUnreachable, inside, sign_in as _sign_in  # noqa: E402



def ok(message: str) -> None:
    print(f"  ok  {message}")


async def reset() -> None:
    connection = await init_db(database_name=CHECK_DB)
    await connection.drop_database(CHECK_DB)
    await init_db(database_name=CHECK_DB)
    await User(
        email="platform@example.com",
        full_name="Pat Platform",
        role="admin",
        is_platform_staff=True,
        client_id=None,
    ).insert()


async def drop() -> None:
    connection = await init_db(database_name=CHECK_DB)
    await connection.drop_database(CHECK_DB)


async def tamper_with(client_id: str) -> int:
    """Edit a stored entry the way an intruder would, and say which one.

    Goes straight at the collection, not through the app: the point of the
    chain is to catch exactly this.
    """
    from beanie import PydanticObjectId  # noqa: PLC0415

    oid = PydanticObjectId(client_id)
    with acting_as(oid):
        entries = await AuditEvent.find_all().sort("+seq").to_list()
        victim = entries[len(entries) // 2]
        await AuditEvent.get_motor_collection().update_one(
            {"_id": victim.id},
            {"$set": {"actor_name": "Somebody Else", "metadata": {"tampered": True}}},
        )
    return victim.seq


async def expire_grants(client_id: str) -> None:
    """Age every grant into the past, so the expiry path runs without waiting."""
    from beanie import PydanticObjectId  # noqa: PLC0415

    with acting_as(PydanticObjectId(client_id)):
        await SupportGrant.get_motor_collection().update_many(
            {"client_id": PydanticObjectId(client_id)},
            {"$set": {"expires_at": datetime.utcnow() - timedelta(hours=1)}},
        )


def main() -> None:
    asyncio.run(reset())
    try:
        with TestClient(app) as api:
            def sign_in(email: str) -> dict:
                return asyncio.run(_sign_in(api, email))

            platform = sign_in("platform@example.com")

            print("Setting up a client")
            created = api.post("/api/v1/clients", **platform, json={"name": "Acme Pest Control"})
            assert created.status_code == 201, created.text
            client_id = created.json()["data"]["id"]

            # Creating the client opened a short setup window; without it there
            # would be nobody in the client able to let us in to make the first
            # administrator, and the client could never be set up at all.
            admin = api.post(
                "/api/v1/users",
                **inside(platform, client_id),
                json={"email": "ann@acme.test", "full_name": "Ann Acme", "role": "admin"},
            )
            assert admin.status_code == 201, admin.text
            ann = sign_in("ann@acme.test")
            ok("a new client opens a setup window, so its first administrator can be created")

            print("The trail records what happened")
            trail = api.get("/api/v1/audit", **ann).json()["data"]
            kinds = [entry["event_type"] for entry in trail["items"]]
            assert "client.created" in kinds, kinds
            assert "user.created" in kinds, kinds
            assert "support_access.granted" in kinds, kinds
            # The setup window was opened by PestBase, so the client can see that.
            platform_entries = [e for e in trail["items"] if e["actor_is_platform_staff"]]
            assert platform_entries, trail["items"]
            ok(f"{trail['total']} entries, including what PestBase staff did: {sorted(set(kinds))}")

            # A write by PestBase inside the client appears without the route asking.
            before = api.get("/api/v1/audit", **ann).json()["data"]["total"]
            api.post(
                "/api/v1/users",
                **inside(platform, client_id),
                json={"email": "temp@acme.test", "full_name": "Temp Tech", "role": "technician"},
            )
            after = api.get("/api/v1/audit", **ann, params={"platform_only": True}).json()["data"]
            writes = [e for e in after["items"] if e["event_type"] == "platform.client_write"]
            assert writes, after["items"]
            assert "POST" in (writes[0]["resource_name"] or ""), writes[0]
            assert api.get("/api/v1/audit", **ann).json()["data"]["total"] > before
            ok(f"a change PestBase makes is recorded on its own: '{writes[0]['resource_name']}'")

            print("The trail says when it has been altered")
            chain = api.get("/api/v1/audit/verify", **ann).json()["data"]
            assert chain["valid"] is True, chain
            assert chain["total_events"] > 3, chain
            ok(f"the chain checks out across all {chain['total_events']} entries")

            broken_at = asyncio.run(tamper_with(client_id))
            after_tamper = api.get("/api/v1/audit/verify", **ann).json()["data"]
            assert after_tamper["valid"] is False, after_tamper
            assert after_tamper["broken_at_seq"] == broken_at, (after_tamper, broken_at)
            ok(f"editing entry {broken_at} in the database is caught: '{after_tamper['detail']}'")

            print("Support access belongs to the client")
            asyncio.run(expire_grants(client_id))
            locked = api.get("/api/v1/customers", **inside(platform, client_id))
            assert locked.status_code == 403, locked.text
            ok("once the window runs out, PestBase is locked out again without anyone acting")

            state = api.get("/api/v1/support-access", **ann).json()["data"]
            assert state["open"] is False, state
            assert len(state["history"]) >= 1, state
            ok("the client can see it is closed, and every past visit")

            too_long = api.post("/api/v1/support-access", **ann, json={"hours": 999})
            assert too_long.status_code == 422, too_long.text
            opened = api.post("/api/v1/support-access", **ann, json={"hours": 4, "reason": "Numbering"})
            assert opened.status_code == 201, opened.text
            assert opened.json()["data"]["break_glass"] is False
            assert api.get("/api/v1/customers", **inside(platform, client_id)).status_code == 200
            ok("the client opens it for the hours they choose, and longer than the ceiling is refused")

            assert api.delete("/api/v1/support-access", **ann).status_code == 200
            assert api.get("/api/v1/customers", **inside(platform, client_id)).status_code == 403
            ok("and can shut it again at once")

            print("Break-glass")
            no_reason = api.post(
                "/api/v1/support-access/break-glass",
                **platform,
                json={"client_id": client_id, "reason": ""},
            )
            assert no_reason.status_code == 422, no_reason.text
            glass = api.post(
                "/api/v1/support-access/break-glass",
                **platform,
                json={"client_id": client_id, "reason": "Invoice totals corrupted by the import."},
            )
            assert glass.status_code == 201, glass.text
            assert glass.json()["data"]["break_glass"] is True
            assert glass.json()["data"]["hours_left"] <= 24, glass.json()["data"]
            assert api.get("/api/v1/customers", **inside(platform, client_id)).status_code == 200
            ok("PestBase can open a client without being asked, briefly, and only with a reason")

            reasons = [
                entry for entry in api.get("/api/v1/audit", **ann).json()["data"]["items"]
                if entry["event_type"] == "support_access.break_glass"
            ]
            assert reasons, "break-glass did not reach the client's trail"
            assert "corrupted" in str(reasons[0]["metadata"]), reasons[0]
            ok("and the client sees it, and the reason, on their own trail")

            # A client's own admin holds every permission there is, and still
            # cannot reach the platform's client list or another client.
            assert api.get("/api/v1/clients", **ann).status_code == 403
            assert api.post(
                "/api/v1/support-access/break-glass",
                **ann,
                json={"client_id": client_id, "reason": "trying it on"},
            ).status_code == 403
            ok("a client's own Admin cannot open the client list or use break-glass")
    finally:
        asyncio.run(drop())

    print("\nAll audit and support access checks passed.")


if __name__ == "__main__":
    try:
        main()
    except CoreUnreachable as exc:
        print(f"\n{exc}")
        raise SystemExit(2) from exc
