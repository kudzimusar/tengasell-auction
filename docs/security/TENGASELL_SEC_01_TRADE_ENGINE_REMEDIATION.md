# TengaSell Trade-Engine & BFF Security Remediation (`TENGASELL-SEC-01`)

**Scope:** Emergency authentication bypass remediation (`P0-A`), commercial bidding transaction integrity (`P1`), sibling Next.js auth boundary hardening, and exposure assessment across `kudzimusar/tengasell-auction`.  
**Base Authority:** `main @ 98a607c326ca4bcf24062c045d4eaa35762a3aa5`  
**Security Branch:** `fix/tengasell-trade-sec01-auth-bid-integrity`

---

## 1. SEC-01 — Exposure & Deployment Assessment

- **Runtime Topology (`fly.toml`, `Dockerfile`, `deploy/entrypoint.sh`, `scripts/gateway.mjs`):**
  - `fly.toml` runs app `tengasell-zw` (`primary_region = "jnb"`) mounting persistent volume `tengasell_data` at `/data` (`TGS_DATA_DIR`).
  - `deploy/entrypoint.sh` starts TrailBase (`trail --depot "$DATA_DIR/traildepot" run`) on `127.0.0.1:3001`, Trade Engine on `:3002`, internal Go/Python services, Next.js standalone on `:3000`, and Caddy in front on `:8080`.
  - `scripts/gateway.mjs` & `Caddyfile` route `/socket.io/*` directly to the Node/Bun Trade Engine (`127.0.0.1:3002`), meaning all public Socket.IO traffic hits `mini-services/trade-engine/index.ts`.
  - **Production Live Status:** Live container filesystem and `/data` SQLite DBs on `tengasell-zw.fly.dev` could **not** be inspected or verified from this offline/unauthenticated environment (no `flyctl` credentials; outbound TLS restricted). Any production deployment running `main @ 98a607c3` prior to this patch must be treated as **potentially exposed** until this fix is deployed and production `audit_events`, `bids`, and HTTP/Socket logs are audited.
- **Read-Only Local Seed Inspection (`deploy/seed/trailbase-main.db`):**
  - Contains `34` historical `audit_events` rows (latest `created_at`: `2026-10-20T12:06:44Z`) across `17` `_user` records (`2` admins). Zero evidence of modern exploit traffic in the static repository seed.
- **Sibling Next.js Auth Vulnerability Discovered:**
  - `src/lib/server/paynow-order.ts` (`resolveUserFromToken`, shared by `platform.ts`, `comms.ts`, `finance.ts`, `trust.ts`, `gov.ts`, and `/api/paynow/initiate`), plus `src/app/api/auth/status/route.ts` and `src/app/api/auth/security/state/route.ts`, exhibited the identical fallback defect: accepting TrailBase `/api/auth/v1/status` HTTP `200 OK` with `auth_token: null` and falling back (`data.auth_token || token` / `?? gate.token`) to decoding unverified JWT claims.

---

## 2. P0-A — Authentication Bypass & Session Revocation Remediation (`SEC-02`)

### Root Causes Addressed
1. `TrailBase` `/api/auth/v1/status` returns **HTTP `200 OK`** with `{"auth_token": null}` for unsigned, malformed, or forged Bearer tokens. Prior `resolveIdentity()` fell back to `data.auth_token || token` and base64-decoded payload claims without signature verification.
2. Socket connections pinned `me` at `connection` time; logged-out, expired, deleted, or demoted users retained full RPC authority for up to 24 hours (`auth_token_ttl_sec: 86400`) on an open WebSocket.
3. `identityCache` was an unbounded `Map` lacking eviction, `forceFresh`, or canonical DB validation.
4. `POST /api/auth/v1/logout` without a JSON body returns `HTTP 415` on TrailBase v0.35.1 (`GET /api/auth/v1/logout` deletes all active user sessions from `session.db._session`).
5. `/admin/status` and `/admin/ensure-dev` in `mini-services/trade-engine/index.ts` had no authentication middleware.
6. `tb()` and `src/lib/server/trailbase-admin.ts` only retried `401` (not `403`) on TrailBase admin calls.

### Implemented Controls
- **`mini-services/trade-engine/auth.ts`:**
  - `parseStrictJwt`: requires 3 dot-separated segments, non-empty signature, valid `alg !== "none"`, valid string `sub`/`username`, and finite numeric `exp`.
  - `validateClaimTimestamps`: enforces **zero-leeway** `exp` (`claims.exp * 1000 <= nowMs` -> `AUTH_EXPIRED`) and rejects far-future `nbf`/`iat` clock anomalies.
  - `IdentityResolver`: strictly **fails closed** unless `/api/auth/v1/status` returns HTTP `2xx` with a valid non-null `auth_token` matching presented `sub` and `username`; maintains bounded LRU cache (`maxCacheEntries: 512`, `TRADE_AUTH_CACHE_TTL_MS` default `5000`, `forceFresh` bypass on mutating RPCs & admin HTTP routes) and bounded revocation registry (`revokeToken`, `revokeSubject`).
  - `openCanonicalTrailBaseStore`: opens TrailBase's co-located `main.db` (`_user`) and `session.db` (`_session`) read-only to detect logout, pre-relogin stale tokens (`created <= floor(iat)`), username changes, account deletion, and immediate admin demotion. Observed `AUTH_REVOKED` tokens are immediately tombstoned in memory.
