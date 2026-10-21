// MFA (TOTP) endpoints — IAM-004 STATE. The UX is wired by Task 12-e through
// the BFF /api/trust/mfa/* routes; this module is the state authority.
//
//   POST /mfa/enroll    {—}                → {secret, otpauth_uri}   (x-tgs-user)
//   POST /mfa/activate  {code}             → {recovery_codes[]}     (x-tgs-user)
//   POST /mfa/verify    {username, code}   → {ok}                   (user/self, internal or admin)
//   POST /mfa/disable   {code}             → {ok}                   (x-tgs-user)
//   GET  /mfa/status    ?username=         → {enrolled, active}     (user/self, internal or admin)

import { HttpError, bodyStr, type AddRoute, type Ctx } from "../http";
import { get, run } from "../db";
import {
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  otpauthUri,
  totpVerify,
} from "../totp";
import { nowIso } from "../util";
import { trustStatus } from "../core";
import { audit } from "../trailbase";
import { verifyMfaRecoveryCode } from "./internal";

/** Caller may act on the username when they ARE the user, are internal, or admin. */
function mayActOn(ctx: Ctx, username: string): void {
  if (ctx.internal) return;
  if (ctx.admin) return;
  if (ctx.user && ctx.user === username) return;
  throw new HttpError(403, "you may only manage your own MFA", "forbidden");
}

export function registerMfaRoutes(on: AddRoute): void {
  on("POST", "/mfa/enroll", (ctx) => {
    const username = ctx.requireUser();
    const existing = get<{ active: number }>(`SELECT active FROM mfa WHERE username = ?`, [username]);
    if (existing?.active === 1) {
      throw new HttpError(400, "MFA is already active — disable it first", "already_active");
    }
    const secret = generateSecret();
    run(
      `INSERT INTO mfa(username, secret, active, recovery_codes, enrolled_at)
       VALUES(?,?,0,'[]',?)
       ON CONFLICT(username) DO UPDATE SET secret = excluded.secret, active = 0,
         recovery_codes = '[]', enrolled_at = excluded.enrolled_at`,
      [username, secret, nowIso()],
    );
    void audit(username, "mfa.enroll", "mfa", null, "trust", { username });
    return { secret, otpauth_uri: otpauthUri(username, secret) };
  });

  on("POST", "/mfa/activate", (ctx) => {
    const username = ctx.requireUser();
    const code = bodyStr(ctx, "code", { required: true, max: 12 });
    const row = get<{ secret: string; active: number }>(`SELECT secret, active FROM mfa WHERE username = ?`, [
      username,
    ]);
    if (!row) throw new HttpError(400, "enroll first", "not_enrolled");
    if (row.active === 1) throw new HttpError(400, "MFA already active", "already_active");
    if (!totpVerify(row.secret, code)) {
      throw new HttpError(400, "invalid TOTP code", "invalid_code");
    }
    const codes = generateRecoveryCodes();
    // v2 (MSCS control closure): persist ONLY sha256 hashes at rest; the
    // plaintext list is returned in this response EXACTLY ONCE (shown to
    // the user by 12-e, never stored anywhere).
    run(`UPDATE mfa SET active = 1, recovery_codes = ? WHERE username = ?`, [
      JSON.stringify(codes.map(hashRecoveryCode)),
      username,
    ]);
    void audit(username, "mfa.activate", "mfa", null, "trust", { username });
    return { recovery_codes: codes };
  });

  on("POST", "/mfa/verify", (ctx) => {
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const code = bodyStr(ctx, "code", { required: true, max: 12 });
    mayActOn(ctx, username);
    const row = get<{ secret: string; active: number; recovery_codes: string }>(
      `SELECT secret, active, recovery_codes FROM mfa WHERE username = ?`,
      [username],
    );
    if (!row || row.active !== 1) return { ok: false, reason: "mfa_not_active" };
    // Accept a TOTP code, a single-use recovery code (sha256-hashed at
    // rest in mfa.recovery_codes) or a hashed recovery code mirrored from
    // the BFF custody (12-e).
    if (totpVerify(row.secret, code)) return { ok: true };
    if (verifyMfaRecoveryCode(username, code)) return { ok: true, used_recovery_code: true };
    return { ok: false, reason: "invalid_code" };
  });

  on("POST", "/mfa/disable", (ctx) => {
    const username = ctx.requireUser();
    const code = bodyStr(ctx, "code", { required: true, max: 12 });
    const row = get<{ secret: string; active: number }>(`SELECT secret, active FROM mfa WHERE username = ?`, [
      username,
    ]);
    if (!row || row.active !== 1) throw new HttpError(400, "MFA is not active", "not_active");
    if (!totpVerify(row.secret, code)) {
      throw new HttpError(400, "invalid TOTP code", "invalid_code");
    }
    run(`UPDATE mfa SET active = 0 WHERE username = ?`, [username]);
    void audit(username, "mfa.disable", "mfa", null, "trust", { username });
    return { ok: true };
  });

  on("GET", "/mfa/status", (ctx) => {
    const username = ctx.url.searchParams.get("username") ?? ctx.user ?? "";
    if (!username) throw new HttpError(400, "username query param required", "missing_field");
    mayActOn(ctx, username);
    const row = get<{ secret: string; active: number }>(`SELECT secret, active FROM mfa WHERE username = ?`, [
      username,
    ]);
    return { enrolled: !!row, active: row?.active === 1 };
  });

  // GET /me/status — additive convenience for the BFF /api/trust/status
  // (the signed-in user's own suspension/roles/MFA state).
  on("GET", "/me/status", (ctx) => {
    const username = ctx.requireUser();
    return trustStatus(username);
  });
}
