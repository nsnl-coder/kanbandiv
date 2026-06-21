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

docker compose -f packages/infra/docker-compose.yml up -d --build
docker image prune -f
