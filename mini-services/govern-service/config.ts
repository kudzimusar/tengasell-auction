// govern-service configuration — port, db path, TrailBase admin access for
// DSAR export bundles, and the canonical MSCS worksheet path (controls import).

export const PORT = 3008;
export const DB_PATH =
  process.env.GOVERN_DB_PATH ?? "/home/z/my-project/db/govern.db";

/** TrailBase (Rust backend) — same env conventions as the trade engine. */
export const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Tengasell#2025";

/** Canonical 609-control MSCS conformance worksheet (12-plan artifact). */
export const WORKSHEET_PATH =
  process.env.MSCS_WORKSHEET_PATH ?? "/home/z/my-project/agent-ctx/mscs-worksheet-12.json";

/** Public app origin used in export manifest deep links. */
export const APP_URL = process.env.APP_URL ?? "http://localhost:81";

/** CDPA DSAR statutory response window (Zimbabwe Cyber & Data Protection Act). */
export const DSAR_DUE_DAYS = 30;
