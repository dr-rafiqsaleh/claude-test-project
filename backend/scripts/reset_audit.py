"""Clear the audit trail and start a fresh chain.

Only needed once, for trails written before the fingerprint fix in
`audit_service._as_stored`. Those entries were hashed in memory with microsecond
timestamps and re-checked against what MongoDB returns, which is rounded to the
millisecond, so every one of them reports itself as altered. The contents are
fine; the stored hashes were never checkable.

The entries are deleted rather than re-hashed. A command that recomputes stored
hashes would make any real tampering verify clean too, which is the one thing an
audit trail exists to prevent. What replaces them is a single honest entry saying
the trail was reset and how many entries went.

Report what would happen (changes nothing):

    docker compose -p pestbase-local exec backend python scripts/reset_audit.py

Then do it:

    docker compose -p pestbase-local exec backend python scripts/reset_audit.py --yes

Add --client <slug or id> to reset one client rather than all of them.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.tenancy import acting_as, unscoped  # noqa: E402
from app.database import close_db, init_db  # noqa: E402
from app.models.audit_event import AuditEvent  # noqa: E402
from app.models.client import Client  # noqa: E402
from app.services import audit_service  # noqa: E402


async def trails() -> list:
    """Every client id that has audit entries, with its name and count.

    Deliberately unscoped and straight to the driver: this is a cross-client
    operator task, and the point is to find trails belonging to clients that may
    no longer exist.
    """
    collection = AuditEvent.get_motor_collection()
    with unscoped():
        client_ids = await collection.distinct("client_id")
        names = {
            client.id: client.name
            for client in await Client.find_all().to_list()
        }
        out = []
        for client_id in client_ids:
            count = await collection.count_documents({"client_id": client_id})
            out.append((client_id, names.get(client_id, "(no such client)"), count))
    return sorted(out, key=lambda row: row[1])


async def run(only: str, apply: bool) -> int:
    await init_db()
    try:
        rows = await trails()
        if only:
            with unscoped():
                wanted = await Client.find_one({"slug": only}) or await Client.find_one(
                    {"name": only}
                )
            wanted_id = wanted.id if wanted else None
            if wanted_id is None:
                # Allow a raw id too, for a trail whose client is gone.
                rows = [row for row in rows if str(row[0]) == only]
            else:
                rows = [row for row in rows if row[0] == wanted_id]
            if not rows:
                print(f"No audit trail found for '{only}'.")
                return 2

        if not rows:
            print("No audit entries anywhere. Nothing to reset.")
            return 0

        total = 0
        for client_id, name, count in rows:
            with acting_as(client_id):
                before = await audit_service.verify_chain()
            state = "valid" if before["valid"] else before["detail"]
            print(f"{name} [{client_id}]: {count} entries - {state}")
            total += count

        if not apply:
            print(f"\n{total} entries across {len(rows)} trail(s) would be deleted.")
            print("Nothing has changed. Re-run with --yes to reset.")
            return 0

        print()
        for client_id, name, count in rows:
            with acting_as(client_id):
                await AuditEvent.find_all().delete()
                await audit_service.record(
                    "audit.reset",
                    resource_type="audit_trail",
                    resource_name=name,
                    metadata={
                        "removed": count,
                        "reason": "fingerprints predate the audit hashing fix",
                    },
                )
                after = await audit_service.verify_chain()
            ok = "verifies" if after["valid"] else f"STILL BROKEN: {after['detail']}"
            print(f"{name}: removed {count}, new chain {ok}")

        print(f"\nReset {len(rows)} trail(s). {total} unverifiable entries removed.")
        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", default="", help="Slug, name or id of one client")
    parser.add_argument("--yes", action="store_true", help="Actually delete the entries")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.client, args.yes)))
