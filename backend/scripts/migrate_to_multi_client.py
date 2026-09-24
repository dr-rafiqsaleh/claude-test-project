"""Move an existing single-company QKil database onto multiple clients.

Everything already in the database belongs to the one company using it, so this
creates a client for them and stamps its id on every record that has none. Safe
to run twice: a record that already has a client is left alone.

    python scripts/migrate_to_multi_client.py --name "Acme Pest Control"
    python scripts/migrate_to_multi_client.py --platform-admin you@example.com

`--platform-admin` additionally turns one existing account into QKil platform
staff: it leaves their client, so they can see every client and manage the
client list. Do this for your own account, not a customer's.

Nothing is deleted and no record is moved between clients.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.tenancy import acting_as, unscoped  # noqa: E402
from app.database import DOCUMENT_MODELS, close_db, init_db  # noqa: E402
from app.models.client import Client  # noqa: E402
from app.models.company_settings import CompanySettings  # noqa: E402
from app.models.tenant import TenantDocument  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import client_service  # noqa: E402

#: Every collection that belongs to a client, straight off the model list, so a
#: model added later is covered without editing this script.
TENANT_MODELS = [model for model in DOCUMENT_MODELS if issubclass(model, TenantDocument)]


async def default_name(given: str | None) -> str:
    """The client's name: what was asked for, or the company already configured."""
    if given and given.strip():
        return given.strip()
    settings = await CompanySettings.find_one({})
    configured = getattr(settings, "company_name", None) if settings else None
    return (configured or "").strip() or "My Company"


async def pick_client(name: str | None) -> Client:
    """The client everything gets stamped with, created on the first run."""
    existing = await Client.find_all().sort("created_at").to_list()
    if existing:
        client = existing[0]
        print(f"Using the existing client {client.name} ({client.slug})")
        if len(existing) > 1:
            print(f"  note: {len(existing)} clients exist; stamping orphans onto the oldest")
        return client

    client = await client_service.create_client(name=await default_name(name))
    print(f"Created client {client.name} ({client.slug})")
    return client


async def stamp(client: Client) -> int:
    """Give every record with no client to `client`. Returns how many moved."""
    moved = 0
    for model in TENANT_MODELS:
        collection = model.get_motor_collection()
        result = await collection.update_many(
            {"$or": [{"client_id": None}, {"client_id": {"$exists": False}}]},
            {"$set": {"client_id": client.id}},
        )
        count = int(getattr(result, "modified_count", 0) or 0)
        if count:
            print(f"  {model.Settings.name}: {count} record(s)")
        moved += count
    return moved


async def promote(email: str) -> None:
    """Make one account QKil platform staff, belonging to no client."""
    with unscoped():
        user = await User.find_one({"email": email.strip().lower()})
    if user is None:
        print(f"  no account with the email {email} - nobody was promoted")
        return
    user.is_platform_staff = True
    user.client_id = None
    user.touch()
    with unscoped():
        await user.save()
    print(f"  {user.full_name} <{user.email}> is now platform staff, in no client")


async def main(name: str | None, platform_admin: str | None) -> int:
    await init_db()
    try:
        # Everything here reaches across clients on purpose.
        with unscoped():
            client = await pick_client(name)
            print("Stamping records that have no client:")
            moved = await stamp(client)
            print(f"{moved} record(s) now belong to {client.name}")

            if platform_admin:
                print("Platform staff:")
                await promote(platform_admin)

            # A sanity count, inside the client's own scope, through the same
            # filter the app uses - so this also proves the scoping works.
            with acting_as(client.id):
                for model in TENANT_MODELS:
                    print(f"  {model.Settings.name}: {await model.find_all().count()} visible to {client.slug}")
    finally:
        await close_db()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", help="Name for the client; defaults to the configured company name")
    parser.add_argument("--platform-admin", help="Email of an existing account to make QKil platform staff")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.name, args.platform_admin)))
