"""Seed the QKil database with default users, sample customers, jobs and invoices.

Usage (from the backend/ directory, with the venv active):

    python -m scripts.seed            # create anything missing
    python -m scripts.seed --reset    # drop users + customers + bookings/jobs/invoices first
"""

import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

# Allow running as a plain script: `python scripts/seed.py`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.database import close_db, init_db  # noqa: E402
from app.models.booking import Booking, BookingStatus  # noqa: E402
from app.models.company_settings import CompanySettings  # noqa: E402
from app.models.counter import (  # noqa: E402
    BOOKING_COUNTER,
    INVOICE_COUNTER,
    JOB_COUNTER,
    Counter,
)
from app.models.customer import Address, Customer  # noqa: E402
from app.models.invoice import (  # noqa: E402
    Invoice,
    InvoiceItem,
    InvoiceStatus,
    Payment,
    PaymentMethod,
)
from app.models.job import (  # noqa: E402
    InspectionFinding,
    Job,
    JobStatus,
    RiskLevel,
    TreatmentApplied,
    TreatmentMethod,
)
from app.models.notification import Notification  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402

#: A 1x1 transparent PNG, standing in for a real captured signature.
SAMPLE_SIGNATURE = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)

SEED_USERS = [
    {
        "email": "admin@qkil.com",
        "full_name": "Alice Administrator",
        "password": "Admin123!",
        "role": UserRole.ADMIN,
    },
    {
        "email": "office@qkil.com",
        "full_name": "Olivia Office",
        "password": "Office123!",
        "role": UserRole.OFFICE_STAFF,
    },
    {
        "email": "tech@qkil.com",
        "full_name": "Tom Technician",
        "password": "Tech123!",
        "role": UserRole.TECHNICIAN,
    },
]

SEED_CUSTOMERS = [
    {
        "first_name": "James",
        "last_name": "Whitfield",
        "email": "james.whitfield@example.co.uk",
        "phone": "01632 960 123",
        "mobile": "07700 900 123",
        "address": {
            "street": "14 Beaumont Street",
            "city": "Oxford",
            "county": "Oxfordshire",
            "postcode": "OX1 2LJ",
            "country": "United Kingdom",
        },
        "notes": "",
    },
    {
        "first_name": "Sarah",
        "last_name": "Thornton",
        "email": "s.thornton@example.co.uk",
        "phone": "020 7946 0123",
        "mobile": "07700 900 456",
        "address": {
            "street": "27 Acacia Avenue",
            "city": "London",
            "county": "Greater London",
            "postcode": "SE1 7PB",
            "country": "United Kingdom",
        },
        "notes": "Side gate code: 4291",
    },
    {
        "first_name": "Mohammed",
        "last_name": "Al-Hassan",
        "email": "m.alhassan@example.co.uk",
        "phone": "0161 496 0123",
        "mobile": "07911 123 456",
        "address": {
            "street": "8 Maple Grove",
            "city": "Manchester",
            "county": "Greater Manchester",
            "postcode": "M14 7HP",
            "country": "United Kingdom",
        },
        "notes": "",
    },
    {
        "first_name": "Emily",
        "last_name": "Clarke",
        "email": "emily.clarke@example.co.uk",
        "phone": "0117 496 0123",
        "mobile": "07800 123 456",
        "address": {
            "street": "45 Clifton Road",
            "city": "Bristol",
            "county": "Bristol",
            "postcode": "BS8 1AJ",
            "country": "United Kingdom",
        },
        "notes": "Dog on premises",
    },
    {
        "first_name": "David",
        "last_name": "Morrison",
        "email": "d.morrison@example.co.uk",
        "phone": "0131 496 0123",
        "mobile": "07921 456 789",
        "address": {
            "street": "3 Royal Terrace",
            "city": "Edinburgh",
            "county": "Edinburgh",
            "postcode": "EH7 5AB",
            "country": "United Kingdom",
        },
        "notes": "",
    },
    {
        "first_name": "Priya",
        "last_name": "Patel",
        "email": "priya.patel@example.co.uk",
        "phone": "0121 496 0123",
        "mobile": "07734 567 890",
        "address": {
            "street": "62 Highfield Road",
            "city": "Birmingham",
            "county": "West Midlands",
            "postcode": "B15 3ED",
            "country": "United Kingdom",
        },
        "notes": "Flat 2, rear entrance",
    },
    {
        "first_name": "Thomas",
        "last_name": "Evans",
        "email": "t.evans@example.co.uk",
        "phone": "029 2046 0123",
        "mobile": "07700 900 789",
        "address": {
            "street": "19 Cathedral Road",
            "city": "Cardiff",
            "county": "Cardiff",
            "postcode": "CF11 9HA",
            "country": "United Kingdom",
        },
        "notes": "",
    },
    {
        "first_name": "Fiona",
        "last_name": "Campbell",
        "email": "fiona.campbell@example.co.uk",
        "phone": "0141 496 0123",
        "mobile": "07912 345 678",
        "address": {
            "street": "77 Sauchiehall Street",
            "city": "Glasgow",
            "county": "Glasgow",
            "postcode": "G2 3AH",
            "country": "United Kingdom",
        },
        "notes": "",
    },
    {
        "first_name": "Robert",
        "last_name": "Sinclair",
        "email": "r.sinclair@example.co.uk",
        "phone": "01603 496 012",
        "mobile": "07808 123 456",
        "address": {
            "street": "5 Elm Close",
            "city": "Norwich",
            "county": "Norfolk",
            "postcode": "NR1 3QY",
            "country": "United Kingdom",
        },
        "notes": "",
    },
    {
        "first_name": "Amanda",
        "last_name": "Foster",
        "email": "a.foster@example.co.uk",
        "phone": "0113 496 0123",
        "mobile": "07723 456 789",
        "address": {
            "street": "33 Park Lane",
            "city": "Leeds",
            "county": "West Yorkshire",
            "postcode": "LS1 5HN",
            "country": "United Kingdom",
        },
        "notes": "Commercial property",
    },
]


