"""Shared branding helpers for the invoice, quote and inspection-report PDFs.

Every generated document pulls its company name, contact details, logo and
accent colour from the one company settings document, so re-branding QKil is a
settings change rather than a code change.
"""

import base64
import binascii
import logging
from io import BytesIO
from typing import List, Optional

from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image

logger = logging.getLogger(__name__)

#: Fallbacks used when the settings document has not been filled in.
DEFAULT_COMPANY_NAME = "QKil Pest Control"
DEFAULT_ACCENT = colors.HexColor("#059669")  # emerald-600

#: Largest a logo may be drawn in a PDF header, in points.
MAX_LOGO_WIDTH = 120
MAX_LOGO_HEIGHT = 60


async def load_branding() -> dict:
    """Fetch the company settings a PDF header needs.

    Imported lazily so the PDF modules never take a hard dependency on the
    settings service at import time.
    """
    from app.services.company_settings_service import (  # noqa: PLC0415
        get_settings_for_pdf,
    )

    return await get_settings_for_pdf()


def accent_color(branding: dict):
    """The configured primary colour, as a reportlab colour."""
    raw = str(branding.get("primary_color") or "").strip()
    if not raw:
        return DEFAULT_ACCENT
    try:
        return colors.HexColor(raw if raw.startswith("#") else f"#{raw}")
    except Exception:  # noqa: BLE001 - a bad hex value must not break the PDF
        return DEFAULT_ACCENT


def company_name(branding: dict) -> str:
    return str(branding.get("company_name") or DEFAULT_COMPANY_NAME)


def identity_line(branding: dict) -> str:
    """"Company No: ...  |  VAT No: ..." - empty when neither is recorded."""
    parts = []
    if branding.get("company_number"):
        parts.append(f"Company No: {branding['company_number']}")
    if branding.get("vat_number"):
        parts.append(f"VAT No: {branding['vat_number']}")
    return "  |  ".join(parts)


def contact_lines(branding: dict) -> List[str]:
    """Address, phone, email and website, skipping anything not filled in."""
    lines: List[str] = [
        line for line in (branding.get("address_lines") or []) if line
    ]
    if branding.get("phone"):
        lines.append(f"Phone: {branding['phone']}")
    if branding.get("email"):
        lines.append(f"Email: {branding['email']}")
    if branding.get("website"):
        lines.append(str(branding["website"]))
    return lines


def footer_line(branding: dict) -> str:
    """A one-line company summary for the page footer."""
    parts = [company_name(branding)]
    if branding.get("phone"):
        parts.append(str(branding["phone"]))
    elif branding.get("email"):
        parts.append(str(branding["email"]))
    return "  |  ".join(parts)


def logo_flowable(
    branding: dict,
    max_width: float = MAX_LOGO_WIDTH,
    max_height: float = MAX_LOGO_HEIGHT,
) -> Optional[Image]:
    """Decode the stored logo into a sized reportlab Image, or None.

    The image is scaled to fit inside `max_width` x `max_height` while keeping
    its aspect ratio, so a wide or tall logo never distorts the header.
    """
    raw_data = branding.get("logo_data")
    if not raw_data:
        return None

    try:
        payload = str(raw_data).split(",")[-1]
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        logger.warning("The company logo could not be decoded for a PDF")
        return None

    try:
        reader = ImageReader(BytesIO(raw))
        width, height = reader.getSize()
    except Exception:  # noqa: BLE001 - unsupported or corrupt image payload
        logger.warning("The company logo could not be read for a PDF")
        return None

    if not width or not height:
        return None

    scale = min(max_width / width, max_height / height, 1.0)
    return Image(BytesIO(raw), width=width * scale, height=height * scale)
