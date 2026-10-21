# SAST Report — Tengasell (ops/sast.ts)
Generated: 2026-10-21T00:09:15.943Z (run: `bun ops/sast.ts`)

Scope: 573 text files across src/, mini-services/, ops/, prisma/ (+ .env presence check).
Exclusions: node_modules, .next, .smoke-t5d browser profile, DB binaries, backups, screenshots, generated reports. `ops/sast.ts`/`ops/dast.ts` self-exempted from scanning (they contain the scan-rule definitions and demo-fixture strings themselves; all other ops/ scripts are fully scanned).

## Summary
| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 4 |
| INFO | 39 |

| Disposition | Count |
|---|---|
| fixed | 0 |
| false-positive | 15 |
| accepted-with-reason | 30 |
| reported | 0 |

By category: secret-scan=10, transport-security=22, dangerous-pattern=7, xss-sink=4, sql-interpolation=2

## Dependency audit (SEC-009)
- Scanner: osv.dev querybatch (api.osv.dev)
- Resolved packages queried: 969 (from bun.lock — what is actually installed)
- Packages with known advisories: 90 — DIRECT dependencies affected: maplibre-gl@6.15.0, next@16.1.3, next-auth@4.24.13, next-intl@4.7.0, react@19.2.3, react-dom@19.2.3, react-hook-form@7.71.1, sharp@0.34.5, uuid@11.1.0, zod@4.3.5
- By severity (advisory occurrences): {"CRITICAL":11,"HIGH":92,"MEDIUM":56,"LOW":18,"UNKNOWN":136}
- CRITICAL advisories (package@version:advisory): @babel/traverse@7.28.6:GHSA-67hx-6x53-jw92, eslint-scope@8.4.0:GHSA-hxxf-q3w9-4xgw, immer@10.2.0:GHSA-33f9-j839-rf8h, js-yaml@4.1.1:GHSA-xxvw-45rp-3mj2, lodash@4.17.21:GHSA-jf85-cpcp-j695, lodash-es@4.17.22:GHSA-jf85-cpcp-j695, maplibre-gl@6.15.0:GHSA-jrc7-96c5-q579, minimist@1.2.8:GHSA-xvch-5gv4-984h, next@16.1.3:GHSA-2xp9-vwfh-vxw4, next@16.1.3:GHSA-9qr9-h5gf-34mp, next@16.1.3:GHSA-f82v-jwr5-mffw
- 969 resolved npm packages queried against OSV.dev (scan of what is ACTUALLY installed per bun.lock). 90 packages carry known advisories (10 of them direct package.json deps — listed in directVulnerablePackages for triage); severities from OSV/GHSA records (MODERATE normalized to MEDIUM; CVSS v3.1 base score computed where no tag; details fetched for first 150 unique advisories).

## Security eslint pass (SEC-010)
- Ran: bunx eslint src --rule '{"no-eval":"error","no-new-func":"error"}' --format json — 464 files, no-eval/no-new-func errors: 0
- Standing gate: The repo's standing lint gate (`bun run lint` → eslint-config-next/core-web-vitals + typescript, run after every change per the build contract, 0 errors enforced in worklogs) covers compilation-level safety; the focused no-eval/no-new-func pass above is the SAST-specific overlay.

## Findings
### MEDIUM (2)

| ID | Category | Location | Match | Disposition | Reason |
|---|---|---|---|---|---|
| SAST-039 | sql-interpolation | mini-services/comms-service/queue.ts:115 | `run(`UPDATE outbound_queue SET ${sets} WHERE id = ?`, [...keys.map((k) => fields[k]), id] as SqlParam[]);` | false-positive | `SET ${sets}` interpolates ONLY column names generated from Object.keys of a code-controlled field map (`${k} = ?`); every VALUE is a bound ? parameter — no user input reaches SQL text |
| SAST-045 | sql-interpolation | ops/backup.ts:94 | `db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);` | false-positive | VACUUM INTO path is internal (db/backups/<timestamp>.db) and single-quotes are escaped ('' doubling) before interpolation; op script, not user-reachable |

### LOW (4)

| ID | Category | Location | Match | Disposition | Reason |
|---|---|---|---|---|---|
| SAST-034 | xss-sink | src/components/tengasell/pages/gov-client.tsx:68 | `*  construction (no dangerouslySetInnerHTML anywhere in this module). */` | false-positive | comment only — asserts no dangerouslySetInnerHTML in module |
| SAST-035 | xss-sink | src/components/tengasell/pages/policies/policies-page.tsx:9 | `// rendered through React elements ONLY (no dangerouslySetInnerHTML), so any` | false-positive | comment only — asserts the module does NOT use dangerouslySetInnerHTML |
| SAST-036 | xss-sink | src/components/tengasell/pages/orders/receipts-card.tsx:111 | `dangerouslySetInnerHTML={{` | false-positive | static @media print CSS literal — zero interpolation, no user input |
| SAST-037 | xss-sink | src/components/ui/chart.tsx:83 | `dangerouslySetInnerHTML={{` | false-positive | shadcn/ui stock chart theming — injects a config-built CSS-variables string from the chart config object, no user-supplied strings |

