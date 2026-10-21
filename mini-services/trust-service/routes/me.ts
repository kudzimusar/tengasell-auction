// User endpoints (x-tgs-user set by the Next BFF):
//   GET  /me/tickets                     → my tickets (status chips + SLA)
//   POST /me/tickets                     → create (question|order|refund|…)
//   GET  /me/tickets/:id                 → thread (public messages only)
//   POST /me/tickets/:id/reply           → append a public message
//   POST /me/tickets/:id/csat            → CSAT thumbs after resolved (SUP-014)
//   GET  /me/reports                     → my abuse reports + status
//   POST /me/reports                     → report a listing/profile/message/order
//   GET  /me/disputes?order_id=          → my dispute cases (existing status)
//   POST /me/disputes                    → order dispute → ticket + case
//   GET  /me/appeals                     → my appeals
//   POST /me/appeals                     → appeal an enforcement action

import { HttpError, bodyEnum, bodyInt, bodyObj, bodyStr, type AddRoute } from "../http";
import { all, get, insert, run, scalar } from "../db";
import { ATTACHMENT_MAX_BYTES, SLA_HOURS } from "../config";
import { isoPlusHours, nowIso } from "../util";
import { userNotice, commsEvent } from "../notify";
import { audit } from "../trailbase";
import { riskScore } from "../core";

// ── helpers ───────────────────────────────────────────────────────────────

const CATEGORIES = ["question", "order", "refund", "complaint", "feedback", "other"] as const;
const REASONS = ["prohibited", "counterfeit", "scam", "offplatform", "abusive", "ip_violation", "other"] as const;
const DISPUTE_REASONS = ["not_received", "not_as_described", "damaged", "seller_unresponsive"] as const;

interface AttachmentJson {
  name: string;
  data_base64: string;
  mime: string;
}

/** Validate an attachment {name,data_base64,mime} ≤500KB image (SUP-009). */
function parseAttachment(ctx: { body: Record<string, unknown> | null }): AttachmentJson | null {
  const raw = ctx.body?.attachment;
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "attachment must be an object", "bad_field");
  }
  const a = raw as Record<string, unknown>;
  const name = typeof a.name === "string" ? a.name.slice(0, 200) : "";
  const mime = typeof a.mime === "string" ? a.mime.slice(0, 100) : "";
  const data = typeof a.data_base64 === "string" ? a.data_base64 : "";
  if (!mime.startsWith("image/")) {
    throw new HttpError(400, "attachments must be images", "bad_attachment");
  }
  const bytes = Math.floor((data.length * 3) / 4);
  if (bytes > ATTACHMENT_MAX_BYTES) {
    throw new HttpError(400, `attachment too large (max ${Math.floor(ATTACHMENT_MAX_BYTES / 1024)}KB)`, "too_large");
  }
  return { name, mime, data_base64: data };
}

function ticketOfUser(id: number, username: string) {
  const t = get(`SELECT * FROM tickets WHERE id = ?`, [id]);
  if (!t) throw new HttpError(404, "ticket not found", "not_found");
  if ((t as { username: string }).username !== username) {
    throw new HttpError(404, "ticket not found", "not_found"); // no existence leak
  }
  return t as {
    id: number;
    username: string;
    subject: string;
    category: string;
    priority: string;
    order_id: number | null;
    auction_id: number | null;
    status: string;
    assignee: string | null;
    sla_due_at: string;
    first_reply_at: string | null;
    resolved_at: string | null;
    csat_score: number | null;
    csat_comment: string;
    created_at: string;
  };
}

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

