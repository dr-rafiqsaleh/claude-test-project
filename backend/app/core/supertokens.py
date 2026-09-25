"""Sign-in, through SuperTokens, without passwords.

Somebody asks to sign in, PestBase emails them a link and a six-digit code, and
using either one starts a session. There is no password to reset, forget, reuse
or leak.

SuperTokens owns the credential side: it stores the auth user, sends the code,
and keeps the session cookies. PestBase still owns everything about *who* that
person is - their client, role and permissions - and the two are joined by
`auth_user_id` on the PestBase user.

Two overrides carry all the PestBase-specific behaviour, and both matter:

  create_code_post   refuses before an email is sent unless the address belongs
                     to an active PestBase account at a usable client. Without this,
                     anybody could make PestBase email anybody.
  consume_code_post  refuses after the code is right but before the session is
                     kept, if the account has since been deactivated, its client
                     suspended, or the identity already belongs to someone else.

Ported from ServiceRecord's modules/identity/supertokens.py, which runs this in
production. Left behind: reCAPTCHA (PestBase has no site key), and the MFA and TOTP
recipes, which need an enterprise licence on the core - the hooks are noted
below so they can be added without rework.
"""

import logging
from typing import Any, Optional

from supertokens_python import InputAppInfo, Supertokens, SupertokensConfig, init
from supertokens_python.ingredients.emaildelivery.types import (
    EmailDeliveryConfig,
    SMTPSettings,
    SMTPSettingsFrom,
)
from supertokens_python.recipe import passwordless, session
from supertokens_python.recipe.passwordless import (
    ContactEmailOnlyConfig,
    PasswordlessOverrideConfig,
)
from supertokens_python.recipe.passwordless.emaildelivery.services.smtp import SMTPService
from supertokens_python.recipe.passwordless.interfaces import ConsumeCodePostOkResult
from supertokens_python.types.response import GeneralErrorResponse

from app.config import settings
from app.core import login_throttle

logger = logging.getLogger(__name__)

#: Deliberately the same message whether the address is unknown, deactivated or
#: belongs to a suspended client. Telling a stranger which of those it is turns
#: the sign-in form into a way to find out who has a PestBase account.
ACCESS_DENIED = "This account cannot sign in. Please contact your administrator."


def _normalise(email: Optional[str]) -> str:
    return (email or "").strip().lower()


async def signed_in_user(email: str):
    """The PestBase account behind an address, if it may sign in at all.

    Checks the account is active and its client is not suspended - the same two
    questions the request path asks, asked once before any email goes out.
    """
    from app.core.tenancy import unscoped  # noqa: PLC0415 - avoids a cycle
    from app.models.user import User
    from app.services import client_service

    address = _normalise(email)
    if not address:
        return None

    # Unscoped on purpose: which client this address belongs to is what we are
    # about to find out.
    with unscoped():
        user = await User.find_one({"email": address})
    if user is None or not user.is_active:
        return None

    try:
        await client_service.assert_usable(user.client_id)
    except client_service.ClientUnavailableError:
        return None

    # Not platform staff and in no client means an unmigrated database; refusing
    # is the safe reading. See app.core.dependencies for the same check.
    if user.client_id is None and not user.is_platform_staff:
        return None
    return user


async def bind_identity(user, auth_user_id: str) -> bool:
    """Tie a PestBase account to its SuperTokens identity. False if it cannot be.

    The first sign-in records the id. Later ones check it still matches: a
    PestBase account that already belongs to one auth identity must never be
    reachable through a second, or two people could end up sharing an account.
    """
    from app.core.tenancy import unscoped  # noqa: PLC0415

    existing = getattr(user, "auth_user_id", None)
    if existing == auth_user_id:
        return True
    if existing:
        logger.warning(
            "AUTH_IDENTITY_CONFLICT | user=%s | had=%s | offered=%s",
            user.email,
            existing,
            auth_user_id,
        )
        return False

    user.auth_user_id = auth_user_id
    user.touch()
    with unscoped():
        await user.save()
    return True


