# TengaSell Trade-Engine & BFF Security Remediation (`TENGASELL-SEC-01`)

**Scope:** Emergency authentication bypass remediation (`P0-A`), commercial bidding transaction integrity (`P1`), Next.js BFF + gateway auth boundary hardening, and server secret/path cleanup across `kudzimusar/tengasell-auction`.  
**Base Authority:** `main @ 98a607c326ca4bcf24062c045d4eaa35762a3aa5`  
**Security Branch:** `fix/tengasell-trade-sec01-auth-bid-integrity`

---

## 1. SEC-01 — Exposure & Deployment Assessment

- **Runtime Topology (`fly.toml`, `Dockerfile`, `deploy/entrypoint.sh`, `scripts/gateway.mjs`):**
  - `fly.toml` runs app `tengasell-zw` (`primary_region = "jnb"`) mounting persistent volume `tengasell_data` at `/data` (`TGS_DATA_DIR`).
  - `deploy/entrypoint.sh` generates CSPRNG ephemeral secrets at startup when `TGS_INTERNAL_SECRET`, `TGS_INTERNAL_TOKEN`, `PLATFORM_JWT_SECRET`, or `NEXTAUTH_SECRET` are unset, exports `TGS_PROJECT_ROOT=/app`, `TRAILBASE_DATA_DIR=/data/traildepot/data`, and `TRAILBASE_REQUIRE_SESSION_DB=1`, starts TrailBase (`trail --depot "$DATA_DIR/traildepot" run`) on `127.0.0.1:3001`, Trade Engine on `:3002`, internal Go/Python/Bun mini-services, Next.js standalone on `:3000`, and Caddy/Gateway in front.
  - `scripts/gateway.mjs` (the primary Fly/Docker gateway) restricts `?XTransformPort` to public ports `{3001, 3002, 3004}`, blocks normalized `/internal/*` and transform `/admin/*` on both HTTP and WebSocket upgrades, and awaits both `GET` and `POST /api/auth/v1/logout` revocation before responding to clients. `Caddyfile` mirrors the `{3001, 3002, 3004}` port allowlist and `/internal/*` + transform `/admin/*` blocks (note Caddyfile does not perform active logout revocation callouts).
  - **Production Live Status:** Live container filesystem and `/data` SQLite DBs on `tengasell-zw.fly.dev` could **not** be inspected or verified from this offline/unauthenticated environment (no `flyctl` credentials; production DBs untouched). Any production deployment running `main @ 98a607c3` prior to this patch must be treated as **potentially exposed** until this fix is deployed and production `audit_events`, `bids`, and HTTP/Socket logs are audited.
- **Read-Only Local Seed Inspection (`deploy/seed/trailbase-main.db`):**
  - Contains `34` historical `audit_events` rows (latest `created_at`: `2026-10-20T12:06:44Z`) across `17` `_user` records (`2` admins). Zero evidence of exploit traffic in the static repository seed.
- **Sibling Next.js Auth Vulnerability Closed:**
  - `src/lib/server/paynow-order.ts` (`resolveVerifiedSession` / `resolveUserFromToken`), `src/lib/server/platform.ts`, `src/app/api/auth/status/route.ts`, and `src/app/api/auth/security/state/route.ts` previously accepted unverified tokens when `/api/auth/v1/status` returned HTTP `200` with `auth_token: null` or re-decoded caller tokens. All routes now rely on fail-closed server verification.

---

## 2. P0-A — Authentication Bypass, Revocation & Secret Hardening (`SEC-02`)

### Root Causes Addressed
1. TrailBase `/api/auth/v1/status` returns **HTTP `200 OK`** with `{"auth_token": null}` for forged/invalid Bearer tokens. Both trade-engine and Next.js BFF fell back to caller tokens or unverified JWT decoding.
2. In-memory-only revocation maps lost revocations across restarts, lacked canonical `session.db` fail-closed enforcement, allowed subject-cutoff races within `<1s` logout+relogin, and left `revokedBeforeBySubject` unbounded.
3. Missing profile lookups previously degraded to `id: ""` instead of failing closed (`PROFILE_MISSING`).
4. `scripts/gateway.mjs` previously proxied arbitrary `XTransformPort` targets and did not block encoded/dot-segment `/internal/*` or transform `/admin/*` paths on HTTP or WebSocket upgrades.
5. Hardcoded server secret/password/path fallbacks (`Tengasell#2025`, `tgs-internal-v1`, `tengasell-internal-v1`, `tengasell-dev-secret-change-in-production`, `/home/z/my-project/...`) existed across `trade-engine`, `trust-service`, `finance-service`, `govern-service`, `comms-service`, `src/lib/auth.ts`, `src/lib/server/trailbase-admin.ts`, `src/lib/server/platform.ts`, and `fly.toml`.

### Implemented Controls
- **`mini-services/trade-engine/auth.ts` & `index.ts`:**
  - `parseStrictJwt` & `validateClaimTimestamps`: enforce strict 3-part base64url JWT structure, non-`none` `alg`, zero-leeway `exp`, valid `nbf`/`iat`, and finite `claims.iat` check in `openCanonicalTrailBaseStore`.
  - Fail-closed canonical DB verification (`openCanonicalTrailBaseStore` with required `session.db` and `main.db._user`), `PROFILE_MISSING` rejection when `profiles` row is absent, and constant-time `timingSafeEqualStr` internal secret checks (zero hardcoded fallbacks; fails closed on unconfigured secret).
  - Durable SQLite revocation store (`openRevocationStore` -> `tgs_revocations.db` with `revoked_tokens` + `revoked_subjects`) paired with bounded LRU maps (`maxCacheEntries`, `maxRevokedEntries`), distinguishing token-digest logout revocation (preserving immediate `<1s` re-login) from subject-cutoff revocation (password change/reset, role change, non-pending suspension).
  - `requireSocketAuth` validates every mutating Socket.IO RPC (`forceFresh: true`), emits `auth:revoked`, and disconnects revoked/expired sockets.
