// govern-service database — bun:sqlite (WAL) at /home/z/my-project/db/govern.db.
// All tables created idempotently on boot (CREATE TABLE IF NOT EXISTS migrations).
// Schema per Task 12-d contract section A.

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
-- ── Policy CMS (CMS-005..029, LEG-001..010) ────────────────────────────────
CREATE TABLE IF NOT EXISTS policies(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE CHECK(key IN('tos','privacy','rules','seller','aup','refunds','ip','accessibility')),
  title TEXT NOT NULL,
  title_ja TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','in_review','approved','published','retired')),
  current_version INTEGER NOT NULL DEFAULT 1,
  owner TEXT NOT NULL DEFAULT 'compliance',
  scheduled_for TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS policy_versions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK(locale IN('en','ja')),
  body TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT,
  change_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT,
  UNIQUE(policy_key, version, locale)
);

CREATE TABLE IF NOT EXISTS policy_acceptances(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  username TEXT,
  accepted_at TEXT DEFAULT (datetime('now')),
  surface TEXT NOT NULL DEFAULT 'policy_page' CHECK(surface IN('signup','sell','policy_page'))
);

-- ── Privacy / DSAR (PRV-001..018, DAT-010) ────────────────────────────────
CREATE TABLE IF NOT EXISTS privacy_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN('access','correction','deletion','portability','restriction','objection')),
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','verifying','in_progress','completed','rejected')),
  details_json TEXT,
  result_note TEXT,
  bundle_json TEXT,
  handled_by TEXT,
  due_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- per-user processing freeze flags (restriction/objection — PRV-009/010)
CREATE TABLE IF NOT EXISTS user_flags(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  flag TEXT NOT NULL CHECK(flag IN('restricted','objected','deletion_marked')),
  note TEXT,
  request_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  created_by TEXT,
  lifted_at TEXT
);

-- ── Data register / processors (DAT-001..015, PRV-003/004/014/015) ────────
CREATE TABLE IF NOT EXISTS data_register(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset TEXT NOT NULL,
  store TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN('public','internal','pii','financial')),
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  owner TEXT NOT NULL,
  retention TEXT NOT NULL,
  retention_days INTEGER,
  processing_notes TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS processors(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT NOT NULL,
  data_categories TEXT NOT NULL,
  transfer_basis TEXT,
  risk_notes TEXT,
  contract_status TEXT NOT NULL DEFAULT 'active',
  review_due TEXT,
  UNIQUE(name)
);

-- ── Generic register engine (one table, per-register filters) ─────────────
-- register ∈ strategy|entity|ownership|directors|corporate_policies|
--   delegated_authority|contracts|employees|contractors|assets|licenses|
--   domains|insurance|procurement|vendors|approvals|integrations|regulatory|
--   notices|compliance_calendar
CREATE TABLE IF NOT EXISTS register_entries(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  register TEXT NOT NULL,
  key TEXT,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  owner TEXT,
  due_date TEXT,
  meta_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── Incidents (INC-001..012, SEC-020, PRV-016, GOV-011) ───────────────────
CREATE TABLE IF NOT EXISTS incidents(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN('S1','S2','S3','S4')),
  type TEXT NOT NULL CHECK(type IN('outage','security','privacy','data','third_party')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','mitigated','resolved','closed')),
  commander TEXT,
  detected_at TEXT NOT NULL,
  timeline_json TEXT NOT NULL DEFAULT '[]',
  impact TEXT,
  rca TEXT,
  corrective_actions_json TEXT NOT NULL DEFAULT '[]',
  regulatory_reportable INTEGER NOT NULL DEFAULT 0,
  reported_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ── Risk register (RSK-001..010) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  likelihood INTEGER NOT NULL CHECK(likelihood BETWEEN 1 AND 5),
  impact INTEGER NOT NULL CHECK(impact BETWEEN 1 AND 5),
  score INTEGER NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','mitigated','accepted','closed')),
  controls_json TEXT NOT NULL DEFAULT '[]',
  review_due TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS risk_exceptions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  affected_controls_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  risk_statement TEXT NOT NULL,
  criticality TEXT NOT NULL DEFAULT 'medium',
  compensating_controls TEXT,
  owner TEXT NOT NULL,
  approved_by TEXT,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','expired','retired'))
);

-- ── Legal (LEG-012/013/014, GOV-007) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN('lawful_request','ip_takedown','subpoena')),
  requester TEXT NOT NULL,
  scope TEXT NOT NULL,
  received_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN('received','under_review','actioned','rejected','closed')),
  legal_review_by TEXT,
  minimisation_note TEXT,
  response_log_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS legal_holds(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  reason TEXT NOT NULL,
  case_ref TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  lifted_at TEXT
);

