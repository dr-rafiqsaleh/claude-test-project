"""How PestBase itself sends email, for every client.

One mail account serves the whole platform. This holds the transport - which
provider, which server, which credentials, which address the mail leaves from -
and nothing about any particular client.

What stays with each client, in CompanySettings, is everything a *customer* sees
or acts on: the reply-to address their replies go to, the office copy (BCC), the
wording of the templates, and whether technicians are emailed their jobs. Those
have to differ per client; a shared reply-to would send one client's customers to
another client's inbox.

Not a TenantDocument: it belongs to the platform, not to a client, and only
platform staff can read or change it.
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from beanie import Document, PydanticObjectId
from pydantic import Field


class EmailProvider(str, Enum):
    """How email leaves PestBase."""

    NONE = "none"
    SMTP = "smtp"
    MICROSOFT_365 = "microsoft365"


class SmtpSecurity(str, Enum):
    NONE = "none"
    STARTTLS = "starttls"
    SSL = "ssl"


class PlatformSettings(Document):
    """The platform's own configuration. A singleton."""

    # Secrets are stored encrypted; see app.core.secrets.
    email_provider: EmailProvider = EmailProvider.NONE

    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_security: SmtpSecurity = SmtpSecurity.STARTTLS
    smtp_username: Optional[str] = None
    smtp_password_encrypted: Optional[str] = None

    m365_tenant_id: Optional[str] = None  # directory (tenant) ID, or the domain
    m365_client_id: Optional[str] = None  # application (client) ID
    m365_client_secret_encrypted: Optional[str] = None
    m365_mailbox: Optional[str] = None  # the mailbox emails are sent from

    #: The From address, for either provider. One address for the platform: it
    #: has to be one the mail server is actually allowed to send as, which is a
    #: property of the mail account rather than of any client.
    smtp_from_email: Optional[str] = None
    #: Left empty, each client's own company name is used as the display name, so
    #: a customer still sees who the email is from.
    smtp_from_name: Optional[str] = None

    updated_at: datetime = Field(default_factory=datetime.utcnow)
    updated_by: Optional[PydanticObjectId] = None

    class Settings:
        name = "platform_settings"

    @property
    def is_configured(self) -> bool:
        if self.email_provider == EmailProvider.SMTP:
            return bool(self.smtp_host)
        if self.email_provider == EmailProvider.MICROSOFT_365:
            return bool(self.m365_tenant_id and self.m365_client_id and self.m365_mailbox)
        return False

    def touch(self) -> None:
        self.updated_at = datetime.utcnow()
