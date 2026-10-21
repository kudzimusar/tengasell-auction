// routes/incidents.ts — incident management (INC-001..012, SEC-020, PRV-016).
//
//   GET   /admin/incidents              list (?status=) with ref/severity/timeline
//   POST  /admin/incidents              declare (ref auto INC-YYYY-NNN, commander
//                                       assignment, S1-S4 severity model)
//   PATCH /admin/incidents/:id          update fields / status transitions
//   POST  /admin/incidents/:id/timeline append a timeline event
//   POST  /admin/incidents/:id/close    close with RCA + corrective actions
//   GET   /admin/incidents/summary      counts by severity/status/type

import { HttpError, type AddRoute, bodyArr, bodyOptStr, bodyStr, bodyBool, parseJson } from "../http";
import { all, get, insert, run, scalar, nowSqlite } from "../db";

interface TimelineEvent { ts: string; event: string }
interface CorrectiveAction { id: string; what: string; owner: string; due: string; status: string }

function serializeIncident(r: Record<string, unknown>) {
  return {
    ...r,
    timeline: parseJson<TimelineEvent[]>(r.timeline_json as string | null, []),
    corrective_actions: parseJson<CorrectiveAction[]>(r.corrective_actions_json as string | null, []),
    regulatory_reportable: Number(r.regulatory_reportable ?? 0) === 1,
  };
}

function nextRef(): string {
  const year = new Date().getUTCFullYear();
  const n = scalar(
    `SELECT COUNT(*) FROM incidents WHERE ref LIKE 'INC-${year}-%'`,
  );
  return `INC-${year}-${String(n + 1).padStart(3, "0")}`;
}

