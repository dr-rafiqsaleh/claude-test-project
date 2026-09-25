# pestbase.co.uk: the static marketing site, served by nginx.
# Deliberately separate from the portal image - it has no build step, no API and
# no reason to be redeployed when the app is.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html privacy.html 404.html styles.css favicon.svg robots.txt sitemap.xml /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
