"""Global search across every customer-facing collection.

One call fans out to customers, quotes, bookings, jobs and invoices in
parallel. Customer names are resolved with a single batched follow-up query
rather than one lookup per row.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Sequence, Set

from beanie import PydanticObjectId

from app.models.booking import Booking
from app.models.customer import Customer
from app.models.invoice import Invoice
from app.models.job import Job
from app.models.quote import Quote

logger = logging.getLogger(__name__)

#: Every collection the search can cover, in display order.
ALL_TYPES: Sequence[str] = ("customers", "quotes", "bookings", "jobs", "invoices")

#: Collections whose rows carry a customer_id needing a name lookup.
CUSTOMER_LINKED_TYPES: Sequence[str] = ("quotes", "bookings", "jobs", "invoices")

#: Cap on how many customers a name match may pull in before we stop widening.
MAX_NAME_MATCHES = 200


def _escape_regex(value: str) -> str:
    """Escape regex metacharacters so user input is treated literally."""
    specials = r"\^$.|?*+()[]{}"
    return "".join("\\" + ch if ch in specials else ch for ch in value)


def parse_types(raw: Optional[str]) -> List[str]:
    """Turn `?types=customers,invoices` into a validated list of collections."""
    if not raw or not raw.strip():
        return list(ALL_TYPES)

    requested = {part.strip().lower() for part in raw.split(",") if part.strip()}
    selected = [name for name in ALL_TYPES if name in requested]
    return selected or list(ALL_TYPES)


def _money(value: Optional[float]) -> str:
    return f"£{float(value or 0):,.2f}"


def _short_date(value: Optional[datetime]) -> str:
    return value.strftime("%d %b %Y") if value else ""


def _join(*parts: Optional[str]) -> str:
    """Join the non-empty parts of a subtitle with a middle dot."""
    return " · ".join(part for part in parts if part)


# ---------------------------------------------------------------------------
# Per-collection queries
# ---------------------------------------------------------------------------


async def _matching_customer_ids(escaped: str) -> List[PydanticObjectId]:
    """Ids of every customer whose name matches, for the linked collections."""
    customers = await Customer.find(
        {
            "$or": [
                {"first_name": {"$regex": escaped, "$options": "i"}},
                {"last_name": {"$regex": escaped, "$options": "i"}},
            ]
        }
    ).limit(MAX_NAME_MATCHES).to_list()
    return [customer.id for customer in customers]


async def _search_customers(escaped: str, limit: int) -> List[Customer]:
    return (
        await Customer.find(
            {
                "$or": [
                    {"first_name": {"$regex": escaped, "$options": "i"}},
                    {"last_name": {"$regex": escaped, "$options": "i"}},
                    {"email": {"$regex": escaped, "$options": "i"}},
                    {"phone": {"$regex": escaped, "$options": "i"}},
                    {"mobile": {"$regex": escaped, "$options": "i"}},
                ]
            }
        )
        .sort("last_name", "first_name")
        .limit(limit)
        .to_list()
    )


def _or_with_customers(
    own_clauses: List[dict],
    customer_ids: Sequence[PydanticObjectId],
) -> dict:
    clauses = list(own_clauses)
    if customer_ids:
        clauses.append({"customer_id": {"$in": list(customer_ids)}})
    return {"$or": clauses}


async def _search_quotes(
    escaped: str,
    customer_ids: Sequence[PydanticObjectId],
    limit: int,
) -> List[Quote]:
    criteria = _or_with_customers(
        [{"quote_number": {"$regex": escaped, "$options": "i"}}],
        customer_ids,
    )
    return await Quote.find(criteria).sort("-created_at").limit(limit).to_list()


async def _search_bookings(
    escaped: str,
    customer_ids: Sequence[PydanticObjectId],
    limit: int,
) -> List[Booking]:
    criteria = _or_with_customers(
        [
            {"booking_number": {"$regex": escaped, "$options": "i"}},
            {"service_type": {"$regex": escaped, "$options": "i"}},
        ],
        customer_ids,
    )
    return await Booking.find(criteria).sort("-scheduled_start").limit(limit).to_list()


async def _search_jobs(
    escaped: str,
    customer_ids: Sequence[PydanticObjectId],
    limit: int,
) -> List[Job]:
    criteria = _or_with_customers(
        [
            {"job_number": {"$regex": escaped, "$options": "i"}},
            {"service_type": {"$regex": escaped, "$options": "i"}},
        ],
        customer_ids,
    )
    return await Job.find(criteria).sort("-scheduled_start").limit(limit).to_list()


async def _search_invoices(
    escaped: str,
    customer_ids: Sequence[PydanticObjectId],
    limit: int,
) -> List[Invoice]:
    criteria = _or_with_customers(
        [{"invoice_number": {"$regex": escaped, "$options": "i"}}],
        customer_ids,
    )
    return await Invoice.find(criteria).sort("-issue_date").limit(limit).to_list()


# ---------------------------------------------------------------------------
# Result shaping
# ---------------------------------------------------------------------------


def _customer_item(customer: Customer) -> dict:
    return {
        "id": str(customer.id),
        "type": "customer",
        "title": customer.full_name,
        "subtitle": _join(customer.phone, customer.email),
        "status": "active" if customer.is_active else "inactive",
        "url": f"/customers/{customer.id}",
        "created_at": customer.created_at,
    }


def _quote_item(quote: Quote, customer_name: str) -> dict:
    return {
        "id": str(quote.id),
        "type": "quote",
        "title": quote.quote_number,
        "subtitle": _join(customer_name, _money(quote.total)),
        "status": quote.status.value,
        "url": f"/quotes/{quote.id}",
        "created_at": quote.created_at,
    }


def _booking_item(booking: Booking, customer_name: str) -> dict:
    return {
        "id": str(booking.id),
        "type": "booking",
        "title": booking.booking_number,
        "subtitle": _join(
            customer_name,
            booking.service_type,
            _short_date(booking.scheduled_start),
        ),
        "status": booking.status.value,
        "url": f"/bookings/{booking.id}",
        "created_at": booking.created_at,
    }


def _job_item(job: Job, customer_name: str) -> dict:
    return {
        "id": str(job.id),
        "type": "job",
        "title": job.job_number,
        "subtitle": _join(
            customer_name,
            job.service_type,
            job.status.value.replace("_", " ").title(),
        ),
        "status": job.status.value,
        "url": f"/jobs/{job.id}",
        "created_at": job.created_at,
    }


def _invoice_item(invoice: Invoice, customer_name: str) -> dict:
    return {
        "id": str(invoice.id),
        "type": "invoice",
        "title": invoice.invoice_number,
        "subtitle": _join(
            customer_name,
            _money(invoice.total),
            invoice.status.value.replace("_", " ").title(),
        ),
        "status": invoice.status.value,
        "url": f"/invoices/{invoice.id}",
        "created_at": invoice.created_at,
    }


async def _customer_names(documents: Iterable[object]) -> Dict[str, str]:
    """Batch-resolve customer ids to full names for a mixed bag of documents."""
    ids: Set[PydanticObjectId] = set()
    for document in documents:
        customer_id = getattr(document, "customer_id", None)
        if customer_id is not None:
            ids.add(customer_id)

    if not ids:
        return {}

    customers = await Customer.find({"_id": {"$in": list(ids)}}).to_list()
    return {str(customer.id): customer.full_name for customer in customers}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def search_all(
    query: str,
    types: Optional[Sequence[str]] = None,
    limit: int = 5,
) -> dict:
    """Search every requested collection and return grouped, flattened results.

    Returns ``{"results": {...}, "total_count": int, "query": str}``.
    """
    term = (query or "").strip()
    selected = list(types) if types else list(ALL_TYPES)
    empty = {name: [] for name in ALL_TYPES}

    if len(term) < 2:
        return {"results": empty, "total_count": 0, "query": term}

    escaped = _escape_regex(term)
    capped = max(1, min(int(limit or 5), 20))

    # One shared name lookup feeds every customer-linked collection, so the
    # per-collection queries never have to hit the customers collection again.
    needs_names = any(name in selected for name in CUSTOMER_LINKED_TYPES)
    name_matched_ids = await _matching_customer_ids(escaped) if needs_names else []

    runners = {
        "customers": lambda: _search_customers(escaped, capped),
        "quotes": lambda: _search_quotes(escaped, name_matched_ids, capped),
        "bookings": lambda: _search_bookings(escaped, name_matched_ids, capped),
        "jobs": lambda: _search_jobs(escaped, name_matched_ids, capped),
        "invoices": lambda: _search_invoices(escaped, name_matched_ids, capped),
    }

    active = [name for name in ALL_TYPES if name in selected]
    gathered = await asyncio.gather(
        *(runners[name]() for name in active),
        return_exceptions=True,
    )

    documents: Dict[str, list] = {name: [] for name in ALL_TYPES}
    for name, outcome in zip(active, gathered):
        if isinstance(outcome, Exception):
            logger.warning("Search over %s failed: %s", name, outcome)
            continue
        documents[name] = outcome

    linked = [
        document
        for name in CUSTOMER_LINKED_TYPES
        for document in documents[name]
    ]
    names = await _customer_names(linked)

    def name_for(document) -> str:
        return names.get(str(getattr(document, "customer_id", "")), "Unknown customer")

    results = {
        "customers": [_customer_item(item) for item in documents["customers"]],
        "quotes": [_quote_item(item, name_for(item)) for item in documents["quotes"]],
        "bookings": [_booking_item(item, name_for(item)) for item in documents["bookings"]],
        "jobs": [_job_item(item, name_for(item)) for item in documents["jobs"]],
        "invoices": [_invoice_item(item, name_for(item)) for item in documents["invoices"]],
    }

    total = sum(len(group) for group in results.values())
    return {"results": results, "total_count": total, "query": term}
