"""MongoDB connection and Beanie ODM initialisation."""

import logging
from typing import Optional

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import settings
from app.models.booking import Booking
from app.models.company_settings import CompanySettings
from app.models.counter import Counter
from app.models.customer import Customer
from app.models.invoice import Invoice
from app.models.job import Job
from app.models.notification import Notification
from app.models.photo import Photo
from app.models.quote import Quote
from app.models.user import User

logger = logging.getLogger(__name__)

DOCUMENT_MODELS = [
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
]

_client: Optional[AsyncIOMotorClient] = None


async def init_db(mongodb_url: Optional[str] = None, database_name: Optional[str] = None) -> AsyncIOMotorClient:
    """Create the Motor client and initialise Beanie with all document models."""
    global _client

    url = mongodb_url or settings.MONGODB_URL
    db_name = database_name or settings.DATABASE_NAME

    _client = AsyncIOMotorClient(url)
    await init_beanie(database=_client[db_name], document_models=DOCUMENT_MODELS)
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
