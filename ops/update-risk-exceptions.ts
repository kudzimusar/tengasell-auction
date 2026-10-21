// ops/update-risk-exceptions.ts — GAP8-G6: mirror the honest SAST/DAST exception updates
// into the LIVE exception registers + the certification worksheet. Idempotent: safe to re-run.
// Run: `bun ops/update-risk-exceptions.ts`
//
// What this updates (and what it deliberately does NOT):
//   1. db/custom.db → RiskException (authoritative register read by the rebuild-era
//      compliance console / prisma model):
//        RSK-EX-005 — reason/compensating/monitoring narrowed honestly: in-repo SAST+DAST
//                     harnesses now exist and run with committed reports (GAP8-G6); the
//                     RESIDUAL exception = independent external vendor SAST/DAST/pen-test.
//                     Status stays ACTIVE (NOT closed).
//        RSK-EX-003 — reason gains the GAP8-S1 note: TOTP recovery codes stored sha256-
//                     hashed with live migration evidence; residual = staff-wide enforcement.
//   2. db/govern.db → risk_exceptions (authoritative register read by the original build's
//      govern-service / compliance console): RSK-EX-001 is the same SAST/DAST/pen-test
//      family exception — its compensating controls are extended to cite the new harness
//      evidence. Status stays 'active'.
//   3. agent-ctx/mscs-worksheet-12.json — ONLY the SEC-control status/note fields with
//      direct new SAST/DAST evidence (SEC-009, SEC-010, SEC-011, SEC-012, SEC-021), with the
//      summary counters recomputed exactly the way agent-ctx/gen-worksheet.ts derives them.
//      No scores are fabricated: every status bump cites a committed artifact.
//
// NOT touched: govern.db `controls` statuses (certification-replay territory), prisma seed
// data, any risk-exception status flips (all rows remain ACTIVE/active).

import { readFileSync, writeFileSync } from "node:fs";
// bun:sqlite builtin — direct, transparent writes to the live WAL databases
import { Database as Sqlite } from "bun:sqlite";

const ROOT = "/home/z/my-project";

const EX005_REASON =
  "In-repo SAST+DAST now operating (GAP8-G6): ops/sast.ts + ops/dast.ts run against the live stack with committed reports (ops/reports/) + external audit pack (ops/audit-pack/); RESIDUAL: no independent external SAST/DAST/pen-test vendor engaged yet — exception stays ACTIVE for that scope";
const EX005_RISK =
  "Unfound vulnerabilities may exist (internal harnesses reduce, but do not replace, independent external testing)";
const EX005_COMP = [
  "In-repo SAST harness (secret scan, dangerous patterns, OSV dependency audit, security eslint) with committed report",
  "Live-stack DAST suite (35 probes: authz matrix, input validation, TrailBase ACL/IDOR, socket auth, trust gates, headers, rate-limit, error spectrum) with committed report",
  "External auditor pack (ops/audit-pack/) with scope, methodology, control mapping, credentials runbook",
  "Lint gate + strict TS + dependency pinning (bun.lock) + security logging + secure-config checklist",
  "External vendor pen-test scheduled pre-launch",
];
const EX005_MONITORING =
  "Re-test before public launch; weekly register review; re-run bun ops/sast.ts + bun ops/dast.ts per change and pre-launch; independent vendor pen-test within 90 days of launch";
const EX003_NOTE =
  "Full TOTP/passkey MFA not yet enforced; staff accounts flagged, email-OTP step-up design ready — NOTE (GAP8-S1): TOTP recovery codes are now stored hashed (SHA-256) in trust.db with live migration evidence; residual = staff-wide TOTP enforcement";

// ── 1. db/custom.db (Prisma RiskException) ───────────────────────────────────
{
  const db = new Sqlite(`${ROOT}/db/custom.db`);
  const before = db.query("SELECT exceptionId, reason, status FROM RiskException WHERE exceptionId IN ('RSK-EX-005','RSK-EX-003')").all();
  console.log("custom.db BEFORE:", JSON.stringify(before, null, 1));

  const up5 = db.query("UPDATE RiskException SET reason = ?, riskStatement = ?, compensating = ?, monitoring = ?, status = 'ACTIVE' WHERE exceptionId = 'RSK-EX-005'");
  up5.run(EX005_REASON, EX005_RISK, JSON.stringify(EX005_COMP), EX005_MONITORING);

  const up3 = db.query("UPDATE RiskException SET reason = ?, status = 'ACTIVE' WHERE exceptionId = 'RSK-EX-003'");
  up3.run(EX003_NOTE);

  const after = db.query("SELECT exceptionId, reason, status, compensating, monitoring FROM RiskException WHERE exceptionId IN ('RSK-EX-005','RSK-EX-003')").all();
  console.log("custom.db AFTER:");
  for (const row of after as unknown as Record<string, string>[]) {
    console.log(`  ${row.exceptionId} [${row.status}]`);
    console.log(`    reason: ${String(row.reason).slice(0, 220)}${String(row.reason).length > 220 ? "…" : ""}`);
    if (row.exceptionId === "RSK-EX-005") {
      console.log(`    compensating: ${row.compensating}`);
      console.log(`    monitoring: ${row.monitoring}`);
    }
  }
  db.close();
}

