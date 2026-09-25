# syntax=docker/dockerfile:1
#
# The portal: build with Node, serve the static output with nginx, and proxy
# /api and /auth to the backend from the same origin.

# --platform=$BUILDPLATFORM keeps npm install and the Vite build on the
# builder's native architecture even when producing an arm64 image. Safe: the
# output is HTML, CSS and JavaScript, which carry no architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --fund=false

COPY . .

# VITE_* values are compiled into the bundle, not read at runtime, so they must
# be present at build time and the image is specific to one environment.
# Repointing the portal means rebuilding, not restarting with a new variable.
#
# Every VITE_* the compose file passes needs an ARG line here: a build arg with
# no matching ARG is discarded silently, and the bundle then falls back to
# whatever the source hardcodes.
ARG VITE_API_ORIGIN
ARG VITE_AUTH_API_BASE_PATH
ARG VITE_AUTH_WEBSITE_BASE_PATH
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN \
    VITE_AUTH_API_BASE_PATH=$VITE_AUTH_API_BASE_PATH \
    VITE_AUTH_WEBSITE_BASE_PATH=$VITE_AUTH_WEBSITE_BASE_PATH

RUN npm run build

FROM nginx:1.27-alpine AS serve

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# 127.0.0.1, not localhost: nginx.conf says `listen 80`, which binds IPv4 only,
# while /etc/hosts maps localhost to both 127.0.0.1 and ::1. wget tries ::1
# first, gets connection refused, and the container reports unhealthy while
# serving every request perfectly well.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
