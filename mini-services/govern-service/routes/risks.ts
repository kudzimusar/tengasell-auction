// routes/risks.ts — risk register + exceptions (RSK-001..010).
//
//   GET/POST/PATCH/DELETE /admin/risks            risks (score = likelihood × impact)
//   GET/POST/PATCH /admin/risk-exceptions         time-bounded exceptions (Template C)

import { HttpError, type AddRoute, bodyArr, bodyOptStr, bodyStr, parseJson } from "../http";
import { all, get, insert, run, scalar, nowSqlite } from "../db";

function serializeRisk(r: Record<string, unknown>) {
  return { ...r, controls: parseJson<string[]>(r.controls_json as string | null, []) };
}

export function registerRiskRoutes(on: AddRoute): void {
  on("GET", "/admin/risks", (ctx) => {
    const status = ctx.url.searchParams.get("status");
    const rows = all(
      `SELECT id, ref, title, category, likelihood, impact, score, owner, status, controls_json, review_due, notes
       FROM risks WHERE (? IS NULL OR status = ?) ORDER BY score DESC, id`,
      [status, status],
    );
    return { risks: rows.map(serializeRisk) };
  });

  on("POST", "/admin/risks", (ctx) => {
    ctx.requireAdmin();
    const likelihood = Math.min(5, Math.max(1, Number(bodyStr(ctx, "likelihood", { required: true })) || 3));
    const impact = Math.min(5, Math.max(1, Number(bodyStr(ctx, "impact", { required: true })) || 3));
    const controls = bodyArr(ctx, "controls").map((c) => String(c).slice(0, 20)).filter(Boolean);
    const ref = bodyOptStr(ctx, "ref") ?? `RSK-${String(scalar(`SELECT COUNT(*) FROM risks`) + 1).padStart(3, "0")}`;
    const id = insert(
      `INSERT INTO risks(ref, title, category, likelihood, impact, score, owner, status, controls_json, review_due, notes)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ref,
        bodyStr(ctx, "title", { required: true, max: 300 }),
        bodyStr(ctx, "category", { required: true, max: 60 }),
        likelihood,
        impact,
        likelihood * impact,
        bodyStr(ctx, "owner", { required: true, max: 60 }),
        bodyOptStr(ctx, "status") ?? "open",
        JSON.stringify(controls),
        bodyOptStr(ctx, "review_due"),
        bodyOptStr(ctx, "notes"),
      ],
    );
    return { ok: true, id };
  });

  on("PATCH", "/admin/risks", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT * FROM risks WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `risk ${id} not found`, "not_found");
    const likelihood = bodyOptStr(ctx, "likelihood")
      ? Math.min(5, Math.max(1, Number(bodyStr(ctx, "likelihood")) || 3))
      : (cur as { likelihood: number }).likelihood;
    const impact = bodyOptStr(ctx, "impact")
      ? Math.min(5, Math.max(1, Number(bodyStr(ctx, "impact")) || 3))
      : (cur as { impact: number }).impact;
    const controls = bodyArr(ctx, "controls");
    run(
      `UPDATE risks SET
         title = COALESCE(?, title), category = COALESCE(?, category),
         likelihood = ?, impact = ?, score = ?,
         owner = COALESCE(?, owner), status = COALESCE(?, status),
         controls_json = CASE WHEN ? = 1 THEN ? ELSE controls_json END,
         review_due = COALESCE(?, review_due), notes = COALESCE(?, notes)
       WHERE id = ?`,
      [
        bodyOptStr(ctx, "title"), bodyOptStr(ctx, "category"),
        likelihood, impact, likelihood * impact,
        bodyOptStr(ctx, "owner"), bodyOptStr(ctx, "status"),
        controls.length ? 1 : 0,
        controls.length ? JSON.stringify(controls.map((c) => String(c).slice(0, 20))) : null,
        bodyOptStr(ctx, "review_due"), bodyOptStr(ctx, "notes"), id,
      ],
    );
    const row = get(`SELECT * FROM risks WHERE id = ?`, [id]);
    return { ok: true, risk: serializeRisk(row as Record<string, unknown>) };
  });

  on("DELETE", "/admin/risks", (ctx) => {
    ctx.requireAdmin();
    const id = Number(ctx.url.searchParams.get("id") ?? "0");
    if (!id) throw new HttpError(400, "id query param required", "missing_field");
    run(`DELETE FROM risks WHERE id = ?`, [id]);
    return { ok: true, id };
  });

  // ── exceptions ───────────────────────────────────────────────────────────
  on("GET", "/admin/risk-exceptions", (ctx) => {
    const status = ctx.url.searchParams.get("status");
    const rows = all(
      `SELECT id, ref, affected_controls_json, reason, risk_statement, criticality,
              compensating_controls, owner, approved_by, expires_at, status
       FROM risk_exceptions WHERE (? IS NULL OR status = ?) ORDER BY id`,
      [status, status],
    );
    // auto-expire past-due active exceptions
    const now = nowSqlite();
    for (const r of rows) {
      if (r.status === "active" && r.expires_at && r.expires_at < now) {
        run(`UPDATE risk_exceptions SET status = 'expired' WHERE id = ?`, [r.id]);
        (r as { status: string }).status = "expired";
      }
    }
    return { exceptions: rows.map((r) => ({ ...r, affected_controls: parseJson<string[]>(r.affected_controls_json as string | null, []) })) };
  });

  on("POST", "/admin/risk-exceptions", (ctx) => {
    ctx.requireAdmin();
    const controls = bodyArr(ctx, "affected_controls").map((c) => String(c).slice(0, 20)).filter(Boolean);
    const ref = bodyOptStr(ctx, "ref") ?? `RSK-EX-${String(scalar(`SELECT COUNT(*) FROM risk_exceptions`) + 1).padStart(3, "0")}`;
    const id = insert(
      `INSERT INTO risk_exceptions(ref, affected_controls_json, reason, risk_statement, criticality, compensating_controls, owner, approved_by, expires_at, status)
       VALUES(?,?,?,?,?,?,?,?,?, 'active')`,
      [
        ref,
        JSON.stringify(controls),
        bodyStr(ctx, "reason", { required: true, max: 4000 }),
        bodyStr(ctx, "risk_statement", { required: true, max: 4000 }),
        bodyStr(ctx, "criticality", { max: 20 }) || "medium",
        bodyOptStr(ctx, "compensating_controls"),
        bodyStr(ctx, "owner", { required: true, max: 60 }),
        bodyOptStr(ctx, "approved_by"),
        bodyStr(ctx, "expires_at", { required: true, max: 12 }),
      ],
    );
    return { ok: true, id, ref };
  });

  on("PATCH", "/admin/risk-exceptions", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT id FROM risk_exceptions WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `exception ${id} not found`, "not_found");
    const controls = bodyArr(ctx, "affected_controls");
    run(
      `UPDATE risk_exceptions SET
         reason = COALESCE(?, reason), risk_statement = COALESCE(?, risk_statement),
         criticality = COALESCE(?, criticality), compensating_controls = COALESCE(?, compensating_controls),
         owner = COALESCE(?, owner), approved_by = COALESCE(?, approved_by),
         expires_at = COALESCE(?, expires_at), status = COALESCE(?, status),
         affected_controls_json = CASE WHEN ? = 1 THEN ? ELSE affected_controls_json END
       WHERE id = ?`,
      [
        bodyOptStr(ctx, "reason"), bodyOptStr(ctx, "risk_statement"), bodyOptStr(ctx, "criticality"),
        bodyOptStr(ctx, "compensating_controls"), bodyOptStr(ctx, "owner"), bodyOptStr(ctx, "approved_by"),
        bodyOptStr(ctx, "expires_at"), bodyOptStr(ctx, "status"),
        controls.length ? 1 : 0,
        controls.length ? JSON.stringify(controls.map((c) => String(c).slice(0, 20))) : null,
        id,
      ],
    );
    return { ok: true, id };
  });
}
