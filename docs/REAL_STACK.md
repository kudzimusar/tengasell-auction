# Running the real node (Next + gateway + Trailbase)

TengaSell has two ways to run, and they are not interchangeable:

| Mode | What runs | Where | Data |
| --- | --- | --- | --- |
| **Static demo** | the SPA only, using its offline store | GitHub Pages | seeded, per-browser `localStorage` |
| **Real node** | Next.js + gateway + Trailbase (Rust) + services | a machine with a Node runtime | the marketplace database |

GitHub Pages cannot be the real node. Pages serves static files: it cannot run the 252 API
routes, cannot run the Rust process, and cannot proxy `?XTransformPort=` requests the way the
app expects (see `Caddyfile`). The Pages deployment therefore stays a demo by construction,
not by oversight.

---

## Verified configuration (this machine, 2026-10-21)

```
Next.js 16 (production build)      :3000
gateway (Caddy equivalent)         :8080   ← browser entry point
Trailbase v0.35.1 (arm64)          :3001
```

Checked through the gateway:

| Probe | Result |
| --- | --- |
| `GET /` | 200, title *Tengasell — Zimbabwe's Online Auction Marketplace* |
| `GET /api/public/status` (BFF) | 200 |
| `GET /api/records/v1/categories?XTransformPort=3001` | 200, 11 categories |
| `GET /api/records/v1/auctions?count=true&XTransformPort=3001` | 200, **55 auctions** |
| `GET /api/records/v1/bids?count=true&XTransformPort=3001` | 200, **443 bids** |
| `GET /api/records/v1/offers?XTransformPort=3001` | 200 (Gap-8 table exists) |
| `POST /api/auth/v1/login?XTransformPort=3001` (staff credentials from the vault) | 200, token issued |

---

## Bring it up

```bash
# 0. one-time: Trailbase binary for your platform (v0.35.1)
mkdir -p .tools && cd .tools
gh release download v0.35.1 --repo trailbaseio/trailbase \
  --pattern "trailbase_v0.35.1_$(uname -m | sed 's/x86_64/x86_64/;s/arm64/aarch64/')_apple_darwin.zip"
unzip -o trailbase_v0.35.1_*_apple_darwin.zip -d tb && chmod +x tb/trail
cd ..

# 1. depot = config + migrations; DB lives at traildepot/data/main.db
mkdir -p /tmp/tb-node
cp -R mini-services/trailbase-db/traildepot /tmp/tb-node/traildepot

# 2. first boot applies all migrations (including Gap-8) and seeds
.tools/tb/trail --depot /tmp/tb-node/traildepot run --address 0.0.0.0:3001

# 3. (optional) replace seed rows with the harvested production data
python3 scripts/import-harvest.py \
  /tmp/tb-node/traildepot/data/main.db \
  ../tengasell-data-harvest/dbs/trailbase-marketplace.db

# 4. app
DATABASE_URL="file:$PWD/ci.db" TRAILBASE_URL="http://127.0.0.1:3001" \
  npx next start -p 3000

# 5. gateway (what Caddy does in production)
node scripts/gateway.mjs --port 8080 --app 3000
# open http://127.0.0.1:8080
```

`scripts/gateway.mjs` implements the `Caddyfile` rule exactly: any request with
`?XTransformPort=<port>` is proxied to that localhost port (3001 Trailbase, 3002 trade engine,
3004 GIS, 3005 comms, 3006 finance, 3007 trust, 3008 govern); everything else goes to :3000.
WebSocket upgrades are proxied too.

---

## Ports

| Port | Process |
| ---: | --- |
| 3000 | Next.js app (252 route handlers) |
| 3001 | Trailbase (Rust) — records, auth |
| 3002 | trade-engine (socket.io, auction lifecycle) |
| 3004 | GIS |
| 3005 | comms |
| 3006 | finance |
| 3007 | trust |
| 3008 | govern |
| 8080 | gateway (production: Caddy on :81) |

---

## Going public

Pages cannot host this. To serve the real node on the internet, deploy the same pieces to any
host that runs a persistent Linux x86_64 process (Render, Fly.io, Railway, or a VPS):

1. Build with `npm run build` (emits `.next/standalone`).
2. Run the vendored Trailbase `x86_64_linux` binary with `--depot ./traildepot --address 0.0.0.0:3001`.
3. Run the app with `node .next/standalone/server.js` and `DATABASE_URL` / `TRAILBASE_URL` set.
4. Put the gateway (or Caddy with the repo's `Caddyfile`) in front on one public port.
5. Deploy the mini-services with Bun (`bun install && bun index.ts` per service).

The database is SQLite, so a single instance with a persistent volume is the working
configuration; Postgres migration is required before horizontal scaling.

---

## Migration note (important)

`U1000000006__gap8.sql` must stay ordered **after** Trailbase's own built-in migrations
(`U1785764695__unverified_email`, `U1791097712__unique_unverified_email`). A database that
already has those applied will skip an out-of-order Gap-8 migration silently — the tables simply
never appear. A fresh depot applies everything in filename order and is correct.

The archived production snapshot predates Gap-8, so its `offers`, `saved_searches` and
`live_sessions` tables are empty (schema only). Best-Offer, saved-search and live-room rows
cannot be recovered from the archive.
