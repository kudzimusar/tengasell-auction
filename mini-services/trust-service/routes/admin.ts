// Admin endpoints (x-tgs-admin: 1, set by the Next BFF after the TrailBase
// admin-claim gate). Sections: tickets queue · reports queue · cases ·
// enforcement ladder + appeals + roles · macros · screening · health score ·
// stats · sign-in log · seed-demo. Every mutating action writes a TrailBase
// audit_events row (TNS-014) and ticket_events where relevant.

import { HttpError, bodyEnum, bodyInt, bodyStr, type AddRoute } from "../http";
import { all, get, insert, run, scalar } from "../db";
import { isoPlusHours, nowIso } from "../util";
import { audit, getRecord, getRecords } from "../trailbase";
import { userNotice } from "../notify";
import {
  applyEnforcement,
  computeSellerHealth,
  createEnforcementRow,
  trustStatus,
  type EnforcementAction,
} from "../core";
import { clearHit, runScan, takedownListing } from "../screening";
import { riskScore } from "../core";
import { seedDemo } from "../seed";

const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
const ENFORCEMENT_ACTIONS = ["warning", "restriction", "suspension", "ban", "reinstate"] as const;
const ROLE_NAMES = ["admin", "support", "finance", "moderator", "compliance"] as const;
const APPEAL_DECISIONS = ["under_review", "granted", "denied"] as const;

function slaBreached(row: { status: string; first_reply_at: string | null; sla_due_at: string }): boolean {
  if (row.first_reply_at) return Date.parse(row.first_reply_at) > Date.parse(row.sla_due_at);
  return row.status !== "resolved" && row.status !== "closed" && Date.parse(row.sla_due_at) < Date.now();
}

function serializeTicket(t: Record<string, unknown>) {
  const row = t as Parameters<typeof slaBreached>[0] & Record<string, unknown>;
  return { ...row, sla_breached: slaBreached(row) };
}

function ticketEvent(ticketId: number, actor: string, type: string, payload: unknown): void {
  insert(`INSERT INTO ticket_events(ticket_id, actor, type, payload, created_at) VALUES(?,?,?,?,?)`, [
    ticketId,
    actor,
    type,
    JSON.stringify(payload ?? {}),
    nowIso(),
  ]);
}

