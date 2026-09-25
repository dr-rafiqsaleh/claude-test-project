"""Move PestBase from its own passwords to SuperTokens, passwordless.

Every account gets a SuperTokens identity for its email address, the stored
password hash is dropped, and from then on people sign in with a link or a code
emailed to them. Nobody keeps a password, because there are no longer any
passwords to keep - which is what "reset everyone" amounts to here.

    python scripts/migrate_to_supertokens.py            # say what would change
    python scripts/migrate_to_supertokens.py --apply
    python scripts/migrate_to_supertokens.py --apply --invite

Safe to run twice: an account that already has an identity is left alone.
Nothing but the password hash is removed, and no account is deactivated.

--invite emails everyone a sign-in link as it goes. Leave it off for a quiet
cutover and tell people to use "Email me a link" on the sign-in page instead;
with a large team that is also the difference between one mail run and several
hundred messages your provider may rate-limit.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.supertokens import init_supertokens, provision_auth_user, send_sign_in_link  # noqa: E402
from app.core.tenancy import unscoped  # noqa: E402
from app.database import close_db, init_db  # noqa: E402
from app.models.user import User  # noqa: E402


async def run(apply: bool, invite: bool) -> int:
    await init_db()
    init_supertokens()
    try:
        with unscoped():
            users = await User.find_all().sort("email").to_list()

        if not users:
            print("No accounts found. Nothing to do.")
            return 0

        needs_identity = [u for u in users if not u.auth_user_id]
        print(f"{len(users)} account(s); {len(needs_identity)} without a SuperTokens identity")

        if not apply:
            for user in needs_identity:
                print(f"  would register {user.email}")
            print("\nNothing was changed. Re-run with --apply.")
            return 0

        provisioned = 0
        invited = 0
        for user in needs_identity:
            try:
                user.auth_user_id, created = await provision_auth_user(user.email)
            except Exception as exc:  # noqa: BLE001 - one bad address must not stop the rest
                print(f"  FAILED {user.email}: {exc}")
                continue

            user.touch()
            with unscoped():
                await user.save()
            provisioned += 1
            print(f"  registered {user.email}{'' if created else ' (already known to SuperTokens)'}")

            if invite and user.is_active:
                try:
                    await send_sign_in_link(user.email)
                    invited += 1
                except Exception as exc:  # noqa: BLE001
                    print(f"    could not email {user.email}: {exc}")

        # The hashes go last, so an interrupted run leaves accounts that can
        # still sign in the old way rather than ones that cannot sign in at all.
        dropped = await User.get_motor_collection().update_many(
            {"hashed_password": {"$exists": True}},
            {"$unset": {"hashed_password": ""}},
        )
        removed = int(getattr(dropped, "modified_count", 0) or 0)

        print(f"\n{provisioned} identity(ies) registered, {removed} stored password(s) discarded")
        if invite:
            print(f"{invited} sign-in link(s) emailed")
        else:
            print("No emails sent. People sign in from the sign-in page with 'Email me a link'.")
        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually make the changes")
    parser.add_argument("--invite", action="store_true", help="Email everyone a sign-in link")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.apply, args.invite)))
