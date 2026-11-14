// First-party auction subscriptions & idempotent reminder ledger (UX-01 R3A).
// Stores subscriptions & deduplicated dispatch records strictly inside comms.db
// (SQLite) and delivers first-party in-app notifications ONLY.
// External channels (email, telegram, whatsapp, messenger) remain isolated at $0 spend.

import { APP_URL, TRAILBASE_URL } from "./config";
import { db, all, execute, get, insert, run } from "./db";
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

export interface CanonicalTarget {
  targetType: SubscriptionTargetType;
  targetId: string;
  eventId: number | null;
  lotId: number | null;
  sessionId: number | null;
  auctionId: number | null;
  title: string;
  startsAt: string | null;
  status: string;
  isLive: boolean;
}

export type TargetResolver = (
  targetType: SubscriptionTargetType,
  targetId: string,
) => Promise<CanonicalTarget | null> | CanonicalTarget | null;

let customResolver: TargetResolver | null = null;

export function setCustomTargetResolver(fn: TargetResolver | null): void {
  customResolver = fn;
}

const FALLBACK_SEED_CATALOGUE: Record<string, CanonicalTarget> = {
  "event:901": {
    targetType: "event",
    targetId: "901",
    eventId: 901,
    lotId: null,
    sessionId: 1,
    auctionId: null,
    title: "Harare Executive & Utility Fleet Live Auction",
    startsAt: "2026-11-20T10:00:00Z",
    status: "LIVE",
    isLive: true,
  },
  "event:902": {
    targetType: "event",
    targetId: "902",
    eventId: 902,
    lotId: null,
    sessionId: 2,
    auctionId: null,
    title: "Weekend Hybrid & Passenger Showcase",
    startsAt: "2026-11-21T10:00:00Z",
    status: "SCHEDULED",
    isLive: false,
  },
  "event:903": {
    targetType: "event",
    targetId: "903",
    eventId: 903,
    lotId: null,
    sessionId: null,
    auctionId: null,
    title: "Event Cancelled Demonstration",
    startsAt: "2026-11-22T10:00:00Z",
    status: "CANCELLED",
    isLive: false,
  },
  "lot:9401": {
    targetType: "lot",
    targetId: "9401",
    eventId: 901,
    lotId: 9401,
    sessionId: 1,
    auctionId: 9101,
    title: "Lot #1 · 2021 Toyota Hilux Double Cab",
    startsAt: "2026-11-20T10:00:00Z",
    status: "LIVE",
    isLive: true,
  },
  "lot:9101": {
    targetType: "lot",
    targetId: "9101",
    eventId: 901,
    lotId: 9401,
    sessionId: 1,
    auctionId: 9101,
    title: "Lot #1 · 2021 Toyota Hilux Double Cab",
    startsAt: "2026-11-20T10:00:00Z",
    status: "LIVE",
    isLive: true,
  },
  "lot:9402": {
    targetType: "lot",
    targetId: "9402",
    eventId: 901,
    lotId: 9402,
    sessionId: 1,
    auctionId: 9102,
    title: "Lot #2 · 2022 Isuzu D-Max 3.0 Ddi V-Cross",
    startsAt: "2026-11-20T10:30:00Z",
    status: "READY",
    isLive: false,
  },
  "lot:9102": {
    targetType: "lot",
    targetId: "9102",
    eventId: 901,
    lotId: 9402,
    sessionId: 1,
    auctionId: 9102,
    title: "Lot #2 · 2022 Isuzu D-Max 3.0 Ddi V-Cross",
    startsAt: "2026-11-20T10:30:00Z",
    status: "READY",
    isLive: false,
  },
  "auction:9101": {
    targetType: "auction",
    targetId: "9101",
    eventId: null,
    lotId: null,
    sessionId: 1,
    auctionId: 9101,
    title: "2021 Toyota Hilux Double Cab 2.8 GD-6 4x4",
    startsAt: "2026-11-20T10:00:00Z",
    status: "live",
    isLive: true,
  },
};