- **Gateway, BFF & Client (`scripts/gateway.mjs`, `src/app/api/**`, `src/lib/server/**`, `src/lib/tengasell/**`):**
  - `scripts/gateway.mjs`: allowlists `?XTransformPort` to `{3001, 3002, 3004}`, rejects path-normalized `/internal/*` and transform `/admin/*` on HTTP and WebSocket upgrades with `403`, and awaits durable revocation + `/internal/auth/revoke` on both `GET` and `POST /api/auth/v1/logout` before completing the logout response.
  - Added `POST`/`GET /api/auth/logout` (token-digest revocation + TrailBase logout); updated `/api/auth/login` (suspended user session invalidation), `/api/auth/password/change`, `/api/auth/status`, `/api/auth/security/state`, `/api/platform/admin/users/[username]/role`, and `/api/platform/admin/users/[username]/enforcement` to enforce canonical revocation without duplicate unverified JWT decoding.
  - Hardened `src/lib/server/trailbase-admin.ts` (`singleflight` admin login, `invalidateIfCurrent` race guard, `AbortSignal.timeout(8000)`, zero default password).
  - Shared `src/lib/server/sqlite.ts` (`node:sqlite` in Next.js/Node, `bun:sqlite` under Bun).
  - Updated Web client `socket.ts`, `auth.tsx`, `remote.ts`, `bid-sheet.tsx`, and `live-room.tsx` for `auth:revoked` auto-sign-out, `POST /api/auth/logout`, fail-closed `ensureProfile`, and structured `rpcOutcome` handling with `clientRequestId`.
  - Cleaned all hardcoded fallback passwords, secrets, and `/home/z/my-project` paths across `fly.toml`, `deploy/entrypoint.sh`, `src/lib/auth.ts`, and `mini-services/{trust,finance,govern,comms}-service/*`, enforcing constant-time `x-tgs-internal` validation in `trust-service` and `finance-service`.

---

## 3. P1 — Commercial Bidding & Mutating RPC Integrity (`SEC-03` / `SEC-04`)

### Implemented Controls (`mini-services/trade-engine/bidding.ts` & `index.ts`)
1. **Per-Auction Serialization (`AuctionLockMap`) & Active Leader Guard (`ALREADY_LEADING`):** Serializes concurrent `bid:place` calls per `auctionId` and blocks active winning bidders from self-outbidding (`ALREADY_LEADING`).
2. **Strict Pre-Commit / Commit / Post-Commit Boundary:**
   - Pre-commit checks & TrailBase `4xx` rejections return `{ ok: false, committed: false, stage: "pre_commit", rejected: true, code, error }`.
   - New bid insert precedes superseding prior active bid; transport timeouts/resets/`502`/`504` return `{ ok: false, uncertain: true, stage: "commit_uncertain", reason: "unverified", code: "COMMIT_UNCERTAIN" }`.
   - Shared `finalizeCommittedBid` helper ensures both fresh commits (`executeSingleBid`) and uncertain retry reconciliations (`tryReconcileUncertain`, including proxy-outbid outcomes) apply idempotent state updates without double-counting `bid_count`, clobbering newer bids, or falsely reporting `winning: true` to an outbid caller.
   - Explicit return-value checks and best-effort rollback/error propagation across `sellAuctionTo`, `endUnsold`, `advanceRoom`, `sweepAuctions`, `sweepOfferExpiry`, `sweepSavedSearches`, and all mutating Socket.IO RPCs.
3. **Unapplied Schema Packet (`SEC-02`):** Durable DB-level `bids.client_request_id` migration & unique index prepared separately in `docs/security/TENGASELL_SEC_02_IDEMPOTENCY_MIGRATION_PACKET.md` without altering live production schemas.

---

## 4. Verification Summary & Blocking CI Gate (`SEC-04`)

- **Blocking Workflow (`.github/workflows/tengasell-backend-security.yml`):** Pins Node 22, Bun 1.3.14, and TrailBase v0.35.1 to execute static secret/fallback scans, backend typecheck (`tsconfig.backend.json`), targeted ESLint, Trade Engine unit + real TrailBase/Proxy/Socket.IO integration tests, BFF SQLite auth tests, Gateway HTTP/WS security tests, and Next.js production build smoke.
- **Test Suites:**
  - `mini-services/trade-engine/trade-engine.unit.test.ts` (23 unit cases covering strict JWT/timestamp validation, `PROFILE_MISSING`, `<1s` logout vs subject cutoff, durable SQLite revocation persistence, fail-closed `session.db`, bounded revocation map, `ALREADY_LEADING`, concurrency locks, and proxy-outbid uncertain reconciliation).
  - `mini-services/trade-engine/trade-engine.integration.test.ts` (11 E2E scenarios against real `trail v0.35.1`, real SQLite `main.db`/`session.db`/`tgs_revocations.db`, fault-injecting proxy, live `bun index.ts`, and `socket.io-client`).
  - `tests/bff-auth-security.test.ts` (`resolveUserFromToken` / `resolveVerifiedSession` fail-closed + missing-`iat` + real SQLite `_user`/`_session`/`tgs_revocations.db`).
  - `tests/gateway-security.test.mjs` (HTTP + raw TCP WebSocket upgrade blocking on disallowed `XTransformPort`, `/internal/*`, and transform `/admin/*`).
