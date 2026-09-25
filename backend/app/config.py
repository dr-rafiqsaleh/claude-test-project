"""Application configuration loaded from environment variables."""

from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the PestBase backend."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    MONGODB_URL: str = "mongodb://localhost:27017"
    DATABASE_NAME: str = "pestbase_db"

    # Security
    #
    #: Encrypts the secrets stored in the database - the SMTP password, the
    #: Microsoft 365 client secret. Nothing to do with sign-in, which SuperTokens
    #: owns. There is no default on purpose: an empty key derives the same
    #: encryption key on every install, so `app.core.secrets` refuses it. Change
    #: it and everything already stored becomes undecryptable.
    SECRET_KEY: str = ""

    # App
    ENVIRONMENT: str = "development"
    #: Where people open PestBase, for links in emails (a technician's new job).
    FRONTEND_URL: str = "http://localhost:5173"

    # -- SuperTokens ----------------------------------------------------------
    #: The core. Inside compose this is http://supertokens:3567; the container
    #: environment overrides the default below.
    SUPERTOKENS_CONNECTION_URI: str = "http://localhost:3567"
    #: Only needed when the core is configured with one.
    SUPERTOKENS_API_KEY: str = ""
    AUTH_APP_NAME: str = "PestBase"
    #: What the *browser* calls, not what the container calls. Behind the
    #: portal's nginx both of these are the portal's own origin, which is what
    #: makes the session cookies first-party.
    AUTH_API_DOMAIN: str = "http://localhost:5173"
    AUTH_WEBSITE_DOMAIN: str = "http://localhost:5173"
    #: Where SuperTokens' own endpoints live, and where the sign-in page lives.
    #: They must differ: see frontend/src/config/authPaths.js.
    AUTH_API_BASE_PATH: str = "/auth"
    AUTH_WEBSITE_BASE_PATH: str = "/login"
    #: Secure cookies are forced on in production regardless of this.
    AUTH_COOKIE_SECURE: bool = False

    #: How many sign-in codes one email address may ask for in a window. Without
    #: this, anyone who knows a colleague's address can have PestBase mail them a
    #: code every second.
    AUTH_RATE_LIMIT_WINDOW_SECONDS: int = 300
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: int = 10

    #: Where sign-in emails are sent from. Left empty, SuperTokens sends through
    #: its own service - fine for development, rate limited and not from your
    #: domain, so a real deployment fills these in. Separate from the per-client
    #: SMTP used for quotes and invoices: this sends before we know which client
    #: an address belongs to.
    AUTH_SMTP_HOST: str = ""
    AUTH_SMTP_PORT: int = 587
    AUTH_SMTP_USER: str = ""
    AUTH_SMTP_PASSWORD: str = ""
    AUTH_SMTP_FROM_EMAIL: str = ""
    AUTH_SMTP_FROM_NAME: str = ""
    #: True for implicit TLS on 465; leave false for STARTTLS on 587.
    AUTH_SMTP_SECURE: bool = False
    CORS_ORIGINS: str = "http://localhost:5173"

    # -- Website contact form -------------------------------------------------
    #: Where contact-form enquiries are emailed, through the platform's mail
    #: settings. Every enquiry is also stored, whether or not this is set. The
    #: website's origin (https://pestbase.co.uk) must be in CORS_ORIGINS.
    CONTACT_INBOX: str = "hello@pestbase.co.uk"
    #: At most this many enquiries from one IP address per window.
    CONTACT_RATE_LIMIT_MAX: int = 5
    CONTACT_RATE_LIMIT_WINDOW_SECONDS: int = 3600

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
