FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/collab-server/package.json apps/collab-server/package.json
COPY apps/projects-api/package.json apps/projects-api/package.json
COPY apps/web-editor-ui/package.json apps/web-editor-ui/package.json
COPY apps/web-monitoring-ui/package.json apps/web-monitoring-ui/package.json
COPY packages/auth-api-client/package.json packages/auth-api-client/package.json
COPY packages/projects-api-client/package.json packages/projects-api-client/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/utils/package.json packages/utils/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm --filter @frelated/web-monitoring-ui build

FROM nginx:1.27-alpine AS runner

COPY apps/web-monitoring-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web-monitoring-ui/dist /usr/share/nginx/html

EXPOSE 80
