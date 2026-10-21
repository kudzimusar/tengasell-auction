// TUCS database — bun:sqlite (WAL) at /home/z/my-project/db/comms.db.
// All 11 tables created idempotently on boot, exactly per the pinned TUCS v1
// contract section A (CREATE TABLE IF NOT EXISTS migrations).

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA synchronous = NORMAL;");

export type SqlParam = string | number | bigint | null;

const DDL = `
CREATE TABLE IF NOT EXISTS channel_links(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN('email','telegram','whatsapp','messenger')),
  handle TEXT NOT NULL,
  display_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','verified','disabled')),
  verify_token TEXT,
  verify_code TEXT,
  verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id,channel,handle)
);

CREATE TABLE IF NOT EXISTS preferences(
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  email INTEGER DEFAULT 0,
  telegram INTEGER DEFAULT 0,
  whatsapp INTEGER DEFAULT 0,
  messenger INTEGER DEFAULT 0,
  PRIMARY KEY(user_id,event_key)
);

CREATE TABLE IF NOT EXISTS outbound_queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  channel TEXT,
  handle TEXT,
  template_key TEXT,
  locale TEXT DEFAULT 'en',
  subject TEXT,
  body_json TEXT,
  deep_link TEXT,
  status TEXT DEFAULT 'queued' CHECK(status IN('queued','sending','sent','failed','dead')),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  scheduled_at TEXT,
  sent_at TEXT,
  provider_msg_id TEXT,
  campaign_id INTEGER,
  thread_id TEXT,
  unsub_token TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relay_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT,
  direction TEXT CHECK(direction IN('out','in')),
  from_user_id TEXT,
  to_user_id TEXT,
  channel TEXT,
  content_original TEXT,
  masked_content TEXT,
  flags_json TEXT,
  moderation_status TEXT CHECK(moderation_status IN('clean','masked','blocked','review')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  kind TEXT DEFAULT 'marketing',
  status TEXT DEFAULT 'draft' CHECK(status IN('draft','scheduled','running','paused','done')),
  segment_key TEXT,
  channels_json TEXT,
  template_key TEXT,
  locale TEXT DEFAULT 'en',
  schedule_at TEXT,
  stats_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS campaign_audience(
  campaign_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY(campaign_id,user_id)
);

CREATE TABLE IF NOT EXISTS templates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT,
  channel TEXT,
  locale TEXT,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  short_text TEXT,
  active INTEGER DEFAULT 1,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS mock_inbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT,
  subject TEXT,
  html TEXT,
  text TEXT,
  queue_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mock_chats(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  chat_id TEXT,
  role TEXT CHECK(role IN('bot','user')),
  text TEXT,
  queue_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliveries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER,
  event TEXT CHECK(event IN('delivered','open','click','bounce','complaint','unsub')),
  meta_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppression(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  handle TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(channel,handle)
);
`;

db.exec(DDL);

// ── Thin typed helpers over bun:sqlite ───────────────────────────────────────

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
