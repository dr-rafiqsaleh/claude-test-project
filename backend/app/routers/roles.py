"""Roles and permissions, for the team page. Needs 'Team and roles'."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.dependencies import require_permission
from app.core.permissions import ADMIN_ROLE, PERMISSION_GROUPS
from app.schemas.common import ApiResponse
from app.services import role_service
from app.services.role_service import RoleError, RoleNotFoundError

router = APIRouter(
    prefix="/api/v1/roles",
    tags=["roles"],
    dependencies=[Depends(require_permission("users.manage"))],
)


class RoleResponse(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    permissions: List[str] = Field(default_factory=list)
    is_system: bool = False
    editable: bool = True  # False for Admin, which always has everything
    user_count: int = 0


class RolesData(BaseModel):
    roles: List[RoleResponse]
    permission_groups: List[dict]


class RoleWrite(BaseModel):
    name: Optional[str] = Field(None, max_length=60)
    description: Optional[str] = Field(None, max_length=300)
    permissions: Optional[List[str]] = None


class RoleCreate(RoleWrite):
    name: str = Field(min_length=1, max_length=60)
    permissions: List[str] = Field(default_factory=list)


class RolesEnvelope(ApiResponse[RolesData]):
    pass


class RoleEnvelope(ApiResponse[RoleResponse]):
    pass


async def _response(role, counts=None) -> RoleResponse:
    counts = counts if counts is not None else await role_service.user_counts()
    return RoleResponse(
        key=role.key,
        name=role.name,
        description=role.description,
        permissions=sorted(await role_service.permissions_for_role(role.key)),
        is_system=role.is_system,
        editable=role.key != ADMIN_ROLE,
        user_count=counts.get(role.key, 0),
    )


def _refused(exc: Exception) -> HTTPException:
    code = status.HTTP_404_NOT_FOUND if isinstance(exc, RoleNotFoundError) else status.HTTP_400_BAD_REQUEST
    return HTTPException(status_code=code, detail=str(exc))


@router.get("", response_model=RolesEnvelope, summary="Every role, and every permission there is")
@router.get("/", response_model=RolesEnvelope, include_in_schema=False)
async def list_roles() -> RolesEnvelope:
    counts = await role_service.user_counts()
    roles = [await _response(role, counts) for role in await role_service.list_roles()]
    return RolesEnvelope(
        data=RolesData(roles=roles, permission_groups=PERMISSION_GROUPS),
        message=f"{len(roles)} role(s)",
        success=True,
    )


@router.post("", response_model=RoleEnvelope, status_code=status.HTTP_201_CREATED, summary="Create a role")
@router.post("/", response_model=RoleEnvelope, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_role(payload: RoleCreate) -> RoleEnvelope:
    try:
        role = await role_service.create_role(payload.name, payload.description, payload.permissions)
    except RoleError as exc:
        raise _refused(exc) from exc
    return RoleEnvelope(data=await _response(role), message=f"Role {role.name} created", success=True)


@router.put("/{key}", response_model=RoleEnvelope, summary="Change a role's name or permissions")
async def update_role(key: str, payload: RoleWrite) -> RoleEnvelope:
    try:
        role = await role_service.update_role(key, payload.name, payload.description, payload.permissions)
    except (RoleError, RoleNotFoundError) as exc:
        raise _refused(exc) from exc
    return RoleEnvelope(data=await _response(role), message=f"Role {role.name} saved", success=True)


@router.delete("/{key}", response_model=RoleEnvelope, summary="Delete a role nobody has")
async def delete_role(key: str) -> RoleEnvelope:
    try:
        role = await role_service.delete_role(key)
    except (RoleError, RoleNotFoundError) as exc:
        raise _refused(exc) from exc
    return RoleEnvelope(data=await _response(role, {}), message=f"Role {role.name} deleted", success=True)
