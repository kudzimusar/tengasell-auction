// Webhooks + mock simulators + delivery events + unsubscribe.
// /hooks/* are PUBLIC (called by upstream platforms / simulators);
// /u/unsub authenticates by the per-queue-row unsub_token.
// Inbound messages run through the SAME moderation pipeline and ALWAYS persist
// relay_log with direction 'in'. Comms does NOT write to TrailBase — surfacing
// inbound into the app is Task 11-d's job (via the BFF).

import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError, bodyStr, bodyOptStr, type AddRoute } from "../http";
import { get, insert } from "../db";
import { WHATSAPP_APP_SECRET } from "../config";
import { getProvider, isMock } from "../providers";
import { moderateAndLog, counterpartOnThread } from "../relay";
import { recordMockChat } from "../providers/mock";
import { addSuppression } from "../queue";
import { prefsOffMarketing } from "../prefs";
import type { LinkRow } from "../emit";
import type { QueueRow } from "../queue";

const DELIVERY_EVENTS = new Set(["delivered", "open", "click", "bounce", "complaint", "unsub"]);

function verifiedLinkByHandle(channel: string, handle: string): LinkRow | null {
  return (
    get<LinkRow>(
      `SELECT * FROM channel_links
       WHERE channel = ? AND handle = ? AND status = 'verified'
       ORDER BY id DESC LIMIT 1`,
      [channel, handle],
    ) ?? null
  );
}

/** X-Hub-Signature-256 verification (only enforced when WHATSAPP_APP_SECRET is set). */
function verifyWaSignature(rawBody: string | null, header: string | null): boolean {
  if (!WHATSAPP_APP_SECRET) return true;
  if (!header || !rawBody) return false;
  const expected = `sha256=${createHmac("sha256", WHATSAPP_APP_SECRET).update(rawBody).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface InboundResult {
  ok: boolean;
  userId?: string;
  handle: string;
  moderationStatus: string;
  maskedContent?: string;
  flags?: unknown[];
  relayLogId: number;
}

/** Shared inbound pipeline: resolve sender link → moderate → persist relay_log('in'). */
function handleInboundMessage(
  channel: "telegram" | "whatsapp",
  handle: string,
  text: string,
  fromName: string | null,
  threadId: string | null = null,
): InboundResult {
  const link = verifiedLinkByHandle(channel, handle);
  if (!link) {
    throw new HttpError(404, `no verified ${channel} link for handle ${handle}`, "unlinked_chat");
  }
  // In mock mode, mirror the inbound text into the transcript (role 'user').
  // Always echo into the LINK's own chat so the user bubble joins the same
  // transcript group as the bot bubbles, whatever handle form addressed it
  // (task 11-c: handles linked verbatim like "tg:<id>" must not fork chats).
  if (isMock(channel)) {
    recordMockChat(channel, link.handle, "user", text, null);
  }
  // Task 11-d (additive): when the simulator carries a threadId, bind the
  // relay row to that thread and resolve the counterpart participant —
  // exactly like email-inbound does via the relay address.
  const toUserId = threadId ? counterpartOnThread(threadId, link.user_id) : null;
  const mod = moderateAndLog(text, {
    direction: "in",
    threadId,
    fromUserId: link.user_id,
    toUserId,
    channel,
    senderId: link.user_id,
    // per-thread rate limit does not apply: inbound platform chats have no thread
    skipRateLimit: true,
  });
  const out: InboundResult = {
    ok: mod.status !== "blocked",
    userId: link.user_id,
    handle,
    moderationStatus: mod.status,
    relayLogId: mod.logId,
  };
  if (mod.maskedContent !== text) out.maskedContent = mod.maskedContent;
  if (mod.flags.length > 0) out.flags = mod.flags;
  return out;
}

function queueById(id: number): QueueRow {
  const row = get<QueueRow>(`SELECT * FROM outbound_queue WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, "queue row not found", "not_found");
  return row;
}

