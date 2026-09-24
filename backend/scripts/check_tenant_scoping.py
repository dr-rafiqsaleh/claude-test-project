"""Self-check: nothing quietly queries across clients.

Client isolation rests on two things, and this checks both by reading the source
- no database needed, so it runs anywhere and in CI:

  1. Every collection that belongs to a client extends `TenantDocument`, which
     is what puts the client into every query.
  2. Every place that reaches past Beanie to the raw driver
     (`get_motor_collection`) names the client itself, because the base class
     cannot reach a raw call.

`scripts/check_tenancy.py` proves isolation against a real database. This one
catches the mistake that would break it, in the diff that introduces it.

    python scripts/check_tenant_scoping.py
"""

import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
MODELS = BACKEND / "app" / "models"

#: Not a client's data: the platform's own client list, and the base class.
PLATFORM_MODELS = {"client.py", "tenant.py", "__init__.py"}

#: A raw driver call is fine as long as the client is in the query. Any one of
#: these nearby means the author dealt with it.
SCOPE_MARKERS = ("tenant_filter(", "require_client_id(", "current_client_id(", "_key(")

#: How many lines after a raw call we look for the scope to be applied.
WINDOW = 12


def document_models() -> list:
    """(file, class, base) for every Document subclass under app/models."""
    found = []
    for path in sorted(MODELS.glob("*.py")):
        if path.name in PLATFORM_MODELS:
            continue
        source = path.read_text(encoding="utf-8")
        for match in re.finditer(r"^class (\w+)\((\w+)\):", source, flags=re.M):
            name, base = match.groups()
            if base.endswith("Document"):
                found.append((path.name, name, base))
    return found


def unscoped_models() -> list:
    return [
        f"{filename}: {name} extends {base}, not TenantDocument"
        for filename, name, base in document_models()
        if base != "TenantDocument"
    ]


def unscoped_raw_calls() -> list:
    """Raw driver calls with no sign of the client in the query around them."""
    problems = []
    for path in sorted((BACKEND / "app").rglob("*.py")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines):
            if "get_motor_collection()" not in line:
                continue
            window = "\n".join(lines[number : number + WINDOW])
            if not any(marker in window for marker in SCOPE_MARKERS):
                where = path.relative_to(BACKEND)
                problems.append(f"{where}:{number + 1} raw query with no client in it: {line.strip()}")
    return problems


def main() -> int:
    models = document_models()
    problems = unscoped_models() + unscoped_raw_calls()

    for problem in problems:
        print(f"FAIL {problem}")

    if problems:
        print(
            f"\n{len(problems)} problem(s). A collection of a client's must extend "
            "TenantDocument, and a raw driver query must put the client in itself."
        )
        return 1

    print(f"ok  {len(models)} client collection(s), all scoped through TenantDocument")
    print("ok  every raw driver query names the client")
    return 0


if __name__ == "__main__":
    sys.exit(main())
