# Evidence Index — Tengasell Security Audit (GAP8-G6)

Pointer map from evidence class → artifact. MSCS evidence classes: E1 implementation,
E2 verification, E3 runtime, E4 operational, E5 governance, E6 external.

## This task's artifacts (GAP8-G6)

| Artifact | Class | What it evidences |
|---|---|---|
| `ops/sast.ts` | E1+E2 | In-repo SAST harness implementation (secret scan, dangerous patterns, OSV dependency audit, security eslint) |
| `ops/reports/sast-report.json` | E2 | Machine-readable SAST results: 45 findings (0 CRITICAL / 0 HIGH untriaged), dispositions, full dependency-advisory register |
| `ops/reports/sast-report.md` | E2 | Human SAST summary with per-category findings, severity, disposition |
| `ops/dast.ts` | E1+E2 | In-repo live-stack DAST harness (35 probes across 9 suites) |
| `ops/reports/dast-report.json` | E3 | Machine-readable DAST results with captured status codes/headers/bodies per probe |
| `ops/reports/dast-report.md` | E3 | Human DAST summary: 32 PASS / 3 FAIL (all 3 with honest dispositions) |
| `ops/audit-pack/README.md` | E5 | Auditor scope + methodology + control mapping (SEC-008/009/010/011/012/019/021/025) + credentials runbook + topology |
| `ops/update-risk-exceptions.ts` | E5 | Script that mirrors the honest exception updates into db RiskException tables (run log in worklog) |
| `prisma/assessment.ts` (RSK-EX-005/003 rows) | E5 | Authoritative rebuild-era exception text updated: RSK-EX-005 narrowed to residual external-vendor pen-test; RSK-EX-003 carries the GAP8-S1 hashed-recovery-codes note |
| `agent-ctx/mscs-worksheet-12.json` | E5 | SEC-009/010/011/012/021 control notes + statuses updated for the new SAST/DAST evidence (conservative, no fabricated scores) |

## Standing evidence (pre-existing, referenced)

| Artifact | Class | What it evidences |
|---|---|---|
| `ops/smoke.ts` + latest run (`bun ops/smoke.ts`) | E3 | 9-point synthetic monitoring: gateway + all services green (9/9 as of RESTORE/SAVE-20261020) |
| `ops/sbom.json` | E1 | SBOM: 79 first-party declared components (70 direct, 9 dev), runtimes, products (app + 7 services), generated 2026-10-20T04:11:58Z |
| `ops/runbooks.md` | E4 | Ops runbooks incl. credential rotation, restore procedure, incident response |
| `ops/backup.ts` + `ops/restore-test.ts` | E3 | Backup (VACUUM INTO + sha256) and restore-test evidence (BCP-005 48/48 historical, 8/8 rebuild-era) |
| `worklog.md` | E5 | Complete build/verify history: RESET-001..003, RESTORE-001..003, BUILD-FINAL, SAVE-20261020, GAP8-F1/F2/F3/G5 (S1 security: hashed TOTP recovery codes), GAP8-G6 (this task) |
| `screenshots/` | E3 | Browser UAT runs (restore-*, verify-*, 11e-* admin console, gap8-f1/f2/f3 feature verification, 12f certification console) |
| `agent-ctx/mscs-1.0.txt`, `agent-ctx/udpcs-1.0.txt` | — | The binding standards (source PDFs digested) |
| `agent-ctx/certify-12f*.ts` | E5 | Certification replay scripts (96.5% PASS, 5 gates green, Template-C exceptions RSK-EX-001/002/003 in govern.db) |
| `mini-services/trust-service/totp.ts` + `routes/{mfa,internal}.ts` + `db.ts` | E1+E2 | GAP8-S1 (worklog): recovery codes stored sha256-hashed; live migration evidence ("hashed 8 plaintext code(s)…"); 14/14 E2E PASS |
| `mini-services/trailbase-db/traildepot/config.textproto` | E1 | TrailBase row-level ACL rules (probed live by DAST-018/019/020/022/023) |
| `prisma/assessment.ts` | E5 | Rebuild-era line-by-line MSCS assessment + exceptions RSK-EX-003..010 |
| `db/custom.db` → `RiskException` table | E5 | Live exception register read by the rebuild-era compliance console (mirrored by ops/update-risk-exceptions.ts) |
| `db/govern.db` → `risk_exceptions` table | E5 | Live exception register read by the govern-service/compliance console (RSK-EX-001 pen-test exception — mirrored by the same script) |

## Where each SEC control's evidence lives (quick links)

- **SEC-008** key rotation → `ops/runbooks.md`; sast-report `transport-security` rows (env-driven config)
- **SEC-009** dependency scanning → `ops/reports/sast-report.md` §Dependency audit
- **SEC-010** SAST → `ops/reports/sast-report.{json,md}` + `ops/sast.ts`
- **SEC-011** DAST → `ops/reports/dast-report.{json,md}` + `ops/dast.ts`
- **SEC-012** vulnerability management → sast-report.json `dependencyAudit.vulnerablePackages` + DAST FAIL dispositions + `RiskException` registers
- **SEC-019** detection → `ops/smoke.ts` + `/api/public/status` + admin ops console
- **SEC-021** penetration testing → this audit pack + RSK-EX-005 (residual, OPEN)
- **SEC-025** security training → govern-service training register (govern.db)

## Residual exceptions (kept honest — NOT closed by this task)

| Register | Row | State after GAP8-G6 |
|---|---|---|
| prisma/assessment.ts + db/custom.db `RiskException` | RSK-EX-005 | **ACTIVE** — narrowed: in-repo SAST harness + live DAST suite now exist, run in-repo with committed reports (SEC-009/010/011/012 evidence uplift); residual = independent external SAST/DAST/pen-test vendor engagement |
| db/govern.db `risk_exceptions` | RSK-EX-001 | **active** — compensating-controls text updated to cite the new harness reports; external vendor pen-test remains the open launch condition |
| prisma/assessment.ts + db/custom.db `RiskException` | RSK-EX-003 | **ACTIVE** — note added: TOTP recovery codes stored sha256-hashed per GAP8-S1 (live migration evidence); residual = full staff-wide TOTP enforcement |
