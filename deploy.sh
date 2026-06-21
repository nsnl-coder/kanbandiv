#!/usr/bin/env bash
set -euo pipefail

# Unified deploy for dev + prod VPS. Run it from anywhere; it locates the repo
# from its own path, so no hardcoded directory to get wrong. Both VPS clone the
# repo to /opt/trello (see packages/infra/vps-info.md).
#
# Tier (VPS_ENV) + all secrets/domains come from packages/infra/.env on the box,
# so the same script serves dev and prod with no flags.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

git pull --ff-only

# git pull may have updated this very script. bash already parsed the OLD
# version into memory, so re-exec the freshly pulled one once (guarded against
# looping) so the run always uses the latest deploy logic.
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  DEPLOY_REEXEC=1 exec bash "$0" "$@"
fi

COMPOSE="docker compose -f packages/infra/docker-compose.yml"

# Build one image at a time. Parallel builds (compose's default) run tsc/vite/next
# concurrently and exhaust the small VPS RAM, forcing swap thrash that freezes
# sshd and can kill the BuildKit session (DeadlineExceeded). Serial keeps peak
# memory to a single build.
for svc in backend frontend landing; do
  echo "=== building $svc ==="
  $COMPOSE build "$svc"
done

$COMPOSE up -d
docker image prune -f