async def record_login(user) -> None:
    """Stamp when somebody last signed in. Never raises.

    Useful for spotting an account nobody uses any more, and it must not be able
    to turn a good sign-in into a failed one.
    """
    from datetime import datetime  # noqa: PLC0415
    from app.core.tenancy import unscoped  # noqa: PLC0415

    try:
        user.last_login_at = datetime.utcnow()
        with unscoped():
            await user.save()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not record the sign-in for %s: %s", user.email, exc)


def _passwordless_overrides():
    def apis(original):
        original_create_code = original.create_code_post
        original_consume_code = original.consume_code_post

        async def create_code_post(
            email,
            phone_number,
            session,  # noqa: A002 - the SDK's parameter name
            should_try_linking_with_session_user,
            tenant_id,
            api_options,
            user_context,
        ):
            address = _normalise(email)

            allowed = await login_throttle.allow(
                address,
                max_attempts=settings.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
                window_seconds=settings.AUTH_RATE_LIMIT_WINDOW_SECONDS,
            )
            if not allowed:
                logger.warning("AUTH_RATE_LIMITED | email=%s", address)
                return GeneralErrorResponse("Too many attempts. Please try again in a few minutes.")

            if await signed_in_user(address) is None:
                # Refused before SuperTokens sends anything.
                logger.warning("AUTH_REFUSED | operation=create_code | email=%s", address)
                return GeneralErrorResponse(ACCESS_DENIED)

            return await original_create_code(
                email=address,
                phone_number=phone_number,
                session=session,
                should_try_linking_with_session_user=should_try_linking_with_session_user,
                tenant_id=tenant_id,
                api_options=api_options,
                user_context=user_context,
            )

        async def consume_code_post(
            pre_auth_session_id,
            user_input_code,
            device_id,
            link_code,
            session,  # noqa: A002 - the SDK's parameter name
            should_try_linking_with_session_user,
            tenant_id,
            api_options,
            user_context,
        ):
            result = await original_consume_code(
                pre_auth_session_id=pre_auth_session_id,
                user_input_code=user_input_code,
                device_id=device_id,
                link_code=link_code,
                session=session,
                should_try_linking_with_session_user=should_try_linking_with_session_user,
                tenant_id=tenant_id,
                api_options=api_options,
                user_context=user_context,
            )
            if not isinstance(result, ConsumeCodePostOkResult):
                return result

            address = _normalise(next(iter(result.user.emails), ""))
            user = await signed_in_user(address)
            if user is None:
                # A code can be minutes old: the account may have been
                # deactivated, or its client suspended, in between.
                await result.session.revoke_session()
                logger.warning("AUTH_REFUSED | operation=consume_code | email=%s", address)
                return GeneralErrorResponse(ACCESS_DENIED)

            if not await bind_identity(user, result.user.id):
                await result.session.revoke_session()
                return GeneralErrorResponse(ACCESS_DENIED)

            await login_throttle.forget(address)
            await record_login(user)
            logger.info("AUTH_SIGNED_IN | email=%s | client=%s", address, user.client_id)
            return result

        original.create_code_post = create_code_post
        original.consume_code_post = consume_code_post
        return original

    return PasswordlessOverrideConfig(apis=apis)


def _email_delivery() -> Optional[EmailDeliveryConfig]:
    """Who sends the sign-in emails.

    PestBase's own SMTP when AUTH_SMTP_HOST is set, which is what a real deployment
    wants: the mail comes from the company's domain, and nothing about signing in
    depends on a third party staying up.

    Left unset, SuperTokens sends through its own service. That is fine for
    trying this out - the code arrives without any mail setup - but it is rate
    limited and the mail comes from them, so production wants the SMTP settings
    filled in.

    Deliberately global rather than per client: this sends before we know which
    client the address belongs to, and a client's own SMTP settings (used for
    quotes and invoices) are not reachable at that point.
    """
    if not settings.AUTH_SMTP_HOST:
        logger.warning(
            "AUTH_SMTP_HOST is not set: sign-in emails go through SuperTokens' own "
            "service. Fine for development, not for production."
        )
        return None

    return EmailDeliveryConfig(
        service=SMTPService(
            smtp_settings=SMTPSettings(
                host=settings.AUTH_SMTP_HOST,
                port=settings.AUTH_SMTP_PORT,
                from_=SMTPSettingsFrom(
                    name=settings.AUTH_SMTP_FROM_NAME or settings.AUTH_APP_NAME,
                    email=settings.AUTH_SMTP_FROM_EMAIL or settings.AUTH_SMTP_USER,
                ),
                username=settings.AUTH_SMTP_USER or None,
                password=settings.AUTH_SMTP_PASSWORD or None,
                secure=settings.AUTH_SMTP_SECURE,
            )
        )
    )


