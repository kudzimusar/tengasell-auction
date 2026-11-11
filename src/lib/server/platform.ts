// platform.ts — Tengasell platform BFF core (MSCS 12-e). SERVER-SIDE ONLY.
//
// Shared helpers for the /api/auth/* and /api/platform/* routes:
//   · multi-service fetch with hard timeouts (trust/finance/govern are built
//     CONCURRENTLY by 12-b/c/d — every call degrades gracefully, never throws)
//   · trust-service status lookups with the fail-open doctrine (suspension
//     gate fails OPEN when trust is down: sign-in stays possible, a throttled
//     warning is logged — engine-down safety per master contract §F)
//   · TrailBase _user reads/writes via node:sqlite (the records API on _user
//     is closed by TrailBase; the dev server runs under Node 24, so
//     node:sqlite DatabaseSync is the direct, honest path to main.db)
//   · TOTP (RFC 6238) verification against TrailBase's _user.totp_secret for
//     the admin step-up gate (IAM-010)
//   · recovery-code custody (sha256-hashed, db/mfa-recovery.json) — trust is
//     the intended authority (mirrored when up); the hashed file is the
//     documented v1 fallback while trust provisions
//   · feature flags (db/flags.json) + maintenance gate
//   · admin audit writer (TrailBase audit_events, source "admin")
//   · jose HS256 signed step-up cookies (ts_tgs_admin_mfa)
//   · CSV serialization for the export controls (CTL-025 / DAT-011)

import fs from "node:fs";
import path from "node:path";
import { openSqliteDb, type SqliteDb } from "./sqlite";
import {
  createHash,
  createHmac,
  randomInt,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { tbCreate, tbFetch, nowIso } from "./trailbase-admin";
import { resolveTrailBaseDataDirForBff, resolveVerifiedSession } from "./paynow-order";

// ── service endpoints (localhost only — the browser never sees ports) ──────

export const PORTS = {
  next: 3000,
  trailbase: 3001,
  engine: 3002,
  gis: 3004,
  comms: 3005,
  finance: 3006,
  trust: 3007,
  govern: 3008,
  gateway: 81,
} as const;

const base = (p: number) => `http://127.0.0.1:${p}`;
export const TRUST_BASE = process.env.TRUST_URL ?? base(PORTS.trust);
export const COMMS_BASE = process.env.COMMS_URL ?? base(PORTS.comms);
export const FINANCE_BASE = process.env.FINANCE_BASE ?? base(PORTS.finance);
export const GOVERN_BASE = process.env.GOVERN_BASE ?? base(PORTS.govern);

export const TRUST_TIMEOUT_MS = 2000;

export interface SvcResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
  error?: string;
}

/** One fetch against a mini-service with a hard timeout. Never throws. */
export async function svcFetch(
  port: number,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<SvcResult> {
  const { timeoutMs = 2500, ...rest } = init ?? {};
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(rest.headers ?? {}),
      },
    });
    let data: Record<string, unknown> | null = null;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON body (engine GET / returns JSON, gateway HTML) */
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "unreachable",
    };
  }
}

// ── trust-service contract (owner 12-c) — fail-open, throttled warning ─────
//
// GET  /internal/status?username=X → { suspended, suspension?, mfa_active, roles? }
// POST /internal/signin            { username, ip, ua, result }
// POST /internal/recovery/start    { username }         → { ok, code, sandbox? }
// POST /internal/recovery/confirm  { username, code }   → { ok, valid }
// POST /internal/mfa/verify        { username, code }   → { ok, valid }
// POST /internal/mfa/recovery-codes { username, hashes } (mirror, best-effort)

export interface TrustStatus {
  available: boolean;
  suspended: boolean;
  reason?: string;
  suspendedAt?: string;
  mfa_active: boolean;
  roles: string[];
}

let lastTrustWarn = 0;

/** Shared secret for internal service calls (lazy read, never hardcoded fallback). */
const internalSecret = (): string => (process.env.TGS_INTERNAL_SECRET ?? "").trim();

function internalHeaders(): Record<string, string> {
  const s = internalSecret();
  return s ? { "x-tgs-internal": s } : {};
}

