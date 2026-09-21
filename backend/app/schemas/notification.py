"""Notification request/response schemas."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.models.notification import NotificationType
from app.schemas.common import ApiResponse


class NotificationResponse(BaseModel):
    """One notification as returned to the client."""

    id: str
    type: NotificationType
    category: str = "system"
    title: str
    message: str
    link: Optional[str] = None
    related_id: Optional[str] = None
    related_type: Optional[str] = None
    is_read: bool = False
    created_at: datetime


class NotificationListData(BaseModel):
    """List payload, with the unread count so the bell badge stays in sync."""

    items: List[NotificationResponse] = Field(default_factory=list)
    total: int = 0
    unread_count: int = 0


class NotificationListResponse(ApiResponse[NotificationListData]):
    """Envelope for GET /api/v1/notifications."""


class UnreadCountData(BaseModel):
    """Payload for the unread-count endpoint."""

    count: int = 0


class UnreadCountResponse(ApiResponse[UnreadCountData]):
    """Envelope for GET /api/v1/notifications/unread-count."""


class NotificationEnvelope(ApiResponse[Optional[NotificationResponse]]):
    """Envelope for single-notification operations."""


class MarkAllReadData(BaseModel):
    """How many notifications a bulk operation touched."""

    updated: int = 0


class MarkAllReadResponse(ApiResponse[MarkAllReadData]):
    """Envelope for PATCH /api/v1/notifications/read-all."""
