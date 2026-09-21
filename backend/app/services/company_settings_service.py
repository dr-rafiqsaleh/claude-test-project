"""Company settings: the singleton document, its logo, and the PDF view of it."""

import base64
import logging
from datetime import datetime
from typing import Optional, Tuple

from beanie import PydanticObjectId
from fastapi import UploadFile

from app.models.company_settings import (
    ALLOWED_LOGO_TYPES,
    MAX_LOGO_BYTES,
    CompanySettings,
)
from app.schemas.company_settings import CompanySettingsUpdate

logger = logging.getLogger(__name__)


class InvalidLogoError(Exception):
    """Raised when an uploaded logo fails validation (type or size)."""


def build_settings_payload(settings: CompanySettings) -> dict:
    """Flatten the settings into the shape CompanySettingsResponse expects.

    The base64 logo is deliberately left out - it is served as a real image
    from `GET /api/v1/settings/logo` instead of bloating every JSON response.
    """
    return {
        "id": str(settings.id),
        "company_name": settings.company_name,
        "company_number": settings.company_number,
        "vat_number": settings.vat_number,
        "phone": settings.phone,
        "email": settings.email,
        "website": settings.website,
        "address_street": settings.address_street,
        "address_city": settings.address_city,
        "address_county": settings.address_county,
        "address_postcode": settings.address_postcode,
        "address_country": settings.address_country,
        "address_one_line": settings.address_one_line,
        "has_logo": bool(settings.logo_data),
        "logo_content_type": settings.logo_content_type,
        "default_tax_rate": settings.default_tax_rate,
        "default_payment_terms_days": settings.default_payment_terms_days,
        "default_invoice_terms": settings.default_invoice_terms,
        "default_payment_instructions": settings.default_payment_instructions,
        "invoice_prefix": settings.invoice_prefix,
        "quote_prefix": settings.quote_prefix,
        "booking_prefix": settings.booking_prefix,
        "job_prefix": settings.job_prefix,
        "default_quote_valid_days": settings.default_quote_valid_days,
        "default_quote_terms": settings.default_quote_terms,
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_username": settings.smtp_username,
        "smtp_from_email": settings.smtp_from_email,
        "smtp_from_name": settings.smtp_from_name,
        "primary_color": settings.primary_color,
        "updated_at": settings.updated_at,
        "updated_by": str(settings.updated_by) if settings.updated_by else None,
    }


async def get_settings() -> CompanySettings:
    """Fetch the singleton, creating it with defaults the first time round."""
    existing = await CompanySettings.find_one({})
    if existing is not None:
        return existing

    created = CompanySettings(updated_at=datetime.utcnow())
    await created.insert()

    # A concurrent first request could have inserted one too; keep the oldest
    # so every later read is stable.
    duplicates = await CompanySettings.find_all().sort("_id").to_list()
    if len(duplicates) > 1:
        keeper = duplicates[0]
        for extra in duplicates[1:]:
            await extra.delete()
        return keeper

    logger.info("Created the default company settings document")
    return created


async def update_settings(
    data: CompanySettingsUpdate,
    user_id: Optional[PydanticObjectId] = None,
) -> CompanySettings:
    """Apply a partial update to the singleton."""
    settings = await get_settings()
    payload = data.model_dump(exclude_unset=True)

    for field, value in payload.items():
        if not hasattr(settings, field):
            continue
        # A cleared required field falls back to whatever is already stored.
        if value is None and field in {
            "company_name",
            "address_country",
            "default_invoice_terms",
            "invoice_prefix",
            "quote_prefix",
            "booking_prefix",
            "job_prefix",
            "primary_color",
        }:
            continue
        setattr(settings, field, value)

    settings.updated_by = user_id
    settings.touch()
    await settings.save()
    return settings


async def upload_logo(
    file: UploadFile,
    user_id: Optional[PydanticObjectId] = None,
) -> CompanySettings:
    """Validate an uploaded image and store it inline as base64."""
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_LOGO_TYPES:
        allowed = ", ".join(sorted(ALLOWED_LOGO_TYPES))
        raise InvalidLogoError(f"Unsupported image type. Accepted types: {allowed}")

    raw = await file.read()
    if not raw:
        raise InvalidLogoError("The uploaded file is empty")

    if len(raw) > MAX_LOGO_BYTES:
        limit_mb = MAX_LOGO_BYTES // (1024 * 1024)
        raise InvalidLogoError(f"The logo must be smaller than {limit_mb} MB")

    settings = await get_settings()
    settings.logo_data = base64.b64encode(raw).decode("ascii")
    settings.logo_content_type = "image/jpeg" if content_type == "image/jpg" else content_type
    settings.updated_by = user_id
    settings.touch()
    await settings.save()
    return settings


async def remove_logo(user_id: Optional[PydanticObjectId] = None) -> CompanySettings:
    """Clear the stored logo so PDFs fall back to the company name."""
    settings = await get_settings()
    settings.logo_data = None
    settings.logo_content_type = None
    settings.updated_by = user_id
    settings.touch()
    await settings.save()
    return settings


async def get_logo_data() -> Optional[Tuple[bytes, str]]:
    """Return ``(image_bytes, content_type)``, or None when no logo is set."""
    settings = await get_settings()
    if not settings.logo_data:
        return None

    try:
        raw = base64.b64decode(settings.logo_data, validate=False)
    except Exception:  # noqa: BLE001 - corrupt stored payload
        logger.warning("The stored company logo could not be decoded")
        return None

    return raw, settings.logo_content_type or "image/png"


async def get_settings_for_pdf() -> dict:
    """The subset of settings the PDF generators need, with safe fallbacks.

    Never raises: a PDF must still render even if the settings document is
    missing or the database is briefly unreachable.
    """
    try:
        settings = await get_settings()
    except Exception:  # noqa: BLE001 - PDF rendering must not depend on this
        logger.exception("Could not load company settings for a PDF; using defaults")
        settings = CompanySettings()

    return {
        "company_name": settings.company_name or "QKil Pest Control",
        "company_number": settings.company_number or "",
        "vat_number": settings.vat_number or "",
        "phone": settings.phone or "",
        "email": settings.email or "",
        "website": settings.website or "",
        "address": settings.address_one_line,
        "address_lines": settings.address_lines,
        "logo_data": settings.logo_data,
        "logo_content_type": settings.logo_content_type or "image/png",
        "default_tax_rate": settings.default_tax_rate,
        "default_payment_terms_days": settings.default_payment_terms_days,
        "default_invoice_terms": settings.default_invoice_terms,
        "default_payment_instructions": settings.default_payment_instructions or "",
        "default_quote_valid_days": settings.default_quote_valid_days,
        "default_quote_terms": settings.default_quote_terms or "",
        "invoice_prefix": settings.invoice_prefix,
        "quote_prefix": settings.quote_prefix,
        "booking_prefix": settings.booking_prefix,
        "job_prefix": settings.job_prefix,
        "primary_color": settings.primary_color or "#059669",
    }


async def get_prefix(kind: str) -> str:
    """The configured record-number prefix for "invoice", "quote", etc.

    Falls back to an empty string, which leaves `Counter.next_number` on its
    built-in default - numbering must never fail because settings are missing.
    """
    try:
        settings = await get_settings()
    except Exception:  # noqa: BLE001 - numbering must not depend on settings
        logger.exception("Could not load the %s prefix; using the default", kind)
        return ""

    return str(getattr(settings, f"{kind}_prefix", "") or "")
