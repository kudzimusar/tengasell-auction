# Tengasell — External Security Audit Pack

**Prepared by:** GAP8-G6 (security/QA agent, Z.ai Code) · **Date:** 2026-10-20/21
**Purpose:** everything an **independent external security auditor** needs to review the
Tengasell platform: scope, methodology, control mapping, credentials runbook, topology,
and the two in-repo security harnesses (SAST + DAST) with their committed reports.

> **Honesty note (MSCS F-AUTH/F-RSK doctrine):** this pack does NOT claim an external
> pen-test happened. The in-repo SAST/DAST harnesses below are **internal** compensating
> controls. The residual risk exception **RSK-EX-005** stays OPEN for the **independent
> external penetration-test vendor engagement** (see prisma/assessment.ts, db/custom.db
> `RiskException`, agent-ctx/mscs-worksheet-12.json).

---

## 1. Scope — what the external auditor reviews

| In scope | Description |
|---|---|
| Web BFF (Next.js 16 App Router) | `src/app/api/**` (252 API routes: auth, admin, marketplace, comms, finance, trust, gov, mscs, developer v1, paynow, geo), server libs `src/lib/server/**` |
| TrailBase (Rust) records backend | Collections + ACL rules in `mini-services/trailbase-db/traildepot/config.textproto`, SQL migrations `traildepot/migrations/**` |
| trade-engine (socket.io/Bun) | RPC validation, proxy-bid rules, admin-token writes: `mini-services/trade-engine/index.ts` |
| trust-service | Support/trust plane, MFA (TOTP, sha256-hashed recovery codes since GAP8-S1): `mini-services/trust-service/**` |
| comms / finance / gis / govern services | `mini-services/{comms,finance,gis,govern}-service/**` |
| First-party data + seeds | `prisma/**` (rebuild-era Prisma schema/seed), `mini-services/trailbase-db/traildepot/migrations/**` (TrailBase seeds) |
| Dependency supply chain | `package.json` + `bun.lock` (969 resolved packages), `ops/sbom.json` |
| Ops tooling | `ops/**` (smoke, SAST, DAST, SBOM, backup/restore scripts) |

**Out of scope:** the platform hosting layer (container/PolarFS infra), the public
internet edge beyond the Caddy :81 gateway config in-repo, and third-party SaaS
(Telegram/WhatsApp/Paynow provider accounts — mock adapters in sandbox, launch gates).

## 2. Methodology

1. **Read the standards anchors:** MSCS 1.0 (609-control checklist, `agent-ctx/mscs-1.0.txt`),
   UDPCS 1.0 (`agent-ctx/udpcs-1.0.txt`). Security domain: SEC-001..025.
2. **Run the two harnesses** (below) and read their committed reports:
   - Static: `bun ops/sast.ts` → `ops/reports/sast-report.{json,md}`
   - Dynamic: `bun ops/dast.ts` → `ops/reports/dast-report.{json,md}` (live stack must be up)
3. **Sample-verify probes independently** — every DAST probe lists target, expectation and
   captured evidence (status codes/headers/bodies); re-run any of them with curl/your own
   tooling using the credentials runbook below.
4. **Review the standing evidence:** `ops/smoke.ts` (synthetic monitoring),
   `ops/sbom.json` (SBOM), `ops/runbooks.md`, `worklog.md` (full build/verify history),
   `screenshots/` (browser UAT runs).
5. **Triage the open findings:** the DAST report's FAIL dispositions (security-headers gap,
   login rate-limit gap) and the SAST dependency-advisory register are the live input to the
   vulnerability-management register (SEC-012).
6. **Perform your own tests** — sandbox is yours: every service is loopback-reachable, demo
   accounts are documented below, and the scratch-row convention (`gap8-<task>-*` rows) is
   the accepted way to leave zero residue.

## 3. Control mapping — evidence per SEC control (RSK-EX-005 family)

