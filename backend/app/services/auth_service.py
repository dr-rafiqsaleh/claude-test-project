"""Authentication service."""

from typing import Optional, Tuple

from app.core.security import create_access_token, create_refresh_token, verify_password
from app.models.user import User
from app.services.user_service import get_user_by_email


class InactiveUserError(Exception):
    """Raised when a deactivated user attempts to sign in."""


async def authenticate_user(email: str, password: str) -> Optional[User]:
    """Return the user if the credentials are valid, otherwise None."""
    user = await get_user_by_email(email)
    if user is None:
        return None

    if not verify_password(password, user.hashed_password):
        return None

    if not user.is_active:
        raise InactiveUserError("This account has been deactivated")

    return user


def create_tokens(user: User) -> Tuple[str, str]:
    """Create an (access_token, refresh_token) pair for the given user."""
    subject = str(user.id)
    claims = {"email": user.email, "role": user.role.value}
    access = create_access_token(subject, extra=claims)
    refresh = create_refresh_token(subject, extra={"email": user.email})
    return access, refresh