export async function trustStatus(username: string): Promise<TrustStatus> {
  const res = await svcFetch(PORTS.trust, `/internal/status?username=${encodeURIComponent(username)}`, {
    timeoutMs: TRUST_TIMEOUT_MS,
    headers: internalHeaders(),
  });
  if (!res.ok || !res.data) {
    // FAIL-OPEN doctrine (master contract §F): trust unreachable → we do not
    // block sign-in. Throttle the console warning to once a minute.
    const now = Date.now();
    if (now - lastTrustWarn > 60_000) {
      lastTrustWarn = now;
      console.warn(
        `[platform] trust-service unavailable (status ${res.status}) — suspension/MFA status check failed OPEN for @${username}`,
      );
    }
    return { available: false, suspended: false, mfa_active: false, roles: [] };
  }
  const d = res.data;
  const suspension = (d.suspension ?? null) as Record<string, unknown> | null;
  return {
    available: true,
    suspended: d.suspended === true,
    reason: suspension ? String(suspension.reason ?? "") : undefined,
    suspendedAt: suspension ? String(suspension.at ?? "") : undefined,
    mfa_active: d.mfa_active === true,
    roles: Array.isArray(d.roles) ? (d.roles as string[]) : [],
  };
}

export async function trustPost(
  endpointPath: string,
  body: Record<string, unknown>,
  timeoutMs = TRUST_TIMEOUT_MS,
): Promise<SvcResult> {
  return svcFetch(PORTS.trust, endpointPath, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs,
    headers: internalHeaders(),
  });
}

/** Mirror sign-in activity to trust (fire-and-forget, best-effort). */
export function trustRecordSignin(input: {
  username: string;
  ip: string;
  ua: string;
  result: "ok" | "blocked";
}): void {
  // trust /internal/signin documents {username, ip, ua, status: ok|mfa_failed|blocked}
  void trustPost("/internal/signin", { ...input, status: input.result }).then((r) => {
    if (!r.ok && r.status !== 0) {
      console.warn(`[platform] trust /internal/signin mirror failed (${r.status})`);
    }
  });
}

// ── TrailBase _user access (node:sqlite — dev server runs under Node 24) ────
//
// TrailBase v0.35 exposes no records API on _user (GET → 405) and no admin
// password-set endpoint, so the platform BFF reads/writes main.db directly.
// The database is WAL-mode; readers and short writers coexist with the live
// TrailBase process (busy_timeout 5s). This is the documented admin-assisted
// path for recovery (BCP: hash transplant) and TOTP step-up verification.

function getProjectRoot(): string {
  return process.env.TGS_PROJECT_ROOT ? path.resolve(process.env.TGS_PROJECT_ROOT) : process.cwd();
}

function getDataRoot(): string {
  return process.env.TGS_DATA_DIR ? path.resolve(process.env.TGS_DATA_DIR) : getProjectRoot();
}

function getMainDbPath(): string {
  const dataDir = resolveTrailBaseDataDirForBff();
  if (dataDir) return path.join(dataDir, "main.db");
  return path.join(getProjectRoot(), "mini-services", "trailbase-db", "traildepot", "data", "main.db");
}

function getSessionDbPath(): string | null {
  const dataDir = resolveTrailBaseDataDirForBff();
  return dataDir ? path.join(dataDir, "session.db") : null;
}

function getRevocationsDbPath(): string | null {
  if (process.env.TGS_REVOCATIONS_DB) return process.env.TGS_REVOCATIONS_DB;
  const dataDir = resolveTrailBaseDataDirForBff();
  return dataDir ? path.join(dataDir, "tgs_revocations.db") : null;
}

const getTrailBaseUrl = () => process.env.TRAILBASE_URL ?? "http://localhost:3001";

/**
 * Persists a session/token/subject revocation in `tgs_revocations.db` (if available)
 * and notifies trade-engine `/internal/auth/revoke` so active sockets disconnect immediately.
 */
