#!/usr/bin/env bash
set -euo pipefail

# Run the e2e suite on the dev/prod VPS against an EPHEMERAL test Postgres that
# exists only for this run (separate compose project trelloclone3-e2e, tmpfs), so:
#   - it never touches the live db/pgdata, and
#   - `down -v` at the end frees all CPU/RAM/containers (nothing persists).
# Object storage reuses the LIVE MinIO via a dedicated `attachments-test` bucket
# (emptied at the start of the run). The live stack keeps serving users throughout.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

PROJECT=trelloclone3-e2e
COMPOSE="docker compose -p $PROJECT -f packages/infra/docker-compose.e2e.yml"

# Pull MAIL_*, MAILTRAP_API_TOKEN, POSTGRES_PASSWORD, MINIO_* from the VPS env so
# compose can interpolate them into the e2e service.
set -a
[ -f packages/infra/.env ] && . packages/infra/.env
set +a

cleanup() {
  echo "=== e2e teardown: removing ephemeral test PG (live MinIO untouched) ==="
  $COMPOSE down -v --remove-orphans || true
  # Reclaim the (large) e2e image + build cache so runs don't fill a small VPS.
  docker image rm -f "${PROJECT}-e2e" 2>/dev/null || true
  docker builder prune -f >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "=== building e2e runner ==="
$COMPOSE build e2e

echo "=== running e2e against ephemeral test PG + MinIO ==="
# `run` starts the deps (db-test healthy, minio-test bucket created), runs the
# suite in the foreground, and propagates Playwright's exit code. The trap then
# tears everything down whether it passed or failed.
$COMPOSE run --rm e2e
