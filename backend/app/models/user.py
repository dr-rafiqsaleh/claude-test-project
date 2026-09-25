"""User document model."""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import Field, PrivateAttr
from pymongo import IndexModel

from app.models.tenant import TenantDocument

class UserRole(str, Enum):
    """Roles available in PestBase."""

    ADMIN = "admin"
    OFFICE_STAFF = "office_staff"
    TECHNICIAN = "technician"

class User(TenantDocument):
    """A staff member who can sign in to PestBase.

    `role` is the key of a Role (see app.core.permissions); the built-in
    keys are the UserRole values. The signed-in user's permissions are loaded
    onto `_permissions` for the length of a request.

    `client_id` (from TenantDocument) is the client company they work for, and
    it is what scopes everything they see. Email stays unique across the whole
    platform, because signing in gives an email and nothing else.
    """

    email: str
    full_name: str
    job_title: Optional[str] = None  # printed as their position on reports
    #: SuperTokens' id for this person's credentials. Set on their first
    #: sign-in, or ahead of it when the account is created. Sign-in is
    #: passwordless, so PestBase stores no password of any kind.
    auth_user_id: Optional[str] = None
    last_login_at: Optional[datetime] = None
    role: str = UserRole.TECHNICIAN.value
    is_active: bool = True
    #: Platform staff run PestBase itself: they belong to no client (client_id is
    #: None), read across all of them, and are the only people who may add or
    #: suspend a client. Deliberately a flag rather than a permission, because
    #: a client's own Admin role holds every permission there is and must never
    #: pick this up.
    is_platform_staff: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    _permissions: Optional[frozenset] = PrivateAttr(default=None)

    class Settings:
        name = "users"
        indexes = [
            IndexModel([("email", 1)], unique=True, name="uniq_email"),
            # Sparse: most rows have no auth id until their first sign-in, and a
            # plain unique index would treat every one of those nulls as a
            # duplicate of the others.
            IndexModel(
                [("auth_user_id", 1)],
                unique=True,
                sparse=True,
                name="uniq_auth_user_id",
            ),
            IndexModel([("role", 1)], name="idx_role"),
            IndexModel([("is_active", 1)], name="idx_is_active"),
        ]

    def belongs_to_a_client(self) -> bool:
        """Platform staff are the one record that legitimately has no client.

        Every other row in every collection must be owned by one, and
        TenantDocument.insert refuses to write it otherwise. PestBase's own staff sit
        outside every client by design, so for them there is nothing to own it.
        """
        return not self.is_platform_staff

    def touch(self) -> None:
        """Update the updated_at timestamp."""
        self.updated_at = datetime.utcnow()

    def __str__(self) -> str:
        return f"{self.full_name} <{self.email}>"
