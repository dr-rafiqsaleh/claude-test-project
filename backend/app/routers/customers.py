"""Customer routes.

Admin and office staff may read and write; technicians have read-only access.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import settings
from app.core.dependencies import get_current_user, require_staff
from app.models.user import User
from app.schemas.customer import (
    CustomerCreate,
    CustomerListData,
    CustomerListResponse,
    CustomerResponse,
    CustomerResponseEnvelope,
    CustomerUpdate,
)
from app.services import customer_service
from app.services.customer_service import CustomerNotFoundError

router = APIRouter(prefix="/api/v1/customers", tags=["customers"])


@router.get("", response_model=CustomerListResponse, summary="List customers")
@router.get("/", response_model=CustomerListResponse, include_in_schema=False)
async def list_customers(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(settings.DEFAULT_PAGE_SIZE, ge=1, le=settings.MAX_PAGE_SIZE),
    q: Optional[str] = Query(None, description="Search name, email or phone"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    county: Optional[str] = Query(None, description="Filter by county, e.g. Oxfordshire"),
    city: Optional[str] = Query(None, description="Filter by city"),
    sort_by: str = Query("created_at", description="created_at | updated_at | last_name | first_name"),
    sort_desc: bool = Query(True, description="Sort descending"),
    _current_user: User = Depends(get_current_user),
) -> CustomerListResponse:
    """Return a paginated, searchable list of customers."""
    customers, total = await customer_service.list_customers(
        page=page,
        page_size=page_size,
        q=q,
        is_active=is_active,
        county=county,
        city=city,
        sort_by=sort_by,
        sort_desc=sort_desc,
    )

    return CustomerListResponse(
        data=CustomerListData(
            items=[CustomerResponse.model_validate(c) for c in customers],
            total=total,
            page=page,
            page_size=page_size,
        ),
        message=f"{total} customer(s) found",
        success=True,
    )


@router.post(
    "",
    response_model=CustomerResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    summary="Create a customer",
)
@router.post(
    "/",
    response_model=CustomerResponseEnvelope,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_customer(
    payload: CustomerCreate,
    current_user: User = Depends(require_staff),
) -> CustomerResponseEnvelope:
    """Create a new customer record."""
    customer = await customer_service.create_customer(payload, created_by=current_user.id)

    return CustomerResponseEnvelope(
        data=CustomerResponse.model_validate(customer),
        message="Customer created successfully",
        success=True,
    )


@router.get("/{customer_id}", response_model=CustomerResponseEnvelope, summary="Get a customer by id")
async def get_customer(
    customer_id: str,
    _current_user: User = Depends(get_current_user),
) -> CustomerResponseEnvelope:
    """Fetch a single customer."""
    customer = await customer_service.get_customer_by_id(customer_id)
    if customer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    return CustomerResponseEnvelope(
        data=CustomerResponse.model_validate(customer),
        message="Customer retrieved",
        success=True,
    )


@router.put("/{customer_id}", response_model=CustomerResponseEnvelope, summary="Update a customer")
async def update_customer(
    customer_id: str,
    payload: CustomerUpdate,
    _current_user: User = Depends(require_staff),
) -> CustomerResponseEnvelope:
    """Update an existing customer."""
    try:
        customer = await customer_service.update_customer(customer_id, payload)
    except CustomerNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return CustomerResponseEnvelope(
        data=CustomerResponse.model_validate(customer),
        message="Customer updated successfully",
        success=True,
    )


@router.delete("/{customer_id}", response_model=CustomerResponseEnvelope, summary="Archive a customer")
async def delete_customer(
    customer_id: str,
    _current_user: User = Depends(require_staff),
) -> CustomerResponseEnvelope:
    """Soft-delete a customer by setting is_active to False."""
    try:
        customer = await customer_service.soft_delete_customer(customer_id)
    except CustomerNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return CustomerResponseEnvelope(
        data=CustomerResponse.model_validate(customer),
        message="Customer archived successfully",
        success=True,
    )