export async function resolveCanonicalTarget(
  targetType: SubscriptionTargetType,
  targetId: string | number,
): Promise<CanonicalTarget | null> {
  const idStr = String(targetId).trim();
  if (!idStr) return null;

  if (customResolver) {
    return await customResolver(targetType, idStr);
  }

  try {
    if (targetType === "event") {
      const res = await fetch(`${TRAILBASE_URL}/api/records/v1/auction_events/${idStr}`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const ev = await res.json();
        if (ev && ev.status !== "DRAFT") {
          return {
            targetType: "event",
            targetId: String(ev.id),
            eventId: Number(ev.id),
            sessionId: ev.session_id != null ? Number(ev.session_id) : null,
            auctionId: null,
            lotId: null,
            title: String(ev.title || `Event #${ev.id}`),
            startsAt: ev.starts_at ? String(ev.starts_at) : null,
            status: String(ev.status || "SCHEDULED"),
            isLive: String(ev.status).toUpperCase() === "LIVE",
          };
        }
      }
    } else if (targetType === "lot") {
      let lot: any = null;
      const res = await fetch(`${TRAILBASE_URL}/api/records/v1/auction_lots/${idStr}`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        lot = await res.json();
      } else {
        const listRes = await fetch(
          `${TRAILBASE_URL}/api/records/v1/auction_lots?auction_id=${encodeURIComponent(idStr)}`,
          { signal: AbortSignal.timeout(1500) },
        );
        if (listRes.ok) {
          const listData = (await listRes.json()) as { records?: any[] };
          if (listData?.records && listData.records.length > 0) {
            lot = listData.records[0];
          }
        }
      }

      if (lot) {
        let eventTitle = `Lot #${lot.sequence_no ?? lot.id}`;
        let eventStartsAt: string | null = null;
        if (lot.event_id != null) {
          const evRes = await fetch(`${TRAILBASE_URL}/api/records/v1/auction_events/${lot.event_id}`, {
            signal: AbortSignal.timeout(1500),
          });
          if (evRes.ok) {
            const ev = await evRes.json();
            if (ev.status === "DRAFT") return null;
            eventTitle = String(ev.title || eventTitle);
            eventStartsAt = ev.starts_at ? String(ev.starts_at) : null;
          }
        }
        let auctionTitle = "";
        if (lot.auction_id != null) {
          const aucRes = await fetch(`${TRAILBASE_URL}/api/records/v1/auctions/${lot.auction_id}`, {
            signal: AbortSignal.timeout(1500),
          });
          if (aucRes.ok) {
            const auc = await aucRes.json();
            if (auc.status === "draft") return null;
            auctionTitle = String(auc.title || "");
          }
        }
        return {
          targetType: "lot",
          targetId: idStr,
          eventId: lot.event_id != null ? Number(lot.event_id) : null,
          sessionId: lot.session_id != null ? Number(lot.session_id) : null,
          auctionId: lot.auction_id != null ? Number(lot.auction_id) : null,
          lotId: Number(lot.id),
          title: auctionTitle ? `${auctionTitle} · ${eventTitle}` : eventTitle,
          startsAt: lot.opened_at ? String(lot.opened_at) : eventStartsAt,
          status: String(lot.status || "QUEUED"),
          isLive: String(lot.status).toUpperCase() === "LIVE",
        };
      }

      // If not an auction_lot record, check if it's an auction that can be followed as a lot
      const aucRes = await fetch(`${TRAILBASE_URL}/api/records/v1/auctions/${idStr}`, {
        signal: AbortSignal.timeout(1500),
      });
      if (aucRes.ok) {
        const auc = await aucRes.json();
        if (auc && auc.status !== "draft") {
          return {
            targetType: "lot",
            targetId: idStr,
            eventId: null,
            sessionId: auc.live_session_id != null ? Number(auc.live_session_id) : null,
            auctionId: Number(auc.id),
            lotId: Number(auc.id),
            title: String(auc.title || `Auction #${auc.id}`),
            startsAt: auc.started_at ? String(auc.started_at) : auc.ends_at ? String(auc.ends_at) : null,
            status: String(auc.status || "live"),
            isLive: ["live", "active", "running"].includes(String(auc.status).toLowerCase()),
          };
        }
      }
    } else if (targetType === "auction") {
      const res = await fetch(`${TRAILBASE_URL}/api/records/v1/auctions/${idStr}`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const auc = await res.json();
        if (auc && auc.status !== "draft") {
          return {
            targetType: "auction",
            targetId: String(auc.id),
            eventId: null,
            sessionId: auc.live_session_id != null ? Number(auc.live_session_id) : null,
            auctionId: Number(auc.id),
            lotId: null,
            title: String(auc.title || `Auction #${auc.id}`),
            startsAt: auc.started_at ? String(auc.started_at) : auc.ends_at ? String(auc.ends_at) : null,
            status: String(auc.status || "live"),
            isLive: String(auc.status).toLowerCase() === "live",
          };
        }
      }
    }
  } catch {
    // TrailBase unreachable; fall back to seed catalogue
  }

  const fallback =
    FALLBACK_SEED_CATALOGUE[`${targetType}:${idStr}`] ??
    (targetType === "lot" ? FALLBACK_SEED_CATALOGUE[`auction:${idStr}`] : null);
  if (fallback) return { ...fallback, targetType, targetId: idStr };
  return null;
  return null;
}

