"""User CRUD operations."""

import logging
from datetime import datetime
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserUpdate

logger = logging.getLogger(__name__)


class UserAlreadyExistsError(Exception):
    """Raised when an email is already registered."""


class UserNotFoundError(Exception):
    """Raised when a user cannot be located."""


def normalise_email(email: str) -> str:
    return email.strip().lower()


async def get_user_by_email(email: str) -> Optional[User]:
    """Look up a user by (case-insensitive) email."""
    return await User.find_one(User.email == normalise_email(email))


async def get_user_by_id(user_id: PydanticObjectId | str) -> Optional[User]:
    """Look up a user by id."""
    try:
        oid = user_id if isinstance(user_id, PydanticObjectId) else PydanticObjectId(user_id)
    except Exception:  # noqa: BLE001 - invalid object id string
        return None
    return await User.get(oid)


async def _check_role(key: str) -> str:
    """The role key, if such a role exists (raises role_service.RoleNotFoundError)."""
    from app.services import role_service  # noqa: PLC0415

    return (await role_service.get_role(key)).key


async def create_user(payload: UserCreate, invite: bool = True) -> User:
    """Create a new user, rejecting duplicate emails and unknown roles.

    There is no password to set. The address is registered with SuperTokens so
    it can be signed in with, and unless `invite` is off they are emailed a link
    straight away - otherwise a new colleague has an account they have no way to
    reach.
    """
    from app.core import supertokens  # noqa: PLC0415 - avoids a cycle

    email = normalise_email(payload.email)
    if await get_user_by_email(email):
        raise UserAlreadyExistsError(f"A user with email {email} already exists")

    now = datetime.utcnow()
    user = User(
        email=email,
        full_name=payload.full_name,
        job_title=payload.job_title,
        role=await _check_role(payload.role),
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )

    # Before the PestBase record, so a failure there leaves nothing half-made that
    # an admin would have to notice and clean up.
    user.auth_user_id, _ = await supertokens.provision_auth_user(email)
    await user.insert()

    if invite and user.is_active:
        try:
            await supertokens.send_sign_in_link(email)
        except Exception:  # noqa: BLE001 - the account is made either way
            logger.warning("Could not email a sign-in link to %s", email, exc_info=True)

    return user


async def list_users(
    page: int = 1,
    page_size: int = 20,
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    q: Optional[str] = None,
) -> Tuple[List[User], int]:
    """Return a page of users plus the total count."""
    criteria: dict = {}
    if role:
        criteria["role"] = role
    if is_active is not None:
        criteria["is_active"] = is_active
    if q and q.strip():
        escaped = _escape_regex(q.strip())
        criteria["$or"] = [
            {"full_name": {"$regex": escaped, "$options": "i"}},
            {"email": {"$regex": escaped, "$options": "i"}},
        ]

    query = User.find(criteria) if criteria else User.find_all()

    total = await query.count()
    skip = max(page - 1, 0) * page_size
    users = await query.sort("-created_at").skip(skip).limit(page_size).to_list()
    return users, total


async def update_user(user_id: PydanticObjectId | str, payload: UserUpdate) -> User:
    """Apply a partial update to a user."""
    user = await get_user_by_id(user_id)
    if user is None:
        raise UserNotFoundError("User not found")

    data = payload.model_dump(exclude_unset=True, exclude_none=True)

    if "email" in data:
        new_email = normalise_email(str(data["email"]))
        if new_email != user.email:
            existing = await get_user_by_email(new_email)
            if existing is not None and existing.id != user.id:
                raise UserAlreadyExistsError(f"A user with email {new_email} already exists")
        user.email = new_email

    if "full_name" in data:
        user.full_name = str(data["full_name"])

    if "job_title" in data:
        user.job_title = data["job_title"]

    if "role" in data and data["role"]:
        user.role = await _check_role(str(data["role"]))

    if "is_active" in data:
        user.is_active = bool(data["is_active"])

    user.touch()
    await user.save()
    return user


async def deactivate_user(user_id: PydanticObjectId | str) -> User:
    """Soft-delete a user by flipping is_active to False."""
    user = await get_user_by_id(user_id)
    if user is None:
        raise UserNotFoundError("User not found")

    user.is_active = False
    user.touch()
    await user.save()

    # Otherwise a deactivated person carries on working with the session they
    # already have. Every request checks is_active, so this is belt and braces -
    # but it is the difference between "locked out now" and "locked out when
    # their session happens to expire".
    from app.core import supertokens  # noqa: PLC0415

    await supertokens.end_all_sessions(user.auth_user_id)
    return user


class UserInUseError(Exception):
    """A user with records against their name, who can only be deactivated."""


async def user_payload(user: User, with_permissions: bool = False) -> dict:
    """A user as the API returns them, with their role's name."""
    from app.services import role_service  # noqa: PLC0415

    # auth_user_id is SuperTokens' internal handle; nothing outside needs it.
    payload = user.model_dump(exclude={"auth_user_id"})
    payload["id"] = str(user.id)
    payload["role_name"] = await role_service.role_name(str(user.role))
    if with_permissions:
        payload["permissions"] = sorted(await role_service.permissions_for(user))
    return payload


async def delete_user_permanently(user_id: PydanticObjectId | str) -> User:
    """Remove a user for good. Only for someone with nothing on record.

    Anyone who has done work in PestBase (jobs, reports, quotes, invoices,
    customers, emails, photos) stays on those records, so they are
    deactivated instead: they can't sign in, and history keeps their name.
    """
    from app.models.booking import Booking  # noqa: PLC0415
    from app.models.customer import Customer  # noqa: PLC0415
    from app.models.email_log import EmailLog  # noqa: PLC0415
    from app.models.invoice import Invoice  # noqa: PLC0415
    from app.models.job import Job  # noqa: PLC0415
    from app.models.notification import Notification  # noqa: PLC0415
    from app.models.photo import Photo  # noqa: PLC0415
    from app.models.quote import Quote  # noqa: PLC0415

    user = await get_user_by_id(user_id)
    if user is None:
        raise UserNotFoundError("User not found")

    checks = (
        ("job", Booking, ["technician_id", "created_by"]),
        ("report", Job, ["technician_id", "created_by"]),
        ("quote", Quote, ["created_by"]),
        ("invoice", Invoice, ["created_by", "payments.recorded_by"]),
        ("customer", Customer, ["created_by"]),
        ("email", EmailLog, ["sent_by"]),
        ("photo", Photo, ["uploaded_by"]),
    )
    found = []
    for label, model, fields in checks:
        count = await model.find({"$or": [{field: user.id} for field in fields]}).count()
        if count:
            found.append(f"{count} {label}{'' if count == 1 else 's'}")
    if found:
        raise UserInUseError(
            f"{user.full_name} is on {', '.join(found)}, so they can't be deleted without "
            "losing that history. Deactivate them instead: they can no longer sign in, "
            "and their name stays on the records."
        )

    await Notification.find({"user_id": user.id}).delete()
    await user.delete()
    return user


async def count_active_admins() -> int:
    """Number of active admin accounts (used to prevent lock-out)."""
    return await User.find({"role": UserRole.ADMIN.value, "is_active": True}).count()


def _escape_regex(value: str) -> str:
    """Escape regex metacharacters so user input is treated literally."""
    specials = r"\^$.|?*+()[]{}"
    return "".join("\\" + ch if ch in specials else ch for ch in value)
