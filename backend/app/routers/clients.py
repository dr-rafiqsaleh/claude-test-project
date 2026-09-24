"""Client companies. QKil platform staff only."""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field

from app.config import settings
from app.core.dependencies import require_platform_staff
from app.models.client import ClientStatus
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services import client_service
from app.services.client_service import ClientError, ClientNotFoundError

router = APIRouter(
    prefix="/api/v1/clients",
    tags=["clients"],
    dependencies=[Depends(require_platform_staff)],
)


class ClientResponse(BaseModel):
    id: str
    name: str
    slug: str
    status: ClientStatus
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    notes: Optional[str] = None
    user_count: int = 0
    created_at: datetime
    updated_at: datetime


class ClientListData(BaseModel):
    items: List[ClientResponse] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 20


class ClientWrite(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = Field(None, max_length=40)
    notes: Optional[str] = Field(None, max_length=1000)
    status: Optional[ClientStatus] = None


class ClientCreate(ClientWrite):
    name: str = Field(min_length=1, max_length=120)
    status: None = None  # a new client always starts active


class ClientEnvelope(ApiResponse[ClientResponse]):
    pass


class ClientListResponse(ApiResponse[ClientListData]):
    pass


def _response(client, counts: Optional[dict] = None) -> ClientResponse:
    return ClientResponse(
        id=str(client.id),
        name=client.name,
        slug=client.slug,
        status=client.status,
        contact_email=client.contact_email,
        contact_phone=client.contact_phone,
        notes=client.notes,
        user_count=(counts or {}).get(str(client.id), 0),
        created_at=client.created_at,
        updated_at=client.updated_at,
    )


def _refused(exc: Exception) -> HTTPException:
    code = (
        status.HTTP_404_NOT_FOUND
        if isinstance(exc, ClientNotFoundError)
        else status.HTTP_400_BAD_REQUEST
    )
    return HTTPException(status_code=code, detail=str(exc))


@router.get("", response_model=ClientListResponse, summary="List client companies")
@router.get("/", response_model=ClientListResponse, include_in_schema=False)
async def list_clients(
    page: int = Query(1, ge=1),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    client_status: Optional[ClientStatus] = Query(None, alias="status"),
    q: Optional[str] = Query(None, description="Search name, handle or contact email"),
) -> ClientListResponse:
    clients, total = await client_service.list_clients(
        page=page, page_size=page_size, status=client_status, q=q
    )
    counts = await client_service.user_counts()
    return ClientListResponse(
        data=ClientListData(
            items=[_response(client, counts) for client in clients],
            total=total,
            page=page,
            page_size=page_size,
        ),
        message=f"{total} client(s) found",
        success=True,
    )


@router.post(
    "",
    response_model=ClientEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Add a client company",
)
@router.post("/", response_model=ClientEnvelope, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_client(
    payload: ClientCreate,
    current_user: User = Depends(require_platform_staff),
) -> ClientEnvelope:
    try:
        client = await client_service.create_client(
            name=payload.name,
            contact_email=payload.contact_email,
            contact_phone=payload.contact_phone,
            notes=payload.notes,
            actor=current_user,
        )
    except ClientError as exc:
        raise _refused(exc) from exc
    return ClientEnvelope(data=_response(client), message=f"{client.name} was added", success=True)


@router.get("/{client_id}", response_model=ClientEnvelope, summary="Get one client")
async def get_client(client_id: str) -> ClientEnvelope:
    try:
        client = await client_service.get_client(client_id)
    except ClientNotFoundError as exc:
        raise _refused(exc) from exc
    counts = await client_service.user_counts()
    return ClientEnvelope(data=_response(client, counts), message="Client retrieved", success=True)


@router.put("/{client_id}", response_model=ClientEnvelope, summary="Change or suspend a client")
async def update_client(
    client_id: str,
    payload: ClientWrite,
    current_user: User = Depends(require_platform_staff),
) -> ClientEnvelope:
    try:
        client = await client_service.update_client(
            client_id,
            name=payload.name,
            contact_email=payload.contact_email,
            contact_phone=payload.contact_phone,
            notes=payload.notes,
            status=payload.status,
            actor=current_user,
        )
    except (ClientError, ClientNotFoundError) as exc:
        raise _refused(exc) from exc
    counts = await client_service.user_counts()
    return ClientEnvelope(data=_response(client, counts), message=f"{client.name} was saved", success=True)


@router.delete("/{client_id}", response_model=ClientEnvelope, summary="Delete a client with nobody in it")
async def delete_client(client_id: str) -> ClientEnvelope:
    try:
        client = await client_service.delete_client(client_id)
    except (ClientError, ClientNotFoundError) as exc:
        raise _refused(exc) from exc
    return ClientEnvelope(data=_response(client, {}), message=f"{client.name} was deleted", success=True)
