"""Roles and permissions: who may do what.

Permissions are looked up often (every request), so each role's are cached in
memory and the cache is cleared whenever a role changes.
"""

import re
from typing import Dict, FrozenSet, List, Optional

from app.core.permissions import ADMIN_ROLE, ALL_PERMISSIONS, DEFAULT_ROLES
from app.core.tenancy import TenantScopeError, current_client_id
from app.models.role import Role
from app.models.user import User


class RoleError(Exception):
    """A role change that can't be made, with the reason in plain English."""


class RoleNotFoundError(Exception):
    """No role with that key."""


#: Keyed by (client, role key): each client has its own roles, and its own
#: Office Staff may hold different permissions from another client's.
_cache: Dict[tuple, FrozenSet[str]] = {}
_names: Dict[tuple, str] = {}
#: Clients whose built-in roles we have already checked for.
_defaults_checked: set = set()


def _forget() -> None:
    _cache.clear()
    _names.clear()


async def ensure_default_roles() -> None:
    """Create any built-in role missing for this client. Cheap after the first call.

    Every client starts with the same three built-in roles and can then change
    them, so this seeds per client rather than once for the database.
    """
    client_id = current_client_id()
    if client_id in _defaults_checked:
        return
    for key, spec in DEFAULT_ROLES.items():
        if await Role.find_one({"key": key}) is None:
            await Role(key=key, is_system=True, **spec).insert()
    _defaults_checked.add(client_id)


async def list_roles() -> List[Role]:
    await ensure_default_roles()
    roles = await Role.find_all().to_list()
    order = list(DEFAULT_ROLES)
    return sorted(roles, key=lambda role: (order.index(role.key) if role.key in order else len(order), role.name.lower()))


async def get_role(key: str) -> Role:
    await ensure_default_roles()
    role = await Role.find_one({"key": key})
    if role is None:
        raise RoleNotFoundError(f"There's no role called '{key}'")
    return role


async def permissions_for_role(key: str) -> FrozenSet[str]:
    if key == ADMIN_ROLE:
        return ALL_PERMISSIONS
    cache_key = (current_client_id(), key)
    if cache_key not in _cache:
        try:
            role = await get_role(key)
        # TenantScopeError: PestBase platform staff, who belong to no client and so
        # have no client's roles to read. Holding no role's permissions is the
        # right answer for them - what they may do comes from is_platform_staff.
        except (RoleNotFoundError, TenantScopeError):
            return frozenset()
        _cache[cache_key] = frozenset(role.permissions) & ALL_PERMISSIONS
    return _cache[cache_key]


async def permissions_for(user: User) -> FrozenSet[str]:
    """Everything a person may do, from their role."""
    return await permissions_for_role(str(user.role))


async def has_permission(user: User, permission: str) -> bool:
    return permission in await permissions_for(user)


async def role_name(key: str) -> str:
    """A role's display name. Never raises - it is a label, not a decision.

    Falls back to a prettified key when the role cannot be read at all. That
    happens for PestBase platform staff: they belong to no client, so there is no
    client's role collection to look in, and a profile request of theirs must not
    fail over the wording of a badge.
    """
    cache_key = (current_client_id(), key)
    if cache_key not in _names:
        try:
            _names[cache_key] = (await get_role(key)).name
        except (RoleNotFoundError, TenantScopeError):
            _names[cache_key] = key.replace("_", " ").title()
    return _names[cache_key]


async def roles_with(permission: str) -> List[str]:
    """The keys of every role holding a permission."""
    return [role.key for role in await list_roles() if permission in await permissions_for_role(role.key)]


async def user_counts() -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for user in await User.find_all().to_list():
        counts[str(user.role)] = counts.get(str(user.role), 0) + 1
    return counts


def _clean_permissions(permissions: List[str]) -> List[str]:
    unknown = sorted(set(permissions) - ALL_PERMISSIONS)
    if unknown:
        raise RoleError(f"Unknown permission(s): {', '.join(unknown)}")
    return sorted(set(permissions))


def _key_for(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return key or "role"


async def create_role(name: str, description: Optional[str], permissions: List[str]) -> Role:
    await ensure_default_roles()
    name = name.strip()
    if not name:
        raise RoleError("A role needs a name")
    if any(role.name.lower() == name.lower() for role in await list_roles()):
        raise RoleError(f"There's already a role called {name}")

    base = _key_for(name)
    key, suffix = base, 2
    while await Role.find_one({"key": key}) is not None:
        key, suffix = f"{base}_{suffix}", suffix + 1

    role = Role(key=key, name=name, description=description, permissions=_clean_permissions(permissions))
    await role.insert()
    _forget()
    return role


async def update_role(
    key: str,
    name: Optional[str] = None,
    description: Optional[str] = None,
    permissions: Optional[List[str]] = None,
) -> Role:
    role = await get_role(key)
    if role.key == ADMIN_ROLE:
        raise RoleError("The Admin role always has every permission, so it can't be changed")

    if name is not None and name.strip() and name.strip() != role.name:
        if role.is_system:
            raise RoleError("Built-in roles keep their names; create a new role instead")
        if any(other.name.lower() == name.strip().lower() and other.key != key for other in await list_roles()):
            raise RoleError(f"There's already a role called {name.strip()}")
        role.name = name.strip()
    if description is not None:
        role.description = description.strip() or None
    if permissions is not None:
        role.permissions = _clean_permissions(permissions)

    role.touch()
    await role.save()
    _forget()
    return role


async def delete_role(key: str) -> Role:
    role = await get_role(key)
    if role.is_system:
        raise RoleError("Built-in roles can't be deleted")
    in_use = await User.find({"role": key}).count()
    if in_use:
        people = "person has" if in_use == 1 else "people have"
        raise RoleError(f"{in_use} {people} this role. Give them another role first")
    await role.delete()
    _forget()
    return role
