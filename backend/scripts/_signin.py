"""Signing in from a self-check script, now that sign-in is passwordless.

There is no password to post, so a check cannot simply call a login route. It
asks SuperTokens for a code the way the portal does, then consumes it - through
the same TestClient, so the session cookies come back exactly as a browser would
get them.

The session lives in cookies, not a header the script sets, so each signed-in
person is a dict of request keyword arguments rather than a header dict:

    ann = await sign_in(api, "ann@acme.test")
    api.get("/api/v1/customers", **ann)
    api.get("/api/v1/customers", **inside(platform, client_id))

Every one of these checks needs a SuperTokens core reachable at
SUPERTOKENS_CONNECTION_URI. Start one with:

    ./scripts/compose.sh local up -d supertokens
"""

from typing import Any


class CoreUnreachable(RuntimeError):
    """No SuperTokens core to talk to, which is a setup problem not a failure."""


async def sign_in(api, email: str) -> dict:
    """Sign `email` in and return the request kwargs that carry the session."""
    from supertokens_python.recipe.passwordless.asyncio import create_code

    try:
        code = await create_code(email=email, tenant_id="public")
    except Exception as exc:  # noqa: BLE001
        raise CoreUnreachable(
            f"Could not reach the SuperTokens core to sign {email} in: {exc}\n"
            "Start one with ./scripts/compose.sh local up -d supertokens"
        ) from exc

    response = api.post(
        "/auth/signinup/code/consume",
        json={
            "preAuthSessionId": code.pre_auth_session_id,
            "deviceId": code.device_id,
            "userInputCode": code.user_input_code,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body.get("status") == "OK", body

    # The cookies the consume response set, which is what a browser would keep.
    cookies = {name: value for name, value in response.cookies.items()}
    assert cookies, f"no session cookies came back for {email}: {body}"
    return {"cookies": cookies}


def inside(who: dict, client_id: str) -> dict:
    """A platform account's session, aimed at one client."""
    merged: dict[str, Any] = dict(who)
    headers = dict(merged.get("headers") or {})
    headers["X-Client-Id"] = client_id
    merged["headers"] = headers
    return merged
