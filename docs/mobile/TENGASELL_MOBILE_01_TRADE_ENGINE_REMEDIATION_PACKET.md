# TENGASELL-MOBILE-01 — Trade Engine Remediation Packet (`CERT-02` & `CERT-03`)

**Authority scope:** Read-only certification finding against `mini-services/trade-engine/index.ts` and `mini-services/trailbase-db/traildepot/config.textproto`.
**Strict boundary:** `mini-services/trade-engine/index.ts` was **NOT modified** in mobile PRs (#6, #7, #9). This bounded backend packet specifies required server-side remediations to close `CERT-02` and `CERT-03` completely.

---

## 1. Critical / P0 & P1 Security Findings (`CERT-03` — Auth, Forgery & Revocation)

Verified empirically on a disposable local TrailBase `v0.35.1` + unmodified `mini-services/trade-engine/index.ts` stack in `/tmp/cert-stack` (`2026-11-11`).

### 1.1 [CRITICAL / P0] `data.auth_token ?? token` Fallback + Unverified JWT Decode (`index.ts:166-170`)

TrailBase `GET /api/auth/v1/status` returns **`HTTP 200`** with `{"auth_token": null, "refresh_token": null, "csrf_token": null}` whenever a bearer token is missing, bogus, expired, or forged.

In `mini-services/trade-engine/index.ts`:
- Line `166`: checks only `if (!res.ok) return null;` (`200` passes).
- Line `168`: evaluates `const activeToken: string = data.auth_token ?? token;`, falling back to the untrusted caller token whenever TrailBase returned `auth_token: null`.
- Lines `169-170`: calls `decodeJwt(activeToken)` (base64 payload decode only; no signature or `exp` check) and trusts `payload.username` to resolve `profiles`.

**Empirical PoC (disposable stack, `2026-11-11`):**
- Sent an unsigned, forged, expired JWT (`username: "takudzwa"`, `exp: 1580000001`, suffix `.INVALID_SIG`) to TrailBase `/api/auth/v1/status` → `HTTP 200 {"auth_token": null, "refresh_token": null, "csrf_token": null}`.
- Connected Socket.IO client to `:3002` with that forged token and emitted `bid:place` (`auctionId: 9001`, `maxAmount: 220`).
- **Observed result:** `{ ok: true, amount: 207, winning: true, auction: { bid_count: 10 } }` — the trade engine impersonated `@takudzwa` and committed a live bid without valid credentials.

### 1.2 [P1] Unbounded Un-expiring `identityCache` (`index.ts:147, 161, 181`)

- `identityCache` (`Map<string, Identity>`) never expires entries, never checks JWT `exp`, and has no size bound or revocation hook.
- Once a token enters `identityCache`, subsequent new Socket.IO connections skip `/api/auth/v1/status` completely (`authStatusCalls` remained `1` across new socket connects in disposable tests).

### 1.3 [P1] Open-Socket `me` Pinning in `requireAuth()` (`index.ts:956-973`)

- `me` is resolved once per socket lifecycle (`if (!me) me = await identityPromise;`) and reused for every subsequent `bid:place` event on that open socket regardless of logout, account change, or token expiry.

### 1.4 [P1] TrailBase Stateless `auth_token` Window After Logout (`config.textproto`)

- Calling `GET /api/auth/v1/logout` or `POST /api/auth/v1/logout` (`{ refresh_token }`) immediately revokes `refresh_token` (`POST /api/auth/v1/refresh` → **`HTTP 401`**), proving canonical session revocation works on refresh tokens.
- However, TrailBase's EdDSA JWT `auth_token` (`auth_token_ttl_sec: 86400`, 24h) continues returning `HTTP 200` with a non-null `auth_token` at `/api/auth/v1/status` until `exp` (+ ~60s leeway), allowing logged-out `auth_token` credentials to remain accepted unless server-side revocation / session tracking is checked.

### 1.5 Bonus Observation: Expired Admin Token `403` Bypass in `tb()`

- On a short-TTL (`auth_token_ttl_sec: 2`) disposable TrailBase run after `64s` elapsed, TrailBase returned **`HTTP 403`** (rather than `401`) on expired admin `PATCH`/`POST /api/records/v1/bids` & `/auctions`, bypassing `401`-only refresh retry paths in `tb()`.

### Required Trade-Engine Auth Remediation

1. **Immediate P0 fix in `resolveIdentity()`:** Fail closed whenever `!res.ok`, `data?.auth_token == null`, or `!decodeJwt(data.auth_token)?.sub`:
   - **Never** write `data.auth_token ?? token`. Only decode `data.auth_token` returned authoritatively by TrailBase (and verify `exp` with bounded TTL!).
2. **Enforce `exp` + short cache TTL / bounded LRU:** Never cache past `Math.min(jwtExpMs - Date.now(), 30_000)` and check expiry on every read; cap cache size.
3. **Eliminate indefinite `me` pinning:** On every `bid:place` (or short validity interval + `requireAuth()` re-check), re-verify token/session state and `exp`; disconnect or return structured `{ ok: false, stage: "pre_commit", committed: false, code: "AUTH_REVOKED" }` when invalid/revoked.
4. **Immediate logout revocation across open & new sockets:** Track active session / `refresh_token` validity or user revocation epoch / short-lived JWTs (`auth_token_ttl_sec: 300`) + revocation hook called on logout so revoked users lose `bid:place` authority immediately, not 24 hours later.

---

## 2. Commercial Safety Findings (`CERT-02` — Post-Commit `bid:place` Ambiguity)

Verified empirically against unmodified `mini-services/trade-engine/index.ts` on disposable auctions `9001`, `9002`, and `9004` (`2026-11-11`).

### 2.1 Post-Commit Exceptions Emit Misleading Retry Error (`index.ts:975-1007`)

After `placeBid()` (`line 980`) already commits `bids` (`POST /api/records/v1/bids`) and updates `auctions` (`PATCH /api/records/v1/auctions/:id`), lines `982–998` perform non-transactional post-commit work (`getRecord`, `antiSnipe` update at `line 993`, `audit` log at `line 997`).

Any exception inside those post-commit steps falls into `catch (err)` (`lines 1003–1005`) and returns:

```json
{ "ok": false, "error": "The trade engine hit an unexpected error. Please retry." }
```

**Observed live failures on unmodified engine:**
- **Audit failure (`case5a`, auction `9001`):** `POST /api/records/v1/bids -> 200` (`id: 442`, `@takudzwa`, `amount: 122`, `max_amount: 150`) and `PATCH /api/records/v1/auctions/9001 -> 200` (`bid_count: 4`, `current_price: 122`) succeeded, then `POST /api/records/v1/audit_events` failed (`ECONNRESET`) → engine sent buyer `{ ok: false, error: "The trade engine hit an unexpected error. Please retry." }`.
- **Anti-snipe update failure (`case5b`, auction `9002`, `< 2 min` remaining):** `POST /api/records/v1/bids -> 200` (`id: 443`, `@takudzwa`, `amount: 50`, `max_amount: 70`) and `PATCH /api/records/v1/auctions/9002 -> 200` (`bid_count: 1`) succeeded, then `antiSnipe`'s `PATCH /api/records/v1/auctions/9002` failed (`ECONNRESET`) → engine sent buyer `{ ok: false, error: "The trade engine hit an unexpected error. Please retry." }`.
- **Note on `case3` (`getRecord` at line `982`):** `tb()` wraps `fetch` HTTP/JSON failures safely and `getRecord` returned `null` without throwing when `GET /auctions/:id` reset/malformed; `createRecord` (`audit`) and `updateRecord` (`antiSnipe`) throw uncaught errors (`line 993`, `line 997`) when transport fails!

### Required Trade-Engine `bid:place` Contract Remediation

1. **Structured rejection authority:** Every pre-mutation refusal (`not authenticated`, `auction closed`, `below min bid`, `seller self-bid`) must emit explicit structured fields `{ ok: false, stage: "pre_commit", committed: false, code, error }`.
2. **Isolate post-commit side effects:** Once `placeBid()` writes to TrailBase, `audit()`, `antiSnipe()`, and final `getRecord()` must **never** collapse into `ok: false` / `"Please retry."`. Return `{ ok: true, committed: true, ... }` with non-fatal post-commit warning telemetry / retry queue.
3. **Check TrailBase write responses & add idempotency:** Propagate/handle non-2xx REST write failures (`403`/`500`) inside `placeBid()` cleanly, and accept an optional `clientRequestId` / idempotency key on `bid:place` to guarantee replay safety on reconnect.
4. **PR #9 client mitigation applied concurrently:** Mobile PR #9 now refuses to treat any uncoded `ok: false` ack as a definite non-commit, never uses substring matching, never shows `"Please retry"`, and reconciles against canonical TrailBase `auctions` + `bids` records before unlocking the Bid CTA or displaying status.
