// Trust-service database — bun:sqlite (WAL) at /home/z/my-project/db/trust.db.
// All 17 tables created idempotently on boot (CREATE TABLE IF NOT EXISTS).
//
// Schema per the 12-c pinned contract (worklog Task 12-plan §B + task brief):
//   roles · mfa · signins · password_resets · suspension · tickets ·
//   ticket_messages · ticket_events · macros · reports · cases · enforcement ·
//   appeals · screening_rules · screening_hits · seller_health
// Additive extensions (documented in agent-ctx/12-c-trust.md):
//   enforcement.status/approved_at (pending dual-approval rows),
//   cases.kind ('abuse' | 'dispute'), cases.updated_at,
//   notifications_log (GOV-010 takedown buyer-notification evidence).

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config";
import { hashRecoveryCode, isPlaintextRecoveryCode } from "./totp";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA synchronous = NORMAL;");

export type SqlParam = string | number | bigint | null;

const DDL = `
CREATE TABLE IF NOT EXISTS roles(
  username TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN('admin','support','finance','moderator','compliance')),
  assigned_by TEXT NOT NULL DEFAULT '',
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS mfa(
  username TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  recovery_codes TEXT NOT NULL DEFAULT '[]',
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signins(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT,
  ua TEXT,
  status TEXT NOT NULL CHECK(status IN('ok','mfa_failed','blocked'))
);

CREATE TABLE IF NOT EXISTS password_resets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suspension(
  username TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN('warned','restricted','suspended','banned')),
  reason_code TEXT NOT NULL DEFAULT '',
  reason_note TEXT NOT NULL DEFAULT '',
  until TEXT,
  enforced_by TEXT NOT NULL DEFAULT '',
  enforced_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_ref TEXT
);

CREATE TABLE IF NOT EXISTS tickets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN('question','order','refund','complaint','feedback','other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high','urgent')),
  order_id INTEGER,
  auction_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','pending','resolved','closed')),
  assignee TEXT,
  sla_due_at TEXT NOT NULL,
  first_reply_at TEXT,
  resolved_at TEXT,
  csat_score INTEGER,
  csat_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0,
  attachment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS macros(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en'
);

CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN('listing','profile','message','order')),
  target_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK(reason_code IN('prohibited','counterfeit','scam','offplatform','abusive','ip_violation','other')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','reviewing','actioned','dismissed')),
  reviewer TEXT,
  reviewed_at TEXT,
  outcome TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cases(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER,
  ticket_id INTEGER,
  subject TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'abuse' CHECK(kind IN('abuse','dispute')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','under_review','resolved')),
  evidence TEXT NOT NULL DEFAULT '{}',
  risk_score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  outcome TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS enforcement(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN('warning','restriction','suspension','ban','reinstate')),
  reason_code TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  dual_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('pending','active')),
  requested_by TEXT NOT NULL DEFAULT '',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  lifts_at TEXT
);

CREATE TABLE IF NOT EXISTS appeals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enforcement_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','under_review','granted','denied')),
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS screening_rules(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN('prohibited','caution')),
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS screening_hits(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL,
  pattern TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','cleared','actioned')),
  reviewer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS seller_health(
  username TEXT PRIMARY KEY,
  dispatch_on_time REAL NOT NULL DEFAULT 0,
  dispute_rate REAL NOT NULL DEFAULT 0,
  rating_avg REAL NOT NULL DEFAULT 0,
  flag_count INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  username TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 12-c resume: sha256-hashed recovery codes mirrored from the Next BFF
-- (platform.ts storeRecoveryCodes). Trust's own /mfa/activate stores
-- sha256 HASHES in mfa.recovery_codes (v2 hardening — hashed at rest);
-- this additive table holds the hashed mirror of the BFF custody so trust
-- can validate both stores.
CREATE TABLE IF NOT EXISTS mfa_recovery_hashes(
  username TEXT PRIMARY KEY,
  hashes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

db.exec(DDL);

// ── v1→v2 recovery-code migration (MSCS control closure) ─────────────
// /mfa/activate stored recovery codes PLAINTEXT in mfa.recovery_codes
// until this hardening. On boot, hash any surviving plaintext code IN
// PLACE, one time, detected by regex — plaintext: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/
// vs already-hashed: /^[a-f0-9]{64}$/. Idempotent: hashed rows never match
// the plaintext pattern, so re-boots migrate nothing and stay silent.
{
  const rows = all<{ username: string; recovery_codes: string }>(
    `SELECT username, recovery_codes FROM mfa WHERE recovery_codes LIKE '%-%'`,
  );
  let rowsMigrated = 0;
  let codesMigrated = 0;
  for (const row of rows) {
    let codes: unknown;
    try {
      codes = JSON.parse(row.recovery_codes ?? "[]");
    } catch {
      continue; // not a JSON list — leave untouched
    }
    if (!Array.isArray(codes)) continue;
    let changed = false;
    const next = codes.map((c) => {
      if (typeof c === "string" && isPlaintextRecoveryCode(c)) {
        changed = true;
        codesMigrated++;
        return hashRecoveryCode(c);
      }
      return c;
    });
    if (changed) {
      run(`UPDATE mfa SET recovery_codes = ? WHERE username = ?`, [JSON.stringify(next), row.username]);
      rowsMigrated++;
    }
  }
  if (rowsMigrated > 0) {
    console.log(
      `[trust] recovery-code migration: hashed ${codesMigrated} plaintext code(s) ` +
        `across ${rowsMigrated} mfa row(s) in place (v1→v2, sha256)`,
    );
  }
}

// ── Thin typed helpers over bun:sqlite (mirror comms db.ts) ──────────────

export function all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T | null {
  return (db.prepare(sql).get(...params) ?? null) as unknown as T | null;
}

export function run(sql: string, params: SqlParam[] = []): void {
  db.prepare(sql).run(...params);
}

/** INSERT returning the new rowid. */
export function insert(sql: string, params: SqlParam[] = []): number {
  const res = db.prepare(sql).run(...params) as unknown as { lastInsertRowid: number | bigint };
  return Number(res.lastInsertRowid);
}

export function scalar(sql: string, params: SqlParam[] = []): number {
  const row = db.prepare(sql).get(...params) as unknown as Record<string, unknown> | null;
  if (!row) return 0;
  const first = Object.values(row)[0];
  return Number(first ?? 0);
}
