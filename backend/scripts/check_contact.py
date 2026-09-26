"""
Self-check for the website's contact form (POST /api/v1/contact).

Nothing leaves this computer: mail goes to the small fake mail server from
check_email.py. Runs against a throwaway database, which it creates and drops -
your own database is never touched. From the backend/ directory:

    python scripts/check_contact.py

Prints each step and exits non-zero on the first failure.
"""

import asyncio
import os
import sys
from email import message_from_bytes, policy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Before the app is imported: CORS origins are read when main.py builds the app.
os.environ["CORS_ORIGINS"] = "https://pestbase.co.uk"

import httpx

from app.config import settings
from app.core.dependencies import get_current_user
from app.database import init_db
from app.models.contact_enquiry import ContactEnquiry
from app.models.platform_settings import EmailProvider, SmtpSecurity
from app.models.user import User, UserRole
from app.services import platform_settings_service
from scripts.check_email import FakeMailServer

CHECK_DB = "pestbase_contact_check"
INBOX = "hello@check.test"


def ok(message: str) -> None:
    print(f"  ok  {message}")


def enquiry(**overrides) -> dict:
    data = {
        "name": "Priya Patel",
        "email": "priya@example.co.uk",
        "company": "Patel Pest Control",
        "phone": "0161 496 0000",
        "topic": "demo",
        "message": "We have four technicians and would like to see PestBase.",
    }
    data.update(overrides)
    return data


