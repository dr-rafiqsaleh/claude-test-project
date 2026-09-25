"""Which client the current request belongs to.

PestBase serves several client companies from one database. Every record carries a
`client_id`, and every query is filtered by the client the signed-in person
belongs to. That filter is applied in one place - `TenantDocument` in
app.models.tenant - reading the client out of the context variable below, which
`session_user` sets once per request.

A context variable rather than a parameter threaded through 12 services: each
request runs in its own asyncio task, so each gets its own copy and nothing
leaks between them, and no query can forget to pass it along.

There are three states, not two:

  a client id  an ordinary request. Every query is limited to that client.
  DENIED       platform staff who have not said which client they are working
               in. Client-scoped queries refuse rather than returning a mix of
               everybody's records, so a support session is always attributable
               to one client - which is what makes the audit trail worth having.
  None         genuinely cross-client work: finding the account behind a login
               before we know its client, migrations, seeds. Only ever entered
               deliberately, through `unscoped()`.

DENIED, not None, is the default for platform staff. Reading every client's
customers at once was never a thing support needs, and it left nothing for a
client to be told about afterwards.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

from beanie import PydanticObjectId

class _Denied:
    """Marker for "no client chosen, so no client's records"."""

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "DENIED"


#: Platform staff who have not chosen a client. See the module docstring.
DENIED = _Denied()

#: The client whose data this request may touch.
_current_client: ContextVar[object] = ContextVar("pestbase_current_client", default=None)


class TenantScopeError(RuntimeError):
    """A record was about to be written without a client to own it."""


def current_client_id() -> Optional[PydanticObjectId]:
    """The client in scope, or None when unscoped. DENIED also reads as None.

    Callers that must tell "no client" from "no client chosen" use
    `tenant_filter()`, which refuses for DENIED.
    """
    value = _current_client.get()
    return None if isinstance(value, _Denied) else value


def is_denied() -> bool:
    return isinstance(_current_client.get(), _Denied)


def set_current_client(client_id: object) -> object:
    """Set the request's client, or DENIED. Returns the token needed to undo it."""
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
    """The query fragment that limits a read to the current client.

    Refuses outright when no client has been chosen but one is required: that
    is a platform admin reaching for client records without saying whose, and
    answering it would be both a privacy problem and unauditable.
    """
    value = _current_client.get()
    if isinstance(value, _Denied):
        raise TenantScopeError(
            "Choose which client you are working in first (send it as the "
            "X-Client-Id header). PestBase staff do not read every client at once."
        )
    return {} if value is None else {"client_id": value}


def require_client_id() -> PydanticObjectId:
    """The current client, or a refusal. For anything that writes."""
    client_id = current_client_id()
    if client_id is None:
        raise TenantScopeError(
            "No client is in scope. Platform staff must choose a client "
            "(send it as the X-Client-Id header) before changing its records."
        )
    return client_id
