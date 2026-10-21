// Admin endpoints — campaign engine, queue viewer, mock channel viewers,
// moderation queue, suppression list, demo seeder. All require x-tgs-admin: 1.

import { HttpError, bodyArr, bodyOptStr, bodyStr, type AddRoute, type Ctx, type RouteHandler } from "../http";
import { all, get, insert, run, scalar } from "../db";
import { APP_URL } from "../config";
import { CHANNELS, EVENT_KEYS, isChannel, isMarketingKey } from "../taxonomy";
import { verifiedLink, emitEvent } from "../emit";
import { enqueue, dispatchRow, isSuppressed, marketingCapped } from "../queue";
import { effectivePrefs } from "../prefs";
import { toIsoOut, nowIso, clampInt, safeJsonParse } from "../util";
import { updateRelayStatus } from "../relay";
import type { QueueRow } from "../queue";
import { queueOut } from "./serialize";
import { seedDemo } from "../seed";

const admin = (handler: RouteHandler): RouteHandler => (ctx) => {
  ctx.requireAdmin();
  return handler(ctx);
};

interface CampaignRow {
  id: number;
  name: string | null;
  kind: string;
  status: string;
  segment_key: string | null;
  channels_json: string | null;
  template_key: string | null;
  locale: string | null;
  schedule_at: string | null;
  stats_json: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CampaignStats {
  resolved: number;
  queued: number;
  sent: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
}

export function campaignStats(campaignId: number): CampaignStats {
  const resolved = scalar(`SELECT COUNT(*) AS n FROM campaign_audience WHERE campaign_id = ?`, [campaignId]);
  const queued = scalar(`SELECT COUNT(*) AS n FROM outbound_queue WHERE campaign_id = ?`, [campaignId]);
  const sent = scalar(`SELECT COUNT(*) AS n FROM outbound_queue WHERE campaign_id = ? AND status = 'sent'`, [campaignId]);
  const opened = scalar(
    `SELECT COUNT(DISTINCT d.queue_id) AS n FROM deliveries d
     JOIN outbound_queue q ON q.id = d.queue_id
     WHERE q.campaign_id = ? AND d.event = 'open'`,
    [campaignId],
  );
  const clicked = scalar(
    `SELECT COUNT(DISTINCT d.queue_id) AS n FROM deliveries d
     JOIN outbound_queue q ON q.id = d.queue_id
     WHERE q.campaign_id = ? AND d.event = 'click'`,
    [campaignId],
  );
  const unsubscribed = scalar(
    `SELECT COUNT(DISTINCT d.queue_id) AS n FROM deliveries d
     JOIN outbound_queue q ON q.id = d.queue_id
     WHERE q.campaign_id = ? AND d.event = 'unsub'`,
    [campaignId],
  );
  return { resolved, queued, sent, opened, clicked, unsubscribed };
}

export function campaignOut(row: CampaignRow, stats?: CampaignStats): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    segmentKey: row.segment_key,
    channels: safeJsonParse<string[]>(row.channels_json, []),
    templateKey: row.template_key,
    locale: row.locale,
    scheduleAt: toIsoOut(row.schedule_at),
    stats: stats ?? campaignStats(row.id),
    createdAt: toIsoOut(row.created_at),
    updatedAt: toIsoOut(row.updated_at),
  };
}

