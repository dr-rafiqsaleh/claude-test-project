"""
Quick-start script: creates just the admin user if it doesn't exist.
Run this from the backend/ directory with your venv active:

    python scripts/create_admin.py

Use this if the full seed.py fails or you just need the admin account fast.
"""

import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.core.security import hash_password
from app.database import close_db, init_db
from app.models.user import User, UserRole


async def main():
    print(f"Connecting to {settings.MONGODB_URL} / {settings.DATABASE_NAME} ...")
    await init_db()

    email = "admin@qkil.com"
    existing = await User.find_one(User.email == email)

    if existing:
        print(f"Admin user already exists: {email}")
        print("If login still fails, reset the password by running this with --reset:")
        if "--reset" in sys.argv:
            existing.hashed_password = hash_password("Admin123!")
            existing.updated_at = datetime.utcnow()
            await existing.save()
            print("Password reset to Admin123!")
    else:
        now = datetime.utcnow()
        user = User(
            email=email,
            full_name="Alice Administrator",
            hashed_password=hash_password("Admin123!"),
            role=UserRole.ADMIN,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        await user.insert()
        print(f"Created admin user: {email} / Admin123!")

    total = await User.count()
    print(f"Total users in database: {total}")

    await close_db()


asyncio.run(main())
