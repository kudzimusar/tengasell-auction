# TengaSell — Zimbabwe's Online Auction Marketplace

TengaSell is a full-stack auction marketplace for the Zimbabwean market: sellers list items with
location-aware pickup, buyers bid in live rooms or place best offers, and orders settle through
Paynow with commission, trust and governance controls built in.

This repository is the working source of truth for the product — application code, backend
microservices, operational tooling, and the audit/UAT trail that documents how the system was
built and verified.

> **Status: pre-production.** Every flow described below is implemented and exercised by the
> project's own UAT and smoke tooling. Production launch still requires the checklist in
> [`Production readiness`](#production-readiness).

---

## Live surfaces

| Surface | URL |
| --- | --- |
| Project preview site (GitHub Pages) | https://kudzimusar.github.io/tengasell-auction/ |
| Repository | https://github.com/kudzimusar/tengasell-auction |
| CI runs | https://github.com/kudzimusar/tengasell-auction/actions |

> GitHub Pages serves static files only. The preview site documents and showcases the product;
> the interactive application requires a Node.js runtime (see [`Hosting`](#hosting)).

---

## What the product does

- **Sell flow** — draft → photos → category → location (map pin) → pricing → publish, with a
  review step and a success hand-off.
- **Auctions** — scheduled start/end, live rooms, hammer/auto-close, bid increments, outbid
  notifications, retraction handling.
- **Best offer** — structured negotiation loop that converts to an order without an auction.
- **Orders & checkout** — cart, delivery vs pickup, fees, Paynow payment hand-off and callback.
- **Payments** — Paynow integration (mock mode when credentials are absent), finance ledger.
- **Comms** — in-app threads, WhatsApp/Telegram/email notifications, unsubscribe handling.
- **Trust & governance** — moderation queues, trust tickets, compliance console, RBAC,
  MFA and recovery flows.
- **GIS** — MapLibre-based location picking plus a tile-caching GIS microservice.
- **Ops** — public status page, incident history, smoke monitoring, SAST/DAST audit packs.

The application is a client-rendered SPA shell (hash router) mounted at `/`, talking to a
Next.js Route Handler API.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser — TengaSell SPA (React 19, client-only mount)       │
└───────────────┬──────────────────────────────────────────────┘
                │ fetch / WebSocket
┌───────────────▼──────────────────────────────────────────────┐
│  Next.js 16 App Router — 252 API route handlers               │
│  auth · listings · bids · orders · payments · comms · trust    │
│  Prisma ORM ──► SQLite (per-service databases)                │
└───────────────┬──────────────────────────────────────────────┘
                │ internal HTTP
┌───────────────▼──────────────────────────────────────────────┐
│  mini-services/                                               │
│  trade-engine · finance-service · comms-service ·             │
│  trust-service · govern-service · gis-service ·               │
│  trailbase-db                                                 │
└──────────────────────────────────────────────────────────────┘
```

| Layer | Technology |
| --- | --- |
| UI | Next.js 16, React 19, Tailwind CSS 4, shadcn/Radix, framer-motion, recharts |
| State/data | TanStack Query, Zustand, react-hook-form + zod |
| API | Next.js Route Handlers (Node runtime), 252 endpoints |
| Data | Prisma 6 + SQLite (`db/` at runtime, git-ignored) |
| Auth | next-auth, password + MFA/recovery flows, RBAC roles |
| Maps | MapLibre GL + GIS microservice with tile cache |
| Payments | Paynow (Zimbabwe) with mock mode |
| Gateway | Caddy (`Caddyfile`) |
| CI | GitHub Actions (lint, typecheck, build, smoke) |

---

## Repository layout

```
src/
  app/                 Next.js app shell + 252 API route handlers
  components/tengasell/ product UI (pages, auction, sell, checkout, admin)
  lib/                 shared client + server libraries (db, auth, paynow, api)
mini-services/         trade-engine, finance, comms, trust, govern, gis, trailbase-db
prisma/                schema, seed, assessment data
ops/                   smoke, DAST, SAST, backup/restore, gap-8 verification, runbooks
agent-ctx/             build context and module notes from the delivery programme
tests/                 runtime/container test scripts
screenshots/           UAT evidence captured on desktop and mobile viewports
upload/                source specification documents
docs/preview/          static project site published to GitHub Pages
infra/                 GIS deployment (docker-compose)
.zscripts/             local build/dev/start helpers
worklog.md             chronological engineering log
CHANGELOG.md           release history
```

---

## Getting started

**Requirements:** Node.js ≥ 20.9 (CI uses 22), npm. Bun is optional — `bun.lock` is kept for
contributors who prefer it.

```bash
npm install
cp .env.example .env            # if absent, create .env with DATABASE_URL
npx prisma generate
npx prisma db push              # creates the local SQLite schema
npm run dev                     # http://localhost:3000
```

Minimal `.env`:

```dotenv
DATABASE_URL="file:./db/custom.db"
# Optional — Paynow runs in mock mode when these are unset
# PAYNOW_INTEGRATION_ID=
# PAYNOW_INTEGRATION_KEY=
```

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next dev server on port 3000 |
| `npm run build` | Production build (standalone output) |
| `npm run start` | Run the standalone server |
| `npm run lint` | ESLint |
| `npm run db:push` | Push Prisma schema to SQLite |
| `npm run db:generate` | Regenerate Prisma client |

Demo/sandbox accounts are seeded fixtures surfaced on the in-app **Developers** page; they are
not production credentials.

---

## Verification

The project ships its own verification tooling (run against a booted app):

```bash
bun ops/smoke.ts          # golden-endpoint smoke contract
bun ops/dast.ts           # dynamic security checks
bun ops/sast.ts           # static analysis pack
bun ops/gap8-check.ts     # feature-gap verification
```

`ops/reports/` holds the generated SAST/DAST evidence and the audit pack index.
`screenshots/` holds the UAT evidence across 390 px, 768 px and desktop viewports.

---

## CI/CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR to `main` | install → Prisma generate → lint → typecheck → build → boot & probe API |
| `.github/workflows/pages.yml` | push to `main` | publishes `docs/preview/` to GitHub Pages |

CI uses a throwaway SQLite database (`ci.db`) and never touches real data or secrets.

---

## Hosting

**GitHub Pages cannot run this application.** Pages is static hosting; TengaSell needs a Node.js
server for its 252 API routes, Prisma/SQLite access, WebSockets and the microservices.

- **Preview/documentation** → GitHub Pages (this repo's `docs/preview/`, automatic).
- **Application runtime** → a Node host such as Vercel, Render or Fly.io. The build emits
  `.next/standalone`, which runs with `node .next/standalone/server.js`.
- **Database** → SQLite is viable for a single-instance deployment; a managed database is
  recommended before multi-instance production.
- **Microservices** → deploy `mini-services/*` alongside the app (each has its own runtime
  requirements; see `.zscripts/mini-services-*.sh`).

---

## Production readiness

Before public launch:

1. Managed database and migrations (SQLite → Postgres) with backups verified by restore test.
2. Real Paynow credentials, webhook signature verification, reconciliation.
3. Production auth: secure cookies, session storage, MFA enforcement for staff roles.
4. Server-side RBAC on every route (client guards are UX only).
5. Secrets management (no `.env` in images), TLS termination, tightened CSP (drop
   `unsafe-eval`, add nonces).
6. Microservice deployment topology, health checks, and observability.
7. Load testing for live auction concurrency and WebSocket fan-out.
8. Legal: privacy policy, DSAR handling, terms, and Zimbabwean payments compliance.

---

## License

Proprietary — © TengaSell. All rights reserved. Not open source.
