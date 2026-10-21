// routes/privacy.ts — Privacy Centre engine: DSAR queue + self-service.
//
// Admin:
//   GET  /admin/privacy-requests            queue (filters status/type/username)
//   POST /admin/privacy-requests/:id/verify|process|complete|reject
//   GET  /admin/export/:username            download the bundle JSON
//
// process  (access/portability) builds + stores the export bundle;
//          (deletion) refuses when an ACTIVE LEGAL HOLD exists;
//          (restriction) sets the processing-restriction flag + data-register note;
//          (objection) sets the objection flag (marketing unsub honoured via comms).
// complete (deletion) marks the account for deletion + lists retention exceptions.
//
// Me (x-tgs-user):
//   GET  /me/privacy                       my requests + acceptances + flags
//   GET/POST /me/privacy-requests          list / submit a request (30-day due)
//   GET  /me/export                        auto-creates access request → status,
//                                          or returns the completed bundle
//   GET  /me/policies                      accepted policy versions

import { HttpError, type AddRoute, bodyOptStr, bodyStr, parseJson } from "../http";
import { all, get, insert, run, scalar, nowSqlite } from "../db";
import { DSAR_DUE_DAYS } from "../config";
import { buildExportBundle } from "../export";

const TYPES = ["access", "correction", "deletion", "portability", "restriction", "objection"] as const;
type ReqType = (typeof TYPES)[number];

function isType(t: string): t is ReqType {
  return (TYPES as readonly string[]).includes(t);
}

function dueAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + DSAR_DUE_DAYS);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

function requireRequest(id: number) {
  const r = get<{
    id: number; username: string; type: ReqType; status: string; details_json: string | null;
    result_note: string | null; bundle_json: string | null; handled_by: string | null;
  }>(`SELECT * FROM privacy_requests WHERE id = ?`, [id]);
  if (!r) throw new HttpError(404, `privacy request ${id} not found`, "not_found");
  return r;
}

function activeHold(username: string): { reason: string; case_ref: string | null } | null {
  const hold = get<{ reason: string; case_ref: string | null }>(
    `SELECT reason, case_ref FROM legal_holds WHERE username = ? AND lifted_at IS NULL ORDER BY id DESC`,
    [username],
  );
  return hold ?? null;
}

function appendDataRegisterNote(note: string): void {
  const row = get<{ id: number; processing_notes: string | null }>(
    `SELECT id, processing_notes FROM data_register WHERE store LIKE 'trailbase: profiles' LIMIT 1`,
  );
  if (!row) return;
  const combined = `${row.processing_notes ? row.processing_notes + " | " : ""}${note}`;
  run(`UPDATE data_register SET processing_notes = ? WHERE id = ?`, [combined, row.id]);
}

function serializeRequest(r: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...r };
  out.details = parseJson<unknown>(r.details_json as string | null, null);
  delete out.details_json;
  delete out.bundle_json;
  return out;
}

