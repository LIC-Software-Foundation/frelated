FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/collab-server/package.json apps/collab-server/package.json
COPY apps/compilation-autoscaler/package.json apps/compilation-autoscaler/package.json
COPY apps/projects-api/package.json apps/projects-api/package.json
COPY apps/web-editor-ui/package.json apps/web-editor-ui/package.json
COPY apps/web-monitoring-ui/package.json apps/web-monitoring-ui/package.json
COPY packages/auth-api-client/package.json packages/auth-api-client/package.json
COPY packages/projects-api-client/package.json packages/projects-api-client/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/utils/package.json packages/utils/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm --filter @frelated/compilation-autoscaler build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app /app

WORKDIR /app/apps/compilation-autoscaler

# Runs the compiled output directly with plain `node`, deliberately bypassing
# the pnpm/corepack shim used at build time: corepack needs a writable cache
# directory it does not have here, since this container's root filesystem is
# mounted read-only (see docker-compose.yml). Same approach as
# apps/compilation-worker/Dockerfile, which invokes its runtime (tsx) binary
# directly rather than through `pnpm run`.
CMD ["node", "dist/index.js"]
