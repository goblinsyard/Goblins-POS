# Root-level Dockerfile for Railway monorepo build
# cache-bust: v11 - single stage, no symlink breakage
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl python3 make g++ ca-certificates gnupg curl && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt/ bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client-16

RUN npm install -g pnpm@8

WORKDIR /repo

COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY apps/backoffice/package.json apps/backoffice/
COPY apps/kds/package.json apps/kds/
COPY apps/print-service/package.json apps/print-service/

RUN pnpm install

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @goblins/shared build && \
    pnpm --filter @goblins/api db:generate && \
    pnpm --filter @goblins/api build

ENV NODE_ENV=production
EXPOSE 3000
CMD sh -c "cd /repo/apps/api && npx prisma migrate deploy && echo Migrations-Done && node dist/main.js"
