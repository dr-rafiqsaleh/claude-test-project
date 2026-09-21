"""
One-off tidy-up: bring every booking and its job into step.

Before bookings and jobs were synced, the same visit could show as completed on
one and in progress on the other. This reconciles them. The job is the record
of the work actually done, so where the two disagree the job leads:

- job completed          -> booking completed
- job cancelled          -> booking cancelled
- job in progress        -> booking in progress (a completed booking whose
                            report was never filed goes back to "report due")
- job pending, visit started or done -> job in progress (report due)
- visit started, no job  -> job opened, in progress

Nothing is completed on your behalf, so no invoices are raised.

From the backend/ directory:

    python scripts/sync_visits.py            # dry run: show what would change
    python scripts/sync_visits.py --apply    # back up, then write the changes

--apply first saves every booking and job it will touch to
backups/visit-sync-<timestamp>.json.
"""

import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.database import close_db, init_db
from app.models.booking import Booking, BookingStatus
from app.models.job import Job, JobStatus
from app.services import job_service

BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def plan_for(booking: Booking, job: Optional[Job]) -> List[str]:
    """Describe the changes needed to bring one visit into step (empty if none)."""
    b, j = booking.status, job.status if job else None
    changes: List[str] = []

    if job is None:
        if b in (BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED):
            changes.append("open a job for the report, in progress")
            if b == BookingStatus.COMPLETED:
                changes.append("booking completed -> in progress (report due)")
        return changes

    if j == JobStatus.COMPLETED and b != BookingStatus.COMPLETED:
        changes.append(f"booking {b.value} -> completed")
    elif j == JobStatus.CANCELLED and b not in (BookingStatus.COMPLETED, BookingStatus.CANCELLED):
        changes.append(f"booking {b.value} -> cancelled")
    elif j == JobStatus.IN_PROGRESS and b != BookingStatus.IN_PROGRESS:
        if b == BookingStatus.CANCELLED:
            changes.append("NEEDS A LOOK: booking cancelled but its report is in progress - left alone")
        else:
            changes.append(f"booking {b.value} -> in progress (report due)")
    elif j == JobStatus.PENDING:
        if b == BookingStatus.CANCELLED:
            changes.append("job pending -> cancelled")
        elif b in (BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED):
            changes.append("job pending -> in progress (report due)")
            if b == BookingStatus.COMPLETED:
                changes.append("booking completed -> in progress (report due)")

    if booking.job_id != job.id and not any(c.startswith("NEEDS") for c in changes):
        changes.append("link booking to its job")
    return changes


async def apply_to(booking: Booking, job: Optional[Job]) -> None:
    """Write the changes plan_for() describes. Direct writes: no invoices, no notifications."""
    now = datetime.utcnow()

    if job is None:
        job, *_ = await job_service.create_job_from_booking(booking.id, booking.created_by)
        booking = await Booking.get(booking.id)  # create_job_from_booking saved the link

    b, j = booking.status, job.status
    report_due = False

    if j == JobStatus.COMPLETED and b != BookingStatus.COMPLETED:
        booking.status = BookingStatus.COMPLETED
        booking.actual_start = booking.actual_start or job.actual_start or booking.scheduled_start
        booking.actual_end = job.actual_end or booking.actual_end or now
    elif j == JobStatus.CANCELLED and b not in (BookingStatus.COMPLETED, BookingStatus.CANCELLED):
        booking.status = BookingStatus.CANCELLED
    elif j == JobStatus.IN_PROGRESS and b not in (BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED):
        report_due = True
    elif j == JobStatus.PENDING:
        if b == BookingStatus.CANCELLED:
            job.status = JobStatus.CANCELLED
        elif b in (BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED):
            report_due = True

    if report_due:
        started = booking.actual_start or job.actual_start or booking.scheduled_start
        booking.status = BookingStatus.IN_PROGRESS
        booking.actual_start = started
        booking.actual_end = None
        job.status = JobStatus.IN_PROGRESS
        job.actual_start = job.actual_start or started
        job.actual_end = None

    booking.job_id = job.id
    booking.touch()
    job.touch()
    await booking.save()
    await job.save()


async def main() -> None:
    apply = "--apply" in sys.argv
    await init_db()
    print(f"Database: {settings.DATABASE_NAME}  ({'APPLYING CHANGES' if apply else 'dry run - nothing will be written'})\n")

    try:
        work = []
        for booking in await Booking.find_all().sort("+booking_number").to_list():
            job = await job_service.find_job_for_booking(booking)
            changes = plan_for(booking, job)
            if changes:
                work.append((booking, job, changes))

        if not work:
            print("Every booking and job is already in step. Nothing to do.")
            return

        for booking, job, changes in work:
            label = f"{booking.booking_number} / {job.job_number if job else 'no job'}"
            print(f"{label}  (booking {booking.status.value}, job {job.status.value if job else '-'})")
            for change in changes:
                print(f"    - {change}")

        actionable = [(b, j) for b, j, c in work if not all(x.startswith("NEEDS") for x in c)]
        if not apply:
            print(f"\n{len(actionable)} visit(s) would change. Run with --apply to write them.")
            return

        BACKUP_DIR.mkdir(exist_ok=True)
        backup = BACKUP_DIR / f"visit-sync-{datetime.now():%Y%m%d-%H%M%S}.json"
        snapshot = {
            "bookings": [b.model_dump(mode="json") for b, _ in actionable],
            "jobs": [j.model_dump(mode="json") for _, j in actionable if j is not None],
        }
        backup.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
        print(f"\nBacked up {len(actionable)} visit(s) to {backup}")

        failed = 0
        for booking, job in actionable:
            try:
                await apply_to(booking, job)
            except Exception as exc:  # noqa: BLE001 - report it and carry on with the rest
                failed += 1
                print(f"  FAILED {booking.booking_number}: {exc}")
        print(f"Updated {len(actionable) - failed} visit(s).")
        if failed:
            print(f"{failed} visit(s) failed - fix the cause and run again; finished visits are skipped.")
            sys.exit(1)
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