| MSCS control | Name | Evidence artifact(s) | Status |
|---|---|---|---|
| **SEC-008** | Key rotation | `ops/runbooks.md` (credential-rotation runbook), env-driven config (`process.env.* ?? dev-fallback` pattern verified by sast-report `transport-security` rows), `mini-services/trust-service/config.ts` env overrides | Runbook exists; rotation exercise pending — rides RSK-EX-005 residual |
| **SEC-009** | Dependency scanning | `ops/sast.ts` §dependency-audit + `ops/reports/sast-report.md` §Dependency audit: 969 resolved packages queried live against OSV.dev; 90 packages with advisories, severities + direct-dep triage list recorded | In-repo scanner operating (this pack); cadence = per-change + pre-launch |
| **SEC-010** | SAST | `ops/sast.ts` (secret scan, dangerous patterns, SQL/XSS sinks, child_process, client-env leak) + `ops/reports/sast-report.{json,md}` + focused eslint `no-eval`/`no-new-func` pass (0 errors / 464 files) | In-repo SAST harness implemented + evidenced; vendor SAST pending (residual RSK-EX-005) |
| **SEC-011** | DAST | `ops/dast.ts` + `ops/reports/dast-report.{json,md}`: 35 live probes (authz matrix 8 admin routes × 3 personas, input validation, TrailBase ACL/IDOR, socket.io auth, trust-service gates, headers, rate-limit, error spectrum) | In-repo DAST suite implemented + evidenced; external pen-test pending (residual RSK-EX-005) |
| **SEC-012** | Vulnerability management | `ops/reports/sast-report.json` `dependencyAudit.vulnerablePackages` (advisory register w/ severity), DAST FAIL dispositions, RiskException register (db/custom.db + prisma/assessment.ts) | Register begun this task; formal review cadence pending |
| **SEC-019** | Detection | `ops/smoke.ts` (9-point synthetic monitor), admin ops console health/alerting, `GET :3000/api/public/status` | Operating (pre-existing); DAST probes confirm gates detect/reject |
| **SEC-021** | Penetration testing | **This pack** = auditor onboarding + harness reports; RSK-EX-005 residual: independent vendor engagement | OPEN — launch condition |
| **SEC-025** | Security training | Training register in govern-service (`security_reviews`/training tables seeded) | Register exists; curriculum delivery pending — rides RSK-EX-005 residual |

## 4. Credentials runbook (sandbox demo fixtures — NOT production secrets)

All demo accounts share the password **`Tengasell#2025`**. These are documented sandbox
fixtures (seeded in `mini-services/trailbase-db/traildepot/migrations/main/U1000000001__users.sql`
and `prisma/seed.ts`, displayed on the sign-in page). Two auth planes exist:

**TrailBase / original BFF (username-based):**
| Account | Role | Where |
|---|---|---|
| `admin` | platform admin | everything (all consoles) |
| `rufaro`, `simba`, `chipo` | sellers | marketplace, offers, escrow payouts |
| `nyasha`, `tariro` | buyers | bids, watchlist, orders |
| `takudzwa`, `blessing`, `kudzai`, `tatenda`, `tendai` | demo users | spare accounts |

- Login: `POST http://localhost:3000/api/auth/login {"username","password"}` → `{token}` (Bearer), or directly `POST :3001/api/auth/v1/login` → `{auth_token}`.
- The Bearer token authorizes BFF admin routes (`/api/platform/admin/*`, `/api/trust/admin/*`, `/api/finance/admin/*`, `/api/gov/admin/*`, `/api/comms/admin/*`) and TrailBase records (`Authorization: Bearer …`).
- trust-service internal endpoints expect header `x-tgs-internal: <secret>` — the dev fallback is `tgs-internal-v1` (`mini-services/trust-service/config.ts`, env-overridable `TGS_INTERNAL_SECRET`).

**NextAuth cookie plane (rebuild-era console routes `/api/admin/*`, `/api/compliance/*`, `/api/mscs/*`):**
| Account (email) | Role |
|---|---|
| `admin@tengasell.co.zw` | ADMIN |
| `compliance@tengasell.co.zw` | COMPLIANCE |
| `finance@tengasell.co.zw` | FINANCE |
| `support@tengasell.co.zw` | SUPPORT |
| `moderation@tengasell.co.zw` | MODERATOR |
| `nyasha@example.com`, `tariro@example.com` | BUYER (negative-testing personas) |

- Login: `GET :3000/api/auth/csrf` → `POST :3000/api/auth/callback/credentials` (form: `csrfToken`, `email`, `password`, `json=true`) → session cookie `next-auth.session-token`.

