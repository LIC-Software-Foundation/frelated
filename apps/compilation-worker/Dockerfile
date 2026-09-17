FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY apps/compilation-worker/package.json apps/compilation-worker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Island of TeX: full TeX Live, without documentation and source trees.
# Pin the multi-platform manifest so every worker runs the same distribution.
FROM texlive/texlive:latest-full@sha256:66446fb092ef02d6dc31bba079d9bdc83e8a6af00562c6062bb97ae8e91814ea
# System fonts complement the fonts shipped by TeX Live (e.g. CV templates).
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation fonts-dejavu-core \
    && fc-cache -f && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY apps/compilation-worker/package.json ./package.json
COPY apps/projects-api/src/compilation ./src/compilation
COPY apps/projects-api/src/config/env.ts ./src/config/env.ts
COPY apps/projects-api/src/services/dataProtection.ts ./src/services/dataProtection.ts
ENV NODE_ENV=production
CMD ["./node_modules/.bin/tsx", "src/compilation/worker.ts"]
