"""Application configuration loaded from environment variables."""

from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the QKil backend."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    MONGODB_URL: str = "mongodb://localhost:27017"
    DATABASE_NAME: str = "qkil_db"

    # Security
    SECRET_KEY: str = "your-super-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # App
    ENVIRONMENT: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173"

    # Pagination
    DEFAULT_PAGE_SIZE: int = 20
    MAX_PAGE_SIZE: int = 500

    @field_validator("CORS_ORIGINS")
    @classmethod
    def _strip_origins(cls, value: str) -> str:
        return value.strip()

    @property
    def cors_origins_list(self) -> List[str]:
        """CORS_ORIGINS as a list, supporting comma-separated values."""
        if not self.CORS_ORIGINS:
            return []
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor."""
    return Settings()


settings = get_settings()
