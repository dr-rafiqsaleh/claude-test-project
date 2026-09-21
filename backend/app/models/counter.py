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
    BOOKING_COUNTER: "JOB",  # the job itself (stored as a booking)
    JOB_COUNTER: "RPT",  # the job's inspection report
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
        """Return the next record number, e.g. "JOB-0001".

        `prefix` overrides the built-in default, so the prefixes configured in
        company settings flow through to newly created records.
        """
        value = await cls.next_value(name)
        chosen = (prefix or "").strip().upper() or COUNTER_PREFIXES.get(
            name, name.upper()[:3]
        )
        return f"{chosen}-{value:0{width}d}"

    @classmethod
    async def peek_next(cls, name: str) -> int:
        """The value the next `next_value` call will hand out, without taking it."""
        document = await cls.get_motor_collection().find_one({"name": name})
        return int(document.get("value", 0)) + 1 if document else 1

    @classmethod
    async def move_next_to(cls, name: str, next_value: int) -> bool:
        """Make `next_value` the next number handed out.

        Never goes backwards, so a number already used can never be issued
        twice. Returns False, changing nothing, when `next_value` is behind.
        """
        collection = cls.get_motor_collection()
        if await collection.find_one({"name": name}) is None:
            await collection.insert_one({"name": name, "value": next_value - 1})
            return True
        result = await collection.update_one(
            {"name": name, "value": {"$lte": next_value - 1}},
            {"$set": {"value": next_value - 1}},
        )
        return result.matched_count == 1

    def __str__(self) -> str:
        return f"{self.name}={self.value}"