export const recordFirstPartyReminderTx = db.transaction((opts: {
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
}): { dispatched: boolean; queueId: number | null } => {
  const ledgerInsert = execute(
    `INSERT OR IGNORE INTO reminder_dispatch_ledger(
       dedupe_key, subscription_id, user_id, target_type, target_id,
       reminder_stage, event_key, channel, status, payload_json, dispatched_at
     ) VALUES(?,?,?,?,?,?,?,'in_app','queued',?,?)`,
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
     ) VALUES(?, 'in_app', 'first-party', ?, ?, ?, ?, ?, 'queued', 0, NULL, ?, ?)`,
    [
      opts.userId,
      opts.eventKey,
      opts.locale,
      subject,
      JSON.stringify(opts.params),
      opts.deepLink,
      `first-party:${opts.dedupeKey}`,
      opts.now,
    ],
  );

  return { dispatched: true, queueId };
});

export function recordFirstPartyReminder(opts: Parameters<typeof recordFirstPartyReminderTx>[0]) {
  return recordFirstPartyReminderTx(opts);
}

export async function upsertSubscription(
  userId: string,
  input: SubscriptionInput,
): Promise<{ subscription: SubscriptionOut; confirmDispatched: boolean }> {
  const targetType = input.targetType;
  const targetId = String(input.targetId).trim();
  if (!targetId) {
    throw new Error("targetId is required");
  }

  // Canonical resolution of target
  const canonical = await resolveCanonicalTarget(targetType, targetId);
  if (!canonical) {
    throw new Error(`Target not found in canonical catalogue: ${targetType} #${targetId}`);
  }

  const now = nowIso();
  const title = canonical.title;
  const startsAt = canonical.startsAt;
  const eventId = canonical.eventId;
  const lotId = canonical.lotId;
  const sessionId = canonical.sessionId;
  const auctionId = canonical.auctionId;

  const notify24h = input.notify24h === false ? 0 : 1;
  const notify1h = input.notify1h === false ? 0 : 1;
  const notifyLive = input.notifyLive === false ? 0 : 1;
  const locale = input.locale || "en";

  const existing = get<SubscriptionRow>(
    `SELECT * FROM auction_subscriptions WHERE user_id = ? AND target_type = ? AND target_id = ?`,
    [userId, targetType, targetId],
  );

  let row: SubscriptionRow;
  if (existing) {
    run(
      `UPDATE auction_subscriptions
       SET event_id = ?,
           lot_id = ?,
           session_id = ?,
           auction_id = ?,
           title = ?,
           starts_at = ?,
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
      title: row.title,
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

export async function evaluateDueReminders(input: EvaluateRemindersInput = {}): Promise<EvaluateRemindersResult> {
  const nowStr = input.nowIso ?? nowIso();
  const nowMs = Date.parse(nowStr);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const locale = input.locale || "en";

  const subs = input.userId
    ? all<SubscriptionRow>(`SELECT * FROM auction_subscriptions WHERE user_id = ? ORDER BY id ASC`, [input.userId])
    : all<SubscriptionRow>(`SELECT * FROM auction_subscriptions ORDER BY id ASC`);

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

    // Resolve canonical target record to ensure fresh schedule and live status
    const canonical = await resolveCanonicalTarget(sub.target_type, sub.target_id);
    const startsAtStr = canonical?.startsAt ?? sub.starts_at;
    const startsMs = startsAtStr ? Date.parse(startsAtStr) : Number.NaN;
    const title = canonical?.title ?? sub.title;
    const eventId = canonical?.eventId ?? sub.event_id;
    const sessionId = canonical?.sessionId ?? sub.session_id;
    const auctionId = canonical?.auctionId ?? sub.auction_id;
    const isActuallyLive = canonical ? canonical.isLive : false;

    const candidateStages: Array<{
      stage: string;
      eventKey: string;
      extraParams?: Record<string, string | number | null | undefined>;
      dedupeSuffix?: string;
    }> = [];

    // Pre-event clock reminders ONLY based on scheduled start time
    if (Number.isFinite(startsMs) && !isActuallyLive) {
      const diffMs = startsMs - safeNowMs;
      if (diffMs > 0 && diffMs <= 3600_000 && sub.notify_1h === 1) {
        candidateStages.push({ stage: "starting_1h", eventKey: "auction.event.Starting1h" });
      } else if (diffMs > 3600_000 && diffMs <= 24 * 3600_000 && sub.notify_24h === 1) {
        candidateStages.push({ stage: "starting_24h", eventKey: "auction.event.Starting24h" });
      }
    }

    // Live state is ONLY evaluated when the canonical target is ACTUALLY LIVE in the database!
    // Clock arrival (startsMs <= safeNowMs) does NOT emit LiveNow unless the event is LIVE.
    if ((sub.target_type === "event" || sub.target_type === "auction") && isActuallyLive) {
      if (sub.notify_live === 1) {
        candidateStages.push({ stage: "live_now", eventKey: "auction.event.LiveNow" });
      }
    }

    // For lots: check canonical lot status
    if (sub.target_type === "lot" && canonical) {
      if (canonical.status === "READY" || canonical.status === "UP_NEXT") {
        candidateStages.push({ stage: "lot_up_next", eventKey: "auction.lot.UpNext" });
      } else if (canonical.status === "LIVE" || canonical.isLive) {
        candidateStages.push({ stage: "lot_open_now", eventKey: "auction.lot.OpenNow" });
      }
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
