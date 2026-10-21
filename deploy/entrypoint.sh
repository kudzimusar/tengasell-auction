#!/usr/bin/env bash
# Boots the whole TengaSell node inside one container.
#   /data/traildepot  Traildepot (config, migrations, databases) — persists
#   /data/db          Platform (Prisma/SQLite) database — persists
set -euo pipefail

DATA_DIR="${TGS_DATA_DIR:-/data}"
PORT="${PORT:-8080}"

log() { printf '[entrypoint] %s\n' "$*"; }

mkdir -p "$DATA_DIR/traildepot" "$DATA_DIR/db"

# ── Trailbase depot ───────────────────────────────────────────────────
if [ ! -d "$DATA_DIR/traildepot/migrations" ]; then
  log "seeding traildepot from template"
  cp -R /app/depot-template/. "$DATA_DIR/traildepot/"
fi

mkdir -p "$DATA_DIR/traildepot/data"
if [ ! -f "$DATA_DIR/traildepot/data/main.db" ]; then
  if [ -f /app/seed/trailbase-main.db ]; then
    log "installing harvested marketplace database"
    cp /app/seed/trailbase-main.db "$DATA_DIR/traildepot/data/main.db"
    rm -f "$DATA_DIR/traildepot/data/main.db-wal" "$DATA_DIR/traildepot/data/main.db-shm"
  else
    log "no seed database — migrations will create and seed a fresh store"
  fi
fi

# ── Platform database ─────────────────────────────────────────────────
if [ ! -f "$DATA_DIR/db/custom.db" ] && [ -f /app/seed/platform.db ]; then
  log "installing harvested platform database"
  cp /app/seed/platform.db "$DATA_DIR/db/custom.db"
fi

# ── Service databases (comms / finance / govern / trust) ──────────────
for svc in comms finance govern trust; do
  if [ ! -f "$DATA_DIR/db/$svc.db" ] && [ -f "/app/seed/$svc.db" ]; then
    log "installing $svc database"
    cp "/app/seed/$svc.db" "$DATA_DIR/db/$svc.db"
    rm -f "$DATA_DIR/db/$svc.db-wal" "$DATA_DIR/db/$svc.db-shm"
  fi
done

# The services default to /home/z/my-project paths from the original sandbox.
export COMMS_DB_PATH="$DATA_DIR/db/comms.db"
export FINANCE_DB_PATH="$DATA_DIR/db/finance.db"
export GOVERN_DB_PATH="$DATA_DIR/db/govern.db"
export TRUST_DB_PATH="$DATA_DIR/db/trust.db"
export MSCS_WORKSHEET_PATH="${MSCS_WORKSHEET_PATH:-/app/agent-ctx/mscs-worksheet-12.json}"

# ── Trailbase (Rust) ──────────────────────────────────────────────────
log "starting trailbase on :3001"
trail --depot "$DATA_DIR/traildepot" run --address 0.0.0.0:3001 &
TRAIL_PID=$!

# Wait for the records API before starting anything that depends on it.
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:3001/api/records/v1/categories?limit=1"; then
    log "trailbase ready (${i}s)"
    break
  fi
  sleep 1
done

# ── mini-services (bun) ───────────────────────────────────────────────
start_service() {
  local dir="$1" name="$2"
  if [ -f "/app/mini-services/$dir/index.ts" ]; then
    ( cd "/app/mini-services/$dir" && exec bun index.ts ) >"/tmp/$name.log" 2>&1 &
    log "$name started (pid $!)"
  fi
}

start_service trade-engine  trade-engine
start_service gis-service   gis
start_service comms-service comms
start_service finance-service finance
start_service trust-service trust
start_service govern-service govern

# ── Next.js ───────────────────────────────────────────────────────────
log "starting app on :3000"
# Next standalone binds to $HOSTNAME when it is set — Docker sets it to the
# container id, which makes the app unreachable from the gateway.
HOSTNAME=0.0.0.0 PORT=3000 \
  DATABASE_URL="file:$DATA_DIR/db/custom.db" \
  TRAILBASE_URL="http://127.0.0.1:3001" \
  node /app/server.js &
APP_PID=$!

# ── Gateway (public) ──────────────────────────────────────────────────
log "starting gateway on :$PORT"
node /app/gateway.mjs --port "$PORT" --app 3000 &

# If the app dies, bring the container down so Fly restarts it. Services that
# crash are logged but must not take the marketplace offline.
trap 'kill 0' TERM INT
wait "$APP_PID"
log "app exited — shutting down"
kill 0
