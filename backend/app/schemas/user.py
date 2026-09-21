"""User request/response schemas."""

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.user import UserRole
from app.schemas.common import ApiResponse

PASSWORD_RULES = "Password must be at least 8 characters and contain an uppercase letter, a lowercase letter and a number."


def validate_password_strength(password: str) -> str:
    """Enforce the QKil password policy."""
    if len(password) < 8:
        raise ValueError(PASSWORD_RULES)
    if not re.search(r"[A-Z]", password):
        raise ValueError(PASSWORD_RULES)
    if not re.search(r"[a-z]", password):
        raise ValueError(PASSWORD_RULES)
    if not re.search(r"\d", password):
        raise ValueError(PASSWORD_RULES)
    return password


class UserCreate(BaseModel):
    """Payload for creating a user."""

    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.TECHNICIAN
    is_active: bool = True

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return validate_password_strength(value)

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Full name cannot be empty")
        return cleaned


class UserUpdate(BaseModel):
    """Payload for partially updating a user."""

    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_password_strength(value)

    @field_validator("full_name")
    @classmethod
    def _strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Full name cannot be empty")
        return cleaned


class UserResponse(BaseModel):
    """Public representation of a user."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str = Field(alias="id")
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def _coerce_id(cls, value: object) -> str:
        return str(value)


class UserListData(BaseModel):
    """Paginated user list payload."""

    items: List[UserResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class UserResponseEnvelope(ApiResponse[UserResponse]):
    """Envelope for a single user."""


class UserListResponse(ApiResponse[UserListData]):
    """Envelope for a paginated list of users."""
