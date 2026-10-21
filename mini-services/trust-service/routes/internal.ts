// Internal endpoints (shared-secret header x-tgs-internal) consumed by the
// Next BFF platform wiring (Task 12-e) and sibling services (12-b finance):
//   GET  /internal/status?username= → suspension/roles/MFA gate payload
//   POST /internal/signin           → sign-in audit row (ok|mfa_failed|blocked)
//   POST /internal/recovery/start   → password recovery code (hashed at rest)
//   POST /internal/recovery/confirm → validate + consume the code
//   POST /internal/mfa/verify       → {ok, valid} sign-in MFA hand-off (12-e)
//   POST /internal/mfa/recovery-codes → mirror sha256 hashes (12-e custody)
//   POST /internal/enforcement      → suspend|restore (12-e users console)
//   POST /internal/roles            → role assign/revoke (12-e users console)
//
// Fail-open doctrine: /internal/status NEVER 500s — when the caller asks for
// an unknown username the payload reports the account as not suspended so a
// trust outage cannot lock the whole marketplace out (engine-down safety).

import { createHash } from "node:crypto";
import { HttpError, bodyStr, type AddRoute, type Ctx } from "../http";
import { get, insert, run, scalar } from "../db";
import { RECOVERY_TTL_MINUTES } from "../config";
import { generateRecoveryCode6, hashRecoveryCode, totpVerify } from "../totp";
import { isoPlusMs, nowIso } from "../util";
import { trustStatus, createEnforcementRow } from "../core";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function registerInternalRoutes(on: AddRoute): void {
  on("GET", "/internal/status", (ctx) => {
    ctx.requireInternal();
    const username = ctx.url.searchParams.get("username") ?? "";
    if (!username) throw new HttpError(400, "username query param required", "missing_field");
    return trustStatus(username);
  });

  // POST /internal/signin {username, ip?, ua?, status}
  on("POST", "/internal/signin", (ctx) => {
    ctx.requireInternal();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const status = bodyStr(ctx, "status", { required: true, max: 20 });
    if (!["ok", "mfa_failed", "blocked"].includes(status)) {
      throw new HttpError(400, "status must be ok|mfa_failed|blocked", "bad_field");
    }
    const ip = ctx.body?.ip != null ? String(ctx.body.ip).slice(0, 60) : null;
    const ua = ctx.body?.ua != null ? String(ctx.body.ua).slice(0, 300) : null;
    insert(`INSERT INTO signins(username, ip, ua, status, ts) VALUES(?,?,?,?,?)`, [
      username,
      ip,
      ua,
      status,
      nowIso(),
    ]);
    return { ok: true };
  });

  // POST /internal/recovery/start {username} → {code, expires_at}
  // The code is returned to the INTERNAL caller (12-e), which delivers it to
  // the user via comms — trust.db stores only the SHA-256 hash.
  on("POST", "/internal/recovery/start", (ctx) => {
    ctx.requireInternal();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const code = generateRecoveryCode6();
    const expiresAt = isoPlusMs(RECOVERY_TTL_MINUTES * 60_000);
    insert(`INSERT INTO password_resets(username, code_hash, expires_at, created_at) VALUES(?,?,?,?)`, [
      username,
      sha256(code),
      expiresAt,
      nowIso(),
    ]);
    return { code, expires_at: expiresAt };
  });

  // POST /internal/recovery/confirm {username, code} → {ok}
  on("POST", "/internal/recovery/confirm", (ctx) => {
    ctx.requireInternal();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const code = bodyStr(ctx, "code", { required: true, max: 20 });
    const row = get<{ id: number; expires_at: string; used_at: string | null }>(
      `SELECT id, expires_at, used_at FROM password_resets
       WHERE username = ? AND code_hash = ? ORDER BY id DESC LIMIT 1`,
      [username, sha256(code)],
    );
    if (!row) throw new HttpError(400, "invalid recovery code", "invalid_code");
    if (row.used_at) throw new HttpError(400, "recovery code already used", "code_used");
    if (Date.parse(row.expires_at) < Date.now()) {
      throw new HttpError(400, "recovery code expired", "code_expired");
    }
    run(`UPDATE password_resets SET used_at = ? WHERE id = ?`, [nowIso(), row.id]);
    const outstanding = scalar(
      `SELECT COUNT(*) AS n FROM password_resets WHERE username = ? AND used_at IS NULL AND expires_at > ?`,
      [username, nowIso()],
    );
    void outstanding;
    return { ok: true };
  });

  // ── 12-c resume: contract endpoints the 12-e platform BFF already calls
  // (src/lib/server/platform.ts + api/auth/mfa/verify + api/platform/admin
  // /users/[username]/{enforcement,role}). Additive only — fail-closed on
  // bad input, never 500s.

  // POST /internal/mfa/verify {username, code} → {ok, valid, reason?}
  // The sign-in hand-off (auth/mfa/verify path B) treats valid===true as the
  // ONLY success signal — everything else must be a 200 with valid:false.
  on("POST", "/internal/mfa/verify", (ctx) => {
    ctx.requireInternal();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const code = bodyStr(ctx, "code", { required: true, max: 24 });
    const row = get<{ secret: string; active: number }>(`SELECT secret, active FROM mfa WHERE username = ?`, [
      username,
    ]);
    if (!row || row.active !== 1) return { ok: true, valid: false, reason: "mfa_not_active" };
    if (totpVerify(row.secret, code)) return { ok: true, valid: true };
    const check = verifyMfaRecoveryCode(username, code);
    if (check) return { ok: true, valid: true, used_recovery_code: true };
    return { ok: true, valid: false, reason: "invalid_code" };
  });

  // POST /internal/mfa/recovery-codes {username, hashes[]} → {ok}
  // Mirror of the BFF's sha256-hashed recovery-code custody (best-effort by
  // the caller; we upsert so trust can validate hashed codes too).
  on("POST", "/internal/mfa/recovery-codes", (ctx) => {
    ctx.requireInternal();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const raw = ctx.body?.hashes;
    const hashes = Array.isArray(raw)
      ? raw.filter((h): h is string => typeof h === "string").slice(0, 24)
      : [];
    run(
      `INSERT INTO mfa_recovery_hashes(username, hashes, created_at) VALUES(?,?,?)
       ON CONFLICT(username) DO UPDATE SET hashes = excluded.hashes, created_at = excluded.created_at`,
      [username, JSON.stringify(hashes), nowIso()],
    );
    return { ok: true, stored: hashes.length };
  });

  // POST /internal/enforcement {username, action: suspend|restore, reason, actor}
  // → {ok, id, pending}. `suspend` maps to an open-ended suspension → CTL-021
  // DUAL APPROVAL (pending until a DIFFERENT admin approves); `restore` maps
  // to an immediate reinstate. The caller (12-e users console) surfaces the
  // pending flag so the admin sees the honest second-approval requirement.
  on("POST", "/internal/enforcement", (ctx) => {
    ctx.requireInternal();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const action = bodyStr(ctx, "action", { required: true, max: 20 });
    const reason = bodyStr(ctx, "reason", { required: true, max: 2000 });
    const actor = bodyStr(ctx, "actor", { required: true, max: 100 });

    if (action === "suspend") {
      const out = createEnforcementRow({
        username,
        action: "suspension",
        reason_code: reason.slice(0, 200),
        note: `Requested via Platform users console by ${actor}.`,
        days: null, // open-ended → dual approval by design (CTL-021)
        actor,
      });
      return { ok: true, id: out.id, pending: out.pending };
    }
    if (action === "restore") {
      const out = createEnforcementRow({
        username,
        action: "reinstate",
        reason_code: reason.slice(0, 200) || "restored_by_platform",
        note: `Restored via Platform users console by ${actor}.`,
        days: null,
        actor,
      });
      return { ok: true, id: out.id, pending: out.pending };
    }
    throw new HttpError(400, "action must be suspend|restore", "bad_field");
  });

  // POST /internal/roles {username, role, actor} → {ok}
  // role ∈ {admin, support, finance, moderator, compliance} upserts the RBAC
  // row; role "user" REVOKEs it (no special role) — matching the platform
  // console's vocabulary.
  on("POST", "/internal/roles", (ctx) => {
    ctx.requireInternal();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const role = bodyStr(ctx, "role", { required: true, max: 20 });
    const actor = bodyStr(ctx, "actor", { required: true, max: 100 });
    const SPECIAL = ["admin", "support", "finance", "moderator", "compliance"] as const;

    if (role === "user") {
      run(`DELETE FROM roles WHERE username = ?`, [username]);
      return { ok: true, revoked: true };
    }
    if (!(SPECIAL as readonly string[]).includes(role)) {
      throw new HttpError(400, `role must be user|${SPECIAL.join("|")}`, "bad_field");
    }
    run(
      `INSERT INTO roles(username, role, assigned_by, assigned_at, note) VALUES(?,?,?,?,?)
       ON CONFLICT(username) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by,
         assigned_at = excluded.assigned_at, note = excluded.note`,
      [username, role, actor, nowIso(), `Assigned via Platform users console by ${actor}.`],
    );
    return { ok: true, role };
  });
}

