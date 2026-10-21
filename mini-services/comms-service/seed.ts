// Idempotent demo seeder — POST /admin/seed-demo.
// Links VERIFIED emails for admin/simba/rufaro/chipo, sets representative
// preferences, emits a few events, and creates + runs ONE completed marketing
// campaign so the admin console has data on first open. Re-running is safe:
// every step checks for existing state first.

import { get, run, insert, scalar } from "./db";
import { nowIso } from "./util";
import { emitEvent } from "./emit";
import { upsertPrefs } from "./prefs";
import { EVENTS, MARKETING_KEYS } from "./taxonomy";
import type { ChannelPrefs } from "./taxonomy";

const USERS = ["admin", "simba", "rufaro", "chipo"] as const;
const CAMPAIGN_NAME = "NXS 1.0 Launch Digest";

function ensureLink(
  userId: string,
  channel: "email" | "telegram",
  handle: string,
  displayLabel: string,
): boolean {
  const existing = get<{ id: number; status: string }>(
    `SELECT id, status FROM channel_links WHERE user_id = ? AND channel = ? AND handle = ?`,
    [userId, channel, handle],
  );
  if (existing) {
    if (existing.status !== "verified") {
      run(`UPDATE channel_links SET status = 'verified', verified_at = ?, verify_code = NULL WHERE id = ?`, [
        nowIso(),
        existing.id,
      ]);
      return true; // promoted
    }
    return false; // already fine
  }
  insert(
    `INSERT INTO channel_links(user_id, channel, handle, display_label, status, verified_at, created_at)
     VALUES(?,?,?,?, 'verified', ?, ?)`,
    [userId, channel, handle, displayLabel, nowIso(), nowIso()],
  );
  return true;
}

function setPrefs(userId: string, eventKey: string, patch: Partial<ChannelPrefs>): void {
  upsertPrefs(userId, eventKey, patch);
}

export interface SeedSummary {
  alreadySeeded: boolean;
  linksEnsured: number;
  prefsSet: number;
  eventsEmitted: number;
  eventDetails: { userId: string; eventKey: string; queued: number }[];
  campaign: { id: number; name: string; alreadyExisted: boolean; queued: number; sent: number };
  deliveriesSimulated: number;
}

