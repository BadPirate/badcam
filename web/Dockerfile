# syntax=docker/dockerfile:1
# Build context: web/

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm prisma generate && pnpm build

# One-shot: applies migrations, then exits. Run before the web service.
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["pnpm", "prisma", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /app \
  && chown node:node /data /app
WORKDIR /app
ENV NODE_ENV=production TZ=UTC PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma/migrations ./prisma/migrations
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