// ── shared recovery-code check (sha256-hashed list in mfa.recovery_codes since the v2 hardening +
// sha256-hashed mirror in mfa_recovery_hashes) ────────────────────────────

/** True (and consumes) when `code` matches a stored recovery-code hash. */
export function verifyMfaRecoveryCode(username: string, code: string): boolean {
  const normalized = code.trim().toUpperCase().replace(/\s+/g, "");
  const row = get<{ recovery_codes: string }>(`SELECT recovery_codes FROM mfa WHERE username = ?`, [
    username,
  ]);
  if (row) {
    let hashes: string[] = [];
    try {
      hashes = JSON.parse(row.recovery_codes ?? "[]");
    } catch {
      hashes = [];
    }
    // v2: compare the sha256 hash of the presented code against the stored
    // hashes; on match splice it out (single-use consumption, unchanged).
    const idx = hashes.indexOf(hashRecoveryCode(normalized));
    if (idx !== -1) {
      hashes.splice(idx, 1);
      run(`UPDATE mfa SET recovery_codes = ? WHERE username = ?`, [JSON.stringify(hashes), username]);
      return true;
    }
  }
  const hashed = get<{ hashes: string }>(`SELECT hashes FROM mfa_recovery_hashes WHERE username = ?`, [
    username,
  ]);
  if (hashed) {
    let hashes: string[] = [];
    try {
      hashes = JSON.parse(hashed.hashes ?? "[]");
    } catch {
      hashes = [];
    }
    const h = hashRecoveryCode(normalized);
    const idx = hashes.indexOf(h);
    if (idx !== -1) {
      hashes.splice(idx, 1);
      run(`UPDATE mfa_recovery_hashes SET hashes = ? WHERE username = ?`, [
        JSON.stringify(hashes),
        username,
      ]);
      return true;
    }
  }
  return false;
}
