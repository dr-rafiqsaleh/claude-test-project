"""Auto-incrementing counters used to generate human-readable record numbers."""

from beanie import Document
from pymongo import IndexModel, ReturnDocument

#: Well-known counter names. The `name` field is what separates one sequence
#: from another, so quotes and bookings each keep their own running total.
QUOTE_COUNTER = "quote"
BOOKING_COUNTER = "booking"
JOB_COUNTER = "job"
INVOICE_COUNTER = "invoice"

#: Prefix used when formatting each counter into a record number.
COUNTER_PREFIXES = {
    QUOTE_COUNTER: "QTE",
    BOOKING_COUNTER: "BKG",
    JOB_COUNTER: "JOB",
    INVOICE_COUNTER: "INV",
}


class Counter(Document):
    """A named counter, incremented atomically via findOneAndUpdate."""

    name: str  # e.g. "quote", "booking", "job", "invoice"
    value: int = 0

    class Settings:
        name = "counters"
        indexes = [
            IndexModel([("name", 1)], unique=True, name="uniq_counter_name"),
        ]

    @classmethod
    async def next_value(cls, name: str) -> int:
        """Atomically increment `name` and return the new value."""
        collection = cls.get_motor_collection()
        document = await collection.find_one_and_update(
            {"name": name},
            {"$inc": {"value": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return int(document.get("value", 1)) if document else 1

    @classmethod
    async def next_number(cls, name: str, width: int = 4, prefix: str = "") -> str:
        """Return the next record number, e.g. "BKG-0001".

        `prefix` overrides the built-in default, so the prefixes configured in
        company settings flow through to newly created records.
        """
        value = await cls.next_value(name)
        chosen = (prefix or "").strip().upper() or COUNTER_PREFIXES.get(
            name, name.upper()[:3]
        )
        return f"{chosen}-{value:0{width}d}"

    def __str__(self) -> str:
        return f"{self.name}={self.value}"
