# build context = repo root
FROM node:22-alpine AS build
RUN corepack enable
# trusted committed lockfile; relax pnpm gates for the throwaway build container
ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 \
    PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/frontend/package.json packages/frontend/
RUN pnpm install --frozen-lockfile --filter frontend...
COPY . .
# prod vps: build (mode prod -> .env.prod); dev vps: build:dev (mode dev -> .env.dev)
ARG FRONTEND_BUILD=build
RUN pnpm --filter frontend run "$FRONTEND_BUILD"

FROM nginx:1.27-alpine AS runtime
COPY packages/infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html
EXPOSE 80
