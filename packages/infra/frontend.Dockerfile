# build context = repo root
FROM node:22-alpine AS build
RUN corepack enable
# trusted committed lockfile; relax pnpm gates for the throwaway build container
ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 \
    PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/frontend/package.json packages/frontend/
# shared (dep) + backend (devDep, for AppRouter types) are needed to typecheck.
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
RUN pnpm install --frozen-lockfile --filter frontend...
COPY . .
# Build shared first so its dist/types resolve during the frontend tsc step.
RUN pnpm --filter shared build
# prod vps: build (mode prod -> .env.prod); dev vps: build:dev (mode dev -> .env.dev)
ARG FRONTEND_BUILD=build
ARG SENTRY_RELEASE=dev
# Token via BuildKit secret (not baked into the image). The Sentry vite plugin
# uploads source maps then deletes them; the find is a belt-and-suspenders so no
# .map is ever copied into the nginx image / served to the browser.
RUN --mount=type=secret,id=sentry_auth_token \
    if [ -s /run/secrets/sentry_auth_token ]; then export SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_auth_token); fi; \
    export SENTRY_RELEASE="$SENTRY_RELEASE"; \
    pnpm --filter frontend run "$FRONTEND_BUILD"; \
    find packages/frontend/dist -name '*.map' -delete

FROM nginx:1.27-alpine AS runtime
COPY packages/infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html
EXPOSE 80
