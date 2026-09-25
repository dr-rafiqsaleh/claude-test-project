"""Everything a fresh PestBase deployment needs before its first request.

Run once by the `setup` service in docker compose, before the backend starts:
indexes, the first client, its administrator, the PestBase platform account, and a
SuperTokens identity for each. Then it exits.

A second run finds every step already done and writes nothing, so it costs a
couple of seconds on later `up` and never acts twice. That is what lets compose
depend on it unconditionally. "Already done" is judged by whether the client has
staff and whether any platform account exists - not by the addresses below, which
can be changed later without this script adding a second set of accounts.

It talks to Mongo and to the SuperTokens core directly rather than through the
API, so it does not need the backend to be up - which it could not be, since the
backend is what waits for this.

    python scripts/setup.py
"""

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.supertokens import init_supertokens, provision_auth_user  # noqa: E402
from app.core.tenancy import acting_as, unscoped  # noqa: E402
from app.database import close_db, init_db  # noqa: E402
from app.models.client import Client  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.services import client_service  # noqa: E402

#: Overridable so a deployment can name its first client and its own addresses
#: without editing this file.
FIRST_CLIENT = os.environ.get("SETUP_CLIENT_NAME", "My Company")
CLIENT_ADMIN = os.environ.get("SETUP_CLIENT_ADMIN_EMAIL", "admin@example.com")
PLATFORM_STAFF = os.environ.get("SETUP_PLATFORM_EMAIL", "platform@example.com")


async def first_client() -> Client:
    with unscoped():
        existing = await Client.find_all().sort("created_at").to_list()
    if existing:
        print(f"  client {existing[0].name} already exists")
        return existing[0]
    with unscoped():
        client = await client_service.create_client(name=FIRST_CLIENT)
    print(f"  created client {client.name} ({client.slug})")
    return client


async def ensure_account(email: str, name: str, client: Client | None, platform: bool) -> None:
    """One account, with its SuperTokens identity. Idempotent."""
    with unscoped():
        existing = await User.find_one({"email": email})

    if existing is not None:
        if not existing.auth_user_id:
            existing.auth_user_id, _ = await provision_auth_user(email)
            existing.touch()
            with unscoped():
                await existing.save()
            print(f"  registered {email} with SuperTokens")
        else:
            print(f"  {email} already set up")
        return

    auth_user_id, _ = await provision_auth_user(email)
    user = User(
        email=email,
        full_name=name,
        role=UserRole.ADMIN.value,
        is_platform_staff=platform,
        auth_user_id=auth_user_id,
        client_id=None if platform else client.id,
    )
    # Platform staff belong to no client, so their record is written unscoped;
    # a client's admin is written inside that client.
    if platform:
        with unscoped():
            await user.insert()
    else:
        with acting_as(client.id):
            await user.insert()
    print(f"  created {email}")


async def has_platform_staff() -> bool:
    with unscoped():
        return await User.find({"is_platform_staff": True}).count() > 0


async def has_staff(client: Client) -> bool:
    with acting_as(client.id):
        return await User.find_all().count() > 0


async def main() -> int:
    print("PestBase setup")
    await init_db()
    init_supertokens()
    try:
        client = await first_client()

        # Guarded on "does anyone hold this job", not on "does this address
        # exist". Keyed on the address, changing CLIENT_ADMIN or PLATFORM_STAFF
        # on a deployment that is already running does not rename the account -
        # it quietly adds another one, and in the platform case that is a second
        # account with access to every client.
        if await has_staff(client):
            print(f"  {client.name} already has staff; no first administrator needed")
        else:
            await ensure_account(CLIENT_ADMIN, "Client Administrator", client, platform=False)

        if await has_platform_staff():
            print("  platform staff already exist; none created")
        else:
            await ensure_account(PLATFORM_STAFF, "PestBase Platform", None, platform=True)
    finally:
        await close_db()

    print("Setup complete. Nobody has a password: sign in from the portal and")
    print("ask for a link, which arrives by email.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
