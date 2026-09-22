"""
Self-check for emailing quotes, invoices and reports.

Nothing leaves this computer: SMTP goes to a small fake mail server started
here, and Microsoft 365 goes to a simulated Microsoft Graph. Runs against a
throwaway database, which it creates and drops - your own database is never
touched. From the backend/ directory:

    python scripts/check_email.py

Prints each step and exits non-zero on the first failure.
"""

import asyncio
import base64
import hashlib
import json
import socket
import sys
import threading
from datetime import datetime, timedelta
from email import message_from_bytes, policy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.database import init_db
from app.models.booking import Booking
from app.models.company_settings import CompanySettings, EmailProvider, SmtpSecurity
from app.models.customer import Address, Customer
from app.models.email_log import EmailLog
from app.models.invoice import InvoiceStatus
from app.models.job import ActivityLevel, JobStatus
from app.models.quote import QuoteStatus
from app.models.user import User, UserRole
from app.schemas.company_settings import CompanySettingsUpdate
from app.schemas.invoice import InvoiceCreate, InvoiceItemSchema
from app.schemas.job import JobUpdate
from app.schemas.quote import QuoteCreate, QuoteItemSchema
from app.services import company_settings_service, email_service, invoice_service, job_service, quote_service
from app.routers.emails import email_attachment, email_eml, email_record
from app.services.email_service import Attachment, EmailError, OutgoingEmail

CHECK_DB = "qkil_email_check"


def ok(message: str) -> None:
    print(f"  ok  {message}")


class FakeMailServer(threading.Thread):
    """Just enough SMTP to accept, or refuse, one message at a time."""

    def __init__(self, refuse_login: bool = False, refuse_sender: bool = False) -> None:
        super().__init__(daemon=True)
        self.refuse_login = refuse_login
        self.refuse_sender = refuse_sender
        self.received: list = []  # (envelope recipients, raw message)
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.sock.settimeout(0.2)
        self.port = self.sock.getsockname()[1]
        self.stopped = False

    def run(self) -> None:
        while not self.stopped:
            try:
                conn, _ = self.sock.accept()
            except (socket.timeout, OSError):
                continue
            with conn:
                self._session(conn)

    def _session(self, conn: socket.socket) -> None:
        reader = conn.makefile("rb")
        conn.sendall(b"220 fake.test ESMTP\r\n")
        recipients: list = []
        while True:
            line = reader.readline()
            if not line:
                return
            command = line.decode().strip().upper()
            if command.startswith("EHLO"):
                conn.sendall(b"250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 50000000\r\n")
            elif command.startswith("AUTH"):
                if self.refuse_login:
                    conn.sendall(b"535 5.7.139 Authentication unsuccessful, the request did not meet the criteria\r\n")
                else:
                    conn.sendall(b"235 2.7.0 Authentication successful\r\n")
            elif command.startswith("MAIL FROM"):
                recipients = []
                conn.sendall(b"250 OK\r\n")
            elif command.startswith("RCPT TO"):
                recipients.append(line.decode().split(":", 1)[1].strip().strip("<>"))
                conn.sendall(b"250 OK\r\n")
            elif command == "DATA":
                conn.sendall(b"354 Go ahead\r\n")
                data = b""
                while True:
                    chunk = reader.readline()
                    if chunk in (b".\r\n", b""):
                        break
                    data += chunk
                if self.refuse_sender:
                    conn.sendall(b"554 5.2.252 SendAsDenied; info@example.com not allowed to send as accounts@example.com\r\n")
                else:
                    self.received.append((recipients, data))
                    conn.sendall(b"250 Queued\r\n")
            elif command == "QUIT":
                conn.sendall(b"221 Bye\r\n")
                return
            else:
                conn.sendall(b"250 OK\r\n")

    def stop(self) -> None:
        self.stopped = True
        self.sock.close()


