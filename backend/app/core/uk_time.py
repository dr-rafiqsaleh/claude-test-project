"""UK clock time for times stored in UTC.

Times are stored as naive UTC. People think in UK clock time, which is an
hour ahead during British Summer Time: from 01:00 UTC on the last Sunday in
March to 01:00 UTC on the last Sunday in October. Worked out here rather than
with zoneinfo, which has no time zone data on Windows without an extra package.
"""

from datetime import datetime, timedelta, timezone


def _last_sunday(year: int, month: int) -> datetime:
    """Midnight on the last Sunday of a month."""
    day = datetime(year, month + 1, 1) - timedelta(days=1) if month < 12 else datetime(year, 12, 31)
    return day - timedelta(days=(day.weekday() + 1) % 7)


def _in_summer_time(utc: datetime) -> bool:
    start = _last_sunday(utc.year, 3) + timedelta(hours=1)
    end = _last_sunday(utc.year, 10) + timedelta(hours=1)
    return start <= utc < end


def to_uk(value: datetime) -> datetime:
    """A stored UTC time as the clock read in the UK (naive)."""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value + timedelta(hours=1) if _in_summer_time(value) else value


def from_uk(local: datetime) -> datetime:
    """A UK clock time (naive) as UTC for storing.

    In the hour the clocks go back, the earlier (summer time) reading wins; a
    time in the hour the clocks skip in spring is treated as winter time.
    """
    summer = local - timedelta(hours=1)
    return summer if _in_summer_time(summer) else local
