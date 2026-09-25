"""PestBase API application entrypoint."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import BackgroundTasks, FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from supertokens_python import get_all_cors_headers
from supertokens_python.framework.fastapi import get_middleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.core.supertokens import init_supertokens
from app.core.responses import UtcJSONResponse
from app.core.tenancy import TenantScopeError
from app.database import close_db, init_db
from app.routers import (
    audit,
    auth,
    bookings,
    clients,
    contact,
    company_settings,
    customers,
    emails,
    invoices,
    jobs,
    notifications,
    platform_settings,
    quotes,
    roles,
    search,
    support_access,
    users,
)
from app.services import notification_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("pestbase")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Open the database connection on startup and close it on shutdown."""
    logger.info("Starting PestBase API (environment=%s)", settings.ENVIRONMENT)
    await init_db()
    try:
        yield
    finally:
        await close_db()
        logger.info("PestBase API shut down")


# Before the app is built, not in the lifespan: get_middleware() and
# get_all_cors_headers() below both ask SuperTokens for its configuration, and
# they run while this module is being imported - long before any lifespan.
#
# Safe this early because init only configures the SDK. The sign-in overrides it
# registers do look up PestBase accounts, but they run on a request, by which time
# the lifespan has opened the database.
init_supertokens()

app = FastAPI(
    title="PestBase API",
    description=(
        "Pest control management platform - Phase 8 "
        "(auth, users, customers, quotes, bookings, jobs, inspection reports, "
        "invoicing and payments, global search, notifications and company settings)."
    ),
    version="0.6.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
    # Stored times are naive UTC; this marks them as such in every response.
    default_response_class=UtcJSONResponse,
)

# SuperTokens has to see the request before the routes do: it serves its own
# endpoints under AUTH_API_BASE_PATH and refreshes an expiring session. Added
# before CORS so that CORS still wraps it - middleware runs in reverse order of
# addition.
app.add_middleware(get_middleware())

# allow_credentials, and the SuperTokens headers, because the session lives in
# cookies rather than a header the app sets itself. Behind the portal's nginx
# the two share an origin and none of this is used; it matters when the API is
# served from somewhere else, such as `npm run dev` against a separate backend.
#
# The Android and iOS apps are always "somewhere else": they call the API from
# capacitor://localhost (iOS) and https://localhost (Android), which must be in
# CORS_ORIGINS. They carry the session in headers rather than cookies, and the
# SDK reads the new tokens off the response - which a browser hides from
# JavaScript on a cross-origin response unless they are exposed here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Client-Id", "Authorization", *get_all_cors_headers()],
    expose_headers=["front-token", "st-access-token", "st-refresh-token", "anti-csrf"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(customers.router)
app.include_router(quotes.router)
app.include_router(bookings.router)
app.include_router(jobs.router)
app.include_router(invoices.router)
app.include_router(search.router)
app.include_router(notifications.router)
app.include_router(company_settings.router)
app.include_router(emails.router)
app.include_router(roles.router)
app.include_router(clients.router)
app.include_router(audit.router)
app.include_router(support_access.router)
app.include_router(platform_settings.router)
app.include_router(contact.router)


@app.exception_handler(TenantScopeError)
async def tenant_scope_handler(_request: Request, exc: TenantScopeError) -> JSONResponse:
    """A write with no client in scope is the caller's mistake, not a crash.

    Platform staff read across every client, so a request of theirs that tries
    to create a client's record has to say which client first.
    """
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"data": None, "message": str(exc), "success": False},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Wrap HTTP errors in the standard API envelope."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"data": None, "message": str(exc.detail), "success": False},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Return readable field-level validation errors in the standard envelope."""
    errors = []
    for err in exc.errors():
        location = ".".join(str(part) for part in err.get("loc", ()) if part not in ("body", "query", "path"))
        errors.append({"field": location or "request", "message": err.get("msg", "Invalid value")})

    first = errors[0]["message"] if errors else "Validation failed"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"data": {"errors": errors}, "message": first, "success": False},
    )


@app.get("/health", tags=["system"], summary="Health check")
async def health_check(background_tasks: BackgroundTasks) -> dict:
    """Simple liveness probe.

    Doubles as the heartbeat for the reminder sweep: PestBase has no scheduler, so
    generating notifications rides along with the health check and the
    notifications list endpoint. The sweep is de-duplicated and never blocks
    the response.
    """
    background_tasks.add_task(notification_service.sweep_notifications)

    return {
        "data": {
            "status": "ok",
            "environment": settings.ENVIRONMENT,
            "database": settings.DATABASE_NAME,
            "version": app.version,
        },
        "message": "PestBase API is healthy",
        "success": True,
    }


@app.get("/", tags=["system"], include_in_schema=False)
async def root() -> dict:
    """Root endpoint pointing at the docs."""
    return {
        "data": {"name": "PestBase API", "version": app.version, "docs": "/docs"},
        "message": "Welcome to the PestBase API",
        "success": True,
    }
