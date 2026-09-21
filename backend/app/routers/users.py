"""User management routes (admin only)."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import settings
from app.core.dependencies import require_admin
from app.models.user import User, UserRole
from app.schemas.user import (
    UserCreate,
    UserListData,
    UserListResponse,
    UserResponse,
    UserResponseEnvelope,
    UserUpdate,
)
from app.services import user_service
from app.services.user_service import UserAlreadyExistsError, UserNotFoundError

router = APIRouter(prefix="/api/v1/users", tags=["users"], dependencies=[Depends(require_admin)])


@router.get("", response_model=UserListResponse, summary="List users")
@router.get("/", response_model=UserListResponse, include_in_schema=False)
async def list_users(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    role: Optional[UserRole] = Query(None, description="Filter by role"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    q: Optional[str] = Query(None, description="Search name or email"),
) -> UserListResponse:
    """Return a paginated list of users."""
    users, total = await user_service.list_users(
        page=page,
        page_size=page_size,
        role=role,
        is_active=is_active,
        q=q,
    )

    return UserListResponse(
        data=UserListData(
            items=[UserResponse.model_validate(u) for u in users],
            total=total,
            page=page,
            page_size=page_size,
        ),
        message=f"{total} user(s) found",
        success=True,
    )


@router.post("", response_model=UserResponseEnvelope, status_code=status.HTTP_201_CREATED, summary="Create a user")
@router.post("/", response_model=UserResponseEnvelope, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_user(payload: UserCreate) -> UserResponseEnvelope:
    """Create a new staff account."""
    try:
        user = await user_service.create_user(payload)
    except UserAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return UserResponseEnvelope(
        data=UserResponse.model_validate(user),
        message="User created successfully",
        success=True,
    )


@router.get("/{user_id}", response_model=UserResponseEnvelope, summary="Get a user by id")
async def get_user(user_id: str) -> UserResponseEnvelope:
    """Fetch a single user."""
    user = await user_service.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return UserResponseEnvelope(
        data=UserResponse.model_validate(user),
        message="User retrieved",
        success=True,
    )


@router.put("/{user_id}", response_model=UserResponseEnvelope, summary="Update a user")
async def update_user(
    user_id: str,
    payload: UserUpdate,
    current_user: User = Depends(require_admin),
) -> UserResponseEnvelope:
    """Update a user's details, role or status."""
    target = await user_service.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    demoting_self = str(target.id) == str(current_user.id) and (
        (payload.role is not None and payload.role != UserRole.ADMIN)
        or payload.is_active is False
    )
    if demoting_self:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot remove your own admin access",
        )

    if target.role == UserRole.ADMIN and (
        (payload.role is not None and payload.role != UserRole.ADMIN) or payload.is_active is False
    ):
        if await user_service.count_active_admins() <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one active admin account must remain",
            )

    try:
        user = await user_service.update_user(user_id, payload)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except UserAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return UserResponseEnvelope(
        data=UserResponse.model_validate(user),
        message="User updated successfully",
        success=True,
    )


@router.delete("/{user_id}", response_model=UserResponseEnvelope, summary="Deactivate a user")
async def deactivate_user(
    user_id: str,
    current_user: User = Depends(require_admin),
) -> UserResponseEnvelope:
    """Soft-delete a user by deactivating the account."""
    if str(user_id) == str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )

    target = await user_service.get_user_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.role == UserRole.ADMIN and await user_service.count_active_admins() <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one active admin account must remain",
        )

    try:
        user = await user_service.deactivate_user(user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return UserResponseEnvelope(
        data=UserResponse.model_validate(user),
        message="User deactivated successfully",
        success=True,
    )
