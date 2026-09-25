"""POST /api/v1/contact - the public website's contact form. No sign-in."""

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.common import ApiResponse
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
