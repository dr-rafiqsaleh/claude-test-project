"""Customer request/response schemas."""

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.common import ApiResponse

PHONE_PATTERN = re.compile(r"^[0-9+()\-\s]{6,20}$")


class AddressSchema(BaseModel):
    """Street address payload."""

    model_config = ConfigDict(from_attributes=True)

    street: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    county: Optional[str] = Field(default=None, max_length=60)
    postcode: str = Field(min_length=3, max_length=10)
    country: str = Field(default="United Kingdom", max_length=60)

    @field_validator("county")
    @classmethod
    def _normalise_county(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("street", "city", "postcode", "country")
    @classmethod
    def _strip(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Field cannot be empty")
        return cleaned


class CustomerCreate(BaseModel):
    """Payload for creating a customer."""

    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: Optional[EmailStr] = None
    phone: str = Field(min_length=6, max_length=20)
    mobile: Optional[str] = Field(default=None, max_length=20)
    address: AddressSchema
    notes: Optional[str] = Field(default=None, max_length=5000)
    is_active: bool = True

    @field_validator("first_name", "last_name")
    @classmethod
    def _strip_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty")
        return cleaned

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, value: str) -> str:
        cleaned = value.strip()
        if not PHONE_PATTERN.match(cleaned):
            raise ValueError("Phone number contains invalid characters")
        return cleaned

    @field_validator("mobile")
    @classmethod
    def _check_mobile(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not PHONE_PATTERN.match(cleaned):
            raise ValueError("Mobile number contains invalid characters")
        return cleaned


class CustomerUpdate(BaseModel):
    """Payload for partially updating a customer."""

    first_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, min_length=6, max_length=20)
    mobile: Optional[str] = Field(default=None, max_length=20)
    address: Optional[AddressSchema] = None
    notes: Optional[str] = Field(default=None, max_length=5000)
    is_active: Optional[bool] = None

    @field_validator("first_name", "last_name")
    @classmethod
    def _strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Name cannot be empty")
        return cleaned

    @field_validator("phone", "mobile")
    @classmethod
    def _check_phone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not PHONE_PATTERN.match(cleaned):
            raise ValueError("Phone number contains invalid characters")
        return cleaned


class CustomerResponse(BaseModel):
    """Public representation of a customer."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: str
    mobile: Optional[str] = None
    address: AddressSchema
    notes: Optional[str] = None
    is_active: bool
    created_by: str
    created_at: datetime
    updated_at: datetime

    @field_validator("id", "created_by", mode="before")
    @classmethod
    def _coerce_object_id(cls, value: object) -> str:
        return str(value)


class CustomerListData(BaseModel):
    """Paginated customer list payload."""

    items: List[CustomerResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class CustomerResponseEnvelope(ApiResponse[CustomerResponse]):
    """Envelope for a single customer."""


class CustomerListResponse(ApiResponse[CustomerListData]):
    """Envelope for a paginated list of customers."""
