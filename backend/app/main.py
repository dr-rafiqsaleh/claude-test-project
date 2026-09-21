"""QKil API application entrypoint."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import BackgroundTasks, FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.database import close_db, init_db
from app.routers import (
    auth,
    bookings,
    company_settings,
    customers,
    invoices,
    jobs,
    notifications,
    quotes,
    search,
    users,
)
from app.services import notification_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("qkil")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Open the database connection on startup and close it on shutdown."""
    logger.info("Starting QKil API (environment=%s)", settings.ENVIRONMENT)
    await init_db()
    try:
        yield
    finally:
        await close_db()
        logger.info("QKil API shut down")


app = FastAPI(
    title="QKil API",
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
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

    Doubles as the heartbeat for the reminder sweep: QKil has no scheduler, so
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
        "message": "QKil API is healthy",
        "success": True,
    }


@app.get("/", tags=["system"], include_in_schema=False)
async def root() -> dict:
    """Root endpoint pointing at the docs."""
    return {
        "data": {"name": "QKil API", "version": app.version, "docs": "/docs"},
        "message": "Welcome to the QKil API",
        "success": True,
    }
