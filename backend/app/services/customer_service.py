"""Customer CRUD and search operations."""

from datetime import datetime
from typing import List, Optional, Tuple

from beanie import PydanticObjectId

from app.models.customer import Address, Customer
from app.schemas.customer import CustomerCreate, CustomerUpdate

SORTABLE_FIELDS = {
    "created_at": "created_at",
    "updated_at": "updated_at",
    "last_name": "last_name",
    "first_name": "first_name",
}


class CustomerNotFoundError(Exception):
    """Raised when a customer cannot be located."""


def _escape_regex(value: str) -> str:
    """Escape regex metacharacters so user input is treated literally."""
    specials = r"\^$.|?*+()[]{}"
    return "".join("\\" + ch if ch in specials else ch for ch in value)


async def get_customer_by_id(customer_id: PydanticObjectId | str) -> Optional[Customer]:
    """Look up a customer by id."""
    try:
        oid = customer_id if isinstance(customer_id, PydanticObjectId) else PydanticObjectId(customer_id)
    except Exception:  # noqa: BLE001 - invalid object id string
        return None
    return await Customer.get(oid)


async def create_customer(payload: CustomerCreate, created_by: PydanticObjectId) -> Customer:
    """Create a new customer record."""
    now = datetime.utcnow()
    customer = Customer(
        first_name=payload.first_name,
        last_name=payload.last_name,
        email=str(payload.email).lower() if payload.email else None,
        phone=payload.phone,
        mobile=payload.mobile,
        address=Address(**payload.address.model_dump()),
        notes=payload.notes,
        is_active=payload.is_active,
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    await customer.insert()
    return customer


async def list_customers(
    page: int = 1,
    page_size: int = 20,
    q: Optional[str] = None,
    is_active: Optional[bool] = None,
    county: Optional[str] = None,
    city: Optional[str] = None,
    sort_by: str = "created_at",
    sort_desc: bool = True,
) -> Tuple[List[Customer], int]:
    """Return a page of customers plus the total count.

    Search (`q`) matches across first name, last name, email and phone using a
    case-insensitive substring match so partial queries behave predictably.
    """
    criteria: dict = {}

    if is_active is not None:
        criteria["is_active"] = is_active
    if county:
        criteria["address.county"] = {
            "$regex": _escape_regex(county.strip()),
            "$options": "i",
        }
    if city:
        criteria["address.city"] = {"$regex": _escape_regex(city.strip()), "$options": "i"}

    if q and q.strip():
        escaped = _escape_regex(q.strip())
        criteria["$or"] = [
            {"first_name": {"$regex": escaped, "$options": "i"}},
            {"last_name": {"$regex": escaped, "$options": "i"}},
            {"email": {"$regex": escaped, "$options": "i"}},
            {"phone": {"$regex": escaped, "$options": "i"}},
            {"mobile": {"$regex": escaped, "$options": "i"}},
        ]

    query = Customer.find(criteria) if criteria else Customer.find_all()

    total = await query.count()

    sort_field = SORTABLE_FIELDS.get(sort_by, "created_at")
    sort_expr = f"-{sort_field}" if sort_desc else f"+{sort_field}"

    skip = max(page - 1, 0) * page_size
    customers = await query.sort(sort_expr).skip(skip).limit(page_size).to_list()
    return customers, total


async def update_customer(customer_id: PydanticObjectId | str, payload: CustomerUpdate) -> Customer:
    """Apply a partial update to a customer."""
    customer = await get_customer_by_id(customer_id)
    if customer is None:
        raise CustomerNotFoundError("Customer not found")

    data = payload.model_dump(exclude_unset=True)

    if "first_name" in data and data["first_name"] is not None:
        customer.first_name = str(data["first_name"])
    if "last_name" in data and data["last_name"] is not None:
        customer.last_name = str(data["last_name"])
    if "email" in data:
        customer.email = str(data["email"]).lower() if data["email"] else None
    if "phone" in data and data["phone"] is not None:
        customer.phone = str(data["phone"])
    if "mobile" in data:
        customer.mobile = str(data["mobile"]) if data["mobile"] else None
    if "address" in data and data["address"] is not None:
        customer.address = Address(**data["address"])
    if "notes" in data:
        customer.notes = str(data["notes"]) if data["notes"] else None
    if "is_active" in data and data["is_active"] is not None:
        customer.is_active = bool(data["is_active"])

    customer.touch()
    await customer.save()
    return customer


async def soft_delete_customer(customer_id: PydanticObjectId | str) -> Customer:
    """Soft-delete a customer by flipping is_active to False."""
    customer = await get_customer_by_id(customer_id)
    if customer is None:
        raise CustomerNotFoundError("Customer not found")

    customer.is_active = False
    customer.touch()
    await customer.save()
    return customer


async def count_customers(is_active: Optional[bool] = True) -> int:
    """Count customers, optionally filtered by active status."""
    if is_active is None:
        return await Customer.find_all().count()
    return await Customer.find({"is_active": is_active}).count()
