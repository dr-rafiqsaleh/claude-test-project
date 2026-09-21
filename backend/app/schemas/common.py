"""Shared response envelope schemas."""

from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """Standard API envelope: {"data": ..., "message": ..., "success": bool}."""

    data: Optional[T] = None
    message: str = ""
    success: bool = True


class PaginatedData(BaseModel, Generic[T]):
    """Paginated payload placed inside the `data` field of an ApiResponse."""

    items: List[T] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20

    @property
    def total_pages(self) -> int:
        if self.page_size <= 0:
            return 0
        return (self.total + self.page_size - 1) // self.page_size


def success_response(data: object = None, message: str = "") -> dict:
    """Build a plain-dict success envelope."""
    return {"data": data, "message": message, "success": True}


def error_response(message: str, data: object = None) -> dict:
    """Build a plain-dict error envelope."""
    return {"data": data, "message": message, "success": False}
