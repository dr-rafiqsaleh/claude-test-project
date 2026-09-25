"""Give somebody a PestBase platform staff account, or promote an existing one.

Platform staff belong to no client: they see every client, manage the client
list, and are the only people who can configure the platform's own settings.

Sign-in is passwordless, so this registers the address with SuperTokens and
emails them a link. Nothing to hand over, nothing to reset.

Inside docker compose:

    docker compose -p pestbase-local exec backend \\
        python scripts/make_platform_admin.py you@example.com --name "Your Name"

On the host, with the backend's own environment:

    python scripts/make_platform_admin.py you@example.com --name "Your Name"

Add --no-invite to skip the email and use "Email me a sign-in link" on the
sign-in page instead. Safe to run twice: an existing account is promoted rather
than duplicated, and an existing SuperTokens identity is reused.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.supertokens import (  # noqa: E402
    init_supertokens,
    provision_auth_user,
    send_sign_in_link,
)
from app.core.tenancy import unscoped  # noqa: E402
from app.database import close_db, init_db  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402


async def run(email: str, name: str, invite: bool) -> int:
    address = email.strip().lower()
    if "@" not in address:
        print(f"'{email}' does not look like an email address")
        return 2

    await init_db()
    init_supertokens()
    try:
        # Unscoped throughout: platform staff belong to no client, so none of
        # this happens inside one.
        with unscoped():
            user = await User.find_one({"email": address})

        auth_user_id, created_identity = await provision_auth_user(address)

        if user is None:
            user = User(
                email=address,
                full_name=name or address.split("@")[0],
                role=UserRole.ADMIN.value,
                is_platform_staff=True,
                is_active=True,
                client_id=None,
                auth_user_id=auth_user_id,
            )
            with unscoped():
                await user.insert()
            print(f"Created {address} as PestBase platform staff.")
        else:
            was_platform = user.is_platform_staff
            user.is_platform_staff = True
            # Leaving a client is the point: platform staff are outside them all.
            user.client_id = None
            user.is_active = True
            user.auth_user_id = user.auth_user_id or auth_user_id
            if name:
                user.full_name = name
            user.touch()
            with unscoped():
                await user.save()
            print(
                f"{address} was already platform staff; refreshed."
                if was_platform
                else f"Promoted {address} to PestBase platform staff (now in no client)."
            )

        print(
            f"  SuperTokens identity: {auth_user_id}"
            f"{' (new)' if created_identity else ' (already existed)'}"
        )

        if invite:
            try:
                await send_sign_in_link(address)
                print(f"  Emailed a sign-in link to {address}.")
            except Exception as exc:  # noqa: BLE001 - the account is made either way
                print(f"  Could not email a link ({exc}).")
                print("  Use 'Email me a sign-in link' on the sign-in page instead.")
        else:
            print("  No email sent. Use 'Email me a sign-in link' on the sign-in page.")

        with unscoped():
            staff = await User.find({"is_platform_staff": True}).sort("email").to_list()
        print(f"\nPestBase platform staff ({len(staff)}):")
        for person in staff:
            print(f"  {person.email}  -  {person.full_name}")
        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email", help="The address that signs in")
    parser.add_argument("--name", default="", help="Their full name")
    parser.add_argument(
        "--no-invite",
        action="store_true",
        help="Do not email a sign-in link",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.email, args.name, not args.no_invite)))
