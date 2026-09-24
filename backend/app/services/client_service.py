"""Client companies: the platform's own list of who uses QKil."""

import re
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.core.tenancy import acting_as, unscoped
from app.models.client import Client, ClientStatus
from app.models.user import User
from app.services import audit_service


#: How long QKil can work in a client it has just created, to set it up.
SETUP_GRANT_HOURS = 72


class ClientError(Exception):
    """A change that can't be made, with the reason in plain English."""


class ClientNotFoundError(Exception):
    """No client with that id."""


class ClientUnavailableError(Exception):
    """The client exists but is suspended or closed."""


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "client"


async def _unique_slug(name: str) -> str:
    base = _slugify(name)
    slug, suffix = base, 2
    while await Client.find_one({"slug": slug}) is not None:
        slug, suffix = f"{base}-{suffix}", suffix + 1
    return slug


async def get_client(client_id: "PydanticObjectId | str") -> Client:
    try:
        oid = PydanticObjectId(str(client_id))
    except Exception:  # noqa: BLE001 - a malformed id is simply not found
        raise ClientNotFoundError("Client not found") from None
    client = await Client.get(oid)
    if client is None:
        raise ClientNotFoundError("Client not found")
    return client


async def assert_usable(client_id: Optional[PydanticObjectId]) -> None:
    """Refuse a sign-in for a client that has been suspended or closed.

    Platform staff belong to no client, so `None` passes: there is no client
    account to switch off.
    """
    if client_id is None:
        return
    try:
        client = await get_client(client_id)
    except ClientNotFoundError:
        raise ClientUnavailableError("This account's client no longer exists") from None
    if not client.is_usable:
        raise ClientUnavailableError(
            "Access for this company is suspended. Contact QKil support."
        )


async def list_clients(
    page: int = 1,
    page_size: int = 20,
    status: Optional[ClientStatus] = None,
    q: Optional[str] = None,
) -> Tuple[List[Client], int]:
    criteria: dict = {}
    if status is not None:
        criteria["status"] = status.value
    if q and q.strip():
        escaped = re.escape(q.strip())
        criteria["$or"] = [
            {"name": {"$regex": escaped, "$options": "i"}},
            {"slug": {"$regex": escaped, "$options": "i"}},
            {"contact_email": {"$regex": escaped, "$options": "i"}},
        ]

    query = Client.find(criteria) if criteria else Client.find_all()
    total = await query.count()
    skip = max(page - 1, 0) * page_size
    clients = await query.sort("name").skip(skip).limit(page_size).to_list()
    return clients, total


async def user_counts() -> dict:
    """How many people each client has, for the client list."""
    counts: dict = {}
    with unscoped():
        for user in await User.find({"client_id": {"$ne": None}}).to_list():
            key = str(user.client_id)
            counts[key] = counts.get(key, 0) + 1
    return counts


async def create_client(
    name: str,
    contact_email: Optional[str] = None,
    contact_phone: Optional[str] = None,
    notes: Optional[str] = None,
    actor: Optional[User] = None,
) -> Client:
    """Add a client and give it the three built-in roles to start from."""
    name = (name or "").strip()
    if not name:
        raise ClientError("A client needs a name")
    if await Client.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}):
        raise ClientError(f"There's already a client called {name}")

    client = Client(
        name=name,
        slug=await _unique_slug(name),
        contact_email=(contact_email or "").strip() or None,
        contact_phone=(contact_phone or "").strip() or None,
        notes=(notes or "").strip() or None,
    )
    await client.insert()

    # Seed the new client's roles inside its own scope, so Admin, Office Staff
    # and Technician exist before anyone is invited into it.
    from app.services import role_service  # noqa: PLC0415 - avoids a cycle

    with acting_as(client.id):
        await role_service.ensure_default_roles()
        await audit_service.record(
            "client.created",
            actor=actor,
            resource_type="client",
            resource_id=client.id,
            resource_name=client.name,
        )

    # A brand-new client has nobody in it, so there is nobody who could let us
    # in to create their first administrator. Setting one up is the expected
    # next step, so creating the client opens a short window for it - recorded
    # like any other grant, and expiring like any other, so it cannot quietly
    # become standing access.
    from app.services import support_access_service  # noqa: PLC0415 - avoids a cycle

    await support_access_service.grant(
        client.id,
        granted_by=actor,
        hours=SETUP_GRANT_HOURS,
        reason="Setting up a new client: creating its first administrator.",
    )

    return client


async def update_client(
    client_id: "PydanticObjectId | str",
    name: Optional[str] = None,
    contact_email: Optional[str] = None,
    contact_phone: Optional[str] = None,
    notes: Optional[str] = None,
    status: Optional[ClientStatus] = None,
    actor: Optional[User] = None,
) -> Client:
    client = await get_client(client_id)
    was = client.status

    if name is not None and name.strip() and name.strip() != client.name:
        cleaned = name.strip()
        clash = await Client.find_one(
            {"name": {"$regex": f"^{re.escape(cleaned)}$", "$options": "i"}}
        )
        if clash is not None and clash.id != client.id:
            raise ClientError(f"There's already a client called {cleaned}")
        client.name = cleaned
    if contact_email is not None:
        client.contact_email = contact_email.strip() or None
    if contact_phone is not None:
        client.contact_phone = contact_phone.strip() or None
    if notes is not None:
        client.notes = notes.strip() or None
    if status is not None:
        client.status = status

    client.touch()
    await client.save()

    # Suspending or resuming a client decides whether their whole team can work,
    # so it goes on their own trail rather than only ours.
    with acting_as(client.id):
        await audit_service.record(
            "client.status_changed" if status is not None and status != was else "client.updated",
            actor=actor,
            resource_type="client",
            resource_id=client.id,
            resource_name=client.name,
            metadata={"from": was.value, "to": client.status.value} if status is not None else {},
        )
    return client


async def delete_client(client_id: "PydanticObjectId | str") -> Client:
    """Remove a client that never got going.

    A client with people in it keeps its records - suspend or close it instead,
    so nothing that happened to its customers is quietly thrown away.
    """
    client = await get_client(client_id)
    with unscoped():
        people = await User.find({"client_id": client.id}).count()
    if people:
        raise ClientError(
            f"{client.name} has {people} user(s). Suspend or close the client instead."
        )
    await client.delete()
    return client
