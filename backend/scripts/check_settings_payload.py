"""
Every setting the API promises to return is actually returned.

`build_settings_payload` names its fields by hand. `CompanySettingsResponse`
names them again. When the two drift, nothing breaks loudly: the response model
fills the missing field from its own default, so the API cheerfully reports
`false` for a setting that is `true` in the database, and the form reloads with
the box unticked after a save that worked perfectly well.

That is not hypothetical - it is exactly what `email_payment_reminders` did.

No database and no beanie: the settings document is built in memory and the two
field lists are compared.

    python scripts/check_settings_payload.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.company_settings import CompanySettings  # noqa: E402
from app.schemas.company_settings import CompanySettingsResponse  # noqa: E402
from app.services.company_settings_service import (  # noqa: E402
    NUMBERING,
    build_settings_payload,
)

#: Response fields that are deliberately not in `build_settings_payload`.
#: `settings_payload` adds each of these after the fact, so leaving them out of
#: the sync builder is correct rather than an omission.
ADDED_LATER = {"email_configured"} | {field for field, _counter, _name in NUMBERING}

#: Response fields filled in by the router rather than the service.
FROM_THE_ROUTER = {"id"}

#: Reference data the response model supplies itself. The same for every client,
#: so there is nothing for a settings document to hold and nothing to look up.
SCHEMA_CONSTANTS = {"email_placeholders"}


def main() -> int:
    settings = CompanySettings.model_construct()
    try:
        payload = build_settings_payload(settings)
    except AttributeError as exc:
        print(f"FAIL  build_settings_payload reads a field the model does not have: {exc}")
        return 1

    promised = set(CompanySettingsResponse.model_fields)
    produced = set(payload) | ADDED_LATER | FROM_THE_ROUTER | SCHEMA_CONSTANTS

    missing = sorted(promised - produced)
    if missing:
        print("FAIL  the API promises these settings but never returns them:")
        for name in missing:
            field = CompanySettingsResponse.model_fields[name]
            if field.is_required():
                print(f"        {name}  - required, so the response would fail to build")
            else:
                print(f"        {name}  - would always read back as {field.default!r}")
        print()
        print("      Add each one to build_settings_payload in")
        print("      app/services/company_settings_service.py.")
        return 1

    print(f"ok  {len(promised)} response field(s), every one of them produced")

    # The other direction is not a bug, but it is usually a mistake: work done
    # for a value nothing can see.
    unused = sorted(set(payload) - promised)
    if unused:
        print(f"note  built but not in the response schema: {', '.join(unused)}")

    # The write path uses a generic setattr loop, so the only way an updatable
    # field goes nowhere is if the model lacks it.
    from app.schemas.company_settings import CompanySettingsUpdate  # noqa: PLC0415

    # The numbering fields are popped and turned into counter moves before the
    # generic loop runs, so they are meant to have no field on the model.
    counters = {field for field, _counter, _name in NUMBERING}
    unsettable = sorted(
        name
        for name in CompanySettingsUpdate.model_fields
        if name not in CompanySettings.model_fields and name not in counters
    )
    if unsettable:
        print("FAIL  these can be sent to the API but no field on the model holds them:")
        for name in unsettable:
            print(f"        {name}")
        return 1
    print(f"ok  {len(CompanySettingsUpdate.model_fields)} updatable field(s), every one lands on the model")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
