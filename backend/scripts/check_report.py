"""
Self-check for the inspection & treatment report.

Fills in a report the way a technician would on a follow-up rodent visit,
using the real route handlers and services against a throwaway database, which
it creates and drops - your own database is never touched. Then renders the
PDF. From the backend/ directory:

    python scripts/check_report.py [path/to/save/report.pdf]

Prints each step and exits non-zero on the first failure.
"""

import asyncio
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from beanie import PydanticObjectId

from app.core.tenancy import set_current_client
from app.database import init_db
from app.models.booking import Booking, BookingStatus
from app.models.company_settings import ProductCategory
from app.models.customer import Address, Customer
from app.models.job import (
    ActivityLevel,
    AssessmentAnswer,
    BaitStatus,
    HygieneRating,
    Job,
    JobStatus,
    ResponsibleParty,
    TreatmentMethod,
    VisitType,
)
from app.models.user import User, UserRole
from app.schemas.booking import BookingResponse
from app.schemas.company_settings import (
    CompanySettingsResponse,
    CompanySettingsUpdate,
    ProductSchema,
)
from app.schemas.job import (
    InspectionFindingSchema,
    JobResponse,
    JobSignatureUpdate,
    JobUpdate,
    ReportAssessmentsSchema,
    TreatmentAppliedSchema,
)
from app.schemas.user import UserResponse
from app.services import (
    booking_service,
    company_settings_service,
    invoice_service,
    job_service,
)

CHECK_DB = "pestbase_report_check"

#: A 1x1 transparent PNG, standing in for a drawn signature.
SIGNATURE = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def ok(message: str) -> None:
    print(f"  ok  {message}")


async def make_booking(office: User, tech: User, customer: Customer, number: str, when: datetime) -> Booking:
    booking = Booking(
        booking_number=number,
        customer_id=customer.id,
        technician_id=tech.id,
        scheduled_start=when,
        scheduled_end=when + timedelta(hours=1),
        service_type="Rodent Control",
        pest_types=["Mouse"],
        site_contact_name="Sam Tenant",
        site_contact_phone="07700 900123",
        order_number="PO-7781",
        created_by=office.id,
    )
    await booking.insert()
    return booking


