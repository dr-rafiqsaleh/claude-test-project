"""MongoDB connection and Beanie ODM initialisation."""

import logging
from typing import Optional

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import OperationFailure

from app.config import settings
from app.models.audit_event import AuditEvent
from app.models.booking import Booking
from app.models.client import Client
from app.models.company_settings import CompanySettings
from app.models.counter import Counter
from app.models.customer import Customer
from app.models.email_log import EmailLog
from app.core.login_throttle import LoginAttempt
from app.models.invoice import Invoice
from app.models.job import Job
from app.models.notification import Notification
from app.models.photo import Photo
from app.models.platform_settings import PlatformSettings
from app.models.quote import Quote
from app.models.role import Role
from app.models.support_grant import SupportGrant
from app.models.user import User

logger = logging.getLogger(__name__)

#: MongoDB's error code for "index not found with name". Another worker got
#: there first, which is fine.
INDEX_NOT_FOUND = 27

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
    LoginAttempt,
    PlatformSettings,
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


def text_fields(pairs) -> set:
    """The fields a declared index searches as text, if any."""
    items = pairs.items() if hasattr(pairs, "items") else pairs
    return {field for field, direction in items if direction == "text"}


def same_index(declared_key, existing: dict) -> bool:
    """Whether the index in the database is already the one we declare.

    A text index cannot be compared by its key. MongoDB stores one internally as
    `[('_fts', 'text'), ('_ftsx', 1)]` whatever fields it covers, and lists the
    real fields under `weights` - so comparing keys says "changed" every single
    time, and the index gets dropped and rebuilt on every startup. On a large
    collection that is an expensive, silent, repeating rebuild.
    """
    declared_text = text_fields(declared_key)
    if declared_text:
        return declared_text == set((existing.get("weights") or {}).keys())
    return normalised_key(declared_key) == normalised_key(existing.get("key", []))


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

            if same_index(spec["key"], existing[name]):
                continue

            logger.warning(
                "Replacing index %s on %s: it no longer matches what the model declares",
                name,
                model.Settings.name,
            )
            try:
                await collection.drop_index(name)
            except OperationFailure as exc:
                # uvicorn runs several workers and each one runs this, so the
                # index may already be gone - dropped a moment ago by another
                # worker doing exactly the same thing. That is the desired end
                # state, not a failure. Anything else is re-raised.
                if exc.code != INDEX_NOT_FOUND:
                    raise
                logger.info("Index %s was already dropped by another worker", name)


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
