"""JSON responses whose times say they are UTC.

Every time PestBase stores is naive UTC (Mongo hands them back that way), and
pydantic serialises a naive datetime as "2026-09-28T07:15:00" - no offset. A
browser reads that as *local* time, so in British Summer Time every such time
showed an hour early, and "5 minutes ago" read "about 1 hour ago".

Bookings, invoices and jobs had fixed this schema by schema (UtcDateTime);
support access, notifications, the audit trail and others had not. Doing it
here, once, on the way out, covers every endpoint - including the next one.
"""

import re
from typing import Any

from fastapi.responses import JSONResponse

#: A full ISO date-time with no offset. Dates alone ("2026-09-28") are left
#: alone: they are days, not instants.
_NAIVE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$")


def mark_utc(value: Any) -> Any:
    """`value` with every offset-less ISO date-time string marked as UTC."""
    if isinstance(value, str):
        return value + "Z" if _NAIVE_ISO.match(value) else value
    if isinstance(value, dict):
        return {key: mark_utc(item) for key, item in value.items()}
    if isinstance(value, list):
        return [mark_utc(item) for item in value]
    return value


class UtcJSONResponse(JSONResponse):
    """The app's default response class. See the module docstring."""

    def render(self, content: Any) -> bytes:
        return super().render(mark_utc(content))
