"""
Self-check for repeating jobs and telling technicians about new jobs.

Runs the real route handlers against a throwaway database, which it creates
and drops - your own database is never touched. Emails go to a small fake
mail server started here. From the backend/ directory:

    python scripts/check_recurring.py

Prints each step and exits non-zero on the first failure.
"""

import asyncio
import sys
from datetime import datetime, timedelta
from email import message_from_bytes, policy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from beanie import PydanticObjectId
from check_email import FakeMailServer  # noqa: E402 - the same fake server

from app.core.uk_time import from_uk, to_uk
from app.core.tenancy import set_current_client
from app.database import init_db
from app.models.booking import Booking, BookingStatus, RecurrenceType
from app.models.platform_settings import EmailProvider, SmtpSecurity
from app.models.customer import Address, Customer
from app.models.notification import Notification, NotificationType
from app.models.user import User, UserRole
from app.routers.bookings import create_booking, get_booking, stop_repeating, update_booking
from app.schemas.booking import BookingCreate, BookingUpdate
from app.services import notification_service, platform_settings_service, recurrence_service

CHECK_DB = "pestbase_recurring_check"


def ok(message: str) -> None:
    print(f"  ok  {message}")


def uk(year, month, day, hour=10, minute=0) -> datetime:
    """A UK clock time, as stored (UTC)."""
    return from_uk(datetime(year, month, day, hour, minute))


async def series(head_id) -> list:
    return await Booking.find({"parent_booking_id": PydanticObjectId(str(head_id))}).sort("scheduled_start").to_list()