export async function seedDemo(): Promise<SeedSummary> {
  let linksEnsured = 0;
  let prefsSet = 0;

  // 1. Verified channel links.
  for (const name of USERS) {
    if (ensureLink(name, "email", `${name}@tengamail.co.zw`, `${name} (demo)`)) linksEnsured += 1;
  }
  if (ensureLink("simba", "telegram", "telegram:81001", "Simba on Telegram")) linksEnsured += 1;
  if (ensureLink("rufaro", "telegram", "telegram:81002", "Rufaro on Telegram")) linksEnsured += 1;

  // 2. Representative preferences.
  //    — transactional email ON for everyone
  for (const name of USERS) {
    for (const def of EVENTS) {
      if (def.group === "Marketing") continue;
      const row = get(`SELECT email FROM preferences WHERE user_id = ? AND event_key = ?`, [name, def.key]);
      if (!row) {
        setPrefs(name, def.key, { email: 1 });
        prefsSet += 1;
      }
    }
  }
  //    — simba + rufaro also telegram ON for auction events
  for (const name of ["simba", "rufaro"]) {
    for (const key of ["auction.won", "auction.outbid", "auction.ending_soon", "auction.sold", "auction.question"]) {
      const row = get(`SELECT telegram FROM preferences WHERE user_id = ? AND event_key = ?`, [name, key]);
      if (row?.telegram !== 1) {
        setPrefs(name, key, { telegram: 1 });
        prefsSet += 1;
      }
    }
  }
  //    — chipo marketing email opt-in ON
  for (const key of MARKETING_KEYS) {
    const row = get(`SELECT email FROM preferences WHERE user_id = 'chipo' AND event_key = ?`, [key]);
    if (row?.email !== 1) {
      setPrefs("chipo", key, { email: 1 });
      prefsSet += 1;
    }
  }

  // 3. Emit demo events (skip any that already have queue rows for that user).
  const demoEvents: {
    userId: string;
    eventKey: string;
    params: Record<string, string>;
    threadId?: string;
  }[] = [
    {
      userId: "simba",
      eventKey: "auction.won",
      params: { auctionTitle: "Vintage Nikon FM2 35mm camera", amount: "US$145.00", auctionId: "2005" },
    },
    {
      userId: "rufaro",
      eventKey: "auction.outbid",
      params: { auctionTitle: "Vintage Nikon FM2 35mm camera", amount: "US$150.00", auctionId: "2005" },
    },
    {
      userId: "simba",
      eventKey: "message.received",
      params: {
        fromLabel: "admin",
        snippet: "Congratulations on the win! Collection can be arranged in Harare CBD on Friday.",
      },
      threadId: "th-demo-1",
    },
    {
      userId: "chipo",
      eventKey: "booking.confirmed",
      params: { bookingRef: "BK-2031", bookingAt: "Fri 12 Dec · 10:00", location: "Tengasell Depot, Avondale, Harare" },
    },
    {
      userId: "admin",
      eventKey: "payment.reminder",
      params: {
        orderRef: "ORD-77216",
        itemName: "Vintage Nikon FM2 camera",
        amount: "US$145.00",
        dueAt: "Fri 12 Dec · 18:00",
      },
    },
  ];
  let eventsEmitted = 0;
  const eventDetails: { userId: string; eventKey: string; queued: number }[] = [];
  for (const ev of demoEvents) {
    const already = scalar(
      `SELECT COUNT(*) AS n FROM outbound_queue WHERE user_id = ? AND template_key = ? AND campaign_id IS NULL`,
      [ev.userId, ev.eventKey],
    );
    if (already > 0) continue;
    const out = await emitEvent({
      userId: ev.userId,
      eventKey: ev.eventKey,
      params: ev.params,
      locale: "en",
      threadId: ev.threadId ?? null,
    });
    if (out.queued > 0 || already === 0) {
      eventsEmitted += 1;
      eventDetails.push({ userId: ev.userId, eventKey: ev.eventKey, queued: out.queued });
    }
  }

  // 4. Marketing campaign — create (once), audience, run, then simulate open+click.
  let campaign = get<{ id: number; status: string }>(`SELECT id, status FROM campaigns WHERE name = ?`, [CAMPAIGN_NAME]);
  const alreadyExisted = campaign != null;
  if (!campaign) {
    const id = insert(
      `INSERT INTO campaigns(name, kind, status, segment_key, channels_json, template_key, locale, created_at, updated_at)
       VALUES(?, 'marketing', 'draft', 'all', ?, 'marketing.digest', 'en', ?, ?)`,
      [CAMPAIGN_NAME, JSON.stringify(["email"]), nowIso(), nowIso()],
    );
    campaign = { id, status: "draft" };
  }
  for (const name of USERS) {
    run(`INSERT OR IGNORE INTO campaign_audience(campaign_id, user_id) VALUES(?,?)`, [campaign.id, name]);
  }
  let queued = 0;
  if (campaign.status !== "done") {
    run(`UPDATE campaigns SET status = 'running', updated_at = ? WHERE id = ?`, [nowIso(), campaign.id]);
    // Only chipo has a marketing email opt-in — the run below respects that,
    // but we re-check per user/channel to stay correct if prefs changed.
    for (const name of USERS) {
      const already = get(`SELECT id FROM outbound_queue WHERE campaign_id = ? AND user_id = ? AND channel = 'email'`, [
        campaign.id,
        name,
      ]);
      if (already) continue;
      const out = await emitEvent({
        userId: name,
        eventKey: "marketing.digest",
        params: { spotlightTitle: "Vintage Nikon FM2 35mm camera", dealCount: "12" },
        locale: "en",
        campaignId: campaign.id,
      });
      queued += out.queued;
    }
    const remaining = scalar(
      `SELECT COUNT(*) AS n FROM outbound_queue WHERE campaign_id = ? AND status IN('queued','sending')`,
      [campaign.id],
    );
    run(`UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?`, [
      remaining === 0 ? "done" : "running",
      nowIso(),
      campaign.id,
    ]);
  }
  const sent = scalar(`SELECT COUNT(*) AS n FROM outbound_queue WHERE campaign_id = ? AND status = 'sent'`, [campaign.id]);

  // 5. Simulate open + click on the delivered marketing row (idempotent).
  let deliveriesSimulated = 0;
  const chipoRow = get<{ id: number }>(
    `SELECT id FROM outbound_queue WHERE campaign_id = ? AND user_id = 'chipo' AND channel = 'email' AND status = 'sent' ORDER BY id DESC LIMIT 1`,
    [campaign.id],
  );
  if (chipoRow) {
    for (const ev of ["open", "click"] as const) {
      const already = get(`SELECT id FROM deliveries WHERE queue_id = ? AND event = ?`, [chipoRow.id, ev]);
      if (!already) {
        run(`INSERT INTO deliveries(queue_id, event, meta_json, created_at) VALUES(?,?,?,?)`, [
          chipoRow.id,
          ev,
          JSON.stringify({ demo: true }),
          nowIso(),
        ]);
        deliveriesSimulated += 1;
      }
    }
  }

  return {
    alreadySeeded: alreadyExisted && eventsEmitted === 0,
    linksEnsured,
    prefsSet,
    eventsEmitted,
    eventDetails,
    campaign: { id: campaign.id, name: CAMPAIGN_NAME, alreadyExisted, queued, sent },
    deliveriesSimulated,
  };
}