export async function revokeAuthSession(opts: {
  token?: string;
  sub?: string;
  username?: string;
  cutoffSec?: number;
}): Promise<void> {
  const nowMs = Date.now();
  const revPath = getRevocationsDbPath();
  if (revPath) {
    let db: SqliteDb | null = null;
    try {
      fs.mkdirSync(path.dirname(revPath), { recursive: true });
      db = openSqliteDb(revPath);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 3000;
        CREATE TABLE IF NOT EXISTS revoked_tokens (digest TEXT PRIMARY KEY, exp_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS revoked_subjects (subject_key TEXT PRIMARY KEY, cutoff_sec INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
      `);
      if (opts.token) {
        const digest = createHash("sha256").update(opts.token, "utf8").digest("hex");
        let expMs = nowMs + 86_400_000;
        try {
          const payloadPart = opts.token.split(".")[1];
          if (payloadPart) {
            const parsed = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
              exp?: unknown;
            };
            if (typeof parsed.exp === "number" && Number.isFinite(parsed.exp)) {
              expMs = parsed.exp * 1000;
            }
          }
        } catch {
          /* default 24h */
        }
        db.prepare(
          "INSERT INTO revoked_tokens (digest, exp_ms) VALUES (?, ?) ON CONFLICT(digest) DO UPDATE SET exp_ms = MAX(revoked_tokens.exp_ms, excluded.exp_ms)",
        ).run(digest, Math.trunc(expMs));
      }
      if (opts.sub || opts.username) {
        const cutoff = opts.cutoffSec ?? Math.floor(nowMs / 1000);
        if (opts.sub) {
          db.prepare(
            "INSERT INTO revoked_subjects (subject_key, cutoff_sec, updated_ms) VALUES (?, ?, ?) ON CONFLICT(subject_key) DO UPDATE SET cutoff_sec = MAX(revoked_subjects.cutoff_sec, excluded.cutoff_sec), updated_ms = excluded.updated_ms",
          ).run(`sub:${opts.sub}`, Math.trunc(cutoff), Math.trunc(nowMs));
        }
        if (opts.username) {
          db.prepare(
            "INSERT INTO revoked_subjects (subject_key, cutoff_sec, updated_ms) VALUES (?, ?, ?) ON CONFLICT(subject_key) DO UPDATE SET cutoff_sec = MAX(revoked_subjects.cutoff_sec, excluded.cutoff_sec), updated_ms = excluded.updated_ms",
          ).run(`user:${opts.username.toLowerCase()}`, Math.trunc(cutoff), Math.trunc(nowMs));
        }
      }
    } catch (err) {
      console.error("[platform] tgs_revocations.db write failed:", err);
    } finally {
      db?.close();
    }
  }

  const secret = internalSecret();
  if (!secret) return;
  await svcFetch(PORTS.engine, "/internal/auth/revoke", {
    method: "POST",
    timeoutMs: 2500,
    headers: { "x-tgs-internal": secret },
    body: JSON.stringify(opts),
  }).catch(() => {});
}

/** Read-only aggregate query helper against the live TrailBase db (12-e analytics). */
export function mainDbQuery<T>(sql: string, params: (string | number)[] = []): T[] {
  let db: SqliteDb | null = null;
  try {
    db = usersDb(true);
    return db.prepare(sql).all(...params) as T[];
  } catch (err) {
    console.error("[platform] main.db aggregate failed:", err);
    return [];
  } finally {
    db?.close();
  }
}

export interface UserRow {
  username: string;
  email: string | null;
  admin: boolean;
  has_totp: boolean;
  created: number; // unixepoch seconds
  id_hex: string;
}

function usersDb(readonly: boolean): SqliteDb {
  const db = openSqliteDb(getMainDbPath(), { readOnly: readonly });
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

export function findUserByUsername(username: string): UserRow | null {
  let db: SqliteDb | null = null;
  try {
    db = usersDb(true);
    const row = db
      .prepare(
        `SELECT username, email, admin, totp_secret IS NOT NULL AS has_totp, created, hex(id) AS id_hex
         FROM _user WHERE lower(username) = lower(?) LIMIT 1`,
      )
      .get(username) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      username: String(row.username),
      email: row.email == null ? null : String(row.email),
      admin: Number(row.admin) === 1,
      has_totp: Number(row.has_totp) === 1,
      created: Number(row.created),
      id_hex: String(row.id_hex).toLowerCase(),
    };
  } catch (err) {
    console.error("[platform] _user read failed:", err);
    return null;
  } finally {
    db?.close();
  }
}

export function searchUsers(q: string, limit = 40): UserRow[] {
  let db: SqliteDb | null = null;
  try {
    db = usersDb(true);
    const like = `%${q.toLowerCase()}%`;
    const rows = db
      .prepare(
        `SELECT username, email, admin, totp_secret IS NOT NULL AS has_totp, created, hex(id) AS id_hex
         FROM _user WHERE lower(username) LIKE ? ORDER BY admin DESC, username ASC LIMIT ?`,
      )
      .all(like, limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      username: String(row.username),
      email: row.email == null ? null : String(row.email),
      admin: Number(row.admin) === 1,
      has_totp: Number(row.has_totp) === 1,
      created: Number(row.created),
      id_hex: String(row.id_hex).toLowerCase(),
    }));
  } catch (err) {
    console.error("[platform] _user search failed:", err);
    return [];
  } finally {
    db?.close();
  }
}

export function countUsers(): number {
  let db: SqliteDb | null = null;
  try {
    db = usersDb(true);
    const row = db.prepare("SELECT COUNT(*) AS n FROM _user").get() as { n: number };
    return Number(row.n);
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

/**
 * Admin-assisted password set ("hash transplant", BCP-008 runbook step):
 * TrailBase computes the argon2id hash itself via a throwaway registration
 * with the NEW password; we copy the encoded hash into the target user's row
 * and delete the throwaway. Live-DB write, WAL, busy_timeout-guarded.
 */
export async function adminSetPassword(username: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  const scratch = "rcv" + randomBytes(5).toString("hex"); // 13 alnum chars
  const tbBase = getTrailBaseUrl();
  const reg = await fetch(`${tbBase}/api/auth/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: scratch, password: newPassword, password_repeat: newPassword }),
    signal: AbortSignal.timeout(8000),
  });
  if (!reg.ok) {
    return { ok: false, error: "TrailBase rejected the new password (min 8 characters)." };
  }
  // invalidate the scratch session TrailBase just issued (best effort)
  const regData = (await reg.json().catch(() => ({}))) as { auth_token?: string };
  if (regData.auth_token) {
    void fetch(`${tbBase}/api/auth/v1/logout`, {
      method: "GET",
      headers: { Authorization: `Bearer ${regData.auth_token}` },
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
  }
  let targetUserIdHex: string | null = null;
  let db: SqliteDb | null = null;
  try {
    db = usersDb(false);
    const scratchRow = db.prepare("SELECT password_hash FROM _user WHERE username = ?").get(scratch) as
      | { password_hash: string }
      | undefined;
    if (!scratchRow?.password_hash) return { ok: false, error: "Password hash could not be prepared." };
    const targetRow = db
      .prepare("SELECT hex(id) AS id_hex FROM _user WHERE lower(username) = lower(?) LIMIT 1")
      .get(username) as { id_hex?: string } | undefined;
    const res = db
      .prepare("UPDATE _user SET password_hash = ? WHERE lower(username) = lower(?)")
      .run(scratchRow.password_hash, username);
    if (res.changes === 0) return { ok: false, error: "Account not found." };
    db.prepare("DELETE FROM _user WHERE username = ?").run(scratch);
    targetUserIdHex = targetRow?.id_hex ? targetRow.id_hex.toLowerCase() : null;
  } catch (err) {
    console.error("[platform] password transplant failed:", err);
    return { ok: false, error: "Password update failed on the live database." };
  } finally {
    db?.close();
  }

  // Purge existing TrailBase _session rows for this user and revoke all active JWTs.
  let subB64: string | undefined;
  if (targetUserIdHex) {
    const uidBuf = Buffer.from(targetUserIdHex, "hex");
    subB64 = uidBuf.toString("base64");
    const sessPath = getSessionDbPath();
    if (sessPath && fs.existsSync(sessPath)) {
      let sdb: SqliteDb | null = null;
      try {
        sdb = openSqliteDb(sessPath);
        sdb.exec("PRAGMA busy_timeout=5000");
        sdb.prepare("DELETE FROM _session WHERE user = ?").run(new Uint8Array(uidBuf));
      } catch (err) {
        console.error("[platform] failed to purge _session rows after password reset:", err);
      } finally {
        sdb?.close();
      }
    }
  }
  await revokeAuthSession({
    sub: subB64,
    username,
    cutoffSec: Math.floor(Date.now() / 1000),
  });
  return { ok: true };
}

/** The engine writes audit `user` as the _user uuid base64 string — match it. */
export function userB64For(username: string): string | null {
  const u = findUserByUsername(username);
  return u ? Buffer.from(u.id_hex, "hex").toString("base64") : null;
}

// ── TOTP (RFC 6238) — verify against TrailBase's _user.totp_secret ─────────

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "")) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpAt(secretB32: string, offsetSteps = 0): string {
  const key = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 30_000) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const mac = createHmac("sha1", key).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const code =
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

