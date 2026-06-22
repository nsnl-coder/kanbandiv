# Lightweight Playwright runner. It does NOT build or run the app - it drives the
# LIVE deployed site (E2E_BASE_URL) as a pre-seeded test user. Only the e2e
# package (Playwright) + Chromium are installed.
FROM node:20-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app
COPY . .

# Only the e2e package's deps (no backend/frontend/landing install).
RUN pnpm install --frozen-lockfile --filter "e2e-frontend..."
# e2e imports the shared TEST_USERS list, so build shared's dist.
RUN pnpm --filter shared build
RUN pnpm --filter e2e-frontend exec playwright install --with-deps chromium

CMD ["pnpm", "--filter", "e2e-frontend", "exec", "playwright", "test"]