async def main() -> None:
    from app.main import app  # noqa: PLC0415 - after CORS_ORIGINS is set

    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)  # clear leftovers from an interrupted run
    await init_db(database_name=CHECK_DB)  # recreate the indexes
    server = FakeMailServer()
    server.start()

    settings.CONTACT_INBOX = INBOX
    settings.CONTACT_RATE_LIMIT_MAX = 3

    transport = httpx.ASGITransport(app=app, client=("203.0.113.7", 1234))
    api = httpx.AsyncClient(transport=transport, base_url="http://api.test")

    try:
        print("Sending")
        await platform_settings_service.update_settings(
            {
                "email_provider": EmailProvider.SMTP,
                "smtp_host": "127.0.0.1",
                "smtp_port": server.port,
                "smtp_security": SmtpSecurity.NONE,
                "smtp_from_email": "noreply@check.test",
                "smtp_from_name": "PestBase",
            }
        )
        response = await api.post("/api/v1/contact", json=enquiry())
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["success"] is True and "Thanks" in body["message"], body
        stored = await ContactEnquiry.find_all().to_list()
        assert len(stored) == 1 and stored[0].emailed and stored[0].email_error is None, stored
        assert stored[0].ip_address == "203.0.113.7", stored[0].ip_address
        ok("an enquiry is stored, with the address it came from, and marked emailed")

        recipients, raw = server.received[-1]
        message = message_from_bytes(raw, policy=policy.default)
        assert recipients == [INBOX], recipients
        assert message["Reply-To"] == "priya@example.co.uk", message["Reply-To"]
        assert "Book a demo" in message["Subject"] and "Priya Patel" in message["Subject"], message["Subject"]
        text = message.get_body(preferencelist=("plain",)).get_content()
        assert "four technicians" in text and "Patel Pest Control" in text, text
        ok("it is emailed to CONTACT_INBOX, with the enquirer as the reply-to")

        print("Refusing")
        response = await api.post("/api/v1/contact", json=enquiry(email="not-an-address", message="short"))
        assert response.status_code == 422, response.text
        fields = {error["field"] for error in response.json()["data"]["errors"]}
        assert {"email", "message"} <= fields, fields
        ok("a bad address and a too-short message come back as field errors")

        response = await api.post("/api/v1/contact", json=enquiry(topic="lottery"))
        assert response.status_code == 422, response.text
        ok("an unknown topic is refused")

        before = await ContactEnquiry.count()
        response = await api.post("/api/v1/contact", json=enquiry(website="http://spam.example"))
        assert response.status_code == 201, response.text
        assert await ContactEnquiry.count() == before
        ok("a bot that fills in the hidden field is thanked, and nothing is kept")

        response = await api.post("/api/v1/contact", json=enquiry(name="Eve\r\nBcc: victim@example.com"))
        assert response.status_code == 201, response.text
        latest = await ContactEnquiry.find_all().sort("-created_at").first_or_none()
        assert latest.name == "Eve Bcc: victim@example.com", latest.name
        recipients, raw = server.received[-1]
        headers = message_from_bytes(raw, policy=policy.default)
        assert recipients == [INBOX], recipients
        assert headers["Bcc"] is None, headers["Bcc"]
        ok("line breaks in a name are flattened, so they cannot add mail headers")

        response = await api.post("/api/v1/contact", json=enquiry())
        assert response.status_code == 201, response.text  # the third: at the limit
        response = await api.post("/api/v1/contact", json=enquiry())
        assert response.status_code == 429, response.text
        assert "try again later" in response.json()["message"], response.text
        ok("a fourth enquiry from one address inside the window is refused")

        print("When mail is down")
        await ContactEnquiry.find_all().delete()
        await platform_settings_service.update_settings({"email_provider": EmailProvider.NONE})
        response = await api.post("/api/v1/contact", json=enquiry())
        assert response.status_code == 201, response.text
        stored = await ContactEnquiry.find_all().to_list()
        assert len(stored) == 1 and not stored[0].emailed and stored[0].email_error, stored
        ok("the enquiry is still kept, with the reason it was not emailed")

        print("Platform staff")
        staff = User(email="staff@check.test", full_name="Sam Staff", role=UserRole.ADMIN, is_platform_staff=True)
        client_admin = User(email="admin@client.test", full_name="Cara Client", role=UserRole.ADMIN)

        app.dependency_overrides[get_current_user] = lambda: client_admin
        response = await api.get("/api/v1/contact/enquiries")
        assert response.status_code == 403, response.text
        ok("a client's own admin cannot read website enquiries")

        app.dependency_overrides[get_current_user] = lambda: staff
        response = await api.get("/api/v1/contact/enquiries", params={"status": "open"})
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["total"] == 1 and data["open_count"] == 1, data
        item = data["items"][0]
        assert item["topic_label"] == "Book a demo" and item["emailed"] is False and item["email_error"], item
        ok("platform staff see open enquiries, with why one was not emailed")
        # Stored times are naive UTC; every response must say so, or a browser
        # reads them as local time (an hour out in British Summer Time).
        assert item["created_at"].endswith("Z"), item["created_at"]
        ok(f"times come back marked as UTC ({item['created_at']})")

        response = await api.post(f"/api/v1/contact/enquiries/{item['id']}/resend")
        assert response.status_code == 400 and "Still couldn't email it" in response.json()["message"], response.text
        await platform_settings_service.update_settings({"email_provider": EmailProvider.SMTP})
        sent_before = len(server.received)
        response = await api.post(f"/api/v1/contact/enquiries/{item['id']}/resend")
        assert response.status_code == 200 and response.json()["data"]["emailed"] is True, response.text
        assert len(server.received) == sent_before + 1
        ok("sending again says why it failed, then works once mail is set up")

        response = await api.patch(f"/api/v1/contact/enquiries/{item['id']}", json={"handled": True})
        assert response.status_code == 200, response.text
        assert response.json()["data"]["handled_by_name"] == "Sam Staff", response.text
        data = (await api.get("/api/v1/contact/enquiries", params={"status": "open"})).json()["data"]
        assert data["total"] == 0 and data["open_count"] == 0, data
        data = (await api.get("/api/v1/contact/enquiries", params={"status": "handled"})).json()["data"]
        assert data["total"] == 1, data
        response = await api.patch(f"/api/v1/contact/enquiries/{item['id']}", json={"handled": False})
        assert response.json()["data"]["handled_at"] is None, response.text
        ok("an enquiry can be marked handled, with who did it, and opened again")

        response = await api.patch("/api/v1/contact/enquiries/not-an-id", json={"handled": True})
        assert response.status_code == 404, response.text
        ok("an unknown enquiry is a 404")
        app.dependency_overrides.clear()

        print("Browser access")
        response = await api.options(
            "/api/v1/contact",
            headers={
                "Origin": "https://pestbase.co.uk",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.status_code == 200, response.text
        assert response.headers["access-control-allow-origin"] == "https://pestbase.co.uk", response.headers
        ok("the website's origin may post to it from the browser")

        print("\nAll contact form checks passed.")
    finally:
        server.stopped = True
        await api.aclose()
        await client.drop_database(CHECK_DB)


if __name__ == "__main__":
    asyncio.run(main())