export function registerPrivacyRoutes(on: AddRoute): void {
  // ── admin queue ──────────────────────────────────────────────────────────
  on("GET", "/admin/privacy-requests", (ctx) => {
    const status = ctx.url.searchParams.get("status");
    const type = ctx.url.searchParams.get("type");
    const username = ctx.url.searchParams.get("username");
    const rows = all(
      `SELECT id, username, type, status, details_json, result_note, handled_by, due_at, created_at, completed_at,
              (bundle_json IS NOT NULL) AS has_bundle
       FROM privacy_requests
       WHERE (? IS NULL OR status = ?) AND (? IS NULL OR type = ?) AND (? IS NULL OR username = ?)
       ORDER BY id DESC LIMIT 500`,
      [status, status, type, type, username, username],
    );
    return {
      requests: rows.map((r) => ({
        ...serializeRequest(r),
        has_bundle: Number((r as { has_bundle: number }).has_bundle) === 1,
      })),
      count: rows.length,
    };
  });

  // ── admin actions ────────────────────────────────────────────────────────
  on("POST", "/admin/privacy-requests/:id/verify", (ctx) => {
    ctx.requireAdmin();
    const r = requireRequest(Number(ctx.params.id));
    if (r.status !== "received") throw new HttpError(409, `request is ${r.status}`, "status_conflict");
    run(
      `UPDATE privacy_requests SET status = 'verifying', handled_by = ?, result_note = COALESCE(?, result_note) WHERE id = ?`,
      [ctx.user ?? "admin", bodyOptStr(ctx, "note"), r.id],
    );
    return { ok: true, id: r.id, status: "verifying" };
  });

  on("POST", "/admin/privacy-requests/:id/process", async (ctx) => {
    ctx.requireAdmin();
    const by = ctx.user ?? "admin";
    const r = requireRequest(Number(ctx.params.id));
    if (r.status !== "verifying" && r.status !== "received") {
      throw new HttpError(409, `request is ${r.status} — verify before processing`, "status_conflict");
    }
    let note = bodyOptStr(ctx, "note");

    if (r.type === "access" || r.type === "portability") {
      const bundle = await buildExportBundle(r.username);
      run(
        `UPDATE privacy_requests SET status = 'in_progress', handled_by = ?, bundle_json = ?, result_note = COALESCE(?, 'Export bundle built and ready for download.') WHERE id = ?`,
        [by, JSON.stringify(bundle), note, r.id],
      );
      return { ok: true, id: r.id, status: "in_progress", bundle_ready: true };
    }

    if (r.type === "deletion") {
      const hold = activeHold(r.username);
      if (hold) {
        throw new HttpError(
          409,
          `LEGAL HOLD ACTIVE for @${r.username}: ${hold.reason}${hold.case_ref ? ` (case ${hold.case_ref})` : ""} — deletion cannot proceed until the hold is lifted.`,
          "legal_hold",
        );
      }
      run(
        `UPDATE privacy_requests SET status = 'in_progress', handled_by = ?, result_note = COALESCE(?, 'Identity verified; account marked for deletion on completion. Retention exceptions will be listed on completion.') WHERE id = ?`,
        [by, note, r.id],
      );
      return { ok: true, id: r.id, status: "in_progress" };
    }

    if (r.type === "restriction") {
      run(
        `INSERT INTO user_flags(username, flag, note, request_id, created_at, created_by)
         VALUES(?, 'restricted', ?, ?, ?, ?)`,
        [r.username, note ?? "Processing restricted at data subject request (CDPA right to restriction).", r.id, nowSqlite(), by],
      );
      appendDataRegisterNote(`processing restricted for @${r.username} (${nowSqlite().slice(0, 10)})`);
      run(
        `UPDATE privacy_requests SET status = 'in_progress', handled_by = ?, result_note = COALESCE(?, 'Processing restriction flag set; data register annotated.') WHERE id = ?`,
        [by, note, r.id],
      );
      return { ok: true, id: r.id, status: "in_progress", restricted: true };
    }

    if (r.type === "objection") {
      run(
        `INSERT INTO user_flags(username, flag, note, request_id, created_at, created_by)
         VALUES(?, 'objected', ?, ?, ?, ?)`,
        [r.username, note ?? "Objection recorded; marketing processing stopped (suppression honoured via comms).", r.id, nowSqlite(), by],
      );
      run(
        `UPDATE privacy_requests SET status = 'in_progress', handled_by = ?, result_note = COALESCE(?, 'Objection flag set; the user is removed from marketing audiences (comms suppression) and notified.') WHERE id = ?`,
        [by, note, r.id],
      );
      return { ok: true, id: r.id, status: "in_progress" };
    }

    // correction
    run(
      `UPDATE privacy_requests SET status = 'in_progress', handled_by = ?, result_note = COALESCE(?, 'Correction reviewed — profile fields are self-service in My Tengasell; admin-assisted corrections applied where requested.') WHERE id = ?`,
      [by, note, r.id],
    );
    return { ok: true, id: r.id, status: "in_progress" };
  });

  on("POST", "/admin/privacy-requests/:id/complete", (ctx) => {
    ctx.requireAdmin();
    const by = ctx.user ?? "admin";
    const r = requireRequest(Number(ctx.params.id));
    if (r.status !== "in_progress") {
      throw new HttpError(409, `request is ${r.status} — process before completing`, "status_conflict");
    }
    let resultNote = bodyOptStr(ctx, "note");
    let extra: Record<string, unknown> = {};

    if (r.type === "deletion") {
      const hold = activeHold(r.username);
      if (hold) {
        throw new HttpError(
          409,
          `LEGAL HOLD ACTIVE for @${r.username}: ${hold.reason} — deletion cannot be completed until the hold is lifted.`,
          "legal_hold",
        );
      }
      run(
        `INSERT INTO user_flags(username, flag, note, request_id, created_at, created_by)
         VALUES(?, 'deletion_marked', ?, ?, ?, ?)`,
        [r.username, "Account deletion completed — account marked; actives purged per data register retention.", r.id, nowSqlite(), by],
      );
      appendDataRegisterNote(`account deletion completed for @${r.username} (${nowSqlite().slice(0, 10)}) — retention exceptions apply`);
      const retentionExceptions = [
        "orders + payments retained 7 years (tax law — Value Added Tax Act [Chapter 23:12])",
        "fee, invoice and VAT ledger records retained 7 years (tax law)",
        "audit + security logs retained 12 months (security/legal obligation)",
        "dispute and moderation evidence retained 3 years (Consumer Protection Act [Chapter 14:44] claims)",
        "policy acceptance records retained 7 years (legal proof of agreed terms)",
        "any active legal hold (overrides deletion for its duration)",
      ];
      resultNote =
        resultNote ??
        "Account deletion completed. Personal data removed from active systems; the following categories are retained as legally required.";
      extra = { retention_exceptions: retentionExceptions };
      resultNote = `${resultNote} Exceptions: ${retentionExceptions.join("; ")}.`;
    }

    run(
      `UPDATE privacy_requests SET status = 'completed', handled_by = ?, completed_at = ?, result_note = ? WHERE id = ?`,
      [by, nowSqlite(), resultNote ?? "Completed.", r.id],
    );
    return { ok: true, id: r.id, status: "completed", ...extra };
  });

  on("POST", "/admin/privacy-requests/:id/reject", (ctx) => {
    ctx.requireAdmin();
    const r = requireRequest(Number(ctx.params.id));
    if (r.status === "completed" || r.status === "rejected") {
      throw new HttpError(409, `request is ${r.status}`, "status_conflict");
    }
    const reason = bodyStr(ctx, "note", { required: true, max: 2000 });
    run(
      `UPDATE privacy_requests SET status = 'rejected', handled_by = ?, completed_at = ?, result_note = ? WHERE id = ?`,
      [ctx.user ?? "admin", nowSqlite(), reason, r.id],
    );
    return { ok: true, id: r.id, status: "rejected" };
  });

  // ── admin bundle download ────────────────────────────────────────────────
  on("GET", "/admin/export/:username", async (ctx) => {
    ctx.requireAdmin();
    const username = ctx.params.username;
    const row = get<{ bundle_json: string | null; id: number }>(
      `SELECT bundle_json, id FROM privacy_requests
       WHERE username = ? AND type IN('access','portability') AND bundle_json IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [username],
    );
    if (row?.bundle_json) {
      return {
        username,
        request_id: row.id,
        cached: true,
        bundle: JSON.parse(row.bundle_json),
      };
    }
    const bundle = await buildExportBundle(username);
    return { username, cached: false, bundle };
  });

  // ── me: privacy dashboard ────────────────────────────────────────────────
  on("GET", "/me/privacy", (ctx) => {
    const username = ctx.requireUser();
    const requests = all(
      `SELECT id, type, status, details_json, result_note, handled_by, due_at, created_at, completed_at
       FROM privacy_requests WHERE username = ? ORDER BY id DESC LIMIT 50`,
      [username],
    );
    const acceptances = all(
      `SELECT policy_key, version, accepted_at, surface FROM policy_acceptances
       WHERE username = ? ORDER BY id DESC LIMIT 100`,
      [username],
    );
    const flags = all(
      `SELECT flag, note, created_at, lifted_at FROM user_flags WHERE username = ? AND lifted_at IS NULL`,
      [username],
    );
    return {
      username,
      requests: requests.map(serializeRequest),
      acceptances,
      active_flags: flags,
    };
  });

  on("GET", "/me/privacy-requests", (ctx) => {
    const username = ctx.requireUser();
    const rows = all(
      `SELECT id, type, status, details_json, result_note, due_at, created_at, completed_at
       FROM privacy_requests WHERE username = ? ORDER BY id DESC LIMIT 50`,
      [username],
    );
    return { requests: rows.map(serializeRequest) };
  });

  on("POST", "/me/privacy-requests", (ctx) => {
    const username = ctx.requireUser();
    const type = bodyStr(ctx, "type", { required: true, max: 20 });
    if (!isType(type)) throw new HttpError(400, `type must be one of: ${TYPES.join(", ")}`, "bad_type");
    const details = bodyOptStr(ctx, "details");
    const open = scalar(
      `SELECT COUNT(*) FROM privacy_requests WHERE username = ? AND type = ? AND status NOT IN('completed','rejected')`,
      [username, type],
    );
    if (open > 0) {
      throw new HttpError(409, `you already have an open ${type} request`, "duplicate_request");
    }
    const id = insert(
      `INSERT INTO privacy_requests(username, type, status, details_json, due_at, created_at)
       VALUES(?,?,'received',?,?,?)`,
      [username, type, details ? JSON.stringify({ note: details }) : null, dueAt(), nowSqlite()],
    );
    return { ok: true, id, type, status: "received", due_at: dueAt() };
  });

  on("GET", "/me/export", async (ctx) => {
    const username = ctx.requireUser();
    const completed = get<{ id: number; bundle_json: string | null }>(
      `SELECT id, bundle_json FROM privacy_requests
       WHERE username = ? AND type IN('access','portability') AND status = 'completed' AND bundle_json IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [username],
    );
    if (completed?.bundle_json) {
      return { status: "completed", request_id: completed.id, bundle: JSON.parse(completed.bundle_json) };
    }
    const inflight = get<{ id: number; status: string; due_at: string }>(
      `SELECT id, status, due_at FROM privacy_requests
       WHERE username = ? AND type IN('access','portability') AND status NOT IN('completed','rejected')
       ORDER BY id DESC LIMIT 1`,
      [username],
    );
    if (inflight) {
      return {
        status: inflight.status,
        request_id: inflight.id,
        due_at: inflight.due_at,
        message: "Your data export request is in progress — we will complete it within 30 days. This page will offer the download once it is ready.",
      };
    }
    const id = insert(
      `INSERT INTO privacy_requests(username, type, status, details_json, due_at, created_at)
       VALUES(?,'access','received',?,?,?)`,
      [username, JSON.stringify({ note: "Self-service export requested from Privacy Centre." }), dueAt(), nowSqlite()],
    );
    return {
      status: "received",
      request_id: id,
      due_at: dueAt(),
      message: "Export request created — an operator verifies and builds your bundle (within 30 days).",
    };
  });

  on("GET", "/me/policies", (ctx) => {
    const username = ctx.requireUser();
    const rows = all(
      `SELECT policy_key, version, accepted_at, surface FROM policy_acceptances
       WHERE username = ? ORDER BY id DESC LIMIT 100`,
      [username],
    );
    return { acceptances: rows };
  });
}
