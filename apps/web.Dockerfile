# Builds all three web apps and serves them via nginx:
#   /        -> POS
#   /admin   -> back office
#   /kds     -> KDS
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
RUN pnpm install --frozen-lockfile --filter @goblins/pos --filter @goblins/backoffice --filter @goblins/kds --filter @goblins/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/pos apps/pos
COPY apps/backoffice apps/backoffice
COPY apps/kds apps/kds
RUN pnpm --filter @goblins/shared build \
 && pnpm --filter @goblins/pos exec vite build --base=/ \
 && pnpm --filter @goblins/backoffice exec vite build --base=/admin/ \
 && pnpm --filter @goblins/kds exec vite build --base=/kds/

FROM nginx:alpine
COPY --from=build /repo/apps/pos/dist /usr/share/nginx/html
COPY --from=build /repo/apps/backoffice/dist /usr/share/nginx/html/admin
COPY --from=build /repo/apps/kds/dist /usr/share/nginx/html/kds
COPY apps/web.nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
