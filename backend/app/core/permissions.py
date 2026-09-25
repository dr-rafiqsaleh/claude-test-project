"""What each role may do in PestBase.

A role is a named set of the permissions below. Every route checks for the
permission it needs, never for a role by name, so roles can be added and
changed in the app without touching code.

The three built-in roles start with exactly what they could do before roles
were editable. Admin always holds every permission and cannot be edited, so
there is always someone who can manage the team.
"""

from typing import Dict, FrozenSet, List

#: Every permission, grouped as they appear on the team page.
PERMISSION_GROUPS: List[dict] = [
    {
        "group": "Customers",
        "permissions": [
            {"key": "customers.view", "label": "View customers", "description": "See customers and their details."},
            {"key": "customers.edit", "label": "Add and edit customers", "description": "Add, edit and archive customers."},
        ],
    },
    {
        "group": "Quotes",
        "permissions": [
            {"key": "quotes.view", "label": "View quotes", "description": "See quotes and their prices."},
            {"key": "quotes.edit", "label": "Create and send quotes", "description": "Create, edit, send, accept and reject quotes."},
            {"key": "quotes.delete", "label": "Delete quotes", "description": "Delete draft quotes and mark quotes expired."},
        ],
    },
    {
        "group": "Jobs",
        "permissions": [
            {"key": "jobs.view_all", "label": "See every job", "description": "Without this, people only see the jobs they are given."},
            {"key": "jobs.edit", "label": "Book and manage jobs", "description": "Book, edit, assign, confirm and cancel jobs, and get the office reminders."},
            {"key": "jobs.assignable", "label": "Can be given jobs", "description": "Appears in the technician list when booking a job."},
            {"key": "jobs.delete", "label": "Delete jobs", "description": "Delete jobs and cancel reports."},
        ],
    },
    {
        "group": "Reports",
        "permissions": [
            {"key": "reports.edit_all", "label": "Edit any report", "description": "Without this, people can only fill in the reports for their own jobs."},
        ],
    },
    {
        "group": "Invoices",
        "permissions": [
            {"key": "invoices.view", "label": "View invoices", "description": "See invoices and payments."},
            {"key": "invoices.edit", "label": "Create invoices and take payments", "description": "Create, edit and send invoices, and record payments."},
            {"key": "invoices.cancel", "label": "Cancel invoices", "description": "Cancel and delete invoices."},
        ],
    },
    {
        "group": "Money",
        "permissions": [
            {"key": "money.view", "label": "See prices and revenue", "description": "Quoted prices on jobs, money owed by customers and the revenue chart."},
        ],
    },
    {
        "group": "Email",
        "permissions": [
            {"key": "emails.send", "label": "Email customers", "description": "Email quotes, invoices and reports, and see the record of emails sent."},
        ],
    },
    {
        "group": "Admin",
        "permissions": [
            {"key": "settings.manage", "label": "Company settings", "description": "Company details, invoicing, email, products and report wording."},
            {"key": "users.manage", "label": "Team and roles", "description": "Add and remove people, and change roles and permissions."},
            {"key": "audit.view", "label": "Audit trail", "description": "See who changed what, and check the record has not been altered."},
            {"key": "support.manage", "label": "PestBase support access", "description": "Let PestBase support into your records for a while, and close it again."},
        ],
    },
]

ALL_PERMISSIONS: FrozenSet[str] = frozenset(
    permission["key"] for group in PERMISSION_GROUPS for permission in group["permissions"]
)

ADMIN_ROLE = "admin"
OFFICE_ROLE = "office_staff"
TECHNICIAN_ROLE = "technician"

#: The built-in roles, as they worked before roles were editable.
DEFAULT_ROLES: Dict[str, dict] = {
    ADMIN_ROLE: {
        "name": "Admin",
        "description": "Everything, including settings and the team. Can't be changed.",
        "permissions": sorted(ALL_PERMISSIONS),
    },
    OFFICE_ROLE: {
        "name": "Office Staff",
        "description": "Runs the business day to day: customers, quotes, jobs and invoicing.",
        "permissions": sorted(
            {
                "customers.view",
                "customers.edit",
                "quotes.view",
                "quotes.edit",
                "jobs.view_all",
                "jobs.edit",
                "reports.edit_all",
                "invoices.view",
                "invoices.edit",
                "money.view",
                "emails.send",
            }
        ),
    },
    TECHNICIAN_ROLE: {
        "name": "Technician",
        "description": "Does the jobs they are given and fills in the reports. No access to money.",
        "permissions": sorted({"customers.view", "jobs.assignable"}),
    },
}