export function registerIncidentRoutes(on: AddRoute): void {
  on("GET", "/admin/incidents", (ctx) => {
    const status = ctx.url.searchParams.get("status");
    const rows = all(
      `SELECT id, ref, title, severity, type, status, commander, detected_at, timeline_json,
              impact, rca, corrective_actions_json, regulatory_reportable, reported_at, created_at
       FROM incidents WHERE (? IS NULL OR status = ?) ORDER BY id DESC LIMIT 200`,
      [status, status],
    );
    return { incidents: rows.map(serializeIncident) };
  });

  on("POST", "/admin/incidents", (ctx) => {
    ctx.requireAdmin();
    const severity = bodyStr(ctx, "severity", { required: true, max: 3 }).toUpperCase();
    if (!["S1", "S2", "S3", "S4"].includes(severity)) {
      throw new HttpError(400, "severity must be S1|S2|S3|S4", "bad_field");
    }
    const type = bodyStr(ctx, "type", { required: true, max: 20 });
    if (!["outage", "security", "privacy", "data", "third_party"].includes(type)) {
      throw new HttpError(400, "type must be outage|security|privacy|data|third_party", "bad_field");
    }
    const detectedAt = bodyStr(ctx, "detected_at", { max: 30 }) || nowSqlite();
    const initial: TimelineEvent[] = [
      { ts: detectedAt, event: bodyStr(ctx, "impact", { max: 2000 }) || "Incident declared." },
      { ts: nowSqlite(), event: `Incident declared at ${severity} severity; commander ${bodyStr(ctx, "commander", { max: 60 }) || "on-call"} assigned.` },
    ];
    const id = insert(
      `INSERT INTO incidents(ref, title, severity, type, status, commander, detected_at, timeline_json, impact, corrective_actions_json, regulatory_reportable, created_at)
       VALUES(?,?,?,?, 'open', ?, ?, ?, ?, '[]', ?, ?)`,
      [
        nextRef(),
        bodyStr(ctx, "title", { required: true, max: 300 }),
        severity,
        type,
        bodyStr(ctx, "commander", { max: 60 }) || "on-call",
        detectedAt,
        JSON.stringify(initial),
        bodyStr(ctx, "impact", { max: 4000 }),
        bodyBool(ctx, "regulatory_reportable") ? 1 : 0,
        nowSqlite(),
      ],
    );
    const row = get(`SELECT * FROM incidents WHERE id = ?`, [id]);
    return { ok: true, incident: serializeIncident(row as Record<string, unknown>) };
  });

  on("PATCH", "/admin/incidents/:id", (ctx) => {
    ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const cur = get(`SELECT * FROM incidents WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `incident ${id} not found`, "not_found");
    const status = bodyOptStr(ctx, "status");
    if (status && !["open", "mitigated", "resolved", "closed"].includes(status)) {
      throw new HttpError(400, "bad status", "bad_field");
    }
    run(
      `UPDATE incidents SET
         title = COALESCE(?, title), severity = COALESCE(?, severity), type = COALESCE(?, type),
         status = COALESCE(?, status), commander = COALESCE(?, commander),
         impact = COALESCE(?, impact), regulatory_reportable = COALESCE(?, regulatory_reportable),
         reported_at = COALESCE(?, reported_at)
       WHERE id = ?`,
      [
        bodyOptStr(ctx, "title"),
        bodyOptStr(ctx, "severity"),
        bodyOptStr(ctx, "type"),
        status,
        bodyOptStr(ctx, "commander"),
        bodyOptStr(ctx, "impact"),
        bodyOptStr(ctx, "regulatory_reportable") === null ? null : bodyBool(ctx, "regulatory_reportable") ? 1 : 0,
        bodyOptStr(ctx, "reported_at"),
        id,
      ],
    );
    if (status) {
      const timeline = parseJson<TimelineEvent[]>(cur.timeline_json as string | null, []);
      timeline.push({ ts: nowSqlite(), event: `Status → ${status} (by ${ctx.user ?? "admin"}).` });
      run(`UPDATE incidents SET timeline_json = ? WHERE id = ?`, [JSON.stringify(timeline), id]);
    }
    const row = get(`SELECT * FROM incidents WHERE id = ?`, [id]);
    return { ok: true, incident: serializeIncident(row as Record<string, unknown>) };
  });

  on("POST", "/admin/incidents/:id/timeline", (ctx) => {
    ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const cur = get(`SELECT timeline_json FROM incidents WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `incident ${id} not found`, "not_found");
    const event = bodyStr(ctx, "event", { required: true, max: 2000 });
    const timeline = parseJson<TimelineEvent[]>(cur.timeline_json as string | null, []);
    timeline.push({ ts: nowSqlite(), event });
    run(`UPDATE incidents SET timeline_json = ? WHERE id = ?`, [JSON.stringify(timeline), id]);
    return { ok: true, timeline };
  });

  on("POST", "/admin/incidents/:id/close", (ctx) => {
    ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const cur = get(`SELECT * FROM incidents WHERE id = ?`, [id]);
    if (!cur) throw new HttpError(404, `incident ${id} not found`, "not_found");
    if ((cur as { status: string }).status === "closed") {
      throw new HttpError(409, "incident already closed", "status_conflict");
    }
    const rca = bodyStr(ctx, "rca", { required: true, max: 20_000 });
    const rawActions = bodyArr(ctx, "corrective_actions");
    const actions: CorrectiveAction[] = rawActions.map((a, i) => {
      if (typeof a === "string") {
        return { id: `CA-${i + 1}`, what: a.slice(0, 2000), owner: "platform", due: "", status: "open" };
      }
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        return {
          id: String(o.id ?? `CA-${i + 1}`).slice(0, 20),
          what: String(o.what ?? "").slice(0, 2000),
          owner: String(o.owner ?? "platform").slice(0, 60),
          due: String(o.due ?? "").slice(0, 12),
          status: String(o.status ?? "open").slice(0, 20),
        };
      }
      return { id: `CA-${i + 1}`, what: "", owner: "platform", due: "", status: "open" };
    }).filter((a) => a.what);
    const timeline = parseJson<TimelineEvent[]>(cur.timeline_json as string | null, []);
    timeline.push({ ts: nowSqlite(), event: `Incident closed with RCA + ${actions.length} corrective action(s) (by ${ctx.user ?? "admin"}).` });
    run(
      `UPDATE incidents SET status = 'closed', rca = ?, corrective_actions_json = ?, timeline_json = ?, reported_at = COALESCE(?, reported_at) WHERE id = ?`,
      [rca, JSON.stringify(actions), JSON.stringify(timeline), bodyOptStr(ctx, "reported_at"), id],
    );
    const row = get(`SELECT * FROM incidents WHERE id = ?`, [id]);
    return { ok: true, incident: serializeIncident(row as Record<string, unknown>) };
  });
}
