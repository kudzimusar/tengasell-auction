// First-party auction subscriptions & idempotent reminder ledger (UX-01 R3A).
// Stores subscriptions & deduplicated dispatch records strictly inside comms.db
// (SQLite) and delivers first-party in-app notifications ONLY.
// External channels (email, telegram, whatsapp, messenger) remain isolated at $0 spend.

import { APP_URL } from "./config";
import { all, execute, get, insert, run } from "./db";
import { defaultDeepLink } from "./emit";
import { getTemplate, interpolate } from "./templates";
import { nowIso, safeJsonParse, toIsoOut } from "./util";

export const R3A_EXTERNAL_LOCK = process.env.COMMS_ALLOW_EXTERNAL_R4 !== "1";

export type SubscriptionTargetType = "event" | "lot" | "auction";

export interface SubscriptionRow {
  id: number;
  user_id: string;
  target_type: SubscriptionTargetType;
  target_id: string;
  event_id: number | null;
  lot_id: number | null;
  session_id: number | null;
  auction_id: number | null;
  title: string;
  starts_at: string | null;
  status: "active" | "unsubscribed";
  channels_json: string;
  notify_24h: number;
  notify_1h: number;
  notify_live: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionOut {
  id: number;
  userId: string;
  targetType: SubscriptionTargetType;
  targetId: string;
  eventId: number | null;
  lotId: number | null;
  sessionId: number | null;
  auctionId: number | null;
  title: string;
  startsAt: string | null;
  status: "active" | "unsubscribed";
  channels: string[];
  notify24h: boolean;
  notify1h: boolean;
  notifyLive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LedgerRow {
  id: number;
  dedupe_key: string;
  subscription_id: number | null;
  user_id: string;
  target_type: string;
  target_id: string;
  reminder_stage: string;
  event_key: string;
  channel: string;
  status: string;
  payload_json: string;
  dispatched_at: string;
}

export interface SubscriptionInput {
  targetType: SubscriptionTargetType;
  targetId: string | number;
  eventId?: number | null;
  lotId?: number | null;
  sessionId?: number | null;
  auctionId?: number | null;
  title?: string | null;
  startsAt?: string | null;
  notify24h?: boolean;
  notify1h?: boolean;
  notifyLive?: boolean;
  locale?: string;
}

export interface ReminderTargetState {
  targetType: SubscriptionTargetType;
  targetId: string | number;
  startsAt?: string | null;
  isLive?: boolean;
  lotStatus?: "QUEUED" | "READY" | "LIVE" | "SOLD" | "PASSED" | "WITHDRAWN" | string;
  upNext?: boolean;
  openNow?: boolean;
  outbid?: boolean;
  outbidAmount?: string | number;
  result?: string | null;
  title?: string | null;
  eventId?: number | null;
  sessionId?: number | null;
  auctionId?: number | null;
  cycleKey?: string | null;
}

export interface EvaluateRemindersInput {
  nowIso?: string;
  userId?: string;
  locale?: string;
  targets?: ReminderTargetState[];
}

export interface EvaluateRemindersResult {
  ok: true;
  externalLocked: boolean;
  evaluatedSubscriptions: number;
  dispatched: number;
  skippedDuplicates: number;
  suppressedUnsubscribed: number;
  items: Array<{
    dedupeKey: string;
    userId: string;
    targetType: string;
    targetId: string;
    stage: string;
    eventKey: string;
    channel: "in_app";
    queueId: number;
  }>;
}

export function serializeSubscription(row: SubscriptionRow): SubscriptionOut {
  const channels = safeJsonParse<string[]>(row.channels_json, ["in_app"]).filter((c) => c === "in_app");
  return {
    id: row.id,
    userId: row.user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    eventId: row.event_id,
    lotId: row.lot_id,
    sessionId: row.session_id,
    auctionId: row.auction_id,
    title: row.title,
    startsAt: row.starts_at,
    status: row.status,
    channels: channels.length > 0 ? channels : ["in_app"],
    notify24h: row.notify_24h === 1,
    notify1h: row.notify_1h === 1,
    notifyLive: row.notify_live === 1,
    createdAt: toIsoOut(row.created_at),
    updatedAt: toIsoOut(row.updated_at),
  };
}

export function listSubscriptions(userId: string, includeUnsubscribed = false): SubscriptionOut[] {
  const rows = includeUnsubscribed
    ? all<SubscriptionRow>(
        `SELECT * FROM auction_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
        [userId],
      )
    : all<SubscriptionRow>(
        `SELECT * FROM auction_subscriptions WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC, id DESC`,
        [userId],
      );
  return rows.map(serializeSubscription);
}

function resolveSubscriptionDeepLink(
  eventKey: string,
  sub: Pick<SubscriptionRow, "event_id" | "session_id" | "auction_id" | "target_type" | "target_id">,
): string {
  const eventId = sub.event_id ?? (sub.target_type === "event" ? Number(sub.target_id) || null : null);
  const auctionId = sub.auction_id ?? (sub.target_type === "auction" ? Number(sub.target_id) || null : null);
  const sessionId = sub.session_id ?? null;
  return defaultDeepLink(eventKey, { eventId, sessionId, auctionId });
}

function recordFirstPartyReminder(opts: {
  dedupeKey: string;
  subscriptionId: number | null;
  userId: string;
  targetType: SubscriptionTargetType;
  targetId: string;
  stage: string;
  eventKey: string;
  params: Record<string, string | number | null | undefined>;
  deepLink: string;
  locale: string;
  now: string;
}): { dispatched: boolean; queueId: number | null } {
  const ledgerInsert = execute(
    `INSERT OR IGNORE INTO reminder_dispatch_ledger(
       dedupe_key, subscription_id, user_id, target_type, target_id,
       reminder_stage, event_key, channel, status, payload_json, dispatched_at
     ) VALUES(?,?,?,?,?,?,?,'in_app','dispatched',?,?)`,
    [
      opts.dedupeKey,
      opts.subscriptionId,
      opts.userId,
      opts.targetType,
      opts.targetId,
      opts.stage,
      opts.eventKey,
      JSON.stringify(opts.params),
      opts.now,
    ],
  );
  if (ledgerInsert.changes === 0) {
    return { dispatched: false, queueId: null };
  }

  const tpl = getTemplate(opts.eventKey, "short", opts.locale);
  const subject = tpl?.subject
    ? interpolate(tpl.subject, { ...opts.params, deepUrl: opts.deepLink })
    : `${opts.eventKey}: ${String(opts.params.title ?? opts.targetId)}`;

  const queueId = insert(
    `INSERT INTO outbound_queue(
       user_id, channel, handle, template_key, locale, subject, body_json, deep_link,
       status, attempts, sent_at, provider_msg_id, created_at
     ) VALUES(?, 'in_app', 'first-party', ?, ?, ?, ?, ?, 'sent', 1, ?, ?, ?)`,
    [
      opts.userId,
      opts.eventKey,
      opts.locale,
      subject,
      JSON.stringify(opts.params),
      opts.deepLink,
      opts.now,
      `first-party:${opts.dedupeKey}`,
      opts.now,
    ],
  );

  return { dispatched: true, queueId };
}

export function upsertSubscription(
  userId: string,
  input: SubscriptionInput,
): { subscription: SubscriptionOut; confirmDispatched: boolean } {
  const targetType = input.targetType;
  const targetId = String(input.targetId).trim();
  if (!targetId) {
    throw new Error("targetId is required");
  }
  const now = nowIso();
  const title = (input.title ?? "").trim().slice(0, 200) || `${targetType} #${targetId}`;
  const notify24h = input.notify24h === false ? 0 : 1;
  const notify1h = input.notify1h === false ? 0 : 1;
  const notifyLive = input.notifyLive === false ? 0 : 1;
  const eventId = input.eventId != null ? Number(input.eventId) : null;
  const lotId = input.lotId != null ? Number(input.lotId) : null;
  const sessionId = input.sessionId != null ? Number(input.sessionId) : null;
  const auctionId = input.auctionId != null ? Number(input.auctionId) : null;
  const startsAt = input.startsAt ?? null;
  const locale = input.locale || "en";

  // Check prior state to know whether confirmation notification is warranted cleanly
  const existing = get<SubscriptionRow>(
    `SELECT * FROM auction_subscriptions WHERE user_id = ? AND target_type = ? AND target_id = ?`,
    [userId, targetType, targetId],
  );

  let row: SubscriptionRow;
  if (existing) {
    run(
      `UPDATE auction_subscriptions
       SET event_id = COALESCE(?, event_id),
           lot_id = COALESCE(?, lot_id),
           session_id = COALESCE(?, session_id),
           auction_id = COALESCE(?, auction_id),
           title = CASE WHEN ? <> '' THEN ? ELSE title END,
           starts_at = COALESCE(?, starts_at),
           status = 'active',
           channels_json = '["in_app"]',
           notify_24h = ?,
           notify_1h = ?,
           notify_live = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        eventId,
        lotId,
        sessionId,
        auctionId,
        title,
        title,
        startsAt,
        notify24h,
        notify1h,
        notifyLive,
        now,
        existing.id,
      ],
    );
    row = get<SubscriptionRow>(`SELECT * FROM auction_subscriptions WHERE id = ?`, [existing.id])!;
  } else {
    const id = insert(
      `INSERT INTO auction_subscriptions(
         user_id, target_type, target_id, event_id, lot_id, session_id, auction_id,
         title, starts_at, status, channels_json, notify_24h, notify_1h, notify_live,
         created_at, updated_at
       ) VALUES(?,?,?,?,?,?,?,?,?, 'active', '["in_app"]', ?,?,?,?,?)`,
      [
        userId,
        targetType,
        targetId,
        eventId,
        lotId,
        sessionId,
        auctionId,
        title,
        startsAt,
        notify24h,
        notify1h,
        notifyLive,
        now,
        now,
      ],
    );
    row = get<SubscriptionRow>(`SELECT * FROM auction_subscriptions WHERE id = ?`, [id])!;
  }

  const deepLink = resolveSubscriptionDeepLink("auction.event.FollowConfirmed", row);
  const confirm = recordFirstPartyReminder({
    dedupeKey: `${userId}:${targetType}:${targetId}:follow_confirmed`,
    subscriptionId: row.id,
    userId,
    targetType,
    targetId,
    stage: "follow_confirmed",
    eventKey: "auction.event.FollowConfirmed",
    params: {
      title: row.title || title,
      eventId: row.event_id,
      sessionId: row.session_id,
      auctionId: row.auction_id,
    },
    deepLink,
    locale,
    now,
  });

  return { subscription: serializeSubscription(row), confirmDispatched: confirm.dispatched };
}

export function unsubscribeTarget(
  userId: string,
  targetType: SubscriptionTargetType,
  targetId: string | number,
): { ok: true; updated: boolean } {
  const idStr = String(targetId).trim();
  const res = execute(
    `UPDATE auction_subscriptions SET status = 'unsubscribed', updated_at = ? WHERE user_id = ? AND target_type = ? AND target_id = ?`,
    [nowIso(), userId, targetType, idStr],
  );
  return { ok: true, updated: res.changes > 0 };
}

export function evaluateDueReminders(input: EvaluateRemindersInput = {}): EvaluateRemindersResult {
  const nowStr = input.nowIso ?? nowIso();
  const nowMs = Date.parse(nowStr);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const locale = input.locale || "en";

  const subs = input.userId
    ? all<SubscriptionRow>(`SELECT * FROM auction_subscriptions WHERE user_id = ? ORDER BY id ASC`, [input.userId])
    : all<SubscriptionRow>(`SELECT * FROM auction_subscriptions ORDER BY id ASC`);

  const targetMap = new Map<string, ReminderTargetState>();
  for (const t of input.targets ?? []) {
    targetMap.set(`${t.targetType}:${String(t.targetId)}`, t);
  }

  let dispatched = 0;
  let skippedDuplicates = 0;
  let suppressedUnsubscribed = 0;
  let evaluatedSubscriptions = 0;
  const items: EvaluateRemindersResult["items"] = [];

  for (const sub of subs) {
    if (sub.status !== "active") {
      suppressedUnsubscribed += 1;
      continue;
    }
    evaluatedSubscriptions += 1;
    const override = targetMap.get(`${sub.target_type}:${sub.target_id}`);
    const startsAtStr = override?.startsAt ?? sub.starts_at;
    const startsMs = startsAtStr ? Date.parse(startsAtStr) : Number.NaN;
    const title = (override?.title ?? sub.title) || `${sub.target_type} #${sub.target_id}`;
    const eventId = override?.eventId ?? sub.event_id;
    const sessionId = override?.sessionId ?? sub.session_id;
    const auctionId = override?.auctionId ?? sub.auction_id;

    const candidateStages: Array<{
      stage: string;
      eventKey: string;
      extraParams?: Record<string, string | number | null | undefined>;
      dedupeSuffix?: string;
    }> = [];

    const isLive = override?.isLive === true || (Number.isFinite(startsMs) && startsMs <= safeNowMs);
    if (sub.target_type === "event" || sub.target_type === "auction") {
      if (isLive) {
        if (sub.notify_live === 1) {
          candidateStages.push({ stage: "live_now", eventKey: "auction.event.LiveNow" });
        }
      } else if (Number.isFinite(startsMs)) {
        const diffMs = startsMs - safeNowMs;
        if (diffMs > 0 && diffMs <= 3600_000 && sub.notify_1h === 1) {
          candidateStages.push({ stage: "starting_1h", eventKey: "auction.event.Starting1h" });
        } else if (diffMs > 3600_000 && diffMs <= 24 * 3600_000 && sub.notify_24h === 1) {
          candidateStages.push({ stage: "starting_24h", eventKey: "auction.event.Starting24h" });
        }
      }
    }

    if (sub.target_type === "lot") {
      if (override?.lotStatus === "READY" || override?.upNext === true) {
        candidateStages.push({ stage: "lot_up_next", eventKey: "auction.lot.UpNext" });
      }
      if (override?.lotStatus === "LIVE" || override?.openNow === true) {
        candidateStages.push({ stage: "lot_open_now", eventKey: "auction.lot.OpenNow" });
      }
    }

    if (override?.outbid === true) {
      candidateStages.push({
        stage: "live_outbid",
        eventKey: "auction.live.Outbid",
        extraParams: { amount: override.outbidAmount ?? "" },
        dedupeSuffix: override.cycleKey ? `:${override.cycleKey}` : "",
      });
    }

    if (override?.result) {
      candidateStages.push({
        stage: "live_result",
        eventKey: "auction.live.Result",
        extraParams: { outcome: override.result },
      });
    }

    for (const c of candidateStages) {
      const dedupeKey = `${sub.user_id}:${sub.target_type}:${sub.target_id}:${c.stage}${c.dedupeSuffix ?? ""}`;
      const deepLink = resolveSubscriptionDeepLink(c.eventKey, {
        event_id: eventId,
        session_id: sessionId,
        auction_id: auctionId,
        target_type: sub.target_type,
        target_id: sub.target_id,
      });
      const rec = recordFirstPartyReminder({
        dedupeKey,
        subscriptionId: sub.id,
        userId: sub.user_id,
        targetType: sub.target_type,
        targetId: sub.target_id,
        stage: c.stage,
        eventKey: c.eventKey,
        params: {
          title,
          startsAt: startsAtStr ?? "",
          eventId,
          sessionId,
          auctionId,
          ...(c.extraParams ?? {}),
        },
        deepLink: deepLink || `${APP_URL}/#/events`,
        locale,
        now: nowStr,
      });
      if (rec.dispatched && rec.queueId != null) {
        dispatched += 1;
        items.push({
          dedupeKey,
          userId: sub.user_id,
          targetType: sub.target_type,
          targetId: sub.target_id,
          stage: c.stage,
          eventKey: c.eventKey,
          channel: "in_app",
          queueId: rec.queueId,
        });
      } else {
        skippedDuplicates += 1;
      }
    }
  }

  return {
    ok: true,
    externalLocked: R3A_EXTERNAL_LOCK,
    evaluatedSubscriptions,
    dispatched,
    skippedDuplicates,
    suppressedUnsubscribed,
    items,
  };
}

export function listReminderLedger(userId: string, limit = 30) {
  return all<LedgerRow>(
    `SELECT * FROM reminder_dispatch_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [userId, limit],
  );
}
