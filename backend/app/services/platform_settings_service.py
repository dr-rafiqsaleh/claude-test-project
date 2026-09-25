"""The platform's mail configuration, and how it combines with a client's.

`sending_config` is the join: a client's CompanySettings with the platform's
transport laid over the top. Everything that sends email keeps reading one
object, so none of the sending code had to learn that its settings now come from
two places.
"""

import logging
from datetime import datetime
from typing import Optional

from beanie import PydanticObjectId

from app.core.secrets import encrypt_secret
from app.core.tenancy import unscoped
from app.models.platform_settings import EmailProvider, PlatformSettings

logger = logging.getLogger(__name__)

#: The fields that come from the platform rather than the client. Everything
#: else on a merged config still comes from the client: the reply-to, the office
#: BCC, the templates, the company name printed in the body.
TRANSPORT_FIELDS = frozenset(
    {
        "email_provider",
        "smtp_host",
        "smtp_port",
        "smtp_security",
        "smtp_username",
        "smtp_password_encrypted",
        "m365_tenant_id",
        "m365_client_id",
        "m365_client_secret_encrypted",
        "m365_mailbox",
        "smtp_from_email",
        "smtp_from_name",
    }
)

#: Written as `<field>` on the update payload and stored encrypted as
#: `<field>_encrypted`, so a secret is never returned or logged.
SECRET_FIELDS = {
    "smtp_password": "smtp_password_encrypted",
    "m365_client_secret": "m365_client_secret_encrypted",
}


async def get_settings() -> PlatformSettings:
    """The singleton, created with defaults the first time round."""
    with unscoped():
        existing = await PlatformSettings.find_all().sort("_id").to_list()
        if existing:
            # A concurrent first request could have inserted a second one; keep
            # the oldest so every later read is stable.
            if len(existing) > 1:
                for extra in existing[1:]:
                    await extra.delete()
            return existing[0]

        created = PlatformSettings()
        await created.insert()
    logger.info("Created the default platform settings document")
    return created


async def update_settings(data: dict, user_id: Optional[PydanticObjectId] = None) -> PlatformSettings:
    """Apply a partial update. A secret given as empty string is left alone."""
    settings = await get_settings()

    for field, value in data.items():
        if field in SECRET_FIELDS:
            # An empty value means "keep what is stored", so the form can show a
            # "set" marker without ever having to hold the secret itself.
            if value:
                setattr(settings, SECRET_FIELDS[field], encrypt_secret(str(value)))
            continue
        if field in TRANSPORT_FIELDS:
            setattr(settings, field, value)

    settings.updated_by = user_id
    settings.touch()
    with unscoped():
        await settings.save()
    return settings


class MergedEmailConfig:
    """A client's settings, with the platform's mail transport over the top.

    Attribute lookup, rather than copying the fields across: the sending code
    reads about thirty of these, and a copy would silently go stale the moment
    either side gained a field.
    """

    def __init__(self, company, platform: PlatformSettings) -> None:
        self._company = company
        self._platform = platform

    def __getattr__(self, name: str):
        if name in TRANSPORT_FIELDS:
            value = getattr(self._platform, name)
            # The display name falls back to the client's own company name, so a
            # customer sees who wrote to them even though the address is shared.
            if name == "smtp_from_name" and not value:
                return getattr(self._company, "company_name", None)
            return value
        return getattr(self._company, name)


async def sending_config(company_settings):
    """The settings object used for one outgoing email."""
    return MergedEmailConfig(company_settings, await get_settings())


def is_configured(platform: PlatformSettings) -> bool:
    return platform.email_provider != EmailProvider.NONE and platform.is_configured
