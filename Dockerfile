# Root-level Dockerfile for Railway monorepo build
# cache-bust: v5
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY apps/backoffice/package.json apps/backoffice/
COPY apps/kds/package.json apps/kds/
COPY apps/print-service/package.json apps/print-service/
RUN pnpm install --filter @goblins/api --filter @goblins/shared
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
    apt-get purge -y --auto-remove ca-certificates gnupg curl
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV NODE_ENV=production
COPY --from=build /repo ./
EXPOSE 3000
CMD ["sh", "-c", "cd /repo/apps/api && npx prisma migrate deploy && echo Migrations-Done && if [ \"$SEED_ON_START\" = \"true\" ]; then npx tsx prisma/seed.ts; else echo Skipping-seed; fi && echo Starting-server && node dist/main.js"]
