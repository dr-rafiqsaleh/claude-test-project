"""MongoDB connection and Beanie ODM initialisation."""

import logging
from typing import Optional

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.models.audit_event import AuditEvent
from app.models.booking import Booking
from app.models.client import Client
from app.models.company_settings import CompanySettings
from app.models.counter import Counter
from app.models.customer import Customer
from app.models.email_log import EmailLog
from app.models.invoice import Invoice
from app.models.job import Job
from app.models.notification import Notification
from app.models.photo import Photo
from app.models.quote import Quote
from app.models.role import Role
from app.models.support_grant import SupportGrant
from app.models.user import User

logger = logging.getLogger(__name__)

DOCUMENT_MODELS = [
    Client,
    User,
    Customer,
    Quote,
    Booking,
    Job,
    Photo,
    Invoice,
    Counter,
    Notification,
    CompanySettings,
    EmailLog,
    Role,
    AuditEvent,
    SupportGrant,
]

_client: Optional[AsyncIOMotorClient] = None


def normalised_key(pairs) -> list:
    """An index's key as a comparable list of (field, direction).

    Both sides of the comparison come from different places - one from our own
    IndexModel, one back off the wire - so shapes differ: a SON, a list of
    tuples or a list of lists, with a direction that may arrive as 1 or 1.0.
    A mismatch here would either drop an index needlessly or leave the one
    that stops the application starting, so it normalises rather than trusting
    the shape.
    """
    items = pairs.items() if hasattr(pairs, "items") else pairs
    normalised = []
    for field, direction in items:
        # "2dsphere" and "text" are directions too, and must stay strings.
        if isinstance(direction, bool):
            normalised.append((field, direction))
        elif isinstance(direction, (int, float)):
            normalised.append((field, int(direction)))
        else:
            normalised.append((field, direction))
    return normalised


def _declared_indexes(model) -> list:
    """The IndexModels a document model asks for, if it asks for any."""
    return list(getattr(getattr(model, "Settings", None), "indexes", None) or [])


async def _reconcile_indexes(database) -> None:
    """Drop an index whose keys no longer match the one the model declares.

    MongoDB refuses to create an index when one of that name already exists
    with different keys, and Beanie does not drop it - so the application will
    not start. That is exactly what happens when an index becomes per-client:
    `uniq_quote_number` was on `quote_number` and is now on
    `(client_id, quote_number)` under the same name.

    Only a name we declare ourselves, and only when the keys differ, so this
    cannot touch an index somebody added by hand. The replacement is created
    immediately afterwards by init_beanie.

    The old global index has to go regardless of the name clash: while it
    exists, two clients could not both have a QTE-0001, which per-client
    numbering requires.
    """
    for model in DOCUMENT_MODELS:
        declared = _declared_indexes(model)
        if not declared:
            continue

        collection = database[model.Settings.name]
        try:
            existing = await collection.index_information()
        except Exception as exc:  # noqa: BLE001 - a missing collection is normal
            logger.debug("No index information for %s: %s", model.Settings.name, exc)
            continue

        for index in declared:
            spec = index.document
            name = spec.get("name")
            if not name or name not in existing:
                continue

            wanted = normalised_key(spec["key"])
            current = normalised_key(existing[name].get("key", []))
            if wanted == current:
                continue

            logger.warning(
                "Replacing index %s on %s: keys changed from %s to %s",
                name,
                model.Settings.name,
                current,
                wanted,
            )
            await collection.drop_index(name)


async def init_db(mongodb_url: Optional[str] = None, database_name: Optional[str] = None) -> AsyncIOMotorClient:
    """Create the Motor client and initialise Beanie with all document models."""
    global _client

    url = mongodb_url or settings.MONGODB_URL
    db_name = database_name or settings.DATABASE_NAME

    _client = AsyncIOMotorClient(url)
    database = _client[db_name]
    await _reconcile_indexes(database)
    await init_beanie(database=database, document_models=DOCUMENT_MODELS)
    logger.info("Connected to MongoDB database '%s'", db_name)
    return _client


async def close_db() -> None:
    """Close the Motor client if one is open."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
        logger.info("Closed MongoDB connection")


def get_client() -> Optional[AsyncIOMotorClient]:
    """Return the active Motor client (or None if the DB has not been initialised)."""
    return _client