class FakeGraph:
    """A stand-in for Microsoft's sign-in and Graph mail endpoints."""

    def __init__(self, send_status: int = 202, token_error: str = "") -> None:
        self.send_status = send_status
        self.token_error = token_error
        self.requests: list = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url.endswith("/oauth2/v2.0/token"):
            if self.token_error:
                return httpx.Response(401, json={"error": "invalid_client", "error_description": self.token_error})
            return httpx.Response(200, json={"access_token": "token-123", "expires_in": 3600})
        if url.endswith("/sendMail"):
            if self.send_status != 202:
                return httpx.Response(self.send_status, json={"error": {"code": "ErrorAccessDenied", "message": "Access is denied."}})
            return httpx.Response(202)
        if url.endswith("/messages") and request.method == "POST":
            return httpx.Response(201, json={"id": "draft-1"})
        if url.endswith("/createUploadSession"):
            return httpx.Response(201, json={"uploadUrl": "https://upload.example.test/session-1"})
        if url.startswith("https://upload.example.test/"):
            return httpx.Response(200 if "/" not in request.headers["Content-Range"].split(" ")[1][-1] else 201)
        if url.endswith("/send"):
            return httpx.Response(202)
        return httpx.Response(404, json={"error": {"code": "ResourceNotFound", "message": url}})


async def use_settings(**changes) -> CompanySettings:
    return await company_settings_service.update_settings(CompanySettingsUpdate(**changes))


async def completed_job(office: User, customer: Customer) -> str:
    start = datetime.utcnow() - timedelta(hours=2)
    booking = Booking(
        booking_number="JOB-CHK-1",
        customer_id=customer.id,
        scheduled_start=start,
        scheduled_end=start + timedelta(hours=1),
        service_type="Rodent Control",
        pest_types=["Mouse"],
        service_address={"street": "9 Rental Row", "city": "Liverpool", "postcode": "L1 2AB"},
        created_by=office.id,
    )
    await booking.insert()
    job, *_ = await job_service.create_job_from_booking(booking.id, office.id)
    await job_service.update_status(job.id, JobStatus.IN_PROGRESS, office.id)
    await job_service.update_job(job.id, JobUpdate(activity_level=ActivityLevel.LOW))
    await job_service.update_status(job.id, JobStatus.COMPLETED, office.id)
    return str(job.id)


