# Root-level Dockerfile for Railway monorepo build
# Build context = repo root, so all workspace files are available

FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY apps/backoffice/package.json apps/backoffice/
COPY apps/kds/package.json apps/kds/
COPY apps/print-service/package.json apps/print-service/
RUN pnpm install --frozen-lockfile --filter @goblins/api --filter @goblins/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @goblins/shared build && pnpm --filter @goblins/api db:generate && pnpm --filter @goblins/api build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gnupg curl && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] http://apt.postgresql.org/pub/repos/apt/ bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends openssl postgresql-client-16 && \
    apt-get purge -y --auto-remove ca-certificates gnupg curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /repo
RUN corepack enable
ENV NODE_ENV=production
COPY --from=build /repo ./
EXPOSE 3000
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && ([ \"$SEED_ON_START\" = \"true\" ] && npx tsx prisma/seed.ts || true) && node dist/main.js"]