async def main() -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)  # clear leftovers from an interrupted run
    await init_db(database_name=CHECK_DB)  # recreate the indexes
    # Everything a client owns is scoped to a client since multi-client support;
    # this run acts as one throwaway client, as check_payment_reminders does.
    set_current_client(PydanticObjectId())
    server = FakeMailServer()
    server.start()

    try:
        office = User(email="office@check.test", full_name="Olive Office", role=UserRole.OFFICE_STAFF)
        tom = User(email="tom@check.test", full_name="Tom Tech", role=UserRole.TECHNICIAN)
        tara = User(email="tara@check.test", full_name="Tara Tech", role=UserRole.TECHNICIAN)
        for user in (office, tom, tara):
            await user.insert()
        customer = Customer(
            first_name="Lena", last_name="Landlord", phone="0151 496 0000", email="lena@example.com",
            address=Address(street="1 Owner Street", city="Liverpool", postcode="L1 1AA"), created_by=office.id,
        )
        await customer.insert()

        def booking(start: datetime, recurrence=RecurrenceType.MONTHLY, **extra) -> BookingCreate:
            return BookingCreate(
                customer_id=str(customer.id), technician_id=str(tom.id), scheduled_start=start,
                scheduled_end=start + timedelta(hours=1), service_type="Rodent Control",
                pest_types=["Mouse"], recurrence=recurrence, **extra,
            )

        print("Telling the technician, before email is set up")
        one_off = await create_booking(booking(uk(2026, 11, 2), RecurrenceType.NONE), current_user=office)
        assert any("can see it in PestBase" in notice for notice in one_off.data.notices), one_off.data.notices
        note = await Notification.find_one({"user_id": tom.id, "type": NotificationType.JOB_ASSIGNED.value})
        assert note is not None and note.link == f"/bookings/{one_off.data.id}"
        ok("a one-off job shows in the technician's notifications, and says email isn't set up")

        # Mail is sent with the platform's settings (Platform > Settings), not a client's.
        await platform_settings_service.update_settings(
            {
                "email_provider": EmailProvider.SMTP, "smtp_host": "127.0.0.1", "smtp_port": server.port,
                "smtp_security": SmtpSecurity.NONE, "smtp_from_email": "accounts@example.com",
            }
        )

        print("A monthly job")
        created = await create_booking(booking(uk(2027, 1, 31)), current_user=office)
        head_id = created.data.id
        visits = await series(head_id)
        assert len(visits) == 11, len(visits)
        assert all(visit.status == BookingStatus.SCHEDULED for visit in visits)
        assert any("11 more visits booked ahead" in notice for notice in created.data.notices), created.data.notices
        ok("booking it books the next 11 months as tentative visits: a year of 12")

        days = [to_uk(visit.scheduled_start).day for visit in visits[:3]]
        assert days == [28, 31, 30], days
        clock = {to_uk(visit.scheduled_start).strftime("%H:%M") for visit in visits}
        assert clock == {"10:00"}, clock
        ok("31 January repeats on 28 February, 31 March, 30 April; always 10:00, summer time or not")

        recipients, raw = server.received[-1]
        message = message_from_bytes(raw, policy=policy.default)
        body = message.get_body(preferencelist=("plain",)).get_content()
        assert recipients == ["tom@check.test"], recipients
        assert "monthly job: 11 more visits" in body and "/bookings/" in body, body
        assert len(server.received) == 1
        ok("Tom gets one email for the whole series, with a link to the job")

        page = await get_booking(visits[2].id.__str__(), current_user=office)
        assert page.data.is_tentative and page.data.series_head_number == created.data.booking_number
        assert page.data.series_upcoming == 11 and page.data.series_recurrence == RecurrenceType.MONTHLY
        ok("a later visit's page knows its series and that it still needs confirming")

        print("Changing visits")
        confirmed = visits[5]
        confirmed.status = BookingStatus.CONFIRMED
        await confirmed.save()
        moved = await update_booking(
            str(visits[3].id),
            BookingUpdate(scheduled_start=uk(2027, 5, 31, 14), scheduled_end=uk(2027, 5, 31, 15), apply_to_series=True),
            _current_user=office,
        )
        after = await series(head_id)
        times = [to_uk(visit.scheduled_start).strftime("%H:%M") for visit in after]
        assert times[:3] == ["10:00"] * 3 and times[3] == "14:00", times
        assert times[5] == "10:00", "a confirmed visit must stay where it is"
        assert all(time == "14:00" for index, time in enumerate(times[4:], start=4) if index != 5), times
        assert any("later unconfirmed visit" in notice for notice in moved.data.notices), moved.data.notices
        ok("moving a visit to 14:00 for the rest of the series leaves earlier and confirmed visits alone")

        skipped = after[1]
        await skipped.delete()
        await recurrence_service.extend_all_series()
        assert len(await series(head_id)) == 10
        ok("a deleted visit (a month the customer skipped) is not booked again")

        await update_booking(str(after[6].id), BookingUpdate(technician_id=str(tara.id)), _current_user=office)
        assert server.received[-1][0] == ["tara@check.test"]
        emails = len(server.received)
        await update_booking(str(after[6].id), BookingUpdate(technician_notes="Bring the long ladder"), _current_user=office)
        assert len(server.received) == emails
        ok("handing a visit to Tara emails her; editing it again without changing technician does not")

        print("Changing and stopping the series")
        changed = await update_booking(head_id, BookingUpdate(recurrence=RecurrenceType.QUARTERLY), _current_user=office)
        remaining = await series(head_id)
        assert any("rebooked" in notice for notice in changed.data.notices), changed.data.notices
        assert confirmed.id in {visit.id for visit in remaining}, "the confirmed visit must be kept"
        assert all(
            visit.status != BookingStatus.SCHEDULED or visit.scheduled_start > confirmed.scheduled_start
            for visit in remaining
        )
        ok("switching to quarterly rebooks the unconfirmed visits after the confirmed one, and keeps it")

        stopper = remaining[0]
        stopped = await stop_repeating(str(stopper.id), _current_user=office)
        left = await series(head_id)
        later = [visit for visit in left if visit.scheduled_start > stopper.scheduled_start]
        assert all(visit.status == BookingStatus.CONFIRMED for visit in later), [v.status for v in later]
        assert "unconfirmed visit(s) removed" in stopped.message, stopped.message
        assert await recurrence_service.extend_all_series() == 0
        ok(f"stop repeating: '{stopped.message}'")

        print("Topping up")
        weekly = await create_booking(booking(uk(2026, 10, 5), RecurrenceType.WEEKLY), current_user=office)
        count = len(await series(weekly.data.id))
        head = await Booking.get(PydanticObjectId(weekly.data.id))
        # A fixed "a month later", not today plus 30 days: the expected count
        # below depends on the date, and must not change with the day it runs.
        added = await recurrence_service.extend_series(head, now=uk(2026, 10, 22))
        # From 5 October: every week up to (not including) 5 October next year.
        assert count == 52, count
        # Thirty days on, the year ahead reaches 22 October: two more weeks.
        assert len(added) == 2, len(added)
        ok("a weekly job books 52 more visits; a month later the sweep adds 2 to stay a year ahead")

        old = Booking(
            booking_number="JOB-OLD-1", customer_id=customer.id, scheduled_start=uk(2026, 10, 1),
            scheduled_end=uk(2026, 10, 1, 11), service_type="Rodent Control", recurrence=RecurrenceType.MONTHLY,
            created_by=office.id,
        )
        await old.insert()
        await notification_service.sweep_notifications()
        assert len(await series(old.id)) == 11
        ok("a monthly job saved before this change gets its visits from the reminder sweep")

        ended = await create_booking(booking(uk(2026, 10, 7), recurrence_until=datetime(2027, 1, 7)), current_user=office)
        assert len(await series(ended.data.id)) == 3
        ok("with 'repeat until 7 January', a monthly job stops at 7 January")

        print("From the booking form")
        # The portal sends ISO strings with an offset. Kept aware, they met naive
        # UTC further in and creating a repeating job failed with a 500.
        form = BookingCreate(
            customer_id=str(customer.id), technician_id=str(tom.id),
            scheduled_start="2027-03-01T10:00:00.000Z", scheduled_end="2027-03-01T11:00:00.000Z",
            service_type="Rodent Control", recurrence=RecurrenceType.WEEKLY,
            recurrence_until="2027-03-29T00:00:00.000Z",
        )
        assert form.scheduled_start.tzinfo is None and form.scheduled_start.hour == 10, form.scheduled_start
        from_form = await create_booking(form, current_user=office)
        assert len(await series(from_form.data.id)) == 4, len(await series(from_form.data.id))
        ok("a repeating job sent as the portal sends it (UTC, with a 'Z') books its series")
    finally:
        server.stop()
        await client.drop_database(CHECK_DB)

    print("\nAll repeating-job checks passed.")


if __name__ == "__main__":
    asyncio.run(main())
