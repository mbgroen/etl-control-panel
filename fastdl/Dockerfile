# syntax=docker/dockerfile:1

# ==============================================================================
# ET: Legacy FastDL
#
# nginx with the download configuration baked in. Shipping this as an image
# rather than mounting a config file is what allows a pure WebUI install: the
# operator pastes a compose file and needs no source checkout on the host.
# ==============================================================================

FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="ET: Legacy FastDL" \
      org.opencontainers.image.description="HTTP download server for ET: Legacy map packages" \
      org.opencontainers.image.source="https://github.com/mbgroen/etl-control-panel" \
      org.opencontainers.image.licenses="MIT"

# Replaces the stock default site.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The game data directory is bind-mounted read-only at run time; this is only a
# mount point so nginx starts cleanly when the volume is missing.
RUN mkdir -p /srv/fastdl

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/healthz || exit 1
