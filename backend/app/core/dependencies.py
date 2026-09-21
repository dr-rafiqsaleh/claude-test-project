"""Shared FastAPI dependencies for authentication and authorisation."""

from typing import Callable, Coroutine, Any, Optional

from beanie import PydanticObjectId
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import ACCESS_TOKEN_TYPE, decode_token
from app.models.user import User, UserRole

bearer_scheme = HTTPBearer(auto_error=False)

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def resolve_user_from_token(raw_token: Optional[str]) -> User:
    """Decode an access token and load the active user it belongs to."""
    if not raw_token:
        raise CREDENTIALS_EXCEPTION

    payload = decode_token(raw_token)
    if payload is None:
        raise CREDENTIALS_EXCEPTION

    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )

    subject = payload.get("sub")
    if not subject:
        raise CREDENTIALS_EXCEPTION

    try:
        user_id = PydanticObjectId(subject)
    except Exception:  # noqa: BLE001 - malformed id in token
        raise CREDENTIALS_EXCEPTION from None

    user = await User.get(user_id)
    if user is None:
        raise CREDENTIALS_EXCEPTION

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated",
        )

    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    """Resolve the authenticated user from a Bearer access token."""
    if credentials is None:
        raise CREDENTIALS_EXCEPTION
    return await resolve_user_from_token(credentials.credentials)


async def get_current_user_flexible(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    token: Optional[str] = Query(
        None,
        description=(
            "Access token, for requests a browser makes without headers "
            "(an <img> tag loading a photo, for example)."
        ),
    ),
) -> User:
    """Like `get_current_user`, but also accepts the token as a query parameter.

    An ``<img src="...">`` cannot carry an Authorization header, so the photo
    endpoints allow the access token to travel in the query string instead.
    """
    raw = credentials.credentials if credentials is not None else token
    return await resolve_user_from_token(raw)


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Alias dependency for readability in routes."""
    return current_user


def require_roles(*roles: UserRole) -> Callable[..., Coroutine[Any, Any, User]]:
    """Dependency factory that enforces the current user holds one of `roles`."""
    allowed = set(roles)

    async def _role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return current_user

    return _role_checker


require_admin = require_roles(UserRole.ADMIN)
require_staff = require_roles(UserRole.ADMIN, UserRole.OFFICE_STAFF)
