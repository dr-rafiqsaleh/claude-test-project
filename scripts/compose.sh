#!/usr/bin/env bash
#
# `docker compose` with this project's files and environment already worked out.
#
#   ./scripts/compose.sh up -d --build
#   ./scripts/compose.sh ps
#   ./scripts/compose.sh logs -f backend
#   ./scripts/compose.sh down
#
# What it saves you from is not typing, it is this:
#
#   docker compose --project-directory . \
#     -f deploy/compose/base.yml -f deploy/compose/local.yml \
#     --env-file deploy/environments/local/compose.env up -d --build
#
# Every part of that is load-bearing and silently wrong if left out. Without the
# env file the portal is built against the compose defaults and Postgres refuses
# the password it was initialised with - neither failure names its cause.
#
# Only `local` exists so far. A hosted environment adds
# deploy/compose/server.yml and deploy/environments/<env>/compose.env, and this
# script grows a case for it.

set -euo pipefail

ENVIRONMENT="${PESTBASE_ENV:-local}"

case "${1:-}" in
    local)
        ENVIRONMENT="local"
        shift
        ;;
    --help|-h)
        awk 'NR > 1 { if (/^#/) { sub(/^#[ ]?/, ""); print } else { exit } }' "$0"
        exit 0
        ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/deploy/environments/$ENVIRONMENT/compose.env"
OVERLAY="$ROOT/deploy/compose/$ENVIRONMENT.yml"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "No environment descriptor at $ENV_FILE" >&2
    exit 1
fi
if [[ ! -f "$OVERLAY" ]]; then
    echo "No compose overlay at $OVERLAY" >&2
    exit 1
fi

# The backend's own secrets. Kept separate from the Compose variables above so
# that a plain `python -m app.run` on the host keeps working from the same file.
if [[ ! -f "$ROOT/backend/.env" ]]; then
    echo "backend/.env is missing. Copy backend/.env.example and fill it in." >&2
    exit 1
fi

# A runtime file overrides the checked-in descriptor when it exists, so real
# secrets never sit in the repository.
RUNTIME_ENV="$ROOT/deploy/runtime/$ENVIRONMENT/compose.env"
EXTRA_ENV=()
if [[ -f "$RUNTIME_ENV" ]]; then
    EXTRA_ENV=(--env-file "$RUNTIME_ENV")
fi

exec docker compose \
    --project-directory "$ROOT" \
    --project-name "pestbase-$ENVIRONMENT" \
    -f "$ROOT/deploy/compose/base.yml" \
    -f "$OVERLAY" \
    --env-file "$ENV_FILE" \
    "${EXTRA_ENV[@]}" \
    "$@"
