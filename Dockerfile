# TengaSell — production image
#
# Runs the real node, not the static demo:
#   Trailbase (Rust)  :3001   marketplace records + auth
#   Next.js           :3000   252 BFF routes
#   mini-services     :3002/3004/3005/3006/3007/3008
#   gateway           :$PORT  public entry point (Caddy equivalent)
#
# Build:  docker build -t tengasell .
# Run:    docker run -p 8080:8080 -v tengasell_data:/data tengasell

# ── build ─────────────────────────────────────────────────────────────
FROM node:22-bookworm AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx prisma generate
RUN npm run build

# Assemble the standalone runtime exactly as Next expects it.
RUN mkdir -p /app/out \
 && cp -R .next/standalone /app/out/app \
 && cp -R .next/static /app/out/app/.next/static \
 && cp -R public /app/out/app/public \
 && (cp -R node_modules/.prisma /app/out/app/node_modules/.prisma 2>/dev/null || true) \
 && (cp -R node_modules/@prisma/client /app/out/app/node_modules/@prisma/client 2>/dev/null || true)

# Mini-service dependencies (socket.io for the trade engine).
RUN cd mini-services/trade-engine && npm install --omit=dev --no-audit --no-fund

# ── runtime ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

# Bun runs the TypeScript mini-services.
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# Trailbase (Rust) — same version as the vendored 0.35.1 binary.
ARG TARGETARCH=amd64
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) TB=x86_64_linux ;; \
      arm64) TB=aarch64_linux ;; \
      *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/tb.zip \
      "https://github.com/trailbaseio/trailbase/releases/download/v0.35.1/trailbase_v0.35.1_${TB}.zip"; \
    unzip -o /tmp/tb.zip -d /usr/local/bin; \
    chmod +x /usr/local/bin/trail; \
    rm /tmp/tb.zip; \
    /usr/local/bin/trail --version

WORKDIR /app

COPY --from=build /app/out/app /app
COPY scripts/gateway.mjs /app/gateway.mjs
COPY mini-services /app/mini-services

# Depot template (config + migrations) and optional prebuilt seed databases.
COPY mini-services/trailbase-db/traildepot /app/depot-template
COPY deploy/seed /app/seed

COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production \
    PORT=8080 \
    TRAILBASE_URL=http://127.0.0.1:3001 \
    TGS_DATA_DIR=/data

EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