/** Verify a 6-digit TOTP with a ±1 step (±30s) clock window. */
export function verifyTotp(secretB32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const target = Buffer.from(code);
  for (const off of [-1, 0, 1]) {
    const expect = Buffer.from(totpAt(secretB32, off));
    if (expect.length === target.length && timingSafeEqual(expect, target)) return true;
  }
  return false;
}

export function totpSecretFor(username: string): string | null {
  let db: SqliteDb | null = null;
  try {
    db = usersDb(true);
    const row = db
      .prepare("SELECT totp_secret FROM _user WHERE lower(username) = lower(?) LIMIT 1")
      .get(username) as { totp_secret: string | null } | undefined;
    return row?.totp_secret ?? null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

// ── recovery codes (hashed at rest; shown exactly once) ─────────────────────

const recoveryPath = () => path.join(getDataRoot(), "db", "mfa-recovery.json");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusables

export function generateRecoveryCodes(count = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const b = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    out.push(`${a}-${b}`);
  }
  return out;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function readRecoveryFile(): Record<string, { hashes: string[]; created: string; used: string[] }> {
  try {
    const rp = recoveryPath();
    if (!fs.existsSync(rp)) return {};
    return JSON.parse(fs.readFileSync(rp, "utf8"));
  } catch {
    return {};
  }
}

export function storeRecoveryCodes(username: string, codes: string[]): void {
  const rp = recoveryPath();
  fs.mkdirSync(path.dirname(rp), { recursive: true });
  const all = readRecoveryFile();
  all[username.toLowerCase()] = {
    hashes: codes.map((c) => sha256(c)),
    used: [],
    created: nowIso(),
  };
  fs.writeFileSync(rp, JSON.stringify(all, null, 2));
  // mirror to trust when it's up (trust = intended authority; file = v1 fallback)
  void trustPost("/internal/mfa/recovery-codes", {
    username,
    hashes: all[username.toLowerCase()].hashes,
  }).catch(() => {});
}

export function hasRecoveryCodes(username: string): boolean {
  const all = readRecoveryFile();
  const entry = all[username.toLowerCase()];
  return !!entry && entry.hashes.length > entry.used.length;
}

export function consumeRecoveryCode(username: string, code: string): boolean {
  const rp = recoveryPath();
  const all = readRecoveryFile();
  const key = username.toLowerCase();
  const entry = all[key];
  if (!entry) return false;
  const h = sha256(code.trim().toUpperCase());
  const idx = entry.hashes.indexOf(h);
  if (idx < 0 || entry.used.includes(h)) return false;
  entry.used.push(h);
  all[key] = entry;
  try {
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    fs.writeFileSync(rp, JSON.stringify(all, null, 2));
    return true;
  } catch {
    return false;
  }
}

export function purgeRecoveryCodes(username: string): void {
  const rp = recoveryPath();
  const all = readRecoveryFile();
  delete all[username.toLowerCase()];
  try {
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    fs.writeFileSync(rp, JSON.stringify(all, null, 2));
  } catch {
    /* ignore */
  }
}

// ── pending trust-owned MFA sessions (login → verify hand-off) ─────────────
//
// Only used when trust reports mfa_active but TrailBase itself did not
// challenge (12-c's trust-secret world): the TrailBase token is held
// server-side until trust /mfa/verify validates the code.

const pendingTrustMfa = new Map<string, { username: string; token: string; expiresAt: number }>();

export function putPendingTrustMfa(username: string, token: string): string {
  const id = randomBytes(16).toString("hex");
  pendingTrustMfa.set(id, { username, token, expiresAt: Date.now() + 5 * 60_000 });
  return id;
}

export function takePendingTrustMfa(id: string): { username: string; token: string } | null {
  const p = pendingTrustMfa.get(id);
  if (!p) return null;
  if (Date.now() > p.expiresAt) {
    pendingTrustMfa.delete(id);
    return null;
  }
  return p;
}

export function clearPendingTrustMfa(id: string): void {
  pendingTrustMfa.delete(id);
}

// ── pending recovery sessions (BFF fallback when trust is down) ────────────

interface PendingRecovery {
  hash: string;
  expiresAt: number;
  attempts: number;
}
const pendingRecoveries = new Map<string, PendingRecovery>();
const RECOVERY_TTL_MS = 15 * 60_000;

export function startPendingRecovery(username: string): string {
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  pendingRecoveries.set(username.toLowerCase(), {
    hash: sha256(code),
    expiresAt: Date.now() + RECOVERY_TTL_MS,
    attempts: 0,
  });
  return code;
}

export function checkPendingRecovery(username: string, code: string): { ok: boolean; error?: string } {
  const p = pendingRecoveries.get(username.toLowerCase());
  if (!p) return { ok: false, error: "No recovery code was requested, or it expired. Start again." };
  if (Date.now() > p.expiresAt) {
    pendingRecoveries.delete(username.toLowerCase());
    return { ok: false, error: "That recovery code expired. Start again." };
  }
  if (p.attempts >= 5) {
    pendingRecoveries.delete(username.toLowerCase());
    return { ok: false, error: "Too many attempts. Start the recovery again." };
  }
  if (sha256(String(code).trim()) !== p.hash) {
    p.attempts++;
    return { ok: false, error: "That code isn't right. Check the message we sent you." };
  }
  pendingRecoveries.delete(username.toLowerCase());
  return { ok: true };
}

export function recoveryPendingFor(username: string): boolean {
  const p = pendingRecoveries.get(username.toLowerCase());
  return !!p && Date.now() <= p.expiresAt;
}

// ── feature flags (db/flags.json — server-side only) ───────────────────────

export interface FlagDef {
  key: string;
  value: boolean;
  label: string;
  description: string;
  lastChangedBy?: string;
  lastChangedAt?: string;
  lastReason?: string;
}

const flagsPath = () => path.join(getDataRoot(), "db", "flags.json");

export const DEFAULT_FLAGS: FlagDef[] = [
  {
    key: "maintenance_mode",
    value: false,
    label: "Maintenance mode",
    description:
      "Freezes privileged platform mutations (suspend/takedown/relist/role) with 503 {maintenance:true}. v1 scope: platform admin APIs — user-visible banner is a documented follow-up.",
  },
  {
    key: "assistant_enabled",
    value: true,
    label: "AI assistant",
    description: "Tenga AI assistant availability switch (documented scope: platform consoles surface state).",
  },
  {
    key: "sell_enabled",
    value: true,
    label: "Selling",
    description: "New listing creation switch (documented scope: platform consoles surface state).",
  },
  {
    key: "payouts_enabled",
    value: true,
    label: "Payouts",
    description: "Seller payout requests switch (finance-service reads when 12-b lands; surfaced here).",
  },
  {
    key: "alerts_enabled",
    value: true,
    label: "Alerts",
    description: "Health-breach + operational alerts through the comms-service admin channel (OPS-009).",
  },
];

export function readFlags(): FlagDef[] {
  try {
    const fp = flagsPath();
    if (!fs.existsSync(fp)) return DEFAULT_FLAGS.map((f) => ({ ...f }));
    const stored = JSON.parse(fs.readFileSync(fp, "utf8")) as { flags?: FlagDef[] };
    const byKey = new Map((stored.flags ?? []).map((f) => [f.key, f]));
    return DEFAULT_FLAGS.map((d) => ({ ...d, ...(byKey.get(d.key) ?? {}) }));
  } catch {
    return DEFAULT_FLAGS.map((f) => ({ ...f }));
  }
}

export function flagValue(key: string): boolean {
  return readFlags().find((f) => f.key === key)?.value ?? false;
}

export function writeFlag(key: string, value: boolean, by: string, reason: string): FlagDef | null {
  const fp = flagsPath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const flags = readFlags();
  const f = flags.find((x) => x.key === key);
  if (!f) return null;
  f.value = value;
  f.lastChangedBy = by;
  f.lastChangedAt = nowIso();
  f.lastReason = reason;
  fs.writeFileSync(fp, JSON.stringify({ flags, updated_at: nowIso() }, null, 2));
  return f;
}

/** Maintenance gate for privileged platform mutations (CTL-022, v1 scope). */
export function maintenanceBlocked(): NextResponse | null {
  if (!flagValue("maintenance_mode")) return null;
  return NextResponse.json(
    {
      ok: false,
      maintenance: true,
      error: "Platform is in maintenance mode — privileged changes are frozen. Turn it off in Configuration.",
    },
    { status: 503 },
  );
}

// ── audit writer (TrailBase audit_events via admin token — engine mirror) ──

export async function writeAudit(input: {
  user?: string | null;
  action: string;
  entity: string;
  entityId?: number | null;
  source?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await tbCreate("audit_events", {
      user: input.user ?? null,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      source: input.source ?? "admin",
      payload: JSON.stringify(input.payload ?? {}),
      created_at: nowIso(),
    });
  } catch (err) {
    console.error("[platform] audit write failed:", err);
  }
}

// ── auth gates for the BFF routes ───────────────────────────────────────────

export interface GateUser {
  sub?: string;
  username: string;
  admin: boolean;
  mfa?: boolean;
  token: string;
}

export async function requireUser(req: NextRequest): Promise<GateUser | NextResponse> {
  const session = await resolveVerifiedSession(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
  }
  return session;
}

export async function requireAdmin(req: NextRequest): Promise<GateUser | NextResponse> {
  const session = await resolveVerifiedSession(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
  }
  if (!session.admin) {
    return NextResponse.json(
      { ok: false, error: "Admins only — this area is restricted." },
      { status: 403 },
    );
  }
  return session;
}

export function isResponse(x: GateUser | NextResponse): x is NextResponse {
  return x instanceof NextResponse;
}

// ── request context helpers ────────────────────────────────────────────────

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "127.0.0.1";
}

export function clientUa(req: NextRequest): string {
  return (req.headers.get("user-agent") ?? "unknown").slice(0, 180);
}

// ── admin step-up (IAM-010) — jose HS256 signed cookie ─────────────────────

export const STEPUP_COOKIE = "ts_tgs_admin_mfa";
export const STEPUP_MAX_AGE_SEC = 30 * 60; // re-verify every 30 minutes

let ephemeralStepupSecret: string | null = null;

const stepupSecret = (): string => {
  const env = (process.env.PLATFORM_JWT_SECRET ?? "").trim();
  if (env) return env;
  if (process.env.NODE_ENV === "production") {
    throw new Error("PLATFORM_JWT_SECRET environment variable is required");
  }
  ephemeralStepupSecret ??= randomBytes(32).toString("hex");
  return ephemeralStepupSecret;
};

export async function issueStepupToken(username: string): Promise<string> {
  return new SignJWT({ sub: username, typ: "tgs-admin-stepup" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STEPUP_MAX_AGE_SEC}s`)
    .sign(new TextEncoder().encode(stepupSecret()));
}

export async function readStepupToken(
  token: string | undefined,
): Promise<{ username: string; exp: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(stepupSecret()));
    if (payload.typ !== "tgs-admin-stepup" || typeof payload.sub !== "string") return null;
    return { username: payload.sub, exp: Number(payload.exp ?? 0) };
  } catch {
    return null;
  }
}

// ── TrailBase native-MFA status from a user's own JWT (mfa claim) ──────────

export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── CSV serialization (CTL-025 / DAT-011) ──────────────────────────────────

export function csvOf(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export function csvResponse(body: string, filename: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ── TrailBase list + count helper (records API, admin token) ────────────────

export async function tbListCount(
  collection: string,
  params: Record<string, string | number>,
): Promise<{ records: Record<string, unknown>[]; total: number }> {
  try {
    const res = await tbFetch(`/api/records/v1/${collection}`, { params: { ...params, count: "true" } });
    if (!res.ok) return { records: [], total: 0 };
    const data = (await res.json()) as { records?: Record<string, unknown>[]; total_count?: number };
    return { records: data.records ?? [], total: data.total_count ?? (data.records ?? []).length };
  } catch {
    return { records: [], total: 0 };
  }
}
