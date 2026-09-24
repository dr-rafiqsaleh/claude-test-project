"""Self-check: every permission the frontend names really exists.

The frontend hides pages and buttons by permission key (navigation.js, the
route guards, authStore). A typo or a renamed permission would silently hide
things from everyone, and nothing else would catch it, so this compares the
keys used in the frontend against the ones the backend defines.

    python scripts/check_frontend_permissions.py
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.permissions import ALL_PERMISSIONS  # noqa: E402

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"

#: Looks like a permission key: group.name, in quotes. Same shape as the backend's.
KEY = re.compile(r"""['"]([a-z_]+\.[a-z_]+)['"]""")

#: Dotted strings in the frontend that are not permissions.
IGNORED_PREFIXES = ("http", "www.", "@/")


def used_keys() -> dict:
    """Every permission-shaped string in the frontend, mapped to where it is used."""
    found: dict = {}
    for path in sorted(FRONTEND.rglob("*.js*")):
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for key in KEY.findall(line):
                if key.startswith(IGNORED_PREFIXES):
                    continue
                # Only count keys whose group matches a real permission group, so
                # unrelated dotted strings ("company.name") don't raise a false alarm.
                if key.split(".")[0] in {p.split(".")[0] for p in ALL_PERMISSIONS}:
                    found.setdefault(key, []).append(f"{path.relative_to(FRONTEND)}:{line_no}")
    return found


def main() -> int:
    found = used_keys()
    unknown = {key: where for key, where in found.items() if key not in ALL_PERMISSIONS}

    for key, where in sorted(unknown.items()):
        print(f"UNKNOWN PERMISSION {key!r} used at {', '.join(where)}")

    unused = sorted(ALL_PERMISSIONS - set(found))
    if unused:
        print(f"\nDefined but never checked in the frontend (fine, the API still enforces them):")
        for key in unused:
            print(f"  {key}")

    if unknown:
        print(f"\nFAIL: {len(unknown)} permission(s) the backend does not define.")
        return 1

    print(f"\nOK: all {len(found)} permission(s) used in the frontend exist.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
