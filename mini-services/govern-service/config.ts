// govern-service configuration — port, db path, TrailBase admin access for
// DSAR export bundles, and the canonical MSCS worksheet path (controls import).

import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = process.env.TGS_PROJECT_ROOT
  ? path.resolve(process.env.TGS_PROJECT_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = process.env.TGS_DATA_DIR
  ? path.resolve(process.env.TGS_DATA_DIR)
  : PROJECT_ROOT;

export const PORT = 3008;
export const DB_PATH =
  process.env.GOVERN_DB_PATH ?? path.join(DATA_ROOT, "db", "govern.db");

/** TrailBase (Rust backend) — same env conventions as the trade engine. */
export const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

/** Canonical 609-control MSCS conformance worksheet (12-plan artifact). */
export const WORKSHEET_PATH =
  process.env.MSCS_WORKSHEET_PATH ??
  path.join(PROJECT_ROOT, "agent-ctx", "mscs-worksheet-12.json");

/** Public app origin used in export manifest deep links. */
export const APP_URL = process.env.APP_URL ?? "http://localhost:81";

/** CDPA DSAR statutory response window (Zimbabwe Cyber & Data Protection Act). */
export const DSAR_DUE_DAYS = 30;
