// routes/legal.ts — lawful requests, IP takedowns, subpoenas + legal holds.
//
//   GET/POST/PATCH /admin/legal-requests     request log with minimisation notes
//   GET/POST /admin/legal-holds              holds (block DSAR deletion while active)
//   POST  /admin/legal-holds/:id/lift        lift a hold

import { HttpError, type AddRoute, bodyArr, bodyOptStr, bodyStr, parseJson } from "../http";
import { all, get, insert, run, nowSqlite } from "../db";

interface ResponseLogEntry { ts: string; action: string; by: string; note?: string }

function serializeRequest(r: Record<string, unknown>) {
  return { ...r, response_log: parseJson<ResponseLogEntry[]>(r.response_log_json as string | null, []) };
}

export function registerLegalRoutes(on: AddRoute): void {
  on("GET", "/admin/legal-requests", (ctx) => {
    const status = ctx.url.searchParams.get("status");
    const rows = all(
      `SELECT id, type, requester, scope, received_at, status, legal_review_by, minimisation_note, response_log_json
       FROM legal_requests WHERE (? IS NULL OR status = ?) ORDER BY id DESC LIMIT 200`,
      [status, status],
    );
    return { requests: rows.map(serializeRequest) };
  });

  on("POST", "/admin/legal-requests", (ctx) => {
    ctx.requireAdmin();
    const type = bodyStr(ctx, "type", { required: true, max: 30 });
    if (!["lawful_request", "ip_takedown", "subpoena"].includes(type)) {
      throw new HttpError(400, "type must be lawful_request|ip_takedown|subpoena", "bad_field");
    }
    const id = insert(
      `INSERT INTO legal_requests(type, requester, scope, received_at, status, legal_review_by, minimisation_note, response_log_json)
       VALUES(?,?,?,?, 'received', ?, ?, '[]')`,
      [
        type,
        bodyStr(ctx, "requester", { required: true, max: 200 }),
        bodyStr(ctx, "scope", { required: true, max: 4000 }),
        bodyStr(ctx, "received_at", { max: 30 }) || nowSqlite(),
        bodyOptStr(ctx, "legal_review_by"),
        bodyOptStr(ctx, "minimisation_note") ??
          "Disclose only the data and accounts the order covers; log every disclosure.",
      ],
    );
    return { ok: true, id };
  });

  on("PATCH", "/admin/legal-requests", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT * FROM legal_requests WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `legal request ${id} not found`, "not_found");
    const status = bodyOptStr(ctx, "status");
    if (status && !["received", "under_review", "actioned", "rejected", "closed"].includes(status)) {
      throw new HttpError(400, "bad status", "bad_field");
    }
    run(
      `UPDATE legal_requests SET
         status = COALESCE(?, status), legal_review_by = COALESCE(?, legal_review_by),
         minimisation_note = COALESCE(?, minimisation_note)
       WHERE id = ?`,
      [status, bodyOptStr(ctx, "legal_review_by"), bodyOptStr(ctx, "minimisation_note"), id],
    );
    const note = bodyOptStr(ctx, "note");
    if (status || note) {
      const log = parseJson<ResponseLogEntry[]>((cur as { response_log_json: string }).response_log_json, []);
      log.push({
        ts: nowSqlite(),
        action: status ?? "note",
        by: ctx.user ?? "admin",
        ...(note ? { note } : {}),
      });
      run(`UPDATE legal_requests SET response_log_json = ? WHERE id = ?`, [JSON.stringify(log), id]);
    }
    const row = get(`SELECT * FROM legal_requests WHERE id = ?`, [id]);
    return { ok: true, request: serializeRequest(row as Record<string, unknown>) };
  });

  // ── legal holds ──────────────────────────────────────────────────────────
  on("GET", "/admin/legal-holds", (ctx) => {
    const username = ctx.url.searchParams.get("username");
    const rows = all(
      `SELECT id, username, reason, case_ref, created_by, created_at, lifted_at
       FROM legal_holds WHERE (? IS NULL OR username = ?) ORDER BY id DESC LIMIT 200`,
      [username, username],
    );
    return { holds: rows };
  });

  on("POST", "/admin/legal-holds", (ctx) => {
    ctx.requireAdmin();
    const username = bodyStr(ctx, "username", { required: true, max: 60 });
    const active = get(`SELECT id FROM legal_holds WHERE username = ? AND lifted_at IS NULL`, [username]);
    if (active) throw new HttpError(409, `an active hold already exists for @${username}`, "duplicate_hold");
    const id = insert(
      `INSERT INTO legal_holds(username, reason, case_ref, created_by, created_at)
       VALUES(?,?,?,?,?)`,
      [
        username,
        bodyStr(ctx, "reason", { required: true, max: 2000 }),
        bodyOptStr(ctx, "case_ref"),
        ctx.user ?? "admin",
        nowSqlite(),
      ],
    );
    return { ok: true, id, username, blocks_deletion: true };
  });

  on("POST", "/admin/legal-holds/:id/lift", (ctx) => {
    ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const cur = get(`SELECT * FROM legal_holds WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `hold ${id} not found`, "not_found");
    if ((cur as { lifted_at: string | null }).lifted_at) {
      throw new HttpError(409, "hold already lifted", "status_conflict");
    }
    run(`UPDATE legal_holds SET lifted_at = ? WHERE id = ?`, [nowSqlite(), id]);
    return { ok: true, id, lifted: true };
  });
}