function campaignById(id: number): CampaignRow {
  const row = get<CampaignRow>(`SELECT * FROM campaigns WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, "campaign not found", "not_found");
  return row;
}

function parseChannels(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const channels: string[] = [];
  for (const c of arr) {
    if (typeof c === "string" && isChannel(c) && !channels.includes(c)) channels.push(c);
  }
  if (channels.length === 0) throw new HttpError(400, `channels must be a non-empty subset of [${CHANNELS.join(", ")}]`, "bad_channels");
  return channels;
}

export function registerAdminRoutes(on: AddRoute): void {
  // POST /admin/campaigns {name,segmentKey,channels,templateKey,locale?,scheduleAt?}
  on(
    "POST",
    "/admin/campaigns",
    admin((ctx) => {
      const name = bodyStr(ctx, "name", { required: true, max: 160 });
      const templateKey = bodyStr(ctx, "templateKey", { required: true, max: 60 });
      if (!EVENT_KEYS.has(templateKey)) throw new HttpError(400, `unknown templateKey: ${templateKey}`, "unknown_template_key");
      const channels = parseChannels(ctx.body?.channels);
      const segmentKey = bodyOptStr(ctx, "segmentKey") ?? "all";
      const locale = bodyOptStr(ctx, "locale") ?? "en";
      const scheduleAt = bodyOptStr(ctx, "scheduleAt");
      const status = scheduleAt ? "scheduled" : "draft";
      const id = insert(
        `INSERT INTO campaigns(name, kind, status, segment_key, channels_json, template_key, locale, schedule_at, created_at, updated_at)
         VALUES(?, 'marketing', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, status, segmentKey, JSON.stringify(channels), templateKey, locale, scheduleAt, nowIso(), nowIso()],
      );
      return { campaign: campaignOut(campaignById(id)) };
    }),
  );

  // GET /admin/campaigns → campaigns with live stats
  on(
    "GET",
    "/admin/campaigns",
    admin(() => {
      const rows = all<CampaignRow>(`SELECT * FROM campaigns ORDER BY id DESC LIMIT 200`);
      return { campaigns: rows.map((r) => campaignOut(r)) };
    }),
  );

  // POST /admin/campaigns/:id/audience {userIds} → {resolved}
  on(
    "POST",
    "/admin/campaigns/:id/audience",
    admin((ctx) => {
      const camp = campaignById(Number(ctx.params.id));
      const userIds = bodyArr(ctx, "userIds")
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim().slice(0, 100));
      for (const userId of new Set(userIds)) {
        run(`INSERT OR IGNORE INTO campaign_audience(campaign_id, user_id) VALUES(?,?)`, [camp.id, userId]);
      }
      const resolved = scalar(`SELECT COUNT(*) AS n FROM campaign_audience WHERE campaign_id = ?`, [camp.id]);
      return { resolved };
    }),
  );

  // POST /admin/campaigns/:id/run → {started:true,queued}
  on(
    "POST",
    "/admin/campaigns/:id/run",
    admin(async (ctx) => {
      const camp = campaignById(Number(ctx.params.id));
      if (camp.status === "done") throw new HttpError(409, "campaign already completed", "already_done");
      const channels = safeJsonParse<string[]>(camp.channels_json, []);
      const templateKey = camp.template_key ?? "marketing.digest";
      const marketing = isMarketingKey(templateKey);
      const audience = all<{ user_id: string }>(
        `SELECT user_id FROM campaign_audience WHERE campaign_id = ? ORDER BY user_id ASC`,
        [camp.id],
      );

      run(`UPDATE campaigns SET status = 'running', updated_at = ? WHERE id = ?`, [nowIso(), camp.id]);

      let queued = 0;
      for (const { user_id } of audience) {
        for (const channel of channels) {
          if (!isChannel(channel)) continue;
          // verified link only
          const link = verifiedLink(user_id, channel);
          if (!link) continue;
          // marketing requires explicit opt-in (default OFF covers the rest)
          if (marketing && effectivePrefs(user_id, templateKey)[channel] !== 1) continue;
          if (isSuppressed(channel, link.handle)) continue;
          if (marketingCapped(user_id, channel)) continue;
          // idempotent re-runs: one row per campaign+user+channel
          const already = get(`SELECT id FROM outbound_queue WHERE campaign_id = ? AND user_id = ? AND channel = ?`, [
            camp.id,
            user_id,
            channel,
          ]);
          if (already) continue;
          const deepLink = `${APP_URL}/#/?utm_source=campaign&utm_campaign=${camp.id}`;
          const id = enqueue({
            userId: user_id,
            channel,
            handle: link.handle,
            templateKey,
            locale: camp.locale || "en",
            params: {},
            deepLink,
            campaignId: camp.id,
          });
          queued += 1;
          await dispatchRow(id);
        }
      }

      const remaining = scalar(
        `SELECT COUNT(*) AS n FROM outbound_queue WHERE campaign_id = ? AND status IN('queued','sending')`,
        [camp.id],
      );
      const finalStatus = remaining === 0 ? "done" : "running";
      run(`UPDATE campaigns SET status = ?, stats_json = ?, updated_at = ? WHERE id = ?`, [
        finalStatus,
        JSON.stringify(campaignStats(camp.id)),
        nowIso(),
        camp.id,
      ]);
      return { started: true, queued };
    }),
  );

  // POST /admin/campaigns/:id/pause → {ok:true}
  on(
    "POST",
    "/admin/campaigns/:id/pause",
    admin((ctx) => {
      const camp = campaignById(Number(ctx.params.id));
      if (camp.status === "done") throw new HttpError(409, "campaign already completed", "already_done");
      run(`UPDATE campaigns SET status = 'paused', updated_at = ? WHERE id = ?`, [nowIso(), camp.id]);
      return { ok: true };
    }),
  );

  // GET /admin/queue?status=&limit=
  on(
    "GET",
    "/admin/queue",
    admin((ctx) => {
      const status = ctx.url.searchParams.get("status");
      const limit = clampInt(ctx.url.searchParams.get("limit"), 50, 500);
      const rows = status
        ? all<QueueRow>(`SELECT * FROM outbound_queue WHERE status = ? ORDER BY id DESC LIMIT ?`, [status, limit])
        : all<QueueRow>(`SELECT * FROM outbound_queue ORDER BY id DESC LIMIT ?`, [limit]);
      return { items: rows.map(queueOut) };
    }),
  );

  // GET /admin/mock/inbox?limit= → {emails:[{id,to,subject,html,text,campaignId,createdAt}]}
  on(
    "GET",
    "/admin/mock/inbox",
    admin((ctx) => {
      const limit = clampInt(ctx.url.searchParams.get("limit"), 50, 500);
      const rows = all<{
        id: number;
        to_addr: string | null;
        subject: string | null;
        html: string | null;
        text: string | null;
        queue_id: number | null;
        campaign_id: number | null;
        created_at: string;
      }>(
        `SELECT m.*, q.campaign_id AS campaign_id
         FROM mock_inbox m LEFT JOIN outbound_queue q ON q.id = m.queue_id
         ORDER BY m.id DESC LIMIT ?`,
        [limit],
      );
      return {
        emails: rows.map((r) => ({
          id: r.id,
          to: r.to_addr,
          subject: r.subject,
          html: r.html,
          text: r.text,
          queueId: r.queue_id,
          campaignId: r.campaign_id,
          createdAt: toIsoOut(r.created_at),
        })),
      };
    }),
  );

  // GET /admin/mock/chats?channel=&chatId= → transcript rows
  on(
    "GET",
    "/admin/mock/chats",
    admin((ctx) => {
      const channel = ctx.url.searchParams.get("channel");
      const chatId = ctx.url.searchParams.get("chatId");
      const limit = clampInt(ctx.url.searchParams.get("limit"), 200, 1000);
      let sql = `SELECT * FROM mock_chats WHERE 1=1`;
      const params: (string | number)[] = [];
      if (channel) {
        sql += ` AND channel = ?`;
        params.push(channel);
      }
      if (chatId) {
        sql += ` AND chat_id = ?`;
        params.push(chatId);
      }
      sql += ` ORDER BY id ASC LIMIT ?`;
      params.push(limit);
      const rows = all<{
        id: number;
        channel: string | null;
        chat_id: string | null;
        role: string;
        text: string | null;
        queue_id: number | null;
        created_at: string;
      }>(sql, params);
      return {
        messages: rows.map((r) => ({
          id: r.id,
          channel: r.channel,
          chatId: r.chat_id,
          role: r.role,
          text: r.text,
          queueId: r.queue_id,
          createdAt: toIsoOut(r.created_at),
        })),
      };
    }),
  );

  // GET /admin/moderation?status=&limit= → relay_log rows
  on(
    "GET",
    "/admin/moderation",
    admin((ctx) => {
      const status = ctx.url.searchParams.get("status");
      const limit = clampInt(ctx.url.searchParams.get("limit"), 50, 500);
      const rows = status
        ? all(`SELECT * FROM relay_log WHERE moderation_status = ? ORDER BY id DESC LIMIT ?`, [status, limit])
        : all(`SELECT * FROM relay_log ORDER BY id DESC LIMIT ?`, [limit]);
      return {
        items: (rows as Record<string, unknown>[]).map((r) => ({
          id: r.id as number,
          threadId: (r.thread_id as string) ?? null,
          direction: r.direction as string,
          fromUserId: (r.from_user_id as string) ?? null,
          toUserId: (r.to_user_id as string) ?? null,
          channel: (r.channel as string) ?? null,
          contentOriginal: (r.content_original as string) ?? null,
          maskedContent: (r.masked_content as string) ?? null,
          flags: safeJsonParse(r.flags_json as string | null, []),
          moderationStatus: r.moderation_status as string,
          createdAt: toIsoOut(r.created_at),
        })),
      };
    }),
  );

  // POST /admin/moderation/:id/action {action:"approve"|"block"} → {ok:true}
  on(
    "POST",
    "/admin/moderation/:id/action",
    admin(async (ctx) => {
      const id = Number(ctx.params.id);
      const row = get<{
        id: number;
        thread_id: string | null;
        direction: "out" | "in";
        from_user_id: string | null;
        to_user_id: string | null;
        channel: string | null;
        content_original: string | null;
        masked_content: string | null;
        moderation_status: string;
      }>(`SELECT * FROM relay_log WHERE id = ?`, [id]);
      if (!row) throw new HttpError(404, "relay log not found", "not_found");
      const action = bodyStr(ctx, "action", { required: true, max: 20 });
      if (action !== "approve" && action !== "block") {
        throw new HttpError(400, 'action must be "approve" or "block"', "bad_action");
      }
      if (row.moderation_status !== "review") return { ok: true }; // idempotent no-op
      if (action === "block") {
        updateRelayStatus(id, "blocked");
        return { ok: true };
      }
      // approve → deliver held outbound messages to the recipient
      const masked = row.masked_content ?? "";
      const nextStatus = masked === (row.content_original ?? "") ? "clean" : "masked";
      updateRelayStatus(id, nextStatus);
      if (row.direction === "out" && row.to_user_id) {
        const fromLabel = row.from_user_id ?? "Tengasell user";
        const snippet = snippetOfMasked(masked);
        await emitEvent({
          userId: row.to_user_id,
          eventKey: "message.received",
          params: { fromLabel, snippet },
          threadId: row.thread_id,
          deepLink: null,
        });
      }
      return { ok: true };
    }),
  );

  // GET /admin/suppression → {items:[…]}
  on(
    "GET",
    "/admin/suppression",
    admin(() => {
      const rows = all(`SELECT * FROM suppression ORDER BY id DESC LIMIT 500`);
      return {
        items: (rows as Record<string, unknown>[]).map((r) => ({
          id: r.id as number,
          channel: (r.channel as string) ?? null,
          handle: (r.handle as string) ?? null,
          reason: (r.reason as string) ?? null,
          createdAt: toIsoOut(r.created_at),
        })),
      };
    }),
  );

  // POST /admin/seed-demo → idempotent demo seeder (see seed.ts)
  on(
    "POST",
    "/admin/seed-demo",
    admin(async () => {
      const summary = await seedDemo();
      return { ok: true, summary };
    }),
  );
}

function snippetOfMasked(masked: string): string {
  const flat = masked.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}
