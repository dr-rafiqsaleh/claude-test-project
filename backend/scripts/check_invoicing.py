"""
Self-check for invoicing settings: the VAT switch, bank details, the
registered company name and the next invoice number.

Runs the real services against a throwaway database, which it creates and
drops - your own database is never touched. From the backend/ directory:

    python scripts/check_invoicing.py [folder/to/save/pdfs]

Prints each step and exits non-zero on the first failure.
"""

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import ValidationError

from app.database import init_db
from app.models.booking import Booking
from app.models.customer import Address, Customer
from app.models.job import ActivityLevel, Job, JobStatus
from app.models.user import User, UserRole
from app.schemas.company_settings import CompanySettingsUpdate
from app.schemas.invoice import InvoiceCreate, InvoiceItemSchema
from app.schemas.job import JobUpdate
from app.schemas.quote import QuoteCreate, QuoteItemSchema
from app.services import company_settings_service, invoice_service, job_service, pdf_branding, quote_service
from app.services.company_settings_service import SettingsError

CHECK_DB = "pestbase_invoicing_check"


def ok(message: str) -> None:
    print(f"  ok  {message}")


async def completed_job_invoice(office: User, customer: Customer, number, price: float):
    """Complete a priced job, which raises its draft invoice.

    With `number` None, the job takes the next job number like a real booking.
    """
    from app.services.booking_service import get_next_booking_number  # noqa: PLC0415

    start = datetime.utcnow() - timedelta(hours=2)
    booking = Booking(
        booking_number=number or await get_next_booking_number(),
        customer_id=customer.id,
        scheduled_start=start,
        scheduled_end=start + timedelta(hours=1),
        service_type="Rodent Control",
        pest_types=["Mouse"],
        quoted_amount=price,
        service_address={"street": "9 Rental Row", "city": "Liverpool", "postcode": "L1 2AB"},
        created_by=office.id,
    )
    await booking.insert()
    job, *_ = await job_service.create_job_from_booking(booking.id, office.id)
    await job_service.update_status(job.id, JobStatus.IN_PROGRESS, office.id)
    await job_service.update_job(job.id, JobUpdate(activity_level=ActivityLevel.LOW))
    job, *_ = await job_service.update_status(job.id, JobStatus.COMPLETED, office.id)
    invoice, *_ = await invoice_service.get_invoice(job.invoice_id)
    return invoice


