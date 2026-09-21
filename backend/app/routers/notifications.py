"""Notification routes.

Every route is scoped to the signed-in user - there is no way to read or touch
somebody else's notifications.

Listing them also kicks off `sweep_notifications()` as a background task, which
is how reminders get generated without a scheduler.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.notification import (
    MarkAllReadData,
    MarkAllReadResponse,
    NotificationEnvelope,
    NotificationListData,
    NotificationListResponse,
    NotificationResponse,
    UnreadCountData,
    UnreadCountResponse,
)
from app.services import notification_service
from app.services.notification_service import build_notification_payload

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse, summary="List notifications")
@router.get("/", response_model=NotificationListResponse, include_in_schema=False)
async def list_notifications(
    background_tasks: BackgroundTasks,
    unread_only: bool = Query(False, description="Only return unread notifications"),
    limit: int = Query(50, ge=1, le=200, description="Maximum notifications to return"),
    current_user: User = Depends(get_current_user),
) -> NotificationListResponse:
    """Return the current user's notifications, newest first."""
    notifications = await notification_service.get_notifications(
        current_user.id,
        unread_only=unread_only,
        limit=limit,
    )
    unread = await notification_service.get_unread_count(current_user.id)

    # Generate any new reminders after the response has gone out.
    background_tasks.add_task(notification_service.sweep_notifications)

    return NotificationListResponse(
        data=NotificationListData(
            items=[
                NotificationResponse.model_validate(build_notification_payload(item))
                for item in notifications
            ],
            total=len(notifications),
            unread_count=unread,
        ),
        message=f"{len(notifications)} notification(s) found",
        success=True,
    )


# Declared before /{notification_id} so "unread-count" is never read as an id.
@router.get(
    "/unread-count",
    response_model=UnreadCountResponse,
    summary="Count unread notifications",
)
async def unread_count(
    current_user: User = Depends(get_current_user),
) -> UnreadCountResponse:
    """How many unread notifications the current user has."""
    count = await notification_service.get_unread_count(current_user.id)
    return UnreadCountResponse(
        data=UnreadCountData(count=count),
        message=f"{count} unread notification(s)",
        success=True,
    )


# Declared before /{notification_id}/read so "read-all" is never read as an id.
@router.patch(
    "/read-all",
    response_model=MarkAllReadResponse,
    summary="Mark every notification as read",
)
async def mark_all_read(
    current_user: User = Depends(get_current_user),
) -> MarkAllReadResponse:
    """Clear the unread badge in one go."""
    updated = await notification_service.mark_all_read(current_user.id)
    return MarkAllReadResponse(
        data=MarkAllReadData(updated=updated),
        message=f"{updated} notification(s) marked as read",
        success=True,
    )


@router.patch(
    "/{notification_id}/read",
    response_model=NotificationEnvelope,
    summary="Mark one notification as read",
)
async def mark_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
) -> NotificationEnvelope:
    """Mark a single notification as read."""
    notification = await notification_service.mark_read(notification_id, current_user.id)
    if notification is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    return NotificationEnvelope(
        data=NotificationResponse.model_validate(build_notification_payload(notification)),
        message="Notification marked as read",
        success=True,
    )


@router.delete(
    "/{notification_id}",
    response_model=NotificationEnvelope,
    summary="Delete a notification",
)
async def delete_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user),
) -> NotificationEnvelope:
    """Permanently remove one of the current user's notifications."""
    deleted = await notification_service.delete_notification(notification_id, current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    return NotificationEnvelope(
        data=None,
        message="Notification deleted",
        success=True,
    )