async def main(save_to: Path | None) -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)  # clear leftovers from an interrupted run
    await init_db(database_name=CHECK_DB)  # recreate the indexes
    # Everything a client owns is scoped to a client since multi-client support;
    # this run acts as one throwaway client, as check_payment_reminders does.
    set_current_client(PydanticObjectId())

    try:
        office = User(email="office@check.test", full_name="Olive Office", role=UserRole.OFFICE_STAFF)
        tech = User(
            email="tech@check.test",
            full_name="Tom Tech",
            job_title="Senior Technician",
            role=UserRole.TECHNICIAN,
        )
        for user in (office, tech):
            await user.insert()
        customer = Customer(
            first_name="Lena",
            last_name="Landlord",
            phone="0151 496 0000",
            email="lena@example.com",
            address=Address(street="31 Example Road", city="Liverpool", county="Merseyside", postcode="L1 1AA"),
            created_by=office.id,
        )
        await customer.insert()

        print("Settings")
        settings = await company_settings_service.update_settings(
            CompanySettingsUpdate(
                products=[
                    ProductSchema(
                        name="Mouse bait box",
                        category=ProductCategory.RODENTICIDE,
                        active_ingredient="Difenacoum 0.005%",
                        formulation="Pre-filled bait box",
                        registration_number="HSE 1234",
                    )
                ]
            )
        )
        product = settings.products[0]
        assert product.id, "a new product should be given an id"
        assert settings.report_rodenticide_guidance, "the rodenticide advice should have a default"
        response = CompanySettingsResponse.model_validate(
            company_settings_service.build_settings_payload(settings)
        )
        assert response.products[0].registration_number == "HSE 1234"
        ok("a product is added to the list and given an id; report wording has defaults")

        # Saving the list again keeps each product's id, so reports can refer to it.
        settings = await company_settings_service.update_settings(
            CompanySettingsUpdate(products=[ProductSchema(**product.model_dump())])
        )
        assert settings.products[0].id == product.id
        ok("re-saving the list keeps product ids")

        print("Jobs and team")
        now = datetime.utcnow()
        first = await make_booking(office, tech, customer, "JOB-CHK-1", now - timedelta(days=14))
        booking_json = BookingResponse.model_validate(
            booking_service.build_booking_payload(first, customer, tech, None)
        )
        assert booking_json.site_contact_phone == "07700 900123" and booking_json.order_number == "PO-7781"
        assert UserResponse.model_validate(tech).job_title == "Senior Technician"
        ok("jobs carry a site contact and order number; users carry a job title")

        print("Visit type guess")
        first_job, *_ = await job_service.create_job_from_booking(first.id, office.id)
        assert first_job.visit_type == VisitType.INITIAL, first_job.visit_type
        assert first_job.pests_found == ["Mouse"], first_job.pests_found
        ok("a first visit is guessed as Initial, with the booked pests pre-ticked")

        first_job.status = JobStatus.COMPLETED
        await first_job.save()
        second = await make_booking(office, tech, customer, "JOB-CHK-2", now)
        job, *_ = await job_service.create_job_from_booking(second.id, office.id)
        assert job.visit_type == VisitType.FOLLOW_UP, job.visit_type
        ok("a return visit to the same site within 90 days is guessed as Follow-up")

        print("Filling in the report")
        job, *_ = await job_service.update_status(job.id, JobStatus.IN_PROGRESS, office.id)
        job, *_ = await job_service.update_job(
            job.id,
            JobUpdate(
                activity_level=ActivityLevel.HIGH,
                pests_found=["Mouse", " mouse ", "Rat"],
                inspection_notes="Follow-up visit. Full internal inspection; the tenant reported a mouse in room 2.",
                findings=[
                    InspectionFindingSchema(
                        area="Kitchen",
                        pest_type="Mouse",
                        severity="high",
                        evidence=["Droppings", "Gnawing", "Droppings"],
                        description="3 bait points from the last visit eaten; gaps behind the cooker.",
                        recommendation="Seal the gaps behind the cooker as soon as possible.",
                        responsible_party=ResponsibleParty.LANDLORD,
                    )
                ],
                hygiene_rating=HygieneRating.POOR,
                hygiene_notes="Food debris behind appliances.",
                proofing_notes="Several entry points behind the cooking area.",
                action_taken="6 bait boxes deposited, one in each room.",
                treatments=[
                    TreatmentAppliedSchema(
                        pest_type="Mouse",
                        method=TreatmentMethod.BAIT,
                        product_id=product.id,
                        product_name=product.name,
                        product_category=product.category,
                        active_ingredient=product.active_ingredient,
                        formulation=product.formulation,
                        registration_number=product.registration_number,
                        quantity_used="6 boxes",
                        areas_treated=["Kitchen", "Bedroom"],
                        bait_status=BaitStatus.DEPOSITED,
                    )
                ],
                recommendations="Deep clean the kitchen; proof the gaps.",
                follow_up_required=True,
                next_service_due=now + timedelta(days=14),
                assessments=ReportAssessmentsSchema(
                    risk_assessment=AssessmentAnswer.YES,
                    coshh_assessment=AssessmentAnswer.YES,
                    environmental_assessment=AssessmentAnswer.YES,
                    site_plan=AssessmentAnswer.NOT_APPLICABLE,
                ),
            ),
        )
        assert job.pests_found == ["Mouse", "Rat"], job.pests_found
        assert job.findings[0].evidence == ["Droppings", "Gnawing"], job.findings[0].evidence
        assert job.treatments[0].registration_number == "HSE 1234"
        assert job.assessments.site_plan == AssessmentAnswer.NOT_APPLICABLE
        ok("every new field saves, with duplicate pests and evidence tidied away")

        _job, customer_row, tech_row, booking_row = await job_service.get_job(job.id)
        payload = JobResponse.model_validate(job_service.build_job_payload(job, customer_row, tech_row, booking_row))
        assert payload.site_contact_name == "Sam Tenant" and payload.order_number == "PO-7781"
        assert payload.technician_job_title == "Senior Technician"
        ok("the report carries the site contact, order number and technician's job title")

        assert job_service.treatment_category(job.treatments[0]) == ProductCategory.RODENTICIDE
        typed = TreatmentAppliedSchema(pest_type="Rat", method=TreatmentMethod.BAIT, product_name="Typed in")
        assert job_service.treatment_category(typed) == ProductCategory.RODENTICIDE
        sprayed = TreatmentAppliedSchema(pest_type="Cockroach", method=TreatmentMethod.SPRAY)
        assert job_service.treatment_category(sprayed) == ProductCategory.INSECTICIDE
        trapped = TreatmentAppliedSchema(pest_type="Mouse", method=TreatmentMethod.TRAP)
        assert job_service.treatment_category(trapped) is None
        ok("safety advice follows the products used: rodenticide, insecticide, or none for traps")

        print("Sign-off and PDF")
        job, *_ = await job_service.update_job(
            job.id, JobUpdate(customer_unable_to_sign=True, customer_unable_reason="Tenant not at home")
        )
        job, *_ = await job_service.update_signature(job.id, JobSignatureUpdate(technician_signature=SIGNATURE))
        job, *_ = await job_service.update_status(job.id, JobStatus.COMPLETED, office.id)
        assert job.status == JobStatus.COMPLETED
        pdf, number = await job_service.generate_report_pdf(job.id)
        assert pdf.startswith(b"%PDF") and number == job.job_number
        ok(f"a completed report renders as a PDF ({len(pdf) // 1024} KB)")

        assert job.invoice_id is not None, "completing the job should raise an invoice"
        invoice_pdf, _ = await invoice_service.generate_invoice_pdf(job.invoice_id)
        assert invoice_pdf.startswith(b"%PDF")
        ok("its invoice renders too")
        if save_to is not None:
            save_to.with_name(f"{save_to.stem}-invoice.pdf").write_bytes(invoice_pdf)

        empty_booking = await make_booking(office, tech, customer, "JOB-CHK-3", now + timedelta(days=1))
        empty, *_ = await job_service.create_job_from_booking(empty_booking.id, office.id)
        empty_pdf, _ = await job_service.generate_report_pdf(empty.id)
        assert empty_pdf.startswith(b"%PDF")
        assert not job_service.report_has_content(empty)
        empty.activity_level = ActivityLevel.NONE
        assert job_service.report_has_content(empty)
        ok("an empty draft still renders; 'no activity' on its own is enough to complete")

        if save_to is not None:
            save_to.write_bytes(pdf)
            print(f"\nSaved the report to {save_to}")
    finally:
        await client.drop_database(CHECK_DB)

    print("\nAll report checks passed.")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1]) if len(sys.argv) > 1 else None))
