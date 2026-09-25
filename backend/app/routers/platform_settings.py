"""PestBase's own settings: how email is sent, for every client. Platform staff only."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.dependencies import require_platform_staff
from app.models.platform_settings import EmailProvider, SmtpSecurity
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services import email_service, platform_settings_service

router = APIRouter(
    prefix="/api/v1/platform-settings",
    tags=["platform settings"],
    dependencies=[Depends(require_platform_staff)],
)


class PlatformSettingsUpdate(BaseModel):
    """A partial update. Secrets are write-only: blank keeps what is stored."""

    email_provider: Optional[EmailProvider] = None
    smtp_host: Optional[str] = Field(None, max_length=200)
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_security: Optional[SmtpSecurity] = None
    smtp_username: Optional[str] = Field(None, max_length=200)
    smtp_password: Optional[str] = Field(None, max_length=500)
    m365_tenant_id: Optional[str] = Field(None, max_length=200)
    m365_client_id: Optional[str] = Field(None, max_length=100)
    m365_client_secret: Optional[str] = Field(None, max_length=500)
    m365_mailbox: Optional[str] = Field(None, max_length=200)
    smtp_from_email: Optional[str] = Field(None, max_length=200)
    smtp_from_name: Optional[str] = Field(None, max_length=200)

    @field_validator("m365_mailbox", "smtp_from_email")
    @classmethod
    def _tidy_address(cls, value: Optional[str]) -> Optional[str]:
        return value.strip().lower() or None if value else None

    @field_validator("smtp_host", "smtp_username", "m365_tenant_id", "m365_client_id")
    @classmethod
    def _tidy(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value else None


class PlatformSettingsResponse(BaseModel):
    """What the platform page shows. Secrets never leave the server.

    `*_set` says whether one is stored, which is enough for the form to show
    "saved" without ever holding the value.
    """

    email_provider: EmailProvider = EmailProvider.NONE
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_security: SmtpSecurity = SmtpSecurity.STARTTLS
    smtp_username: Optional[str] = None
    smtp_password_set: bool = False
    m365_tenant_id: Optional[str] = None
    m365_client_id: Optional[str] = None
    m365_client_secret_set: bool = False
    m365_mailbox: Optional[str] = None
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None
    configured: bool = False
    updated_at: Optional[datetime] = None


class TestEmailRequest(BaseModel):
    to: EmailStr


class PlatformSettingsEnvelope(ApiResponse[PlatformSettingsResponse]):
    pass


def _response(settings) -> PlatformSettingsResponse:
    return PlatformSettingsResponse(
        email_provider=settings.email_provider,
        smtp_host=settings.smtp_host,
        smtp_port=settings.smtp_port,
        smtp_security=settings.smtp_security,
        smtp_username=settings.smtp_username,
        smtp_password_set=bool(settings.smtp_password_encrypted),
        m365_tenant_id=settings.m365_tenant_id,
        m365_client_id=settings.m365_client_id,
        m365_client_secret_set=bool(settings.m365_client_secret_encrypted),
        m365_mailbox=settings.m365_mailbox,
        smtp_from_email=settings.smtp_from_email,
        smtp_from_name=settings.smtp_from_name,
        configured=platform_settings_service.is_configured(settings),
        updated_at=settings.updated_at,
    )


@router.get("", response_model=PlatformSettingsEnvelope, summary="How PestBase sends email")
@router.get("/", response_model=PlatformSettingsEnvelope, include_in_schema=False)
async def get_settings() -> PlatformSettingsEnvelope:
    settings = await platform_settings_service.get_settings()
    return PlatformSettingsEnvelope(
        data=_response(settings), message="Platform settings retrieved", success=True
    )


@router.put("", response_model=PlatformSettingsEnvelope, summary="Change how PestBase sends email")
@router.put("/", response_model=PlatformSettingsEnvelope, include_in_schema=False)
async def update_settings(
    payload: PlatformSettingsUpdate,
    current_user: User = Depends(require_platform_staff),
) -> PlatformSettingsEnvelope:
    settings = await platform_settings_service.update_settings(
        payload.model_dump(exclude_unset=True), user_id=current_user.id
    )
    return PlatformSettingsEnvelope(
        data=_response(settings), message="Platform settings saved", success=True
    )


@router.post(
    "/email/test",
    response_model=ApiResponse[None],
    summary="Send a test email with the platform's settings",
)
async def send_test_email(
    payload: TestEmailRequest,
    current_user: User = Depends(require_platform_staff),
) -> ApiResponse[None]:
    """Proves the transport works, without borrowing any client's configuration."""
    try:
        await email_service.send_platform_test(payload.to, current_user)
    except email_service.EmailError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return ApiResponse[None](data=None, message=f"Test email sent to {payload.to}", success=True)
