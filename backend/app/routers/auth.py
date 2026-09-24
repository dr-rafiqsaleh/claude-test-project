"""Authentication routes."""

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import REFRESH_TOKEN_TYPE, create_access_token, decode_token
from app.models.user import User
from app.schemas.auth import (
    AccessTokenResponse,
    LoginApiResponse,
    LoginRequest,
    RefreshApiResponse,
    RefreshRequest,
    TokenResponse,
)
from app.core.dependencies import get_current_user
from app.core.tenancy import acting_as
from app.services import client_service
from app.services.client_service import ClientUnavailableError
from app.schemas.user import UserResponse, UserResponseEnvelope
from app.services import user_service
from app.services.auth_service import InactiveUserError, authenticate_user, create_tokens

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login", response_model=LoginApiResponse, summary="Sign in with email and password")
async def login(payload: LoginRequest) -> LoginApiResponse:
    """Authenticate a user and issue an access + refresh token pair."""
    try:
        user = await authenticate_user(payload.email, payload.password)
    except InactiveUserError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        await client_service.assert_usable(user.client_id)
    except ClientUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    access_token, refresh_token = create_tokens(user)

    # Their role lives in their own client, so read it in that scope: signing
    # in is the one moment no scope has been set yet.
    with acting_as(user.client_id):
        profile = await user_service.user_payload(user, with_permissions=True)

    return LoginApiResponse(
        data=TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            user=UserResponse.model_validate(profile),
        ),
        message="Login successful",
        success=True,
    )


@router.post("/refresh", response_model=RefreshApiResponse, summary="Exchange a refresh token for a new access token")
async def refresh_token(payload: RefreshRequest) -> RefreshApiResponse:
    """Issue a fresh access token from a valid refresh token."""
    claims = decode_token(payload.refresh_token)
    if claims is None or claims.get("type") != REFRESH_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    subject = claims.get("sub")
    if not subject:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    try:
        user = await User.get(PydanticObjectId(subject))
    except Exception:  # noqa: BLE001 - malformed subject
        user = None

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")

    try:
        await client_service.assert_usable(user.client_id)
    except ClientUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

    access_token = create_access_token(
        str(user.id),
        extra={"email": user.email, "role": str(user.role)},
    )

    return RefreshApiResponse(
        data=AccessTokenResponse(access_token=access_token, token_type="bearer"),
        message="Token refreshed",
        success=True,
    )


@router.post("/logout", summary="Sign out the current user")
async def logout(current_user: User = Depends(get_current_user)) -> dict:
    """Log the current user out.

    Tokens are stateless, so the client is responsible for discarding them. This
    endpoint validates the session and confirms the sign-out.
    """
    return {
        "data": {"user_id": str(current_user.id)},
        "message": "Logged out successfully",
        "success": True,
    }


@router.get("/me", response_model=UserResponseEnvelope, summary="Get the currently authenticated user")
async def read_current_user(current_user: User = Depends(get_current_user)) -> UserResponseEnvelope:
    """Return the profile of the authenticated user."""
    return UserResponseEnvelope(
        data=UserResponse.model_validate(await user_service.user_payload(current_user, with_permissions=True)),
        message="Current user retrieved",
        success=True,
    )