// ── 2. db/govern.db (govern-service risk_exceptions — original-build register) ─
{
  const db = new Sqlite(`${ROOT}/db/govern.db`);
  const row = db.query("SELECT ref, compensating_controls, status FROM risk_exceptions WHERE ref = 'RSK-EX-001'").get() as { ref: string; compensating_controls: string; status: string } | null;
  if (!row) {
    console.log("govern.db RSK-EX-001: NOT FOUND (skipped)");
  } else {
    const cite = " In-repo SAST+DAST harnesses now operating (GAP8-G6): ops/sast.ts + ops/dast.ts with committed reports (45 static findings triaged; 35 live probes: 32 PASS / 3 documented FAILs) + external audit pack (ops/audit-pack/); the independent external vendor penetration test remains the open launch condition.";
    if (row.compensating_controls.includes("GAP8-G6")) {
      console.log("govern.db RSK-EX-001: already updated (idempotent skip)");
    } else {
      console.log("govern.db BEFORE:", JSON.stringify(row, null, 1));
      db.query("UPDATE risk_exceptions SET compensating_controls = ? WHERE ref = 'RSK-EX-001'")
        .run(row.compensating_controls + cite);
      const after = db.query("SELECT ref, status, compensating_controls FROM risk_exceptions WHERE ref = 'RSK-EX-001'").get();
      console.log("govern.db AFTER status:", (after as { status: string }).status, "(unchanged — kept 'active')");
      console.log("govern.db AFTER compensating_controls:", String((after as { compensating_controls: string }).compensating_controls).slice(-320));
    }
  }
  db.close();
}

// ── 3. agent-ctx/mscs-worksheet-12.json (SEC control status/note + summary) ──
{
  const WS = `${ROOT}/agent-ctx/mscs-worksheet-12.json`;
  const ws = JSON.parse(readFileSync(WS, "utf8")) as {
    summary: Record<string, number>;
    controls: { id: string; status: string; note: string; inScope: boolean }[];
  };
  const before = ws.controls.filter((c) => ["SEC-009", "SEC-010", "SEC-011", "SEC-012", "SEC-021"].includes(c.id)).map((c) => ({ id: c.id, status: c.status }));
  console.log("worksheet BEFORE:", JSON.stringify(before));

  const notes: Record<string, { status?: string; note: string }> = {
    "SEC-009": {
      status: "S50",
      note: "Dependency scanning OPERATING IN-REPO (GAP8-G6): ops/sast.ts queries all 969 bun.lock-resolved packages against OSV.dev with a committed advisory register (90 packages flagged, severities + direct-dep triage list) → ops/reports/sast-report.*; frozen lockfile policy intact; cadence = per-change + pre-launch.",
    },
    "SEC-010": {
      status: "S60",
      note: "SAST IMPLEMENTED+EVIDENCED (GAP8-G6): ops/sast.ts — secret scan (demo-fixture whitelist documented), dangerous-pattern scan (eval/child_process/SQL interpolation/XSS sinks/transport/client-env leak), OSV dependency audit, focused eslint no-eval/no-new-func pass (0 errors/464 files). Committed report: ops/reports/sast-report.{json,md}. External/vendor SAST pending — residual RSK-EX-005.",
    },
    "SEC-011": {
      status: "S60",
      note: "DAST IMPLEMENTED+EVIDENCED (GAP8-G6): ops/dast.ts — 35 live probes (authz matrix 8 admin routes × anonymous/non-staff/staff across both auth planes; zod input validation; TrailBase ACL + cross-user IDOR; trade-engine socket auth; trust-service gates; security headers; login rate-limit burst; error spectrum). Result 32 PASS / 3 documented FAILs (security headers absent, login rate-limit unwired) with dispositions. Committed report: ops/reports/dast-report.{json,md}. External pen-test pending — residual RSK-EX-005.",
    },
    "SEC-012": {
      status: "S40",
      note: "Vulnerability-management register BEGUN (GAP8-G6): dependency-advisory register (OSV, 90 packages, severities + direct-dep list in sast-report.json), DAST findings with triage dispositions, RiskException registers updated (custom.db + govern.db). Formal review cadence + SLA policy still pending.",
    },
    "SEC-021": {
      note: "Penetration testing: in-repo DAST now exercises the live stack each run (ops/dast.ts, GAP8-G6) + external auditor pack ready (ops/audit-pack/); independent external vendor engagement remains a time-bounded owner action (within 90 days of public launch — risk exception Template C / RSK-EX-005 residual).",
    },
  };
  for (const c of ws.controls) {
    const n = notes[c.id];
    if (!n) continue;
    if (n.status) c.status = n.status;
    c.note = n.note;
  }
  // recompute summary exactly as agent-ctx/gen-worksheet.ts derives it
  const out = ws.controls as unknown as { status: string; applicability: string; inScope: boolean }[];
  ws.summary.liveVerified = out.filter((c) => c.status === "S80").length;
  ws.summary.evidenced = out.filter((c) => c.status === "S60").length;
  ws.summary.partial = out.filter((c) => ["S30", "S40", "S50"].includes(c.status)).length;
  ws.summary.gapsToBuild = out.filter((c) => c.status === "S10" && c.inScope).length;
  ws.summary.deferredDocumented = out.filter((c) => c.status === "S00" && !c.inScope).length;
  writeFileSync(WS, JSON.stringify(ws, null, 1));
  const after = ws.controls.filter((c) => ["SEC-009", "SEC-010", "SEC-011", "SEC-012", "SEC-021"].includes(c.id)).map((c) => ({ id: c.id, status: c.status }));
  console.log("worksheet AFTER:", JSON.stringify(after));
  console.log("worksheet summary recomputed:", JSON.stringify(ws.summary));
}

console.log("Exception registers updated honestly (statuses remain ACTIVE/active — nothing closed).");
