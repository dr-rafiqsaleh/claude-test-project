"""
Self-check for roles and permissions, through the real API.

Signs in as different people and checks what each may and may not do. Runs
against a throwaway database, which it creates and drops - your own database
is never touched. From the backend/ directory:

    python scripts/check_roles.py

Prints each step and exits non-zero on the first failure.
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

CHECK_DB = "qkil_roles_check"
os.environ["DATABASE_NAME"] = CHECK_DB  # before the app reads its settings

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.core.tenancy import acting_as, unscoped  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import client_service  # noqa: E402

PASSWORD = "Check-pass-123"


def ok(message: str) -> None:
    print(f"  ok  {message}")


async def reset_with_admin() -> None:
    connection = await init_db(database_name=CHECK_DB)
    await connection.drop_database(CHECK_DB)
    await init_db(database_name=CHECK_DB)
    # One client company, with an admin inside it. Client isolation has its own
    # check in scripts/check_tenancy.py; this one is about roles within a client.
    with unscoped():
        company = await client_service.create_client(name="Check Company")
    with acting_as(company.id):
        await User(
            email="admin@example.com",
            full_name="Ada Admin",
            hashed_password=hash_password(PASSWORD),
            role="admin",
        ).insert()


async def drop() -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)


def main() -> None:
    asyncio.run(reset_with_admin())
    try:
        with TestClient(app) as api:
            def sign_in(email: str) -> dict:
                response = api.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
                assert response.status_code == 200, response.text
                return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}

            def add_user(email: str, name: str, role: str) -> str:
                response = api.post(
                    "/api/v1/users",
                    headers=admin,
                    json={"email": email, "full_name": name, "password": PASSWORD, "role": role},
                )
                assert response.status_code == 201, response.text
                return response.json()["data"]["id"]

            admin = sign_in("admin@example.com")

            print("The built-in roles")
            roles = api.get("/api/v1/roles", headers=admin).json()["data"]
            by_key = {role["key"]: role for role in roles["roles"]}
            assert list(by_key)[:3] == ["admin", "office_staff", "technician"], list(by_key)
            assert not by_key["admin"]["editable"] and by_key["office_staff"]["editable"]
            assert by_key["technician"]["permissions"] == ["customers.view", "jobs.assignable"]
            groups = [group["group"] for group in roles["permission_groups"]]
            ok(f"Admin, Office Staff and Technician exist; permissions come in {len(groups)} groups")

            add_user("office@example.com", "Olive Office", "office_staff")
            tom_id = add_user("tom@example.com", "Tom Tech", "technician")
            office, tom = sign_in("office@example.com"), sign_in("tom@example.com")
            me = api.get("/api/v1/auth/me", headers=tom).json()["data"]
            assert me["role_name"] == "Technician" and me["permissions"] == ["customers.view", "jobs.assignable"]
            ok("signing in returns the person's role name and permissions")

            print("What each role may do")
            customer = api.post(
                "/api/v1/customers",
                headers=office,
                json={
                    "first_name": "Lena", "last_name": "Landlord", "phone": "0151 496 0000",
                    "address": {"street": "1 Owner Street", "city": "Liverpool", "postcode": "L1 1AA"},
                },
            )
            assert customer.status_code == 201, customer.text
            start = datetime.utcnow() + timedelta(days=2)
            booking = api.post(
                "/api/v1/bookings",
                headers=office,
                json={
                    "customer_id": customer.json()["data"]["id"], "technician_id": tom_id,
                    "scheduled_start": start.isoformat(), "scheduled_end": (start + timedelta(hours=1)).isoformat(),
                    "service_type": "Rodent Control", "quoted_amount": 120, "internal_notes": "Office only",
                },
            )
            assert booking.status_code == 201, booking.text
            ok("office staff add customers and book jobs")

            assert api.get("/api/v1/quotes", headers=tom).status_code == 403
            denied = api.get("/api/v1/invoices", headers=tom)
            assert denied.status_code == 403 and "View invoices" in denied.json()["message"], denied.text
            assert api.post("/api/v1/bookings", headers=tom, json={}).status_code in (403, 422)
            assert api.get("/api/v1/roles", headers=office).status_code == 403
            assert api.put("/api/v1/settings", headers=office, json={"company_name": "X"}).status_code == 403
            ok(f"refusals say what's missing: '{denied.json()['message']}'")

            job = api.get(f"/api/v1/bookings/{booking.json()['data']['id']}", headers=tom).json()["data"]
            assert job["quoted_amount"] is None and job["internal_notes"] is None
            office_view = api.get(f"/api/v1/bookings/{job['id']}", headers=office).json()["data"]
            assert office_view["quoted_amount"] == 120 and office_view["internal_notes"] == "Office only"
            ok("a technician sees their job without the price or the office's notes")

            print("A new role")
            created = api.post(
                "/api/v1/roles",
                headers=admin,
                json={
                    "name": "Senior Technician",
                    "description": "Leads the field team",
                    "permissions": ["customers.view", "jobs.assignable", "jobs.view_all", "reports.edit_all"],
                },
            )
            assert created.status_code == 201, created.text
            senior_key = created.json()["data"]["key"]
            assert senior_key == "senior_technician"
            sam_id = add_user("sam@example.com", "Sam Senior", senior_key)
            sam = sign_in("sam@example.com")
            names = [person["full_name"] for person in api.get("/api/v1/bookings/technicians", headers=office).json()["data"]["items"]]
            assert "Sam Senior" in names and "Olive Office" not in names, names
            assert api.get("/api/v1/bookings", headers=sam).json()["data"]["total"] == 1
            assert api.get("/api/v1/bookings", headers=tom).json()["data"]["total"] == 1
            ok("a Senior Technician role: can be given jobs, sees every job, can't book them")

            api.put(f"/api/v1/users/{tom_id}", headers=admin, json={"role": senior_key})
            other = api.post(
                "/api/v1/bookings",
                headers=office,
                json={
                    "customer_id": customer.json()["data"]["id"], "technician_id": sam_id,
                    "scheduled_start": start.isoformat(), "scheduled_end": (start + timedelta(hours=1)).isoformat(),
                    "service_type": "Wasp Nest Removal",
                },
            )
            assert other.status_code == 201, other.text
            assert api.get("/api/v1/bookings", headers=tom).json()["data"]["total"] == 2
            ok("moving Tom to the new role lets Tom see every job straight away")

            print("Changing and removing roles")
            office_perms = [p for p in by_key["office_staff"]["permissions"] if p != "invoices.view"]
            api.put("/api/v1/roles/office_staff", headers=admin, json={"permissions": office_perms})
            assert api.get("/api/v1/invoices", headers=office).status_code == 403
            ok("taking 'View invoices' from Office Staff takes effect at once")

            assert api.put("/api/v1/roles/admin", headers=admin, json={"permissions": []}).status_code == 400
            assert api.delete("/api/v1/roles/technician", headers=admin).status_code == 400
            in_use = api.delete(f"/api/v1/roles/{senior_key}", headers=admin)
            assert in_use.status_code == 400 and "2 people have this role" in in_use.json()["message"], in_use.text
            ok(f"Admin can't be changed, built-in roles can't be deleted, and '{in_use.json()['message']}'")

            spare = api.post("/api/v1/roles", headers=admin, json={"name": "Temp", "permissions": []}).json()["data"]
            assert api.delete(f"/api/v1/roles/{spare['key']}", headers=admin).status_code == 200
            assert api.post("/api/v1/users", headers=admin, json={
                "email": "x@example.com", "full_name": "X", "password": PASSWORD, "role": "no_such_role",
            }).status_code == 422
            ok("an unused role can be deleted; a person can't be given a role that doesn't exist")

            print("Unassigned work")
            nina_id = add_user("nina@example.com", "Nina New", "technician")
            nina = sign_in("nina@example.com")
            pool = api.post(
                "/api/v1/bookings",
                headers=office,
                json={
                    "customer_id": customer.json()["data"]["id"],
                    "scheduled_start": start.isoformat(), "scheduled_end": (start + timedelta(hours=1)).isoformat(),
                    "service_type": "Ant Treatment",
                },
            )
            assert pool.status_code == 201, pool.text
            pool_id, sams_id = pool.json()["data"]["id"], other.json()["data"]["id"]

            seen = [b["id"] for b in api.get("/api/v1/bookings", headers=nina).json()["data"]["items"]]
            assert pool_id in seen and sams_id not in seen, seen
            assert api.get(f"/api/v1/bookings/{pool_id}", headers=nina).status_code == 200
            assert api.get(f"/api/v1/bookings/{sams_id}", headers=nina).status_code == 403
            ok("a job nobody is on shows to every technician; one given to someone else does not")

            assigned = api.put(f"/api/v1/bookings/{pool_id}", headers=office, json={"technician_id": sam_id})
            assert assigned.status_code == 200, assigned.text
            seen_after = [b["id"] for b in api.get("/api/v1/bookings", headers=nina).json()["data"]["items"]]
            assert pool_id not in seen_after, seen_after
            assert api.get(f"/api/v1/bookings/{pool_id}", headers=nina).status_code == 403
            ok("giving it to someone takes it off everyone else's list")

            print("Removing people")
            refused = api.delete(f"/api/v1/users/{tom_id}/permanent", headers=admin)
            assert refused.status_code == 409 and "Deactivate them instead" in refused.json()["message"], refused.text
            spare_id = add_user("temp@example.com", "Tess Temp", "technician")
            assert api.delete(f"/api/v1/users/{spare_id}/permanent", headers=admin).status_code == 200
            assert api.get(f"/api/v1/users/{spare_id}", headers=admin).status_code == 404
            ok(f"someone with work on record is refused: '{refused.json()['message']}'")
            ok("someone with nothing on record is deleted for good")

            admin_id = api.get("/api/v1/auth/me", headers=admin).json()["data"]["id"]
            assert api.delete(f"/api/v1/users/{admin_id}/permanent", headers=admin).status_code == 400
            assert api.delete(f"/api/v1/users/{admin_id}", headers=admin).status_code == 400
            ok("nobody can delete or deactivate themselves, so the last admin always remains")
    finally:
        asyncio.run(drop())

    print("\nAll role checks passed.")


if __name__ == "__main__":
    main()
