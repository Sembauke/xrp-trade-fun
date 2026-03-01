# ── Stage 1: build frontend ──────────────────────────────────────────────────
FROM node:20-slim AS frontend

WORKDIR /build
COPY package*.json ./
RUN npm ci

COPY . .
# Empty VITE_API_BASE_URL → fetch('/api/…') calls are relative to same origin
RUN VITE_API_BASE_URL='' npm run build


# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-slim

# better-sqlite3 is a native addon — needs build tools at install time
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps (triggers native rebuild of better-sqlite3)
COPY package*.json ./
RUN npm ci --omit=dev

# Remove build tools now that native compile is done
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

COPY server/ ./server/
COPY --from=frontend /build/dist ./dist/

# SQLite database lives here — mount a volume to persist across restarts
VOLUME ["/app/data"]

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server/index.js"]
