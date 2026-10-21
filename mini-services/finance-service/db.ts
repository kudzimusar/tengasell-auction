// finance-service database — bun:sqlite (WAL) at /home/z/my-project/db/finance.db.
// All tables are created idempotently on boot (CREATE TABLE IF NOT EXISTS).
//
// MONEY LAW (worklog 12-plan §G):
//   · Every amount is an INTEGER number of cents (USD display only).
//   · Every money movement is DOUBLE-ENTRY: ≥2 ledger_entries rows sharing
//     a balanced_tx id whose debits sum == credits sum (see /admin/ledger
//     ?verify=1 — the FIN-009 integrity proof).
//   · Accounts: bank · escrow_liability · platform_revenue · vat_liability ·
//     payout_payable · refund_expense · seller_balance:<username>.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config";
import { DEFAULT_CONFIG } from "./config";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA foreign_keys = ON;");

export type SqlParam = string | number | bigint | null;

const DDL = `
CREATE TABLE IF NOT EXISTS config(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  order_ref TEXT,
  payout_ref TEXT,
  tx_type TEXT NOT NULL,
  account TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('debit','credit')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  counter_account TEXT,
  memo TEXT,
  actor TEXT,
  balanced_tx TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger_entries(balanced_tx);
CREATE INDEX IF NOT EXISTS idx_ledger_account_ts ON ledger_entries(account, id DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_order ON ledger_entries(order_ref);

CREATE TABLE IF NOT EXISTS order_finance(
  order_id INTEGER PRIMARY KEY,
  buyer TEXT NOT NULL,
  seller TEXT NOT NULL,
  item_price_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  escrow_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  vat_cents INTEGER NOT NULL DEFAULT 0,
  net_to_seller_cents INTEGER NOT NULL DEFAULT 0,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'holding' CHECK(status IN('holding','released','refunded','partial')),
  dispute_window_ends TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_finance_seller ON order_finance(seller, order_id DESC);

CREATE TABLE IF NOT EXISTS seller_balances(
  username TEXT PRIMARY KEY,
  available_cents INTEGER NOT NULL DEFAULT 0,
  pending_cents INTEGER NOT NULL DEFAULT 0,
  withheld_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS payouts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  method TEXT NOT NULL CHECK(method IN('ecocash','bank')),
  destination TEXT NOT NULL,
  id_number TEXT NOT NULL,
  tax_number TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN('requested','approved','paid','rejected','reversed')),
  request_note TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_by TEXT,
  approved_at TEXT,
  approve_reason TEXT,
  sanctions_confirmed INTEGER NOT NULL DEFAULT 0,
  paid_by TEXT,
  paid_at TEXT,
  reference TEXT,
  reversal_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_payouts_username ON payouts(username, id DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

CREATE TABLE IF NOT EXISTS refunds(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  kind TEXT NOT NULL DEFAULT 'full' CHECK(kind IN('full','partial')),
  reason_code TEXT NOT NULL CHECK(reason_code IN('item_not_received','not_as_described','damaged','seller_cancelled','goodwill')),
  reason_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN('pending_approval','approved','processed','rejected')),
  requested_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  dual_approval INTEGER NOT NULL DEFAULT 0,
  credit_note_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

CREATE TABLE IF NOT EXISTS chargebacks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  provider_ref TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','resolved')),
  evidence TEXT,
  resolution TEXT,
  resolution_note TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  vat_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','issued','paid','void')),
  issued_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_notes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  refund_ref TEXT,
  order_id INTEGER,
  amount_cents INTEGER NOT NULL,
  vat_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  buyer TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT,
  paid_at TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_lines(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_date TEXT,
  amount_cents INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN('in','out')),
  memo TEXT,
  matched_ref TEXT,
  matched_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recon_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  payments_checked INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  exceptions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS events_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  payload TEXT
);
`;

db.exec(DDL);

// ── Seed default config (idempotent — only missing keys are inserted) ─────
{
  const insert = db.prepare("INSERT OR IGNORE INTO config(key, value) VALUES(?, ?)");
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    insert.run(key, JSON.stringify(value));
  }
}

// ── Thin typed helpers over bun:sqlite ───────────────────────────────

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

/** Run a set of statements inside one transaction (all-or-nothing). */
export function inTransaction<T>(fn: () => T): T {
  const tx = db.transaction(fn);
  return tx() as T;
}