async def main() -> None:
    client = await init_db(database_name=CHECK_DB)
    await client.drop_database(CHECK_DB)  # clear leftovers from an interrupted run
    await init_db(database_name=CHECK_DB)  # recreate the indexes
    server = FakeMailServer()
    server.start()

    try:
        office = User(email="office@check.test", full_name="Olive Office", hashed_password="-", role=UserRole.OFFICE_STAFF)
        await office.insert()
        customer = Customer(
            first_name="Lena",
            last_name="Landlord",
            phone="0151 496 0000",
            email="lena@example.com",
            address=Address(street="1 Owner Street", city="Liverpool", postcode="L1 1AA"),
            created_by=office.id,
        )
        await customer.insert()
        quote, _ = await quote_service.create_quote(
            QuoteCreate(customer_id=str(customer.id), items=[QuoteItemSchema(description="Rodent treatment", unit_price=120)]),
            office.id,
        )
        invoice, *_ = await invoice_service.create_invoice(
            InvoiceCreate(customer_id=str(customer.id), items=[InvoiceItemSchema(description="Rodent treatment", unit_price=120)]),
            office.id,
        )
        job_id = await completed_job(office, customer)

        print("Settings")
        try:
            await email_service.send_test("me@example.com", office)
        except EmailError as exc:
            assert "isn't set up" in str(exc), exc
            ok("before email is set up, sending says so plainly")
        settings = await use_settings(
            email_provider=EmailProvider.SMTP,
            smtp_host="127.0.0.1",
            smtp_port=server.port,
            smtp_security=SmtpSecurity.NONE,
            smtp_username="info@example.com",
            smtp_password="s3cret-pass",
            smtp_from_email="accounts@example.com",
            smtp_from_name="QKil Accounts",
            email_reply_to="accounts@example.com",
            email_bcc="office@example.com",
        )
        payload = await company_settings_service.settings_payload(settings)
        assert "s3cret-pass" not in json.dumps(payload, default=str)
        assert payload["smtp_password_set"] is True
        assert settings.smtp_password_encrypted and "s3cret" not in settings.smtp_password_encrypted
        settings = await use_settings(smtp_password="")
        assert settings.smtp_password_encrypted, "a blank password should keep the saved one"
        ok("the password is stored encrypted, never sent back, and kept when left blank")

        print("SMTP")
        draft = await email_service.compose("quote", str(quote.id), office)
        assert draft["to"] == ["lena@example.com"], draft["to"]
        assert "{" not in draft["subject"] + draft["body"], draft
        assert quote.quote_number in draft["subject"] and "Olive Office" in draft["body"]
        ok(f"a quote email is filled in from its template: '{draft['subject']}'")

        await email_service.send_document(
            "quote", str(quote.id), office, to=draft["to"], cc=[], subject=draft["subject"], body=draft["body"]
        )
        recipients, raw = server.received[-1]
        message = message_from_bytes(raw, policy=policy.default)
        attachments = [part for part in message.iter_attachments()]
        assert message["Subject"] == draft["subject"]
        assert "accounts@example.com" in message["From"] and message["Reply-To"] == "accounts@example.com"
        assert "office@example.com" in recipients and "office@example.com" not in (message["To"] or "")
        assert attachments and attachments[0].get_filename() == f"Quote {quote.quote_number}.pdf"
        assert attachments[0].get_content().startswith(b"%PDF")
        ok("it arrives from the alias, with reply-to, a hidden office copy and the PDF attached")

        quote, _ = await quote_service.get_quote(quote.id)
        assert quote.status == QuoteStatus.SENT
        logs = await EmailLog.find({"document_id": quote.id}).to_list()
        assert len(logs) == 1 and logs[0].to == ["lena@example.com"]
        ok("the draft quote is now sent, and the email is logged")

        print("The record kept of it")
        log = logs[0]
        sent_pdf = attachments[0].get_content()
        assert log.status == "sent" and log.body == draft["body"] and log.subject == draft["subject"]
        assert log.from_address == "accounts@example.com" and log.bcc == ["office@example.com"]
        assert log.attachment_sha256 == hashlib.sha256(sent_pdf).hexdigest()
        assert log.attachment_content == sent_pdf and log.attachment_size == len(sent_pdf)
        ok("it keeps every address, the exact message, and the PDF byte for byte with its fingerprint")

        assert log.message_id == message["Message-ID"], (log.message_id, message["Message-ID"])
        assert log.provider_reference.startswith("250"), log.provider_reference
        ok(f"and the server's receipt: '{log.provider_reference}', Message-ID {log.message_id}")

        listed = await email_service.history("quote", str(quote.id))
        assert len(listed) == 1 and not hasattr(listed[0], "attachment_content")
        assert [entry.id for entry in await email_service.customer_history(str(customer.id))] == [log.id]
        ok("it lists on the quote and on the customer, without loading the PDF")

        detail = (await email_record(str(log.id), _current_user=office)).data
        assert detail.attachment_kept and detail.body == log.body
        pdf_copy = await email_attachment(str(log.id), _current_user=office)
        assert pdf_copy.body == sent_pdf
        eml = message_from_bytes((await email_eml(str(log.id), _current_user=office)).body, policy=policy.default)
        eml_pdf = next(eml.iter_attachments()).get_content()
        assert eml["Subject"] == draft["subject"] and eml_pdf == sent_pdf
        assert eml["Message-ID"] == log.message_id
        ok("it can be viewed, and downloaded as the PDF sent or as a .eml that opens in Outlook")

        report_draft = await email_service.compose("report", job_id, office)
        assert "9 Rental Row" in report_draft["subject"], report_draft["subject"]
        await email_service.send_document(
            "report", job_id, office, to=["lena@example.com", "agent@example.com"], cc=[],
            subject=report_draft["subject"], body=report_draft["body"],
        )
        assert server.received[-1][0][:2] == ["lena@example.com", "agent@example.com"]
        ok("a report goes to several people, named after the property it covers")

        failing = FakeMailServer(refuse_login=True)
        failing.start()
        await use_settings(smtp_port=failing.port)
        try:
            await email_service.send_test("me@example.com", office)
            raise AssertionError("a refused login should fail")
        except EmailError as exc:
            assert "refused the username or password" in str(exc), exc
            ok("a refused login explains itself")
        try:
            await email_service.send_document(
                "invoice", str(invoice.id), office, to=["lena@example.com"], cc=[], subject="Invoice", body="Attached."
            )
            raise AssertionError("a refused login should fail")
        except EmailError:
            failed = await EmailLog.find_one({"document_id": invoice.id, "status": "failed"})
            assert failed is not None and "refused the username or password" in failed.error
            ok("a failed attempt is on the record too, with the reason")
        failing.stop()

        refusing = FakeMailServer(refuse_sender=True)
        refusing.start()
        await use_settings(smtp_port=refusing.port)
        try:
            await email_service.send_test("me@example.com", office)
            raise AssertionError("a refused alias should fail")
        except EmailError as exc:
            assert "won't let this account send as accounts@example.com" in str(exc), exc
            ok("so does a server that won't send from the alias")
        refusing.stop()

        closed = socket.socket()
        closed.bind(("127.0.0.1", 0))
        closed_port = closed.getsockname()[1]
        closed.close()
        await use_settings(smtp_port=closed_port)
        try:
            await email_service.send_test("me@example.com", office)
            raise AssertionError("an unreachable server should fail")
        except EmailError as exc:
            assert "Couldn't reach the mail server" in str(exc), exc
            ok("and an unreachable server")

        print("Microsoft 365")
        await use_settings(
            email_provider=EmailProvider.MICROSOFT_365,
            m365_tenant_id="example.com",
            m365_client_id="00000000-0000-0000-0000-000000000001",
            m365_client_secret="app-secret",
            m365_mailbox="info@example.com",
        )
        graph = FakeGraph()
        email_service._token_cache.clear()
        # A customer with no email saved: the office types one in and keeps it.
        customer.email = None
        await customer.save()
        await email_service.send_document(
            "invoice", str(invoice.id), office, to=["lena@example.com"], cc=[],
            subject="Invoice", body="Please find attached.", save_to_customer=True,
            http_transport=httpx.MockTransport(graph),
        )
        assert (await Customer.get(customer.id)).email == "lena@example.com"
        ok("an address typed for a customer who had none is saved to their record")
        graph_log = await EmailLog.find_one({"document_id": invoice.id, "status": "sent"})
        assert "Accepted by Microsoft 365 (HTTP 202)" in graph_log.provider_reference
        token_request, send_request = graph.requests
        assert b"client_credentials" in token_request.content and b"app-secret" in token_request.content
        assert str(send_request.url).endswith("/users/info@example.com/sendMail")
        assert send_request.headers["Authorization"] == "Bearer token-123"
        sent = json.loads(send_request.content)["message"]
        assert sent["from"]["emailAddress"]["address"] == "accounts@example.com"
        assert sent["bccRecipients"][0]["emailAddress"]["address"] == "office@example.com"
        assert base64.b64decode(sent["attachments"][0]["contentBytes"]).startswith(b"%PDF")
        invoice, *_ = await invoice_service.get_invoice(invoice.id)
        assert invoice.status == InvoiceStatus.SENT
        ok("an invoice goes through Graph from the mailbox, as the alias, with its PDF; now sent")

        big = FakeGraph()
        content = b"%PDF" + b"x" * (4 * 1024 * 1024)
        settings = await company_settings_service.get_settings()
        await email_service.send(
            settings,
            OutgoingEmail(to=["lena@example.com"], subject="Big", body="Big", attachments=[Attachment("big.pdf", content)]),
            http_transport=httpx.MockTransport(big),
        )
        uploads = [r for r in big.requests if str(r.url).startswith("https://upload.example.test/")]
        ranges = [r.headers["Content-Range"] for r in uploads]
        assert sum(len(r.content) for r in uploads) == len(content), ranges
        assert ranges[-1].endswith(f"-{len(content) - 1}/{len(content)}"), ranges
        assert "Authorization" not in uploads[0].headers
        assert str(big.requests[-1].url).endswith("/messages/draft-1/send")
        ok(f"a large attachment is uploaded in {len(uploads)} pieces, then the draft is sent")

        email_service._token_cache.clear()
        try:
            await email_service.send_test("me@example.com", office, http_transport=httpx.MockTransport(FakeGraph(send_status=403)))
            raise AssertionError("a refused permission should fail")
        except EmailError as exc:
            assert "Mail.Send" in str(exc), exc
            ok("missing permission says which one to add")

        email_service._token_cache.clear()
        try:
            await email_service.send_test(
                "me@example.com", office,
                http_transport=httpx.MockTransport(FakeGraph(token_error="AADSTS7000215: Invalid client secret provided.")),
            )
            raise AssertionError("a wrong secret should fail")
        except EmailError as exc:
            assert "client secret" in str(exc), exc
            ok("a wrong or expired client secret says so")
    finally:
        server.stop()
        await client.drop_database(CHECK_DB)

    print("\nAll email checks passed.")


if __name__ == "__main__":
    asyncio.run(main())
