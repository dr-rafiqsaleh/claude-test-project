"""The public website's contact form, and the list platform staff answer it from.

POST /api/v1/contact is open to anyone - no sign-in. Everything under
/api/v1/contact/enquiries is for PestBase platform staff only.
"""

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.config import settings
from app.core.dependencies import require_platform_staff
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData
from app.services import contact_service

router = APIRouter(prefix="/api/v1/contact", tags=["contact"])


class ContactRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    company: Optional[str] = Field(None, max_length=160)
    phone: Optional[str] = Field(None, max_length=40)
    topic: Literal["demo", "sales", "support", "privacy", "other"] = "other"
    message: str = Field(..., min_length=10, max_length=5000)
    #: The honeypot: hidden from people, so only a bot fills it in.
    website: Optional[str] = Field(None, max_length=200)

    @field_validator("name", "company", "phone")
    @classmethod
    def _one_line(cls, value: Optional[str]) -> Optional[str]:
        # These end up in the email's subject and headers: no line breaks.
        return " ".join(value.split()) or None if value else None

    @field_validator("message")
    @classmethod
    def _tidy(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value else None


def _client_ip(request: Request) -> Optional[str]:
    """The visitor's address. Behind nginx it arrives in X-Real-IP."""
    forwarded = request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip()
    return ip or (request.client.host if request.client else None)


@router.post("", response_model=ApiResponse[None], status_code=status.HTTP_201_CREATED)
async def send_enquiry(payload: ContactRequest, request: Request) -> ApiResponse[None]:
    thanks = "Thanks - we've got your message and will reply by email."

    # A bot filled in the hidden field: say thank you and keep nothing, so it
    # learns nothing about what gave it away.
    if payload.website:
        return ApiResponse(message=thanks)

    if not payload.name or not payload.message:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please add your name and a message.")

    try:
        await contact_service.submit(
            payload.model_dump(exclude={"website"}),
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    except contact_service.ContactRateLimitError:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "You've sent several messages in a short time. Please try again later, or email us.",
        )
    return ApiResponse(message=thanks)


# ---------------------------------------------------------------------------
# Platform staff: the enquiries inbox
# ---------------------------------------------------------------------------


class EnquiryResponse(BaseModel):
    id: str
    name: str
    email: str
    company: Optional[str] = None
    phone: Optional[str] = None
    topic: str
    topic_label: str
    message: str
    emailed: bool
    email_error: Optional[str] = None
    created_at: datetime
    handled_at: Optional[datetime] = None
    handled_by_name: Optional[str] = None


class EnquiryListData(PaginatedData[EnquiryResponse]):
    open_count: int = 0


class HandledUpdate(BaseModel):
    handled: bool


def _enquiry(enquiry) -> EnquiryResponse:
    return EnquiryResponse(
        id=str(enquiry.id),
        name=enquiry.name,
        email=enquiry.email,
        company=enquiry.company,
        phone=enquiry.phone,
        topic=enquiry.topic,
        topic_label=contact_service.TOPICS.get(enquiry.topic, enquiry.topic),
        message=enquiry.message,
        emailed=enquiry.emailed,
        email_error=enquiry.email_error,
        created_at=enquiry.created_at,
        handled_at=enquiry.handled_at,
        handled_by_name=enquiry.handled_by_name,
    )


def _not_found(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))


@router.get(
    "/enquiries",
    response_model=ApiResponse[EnquiryListData],
    summary="Website enquiries (platform staff)",
    dependencies=[Depends(require_platform_staff)],
)
async def list_enquiries(
    page: int = Query(1, ge=1),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    enquiry_status: Optional[Literal["open", "handled"]] = Query(None, alias="status"),
) -> ApiResponse[EnquiryListData]:
    items, total = await contact_service.list_enquiries(page, page_size, enquiry_status)
    return ApiResponse(
        data=EnquiryListData(
            items=[_enquiry(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
            open_count=await contact_service.count_open(),
        ),
        message=f"{total} enquiry(ies) found",
    )


@router.patch(
    "/enquiries/{enquiry_id}",
    response_model=ApiResponse[EnquiryResponse],
    summary="Mark an enquiry handled, or open it again",
)
async def update_enquiry(
    enquiry_id: str,
    payload: HandledUpdate,
    current_user: User = Depends(require_platform_staff),
) -> ApiResponse[EnquiryResponse]:
    try:
        enquiry = await contact_service.set_handled(enquiry_id, payload.handled, current_user)
    except contact_service.EnquiryNotFoundError as exc:
        raise _not_found(exc)
    return ApiResponse(
        data=_enquiry(enquiry),
        message="Marked as handled" if payload.handled else "Opened again",
    )


@router.post(
    "/enquiries/{enquiry_id}/resend",
    response_model=ApiResponse[EnquiryResponse],
    summary="Email an enquiry to the inbox again",
    dependencies=[Depends(require_platform_staff)],
)
async def resend_enquiry(enquiry_id: str) -> ApiResponse[EnquiryResponse]:
    try:
        enquiry = await contact_service.resend(enquiry_id)
    except contact_service.EnquiryNotFoundError as exc:
        raise _not_found(exc)
    if not enquiry.emailed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Still couldn't email it: {enquiry.email_error}",
        )
    return ApiResponse(data=_enquiry(enquiry), message=f"Emailed to {settings.CONTACT_INBOX}")