def init_supertokens() -> None:
    """Configure SuperTokens once, at startup. Safe to call again."""
    try:
        Supertokens.get_instance()
        return
    except Exception:  # noqa: BLE001 - not yet initialised is the normal path
        pass

    init(
        app_info=InputAppInfo(
            app_name=settings.AUTH_APP_NAME,
            api_domain=settings.AUTH_API_DOMAIN,
            website_domain=settings.AUTH_WEBSITE_DOMAIN,
            api_base_path=settings.AUTH_API_BASE_PATH,
            website_base_path=settings.AUTH_WEBSITE_BASE_PATH,
        ),
        supertokens_config=SupertokensConfig(
            connection_uri=settings.SUPERTOKENS_CONNECTION_URI,
            api_key=settings.SUPERTOKENS_API_KEY or None,
        ),
        framework="fastapi",
        recipe_list=[
            session.init(
                cookie_secure=settings.AUTH_COOKIE_SECURE
                or settings.ENVIRONMENT.lower() == "production",
            ),
            # A magic link and a six-digit code, both by email. A technician who
            # cannot open a link on a phone can type the code instead.
            # multifactorauth and totp would be added here; both need an
            # enterprise licence on the core.
            passwordless.init(
                flow_type="USER_INPUT_CODE_AND_MAGIC_LINK",
                contact_config=ContactEmailOnlyConfig(),
                override=_passwordless_overrides(),
                email_delivery=_email_delivery(),
            ),
        ],
    )
    logger.info(
        "SUPERTOKENS_INITIALISED | core=%s | api_base_path=%s | website_base_path=%s",
        settings.SUPERTOKENS_CONNECTION_URI,
        settings.AUTH_API_BASE_PATH,
        settings.AUTH_WEBSITE_BASE_PATH,
    )


async def provision_auth_user(email: str) -> tuple[str, bool]:
    """Make sure SuperTokens knows this address. Returns (id, created).

    Used when an account is added and by the cutover script, so somebody can be
    sent a sign-in link without having signed in first.
    """
    from supertokens_python.asyncio import list_users_by_account_info  # noqa: PLC0415
    from supertokens_python.recipe.passwordless.asyncio import signinup  # noqa: PLC0415
    from supertokens_python.types.base import AccountInfoInput  # noqa: PLC0415

    address = _normalise(email)
    existing = await list_users_by_account_info("public", AccountInfoInput(email=address))
    if existing:
        return existing[0].id, False

    created = await signinup(email=address, phone_number=None, tenant_id="public")
    return created.user.id, True


async def send_sign_in_link(email: str) -> None:
    """Email somebody a link, without them asking - for a new account."""
    from supertokens_python.recipe.passwordless.asyncio import create_magic_link  # noqa: PLC0415

    await create_magic_link(email=_normalise(email), phone_number=None, tenant_id="public")


async def delete_auth_user(auth_user_id: Optional[str]) -> None:
    """Remove the credential side when a PestBase account is deleted for good."""
    from supertokens_python.asyncio import delete_user  # noqa: PLC0415

    if auth_user_id:
        try:
            await delete_user(auth_user_id)
        except Exception as exc:  # noqa: BLE001 - the PestBase record still goes
            logger.warning("Could not delete the auth user %s: %s", auth_user_id, exc)


async def end_all_sessions(auth_user_id: Optional[str]) -> None:
    """Sign somebody out everywhere - deactivation, or a suspended client."""
    from supertokens_python.recipe.session.asyncio import (  # noqa: PLC0415
        revoke_all_sessions_for_user,
    )

    if auth_user_id:
        try:
            await revoke_all_sessions_for_user(auth_user_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not revoke sessions for %s: %s", auth_user_id, exc)
