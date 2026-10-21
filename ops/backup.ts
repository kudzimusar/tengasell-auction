// ops/backup.ts — Tengasell platform backup (BCP-002/003, RPO 24h).
// Run: `bun ops/backup.ts`
//
// SQLite-consistent online backups of every service database. Method:
// Bun's `db.serialize()` on a READ-ONLY connection — an in-memory snapshot
// via SQLite's backup API (transactionally consistent, includes committed
// WAL frames; verified live: integrity_check ok + counts match). Fallback:
// `VACUUM INTO`. The sqlite3 CLI is not installed here, and TrailBase's
// main.db schema uses a custom jsonschema function that breaks VACUUM INTO
// rebuilds — serialize() is the one method that works for ALL five dbs.
// Never writes to the live databases.
//
// Targets (the five system-of-record databases):
//   · TrailBase main db  mini-services/trailbase-db/traildepot/data/main.db
//   · comms              db/comms.db
//   · finance            db/finance.db
//   · trust              db/trust.db
//   · govern             db/govern.db
// Output: /home/z/my-project/backups/<timestamp>/ with the snapshots plus
// manifest.json (per-file sha256 + size + method, key-table row counts at
// backup time — the reference the restore test compares against).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

const ROOT = "/home/z/my-project";
const OUT_ROOT = path.join(ROOT, "backups");

const TARGETS: { db: string; file: string }[] = [
  { db: "trailbase", file: path.join(ROOT, "mini-services/trailbase-db/traildepot/data/main.db") },
  { db: "comms", file: path.join(ROOT, "db/comms.db") },
  { db: "finance", file: path.join(ROOT, "db/finance.db") },
  { db: "trust", file: path.join(ROOT, "db/trust.db") },
  { db: "govern", file: path.join(ROOT, "db/govern.db") },
];

/** Key tables counted at backup time (the restore-test contract). */
const COUNT_TABLES: Record<string, string[]> = {
  trailbase: ["_user", "profiles", "auctions", "bids", "orders", "payments", "ratings", "notifications", "audit_events"],
  comms: ["channel_links", "preferences", "outbound_queue", "relay_log", "campaigns", "deliveries", "suppression"],
  finance: ["config", "ledger_entries", "order_finance", "seller_balances", "payouts", "refunds", "invoices", "credit_notes"],
  trust: ["roles", "mfa", "signins", "password_resets", "suspension", "tickets", "ticket_messages", "reports", "cases", "enforcement", "appeals", "screening_rules", "screening_hits"],
  govern: ["policies", "policy_versions", "policy_acceptances", "privacy_requests", "controls", "evidence", "incidents", "risks", "legal_requests", "legal_holds", "decisions"],
};

function sha256(file: string): string {
  const h = createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function countTables(file: string, tables: string[]): Record<string, number> {
  const db = new Database(file, { readonly: true });
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number };
      out[t] = Number(row.n);
    } catch {
      out[t] = -1; // table missing — recorded honestly
    }
  }
  db.close();
  return out;
}

function main(): void {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(OUT_ROOT, ts);
  fs.mkdirSync(outDir, { recursive: true });

  const files: Record<string, { path: string; sha256: string; bytes: number }> = {};
  const counts: Record<string, Record<string, number>> = {};
  const methods: Record<string, string> = {};
  const errors: string[] = [];

  for (const t of TARGETS) {
    const dest = path.join(outDir, `${t.db}.db`);
    if (!fs.existsSync(t.file)) {
      errors.push(`${t.db}: source ${t.file} not found`);
      continue;
    }
    try {
      const db = new Database(t.file, { readonly: true });
      db.exec("PRAGMA busy_timeout=5000");
      let method = "bun:sqlite serialize (SQLite backup API, readonly source)";
      try {
        const bytes = db.serialize();
        fs.writeFileSync(dest, bytes);
      } catch {
        // VACUUM INTO fallback (service dbs whose schema allows a rebuild)
        db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
        method = "sqlite VACUUM INTO (online, transactionally consistent; readonly source)";
      }
      db.close();
      methods[t.db] = method;
      files[t.db] = {
        path: path.relative(ROOT, dest),
        sha256: sha256(dest),
        bytes: fs.statSync(dest).size,
      };
      counts[t.db] = countTables(dest, COUNT_TABLES[t.db] ?? []);
    } catch (err) {
      errors.push(`${t.db}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const manifest = {
    created_at: new Date().toISOString(),
    method: "bun:sqlite serialize — SQLite backup API snapshot from a readonly connection",
    method_per_db: methods,
    rpo: "24h (daily cron recommended; see ops/runbooks.md §RPO/RTO)",
    files,
    counts_at_backup: counts,
    live_sources: Object.fromEntries(TARGETS.map((t) => [t.db, path.relative(ROOT, t.file)])),
    errors,
    ok: errors.length === 0 && Object.keys(files).length === TARGETS.length,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(JSON.stringify({ ok: manifest.ok, backup_dir: outDir, files: Object.keys(files), errors }, null, 2));
  if (!manifest.ok) process.exitCode = 1;
}

main();
