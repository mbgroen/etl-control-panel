# syntax=docker/dockerfile:1

# ==============================================================================
# ET: Legacy Control Panel
#
# Multi-stage build producing a single image that serves both the REST/WebSocket
# API and the pre-built React SPA. The frontend and backend are built in
# parallel stages so a change to one does not invalidate the other's cache.
# ==============================================================================

ARG NODE_VERSION=22-alpine

# ------------------------------------------------------------------ web build
FROM node:${NODE_VERSION} AS web-build
WORKDIR /build

# Dependencies are installed from the lockfile alone, so this layer is reused
# for every source-only change.
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

# --------------------------------------------------------------- server build
FROM node:${NODE_VERSION} AS server-build
WORKDIR /build

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# --------------------------------------------------- production dependencies
FROM node:${NODE_VERSION} AS deps
WORKDIR /build
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# -------------------------------------------------------------------- runtime
FROM node:${NODE_VERSION} AS runtime

# wget backs the container healthcheck; tini reaps zombies and forwards signals
# so `docker stop` results in a clean shutdown rather than a 10s SIGKILL wait.
RUN apk add --no-cache tini wget

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

COPY --from=deps      /build/node_modules ./node_modules
COPY --from=server-build /build/dist      ./dist
COPY --from=web-build /build/dist         ./public
COPY server/package.json ./package.json

# Default state location; the compose file bind-mounts over it for persistence.
RUN mkdir -p /data/control-panel && chown -R node:node /data/control-panel /app

# Runs unprivileged by default. Access to the Docker socket is granted in the
# compose file via group_add rather than by running this process as root.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