export function registerMeRoutes(on: AddRoute): void {
  // ── tickets ────────────────────────────────────────────────────────────

  on("GET", "/me/tickets", (ctx) => {
    const username = ctx.requireUser();
    const rows = all(`SELECT * FROM tickets WHERE username = ? ORDER BY id DESC LIMIT 100`, [username]);
    return { tickets: rows.map(serializeTicket) };
  });

  on("POST", "/me/tickets", (ctx) => {
    const username = ctx.requireUser();
    const subject = bodyStr(ctx, "subject", { required: true, max: 200 });
    const category = bodyEnum(ctx, "category", CATEGORIES, { required: true });
    const body = bodyStr(ctx, "body", { required: true, max: 20_000 });
    const priority = bodyEnum(ctx, "priority", ["low", "normal", "high", "urgent"] as const, {
      fallback: category === "refund" || category === "complaint" ? "high" : "normal",
    });
    const orderId = bodyInt(ctx, "order_id");
    const auctionId = bodyInt(ctx, "auction_id");
    const attachment = parseAttachment(ctx);

    const sla = isoPlusHours(SLA_HOURS[priority] ?? 24);
    const id = insert(
      `INSERT INTO tickets(username, subject, category, priority, order_id, auction_id, status, sla_due_at, created_at)
       VALUES(?,?,?,?,?,?, 'open', ?, ?)`,
      [username, subject, category, priority, orderId, auctionId, sla, nowIso()],
    );
    insert(`INSERT INTO ticket_messages(ticket_id, author, body, internal, attachment, created_at) VALUES(?,?,?,0,?,?)`, [
      id,
      username,
      body,
      attachment ? JSON.stringify(attachment) : null,
      nowIso(),
    ]);
    ticketEvent(id, username, "created", { category, priority, order_id: orderId, auction_id: auctionId });

    // SUP-015/§F: notify staff via TUCS admin alert (fire-and-forget).
    commsEvent("admin", "account.security", {
      subject: `New ${category} ticket #${id} from ${username}`,
      detail: subject,
    });
    void audit(username, "ticket.create", "tickets", id, "trust", { category, priority });
    return { ticket: { id, status: "open", sla_due_at: sla } };
  });

  on("GET", "/me/tickets/:id", (ctx) => {
    const username = ctx.requireUser();
    const t = ticketOfUser(Number(ctx.params.id), username);
    // Internal notes are NEVER exposed to the customer (SUP-007).
    const messages = all(
      `SELECT id, author, body, attachment, created_at
       FROM ticket_messages WHERE ticket_id = ? AND internal = 0 ORDER BY id ASC`,
      [t.id],
    );
    return { ticket: serializeTicket(t as unknown as Record<string, unknown>), messages };
  });

  on("POST", "/me/tickets/:id/reply", (ctx) => {
    const username = ctx.requireUser();
    const t = ticketOfUser(Number(ctx.params.id), username);
    if (t.status === "closed") throw new HttpError(400, "ticket is closed", "closed");
    const body = bodyStr(ctx, "body", { required: true, max: 20_000 });
    const attachment = parseAttachment(ctx);
    insert(`INSERT INTO ticket_messages(ticket_id, author, body, internal, attachment, created_at) VALUES(?,?,?,0,?,?)`, [
      t.id,
      username,
      body,
      attachment ? JSON.stringify(attachment) : null,
      nowIso(),
    ]);
    // A customer reply on a resolved ticket reopens it (SLA clock resets).
    if (t.status === "resolved") {
      run(`UPDATE tickets SET status = 'open', sla_due_at = ? WHERE id = ?`, [
        isoPlusHours(SLA_HOURS[t.priority] ?? 24),
        t.id,
      ]);
      ticketEvent(t.id, username, "reopened", {});
    } else {
      ticketEvent(t.id, username, "replied", {});
    }
    commsEvent("admin", "account.security", {
      subject: `Ticket #${t.id} — new customer reply`,
      detail: `${username}: ${body.slice(0, 120)}`,
    });
    return { ok: true };
  });

  on("POST", "/me/tickets/:id/csat", (ctx) => {
    const username = ctx.requireUser();
    const t = ticketOfUser(Number(ctx.params.id), username);
    if (t.status !== "resolved" && t.status !== "closed") {
      throw new HttpError(400, "CSAT is available after the ticket is resolved", "not_resolved");
    }
    if (t.csat_score != null) throw new HttpError(400, "CSAT already recorded", "already_rated");
    const score = bodyInt(ctx, "score");
    if (score == null || score < 1 || score > 5) {
      throw new HttpError(400, "score must be 1–5", "bad_field");
    }
    const comment = bodyStr(ctx, "comment", { max: 2000 });
    run(`UPDATE tickets SET csat_score = ?, csat_comment = ? WHERE id = ?`, [score, comment, t.id]);
    ticketEvent(t.id, username, "csat", { score, comment });
    return { ok: true };
  });

  // ── reports (TNS-001..003) ──────────────────────────────────────────────

  on("GET", "/me/reports", (ctx) => {
    const username = ctx.requireUser();
    const rows = all(`SELECT * FROM reports WHERE reporter = ? ORDER BY id DESC LIMIT 100`, [username]);
    return { reports: rows };
  });

  on("POST", "/me/reports", (ctx) => {
    const username = ctx.requireUser();
    const targetType = bodyEnum(ctx, "target_type", ["listing", "profile", "message", "order"] as const, {
      required: true,
    });
    const targetId = bodyStr(ctx, "target_id", { required: true, max: 60 });
    const reasonCode = bodyEnum(ctx, "reason_code", REASONS, { required: true });
    const note = bodyStr(ctx, "note", { max: 4000 });

    // Rate-shape guard: don't let one user spam the queue with duplicates.
    const dup = scalar(
      `SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND target_type = ? AND target_id = ? AND status IN('received','reviewing')`,
      [username, targetType, targetId],
    );
    if (dup > 0) {
      throw new HttpError(400, "you already have an open report for this target", "duplicate_report");
    }

    const id = insert(
      `INSERT INTO reports(reporter, target_type, target_id, reason_code, note, status, created_at)
       VALUES(?,?,?,?,?, 'received', ?)`,
      [username, targetType, targetId, reasonCode, note, nowIso()],
    );
    commsEvent("admin", "account.security", {
      subject: `New ${reasonCode} report #${id} from ${username}`,
      detail: `${targetType} ${targetId}${note ? ` — ${note.slice(0, 120)}` : ""}`,
    });
    void audit(username, "report.create", "reports", id, "trust", {
      target_type: targetType,
      target_id: targetId,
      reason_code: reasonCode,
    });
    return { report: { id, status: "received" } };
  });

  // ── disputes (MKT-024, CTL-012) ─────────────────────────────────────────

  on("GET", "/me/disputes", (ctx) => {
    const username = ctx.requireUser();
    const orderId = ctx.url.searchParams.get("order_id");
    const params: (string | number)[] = [username];
    let where = `c.kind = 'dispute' AND t.username = ?`;
    if (orderId) {
      where += ` AND t.order_id = ?`;
      params.push(Number(orderId));
    }
    const rows = all(
      `SELECT c.id, c.ticket_id, c.subject, c.status, c.outcome, c.created_at, c.resolved_at,
              c.risk_score, t.order_id, t.auction_id, t.status AS ticket_status
       FROM cases c JOIN tickets t ON t.id = c.ticket_id
       WHERE ${where} ORDER BY c.id DESC LIMIT 50`,
      params,
    );
    return { disputes: rows };
  });

  on("POST", "/me/disputes", (ctx) => {
    const username = ctx.requireUser();
    const orderId = bodyInt(ctx, "order_id", { required: true });
    const reasonCode = bodyEnum(ctx, "reason_code", DISPUTE_REASONS, { required: true });
    const note = bodyStr(ctx, "note", { required: true, max: 8000 });
    // Honest v1 (documented): the 7-day window check runs client-side against
    // the loaded order row; the server records the passed order snapshot in
    // the case evidence so reviewers can re-check it.
    const snapshot = bodyObj(ctx, "order");

    const existing = scalar(
      `SELECT COUNT(*) AS n FROM cases c JOIN tickets t ON t.id = c.ticket_id
       WHERE c.kind = 'dispute' AND t.order_id = ? AND c.status != 'resolved'`,
      [orderId],
    );
    if (existing > 0) {
      throw new HttpError(400, "a dispute is already open for this order", "duplicate_dispute");
    }

    const sellerUsername = String(snapshot.seller_username ?? "");
    const auctionTitle = String(snapshot.auction_title ?? `Order #${orderId}`);
    const sla = isoPlusHours(SLA_HOURS.high);
    const subject = `Dispute ${reasonCode.replace(/_/g, " ")} — ${auctionTitle.slice(0, 60)}`;
    const ticketId = insert(
      `INSERT INTO tickets(username, subject, category, priority, order_id, auction_id, status, sla_due_at, created_at)
       VALUES(?,?, 'order', 'urgent', ?, ?, 'open', ?, ?)`,
      [
        username,
        subject,
        orderId,
        snapshot.auction_id != null ? Number(snapshot.auction_id) : null,
        sla,
        nowIso(),
      ],
    );
    insert(`INSERT INTO ticket_messages(ticket_id, author, body, internal, created_at) VALUES(?,?,?,0,?)`, [
      ticketId,
      username,
      `[Dispute — ${reasonCode}]\n${note}`,
      nowIso(),
    ]);
    const caseId = insert(
      `INSERT INTO cases(ticket_id, subject, username, kind, status, evidence, risk_score, created_at, updated_at)
       VALUES(?,?,?, ?, 'open', ?, ?, ?, ?)`,
      [
        ticketId,
        subject,
        sellerUsername,
        "dispute",
        JSON.stringify({
          order_id: orderId,
          reason_code: reasonCode,
          note,
          order_snapshot: snapshot,
          window_rule: "7 days from delivered_at (checked client-side, snapshot recorded)",
        }),
        riskScore(sellerUsername),
        nowIso(),
        nowIso(),
      ],
    );
    ticketEvent(ticketId, username, "dispute.opened", { case_id: caseId, reason_code: reasonCode });
    commsEvent("admin", "account.security", {
      subject: `Dispute opened on order #${orderId}`,
      detail: `${username} vs ${sellerUsername || "seller"} — ${reasonCode}`,
    });
    if (sellerUsername) {
      void userNotice({
        username: sellerUsername,
        eventKey: "trust.dispute.opened",
        title: "A buyer opened a dispute on your order",
        body: `Order #${orderId} (${auctionTitle}): the buyer reported "${reasonCode.replace(/_/g, " ")}". Our Trust team will review — you can respond from My Tengasell → Support.`,
        link: "my/orders",
      });
    }
    void audit(username, "dispute.create", "cases", caseId, "trust", {
      order_id: orderId,
      reason_code: reasonCode,
    });
    return { ticket_id: ticketId, case_id: caseId };
  });

  // ── appeals (TNS-012, MKT-028) ──────────────────────────────────────────

  on("GET", "/me/appeals", (ctx) => {
    const username = ctx.requireUser();
    const rows = all(`SELECT * FROM appeals WHERE username = ? ORDER BY id DESC LIMIT 100`, [username]);
    return { appeals: rows };
  });

  // GET /me/enforcement — the signed-in user's own enforcement rows (the
  // appeal intake needs the enforcement_id; no existence leak beyond self).
  on("GET", "/me/enforcement", (ctx) => {
    const username = ctx.requireUser();
    const rows = all(
      `SELECT id, action, reason_code, note, status, requested_by, approved_by, created_at, lifts_at
       FROM enforcement WHERE username = ? ORDER BY id DESC LIMIT 50`,
      [username],
    );
    return { enforcement: rows };
  });

  on("POST", "/me/appeals", (ctx) => {
    const username = ctx.requireUser();
    const enforcementId = bodyInt(ctx, "enforcement_id", { required: true });
    const body = bodyStr(ctx, "body", { required: true, max: 8000 });
    const row = get<{ id: number; username: string; action: string }>(
      `SELECT id, username, action FROM enforcement WHERE id = ?`,
      [enforcementId],
    );
    if (!row || row.username !== username) {
      throw new HttpError(404, "enforcement action not found for this account", "not_found");
    }
    const already = scalar(
      `SELECT COUNT(*) AS n FROM appeals WHERE enforcement_id = ? AND status IN('received','under_review')`,
      [enforcementId],
    );
    if (already > 0) throw new HttpError(400, "an appeal is already under review", "duplicate_appeal");

    const id = insert(
      `INSERT INTO appeals(enforcement_id, username, body, status, created_at)
       VALUES(?,?,?, 'received', ?)`,
      [enforcementId, username, body, nowIso()],
    );
    commsEvent("admin", "account.security", {
      subject: `Appeal #${id} — ${username} contests ${row.action}`,
      detail: body.slice(0, 120),
    });
    void userNotice({
      username,
      eventKey: "trust.appeal.received",
      title: "We received your appeal",
      body: `Your appeal against the ${row.action} action is with our Trust & Safety reviewers. We aim to decide within 48 hours.`,
      link: "my/tickets",
    });
    void audit(username, "appeal.create", "appeals", id, "trust", {
      enforcement_id: enforcementId,
    });
    return { appeal: { id, status: "received" } };
  });
}
