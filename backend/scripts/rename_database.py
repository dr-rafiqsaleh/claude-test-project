"""Copy the database under a new name, so `qkil_db` can stop existing.

MongoDB has no "rename database", so this copies collection by collection into a
new database and leaves the old one exactly where it is. Nothing is deleted and
nothing is edited, which makes the whole thing reversible by putting one line in
backend/.env back.

Indexes are not copied: the app declares them and rebuilds them on startup, and
`init_db` reconciles any that have changed.

Report what would be copied (changes nothing):

    docker compose -p pestbase-local exec backend python scripts/rename_database.py

Then do it, stop the stack, point backend/.env at the new name, and start again:

    docker compose -p pestbase-local exec backend python scripts/rename_database.py --yes
    # edit backend/.env:  DATABASE_NAME=pestbase_db
    .\\scripts\\compose.ps1 local up -d

Once the portal is working on the new database, drop the old one yourself:

    docker compose -p pestbase-local exec mongo mongosh qkil_db --eval "db.dropDatabase()"
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import settings  # noqa: E402

BATCH = 1000


async def run(source_name: str, target_name: str, apply: bool) -> int:
    if source_name == target_name:
        print(f"Source and target are both '{source_name}'. Nothing to do.")
        return 2

    client = AsyncIOMotorClient(settings.MONGODB_URL)
    try:
        existing = await client.list_database_names()
        if source_name not in existing:
            print(f"There is no database called '{source_name}'.")
            print(f"Databases here: {', '.join(sorted(existing))}")
            return 2

        source = client[source_name]
        target = client[target_name]
        names = sorted(await source.list_collection_names())
        if not names:
            print(f"'{source_name}' has no collections.")
            return 2

        total = 0
        for name in names:
            count = await source[name].count_documents({})
            total += count
            print(f"  {name}: {count}")

        if target_name in existing:
            occupied = sorted(await target.list_collection_names())
            if occupied:
                print(f"\n'{target_name}' already exists and is not empty: {', '.join(occupied)}")
                print("Refusing to merge two databases. Drop it first, or pick another --to.")
                return 2

        if not apply:
            print(f"\n{total} documents in {len(names)} collection(s) would be copied")
            print(f"from '{source_name}' to '{target_name}'. Nothing has changed.")
            print("Re-run with --yes to copy.")
            return 0

        print()
        for name in names:
            batch = []
            copied = 0
            async for document in source[name].find({}):
                batch.append(document)
                if len(batch) >= BATCH:
                    await target[name].insert_many(batch, ordered=False)
                    copied += len(batch)
                    batch = []
            if batch:
                await target[name].insert_many(batch, ordered=False)
                copied += len(batch)

            # Count on the target rather than trusting the loop: this is the only
            # moment anyone will ever check, and a short copy must be loud.
            landed = await target[name].count_documents({})
            source_count = await source[name].count_documents({})
            state = "ok" if landed == source_count else f"MISMATCH (source has {source_count})"
            print(f"  {name}: {landed} copied - {state}")
            if landed != source_count:
                print(f"\nStopped: '{name}' did not copy completely. '{source_name}' is untouched.")
                return 1

        print(f"\nCopied {total} documents into '{target_name}'. '{source_name}' is untouched.")
        print(f"Now set DATABASE_NAME={target_name} in backend/.env and restart the stack.")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="source", default="qkil_db", help="Database to copy from")
    parser.add_argument("--to", dest="target", default="pestbase_db", help="Database to copy into")
    parser.add_argument("--yes", action="store_true", help="Actually copy")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.source, args.target, args.yes)))
