"""Company settings routes.

Everybody signed in can read the settings (the app needs the company name and
logo); only an admin can change them.
"""

from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response, StreamingResponse

from app.core.dependencies import (
    get_current_user,
    get_current_user_flexible,
    require_permission,
)
from app.models.user import User
from app.schemas.common import ApiResponse
from app.schemas.company_settings import (
    CompanySettingsEnvelope,
    CompanySettingsResponse,
    CompanySettingsUpdate,
)
from app.schemas.email import TestEmailRequest
from app.services import company_settings_service, email_service
from app.services.company_settings_service import (
    InvalidLogoError,
    SettingsError,
    settings_payload,
)

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


async def _envelope(settings, message: str) -> CompanySettingsEnvelope:
    return CompanySettingsEnvelope(
        data=CompanySettingsResponse.model_validate(await settings_payload(settings)),
        message=message,
        success=True,
    )


@router.get("", response_model=CompanySettingsEnvelope, summary="Get company settings")
@router.get("/", response_model=CompanySettingsEnvelope, include_in_schema=False)
async def get_settings(
    _current_user: User = Depends(get_current_user),
) -> CompanySettingsEnvelope:
    """Return the company profile, document defaults and appearance settings."""
    settings = await company_settings_service.get_settings()
    return await _envelope(settings, "Company settings retrieved")


@router.put("", response_model=CompanySettingsEnvelope, summary="Update company settings")
@router.put("/", response_model=CompanySettingsEnvelope, include_in_schema=False)
async def update_settings(
    payload: CompanySettingsUpdate,
    current_user: User = Depends(require_permission("settings.manage")),
) -> CompanySettingsEnvelope:
    """Apply a partial update. Admin only."""
    try:
        settings = await company_settings_service.update_settings(payload, current_user.id)
    except SettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return await _envelope(settings, "Company settings saved")


@router.post(
    "/email/test",
    response_model=ApiResponse[None],
    summary="Send a test email with the saved email settings",
)
async def send_test_email(
    payload: TestEmailRequest,
    current_user: User = Depends(require_permission("settings.manage")),
) -> ApiResponse[None]:
    """Admin only. A refused send comes back as a 422 saying what to fix."""
    try:
        await email_service.send_test(payload.to, current_user)
    except email_service.EmailError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return ApiResponse[None](data=None, message=f"Test email sent to {payload.to}", success=True)


# Declared before the GET so the multipart upload is matched first.
@router.post(
    "/logo",
    response_model=CompanySettingsEnvelope,
    summary="Upload the company logo",
)
async def upload_logo(
    file: UploadFile = File(..., description="PNG, JPEG or WebP, up to 2 MB"),
    current_user: User = Depends(require_permission("settings.manage")),
) -> CompanySettingsEnvelope:
    """Store a new company logo, used in the header of every generated PDF."""
    try:
        settings = await company_settings_service.upload_logo(file, current_user.id)
    except InvalidLogoError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return await _envelope(settings, "Logo uploaded")


@router.get(
    "/logo",
    summary="Get the company logo image",
    response_class=StreamingResponse,
)
async def get_logo(
    _current_user: User = Depends(get_current_user_flexible),
) -> Response:
    """Stream the stored logo back as a real image.

    Accepts the access token as a `?token=` query parameter, because an
    `<img src="...">` cannot send an Authorization header.
    """
    stored = await company_settings_service.get_logo_data()
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No company logo has been uploaded",
        )

    raw, content_type = stored
    return StreamingResponse(
        BytesIO(raw),
        media_type=content_type,
        headers={
            "Content-Length": str(len(raw)),
            "Cache-Control": "no-cache",
        },
    )


@router.delete(
    "/logo",
    response_model=CompanySettingsEnvelope,
    summary="Remove the company logo",
)
async def delete_logo(
    current_user: User = Depends(require_permission("settings.manage")),
) -> CompanySettingsEnvelope:
    """Clear the logo so PDFs fall back to the company name in large text."""
    settings = await company_settings_service.remove_logo(current_user.id)
    return await _envelope(settings, "Logo removed")