-- ── Decision log / ADRs (DOC-011/012, ENG-018/020, EXE-007) ───────────────
CREATE TABLE IF NOT EXISTS decisions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  context TEXT,
  decision TEXT NOT NULL,
  alternatives TEXT,
  consequences TEXT,
  decided_by TEXT,
  decided_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN('accepted','superseded'))
);

-- ── Strategy register (STR-001..009) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

-- ── Security governance (SEC-001/002/012/020/022/025) ─────────────────────
CREATE TABLE IF NOT EXISTS threat_model(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset TEXT NOT NULL,
  adversary TEXT NOT NULL,
  boundary TEXT NOT NULL,
  risk TEXT NOT NULL,
  mitigation TEXT NOT NULL,
  owner TEXT
);

CREATE TABLE IF NOT EXISTS security_reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  scope TEXT NOT NULL,
  findings TEXT,
  actions TEXT,
  reviewer TEXT
);

CREATE TABLE IF NOT EXISTS training(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  topic TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
);

CREATE TABLE IF NOT EXISTS compliance_calendar(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  obligation TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'Zimbabwe',
  authority TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN('upcoming','filed','overdue')),
  filed_at TEXT,
  notes TEXT
);

-- ── MSCS compliance register (609 controls — the checklist itself) ────────
CREATE TABLE IF NOT EXISTS controls(
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  floor TEXT NOT NULL,
  criticality TEXT NOT NULL,
  evidence_floor TEXT NOT NULL,
  applicability TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_wave TEXT,
  note TEXT,
  in_scope INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now')),
  evidence_note TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS evidence(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  control_ids_json TEXT NOT NULL DEFAULT '[]',
  class TEXT NOT NULL CHECK(class IN('E1','E2','E3','E4','E5','E6')),
  source TEXT NOT NULL,
  authority TEXT NOT NULL,
  observed TEXT,
  expected TEXT,
  captured_at TEXT DEFAULT (datetime('now')),
  captured_by TEXT,
  integrity_ref TEXT,
  validity TEXT DEFAULT 'current'
);

CREATE TABLE IF NOT EXISTS findings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  control_id TEXT NOT NULL,
  class TEXT NOT NULL CHECK(class IN('F-IMP','F-EVD','F-AUTH','F-ENV','F-POL','F-RSK')),
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','remediated','waived')),
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS certifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  environment TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN('PASS','PASS_WITH_CONDITIONS','FAIL')),
  score REAL,
  gates_json TEXT,
  issued_at TEXT DEFAULT (datetime('now')),
  valid_until TEXT,
  report_json TEXT
);

-- ── Content audit log (CMS-026 — publish/version/acceptance events) ───────
CREATE TABLE IF NOT EXISTS content_audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL,
  action TEXT NOT NULL,
  version INTEGER,
  actor TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

db.exec(DDL);

// ── Thin typed helpers over bun:sqlite (mirror comms-service) ────────────────

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

/** SQLite datetime('now') → ISO-8601 with Z (matches TrailBase timestamps). */
export function nowSqlite(): string {
  const ts = get<{ ts: string }>(`SELECT datetime('now') AS ts`)?.ts ?? "";
  return ts.replace(" ", "T") + "Z";
}
