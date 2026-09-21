"""Password hashing and JWT token helpers."""

from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except ValueError:
        return False


def _create_token(subject: str, token_type: str, expires_delta: timedelta, extra: Optional[Dict[str, Any]] = None) -> str:
    now = datetime.utcnow()
    payload: Dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(subject: str, extra: Optional[Dict[str, Any]] = None) -> str:
    """Create a short-lived access token for the given subject (user id)."""
    return _create_token(
        subject=subject,
        token_type=ACCESS_TOKEN_TYPE,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        extra=extra,
    )


def create_refresh_token(subject: str, extra: Optional[Dict[str, Any]] = None) -> str:
    """Create a long-lived refresh token for the given subject (user id)."""
    return _create_token(
        subject=subject,
        token_type=REFRESH_TOKEN_TYPE,
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        extra=extra,
    )


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate a JWT. Returns the payload, or None if invalid/expired."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
