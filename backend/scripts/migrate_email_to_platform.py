"""Lift the email transport out of the clients and onto the platform.

How mail is sent - provider, server, credentials, the From address - used to sit
in each client's company settings. It is now one platform-wide setting, so this
copies it off a client and removes it from every client.

    python scripts/migrate_email_to_platform.py                 # say what would change
    python scripts/migrate_email_to_platform.py --apply
    python scripts/migrate_email_to_platform.py --apply --from-client <slug>

Which client it copies from: the first one that actually has a provider
configured, or the one named with --from-client. Everything a client's own
customers see stays where it is - the reply-to address, the office BCC, the
templates, and whether technicians are emailed.

Safe to run twice: once the platform has a provider, a later run copies nothing
and only clears any leftover fields.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.tenancy import unscoped  # noqa: E402
from app.database import close_db, init_db  # noqa: E402
from app.models.client import Client  # noqa: E402
from app.models.company_settings import CompanySettings  # noqa: E402
from app.models.platform_settings import EmailProvider, PlatformSettings  # noqa: E402
from app.services import platform_settings_service  # noqa: E402

#: Copied to the platform, then removed from every client.
MOVED = (
    "email_provider",
    "smtp_host",
    "smtp_port",
    "smtp_security",
    "smtp_username",
    "smtp_password_encrypted",
    "m365_tenant_id",
    "m365_client_id",
    "m365_client_secret_encrypted",
    "m365_mailbox",
    "smtp_from_email",
    "smtp_from_name",
)


async def source_document(slug: str | None) -> tuple[dict | None, str]:
    """The client settings document to copy from, and who it belongs to.

    Read through the driver rather than the model: these fields no longer exist
    on CompanySettings, so Beanie would not hand them back.
    """
    collection = CompanySettings.get_motor_collection()

    with unscoped():
        clients = {c.id: c for c in await Client.find_all().to_list()}

    if slug:
        match = next((c for c in clients.values() if c.slug == slug), None)
        if match is None:
            raise SystemExit(f"No client with the handle '{slug}'")
        document = await collection.find_one({"client_id": match.id})
        return document, match.name

    # The first client that has a provider set is the one worth copying.
    async for document in collection.find({}):
        provider = document.get("email_provider")
        if provider and provider != EmailProvider.NONE.value:
            owner = clients.get(document.get("client_id"))
            return document, owner.name if owner else "an unknown client"
    return None, ""


async def run(apply: bool, slug: str | None) -> int:
    await init_db()
    try:
        platform = await platform_settings_service.get_settings()
        already = platform.email_provider != EmailProvider.NONE

        document, owner = await source_document(slug)
        movable = {k: document.get(k) for k in MOVED if document and document.get(k) is not None}

        if already:
            print(f"The platform already sends by {platform.email_provider.value}; copying nothing.")
        elif not movable:
            print("No client has email configured, so there is nothing to copy.")
        else:
            print(f"Would copy {owner}'s email settings to the platform:")
            for key, value in movable.items():
                shown = "(stored)" if key.endswith("_encrypted") else value
                print(f"  {key} = {shown}")

        collection = CompanySettings.get_motor_collection()
        leftover = await collection.count_documents(
            {"$or": [{field: {"$exists": True}} for field in MOVED]}
        )
        print(f"{leftover} client settings document(s) still carry these fields")

        if not apply:
            print("\nNothing was changed. Re-run with --apply.")
            return 0

        if movable and not already:
            for key, value in movable.items():
                setattr(platform, key, value)
            platform.touch()
            with unscoped():
                await platform.save()
            print(f"\nCopied {owner}'s email settings to the platform.")

        # Last, so an interrupted run leaves the values somewhere rather than
        # nowhere.
        cleared = await collection.update_many({}, {"$unset": {field: "" for field in MOVED}})
        print(f"Cleared them from {int(getattr(cleared, 'modified_count', 0) or 0)} client(s).")
        print("\nEmail is now configured once, under Platform > Settings.")
        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually make the changes")
    parser.add_argument("--from-client", dest="slug", help="Copy from this client's handle")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.apply, args.slug)))
