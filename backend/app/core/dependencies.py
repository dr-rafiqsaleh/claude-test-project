"""Shared FastAPI dependencies for authentication and authorisation."""

from typing import Callable, Coroutine, Any, Optional

from beanie import PydanticObjectId
from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.permissions import ADMIN_ROLE, ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSION_GROUPS
from app.core.security import ACCESS_TOKEN_TYPE, decode_token
from app.core.tenancy import set_current_client
from app.models.user import User
from app.services import client_service, role_service
from app.services.client_service import ClientUnavailableError

bearer_scheme = HTTPBearer(auto_error=False)

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


#: A platform admin sends this to work inside one client, which is how the
#: platform pages drill into a client's records. It is ignored for everyone
#: else, so nobody can read another client by adding a header.
CLIENT_HEADER = "X-Client-Id"


async def resolve_user_from_token(
    raw_token: Optional[str],
    client_override: Optional[str] = None,
) -> User:
    """Decode an access token, load the user, and put their client in scope.

    This is the one place a request's client is decided. Everything downstream
    - every query through `TenantDocument`, every permission lookup - reads it
    from there, so no route has to pass a client around or remember to filter.
    """
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

    try:
        await client_service.assert_usable(user.client_id)
    except ClientUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    # Scope first: the role lookup below is itself a tenant query, and this
    # user's Office Staff is not another client's Office Staff.
    set_current_client(await _scope_for(user, client_override))

    user._permissions = await role_service.permissions_for(user)
    return user


async def _scope_for(user: User, client_override: Optional[str]) -> Optional[PydanticObjectId]:
    """The client this request may touch."""
    if not user.is_platform_staff:
        # Ordinary staff are pinned to their own client, header or not.
        return user.client_id

    if not client_override:
        # Platform staff with no client chosen read across all of them. They
        # still cannot create a client's records - see TenantDocument.insert.
        return None

    try:
        chosen = PydanticObjectId(client_override)
    except Exception:  # noqa: BLE001 - a malformed header is a bad request
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{CLIENT_HEADER} is not a valid client id",
        ) from None

    try:
        await client_service.get_client(chosen)
    except client_service.ClientNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return chosen



def can(user: User, permission: str) -> bool:
    """Whether a person may do something.

    Uses the permissions loaded when they signed in to this request. For a
    user loaded some other way (a script, say), the built-in role's defaults.
    """
    loaded = getattr(user, "_permissions", None)
    if loaded is None:
        if str(user.role) == ADMIN_ROLE:
            return True
        loaded = frozenset(DEFAULT_ROLES.get(str(user.role), {}).get("permissions", ()))
    return permission in loaded


_LABELS = {
    permission["key"]: permission["label"]
    for group in PERMISSION_GROUPS
    for permission in group["permissions"]
}


def forbidden(permission: str) -> HTTPException:
    """A 403 that says which permission is missing, so an admin knows what to give."""
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            f"You don't have permission to do this. Ask an admin to give your role "
            f"'{_LABELS.get(permission, permission)}'."
        ),
    )


def require_permission(*permissions: str) -> Callable[..., Coroutine[Any, Any, User]]:
    """Dependency factory: the signed-in user must hold every one of `permissions`."""
    assert set(permissions) <= ALL_PERMISSIONS, permissions

    async def _checker(current_user: User = Depends(get_current_user)) -> User:
        for permission in permissions:
            if not can(current_user, permission):
                raise forbidden(permission)
        return current_user

    return _checker


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    x_client_id: Optional[str] = Header(None, alias=CLIENT_HEADER, include_in_schema=False),
) -> User:
    """Resolve the authenticated user from a Bearer access token."""
    if credentials is None:
        raise CREDENTIALS_EXCEPTION
    return await resolve_user_from_token(credentials.credentials, x_client_id)


async def require_platform_staff(current_user: User = Depends(get_current_user)) -> User:
    """Only QKil's own staff, who run the platform and its client list."""
    if not current_user.is_platform_staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This is for QKil platform staff only",
        )
    return current_user


async def get_current_user_flexible(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    x_client_id: Optional[str] = Header(None, alias=CLIENT_HEADER, include_in_schema=False),
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
    return await resolve_user_from_token(raw, x_client_id)


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Alias dependency for readability in routes."""
    return current_user


