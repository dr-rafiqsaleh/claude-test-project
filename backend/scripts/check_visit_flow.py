"""
Self-check for the visit flow: a booking and its job move as one site visit.

Runs the real route handlers against a throwaway database, which it creates
and drops - your own database is never touched. From the backend/ directory:

    python scripts/check_visit_flow.py

Prints each step and exits non-zero on the first failure.
"""

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import HTTPException

from app.database import close_db, init_db
from app.models.booking import Booking, BookingStatus
from app.models.customer import Address, Customer
from app.models.invoice import Invoice
from app.models.job import Job, JobStatus
from app.models.user import User, UserRole
from app.routers.bookings import update_booking_status
from app.routers.jobs import update_job_status
from app.schemas.booking import BookingStatusUpdate
from app.schemas.job import JobStatusUpdate
from app.services import job_service

CHECK_DB = "pestbase_visit_flow_check"


def ok(message: str) -> None:
    print(f"  ok  {message}")


async def expect_http_error(code: int, call) -> str:
    try:
        await call
    except HTTPException as exc:
        assert exc.status_code == code, f"expected HTTP {code}, got {exc.status_code}: {exc.detail}"
        return str(exc.detail)
    raise AssertionError(f"expected HTTP {code}, but the call succeeded")


async def make_visit(office: User, tech: User, customer: Customer, number: str) -> Booking:
    start = datetime.utcnow() + timedelta(hours=1)
    booking = Booking(
        booking_number=number,
        customer_id=customer.id,
        technician_id=tech.id,
        scheduled_start=start,
        scheduled_end=start + timedelta(hours=1),
        service_type="General Pest Control",
        pest_types=["Mice"],
        created_by=office.id,
    )
    await booking.insert()
    return booking


async def start_booking(booking: Booking, user: User):
    return await update_booking_status(
        str(booking.id), BookingStatusUpdate(status=BookingStatus.IN_PROGRESS), current_user=user
    )


async def main() -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)  # clear leftovers from an interrupted run
    await init_db(database_name=CHECK_DB)  # recreate the indexes

    try:
        office = User(email="office@check.test", full_name="Olive Office", role=UserRole.OFFICE_STAFF)
        tech = User(email="tech@check.test", full_name="Tom Tech", role=UserRole.TECHNICIAN)
        other_tech = User(email="other@check.test", full_name="Oscar Other", role=UserRole.TECHNICIAN)
        for user in (office, tech, other_tech):
            await user.insert()
        customer = Customer(
            first_name="Cara", last_name="Customer", phone="01234 567890", created_by=office.id,
            address=Address(street="1 High St", city="Leeds", postcode="LS1 1AA"),
        )
        await customer.insert()

        print("Technician runs a visit end to end from the booking")
        visit = await make_visit(office, tech, customer, "JOB-CHK-1")

        await expect_http_error(403, start_booking(visit, other_tech))
        ok("another technician cannot start it")

        response = await start_booking(visit, tech)
        assert response.data.status == BookingStatus.IN_PROGRESS
        job = await Job.find_one({"booking_id": visit.id})
        assert job is not None, "starting the visit should open its job"
        assert job.status == JobStatus.IN_PROGRESS, job.status
        assert response.data.job_id == str(job.id), "response should link the new job"
        ok("the assigned technician starts it straight from Scheduled; its job opens, in progress")

        done = BookingStatusUpdate(status=BookingStatus.COMPLETED)
        detail = await expect_http_error(409, update_booking_status(str(visit.id), done, current_user=tech))
        assert "report" in detail, detail
        ok("it cannot be completed with an empty report")

        job.inspection_notes = "Droppings behind the fridge; bait stations placed."
        await job.save()
        await update_booking_status(str(visit.id), done, current_user=tech)
        job = await Job.get(job.id)
        assert job.status == JobStatus.COMPLETED, job.status
        assert await Invoice.find_one({"job_id": job.id}) is not None, "completion should raise the invoice"
        ok("completing the booking completes the job and raises the invoice")

        print("Technician runs a visit from the report side (field form)")
        visit = await make_visit(office, tech, customer, "JOB-CHK-2")
        await start_booking(visit, tech)
        job = await Job.find_one({"booking_id": visit.id})
        job.inspection_notes = "No activity found."
        await job.save()
        await update_job_status(str(job.id), JobStatusUpdate(status=JobStatus.COMPLETED), current_user=tech)
        visit = await Booking.get(visit.id)
        assert visit.status == BookingStatus.COMPLETED, visit.status
        assert visit.actual_end is not None
        ok("completing the job completes the booking")

        print("Office cancels a visit in progress")
        visit = await make_visit(office, tech, customer, "JOB-CHK-3")
        await start_booking(visit, office)
        cancel = BookingStatusUpdate(status=BookingStatus.CANCELLED, reason="Customer not home")
        await update_booking_status(str(visit.id), cancel, current_user=office)
        job = await Job.find_one({"booking_id": visit.id})
        assert job.status == JobStatus.CANCELLED, job.status
        ok("cancelling the booking cancels its job")

        print("A job created ahead of the visit")
        visit = await make_visit(office, tech, customer, "JOB-CHK-4")
        job, *_ = await job_service.create_job_from_booking(visit.id, office.id)
        await update_job_status(str(job.id), JobStatusUpdate(status=JobStatus.IN_PROGRESS), current_user=tech)
        visit = await Booking.get(visit.id)
        assert visit.status == BookingStatus.IN_PROGRESS, visit.status
        ok("starting the job starts the booking")

        print("\nAll visit-flow checks passed.")
    finally:
        await client.drop_database(CHECK_DB)
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
