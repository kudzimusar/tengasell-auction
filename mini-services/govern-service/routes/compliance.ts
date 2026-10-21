// routes/compliance.ts — the MSCS compliance register (609 controls) +
// evidence manifest + findings + certification records + console stats.
//
//   GET   /admin/controls?domain=&status=&applicability=&q=&page=&limit=
//   GET   /admin/controls/summary      counts by status/applicability/domain
//   GET   /admin/controls/export       worksheet CSV download
//   POST  /admin/controls/import       re-import from worksheet JSON (idempotent)
//   PATCH /admin/controls/:id          {status, evidence_note, updated_by}
//   GET/POST/PATCH /admin/evidence     evidence rows (E1..E6)
//   GET/POST/PATCH /admin/findings     findings (F-IMP..F-RSK)
//   GET/POST /admin/certifications     certification records
//   GET   /admin/stats                 governance console overview numbers

import { HttpError, type AddRoute, bodyArr, bodyOptStr, bodyStr, parseJson } from "../http";
import { all, get, insert, run, scalar, nowSqlite } from "../db";
import { importControls } from "../seed";

export function registerComplianceRoutes(on: AddRoute): void {
  // NOTE: specific routes registered BEFORE the /:id PATCH so they win.

  on("GET", "/admin/controls/summary", () => {
    const byStatus = all<{ status: string; n: number }>(
      `SELECT status, COUNT(*) AS n FROM controls GROUP BY status ORDER BY status`,
    );
    const byApplicability = all<{ applicability: string; n: number }>(
      `SELECT applicability, COUNT(*) AS n FROM controls GROUP BY applicability ORDER BY applicability`,
    );
    const byDomain = all<{ domain: string; n: number }>(
      `SELECT domain, COUNT(*) AS n FROM controls GROUP BY domain ORDER BY domain`,
    );
    const byCriticality = all<{ criticality: string; n: number }>(
      `SELECT criticality, COUNT(*) AS n FROM controls GROUP BY criticality ORDER BY criticality`,
    );
    const total = scalar(`SELECT COUNT(*) FROM controls`);
    const inScope = scalar(`SELECT COUNT(*) FROM controls WHERE in_scope = 1`);
    return {
      total,
      in_scope: inScope,
      by_status: byStatus,
      by_applicability: byApplicability,
      by_domain: byDomain,
      by_criticality: byCriticality,
      generated_at: nowSqlite(),
    };
  });

  on("GET", "/admin/controls/export", () => {
    const rows = all(
      `SELECT id, domain, name, floor, criticality, evidence_floor, applicability, status, owner_wave, note, in_scope, evidence_note, updated_by, updated_at
       FROM controls ORDER BY domain, id`,
    );
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "id,domain,name,floor,criticality,evidence_floor,applicability,status,owner_wave,note,in_scope,evidence_note,updated_by,updated_at";
    const lines = [header];
    for (const r of rows) {
      lines.push(
        [
          r.id, r.domain, r.name, r.floor, r.criticality, r.evidence_floor,
          r.applicability, r.status, r.owner_wave, r.note,
          Number(r.in_scope) === 1 ? "1" : "0",
          r.evidence_note, r.updated_by, r.updated_at,
        ].map(esc).join(","),
      );
    }
    return { csv: lines.join("\n"), count: rows.length };
  });

  on("POST", "/admin/controls/import", (ctx) => {
    ctx.requireAdmin();
    const count = importControls();
    return { ok: true, controls: count, message: `Worksheet import complete — ${count} controls (idempotent upsert; admin-set statuses/evidence preserved).` };
  });

  on("GET", "/admin/controls", (ctx) => {
    const domain = ctx.url.searchParams.get("domain");
    const status = ctx.url.searchParams.get("status");
    const applicability = ctx.url.searchParams.get("applicability");
    const criticality = ctx.url.searchParams.get("criticality");
    const q = ctx.url.searchParams.get("q");
    const page = Math.max(1, Number(ctx.url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(200, Math.max(10, Number(ctx.url.searchParams.get("limit") ?? "50") || 50));

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (domain) { where.push("domain = ?"); params.push(domain); }
    if (status) { where.push("status = ?"); params.push(status); }
    if (applicability) { where.push("applicability = ?"); params.push(applicability); }
    if (criticality) { where.push("criticality = ?"); params.push(criticality); }
    if (q) {
      where.push("(id LIKE ? OR name LIKE ? COLLATE NOCASE OR note LIKE ? COLLATE NOCASE)");
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = scalar(`SELECT COUNT(*) FROM controls ${whereSql}`, params);
    const rows = all(
      `SELECT id, domain, name, floor, criticality, evidence_floor, applicability, status, owner_wave, note, in_scope, evidence_note, updated_by, updated_at
       FROM controls ${whereSql}
       ORDER BY domain, id
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );
    return {
      controls: rows,
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  });

  on("PATCH", "/admin/controls/:id", (ctx) => {
    ctx.requireAdmin();
    const id = ctx.params.id;
    const cur = get(`SELECT id, status FROM controls WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `control ${id} not found`, "not_found");
    const status = bodyOptStr(ctx, "status");
    if (status && !["S00", "S10", "S20", "S30", "S40", "S50", "S60", "S80", "S90"].includes(status)) {
      throw new HttpError(400, "status must be S00..S90", "bad_field");
    }
    run(
      `UPDATE controls SET
         status = COALESCE(?, status),
         evidence_note = COALESCE(?, evidence_note),
         updated_by = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [status, bodyOptStr(ctx, "evidence_note"), ctx.user ?? "admin", id],
    );
    const row = get(
      `SELECT id, domain, name, floor, criticality, evidence_floor, applicability, status, owner_wave, note, in_scope, evidence_note, updated_by, updated_at FROM controls WHERE id = ?`,
      [id],
    );
    return { ok: true, control: row };
  });

  // ── evidence manifest (E1..E6) ───────────────────────────────────────────
  on("GET", "/admin/evidence", () => {
    const rows = all(
      `SELECT id, control_ids_json, class, source, authority, observed, expected, captured_at, captured_by, integrity_ref, validity
       FROM evidence ORDER BY id DESC LIMIT 500`,
    );
    return {
      evidence: rows.map((r) => ({
        ...r,
        control_ids: parseJson<string[]>(r.control_ids_json as string | null, []),
      })),
    };
  });

  on("POST", "/admin/evidence", (ctx) => {
    ctx.requireAdmin();
    const ids = bodyArr(ctx, "control_ids").map((c) => String(c).slice(0, 20)).filter(Boolean);
    const cls = bodyStr(ctx, "class", { required: true, max: 3 }).toUpperCase();
    if (!["E1", "E2", "E3", "E4", "E5", "E6"].includes(cls)) {
      throw new HttpError(400, "class must be E1..E6", "bad_field");
    }
    const id = insert(
      `INSERT INTO evidence(control_ids_json, class, source, authority, observed, expected, captured_at, captured_by, integrity_ref, validity)
       VALUES(?,?,?,?,?,?,datetime('now'),?,?,COALESCE(?, 'current'))`,
      [
        JSON.stringify(ids),
        cls,
        bodyStr(ctx, "source", { required: true, max: 300 }),
        bodyStr(ctx, "authority", { required: true, max: 200 }),
        bodyOptStr(ctx, "observed"),
        bodyOptStr(ctx, "expected"),
        ctx.user ?? "admin",
        bodyOptStr(ctx, "integrity_ref") ?? `ev-${nowSqlite()}`,
        bodyOptStr(ctx, "validity"),
      ],
    );
    return { ok: true, id };
  });

  on("PATCH", "/admin/evidence", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT id FROM evidence WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `evidence ${id} not found`, "not_found");
    const ids = bodyArr(ctx, "control_ids");
    run(
      `UPDATE evidence SET
         source = COALESCE(?, source), authority = COALESCE(?, authority),
         observed = COALESCE(?, observed), expected = COALESCE(?, expected),
         validity = COALESCE(?, validity),
         control_ids_json = CASE WHEN ? = 1 THEN ? ELSE control_ids_json END
       WHERE id = ?`,
      [
        bodyOptStr(ctx, "source"), bodyOptStr(ctx, "authority"), bodyOptStr(ctx, "observed"),
        bodyOptStr(ctx, "expected"), bodyOptStr(ctx, "validity"),
        ids.length ? 1 : 0,
        ids.length ? JSON.stringify(ids.map((c) => String(c).slice(0, 20))) : null,
        id,
      ],
    );
    return { ok: true, id };
  });

  // ── findings (F-IMP..F-RSK) ──────────────────────────────────────────────
  on("GET", "/admin/findings", (ctx) => {
    const status = ctx.url.searchParams.get("status");
    const rows = all(
      `SELECT id, control_id, class, description, severity, owner, status, resolution, created_at
       FROM findings WHERE (? IS NULL OR status = ?) ORDER BY id DESC LIMIT 500`,
      [status, status],
    );
    return { findings: rows };
  });

  on("POST", "/admin/findings", (ctx) => {
    ctx.requireAdmin();
    const cls = bodyStr(ctx, "class", { required: true, max: 8 }).toUpperCase();
    if (!["F-IMP", "F-EVD", "F-AUTH", "F-ENV", "F-POL", "F-RSK"].includes(cls)) {
      throw new HttpError(400, "class must be F-IMP|F-EVD|F-AUTH|F-ENV|F-POL|F-RSK", "bad_field");
    }
    const id = insert(
      `INSERT INTO findings(control_id, class, description, severity, owner, status, resolution, created_at)
       VALUES(?,?,?,?,?,'open',NULL,datetime('now'))`,
      [
        bodyStr(ctx, "control_id", { required: true, max: 20 }),
        cls,
        bodyStr(ctx, "description", { required: true, max: 4000 }),
        bodyStr(ctx, "severity", { max: 20 }) || "medium",
        bodyOptStr(ctx, "owner"),
      ],
    );
    return { ok: true, id };
  });

  on("PATCH", "/admin/findings", (ctx) => {
    ctx.requireAdmin();
    const id = Number(bodyStr(ctx, "id", { required: true }).slice(0, 12));
    const cur = get(`SELECT id FROM findings WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `finding ${id} not found`, "not_found");
    const status = bodyOptStr(ctx, "status");
    if (status && !["open", "remediated", "waived"].includes(status)) {
      throw new HttpError(400, "status must be open|remediated|waived", "bad_field");
    }
    run(
      `UPDATE findings SET
         status = COALESCE(?, status), resolution = COALESCE(?, resolution),
         owner = COALESCE(?, owner), severity = COALESCE(?, severity)
       WHERE id = ?`,
      [status, bodyOptStr(ctx, "resolution"), bodyOptStr(ctx, "owner"), bodyOptStr(ctx, "severity"), id],
    );
    return { ok: true, id };
  });

  // ── certification records ────────────────────────────────────────────────
  on("GET", "/admin/certifications", () => {
    const rows = all(
      `SELECT id, profile, scope, source_authority, environment, disposition, score, gates_json, issued_at, valid_until, report_json
       FROM certifications ORDER BY id DESC LIMIT 20`,
    );
    return { certifications: rows.map((r) => ({ ...r, gates: parseJson<unknown>(r.gates_json as string | null, null), report: parseJson<unknown>(r.report_json as string | null, null) })) };
  });

  on("POST", "/admin/certifications", (ctx) => {
    ctx.requireAdmin();
    const disposition = bodyStr(ctx, "disposition", { required: true, max: 30 });
    if (!["PASS", "PASS_WITH_CONDITIONS", "FAIL"].includes(disposition)) {
      throw new HttpError(400, "disposition must be PASS|PASS_WITH_CONDITIONS|FAIL", "bad_field");
    }
    const gates = bodyArr(ctx, "gates");
    const report = bodyOptStr(ctx, "report");
    const id = insert(
      `INSERT INTO certifications(profile, scope, source_authority, environment, disposition, score, gates_json, issued_at, valid_until, report_json)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        bodyStr(ctx, "profile", { required: true, max: 40 }),
        bodyStr(ctx, "scope", { required: true, max: 500 }),
        bodyStr(ctx, "source_authority", { required: true, max: 200 }),
        bodyStr(ctx, "environment", { required: true, max: 120 }),
        disposition,
        bodyOptStr(ctx, "score") != null ? Number(bodyStr(ctx, "score")) : null,
        gates.length ? JSON.stringify(gates) : null,
        nowSqlite(),
        bodyOptStr(ctx, "valid_until"),
        report ? JSON.stringify(JSON.parse(report)) : null,
      ],
    );
    return { ok: true, id };
  });

  // ── governance console stats ─────────────────────────────────────────────
  on("GET", "/admin/stats", () => {
    return {
      policies: scalar(`SELECT COUNT(*) FROM policies`),
      published_policies: scalar(`SELECT COUNT(*) FROM policies WHERE status = 'published'`),
      policy_versions: scalar(`SELECT COUNT(*) FROM policy_versions`),
      acceptances: scalar(`SELECT COUNT(*) FROM policy_acceptances`),
      privacy_requests: scalar(`SELECT COUNT(*) FROM privacy_requests`),
      privacy_open: scalar(`SELECT COUNT(*) FROM privacy_requests WHERE status NOT IN('completed','rejected')`),
      legal_holds_active: scalar(`SELECT COUNT(*) FROM legal_holds WHERE lifted_at IS NULL`),
      registers: scalar(`SELECT COUNT(*) FROM register_entries`),
      incidents_open: scalar(`SELECT COUNT(*) FROM incidents WHERE status IN('open','mitigated','resolved')`),
      incidents_total: scalar(`SELECT COUNT(*) FROM incidents`),
      risks_open: scalar(`SELECT COUNT(*) FROM risks WHERE status = 'open'`),
      risks_total: scalar(`SELECT COUNT(*) FROM risks`),
      risk_exceptions_active: scalar(`SELECT COUNT(*) FROM risk_exceptions WHERE status = 'active'`),
      decisions: scalar(`SELECT COUNT(*) FROM decisions`),
      controls_total: scalar(`SELECT COUNT(*) FROM controls`),
      controls_s80: scalar(`SELECT COUNT(*) FROM controls WHERE status = 'S80'`),
      controls_s60: scalar(`SELECT COUNT(*) FROM controls WHERE status = 'S60'`),
      evidence_rows: scalar(`SELECT COUNT(*) FROM evidence`),
      findings_open: scalar(`SELECT COUNT(*) FROM findings WHERE status = 'open'`),
      processors: scalar(`SELECT COUNT(*) FROM processors`),
      data_register_rows: scalar(`SELECT COUNT(*) FROM data_register`),
      generated_at: nowSqlite(),
    };
  });
}
