"""User CRUD operations."""

from datetime import datetime
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.core.security import hash_password
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserUpdate


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


async def create_user(payload: UserCreate) -> User:
    """Create a new user, rejecting duplicate emails."""
    email = normalise_email(payload.email)
    if await get_user_by_email(email):
        raise UserAlreadyExistsError(f"A user with email {email} already exists")

    now = datetime.utcnow()
    user = User(
        email=email,
        full_name=payload.full_name,
        job_title=payload.job_title,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )
    await user.insert()
    return user


async def list_users(
    page: int = 1,
    page_size: int = 20,
    role: Optional[UserRole] = None,
    is_active: Optional[bool] = None,
    q: Optional[str] = None,
) -> Tuple[List[User], int]:
    """Return a page of users plus the total count."""
    criteria: dict = {}
    if role is not None:
        criteria["role"] = role.value
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

    if "password" in data:
        user.hashed_password = hash_password(str(data["password"]))

    if "full_name" in data:
        user.full_name = str(data["full_name"])

    if "job_title" in data:
        user.job_title = data["job_title"]

    if "role" in data:
        user.role = UserRole(data["role"])

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
    return user


async def count_active_admins() -> int:
    """Number of active admin accounts (used to prevent lock-out)."""
    return await User.find(User.role == UserRole.ADMIN, User.is_active == True).count()  # noqa: E712


def _escape_regex(value: str) -> str:
    """Escape regex metacharacters so user input is treated literally."""
    specials = r"\^$.|?*+()[]{}"
    return "".join("\\" + ch if ch in specials else ch for ch in value)
