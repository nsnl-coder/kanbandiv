#!/usr/bin/env bash
set -euo pipefail

# Run the e2e suite against the LIVE deployed site (this tier's domain), driving a
# pre-seeded test user. No test DB / MinIO / app boot - just a small Playwright
# runner container hitting the public URL. The live stack is read/written only
# through the test account (and unique throwaway sign-up emails).
#
# Required in packages/infra/.env (or the shell): the E2E_* test-account creds +
# MAILTRAP_API_TOKEN. E2E_BASE_URL defaults from VPS_ENV but can be overridden.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

PROJECT=trelloclone3-e2e
COMPOSE="docker compose -p $PROJECT -f packages/infra/docker-compose.e2e.yml"

# Pull test-account creds, Mailtrap token, and VPS_ENV from the tier's env.
set -a
[ -f packages/infra/.env ] && . packages/infra/.env
set +a

# Default the target site from the tier unless E2E_BASE_URL is already set.
# Destructive specs (user creation / password change) run on dev only; prod runs
# the non-destructive subset.
if [ -z "${E2E_BASE_URL:-}" ]; then
  case "${VPS_ENV:-dev}" in
    prod) export E2E_BASE_URL="https://app.trello-clone.shop" ;;
    *)    export E2E_BASE_URL="https://dev-app.trello-clone.shop" ;;
  esac
fi
case "${VPS_ENV:-dev}" in
  prod) export E2E_ALLOW_DESTRUCTIVE=false ;;
  *)    export E2E_ALLOW_DESTRUCTIVE=true ;;
esac
echo "=== e2e target: $E2E_BASE_URL (destructive=$E2E_ALLOW_DESTRUCTIVE) ==="

cleanup() {
  echo "=== e2e teardown ==="
  $COMPOSE down --remove-orphans || true
  docker image rm -f "${PROJECT}-e2e" 2>/dev/null || true
  docker builder prune -f >/dev/null 2>&1 || true
}
trap cleanup EXIT

$COMPOSE build e2e
# Foreground run; Playwright's exit code propagates out (trap still tears down).
$COMPOSE run --rm e2e