export function registerAdminRoutes(on: AddRoute): void {
  // ── tickets queue (SUP-003/004/006) ─────────────────────────────────────

  on("GET", "/admin/tickets", (ctx) => {
    ctx.requireAdmin();
    const status = ctx.url.searchParams.get("status") ?? "";
    const assignee = ctx.url.searchParams.get("assignee") ?? "";
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (status && (TICKET_STATUSES as readonly string[]).includes(status)) {
      clauses.push(`t.status = ?`);
      params.push(status);
    }
    if (assignee) {
      clauses.push(assignee === "unassigned" ? `t.assignee IS NULL` : `t.assignee = ?`);
      if (assignee !== "unassigned") params.push(assignee);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = all(
      `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.internal = 0) AS message_count
       FROM tickets t ${where} ORDER BY t.id DESC LIMIT 200`,
      params,
    );
    return { tickets: rows.map(serializeTicket) };
  });

  on("GET", "/admin/tickets/:id", (ctx) => {
    ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const t = get(`SELECT * FROM tickets WHERE id = ?`, [id]);
    if (!t) throw new HttpError(404, "ticket not found", "not_found");
    const messages = all(
      `SELECT id, author, body, internal, attachment, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC`,
      [id],
    );
    const events = all(`SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY id ASC LIMIT 200`, [id]);
    return { ticket: serializeTicket(t as unknown as Record<string, unknown>), messages, events };
  });

  on("POST", "/admin/tickets/:id/assign", (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const assignee = bodyStr(ctx, "assignee", { required: true, max: 100 });
    const t = get(`SELECT id FROM tickets WHERE id = ?`, [id]);
    if (!t) throw new HttpError(404, "ticket not found", "not_found");
    run(`UPDATE tickets SET assignee = ? WHERE id = ?`, [assignee, id]);
    ticketEvent(id, actor, "assigned", { assignee });
    void audit(actor, "ticket.assign", "tickets", id, "trust", { assignee });
    return { ok: true };
  });

  on("POST", "/admin/tickets/:id/reply", (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const body = bodyStr(ctx, "body", { required: true, max: 20_000 });
    const internal = ctx.body?.internal === true || ctx.body?.internal === 1;
    const t = get<{
      id: number;
      username: string;
      status: string;
      first_reply_at: string | null;
    }>(`SELECT id, username, status, first_reply_at FROM tickets WHERE id = ?`, [id]);
    if (!t) throw new HttpError(404, "ticket not found", "not_found");
    insert(`INSERT INTO ticket_messages(ticket_id, author, body, internal, created_at) VALUES(?,?,?,?,?)`, [
      id,
      actor,
      body,
      internal ? 1 : 0,
      nowIso(),
    ]);
    if (!internal) {
      // First agent reply stamps the SLA clock; open tickets move to pending.
      if (!t.first_reply_at) {
        run(`UPDATE tickets SET first_reply_at = ? WHERE id = ?`, [nowIso(), id]);
      }
      if (t.status === "open") {
        run(`UPDATE tickets SET status = 'pending' WHERE id = ?`, [id]);
      }
      ticketEvent(id, actor, "agent_reply", { internal: false });
      void userNotice({
        username: t.username,
        eventKey: "ticket.reply",
        title: `Support replied to ticket #${id}`,
        body: body.slice(0, 300),
        link: "my/tickets",
      });
    } else {
      ticketEvent(id, actor, "internal_note", {});
    }
    void audit(actor, internal ? "ticket.note" : "ticket.reply", "tickets", id, "trust", {
      internal,
      length: body.length,
    });
    return { ok: true };
  });

  on("POST", "/admin/tickets/:id/status", (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const status = bodyEnum(ctx, "status", TICKET_STATUSES, { required: true });
    const resolutionNote = bodyStr(ctx, "resolution_note", { max: 4000 });
    const t = get<{ id: number; username: string; status: string; csat_score: number | null }>(
      `SELECT id, username, status, csat_score FROM tickets WHERE id = ?`,
      [id],
    );
    if (!t) throw new HttpError(404, "ticket not found", "not_found");
    if (status === "resolved" && t.status !== "resolved" && t.status !== "closed") {
      void userNotice({
        username: t.username,
        eventKey: "ticket.resolved",
        title: `Ticket #${id} marked resolved`,
        body: "If you're happy with the answer, rate the support you received from My Tengasell → Support.",
        link: "my/tickets",
      });
    }
    run(`UPDATE tickets SET status = ?, resolved_at = ? WHERE id = ?`, [
      status,
      status === "resolved" || status === "closed" ? nowIso() : null,
      id,
    ]);
    ticketEvent(id, actor, "status", { status, resolution_note: resolutionNote });
    void audit(actor, "ticket.status", "tickets", id, "trust", { status, resolution_note: resolutionNote });
    return { ok: true };
  });

  // ── reports queue (TNS-001..003, MKT-008) ──────────────────────────────

  on("GET", "/admin/reports", (ctx) => {
    ctx.requireAdmin();
    const status = ctx.url.searchParams.get("status") ?? "";
    const params: (string | number)[] = [];
    let where = "";
    if (status && ["received", "reviewing", "actioned", "dismissed"].includes(status)) {
      where = `WHERE status = ?`;
      params.push(status);
    }
    const rows = all(`SELECT * FROM reports ${where} ORDER BY id DESC LIMIT 200`, params);
    return { reports: rows };
  });

  // review → status=reviewing + open a case with an immutable evidence
  // snapshot of the target (listing/profile/message/order) at review time.
  on("POST", "/admin/reports/:id/review", async (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const r = get<{
      id: number;
      reporter: string;
      target_type: "listing" | "profile" | "message" | "order";
      target_id: string;
      reason_code: string;
      note: string;
      status: string;
    }>(`SELECT * FROM reports WHERE id = ?`, [id]);
    if (!r) throw new HttpError(404, "report not found", "not_found");

    let accused = "";
    let evidence: Record<string, unknown> = {};
    try {
      if (r.target_type === "listing") {
        const a = await getRecord("auctions", r.target_id);
        accused = String((a as Record<string, unknown> | null)?.seller_username ?? "");
        evidence = { auction: a, snapshot_at: nowIso() };
      } else if (r.target_type === "profile") {
        accused = r.target_id;
        const rows = await getRecords(
          "profiles",
          `filter[username][$eq]=${encodeURIComponent(r.target_id)}&limit=1`,
        );
        evidence = { profile: rows[0] ?? null, snapshot_at: nowIso() };
      } else if (r.target_type === "order") {
        const o = await getRecord("orders", r.target_id);
        accused = String((o as Record<string, unknown> | null)?.seller_username ?? "");
        evidence = { order: o, snapshot_at: nowIso() };
      } else {
        const m = await getRecord("messages", r.target_id);
        evidence = { message: m, snapshot_at: nowIso() };
      }
    } catch (err) {
      console.warn(`[trust] evidence snapshot failed for report #${id}:`, (err as Error).message);
      evidence = { snapshot_error: (err as Error).message, snapshot_at: nowIso() };
    }

    run(`UPDATE reports SET status = 'reviewing', reviewer = ?, reviewed_at = ? WHERE id = ?`, [
      actor,
      nowIso(),
      id,
    ]);
    const caseId = insert(
      `INSERT INTO cases(report_id, subject, username, kind, status, evidence, risk_score, created_at, updated_at)
       VALUES(?,?,?, 'abuse', 'under_review', ?, ?, ?, ?)`,
      [
        id,
        `${r.reason_code} report — ${r.target_type} ${r.target_id}`,
        accused,
        JSON.stringify(evidence),
        riskScore(accused),
        nowIso(),
        nowIso(),
      ],
    );
    void audit(actor, "report.review", "reports", id, "trust", { case_id: caseId });
    return { ok: true, case_id: caseId };
  });

  on("POST", "/admin/reports/:id/action", async (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const outcome = bodyStr(ctx, "outcome", { required: true, max: 2000 });
    const takedown = ctx.body?.takedown === true;
    const r = get<{ id: number; target_type: string; target_id: string; status: string }>(
      `SELECT id, target_type, target_id, status FROM reports WHERE id = ?`,
      [id],
    );
    if (!r) throw new HttpError(404, "report not found", "not_found");

    let takedownResult: { ended: boolean; notified: number; audience: string[] } | null = null;
    if (takedown && r.target_type === "listing") {
      takedownResult = await takedownListing(Number(r.target_id), actor);
    }
    run(`UPDATE reports SET status = 'actioned', reviewer = ?, reviewed_at = ?, outcome = ? WHERE id = ?`, [
      actor,
      nowIso(),
      outcome,
      id,
    ]);
    run(`UPDATE cases SET status = 'resolved', resolved_at = ?, outcome = ?, updated_at = ? WHERE report_id = ?`, [
      nowIso(),
      outcome,
      nowIso(),
      id,
    ]);
    void audit(actor, "report.action", "reports", id, "trust", { outcome, takedown: !!takedownResult });
    return { ok: true, takedown: takedownResult };
  });

  on("POST", "/admin/reports/:id/dismiss", (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const outcome = bodyStr(ctx, "outcome", { max: 2000 });
    const r = get(`SELECT id FROM reports WHERE id = ?`, [id]);
    if (!r) throw new HttpError(404, "report not found", "not_found");
    run(`UPDATE reports SET status = 'dismissed', reviewer = ?, reviewed_at = ?, outcome = ? WHERE id = ?`, [
      actor,
      nowIso(),
      outcome || "not substantiated",
      id,
    ]);
    run(`UPDATE cases SET status = 'resolved', resolved_at = ?, outcome = ?, updated_at = ? WHERE report_id = ?`, [
      nowIso(),
      "dismissed",
      nowIso(),
      id,
    ]);
    void audit(actor, "report.dismiss", "reports", id, "trust", { outcome });
    return { ok: true };
  });

  // ── cases (TNS-002/005/007, CTL-012) ────────────────────────────────────

  on("GET", "/admin/cases", (ctx) => {
    ctx.requireAdmin();
    const status = ctx.url.searchParams.get("status") ?? "";
    const params: (string | number)[] = [];
    let where = "";
    if (status && ["open", "under_review", "resolved"].includes(status)) {
      where = `WHERE c.status = ?`;
      params.push(status);
    }
    const rows = all(
      `SELECT c.*, t.order_id, t.auction_id, t.status AS ticket_status, t.sla_due_at, t.first_reply_at
       FROM cases c LEFT JOIN tickets t ON t.id = c.ticket_id
       ${where} ORDER BY c.id DESC LIMIT 200`,
      params,
    );
    return {
      cases: rows.map((c) => {
        const row = c as unknown as {
          ticket_status: string;
          sla_due_at: string | null;
          first_reply_at: string | null;
        };
        let breached = false;
        if (row.sla_due_at) {
          breached = row.first_reply_at
            ? Date.parse(row.first_reply_at) > Date.parse(row.sla_due_at)
            : row.ticket_status !== "resolved" &&
              row.ticket_status !== "closed" &&
              Date.parse(row.sla_due_at) < Date.now();
        }
        return { ...c, sla_breached: breached };
      }),
    };
  });

  on("POST", "/admin/cases/:id/resolve", (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const outcome = bodyStr(ctx, "outcome", { required: true, max: 2000 });
    const c = get<{ id: number; ticket_id: number | null; username: string; kind: string }>(
      `SELECT id, ticket_id, username, kind FROM cases WHERE id = ?`,
      [id],
    );
    if (!c) throw new HttpError(404, "case not found", "not_found");
    run(`UPDATE cases SET status = 'resolved', resolved_at = ?, outcome = ?, updated_at = ? WHERE id = ?`, [
      nowIso(),
      outcome,
      nowIso(),
      id,
    ]);
    if (c.ticket_id) {
      ticketEvent(c.ticket_id, actor, "case_resolved", { case_id: id, outcome });
    }
    if (c.username) {
      void userNotice({
        username: c.username,
        eventKey: "trust.case.resolved",
        title: `Case #${id} update`,
        body: `Our Trust & Safety team resolved the case: ${outcome}`,
        link: "my/tickets",
      });
    }
    void audit(actor, "case.resolve", "cases", id, "trust", { outcome });
    return { ok: true };
  });

  // ── enforcement ladder (TNS-008..013, CTL-005/006/021, MKT-005) ─────────

  on("GET", "/admin/enforcement", (ctx) => {
    ctx.requireAdmin();
    const rows = all(`SELECT * FROM enforcement ORDER BY id DESC LIMIT 200`);
    const suspensions = all(`SELECT * FROM suspension ORDER BY enforced_at DESC LIMIT 200`);
    return { enforcement: rows, suspensions };
  });

  on("POST", "/admin/enforcement", (ctx) => {
    const actor = ctx.requireAdmin();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const action = bodyEnum(ctx, "action", ENFORCEMENT_ACTIONS, { required: true });
    const reasonCode = bodyStr(ctx, "reason_code", { required: true, max: 200 });
    const note = bodyStr(ctx, "note", { max: 4000 });
    const days = bodyInt(ctx, "days");
    const out = createEnforcementRow({
      username,
      action: action as EnforcementAction,
      reason_code: reasonCode,
      note,
      days,
      actor,
    });
    return { id: out.id, pending: out.pending };
  });

  on("POST", "/admin/enforcement/:id/approve", (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const row = get<{
      id: number;
      username: string;
      action: string;
      status: string;
      requested_by: string;
      dual_approval: number;
    }>(`SELECT id, username, action, status, requested_by, dual_approval FROM enforcement WHERE id = ?`, [id]);
    if (!row) throw new HttpError(404, "enforcement row not found", "not_found");
    if (row.status !== "pending") throw new HttpError(400, "action already resolved", "not_pending");
    if (!row.dual_approval) {
      throw new HttpError(400, "this action does not require approval", "no_approval_needed");
    }
    // CTL-021 dual approval: the approver MUST be a DIFFERENT admin.
    if (row.requested_by === actor) {
      throw new HttpError(
        403,
        "dual approval requires a DIFFERENT admin than the requester",
        "same_admin",
      );
    }
    run(`UPDATE enforcement SET approved_by = ?, approved_at = ? WHERE id = ?`, [actor, nowIso(), id]);
    applyEnforcement(id, actor, null);
    void audit(actor, `enforcement.approve.${row.action}`, "enforcement", id, "trust", {
      username: row.username,
      requested_by: row.requested_by,
    });
    return { ok: true };
  });

  // ── appeals (TNS-012/013) ───────────────────────────────────────────────

  on("GET", "/admin/appeals", (ctx) => {
    ctx.requireAdmin();
    const rows = all(
      `SELECT a.*, e.action AS enforcement_action, e.reason_code AS enforcement_reason, e.status AS enforcement_status
       FROM appeals a JOIN enforcement e ON e.id = a.enforcement_id
       ORDER BY a.id DESC LIMIT 200`,
    );
    return { appeals: rows };
  });

  on("POST", "/admin/appeals/:id/decide", (ctx) => {
    const actor = ctx.requireAdmin();
    const id = Number(ctx.params.id);
    const decision = bodyEnum(ctx, "decision", APPEAL_DECISIONS, { required: true });
    const decisionNote = bodyStr(ctx, "decision_note", { max: 4000 });
    const a = get<{ id: number; enforcement_id: number; username: string; status: string }>(
      `SELECT id, enforcement_id, username, status FROM appeals WHERE id = ?`,
      [id],
    );
    if (!a) throw new HttpError(404, "appeal not found", "not_found");
    if (a.status === "granted" || a.status === "denied") {
      throw new HttpError(400, "appeal already decided", "already_decided");
    }
    run(`UPDATE appeals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?`, [
      decision,
      actor,
      nowIso(),
      decisionNote,
      id,
    ]);
    if (decision === "granted") {
      // TNS-013 reinstatement: a granted appeal auto-applies a reinstate
      // action, clearing the suspension row.
      const enforcementId = insert(
        `INSERT INTO enforcement(username, action, reason_code, note, dual_approval, status, requested_by, approved_by, approved_at, created_at)
         VALUES(?, 'reinstate', 'appeal_granted', ?, 0, 'active', ?, ?, ?, ?)`,
        [a.username, `Appeal #${id} granted`, actor, actor, nowIso(), nowIso()],
      );
      applyEnforcement(enforcementId, actor, `appeal:${id}`);
    }
    void userNotice({
      username: a.username,
      eventKey: `trust.appeal.${decision}`,
      title:
        decision === "granted"
          ? "Your appeal was granted"
          : decision === "denied"
            ? "Your appeal was denied"
            : "Your appeal moved to review",
      body: decisionNote || "Trust & Safety reviewed your appeal.",
      link: "my/tickets",
      viaComms: decision === "granted",
    });
    void audit(actor, `appeal.${decision}`, "appeals", id, "trust", { decision_note: decisionNote });
    return { ok: true };
  });

  // ── staff roles (CTL-002/007, IAM-008) ──────────────────────────────────

  on("GET", "/admin/roles", (ctx) => {
    ctx.requireAdmin();
    const rows = all(`SELECT username, role, assigned_by, assigned_at, note FROM roles ORDER BY username ASC`);
    return { roles: rows };
  });

  on("POST", "/admin/roles", (ctx) => {
    const actor = ctx.requireAdmin();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const role = bodyEnum(ctx, "role", ROLE_NAMES, { required: true });
    const note = bodyStr(ctx, "note", { max: 500 });
    run(
      `INSERT INTO roles(username, role, assigned_by, assigned_at, note) VALUES(?,?,?,?,?)
       ON CONFLICT(username) DO UPDATE SET role = excluded.role, assigned_by = excluded.assigned_by,
         assigned_at = excluded.assigned_at, note = excluded.note`,
      [username, role, actor, nowIso(), note],
    );
    void audit(actor, "role.assign", "roles", null, "trust", { username, role });
    return { ok: true };
  });

  on("DELETE", "/admin/roles", (ctx) => {
    const actor = ctx.requireAdmin();
    const username = bodyStr(ctx, "username", { required: true, max: 100 });
    const row = get<{ username: string; role: string }>(`SELECT username, role FROM roles WHERE username = ?`, [
      username,
    ]);
    if (!row) throw new HttpError(404, "role row not found", "not_found");
    run(`DELETE FROM roles WHERE username = ?`, [username]);
    void audit(actor, "role.revoke", "roles", null, "trust", { username, role: row.role });
    return { ok: true };
  });

  // ── macros (SUP-008, DOC-007 playbooks) ─────────────────────────────────

  on("GET", "/admin/macros", (ctx) => {
    ctx.requireAdmin();
    const rows = all(`SELECT * FROM macros ORDER BY id ASC`);
    return { macros: rows };
  });

  on("POST", "/admin/macros", (ctx) => {
    const actor = ctx.requireAdmin();
    const title = bodyStr(ctx, "title", { required: true, max: 200 });
    const body = bodyStr(ctx, "body", { required: true, max: 8000 });
    const locale = bodyStr(ctx, "locale", { max: 5 }) || "en";
    const id = insert(`INSERT INTO macros(title, body, locale) VALUES(?,?,?)`, [title, body, locale]);
    void audit(actor, "macro.create", "macros", id, "trust", { title, locale });
    return { id };
  });

  // ── screening (MKT-008/029, CTL-017 listing queue, GOV-010) ─────────────

  on("GET", "/admin/screening", async (ctx) => {
    ctx.requireAdmin();
    const rules = all(`SELECT * FROM screening_rules ORDER BY id ASC`);
    const hits = all(`SELECT * FROM screening_hits ORDER BY id DESC LIMIT 200`);
    // Hydrate auction titles/sellers from TrailBase (parallel, best-effort).
    const hydrated = await Promise.all(
      hits.map(async (h) => {
        const hit = h as { auction_id: number };
        let title: string | null = null;
        let seller: string | null = null;
        let status: string | null = null;
        try {
          const a = await getRecord("auctions", hit.auction_id);
          title = String((a as Record<string, unknown> | null)?.title ?? "") || null;
          seller = String((a as Record<string, unknown> | null)?.seller_username ?? "") || null;
          status = String((a as Record<string, unknown> | null)?.status ?? "") || null;
        } catch {
          /* auction may be gone */
        }
        return { ...h, auction_title: title, auction_seller: seller, auction_status: status };
      }),
    );
    return {
      rules,
      hits: hydrated,
      stats: {
        pending: scalar(`SELECT COUNT(*) AS n FROM screening_hits WHERE status = 'pending'`),
        cleared: scalar(`SELECT COUNT(*) AS n FROM screening_hits WHERE status = 'cleared'`),
        actioned: scalar(`SELECT COUNT(*) AS n FROM screening_hits WHERE status = 'actioned'`),
      },
    };
  });

  on("POST", "/admin/screening/scan", async (ctx) => {
    ctx.requireAdmin();
    const actor = ctx.user ?? "admin";
    const summary = await runScan();
    void audit(actor, "screening.scan", "screening_hits", null, "trust", summary);
    return summary;
  });

  on("POST", "/admin/screening/hits/:id/clear", (ctx) => {
    ctx.requireAdmin();
    clearHit(Number(ctx.params.id), ctx.user ?? "admin");
    return { ok: true };
  });

  on("POST", "/admin/screening/hits/:id/action", async (ctx) => {
    ctx.requireAdmin();
    const actor = ctx.user ?? "admin";
    const id = Number(ctx.params.id);
    const hit = get<{ id: number; auction_id: number; status: string }>(
      `SELECT id, auction_id, status FROM screening_hits WHERE id = ?`,
      [id],
    );
    if (!hit) throw new HttpError(404, "screening hit not found", "not_found");
    if (hit.status === "actioned") throw new HttpError(400, "hit already actioned", "already_actioned");
    const result = await takedownListing(hit.auction_id, actor);
    run(`UPDATE screening_hits SET status = 'actioned', reviewer = ?, resolved_at = ? WHERE id = ?`, [
      actor,
      nowIso(),
      id,
    ]);
    return { ok: true, takedown: result };
  });

  // ── seller health (MKT-026) ─────────────────────────────────────────────

  on("GET", "/admin/health-score", async (ctx) => {
    ctx.requireAdmin();
    const username = ctx.url.searchParams.get("username") ?? "";
    if (!username) throw new HttpError(400, "username query param required", "missing_field");
    const health = await computeSellerHealth(username);
    return { health };
  });

  // ── stats (console overview) ────────────────────────────────────────────

  on("GET", "/admin/stats", (ctx) => {
    ctx.requireAdmin();
    return {
      tickets_open: scalar(`SELECT COUNT(*) AS n FROM tickets WHERE status IN('open','pending')`),
      sla_breaches: scalar(
        `SELECT COUNT(*) AS n FROM tickets WHERE first_reply_at IS NULL AND status IN('open','pending') AND sla_due_at < ?`,
        [nowIso()],
      ),
      reports_pending: scalar(`SELECT COUNT(*) AS n FROM reports WHERE status IN('received','reviewing')`),
      enforcement_30d: scalar(
        `SELECT COUNT(*) AS n FROM enforcement WHERE created_at >= datetime('now', '-30 days')`,
      ),
      screening_pending: scalar(`SELECT COUNT(*) AS n FROM screening_hits WHERE status = 'pending'`),
      appeals_open: scalar(`SELECT COUNT(*) AS n FROM appeals WHERE status IN('received','under_review')`),
      cases_open: scalar(`SELECT COUNT(*) AS n FROM cases WHERE status IN('open','under_review')`),
      csat_avg: Math.round(scalar(`SELECT COALESCE(AVG(csat_score), 0) AS n FROM tickets WHERE csat_score IS NOT NULL`) * 10) / 10,
    };
  });

  // ── sign-in log view (SUP-002 contact history support) ──────────────────

  on("GET", "/admin/signins", (ctx) => {
    ctx.requireAdmin();
    const username = ctx.url.searchParams.get("username") ?? "";
    const params: (string | number)[] = [];
    let where = "";
    if (username) {
      where = `WHERE username = ?`;
      params.push(username);
    }
    const rows = all(`SELECT * FROM signins ${where} ORDER BY id DESC LIMIT 100`, params);
    return { signins: rows };
  });

  // ── user status lookup for the console (customer record, SUP-001) ───────

  on("GET", "/admin/user-status", (ctx) => {
    ctx.requireAdmin();
    const username = ctx.url.searchParams.get("username") ?? "";
    if (!username) throw new HttpError(400, "username query param required", "missing_field");
    return trustStatus(username);
  });

  // ── seed-demo (idempotent) ──────────────────────────────────────────────

  on("POST", "/admin/seed-demo", async (ctx) => {
    ctx.requireAdmin();
    return seedDemo();
  });
}
