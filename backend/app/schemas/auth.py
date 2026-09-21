"""Authentication request/response schemas."""

from pydantic import BaseModel, EmailStr, Field

from app.schemas.common import ApiResponse
from app.schemas.user import UserResponse


class LoginRequest(BaseModel):
    """Credentials submitted at login."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    """Refresh-token exchange request."""

    refresh_token: str = Field(min_length=1)


class TokenResponse(BaseModel):
    """Token bundle returned after a successful login."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class AccessTokenResponse(BaseModel):
    """Access-token-only response used by /refresh."""

    access_token: str
    token_type: str = "bearer"


class LoginApiResponse(ApiResponse[TokenResponse]):
    """Envelope for POST /auth/login."""


class RefreshApiResponse(ApiResponse[AccessTokenResponse]):
    """Envelope for POST /auth/refresh."""
