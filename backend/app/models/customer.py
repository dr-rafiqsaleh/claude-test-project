"""Customer document model."""

from datetime import datetime
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel


class Address(BaseModel):
    """A UK street address."""

    street: str
    city: str  # Town/City
    county: Optional[str] = None  # County (optional in the UK)
    postcode: str
    country: str = "United Kingdom"

    def one_line(self) -> str:
        parts = [self.street, self.city]
        if self.county:
            parts.append(self.county)
        parts += [self.postcode, self.country]
        return ", ".join(part for part in parts if part)


class Customer(Document):
    """A pest-control customer record."""

    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: str
    mobile: Optional[str] = None
    address: Address
    notes: Optional[str] = None
    is_active: bool = True
    created_by: PydanticObjectId
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "customers"
        indexes = [
            IndexModel(
                [
                    ("first_name", "text"),
                    ("last_name", "text"),
                    ("email", "text"),
                    ("phone", "text"),
                ],
                name="customer_text_search",
            ),
            IndexModel([("last_name", 1), ("first_name", 1)], name="idx_name"),
            IndexModel([("is_active", 1)], name="idx_is_active"),
            IndexModel([("created_at", -1)], name="idx_created_at"),
        ]

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()
