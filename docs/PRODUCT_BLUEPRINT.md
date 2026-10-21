# TengaSell — Product & System Blueprint

Extracted from the source archive (`workspace-0488aa8f…tar`) and verified against the running
build. This is the authoritative description of what was actually built — not an aspiration.

---

## 1. What the product is

A Zimbabwean auction marketplace. Sellers list items (map-pinned location, photos, category,
reserve/buy-now), buyers bid in timed or live auction rooms or negotiate a best offer, and orders
settle in USD through Paynow with buyer protection, trust/moderation and a finance ledger behind it.

Brand: **Tengasell** · tagline *"a snap to your happy deal"* · hero *"Win it. Tengasell it."* ·
domain `tengasell.com` · bilingual UI (English / 日本語).

---

## 2. Runtime architecture — two modes

The client (`src/lib/tengasell/api/index.ts`) probes the backend on boot and picks an adapter:

```
initApi()
  ├─ GET /api/records/v1/categories?XTransformPort=3001   (2.5s timeout)
  ├─ reachable  → RemoteApi   → TrailBase (Rust) on :3001
  └─ unreachable → LocalStore → src/data/seed.ts + localStorage   ← demo mode
```

Both adapters implement the **same `TengasellApi` contract** (~60 methods), so the UI is identical
in either mode. This is why the real interface runs on GitHub Pages with no server.

| Mode | Data | Persistence | Used by |
| --- | --- | --- | --- |
| **live** | TrailBase records API | SQLite via TrailBase | production / local stack |
| **demo** | `src/data/seed.ts` (deterministic LCG seed) | browser `localStorage` | Pages demo, offline |

The demo store is not a mock UI: it implements real bid increments, auto-bidding, offer
counter-flows, order lifecycle, payments, ratings, watchlists, saved searches, live rooms and
notifications — client-side.

---

## 3. Two data layers (important)

There are **two distinct databases**, which is easy to confuse:

**A. TrailBase (Rust) — the marketplace record store**
`mini-services/trailbase-db/traildepot/` holds `config.textproto` and six migrations. Tables:

```
auctions  bids  categories  profiles  watchlist  offers  orders  payments
paynow_sessions  messages  threads  notifications  ratings  questions
saved_searches  live_sessions  audit_events
```

TrailBase is a **prebuilt Rust binary** (`trailbase_v0.35.1_x86_64_linux`), not source in this repo.
The archive carried it at `backups/vendor/…zip`; it was excluded from git as a 28 MB build artifact.

**B. Prisma + SQLite — the platform/BFF store**
`prisma/schema.prisma` defines **84 models** for everything around the marketplace:

| Domain | Models |
| --- | --- |
| Identity & access | `User` `SessionRecord` `AuthEvent` `PasswordResetToken` `StepUpToken` `StaffGrant` `ApiKey` `DeveloperApp` |
| Catalogue | `Category` `Listing` `ListingVersion` `MediaAsset` `Article` `ArticleVersion` |
| Trading | `Bid` `Offer`* `Order` `OrderEvent` `Payment` `Refund` `Review` `Watch` `SavedSearch` |
| Trust & safety | `Dispute` `AbuseReport` `Enforcement` `Appeal` `SanctionsScreening` `RiskItem` `RiskException` |
| Comms | `MessageThread` `Message` `Notification` `NotificationPref` `Template` `Campaign` `EmailOutbox` `ChannelAccount` `Suppression` |
| Finance | `LedgerEntry` `Payout` `Invoice` `TaxLine` `ReconciliationRun` `MonthlyClose` |
| Governance | `Policy` `PolicyAcceptance` `LegalRequest` `RegulatoryReport` `LegalHold` `InternalAudit` `ApprovalRequest` |
| Privacy | `ConsentRecord` `DsarRequest` `DataInventory` `RetentionRule` `PrivacyIncident` `Processor` |
| Platform ops | `FeatureFlag` `ConfigSetting` `Incident` `StatusEvent` `BackupRun` `RestoreTest` `BcpPlan` `BreakGlassAccess` `ReleaseRecord` `MetricDaily` `AppLog` |
| MSCS certification | `MscsControl` `MscsEvidence` `MscsFinding` `MscsAssessment` `MscsCertification` |

