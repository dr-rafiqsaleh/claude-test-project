"""Encryption for secrets kept in the database, such as email passwords.

Secrets are encrypted with a key derived from the app's SECRET_KEY, so a copy
of the database alone does not reveal them. Changing SECRET_KEY makes stored
secrets unreadable; they then have to be entered again in Settings.
"""

import base64
import hashlib
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(f"qkil-stored-secrets:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    """Encrypt a secret for storage."""
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(token: Optional[str]) -> Optional[str]:
    """The stored secret, or None when there is none or it can no longer be read."""
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None
