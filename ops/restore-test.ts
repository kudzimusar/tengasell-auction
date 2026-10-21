// ops/restore-test.ts — BCP-005 RESTORE TEST (mandatory certification gate).
// Run: `bun ops/restore-test.ts`
//
// Proves the backups are actually restorable — a backup nobody restored is
// a hope, not a control. Procedure (never touches the live databases):
//   1. pick the newest backups/<ts>/ with a manifest
//   2. copy its snapshots into /tmp/tengasell-restore-test/ (simulated
//      restore destination on independent storage)
//   3. open every restored db READ-ONLY and count the key tables
//   4. compare restored counts against (a) the LIVE databases and (b) the
//      counts recorded in the backup manifest
//   5. write the evidence bundle backups/restore-test-<ts>.json:
//      {ran_at, backup, checks:[{db, table, restored, live, backup, ok}],
//       ok:true|false}  — ok requires restored === backup-manifest count
//      for every table (live counts are reported as reference; drift after
//      the backup is expected on a live system and noted, not failed).
// Exit code 1 on any failure (CI-able).

import fs from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";

const ROOT = "/home/z/my-project";
const OUT_ROOT = path.join(ROOT, "backups");
const RESTORE_DIR = "/tmp/tengasell-restore-test";

const LIVE: Record<string, string> = {
  trailbase: path.join(ROOT, "mini-services/trailbase-db/traildepot/data/main.db"),
  comms: path.join(ROOT, "db/comms.db"),
  finance: path.join(ROOT, "db/finance.db"),
  trust: path.join(ROOT, "db/trust.db"),
  govern: path.join(ROOT, "db/govern.db"),
};

function counts(file: string, tables: string[]): Record<string, number> {
  const db = new Database(file, { readonly: true });
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      out[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n);
    } catch {
      out[t] = -1;
    }
  }
  db.close();
  return out;
}

function main(): void {
  const dirs = fs
    .readdirSync(OUT_ROOT)
    .filter((d) => fs.existsSync(path.join(OUT_ROOT, d, "manifest.json")))
    .sort();
  if (dirs.length === 0) {
    console.error("No backup with a manifest found — run `bun ops/backup.ts` first.");
    process.exitCode = 1;
    return;
  }
  const backupDir = path.join(OUT_ROOT, dirs[dirs.length - 1]);
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8")) as {
    created_at: string;
    counts_at_backup: Record<string, Record<string, number>>;
    errors: string[];
  };

  fs.rmSync(RESTORE_DIR, { recursive: true, force: true });
  fs.mkdirSync(RESTORE_DIR, { recursive: true });

  const checks: { db: string; table: string; restored: number; live: number; backup: number; ok: boolean }[] = [];

  for (const [dbKey, liveFile] of Object.entries(LIVE)) {
    const snapshot = path.join(backupDir, `${dbKey}.db`);
    if (!fs.existsSync(snapshot)) {
      checks.push({ db: dbKey, table: "(file)", restored: -1, live: -1, backup: -1, ok: false });
      continue;
    }
    const restoredPath = path.join(RESTORE_DIR, `${dbKey}.db`);
    fs.copyFileSync(snapshot, restoredPath);

    const tables = Object.keys(manifest.counts_at_backup[dbKey] ?? {});
    const restoredCounts = counts(restoredPath, tables);
    const liveCounts = fs.existsSync(liveFile) ? counts(liveFile, tables) : {};
    const backupCounts = manifest.counts_at_backup[dbKey] ?? {};

    for (const t of tables) {
      const restored = restoredCounts[t] ?? -1;
      const live = liveCounts[t] ?? -1;
      const backup = backupCounts[t] ?? -1;
      checks.push({
        db: dbKey,
        table: t,
        restored,
        live,
        backup,
        // ok: the restored database is exactly what the manifest says we
        // backed up (restore fidelity). live drift after the backup moment
        // is expected on a live system and surfaced as reference only.
        ok: restored === backup && backup >= 0,
      });
    }
  }

  const drifted = checks.filter((c) => c.live !== c.backup && c.table !== "(file)");
  const evidence = {
    ran_at: new Date().toISOString(),
    gate: "BCP-005 restore test (MSCS 12-e certification)",
    backup: {
      dir: path.relative(ROOT, backupDir),
      created_at: manifest.created_at,
      method: "sqlite VACUUM INTO snapshots restored to " + RESTORE_DIR,
    },
    procedure: [
      "newest backup selected from backups/",
      "snapshots copied to /tmp/tengasell-restore-test (independent location)",
      "every restored db opened READ-ONLY and key tables counted",
      "restored counts compared to the backup manifest (fidelity) and the live dbs (reference)",
      "live databases were never opened for writing",
    ],
    checks,
    summary: {
      checks_total: checks.length,
      checks_ok: checks.filter((c) => c.ok).length,
      live_drift_since_backup: drifted.map((c) => `${c.db}.${c.table}: backup=${c.backup} live=${c.live}`),
      note: drifted.length
        ? "live drifted after the backup moment (concurrent activity) — restore fidelity still holds; rerun backup+test together for a drift-free pair"
        : "no live drift since the backup — restored == live == manifest across every key table",
    },
    ok: checks.length > 0 && checks.every((c) => c.ok),
  };

  const out = path.join(OUT_ROOT, `restore-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ok: evidence.ok, evidence: path.relative(ROOT, out), summary: evidence.summary }, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

main();