\* `Offer` exists in the TypeScript contract; the TrailBase side stores offers in `offers`.

---

## 4. API surface — 252 route handlers

| Domain | Routes | Purpose |
| --- | --- | --- |
| `admin` | 52 | moderation, users, CMS, config, ops, backups, privacy DSAR |
| `trust` | 31 | tickets, disputes, enforcement, screening, appeals, MFA |
| `gov` | 29 | governance, policies, approvals, legal holds, audit |
| `finance` | 25 | ledger, payouts, invoices, reconciliation, monthly close |
| `comms` | 21 | threads, notifications, campaigns, channels, suppressions |
| `platform` | 19 | health, smoke, flags, status, incidents, releases |
| `auth` | 13 | login, sessions, MFA, recovery, step-up |
| `mscs` | 8 | certification control/evidence/findings |
| `compliance` | 8 | regulatory reporting, sanctions |
| `public` | 5 | status page, public config |
| `listings` | 5 | public listing reads |
| `geo` | 5 | location/GIS lookups |
| `dev` | 5 | developer portal, API keys, webhooks |
| `paynow` | 4 | initiate, callback, result, return |
| `orders` | 4 | order read/transition |
| `account` | 3 | profile, preferences |
| `v1` | 2 | public listings API |
| `threads` | 2 | messaging |
| `privacy` | 2 | consents, DSAR |
| `watch` | 1 | watchlist toggle |

Consistent envelope: `{ ok, data | error, requestId }` (`src/lib/server/api.ts`), with audit
writes and request logging (`ApiRequestLog`).

---

## 5. Product modules (UI)