**Consoles (browser):** gateway `http://localhost:81/` (hash routes `#/admin`, `#/signin`,
`#/my`…), compliance console `#/admin/compliance` (MSCS 609 controls + certification),
trust console `#/admin/trust`, finance `#/admin/finance`, comms center `#/comms`.
**Scratch-row convention:** any test row you create must be named `gap8-<task>-*` and deleted
in the same session (DAST's own `gap8-g6-probe` row demonstrates the pattern).

## 5. Environment topology (single sandbox node, loopback only)

| Port | Service | Kind | Health |
|---|---|---|---|
| :81 | Caddy gateway (reverse proxy, `?XTransformPort=<port>` passthrough) | infra | `GET /` |
| :3000 | Next.js 16 BFF (App Router, 252 API routes, both auth planes) | web | `GET /` 200 |
| :3001 | TrailBase v0.35.1 (Rust) — auth + records API | data | `GET /api/records/v1/categories?limit=1` |
| :3002 | trade-engine (socket.io, Bun) — authoritative bid/offer/order RPCs | engine | `GET /` |
| :3004 | gis-service — ZW gazetteer, OSRM routing, MVT tiles | mini-service | `GET /health` |
| :3005 | comms-service (TUCS 4-channel) | mini-service | `GET /health` |
| :3006 | finance-service — ledger/tax/payouts | mini-service | `GET /health` |
| :3007 | trust-service — tickets/enforcement/MFA | mini-service | `GET /health` |
| :3008 | govern-service — policies/registers/MSCS registry | mini-service | `GET /health` |

Databases (SQLite, WAL): `mini-services/trailbase-db/traildepot/data/main.db` (marketplace),
`db/{custom,comms,finance,trust,govern}.db`. Backups: `db/backups/*` (checksummed, daily +
manual), `backups/` (BCP snapshot + savepoint).

## 6. How to run the harnesses

```bash
cd /home/z/my-project
bun ops/smoke.ts   # 9-point synthetic monitoring (gateway, all services) → JSON, exit 1 on failure
bun ops/sast.ts    # static security scan (~1-2 min; OSV dependency audit needs network) → ops/reports/sast-report.{json,md}
bun ops/dast.ts    # LIVE-stack dynamic probes (~1 min; stack must be up; creates+deletes one gap8-g6-probe scratch row)
bun ops/sbom.ts    # regenerate ops/sbom.json (SBOM)
```

Exit codes: `smoke.ts` exits 1 on any failing check. `sast.ts` exits 1 only on an
untriaged CRITICAL finding (current baseline: none). `dast.ts` completes with exit 0 and
grades each probe PASS/FAIL/INFO — FAILs are findings (see report dispositions), not
harness errors.

## 7. Known open findings at time of writing (auditor should re-verify)

1. **Security response headers absent** at :3000 and the :81 gateway (no CSP / X-Frame-Options / Referrer-Policy / X-Content-Type-Options; HSTS is a TLS-edge concern). DAST-030/031 FAIL; fix = Caddy `header` directive + `next.config.ts` `headers()` + gateway reload (outside GAP8-G6 write zones → reported).
2. **No rate limiting on `POST /api/auth/login`** (`rateLimit()` exists in `src/lib/server/auth-core.ts` but is wired to v1-API/dev-key/threads/listing routes instead). 25-attempt burst answered 401×25, no 429, no lockout. DAST-032 FAIL; fix = wire rate limiter into the login route (outside GAP8-G6 write zones → reported).
3. **Dependency advisories** (SAST dependency audit): 90/969 packages carry OSV advisories, incl. direct deps `next@16.1.3`, `next-auth@4.24.13`, `maplibre-gl@6.15.0`, `react@19.2.3`… — full list + severities in `ops/reports/sast-report.json` → register for SEC-012 triage (upgrade / accept / mitigate before launch).
4. **Dev-fallback secrets** documented (INFO, accepted): `Tengasell#2025` demo password, `tengasell-dev-secret-change-in-production` (NextAuth dev fallback), `tgs-internal-v1` (trust internal header dev fallback) — all env-overridable, none valid in production, production must inject real values.
