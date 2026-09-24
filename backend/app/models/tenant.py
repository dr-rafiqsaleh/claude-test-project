"""The base class that keeps one client's records away from another's.

Every collection that belongs to a client extends `TenantDocument` instead of
Beanie's `Document`. The read methods add the current client to the query and
the write methods stamp it on, so a service does not have to remember either -
there is no per-query filter to forget, which is the usual way multi-tenant
apps leak.

Raw driver calls bypass this (`get_motor_collection`), so the handful of places
that use one merge `tenant_filter()` into the query themselves.
"""

from typing import Any, Optional, Sequence

from beanie import Document, PydanticObjectId
from pydantic import Field

from app.core.tenancy import current_client_id, require_client_id, tenant_filter


class TenantDocument(Document):
    """A document owned by one client."""

    client_id: Optional[PydanticObjectId] = Field(default=None)

    # -- reads --------------------------------------------------------------

    @classmethod
    def _scoped(cls, args: Sequence[Any]) -> tuple:
        """The caller's query arguments, with the current client added."""
        scope = tenant_filter()
        return (*args, scope) if scope else tuple(args)

    @classmethod
    def find(cls, *args: Any, **kwargs: Any):
        return super().find(*cls._scoped(args), **kwargs)

    @classmethod
    def find_many(cls, *args: Any, **kwargs: Any):
        return super().find_many(*cls._scoped(args), **kwargs)

    @classmethod
    def find_one(cls, *args: Any, **kwargs: Any):
        return super().find_one(*cls._scoped(args), **kwargs)

    @classmethod
    def find_all(cls, *args: Any, **kwargs: Any):
        # Beanie's find_all takes no query, so the scope is the whole query.
        return super().find(*cls._scoped(()), *args, **kwargs)

    @classmethod
    async def get(cls, document_id: Any, **kwargs: Any):
        """Fetch by id, but only if it belongs to the client in scope.

        Someone else's id reads as "not found", which is what a caller should
        see: whether that record exists is not their business.
        """
        document = await super().get(document_id, **kwargs)
        if document is None:
            return None
        client_id = current_client_id()
        if client_id is not None and document.client_id != client_id:
            return None
        return document

    # -- writes -------------------------------------------------------------

    def _stamp(self, required: bool) -> None:
        if self.client_id is not None:
            return
        self.client_id = require_client_id() if required else current_client_id()

    async def insert(self, **kwargs: Any):
        # A new record with no owner would belong to nobody and show up for
        # everybody, so this refuses rather than writing it.
        self._stamp(required=True)
        return await super().insert(**kwargs)

    async def save(self, **kwargs: Any):
        # An existing record keeps its owner; only a gap gets filled, and a
        # missing scope is left alone so migrations and scripts still work.
        self._stamp(required=False)
        return await super().save(**kwargs)

    @classmethod
    async def insert_many(cls, documents: list, **kwargs: Any):
        client_id = require_client_id()
        for document in documents:
            if document.client_id is None:
                document.client_id = client_id
        return await super().insert_many(documents, **kwargs)
