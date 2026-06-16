FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/pos/package.json apps/pos/
COPY apps/backoffice/package.json apps/backoffice/
COPY apps/kds/package.json apps/kds/
COPY apps/print-service/package.json apps/print-service/
RUN pnpm install --frozen-lockfile --filter @goblins/print-service
COPY tsconfig.base.json ./
COPY apps/print-service apps/print-service
RUN pnpm --filter @goblins/print-service build

FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo ./
ENV PREVIEW_DIR=/previews
VOLUME /previews
CMD ["node", "apps/print-service/dist/main.js"]
