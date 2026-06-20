# build context = repo root
FROM node:22-alpine AS base
RUN corepack enable
# trusted committed lockfile; relax pnpm gates for the throwaway build container
ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 \
    PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter backend...
COPY . .
RUN pnpm --filter shared build
RUN pnpm --filter backend build

# Upload source maps to Sentry, then strip .map so they never ship in the runtime
# image. Token comes via a BuildKit secret (never baked into an image layer); when
# absent (e.g. local build) the upload is skipped but maps are still removed.
ARG SENTRY_RELEASE=dev
ENV SENTRY_URL=https://us.sentry.io
RUN --mount=type=secret,id=sentry_auth_token \
    if [ -s /run/secrets/sentry_auth_token ]; then \
      export SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_auth_token); \
      pnpm --filter backend exec sentry-cli sourcemaps inject dist; \
      pnpm --filter backend exec sentry-cli sourcemaps upload \
        --org that-nails-tech --project node-express --release "$SENTRY_RELEASE" \
        dist; \
    fi; \
    find packages/backend/dist -name '*.map' -delete

FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter backend...
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
EXPOSE 4000
CMD ["node", "packages/backend/dist/index.js"]
