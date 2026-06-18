# build context = repo root
FROM node:22-alpine AS build
RUN corepack enable
# trusted committed lockfile; skip new-release age gate in CI build
ENV PNPM_CONFIG_MINIMUM_RELEASE_AGE=0
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/frontend/package.json packages/frontend/
RUN pnpm install --frozen-lockfile --filter frontend...
COPY . .
RUN pnpm --filter frontend build

FROM nginx:1.27-alpine AS runtime
COPY packages/infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html
EXPOSE 80