async def seed_users() -> List[User]:
    """Create the default staff accounts if they do not already exist."""
    created: List[User] = []

    for spec in SEED_USERS:
        existing = await User.find_one(User.email == spec["email"])
        if existing is not None:
            print(f"  - user already exists: {spec['email']} ({existing.role.value})")
            created.append(existing)
            continue

        now = datetime.utcnow()
        user = User(
            email=spec["email"],
            full_name=spec["full_name"],
            hashed_password=hash_password(spec["password"]),
            role=spec["role"],
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        await user.insert()
        created.append(user)
        print(f"  + created user: {user.email} ({user.role.value})")

    return created


async def seed_customers(created_by: User) -> int:
    """Create the sample customer records if they do not already exist."""
    count = 0

    for spec in SEED_CUSTOMERS:
        existing = await Customer.find_one(
            Customer.first_name == spec["first_name"],
            Customer.last_name == spec["last_name"],
        )
        if existing is not None:
            print(f"  - customer already exists: {spec['first_name']} {spec['last_name']}")
            continue

        now = datetime.utcnow()
        customer = Customer(
            first_name=spec["first_name"],
            last_name=spec["last_name"],
            email=spec["email"],
            phone=spec["phone"],
            mobile=spec["mobile"],
            address=Address(**spec["address"]),
            notes=spec["notes"],
            is_active=True,
            created_by=created_by.id,
            created_at=now,
            updated_at=now,
        )
        await customer.insert()
        count += 1
        print(f"  + created customer: {customer.first_name} {customer.last_name} ({customer.address.city})")

    return count


SEED_JOBS = [
    {
        "customer": ("James", "Whitfield"),
        "service_type": "General Pest Control",
        "pest_types": ["Cockroach", "Ant"],
        "days_ago": 2,
        "status": JobStatus.PENDING,
        "findings": [],
        "treatments": [],
    },
    {
        "customer": ("Priya", "Patel"),
        "service_type": "Cockroach Treatment",
        "pest_types": ["Cockroach", "Silverfish"],
        "days_ago": 1,
        "status": JobStatus.IN_PROGRESS,
        "overall_risk_level": RiskLevel.HIGH,
        "inspection_notes": (
            "Heavy German cockroach activity concentrated behind the kitchen appliances. "
            "Harbourage found in the motor cavity of the fridge and along the dishwasher seal."
        ),
        "recommendations": (
            "Gel bait re-application in four weeks. Advise the customer to seal the gap under "
            "the sink cabinet and to keep the bin lid closed overnight."
        ),
        "follow_up_required": True,
        "follow_up_notes": "Return visit to check bait take and top up stations.",
        "follow_up_in_days": 28,
        "findings": [
            {
                "area": "Kitchen",
                "pest_type": "Cockroach",
                "severity": RiskLevel.HIGH,
                "description": "Live German cockroaches and egg cases behind the fridge motor housing.",
                "recommendation": "Gel bait applied to harbourage points; review in four weeks.",
            },
            {
                "area": "Laundry",
                "pest_type": "Silverfish",
                "severity": RiskLevel.LOW,
                "description": "Small number of silverfish in the linen cupboard.",
                "recommendation": "Residual dust to cupboard voids and skirting gaps.",
            },
        ],
        "treatments": [
            {
                "pest_type": "Cockroach",
                "method": TreatmentMethod.GEL,
                "product_name": "Maxforce Gold Cockroach Gel",
                "product_concentration": "2.15%",
                "areas_treated": ["Kitchen", "Laundry"],
                "quantity_used": "12 g",
                "safety_data_sheet_ref": "SDS-MXF-2024-03",
            }
        ],
    },
    {
        "customer": ("David", "Morrison"),
        "service_type": "Termite Inspection",
        "pest_types": ["Termite"],
        "days_ago": 6,
        "status": JobStatus.COMPLETED,
        "overall_risk_level": RiskLevel.CRITICAL,
        "inspection_notes": (
            "Active subterranean termite workings located in the subfloor bearer on the "
            "north-east corner. Mud leads run up the stump to the floor joist. Moisture "
            "reading at the affected bearer measured 24%."
        ),
        "recommendations": (
            "Do not disturb the workings. Chemical soil barrier plus in-ground monitoring "
            "stations recommended. Repair the leaking downpipe feeding moisture into the subfloor."
        ),
        "follow_up_required": True,
        "follow_up_notes": "Barrier installation quote to be issued; re-inspect in three months.",
        "follow_up_in_days": 90,
        "customer_name_signed": "David Morrison",
        "findings": [
            {
                "area": "Subfloor",
                "pest_type": "Termite",
                "severity": RiskLevel.CRITICAL,
                "description": "Active subterranean termite workings in the north-east bearer, mud leads to joist.",
                "recommendation": "Chemical soil barrier and monitoring stations; structural check advised.",
            },
            {
                "area": "Perimeter",
                "pest_type": "Termite",
                "severity": RiskLevel.MEDIUM,
                "description": "Timber garden sleepers against the slab edge showing old damage.",
                "recommendation": "Remove sleepers away from the slab edge to break the bridging point.",
            },
            {
                "area": "Roof Void",
                "pest_type": "Termite",
                "severity": RiskLevel.LOW,
                "description": "No live activity found; timbers sounded and were clear.",
                "recommendation": "Re-inspect annually as part of the termite management plan.",
            },
        ],
        "treatments": [
            {
                "pest_type": "Termite",
                "method": TreatmentMethod.DUST,
                "product_name": "Termite Dust (Triflumuron)",
                "product_concentration": "5 g/kg",
                "areas_treated": ["Subfloor"],
                "quantity_used": "8 g",
                "safety_data_sheet_ref": "SDS-TRF-2023-11",
            },
            {
                "pest_type": "Termite",
                "method": TreatmentMethod.BAIT,
                "product_name": "Exterra In-Ground Stations",
                "product_concentration": None,
                "areas_treated": ["Perimeter", "Garden/Yard"],
                "quantity_used": "9 stations",
                "safety_data_sheet_ref": "SDS-EXT-2024-01",
            },
        ],
    },
]


async def _next_number(counter_name: str) -> str:
    return await Counter.next_number(counter_name)


async def seed_jobs(admin: User, technician: Optional[User]) -> int:
    """Create sample bookings and their jobs, if they do not already exist."""
    created = 0

    for spec in SEED_JOBS:
        first_name, last_name = spec["customer"]
        customer = await Customer.find_one(
            Customer.first_name == first_name,
            Customer.last_name == last_name,
        )
        if customer is None:
            print(f"  - skipping job for missing customer: {first_name} {last_name}")
            continue

        existing_job = await Job.find_one({"customer_id": customer.id})
        if existing_job is not None:
            print(f"  - job already exists for {first_name} {last_name}: {existing_job.job_number}")
            continue

        now = datetime.utcnow()
        days_ago = int(spec["days_ago"])
        start = (now - timedelta(days=days_ago)).replace(hour=9, minute=0, second=0, microsecond=0)
        end = start + timedelta(minutes=90)

        status = spec["status"]
        booking_status = (
            BookingStatus.COMPLETED if status is not JobStatus.PENDING else BookingStatus.IN_PROGRESS
        )

        booking = Booking(
            booking_number=await _next_number(BOOKING_COUNTER),
            customer_id=customer.id,
            technician_id=technician.id if technician else None,
            status=booking_status,
            scheduled_start=start,
            scheduled_end=end,
            service_type=spec["service_type"],
            pest_types=list(spec["pest_types"]),
            service_address=None,
            estimated_duration_minutes=90,
            customer_notes="Seeded sample booking.",
            created_by=admin.id,
            created_at=now,
            updated_at=now,
        )
        await booking.insert()

        findings = [
            InspectionFinding(
                area=item["area"],
                pest_type=item["pest_type"],
                severity=item["severity"],
                description=item["description"],
                recommendation=item["recommendation"],
                photo_ids=[],
            )
            for item in spec.get("findings", [])
        ]
        treatments = [
            TreatmentApplied(
                pest_type=item["pest_type"],
                method=item["method"],
                product_name=item["product_name"],
                product_concentration=item.get("product_concentration"),
                areas_treated=list(item.get("areas_treated", [])),
                quantity_used=item.get("quantity_used"),
                safety_data_sheet_ref=item.get("safety_data_sheet_ref"),
            )
            for item in spec.get("treatments", [])
        ]

        actual_start = start if status is not JobStatus.PENDING else None
        actual_end = end if status is JobStatus.COMPLETED else None
        follow_up_in_days = spec.get("follow_up_in_days")

        job = Job(
            job_number=await _next_number(JOB_COUNTER),
            booking_id=booking.id,
            customer_id=customer.id,
            technician_id=technician.id if technician else None,
            status=status,
            service_type=spec["service_type"],
            pest_types=list(spec["pest_types"]),
            service_address=None,
            scheduled_start=start,
            scheduled_end=end,
            actual_start=actual_start,
            actual_end=actual_end,
            findings=findings,
            treatments=treatments,
            overall_risk_level=spec.get("overall_risk_level"),
            inspection_notes=spec.get("inspection_notes"),
            recommendations=spec.get("recommendations"),
            follow_up_required=bool(spec.get("follow_up_required", False)),
            follow_up_notes=spec.get("follow_up_notes"),
            next_service_due=(
                end + timedelta(days=follow_up_in_days) if follow_up_in_days else None
            ),
            customer_name_signed=spec.get("customer_name_signed"),
            customer_signature=SAMPLE_SIGNATURE if spec.get("customer_name_signed") else None,
            signed_at=actual_end if spec.get("customer_name_signed") else None,
            technician_signature=SAMPLE_SIGNATURE if spec.get("customer_name_signed") else None,
            created_by=admin.id,
            created_at=now,
            updated_at=now,
        )
        await job.insert()

        booking.job_id = job.id
        await booking.save()

        created += 1
        print(
            f"  + created job: {job.job_number} ({job.status.value}) "
            f"for {customer.first_name} {customer.last_name} "
            f"- {len(findings)} finding(s), {len(treatments)} treatment(s)"
        )

    return created


#: Three sample invoices: one draft, one sent and overdue, one paid in full.
SEED_INVOICES = [
    {
        "key": "draft",
        "customer": ("James", "Whitfield"),
        "status": InvoiceStatus.DRAFT,
        "issued_days_ago": 1,
        "due_in_days": 14,
        "notes": "Quarterly general pest treatment - internal and external.",
        "items": [
            {
                "description": "General Pest Control - full internal and external treatment",
                "quantity": 1,
                "unit_price": 280.00,
            },
            {
                "description": "Rodent bait station service (4 stations)",
                "quantity": 4,
                "unit_price": 22.50,
            },
        ],
        "payments": [],
    },
    {
        "key": "overdue",
        "customer": ("Priya", "Patel"),
        "status": InvoiceStatus.OVERDUE,
        "issued_days_ago": 45,
        "due_in_days": 14,
        "notes": "Cockroach gel treatment. Follow-up visit booked separately.",
        "items": [
            {
                "description": "Cockroach Treatment - kitchen and laundry gel baiting",
                "quantity": 1,
                "unit_price": 340.00,
            },
            {
                "description": "Residual dust application - cupboard voids",
                "quantity": 1,
                "unit_price": 95.00,
            },
        ],
        "payments": [],
        "sent_days_ago": 45,
    },
    {
        "key": "paid",
        "customer": ("David", "Morrison"),
        "status": InvoiceStatus.PAID,
        "issued_days_ago": 20,
        "due_in_days": 14,
        "notes": "Annual termite inspection with subfloor dusting.",
        "items": [
            {
                "description": "Termite Inspection - full property, BS EN 16636 compliant",
                "quantity": 1,
                "unit_price": 495.00,
            },
            {
                "description": "Termite dust application - subfloor workings",
                "quantity": 1,
                "unit_price": 180.00,
            },
            {
                "description": "In-ground monitoring stations (9)",
                "quantity": 9,
                "unit_price": 45.00,
            },
        ],
        "payments": [
            {
                "days_ago": 6,
                "method": PaymentMethod.BANK_TRANSFER,
                "reference": "BACS-88213",
                "notes": "Paid in full by bank transfer.",
            }
        ],
        "sent_days_ago": 20,
    },
]

DEFAULT_INVOICE_TERMS = (
    "Payment due within 14 days. VAT registered under GB123456789. "
    "Thank you for your business."
)
DEFAULT_INVOICE_INSTRUCTIONS = (
    "Bank transfer - Sort Code: 20-00-00  Account No: 12345678  "
    "Account Name: QKil Pest Control Ltd. Please quote the invoice number as the reference."
)


def _build_invoice_items(specs: List[dict]) -> List[InvoiceItem]:
    """Turn plain dicts into InvoiceItems with their computed columns filled in."""
    items: List[InvoiceItem] = []
    for spec in specs:
        quantity = float(spec["quantity"])
        unit_price = float(spec["unit_price"])
        tax_rate = float(spec.get("tax_rate", 0.20))
        subtotal = round(quantity * unit_price, 2)
        tax_amount = round(subtotal * tax_rate, 2)
        items.append(
            InvoiceItem(
                description=spec["description"],
                quantity=quantity,
                unit_price=unit_price,
                tax_rate=tax_rate,
                subtotal=subtotal,
                tax_amount=tax_amount,
                total=round(subtotal + tax_amount, 2),
            )
        )
    return items


async def seed_invoices(admin: User) -> int:
    """Create the sample invoices if they do not already exist."""
    created = 0

    for spec in SEED_INVOICES:
        first_name, last_name = spec["customer"]
        customer = await Customer.find_one(
            Customer.first_name == first_name,
            Customer.last_name == last_name,
        )
        if customer is None:
            print(f"  - skipping invoice for missing customer: {first_name} {last_name}")
            continue

        existing = await Invoice.find_one({"customer_id": customer.id})
        if existing is not None:
            print(
                f"  - invoice already exists for {first_name} {last_name}: "
                f"{existing.invoice_number}"
            )
            continue

        now = datetime.utcnow()
        issue_date = now - timedelta(days=int(spec["issued_days_ago"]))
        due_date = issue_date + timedelta(days=int(spec["due_in_days"]))

        items = _build_invoice_items(spec["items"])
        subtotal = round(sum(item.subtotal for item in items), 2)
        tax_amount = round(sum(item.tax_amount for item in items), 2)
        total = round(subtotal + tax_amount, 2)

        # A "paid" sample invoice settles the full balance in one payment.
        payments: List[Payment] = []
        for payment_spec in spec.get("payments", []):
            payments.append(
                Payment(
                    payment_id=uuid.uuid4().hex[:12],
                    amount=total,
                    method=payment_spec["method"],
                    reference=payment_spec.get("reference"),
                    notes=payment_spec.get("notes"),
                    paid_at=now - timedelta(days=int(payment_spec["days_ago"])),
                    recorded_by=admin.id,
                )
            )

        amount_paid = round(sum(payment.amount for payment in payments), 2)
        amount_due = round(total - amount_paid, 2)
        sent_days_ago = spec.get("sent_days_ago")

        # Link the invoice to the customer's job when one was seeded.
        job = await Job.find_one({"customer_id": customer.id})

        invoice = Invoice(
            invoice_number=await _next_number(INVOICE_COUNTER),
            customer_id=customer.id,
            job_id=job.id if job else None,
            booking_id=job.booking_id if job else None,
            status=spec["status"],
            items=items,
            subtotal=subtotal,
            tax_amount=tax_amount,
            total=total,
            amount_paid=amount_paid,
            amount_due=amount_due,
            payments=payments,
            issue_date=issue_date,
            due_date=due_date,
            sent_at=(now - timedelta(days=int(sent_days_ago))) if sent_days_ago else None,
            paid_at=payments[-1].paid_at if payments else None,
            notes=spec.get("notes"),
            terms=DEFAULT_INVOICE_TERMS,
            payment_instructions=DEFAULT_INVOICE_INSTRUCTIONS,
            created_by=admin.id,
            created_at=issue_date,
            updated_at=now,
        )
        await invoice.insert()

        if job is not None and job.invoice_id is None:
            job.invoice_id = invoice.id
            await job.save()

        created += 1
        print(
            f"  + created invoice: {invoice.invoice_number} ({invoice.status.value}) "
            f"for {customer.first_name} {customer.last_name} "
            f"- total £{invoice.total:,.2f}, due £{invoice.amount_due:,.2f}"
        )

    return created


async def seed_company_settings(admin: Optional[User] = None) -> bool:
    """Create the singleton company settings document if it is missing.

    Everything on this document feeds the PDF headers, invoice defaults and
    quote defaults, so seeding it means a fresh install renders proper
    branded documents straight away.
    """
    existing = await CompanySettings.find_one({})
    if existing is not None:
        print(f"  - company settings already exist: {existing.company_name}")
        return False

    settings_doc = CompanySettings(
        company_name="QKil Pest Control",
        company_number="12345678",
        vat_number="GB123456789",
        phone="020 7946 0000",
        email="admin@qkil.co.uk",
        website="www.qkil.co.uk",
        address_street="1 Pest House Lane",
        address_city="London",
        address_county="Greater London",
        address_postcode="EC1A 1BB",
        address_country="United Kingdom",
        default_tax_rate=0.20,
        default_payment_terms_days=14,
        default_invoice_terms=DEFAULT_INVOICE_TERMS,
        default_payment_instructions=(
            "Sort Code: 20-00-00  Account No: 12345678  "
            "Account Name: QKil Pest Control Ltd"
        ),
        default_quote_valid_days=30,
        default_quote_terms="Quote valid for 30 days. VAT included.",
        primary_color="#059669",
        updated_at=datetime.utcnow(),
        updated_by=admin.id if admin else None,
    )
    await settings_doc.insert()
    print(f"  + created company settings: {settings_doc.company_name}")
    return True


async def reset_collections() -> None:
    """Delete all users, customers, bookings, jobs, invoices and settings."""
    deleted_notifications = await Notification.find_all().delete()
    deleted_settings = await CompanySettings.find_all().delete()
    deleted_invoices = await Invoice.find_all().delete()
    deleted_jobs = await Job.find_all().delete()
    deleted_bookings = await Booking.find_all().delete()
    deleted_customers = await Customer.find_all().delete()
    deleted_users = await User.find_all().delete()
    print(
        f"  ! reset: removed {getattr(deleted_invoices, 'deleted_count', 0)} invoice(s), "
        f"{getattr(deleted_jobs, 'deleted_count', 0)} job(s), "
        f"{getattr(deleted_bookings, 'deleted_count', 0)} booking(s), "
        f"{getattr(deleted_customers, 'deleted_count', 0)} customer(s), "
        f"{getattr(deleted_users, 'deleted_count', 0)} user(s), "
        f"{getattr(deleted_notifications, 'deleted_count', 0)} notification(s), "
        f"{getattr(deleted_settings, 'deleted_count', 0)} settings document(s)"
    )


async def main(reset: bool = False) -> None:
    """Run the seed process."""
    print(f"Connecting to {settings.MONGODB_URL} / {settings.DATABASE_NAME}")
    await init_db()

    try:
        if reset:
            print("Resetting collections...")
            await reset_collections()

        print("Seeding users...")
        users = await seed_users()

        admin = next((u for u in users if u.role == UserRole.ADMIN), users[0])

        technician = next((u for u in users if u.role == UserRole.TECHNICIAN), None)

        print("Seeding company settings...")
        await seed_company_settings(admin)

        print("Seeding customers...")
        created = await seed_customers(admin)

        print("Seeding jobs...")
        created_jobs = await seed_jobs(admin, technician)

        print("Seeding invoices...")
        created_invoices = await seed_invoices(admin)

        total_users = await User.find_all().count()
        total_customers = await Customer.find_all().count()
        total_jobs = await Job.find_all().count()
        total_invoices = await Invoice.find_all().count()

        print("\nSeed complete.")
        print(f"  users:     {total_users}")
        print(f"  customers: {total_customers} ({created} new)")
        print(f"  jobs:      {total_jobs} ({created_jobs} new)")
        print(f"  invoices:  {total_invoices} ({created_invoices} new)")
        print("\nDefault credentials:")
        for spec in SEED_USERS:
            print(f"  {spec['role'].value:<13} {spec['email']:<18} {spec['password']}")
    finally:
        await close_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed the QKil database.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete all existing users, customers, bookings, jobs and invoices before seeding.",
    )
    args = parser.parse_args()
    asyncio.run(main(reset=args.reset))
