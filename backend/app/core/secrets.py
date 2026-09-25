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
    # Do not "finish the rename to PestBase" here. The "qkil-" below is not a
    # label, it is key material: it is part of the key every stored secret was
    # encrypted with - the SMTP password, the Microsoft 365 client secret.
    # Changing it renames nothing and makes all of them undecryptable.
    if not settings.SECRET_KEY:
        # Deriving from "" would work, and would give every PestBase install on
        # earth the same encryption key. Refuse instead.
        raise RuntimeError(
            "SECRET_KEY is not set, so stored secrets cannot be encrypted. "
            "Put a long random value in backend/.env - see .env.example."
        )
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