### INFO (39)

| ID | Category | Location | Match | Disposition | Reason |
|---|---|---|---|---|---|
| SAST-001 | secret-scan | src/lib/tengasell/api/local.ts:208 | `token: "local-demo-token"` | accepted-with-reason | generic-secret-assign: documented demo fixture — documentation/mock placeholder strings in the developer-portal docs and local demo adapter |
| SAST-002 | secret-scan | src/components/tengasell/pages/developers/developers-page.tsx:101 | `password":"Tengasell#2025"` | accepted-with-reason | generic-secret-assign: documented demo fixture — shared password of the seeded demo accounts (admin/rufaro/nyasha/chipo/…) — displayed on the sign-in page and shipped in seed SQL by design; sandbox fixture, not a production credential |
| SAST-003 | secret-scan | src/components/tengasell/pages/developers/developers-page.tsx:201 | `password":"Tengasell#2025"` | accepted-with-reason | generic-secret-assign: documented demo fixture — shared password of the seeded demo accounts (admin/rufaro/nyasha/chipo/…) — displayed on the sign-in page and shipped in seed SQL by design; sandbox fixture, not a production credential |
| SAST-004 | secret-scan | src/components/tengasell/pages/developers/developers-page.tsx:244 | `password":"s3cret-pass"` | accepted-with-reason | generic-secret-assign: documented demo fixture — documentation/mock placeholder strings in the developer-portal docs and local demo adapter |
| SAST-005 | secret-scan | src/components/tengasell/pages/developers/developers-page.tsx:249 | `password":"s3cret-pass"` | accepted-with-reason | generic-secret-assign: documented demo fixture — documentation/mock placeholder strings in the developer-portal docs and local demo adapter |
| SAST-006 | secret-scan | ops/gap8-feature-verify.ts:12 | `password: "Tengasell#2025"` | accepted-with-reason | generic-secret-assign: documented demo fixture — shared password of the seeded demo accounts (admin/rufaro/nyasha/chipo/…) — displayed on the sign-in page and shipped in seed SQL by design; sandbox fixture, not a production credential |
| SAST-007 | secret-scan | ops/gap8-check.ts:2 | `password: "Tengasell#2025"` | accepted-with-reason | generic-secret-assign: documented demo fixture — shared password of the seeded demo accounts (admin/rufaro/nyasha/chipo/…) — displayed on the sign-in page and shipped in seed SQL by design; sandbox fixture, not a production credential |
| SAST-008 | secret-scan | prisma/seed.ts:300 | `token: "unsub_demo_simba"` | accepted-with-reason | generic-secret-assign: documented demo fixture — seeded demo unsubscribe token (prisma/seed.ts, E2E evidence EV-E3-024) |
| SAST-009 | secret-scan | prisma/seed.ts:486 | `secret: "whsec_demo"` | accepted-with-reason | generic-secret-assign: documented demo fixture — documentation/mock placeholder strings in the developer-portal docs and local demo adapter |
| SAST-010 | secret-scan | .env:1 | `DATABASE_URL=file:/home/z/my-project/db/custom.db` | accepted-with-reason | repo .env committed to git; contents audited: local SQLite DATABASE_URL path only — no credential values; production must inject env outside the repo |
| SAST-011 | transport-security | src/app/sitemap.ts:14 | `const APP_URL = process.env.APP_URL ?? "http://localhost:81";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-012 | transport-security | src/app/api/auth/mfa/verify/route.ts:15 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-013 | transport-security | src/app/api/auth/password/change/route.ts:11 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-014 | transport-security | src/app/api/auth/security/mfa/confirm/route.ts:20 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-015 | transport-security | src/app/api/auth/security/mfa/disable/route.ts:10 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-016 | transport-security | src/app/api/auth/security/mfa/start/route.ts:13 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-017 | transport-security | src/app/api/auth/security/state/route.ts:16 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-018 | transport-security | src/app/api/auth/login/route.ts:24 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-019 | transport-security | src/app/api/auth/status/route.ts:11 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-020 | transport-security | src/app/robots.ts:7 | `const APP_URL = process.env.APP_URL ?? "http://localhost:81";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-021 | dangerous-pattern | src/lib/server/geo-spawn.ts:11 | `import { spawn } from "node:child_process";` | false-positive | gis spawner: spawn('bun', ['index.ts']) fixed argv, cwd pinned to mini-services/gis-service; no user input |
| SAST-022 | dangerous-pattern | src/lib/server/geo-spawn.ts:49 | `const child = spawn("bun", ["index.ts"], {` | false-positive | gis spawner: spawn('bun', ['index.ts']) fixed argv, cwd pinned to mini-services/gis-service; no user input |
| SAST-023 | transport-security | src/lib/server/trust.ts:23 | `const TRUST_BASE = process.env.TRUST_URL ?? "http://127.0.0.1:3007";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-024 | dangerous-pattern | src/lib/server/services-spawn.ts:15 | `import { spawn } from "node:child_process";` | false-positive | service spawner: command comes from a static spec table ('trail' binary / 'bun'), args are fixed arrays; shell:false by construction (spawn(cmd, args) without options.shell); no user input reaches argv |
| SAST-025 | dangerous-pattern | src/lib/server/services-spawn.ts:145 | `const child = spawn(spec.command, spec.args, {` | false-positive | service spawner: command comes from a static spec table ('trail' binary / 'bun'), args are fixed arrays; shell:false by construction (spawn(cmd, args) without options.shell); no user input reaches argv |
| SAST-026 | dangerous-pattern | src/lib/server/finance.ts:16 | `import { spawn } from "node:child_process";` | false-positive | finance spawner: spawn('bun', ['run','dev']) fixed argv; no user input |
| SAST-027 | dangerous-pattern | src/lib/server/finance.ts:56 | `const child = spawn("bun", ["run", "dev"], {` | false-positive | finance spawner: spawn('bun', ['run','dev']) fixed argv; no user input |
| SAST-028 | transport-security | src/lib/server/finance.ts:23 | `const FINANCE_BASE = process.env.FINANCE_URL ?? "http://127.0.0.1:3006";` | false-positive | finance spawner: spawn('bun', ['run','dev']) fixed argv; no user input |
| SAST-029 | transport-security | src/lib/server/gov.ts:22 | `const GOV_BASE = process.env.GOVERN_URL ?? "http://127.0.0.1:3008";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-030 | transport-security | src/lib/server/paynow-order.ts:17 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-031 | transport-security | src/lib/server/comms.ts:18 | `const COMMS_BASE = process.env.COMMS_URL ?? "http://127.0.0.1:3005";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-032 | transport-security | src/lib/server/geo.ts:15 | `const BASE = process.env.GIS_BASE_URL ?? "http://localhost:3004";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-033 | transport-security | src/lib/server/trailbase-admin.ts:12 | `const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-038 | transport-security | mini-services/comms-service/config.ts:8 | `export const APP_URL = process.env.APP_URL ?? "http://localhost:81";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-040 | dangerous-pattern | mini-services/trade-engine/index.ts:899 | `import { spawn as cpSpawn } from "node:child_process";` | false-positive | dev-server ensureDev helper: spawn('bun', ['run','dev']) + cpSpawn in restart script — fixed argv, no user input, dev-only admin path |
| SAST-041 | transport-security | mini-services/trade-engine/index.ts:231 | `const COMMS_BASE = process.env.COMMS_URL ?? "http://127.0.0.1:3005";` | false-positive | dev-server ensureDev helper: spawn('bun', ['run','dev']) + cpSpawn in restart script — fixed argv, no user input, dev-only admin path |
| SAST-042 | transport-security | mini-services/finance-service/config.ts:10 | `export const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-043 | transport-security | mini-services/trust-service/config.ts:7 | `export const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |
| SAST-044 | transport-security | mini-services/govern-service/config.ts:8 | `export const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";` | accepted-with-reason | loopback http:// default behind a process.env override — config-driven internal service URL (expected pattern for the single-node sandbox); production terminates TLS at the gateway |

## Verdict
- Zero CRITICAL/HIGH unexplained findings in first-party code: YES (all HIGH rows triaged as false-positives/none).
- No eval/new Function anywhere in the scanned tree (eslint no-eval/no-new-func: 0 errors).
- SQL is parameterized everywhere; the two template-literal sites are triaged false-positives (column-name allowlist / escaped VACUUM path in an ops script).
- No hardcoded credentials beyond documented sandbox demo fixtures (surfaced as INFO, never silently dropped).
- Dependency advisories and their severities are recorded above for the vulnerability-management register (SEC-012).

*Report generated by ops/sast.ts — rerunnable: `bun ops/sast.ts`*
