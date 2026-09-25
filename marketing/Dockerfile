# syntax=docker/dockerfile:1
#
# pestbase.co.uk: build the React site with Node, prerender every page, and
# serve the static result with nginx. Separate from the portal image - it has
# its own release cadence and nothing in common at runtime.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline --no-audit --fund=false

COPY . .

# Optional: where the contact form posts. Unset, the build uses the app's
# origin (https://app.pestbase.co.uk). Compiled in, so changing it means a
# rebuild.
ARG VITE_API_ORIGIN
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN

RUN npm run build

FROM nginx:1.27-alpine AS serve

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
