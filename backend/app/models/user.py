"""User document model."""

from datetime import datetime
from enum import Enum

from beanie import Document
from pydantic import Field
from pymongo import IndexModel


class UserRole(str, Enum):
    """Roles available in QKil."""

    ADMIN = "admin"
    OFFICE_STAFF = "office_staff"
    TECHNICIAN = "technician"


class User(Document):
    """A staff member who can sign in to QKil."""

    email: str
    full_name: str
    hashed_password: str
    role: UserRole = UserRole.TECHNICIAN
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"
        indexes = [
            IndexModel([("email", 1)], unique=True, name="uniq_email"),
            IndexModel([("role", 1)], name="idx_role"),
            IndexModel([("is_active", 1)], name="idx_is_active"),
        ]

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return f"{self.full_name} <{self.email}>"