function recordDelivery(queueId: number, event: string, meta: Record<string, unknown> | null): void {
  insert(`INSERT INTO deliveries(queue_id, event, meta_json, created_at) VALUES(?,?,?,datetime('now'))`, [
    queueId,
    event,
    meta ? JSON.stringify(meta) : null,
  ]);
}

export function registerHookRoutes(on: AddRoute): void {
  // ── Telegram Bot API webhook ─────────────────────────────────────────────
  on("POST", "/hooks/telegram", (ctx) => {
    const provider = getProvider("telegram");
    if (!provider.parseInbound) throw new HttpError(501, "telegram inbound parsing unavailable", "no_parser");
    const parsed = provider.parseInbound(ctx.body);
    if (parsed.messages.length === 0) return { ok: true, processed: 0, results: [] };
    const results = parsed.messages.map((m) => handleInboundMessage("telegram", m.handle, m.text, m.fromName));
    return { ok: true, processed: results.length, results };
  });

  // ── Telegram mock simulator — user replies inside the bot chat ────────────
  // Task 11-d (additive): optional {threadId} binds the reply to an app thread.
  // The canonical Bot API handle is "telegram:<chat_id>"; the wizard also
  // accepts the human "tg:<chat_id>" shorthand verbatim (task 11-c), so the
  // simulator resolves EITHER form to the linked handle before relaying.
  on("POST", "/hooks/mock/telegram/:chatId", (ctx) => {
    const chatId = ctx.params.chatId;
    const text = bodyStr(ctx, "text", { required: true, max: 4000 });
    const threadId = bodyOptStr(ctx, "threadId");
    const handle =
      verifiedLinkByHandle("telegram", `telegram:${chatId}`)?.handle ??
      verifiedLinkByHandle("telegram", `tg:${chatId}`)?.handle ??
      `telegram:${chatId}`;
    const result = handleInboundMessage("telegram", handle, text, null, threadId);
    return { ok: result.ok, userId: result.userId, threadId, moderation: { status: result.moderationStatus, maskedContent: result.maskedContent }, relayLogId: result.relayLogId };
  });

  // ── WhatsApp Cloud API webhook (signature verified when secret set) ───────
  on("POST", "/hooks/whatsapp", (ctx) => {
    if (!verifyWaSignature(ctx.rawBody, ctx.req.headers.get("x-hub-signature-256"))) {
      throw new HttpError(401, "invalid x-hub-signature-256", "bad_signature");
    }
    const provider = getProvider("whatsapp");
    if (!provider.parseInbound) throw new HttpError(501, "whatsapp inbound parsing unavailable", "no_parser");
    const parsed = provider.parseInbound(ctx.body);
    const results = parsed.messages.map((m) => handleInboundMessage("whatsapp", m.handle, m.text, m.fromName));
    let statuses = 0;
    for (const s of parsed.statuses) {
      const q = get<QueueRow>(`SELECT * FROM outbound_queue WHERE provider_msg_id = ?`, [s.messageId]);
      if (!q) continue;
      const mapped = mapWaStatus(s.status);
      if (!mapped) continue;
      recordDelivery(q.id, mapped.event, { waStatus: s.status, to: s.to });
      if (mapped.suppress) addSuppression(q.channel ?? "whatsapp", q.handle ?? "", `wa_status:${s.status}`);
      statuses += 1;
    }
    return { ok: true, processed: results.length, statuses, results };
  });

  // ── WhatsApp mock simulator ────────────────────────────────────────────────
  on("POST", "/hooks/mock/whatsapp/:waId", (ctx) => {
    const waId = ctx.params.waId;
    const text = bodyStr(ctx, "text", { required: true, max: 4000 });
    // Task 11-d (additive): optional {threadId} binds the reply to an app thread.
    const threadId = bodyOptStr(ctx, "threadId");
    const result = handleInboundMessage("whatsapp", `whatsapp:${waId}`, text, null, threadId);
    return { ok: result.ok, userId: result.userId, threadId, moderation: { status: result.moderationStatus, maskedContent: result.maskedContent }, relayLogId: result.relayLogId };
  });

  // ── Email inbound — {to:"thread-<threadId>@relay.tengasell.local", from, text}
  on("POST", "/hooks/email-inbound", (ctx) => {
    const to = bodyStr(ctx, "to", { required: true, max: 320 }).toLowerCase();
    const from = bodyStr(ctx, "from", { required: true, max: 320 }).toLowerCase();
    const text = bodyStr(ctx, "text", { required: true, max: 100_000 });
    const m = /^thread-([a-z0-9_-]+)@relay\.tengasell\.local$/.exec(to);
    if (!m) throw new HttpError(400, `to must match thread-<threadId>@relay.tengasell.local`, "bad_relay_address");
    const threadId = m[1]!;
    const link = verifiedLinkByHandle("email", from);
    if (!link) throw new HttpError(404, `no verified email link for ${from}`, "unlinked_sender");
    const counterpart = counterpartOnThread(threadId, link.user_id);
    const mod = moderateAndLog(text, {
      direction: "in",
      threadId,
      fromUserId: link.user_id,
      toUserId: counterpart,
      channel: "email",
      senderId: link.user_id,
    });
    const moderation: Record<string, unknown> = { status: mod.status, flags: mod.flags };
    if (mod.maskedContent !== text) moderation.maskedContent = mod.maskedContent;
    return { ok: mod.status !== "blocked", threadId, from: link.user_id, to: counterpart, moderation, relayLogId: mod.logId };
  });

  // ── Delivery events — {queueId, event, meta?} ─────────────────────────────
  on("POST", "/hooks/delivery", (ctx) => {
    const queueId = Number(bodyStr(ctx, "queueId", { required: true, max: 20 }));
    if (!Number.isInteger(queueId) || queueId <= 0) throw new HttpError(400, "queueId must be a positive integer", "bad_queue_id");
    const event = bodyStr(ctx, "event", { required: true, max: 20 });
    if (!DELIVERY_EVENTS.has(event)) {
      throw new HttpError(400, `event must be one of ${[...DELIVERY_EVENTS].join(", ")}`, "bad_event");
    }
    const row = queueById(queueId);
    const meta = (ctx.body?.meta && typeof ctx.body.meta === "object" ? ctx.body.meta : null) as Record<string, unknown> | null;
    recordDelivery(row.id, event, meta);
    if (event === "bounce" || event === "complaint" || event === "unsub") {
      if (row.channel && row.handle) addSuppression(row.channel, row.handle, `delivery:${event}`);
      if (row.user_id && row.channel) prefsOffMarketing(row.user_id, row.channel);
    }
    return { ok: true };
  });

  // ── One-click unsubscribe — POST /u/unsub {token} ──────────────────────────
  on("POST", "/u/unsub", (ctx) => {
    const token = bodyStr(ctx, "token", { required: true, max: 80 });
    const row = get<QueueRow>(`SELECT * FROM outbound_queue WHERE unsub_token = ?`, [token]);
    if (!row) throw new HttpError(404, "unknown unsubscribe token", "not_found");
    // Task 11-d (additive): let the BFF landing page tell repeats from first use.
    const alreadyUnsubscribed = !!(
      row.channel &&
      row.handle &&
      get(`SELECT id FROM suppression WHERE channel = ? AND handle = ?`, [row.channel, row.handle])
    );
    if (row.channel && row.handle) addSuppression(row.channel, row.handle, "unsub_link");
    if (row.user_id && row.channel) prefsOffMarketing(row.user_id, row.channel);
    recordDelivery(row.id, "unsub", { token });
    return { ok: true, channel: row.channel, handle: row.handle, suppressed: true, alreadyUnsubscribed };
  });
}

function mapWaStatus(status: string): { event: string; suppress?: boolean } | null {
  switch (status) {
    case "sent":
    case "delivered":
      return { event: "delivered" };
    case "read":
      return { event: "open" };
    case "failed":
      return { event: "bounce", suppress: true };
    default:
      return null; // e.g. "deleted"
  }
}