async def main(save_to: Path | None) -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)  # clear leftovers from an interrupted run
    await init_db(database_name=CHECK_DB)  # recreate the indexes

    try:
        office = User(email="office@check.test", full_name="Olive Office", role=UserRole.OFFICE_STAFF)
        await office.insert()
        customer = Customer(
            first_name="Lena",
            last_name="Landlord",
            phone="0151 496 0000",
            address=Address(street="1 Owner Street", city="Liverpool", postcode="L1 1AA"),
            created_by=office.id,
        )
        await customer.insert()

        print("Bank details and company name")
        settings = await company_settings_service.update_settings(
            CompanySettingsUpdate(
                company_name="PestBase Pest Control",
                legal_name="Example Pest Ltd",
                company_number="01234567",
                vat_number="GB999999973",  # kept, but unused until registered
                bank_account_name="Example Pest Ltd",
                bank_sort_code="12 34 56",
                bank_account_number="1234567",
            )
        )
        assert settings.bank_sort_code == "12-34-56", settings.bank_sort_code
        assert settings.bank_account_number == "01234567", settings.bank_account_number
        ok("a sort code is written 12-34-56, and a 7-digit account gets its leading 0")

        for bad in ({"bank_sort_code": "12345"}, {"bank_account_number": "12AB5678"}):
            try:
                CompanySettingsUpdate(**bad)
            except ValidationError:
                continue
            raise AssertionError(f"{bad} should have been refused")
        ok("a malformed sort code or account number is refused")

        branding = await company_settings_service.get_settings_for_pdf()
        line = pdf_branding.identity_line(branding)
        assert line.startswith("A trading name of Example Pest Ltd"), line
        assert "VAT" not in line, line
        ok(f"the small print reads '{line}', with no VAT number while not registered")

        print("Not VAT registered")
        invoice = await completed_job_invoice(office, customer, "JOB-CHK-1", 120.0)
        assert invoice.tax_amount == 0 and invoice.total == 120.0, (invoice.tax_amount, invoice.total)
        assert [item.description for item in invoice.items] == ["Pest control: Rodent Control"]
        assert invoice.notes is None
        ok("a 120 pound job raises a 120 pound invoice: one line, no VAT, no internal note")

        manual, *_ = await invoice_service.create_invoice(
            InvoiceCreate(
                customer_id=str(customer.id),
                items=[InvoiceItemSchema(description="Wasp nest", unit_price=60, tax_rate=0.2)],
            ),
            office.id,
        )
        assert manual.tax_amount == 0 and manual.total == 60, (manual.tax_amount, manual.total)
        ok("an invoice typed in with 20% VAT is saved without it")

        quote, _ = await quote_service.create_quote(
            QuoteCreate(
                customer_id=str(customer.id),
                items=[QuoteItemSchema(description="Rodent treatment", unit_price=120)],
                tax_rate=0.2,
            ),
            office.id,
        )
        assert quote.tax_rate == 0 and quote.total == 120, (quote.tax_rate, quote.total)
        ok("so is a quote")

        pdf, _ = await invoice_service.generate_invoice_pdf(invoice.id)
        assert b"(Invoice " in pdf and b"Tax Invoice" not in pdf
        ok("the invoice PDF is a plain 'Invoice', not a 'Tax Invoice'")
        quote_pdf, _ = await quote_service.generate_pdf(quote.id)
        assert quote_pdf.startswith(b"%PDF")
        ok("the quote PDF renders without a VAT line")
        if save_to is not None:
            (save_to / "invoice-no-vat.pdf").write_bytes(pdf)
            (save_to / "quote-no-vat.pdf").write_bytes(quote_pdf)

        print("Next invoice number")
        await company_settings_service.update_settings(CompanySettingsUpdate(next_invoice_number=52))
        payload = await company_settings_service.settings_payload(await company_settings_service.get_settings())
        assert payload["next_invoice_number"] == 52, payload["next_invoice_number"]
        after_move = await completed_job_invoice(office, customer, "JOB-CHK-2", 80.0)
        assert after_move.invoice_number == "INV-0052", after_move.invoice_number
        ok("after setting it to 52, the next invoice is INV-0052")

        try:
            await company_settings_service.update_settings(
                CompanySettingsUpdate(next_invoice_number=10, company_name="Changed")
            )
        except SettingsError as exc:
            ok(f"going back to 10 is refused: {exc}")
        else:
            raise AssertionError("moving the invoice number backwards should be refused")
        assert (await company_settings_service.get_settings()).company_name == "PestBase Pest Control"
        ok("and a refused number saves nothing else either")

        await company_settings_service.update_settings(
            CompanySettingsUpdate(next_quote_number=40, next_job_number=300, next_report_number=250)
        )
        quote, _ = await quote_service.create_quote(
            QuoteCreate(customer_id=str(customer.id), items=[QuoteItemSchema(description="Survey", unit_price=50)]),
            office.id,
        )
        numbered = await completed_job_invoice(office, customer, None, 60.0)
        job_row = await Job.get(numbered.job_id)
        booking_row = await Booking.get(job_row.booking_id)
        assert quote.quote_number == "QTE-0040", quote.quote_number
        assert booking_row.booking_number == "JOB-0300", booking_row.booking_number
        assert job_row.job_number == "RPT-0250", job_row.job_number
        ok("quotes, jobs and reports follow their own next numbers too: QTE-0040, JOB-0300, RPT-0250")

        try:
            await company_settings_service.update_settings(
                CompanySettingsUpdate(next_quote_number=100, next_report_number=5)
            )
        except SettingsError as exc:
            assert "Report number 250" in str(exc), exc
        else:
            raise AssertionError("moving the report number backwards should be refused")
        payload = await company_settings_service.settings_payload(await company_settings_service.get_settings())
        assert payload["next_quote_number"] == 41, "a refused change must not move the others"
        ok("one refused number leaves the others where they were")

        print("VAT registered")
        await company_settings_service.update_settings(
            CompanySettingsUpdate(vat_registered=True, default_tax_rate=0.2)
        )
        vat_invoice = await completed_job_invoice(office, customer, "JOB-CHK-3", 100.0)
        assert vat_invoice.tax_amount == 20 and vat_invoice.total == 120, (
            vat_invoice.tax_amount,
            vat_invoice.total,
        )
        ok("once registered, a 100 pound job raises 100 + 20 VAT")

        line = pdf_branding.identity_line(await company_settings_service.get_settings_for_pdf())
        assert "VAT No: GB999999973" in line, line
        vat_pdf, _ = await invoice_service.generate_invoice_pdf(vat_invoice.id)
        assert b"Tax Invoice" in vat_pdf
        ok("its PDF is a 'Tax Invoice' showing the VAT number")

        await company_settings_service.update_settings(CompanySettingsUpdate(vat_registered=False))
        old_pdf, _ = await invoice_service.generate_invoice_pdf(vat_invoice.id)
        assert b"Tax Invoice" in old_pdf
        ok("an invoice that charged VAT stays a VAT invoice if the setting changes later")
        if save_to is not None:
            (save_to / "invoice-vat.pdf").write_bytes(vat_pdf)
    finally:
        await client.drop_database(CHECK_DB)

    print("\nAll invoicing checks passed.")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1]) if len(sys.argv) > 1 else None))
