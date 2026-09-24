"""
Self-check for client isolation, through the real API.

Sets up two client companies with a customer each and checks that neither can
see, open or count the other's records - and that record numbering, roles and
company settings are separate. Runs against a throwaway database, which it
creates and drops; your own database is never touched. From backend/:

    python scripts/check_tenancy.py

Prints each step and exits non-zero on the first failure. This is the check
that matters most in a multi-client app: everything else is a feature, this is
the promise.
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

CHECK_DB = "qkil_tenancy_check"
os.environ["DATABASE_NAME"] = CHECK_DB  # before the app reads its settings

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402

PASSWORD = "Check-pass-123"


def ok(message: str) -> None:
    print(f"  ok  {message}")


async def reset() -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)
    await init_db(database_name=CHECK_DB)
    # QKil's own staff: no client of their own, and the admin role so they can
    # set a new client up before it has an administrator.
    await User(
        email="platform@qkil.com",
        full_name="Pat Platform",
        hashed_password=hash_password(PASSWORD),
        role="admin",
        is_platform_staff=True,
        client_id=None,
    ).insert()


async def drop() -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)


def main() -> None:
    asyncio.run(reset())
    try:
        with TestClient(app) as api:
            def sign_in(email: str) -> dict:
                response = api.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
                assert response.status_code == 200, response.text
                return {"Authorization": f"Bearer {response.json()['data']['access_token']}"}

            def inside(headers: dict, client_id: str) -> dict:
                """Platform headers, aimed at one client."""
                return {**headers, "X-Client-Id": client_id}

            platform = sign_in("platform@qkil.com")

            print("The client list")
            acme = api.post("/api/v1/clients", headers=platform, json={"name": "Acme Pest Control"})
            beta = api.post("/api/v1/clients", headers=platform, json={"name": "Beta Pest Services"})
            assert acme.status_code == 201, acme.text
            assert beta.status_code == 201, beta.text
            acme_id, beta_id = acme.json()["data"]["id"], beta.json()["data"]["id"]
            assert acme.json()["data"]["slug"] == "acme-pest-control"
            clash = api.post("/api/v1/clients", headers=platform, json={"name": "acme pest control"})
            assert clash.status_code == 400, clash.text
            ok("two clients added, each with a handle of its own; a duplicate name is refused")

            # Each client starts with the three built-in roles, in its own scope.
            for name, cid in (("Acme", acme_id), ("Beta", beta_id)):
                roles = api.get("/api/v1/roles", headers=inside(platform, cid)).json()["data"]["roles"]
                assert [r["key"] for r in roles][:3] == ["admin", "office_staff", "technician"], (name, roles)
            ok("every new client gets its own Admin, Office Staff and Technician")

            print("People belong to one client")
            def add_admin(cid: str, email: str, name: str) -> str:
                response = api.post(
                    "/api/v1/users",
                    headers=inside(platform, cid),
                    json={"email": email, "full_name": name, "password": PASSWORD, "role": "admin"},
                )
                assert response.status_code == 201, response.text
                return response.json()["data"]["id"]

            add_admin(acme_id, "ann@acme.test", "Ann Acme")
            add_admin(beta_id, "ben@beta.test", "Ben Beta")
            ann, ben = sign_in("ann@acme.test"), sign_in("ben@beta.test")

            assert api.get("/api/v1/users", headers=ann).json()["data"]["total"] == 1
            assert api.get("/api/v1/users", headers=ben).json()["data"]["total"] == 1
            ok("each client's team page shows only its own people")

            # A client admin cannot reach the client list at all, and cannot
            # borrow the header to look into another client.
            assert api.get("/api/v1/clients", headers=ann).status_code == 403
            assert api.get("/api/v1/users", headers=inside(ann, beta_id)).json()["data"]["total"] == 1
            ok("a client's own admin can't open the client list, and the client header does nothing for them")

            print("Records stay with their client")
            def add_customer(headers: dict, first: str) -> str:
                response = api.post(
                    "/api/v1/customers",
                    headers=headers,
                    json={
                        "first_name": first, "last_name": "Customer", "phone": "0151 496 0000",
                        "address": {"street": "1 Test Street", "city": "Liverpool", "postcode": "L1 1AA"},
                    },
                )
                assert response.status_code == 201, response.text
                return response.json()["data"]["id"]

            acme_customer = add_customer(ann, "Alice")
            beta_customer = add_customer(ben, "Bob")

            acme_list = api.get("/api/v1/customers", headers=ann).json()["data"]
            assert acme_list["total"] == 1, acme_list
            assert acme_list["items"][0]["first_name"] == "Alice"
            assert api.get(f"/api/v1/customers/{beta_customer}", headers=ann).status_code == 404
            assert api.get(f"/api/v1/customers/{acme_customer}", headers=ben).status_code == 404
            ok("neither client can list, count or open the other's customers")

            # Searching is the usual back door: it queries several collections
            # at once, and one unscoped query there leaks everything.
            found = api.get("/api/v1/search", headers=ann, params={"q": "Bob"}).json()["data"]
            assert found["total_count"] == 0, found
            assert "Bob" not in str(found["results"]), found["results"]
            mine = api.get("/api/v1/search", headers=ann, params={"q": "Alice"}).json()["data"]
            assert mine["total_count"] >= 1, mine
            ok("global search finds this client's records and none of anyone else's")

            print("Numbering, roles and settings are separate")
            start = datetime.utcnow() + timedelta(days=2)
            def book(headers: dict, customer_id: str) -> str:
                response = api.post(
                    "/api/v1/bookings",
                    headers=headers,
                    json={
                        "customer_id": customer_id,
                        "scheduled_start": start.isoformat(),
                        "scheduled_end": (start + timedelta(hours=1)).isoformat(),
                        "service_type": "Rodent Control",
                    },
                )
                assert response.status_code == 201, response.text
                return response.json()["data"]["booking_number"]

            first_acme, first_beta = book(ann, acme_customer), book(ben, beta_customer)
            assert first_acme == first_beta, (first_acme, first_beta)
            assert first_acme.endswith("0001"), first_acme
            assert book(ann, acme_customer).endswith("0002")
            ok(f"both clients start their job numbers at {first_acme}, and count on independently")

            perms = api.get("/api/v1/roles", headers=ann).json()["data"]["roles"]
            office = next(r for r in perms if r["key"] == "office_staff")
            trimmed = [p for p in office["permissions"] if p != "invoices.view"]
            assert api.put("/api/v1/roles/office_staff", headers=ann, json={"permissions": trimmed}).status_code == 200
            beta_office = next(
                r for r in api.get("/api/v1/roles", headers=ben).json()["data"]["roles"]
                if r["key"] == "office_staff"
            )
            assert "invoices.view" in beta_office["permissions"], beta_office
            ok("changing one client's Office Staff leaves every other client's alone")

            assert api.put("/api/v1/settings", headers=ann, json={"company_name": "Acme Pest Control"}).status_code == 200
            beta_settings = api.get("/api/v1/settings", headers=ben).json()["data"]
            assert beta_settings["company_name"] != "Acme Pest Control", beta_settings["company_name"]
            ok("company settings are per client, so one client's branding is not another's")

            print("What platform staff may do")
            # No client chosen: the client list still works, client records do not.
            assert api.get("/api/v1/clients", headers=platform).status_code == 200
            mixed = api.get("/api/v1/customers", headers=platform)
            assert mixed.status_code == 400, mixed.text
            assert "client" in mixed.json()["message"].lower(), mixed.json()
            orphan = api.post(
                "/api/v1/customers",
                headers=platform,
                json={
                    "first_name": "No", "last_name": "Owner", "phone": "0151 496 0000",
                    "address": {"street": "1 Test Street", "city": "Liverpool", "postcode": "L1 1AA"},
                },
            )
            assert orphan.status_code == 400, orphan.text
            ok(f"platform staff must say which client they are in: '{mixed.json()['message']}'")

            # Inside a client they can work, but only while that client is open
            # to them. Creating the client opened a setup window; closing it
            # shuts the door, and nothing reopens it but the client.
            assert api.get("/api/v1/customers", headers=inside(platform, acme_id)).status_code == 200
            assert api.delete("/api/v1/support-access", headers=ann).status_code == 200
            shut = api.get("/api/v1/customers", headers=inside(platform, acme_id))
            assert shut.status_code == 403, shut.text
            assert "not opened their records" in shut.json()["message"], shut.json()
            ok(f"once the client closes access, QKil is locked out: '{shut.json()['message'][:60]}...'")

            reopened = api.post("/api/v1/support-access", headers=ann, json={"hours": 4, "reason": "Numbering"})
            assert reopened.status_code == 201, reopened.text
            assert api.get("/api/v1/customers", headers=inside(platform, acme_id)).status_code == 200
            ok("and letting them back in works, for the hours the client chose")

            print("Suspending a client")
            assert api.put(f"/api/v1/clients/{beta_id}", headers=platform, json={"status": "suspended"}).status_code == 200
            blocked = api.post("/api/v1/auth/login", json={"email": "ben@beta.test", "password": PASSWORD})
            assert blocked.status_code == 403, blocked.text
            assert api.get("/api/v1/customers", headers=ben).status_code == 403
            assert api.get("/api/v1/customers", headers=ann).status_code == 200
            ok("a suspended client cannot sign in and its live sessions stop working; other clients carry on")

            assert api.put(f"/api/v1/clients/{beta_id}", headers=platform, json={"status": "active"}).status_code == 200
            assert api.post("/api/v1/auth/login", json={"email": "ben@beta.test", "password": PASSWORD}).status_code == 200
            ok("switching it back on restores access")

            in_use = api.delete(f"/api/v1/clients/{beta_id}", headers=platform)
            assert in_use.status_code == 400 and "user" in in_use.json()["message"].lower(), in_use.text
            spare = api.post("/api/v1/clients", headers=platform, json={"name": "Empty Co"}).json()["data"]
            assert api.delete(f"/api/v1/clients/{spare['id']}", headers=platform).status_code == 200
            ok(f"a client with people in it is not deletable: '{in_use.json()['message']}'")
    finally:
        asyncio.run(drop())

    print("\nAll client isolation checks passed.")


if __name__ == "__main__":
    main()
