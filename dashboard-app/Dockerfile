# syntax=docker/dockerfile:1.6

# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps with cache-friendly layer
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install

# Copy source and build
COPY . .
# Bakes the shared backend API token into the built bundle at build time (Vite
# exposes any VITE_-prefixed env var to import.meta.env automatically) — so the
# AI Agent authenticates to the backend with no manual setup step. See
# docker-compose.yml, which passes BACKEND_API_TOKEN through as this build arg.
ARG VITE_BACKEND_API_TOKEN=""
ENV VITE_BACKEND_API_TOKEN=$VITE_BACKEND_API_TOKEN
RUN npm run build

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine AS runner

# SPA-friendly nginx config (fallback to index.html for client-side routing)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static bundle
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
