"""Who is signed in, and signing out.

Signing *in* is not here: SuperTokens serves it at AUTH_API_BASE_PATH (/auth by
default), and app.core.supertokens decides who is allowed through. What is left
for PestBase is the profile the portal needs and ending a session.
"""

import logging

from fastapi import APIRouter, Depends, Request
from supertokens_python.recipe.session import SessionContainer

from app.core.dependencies import get_current_user, _verified_session
from app.core.supertokens import end_all_sessions
from app.models.user import User
from app.schemas.user import UserResponseEnvelope, UserResponse
from app.services import user_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.get("/me", response_model=UserResponseEnvelope, summary="Get the currently authenticated user")
async def read_current_user(
    current_user: User = Depends(get_current_user),
) -> UserResponseEnvelope:
    """The signed-in user, with their role's permissions.

    The portal calls this on load and after anything that changes what the person
    may do, because the menus and buttons are drawn from `permissions`.
    """
    return UserResponseEnvelope(
        data=UserResponse.model_validate(
            await user_service.user_payload(current_user, with_permissions=True)
        ),
        message="Current user retrieved",
        success=True,
    )


@router.post("/sign-out", summary="Sign out of this device")
async def sign_out(session: SessionContainer = Depends(_verified_session)) -> dict:
    """End this session.

    SuperTokens' own /auth/signout does the same thing and the portal's SDK calls
    it; this exists for anything speaking to the API directly.
    """
    await session.revoke_session()
    return {"data": None, "message": "Signed out", "success": True}


@router.post("/sign-out-everywhere", summary="Sign out of every device")
async def sign_out_everywhere(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> dict:
    """End every session this account has, on every device.

    What you want after losing a phone, which is a real risk for technicians.
    """
    await end_all_sessions(current_user.auth_user_id)
    return {"data": None, "message": "Signed out on every device", "success": True}