- **`mini-services/trade-engine/index.ts`:**
  - `requireSocketAuth(ack, msg)` re-validates identity (`forceFresh: true`) on **`bid:place` and all 20 other authenticated Socket.IO RPC handlers**; rejects with `preCommitError(code, msg)` and actively disconnects revoked/expired sockets after emitting `auth:revoked`.
  - `authorizeAdminHttp` protects `GET /admin/status`, `POST /admin/ensure-dev`, and `POST /internal/auth/revoke` via verified admin Bearer token or constant-time `x-tgs-internal` shared secret (`401`/`403`).
  - `POST /internal/auth/revoke` tombstones tokens/subjects and immediately disconnects matching live sockets.
  - `tb()` proactively refreshes near-expiry admin tokens (`singleflight`) and retries once on **`401 || 403`**.
- **Sibling Next.js Hardening (`src/...`):**
  - `src/lib/server/paynow-order.ts`, `src/app/api/auth/status/route.ts`, `src/app/api/auth/security/state/route.ts`: removed unverified token fallback paths; strict JWT structure/claim/subject matching before accepting `/api/auth/v1/status`.
  - `src/lib/server/trailbase-admin.ts`: retries on `401 || 403` with proactive `exp` check.
  - `src/lib/tengasell/api/remote.ts`, `src/lib/server/platform.ts`, `src/app/api/auth/login/route.ts`: switched TrailBase sign-out calls from bodyless `POST` (`415`) to `GET /api/auth/v1/logout` and best-effort trade-engine socket revocation notification.

---

## 3. P1 — Commercial Bidding & Post-Commit Integrity (`SEC-03` / `SEC-04`)

### Implemented Controls (`mini-services/trade-engine/bidding.ts`)
1. **Per-Auction Serialization (`AuctionLockMap`):** Eliminates concurrent `bid:place` read-modify-write interleaving per `auctionId`.
2. **Strict Pre-Commit / Commit / Post-Commit Boundary:**
   - **Pre-Commit:** Validation, auction lookup (`getAuction`), ledger read (`listBids`), and explicit TrailBase `4xx` commit rejections return `{ ok: false, committed: false, stage: "pre_commit", rejected: true, code, error }`.
   - **Commit Ordering:** Inserts new active bid row (`createBid`) **before** superseding the prior active bid (`patchBid`) so a clean pre-commit rejection never orphans an auction without an active lead bid.
   - **Ambiguous Commit (`commit_uncertain`):** Transport hangs/resets or `502`/`504`/malformed responses during `createBid` return `{ ok: false, uncertain: true, stage: "commit_uncertain", reason: "unverified", code: "COMMIT_UNCERTAIN", error }` — never claiming `committed: false` or `rejected: true`.
   - **Bounded Idempotency (`clientRequestId`):** Replays of committed requests return `idempotentReplay: true` without duplicate bids; conflicting `maxAmount` returns `IDEMPOTENCY_CONFLICT`; retries of `commit_uncertain` requests reconcile against the persisted `bids` ledger before inserting again.
   - **Non-Throwing Post-Commit:** Supersede retries, `auctions` summary sync retries, `antiSnipeOutcome`, `extendLiveRoom`, notifications, TUCS comms fan-out, and `audit()` NEVER convert a durable committed bid into `{ ok: false }`; any partial post-commit degradation appends structured `warnings[]` while returning `{ ok: true, committed: true, stage: "committed", ... }`.
3. **Dual Client Contract Preservation:**
   - Preserves Web BFF & UI contract (`src/lib/tengasell/socket.ts`, `bid-sheet.tsx`, `/api/listings/[id]/bid`).
   - Satisfies Mobile PR #9 `parseBidAck` (`mobile/src/lib/bid-ack.ts`) pre-commit vs commit-uncertain vs committed classification.

---

## 4. Verification Summary

- **Trade Engine Unit + Real Stack Integration (`cd mini-services/trade-engine && bun test`):** `27 pass, 0 fail` across `trade-engine.unit.test.ts` (18 cases) and `trade-engine.integration.test.ts` (9 E2E scenarios running against real `trail v0.35.1`, real SQLite `main.db`/`session.db`, fault-injecting proxy, live `bun index.ts`, and `socket.io-client`).
- **BFF Auth Unit Test (`tests/bff-auth-security.test.ts`):** Verifies fail-closed `resolveUserFromToken` against mock `/api/auth/v1/status`.
- **Lint & Production Build:** ESLint on all modified `src/` files (`0` errors) and Next.js production build (`npm run build`) verified cleanly.