`src/components/tengasell/pages/`: `home` · `browse` · `item` · `live` · `sell` · `orders` ·
`messages` · `comms` · `assistant` · `account` · `admin` · `gov` · `help` · `policies` ·
`developers` · `experience` (onboarding/what's-new).

Shell: hash router (`#/…`), client-only mount (`ssr: false`), theme provider (light/dark/system),
i18n (EN/JA), bottom nav on mobile, Tenga AI assistant drawer.

---

## 6. Core flows

1. **Sell** — draft → photos → category → map pin (GIS service) → price/reserve/buy-now → review →
   publish. Featured listing fee US$2 + VAT routed through finance.
2. **Timed auction** — countdown, bid increments, proxy/auto-bid ("we bid only the minimum needed to
   keep you in the lead"), outbid notifications, 60-minute lead-bid retraction window.
3. **Best offer** — submit → accept / decline / counter → counter accepted → converts to order.
4. **Live rooms** — scheduled sessions, lot queue, open/close lot, hammer, sold/unsold, auto-close.
5. **Checkout & payment** — delivery vs pickup, fees, Paynow hand-off (`paynow_sessions`),
   callback/result routes, payment records, 48-hour payment SLA.
6. **Fulfilment** — dispatch with carrier + tracking, delivery confirmation releases funds,
   7-day dispute window, ratings after completion.
7. **Trust** — disputes, abuse reports, enforcement, appeals, sanctions screening, risk scoring.
8. **Governance** — policies + acceptance, approvals, legal holds, regulatory reports, audit log.
9. **Ops** — public status page (`/api/public/status`), incidents, smoke contract, backup/restore
   drills (`ops/backup.ts`, `ops/restore-test.ts`).

---

## 7. Services

| Service | Entry | Role |
| --- | --- | --- |
| `trade-engine` | `index.ts` | auction lifecycle, bid settlement, room timers |
| `finance-service` | `index.ts` | ledger, payouts, reconciliation |
| `comms-service` | `index.ts` | outbound queue (email/WhatsApp/Telegram), suppression |
| `trust-service` | `index.ts` | tickets, screening, enforcement |
| `govern-service` | `index.ts` | policy/approval/legal workflows |
| `gis-service` | `index.ts` | map tiles (on-disk `.tile-cache`) and geo lookups |
| `trailbase-db` | migrations + `gen-sql.ts` | Rust record store + schema generation |

They talk to TrailBase through `trailbase.ts` clients and are orchestrated by
`.zscripts/mini-services-*.sh` behind Caddy (`Caddyfile`).

---

## 8. Configuration

Env vars referenced by the code:

```
DATABASE_URL              # Prisma/SQLite (BFF)
TRAILBASE_URL             # Rust record store, default :3001
NEXTAUTH_SECRET  PLATFORM_JWT_SECRET  TGS_INTERNAL_SECRET  TGS_INTERNAL_TOKEN
PAYNOW_INTEGRATION_ID  PAYNOW_INTEGRATION_KEY  PAYNOW_RESULT_URL  PAYNOW_RETURN_URL
RESEND_API_KEY  EMAIL_FROM
WHATSAPP_TOKEN  WHATSAPP_PHONE_ID  WHATSAPP_APP_SECRET  MESSENGER_PAGE_TOKEN  GRAPH_API_VERSION
TELEGRAM_BOT_TOKEN
TRUST_URL  COMMS_URL  FINANCE_URL  GOVERN_URL  GIS_BASE_URL  GOOGLE_MAPS?
MSCS_WORKSHEET_PATH  BASE_STYLE_URL  OSM_UPSTREAM  APP_URL
ADMIN_USERNAME  ADMIN_PASSWORD
```

Paynow runs in **mock mode** when its credentials are absent (`src/lib/server/paynow.ts`).

---

## 9. Verification & CI

- `ops/smoke.ts` — golden-endpoint contract (same checks the admin console runs).
- `ops/dast.ts`, `ops/sast.ts`, `ops/reports/` — security evidence with dispositions.
- `ops/gap8-*.ts` — feature-gap verification scripts.
- `screenshots/` — UAT evidence from 390 px to 1920 px.
- GitHub Actions `CI` — install → Prisma → build → boot → probe (`/` 200, `/api/public/status` 200,
  `/api/v1/listings` 401). Verified passing.
- GitHub Actions `Deploy app demo to Pages` — builds the static demo, publishes `gh-pages`.

### Known baseline debt

| Check | Baseline |
| --- | --- |
| ESLint | 18 errors / 1080 warnings (`react-hooks/set-state-in-effect`) |
| `tsc --noEmit` | ~312 diagnostics (suppressed at build via `ignoreBuildErrors`) |

---

## 10. Deployment reality

| Target | What it can run |
| --- | --- |
| GitHub Pages (`/tengasell-auction/`) | **Real UI, demo mode** — full click-through, localStorage, no backend |
| Node host (Vercel/Render/Fly) + TrailBase | **Full product** — real records, payments, services |
| Local stack | `npm run dev` + `mini-services/*` + TrailBase binary |

Pages cannot host the API (static only) or the Rust store; it serves the same React interface with
the offline adapter, which is why the demo is feature-rich but not multi-user.

---

## 11. Gaps between demo and production

1. **No real TrailBase running** — Pages demo uses seeded data; changes are per-browser.
2. **Payments are mock** — no live Paynow credentials or webhook signature verification.
3. **Microservices are absent on Pages** — trade engine timers, comms delivery and finance ledger
   are not running; the demo simulates their effects client-side.
4. **Auth is local** — demo sign-in uses seeded accounts; production needs next-auth + MFA + RBAC
   enforced server-side.
5. **Static debt** — lint/type baseline above; CSP still permits `unsafe-eval` in dev.
6. **TrailBase binary not in git** — 28 MB Linux artifact lives in the archive under
   `backups/vendor/`; fetch it or download the matching TrailBase release for deployment.

---

## 12. Where things live

```
src/app/api/**            252 route handlers (BFF)
src/components/tengasell/ product UI
src/lib/tengasell/api/    remote.ts (TrailBase) · local.ts (demo) · index.ts (switch)
src/data/seed.ts          deterministic marketplace seed (shared with SQL generation)
prisma/schema.prisma      84-model platform schema
mini-services/trailbase-db/traildepot/  Rust store config + 6 migrations
mini-services/*/          domain services
ops/                      smoke, DAST, SAST, backup/restore, gap verification
docs/preview/             written overview (published at /project/)
scripts/build-static-demo.mjs  static demo builder
```
