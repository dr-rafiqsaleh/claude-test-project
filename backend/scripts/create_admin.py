"""
Quick-start script: creates the first client and its admin user.

Run this from the backend/ directory with your venv active:

    python scripts/create_admin.py                 # a client and its admin
    python scripts/create_admin.py --platform      # also QKil platform staff
    python scripts/create_admin.py --reset         # reset the admin password

Use this if the full seed.py fails or you just need an account fast. The admin
belongs to one client company; platform staff belong to none and are the only
people who can add or suspend a client.
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.core.security import hash_password
from app.core.tenancy import acting_as, unscoped
from app.database import close_db, init_db
from app.models.client import Client
from app.models.user import User, UserRole
from app.services import client_service


PLATFORM_EMAIL = "platform@qkil.com"


async def first_client() -> Client:
    """The client the admin belongs to, created on the first run."""
    existing = await Client.find_all().sort("created_at").to_list()
    if existing:
        return existing[0]
    client = await client_service.create_client(name="My Company")
    print(f"Created client {client.name} ({client.slug})")
    return client


async def platform_staff() -> None:
    """QKil's own account: no client, and the only one who may manage clients."""
    with unscoped():
        if await User.find_one({"email": PLATFORM_EMAIL}) is not None:
            print(f"Platform staff already exists: {PLATFORM_EMAIL}")
            return
        now = datetime.utcnow()
        await User(
            email=PLATFORM_EMAIL,
            full_name="Pat Platform",
            hashed_password=hash_password("Admin123!"),
            role=UserRole.ADMIN,
            is_platform_staff=True,
            client_id=None,
            created_at=now,
            updated_at=now,
        ).insert()
    print(f"Created platform staff: {PLATFORM_EMAIL} / Admin123!")


async def main():
    print(f"Connecting to {settings.MONGODB_URL} / {settings.DATABASE_NAME} ...")
    await init_db()

    with unscoped():
        client = await first_client()
    if "--platform" in sys.argv:
        await platform_staff()

    email = "admin@qkil.com"
    with acting_as(client.id):
        await run_for_client(email, client)

    total = await User.count()
    print(f"Total users in database: {total}")

    await close_db()


async def run_for_client(email: str, client: Client) -> None:
    """Create or reset the admin of one client."""
    existing = await User.find_one(User.email == email)

    if existing:
        print(f"Admin user already exists: {email}")
        print("If login still fails, reset the password by running this with --reset:")
        if "--reset" in sys.argv:
            existing.hashed_password = hash_password("Admin123!")
            existing.updated_at = datetime.utcnow()
            await existing.save()
            print("Password reset to Admin123!")
    else:
        now = datetime.utcnow()
        user = User(
            email=email,
            full_name="Alice Administrator",
            hashed_password=hash_password("Admin123!"),
            role=UserRole.ADMIN,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        await user.insert()
        print(f"Created admin user: {email} / Admin123! in {client.name}")


asyncio.run(main())
