# e2e runner image: the local Playwright harness, containerised. Boots a test
# backend (tsx) + Vite dev server from source and runs the suite against the
# ephemeral db-test + minio-test (see docker-compose.e2e.yml). Built on demand
# by run-e2e.sh and discarded after.
FROM node:20-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY . .

# Install deps only for what the harness runs: backend + frontend webServers and
# the e2e package (shared is pulled in transitively). Skips `landing` (Next.js),
# which is large and unused here - keeps the image small on a disk-tight VPS.
RUN pnpm install --frozen-lockfile \
  --filter "backend..." --filter "frontend..." --filter "e2e-frontend..."
# Install only Chromium (+ OS deps) for the e2e package's Playwright version.
RUN pnpm --filter e2e-frontend exec playwright install --with-deps chromium

# `e2e` = setup-db (migrate test DB) then `playwright test`, which boots the
# backend + frontend webServers internally. Exit code propagates to the script.
CMD ["pnpm", "--filter", "e2e-frontend", "e2e"]
