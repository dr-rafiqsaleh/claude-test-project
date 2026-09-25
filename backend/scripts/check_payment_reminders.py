"""
Self-check for the automatic payment reminder: who gets one, and who does not.

Every rule in `invoice_service.due_for_payment_reminder` gets an invoice built to
sit just the wrong side of it - paid, cancelled, still a draft, already reminded,
due too far out, already overdue - and the check asserts exactly one of them is
picked up. Then it stamps that one and asserts a second pass finds nothing, which
is the "once, not every health check" promise.

Nothing is emailed. The selection is what is checked; sending is a template and a
mail server away from here, and a check that mailed real customers would be worse
than no check.

Runs against a throwaway database, which it creates and drops; your own database
is never touched. Needs MongoDB, nothing else:

    python scripts/check_payment_reminders.py

Prints each step and exits non-zero on the first failure.
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

CHECK_DB = "pestbase_reminder_check"
os.environ["DATABASE_NAME"] = CHECK_DB  # before the app reads its settings

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio  # noqa: E402

from beanie import PydanticObjectId  # noqa: E402

import re  # noqa: E402

from app.core.tenancy import acting_as  # noqa: E402
from app.database import init_db  # noqa: E402
from app.models.company_settings import (  # noqa: E402
    DEFAULT_PAYMENT_REMINDER_EMAIL,
    EMAIL_PLACEHOLDERS,
)
from app.models.invoice import Invoice, InvoiceStatus  # noqa: E402
from app.services import invoice_service  # noqa: E402
from app.services.email_service import render  # noqa: E402

CLIENT = PydanticObjectId()
CUSTOMER = PydanticObjectId()
RAISED_BY = PydanticObjectId()


def ok(message: str) -> None:
    print(f"  ok  {message}")


def check_template() -> None:
    """Every placeholder in the default wording is one the app can fill in.

    `render` leaves an unknown placeholder exactly as typed, which is the right
    behaviour - it makes a typo visible instead of silently blanking it - but it
    means a mistake here reaches a customer as the literal text {amount_due}.
    No database needed, so this runs first and fails fast.
    """
    offered = set(EMAIL_PLACEHOLDERS["common"]) | set(EMAIL_PLACEHOLDERS["payment_reminder"])

    # What the context actually carries: the invoice email's placeholders, plus
    # the one this email adds. If these drift apart, the editor in Settings is
    # offering the office something that will not be filled in.
    built = set(EMAIL_PLACEHOLDERS["invoice"]) | {"days_until_due"}
    assert set(EMAIL_PLACEHOLDERS["payment_reminder"]) == built, (
        f"declared {sorted(set(EMAIL_PLACEHOLDERS['payment_reminder']))} "
        f"but the context builds {sorted(built)}"
    )
    ok(f"Settings offers exactly what the email can fill in ({len(offered)} placeholders)")

    text = DEFAULT_PAYMENT_REMINDER_EMAIL.subject + "\n" + DEFAULT_PAYMENT_REMINDER_EMAIL.body
    used = set(re.findall(r"\{([a-z_]+)\}", text))
    unknown = sorted(used - offered)
    assert not unknown, f"the default wording uses placeholders nothing fills: {unknown}"
    ok(f"the default wording uses {len(used)} of them and invents none")

    filled = render(text, {name: f"<{name}>" for name in offered})
    left = sorted(set(re.findall(r"\{([a-z_]+)\}", filled)))
    assert not left, f"still unfilled after rendering: {left}"
    ok("rendered with every placeholder supplied, nothing is left in braces")


async def invoice(number: str, *, status: InvoiceStatus, due_in_days: float, reminded=None) -> Invoice:
    record = Invoice(
        invoice_number=number,
        customer_id=CUSTOMER,
        created_by=RAISED_BY,
        status=status,
        total=120.0,
        amount_due=120.0,
        due_date=datetime.utcnow() + timedelta(days=due_in_days),
        payment_reminder_sent_at=reminded,
    )
    await record.insert()
    return record


async def run() -> int:
    print("The wording")
    check_template()

    print()
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)
    await init_db(database_name=CHECK_DB)

    try:
        with acting_as(CLIENT):
            wanted = await invoice("INV-0001", status=InvoiceStatus.SENT, due_in_days=2)

            # One per rule, each just outside it.
            await invoice("INV-0002", status=InvoiceStatus.PAID, due_in_days=2)
            await invoice("INV-0003", status=InvoiceStatus.DRAFT, due_in_days=2)
            await invoice("INV-0004", status=InvoiceStatus.CANCELLED, due_in_days=2)
            await invoice("INV-0005", status=InvoiceStatus.SENT, due_in_days=10)
            await invoice("INV-0006", status=InvoiceStatus.SENT, due_in_days=-1)
            await invoice(
                "INV-0007",
                status=InvoiceStatus.SENT,
                due_in_days=2,
                reminded=datetime.utcnow() - timedelta(hours=1),
            )
            partly = await invoice(
                "INV-0008", status=InvoiceStatus.PARTIALLY_PAID, due_in_days=1
            )

            print("Who is due a reminder")
            due = await invoice_service.due_for_payment_reminder()
            numbers = sorted(record.invoice_number for record in due)
            expected = ["INV-0001", "INV-0008"]
            assert numbers == expected, f"expected {expected}, got {numbers}"
            ok("an unpaid invoice due in 2 days is picked up")
            ok("so is a partially paid one - it still owes money")
            ok("paid, draft and cancelled invoices are left alone")
            ok("due in 10 days is too early; already overdue is too late")
            ok("one already reminded is not reminded again")

            print("\nOnce, not on every sweep")
            for record in (wanted, partly):
                record.payment_reminder_sent_at = datetime.utcnow()
                await record.save()
            again = await invoice_service.due_for_payment_reminder()
            assert again == [], f"expected nothing on the second pass, got {len(again)}"
            ok("stamping the invoice empties the queue")

            print("\nThe window is three days")
            assert invoice_service.PAYMENT_REMINDER_DAYS == 3
            edge = await invoice(
                "INV-0009",
                status=InvoiceStatus.SENT,
                due_in_days=invoice_service.PAYMENT_REMINDER_DAYS + 0.5,
            )
            assert await invoice_service.due_for_payment_reminder() == []
            edge.due_date = datetime.utcnow() + timedelta(days=2.9)
            await edge.save()
            inside = await invoice_service.due_for_payment_reminder()
            assert [r.invoice_number for r in inside] == ["INV-0009"], inside
            ok("3.5 days out is not reminded; 2.9 days out is")

        print("\nPASS  the reminder goes to exactly the right invoices, once each")
        return 0
    finally:
        client = await init_db(database_name=CHECK_DB)
        await client.drop_database(CHECK_DB)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
