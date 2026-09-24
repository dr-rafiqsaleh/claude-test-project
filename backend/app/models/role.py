"""A role: a named set of permissions that team members are given."""

from datetime import datetime
from typing import List, Optional

from pydantic import Field
from pymongo import IndexModel

from app.models.tenant import TenantDocument

class Role(TenantDocument):
    """One role. Built-in roles can't be deleted; Admin can't be changed at all."""

    key: str  # stable id stored on each user, e.g. "office_staff" or "senior_technician"
    name: str
    description: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)
    is_system: bool = False  # one of the built-in roles
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "roles"
        indexes = [IndexModel([("client_id", 1), ("key", 1)], unique=True, name="uniq_role_key")]

    def touch(self) -> None:
        self.updated_at = datetime.utcnow()
