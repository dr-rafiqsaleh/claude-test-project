"""Which client the current request belongs to.

QKil serves several client companies from one database. Every record carries a
`client_id`, and every query is filtered by the client the signed-in person
belongs to. That filter is applied in one place - `TenantDocument` in
app.models.tenant - reading the client out of the context variable below, which
`resolve_user_from_token` sets once per request.

A context variable rather than a parameter threaded through 12 services: each
request runs in its own asyncio task, so each gets its own copy and nothing
leaks between them, and no query can forget to pass it along.

Platform staff (`client_id = None`) are deliberately unscoped: they read across
every client, which is what the platform pages are for. They cannot *create*
tenant records without first choosing a client, or the record would belong to
nobody - see `TenantDocument.insert`.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

from beanie import PydanticObjectId

#: The client whose data this request may touch. None means unscoped.
_current_client: ContextVar[Optional[PydanticObjectId]] = ContextVar(
    "qkil_current_client", default=None
)


class TenantScopeError(RuntimeError):
    """A record was about to be written without a client to own it."""


def current_client_id() -> Optional[PydanticObjectId]:
    return _current_client.get()


def set_current_client(client_id: Optional[PydanticObjectId]) -> object:
    """Set the request's client. Returns the token needed to undo it."""
    return _current_client.set(client_id)


def reset_current_client(token: object) -> None:
    _current_client.reset(token)


@contextmanager
def acting_as(client_id: Optional[PydanticObjectId]) -> Iterator[None]:
    """Run a block as one client. Used by scripts, seeds and platform routes."""
    token = _current_client.set(client_id)
    try:
        yield
    finally:
        _current_client.reset(token)


@contextmanager
def unscoped() -> Iterator[None]:
    """Run a block across every client.

    Only for work that is genuinely cross-client: finding the account behind a
    login before we know which client it is, the platform pages, and migrations.
    """
    with acting_as(None):
        yield


def tenant_filter() -> dict:
    """The query fragment that limits a read to the current client."""
    client_id = _current_client.get()
    return {} if client_id is None else {"client_id": client_id}


def require_client_id() -> PydanticObjectId:
    """The current client, or a refusal. For anything that writes."""
    client_id = _current_client.get()
    if client_id is None:
        raise TenantScopeError(
            "No client is in scope. Platform staff must choose a client "
            "(send it as the X-Client-Id header) before changing its records."
        )
    return client_id
