// routes/decisions.ts — decision log / ADRs + governance document tables.
//
//   GET/POST/PATCH  /admin/decisions        ADR/DEC records (DOC-011/012)
//   GET             /admin/gov-docs         threat model + security reviews +
//                                           training in one payload (SEC-002/022/025)

import { HttpError, type AddRoute, bodyOptStr, bodyStr } from "../http";
import { all, get, insert, run, nowSqlite } from "../db";

export function registerDecisionRoutes(on: AddRoute): void {
  on("GET", "/admin/decisions", () => {
    const rows = all(
      `SELECT id, ref, title, context, decision, alternatives, consequences, decided_by, decided_at, status
       FROM decisions ORDER BY id DESC LIMIT 200`,
    );
    return { decisions: rows };
  });

  on("POST", "/admin/decisions", (ctx) => {
    ctx.requireAdmin();
    const ref = bodyStr(ctx, "ref", { required: true, max: 20 }).toUpperCase();
    const id = insert(
      `INSERT INTO decisions(ref, title, context, decision, alternatives, consequences, decided_by, decided_at, status)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        ref,
        bodyStr(ctx, "title", { required: true, max: 300 }),
        bodyOptStr(ctx, "context"),
        bodyStr(ctx, "decision", { required: true, max: 20_000 }),
        bodyOptStr(ctx, "alternatives"),
        bodyOptStr(ctx, "consequences"),
        ctx.user ?? "admin",
        bodyStr(ctx, "decided_at", { max: 30 }) || nowSqlite(),
        bodyStr(ctx, "status", { max: 20 }) || "accepted",
      ],
    );
    return { ok: true, id };
  });

  on("PATCH", "/admin/decisions", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT id FROM decisions WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `decision ${id} not found`, "not_found");
    run(
      `UPDATE decisions SET
         title = COALESCE(?, title), context = COALESCE(?, context), decision = COALESCE(?, decision),
         alternatives = COALESCE(?, alternatives), consequences = COALESCE(?, consequences),
         status = COALESCE(?, status)
       WHERE id = ?`,
      [
        bodyOptStr(ctx, "title"), bodyOptStr(ctx, "context"), bodyOptStr(ctx, "decision"),
        bodyOptStr(ctx, "alternatives"), bodyOptStr(ctx, "consequences"), bodyOptStr(ctx, "status"), id,
      ],
    );
    return { ok: true, id };
  });

  // ── governance documents bundle ──────────────────────────────────────────
  on("GET", "/admin/gov-docs", () => {
    const threatModel = all(
      `SELECT id, asset, adversary, boundary, risk, mitigation, owner FROM threat_model ORDER BY id`,
    );
    const securityReviews = all(
      `SELECT id, date, scope, findings, actions, reviewer FROM security_reviews ORDER BY date DESC`,
    );
    const training = all(
      `SELECT id, person, topic, date, status FROM training ORDER BY date DESC`,
    );
    return { threatModel, securityReviews, training };
  });
}
