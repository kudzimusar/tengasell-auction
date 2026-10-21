// TUCS queue worker — in-process; sends immediately unless scheduled_at is in
// the future. Retry ≤ 3 with exponential backoff → status 'dead' + last_error.
// Marketing frequency cap: max 1 marketing send per user/channel/24h (checked
// against outbound_queue). Suppression checked before every send. Every
// marketing queue item mints an unsub_token at enqueue time.

import { APP_URL } from "./config";
import { get, run, insert, scalar, all, type SqlParam } from "./db";
import { getProvider } from "./providers";
import { interpolate, getTemplate } from "./templates";
import { nowIso, isoPlus, randToken, safeJsonParse } from "./util";
import { isMarketingKey } from "./taxonomy";

export interface QueueRow {
  id: number;
  user_id: string | null;
  channel: string | null;
  handle: string | null;
  template_key: string | null;
  locale: string | null;
  subject: string | null;
  body_json: string | null;
  deep_link: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  provider_msg_id: string | null;
  campaign_id: number | null;
  thread_id: string | null;
  unsub_token: string | null;
  created_at: string;
}

// ── Suppression ────────────────────────────────────────────────────────────────

export function isSuppressed(channel: string, handle: string): boolean {
  const row = get(`SELECT id FROM suppression WHERE channel = ? AND handle = ?`, [channel, handle]);
  return row != null;
}

export function addSuppression(channel: string, handle: string, reason: string): void {
  run(`INSERT OR IGNORE INTO suppression(channel, handle, reason) VALUES(?,?,?)`, [channel, handle, reason]);
}

// ── Marketing frequency cap ───────────────────────────────────────────────────

/** True when this user+channel already received/queued marketing in the last 24h. */
export function marketingCapped(userId: string, channel: string, excludeQueueId?: number): boolean {
  const exclude = excludeQueueId != null ? "AND id != ?" : "";
  const params = excludeQueueId != null ? [userId, channel, excludeQueueId] : [userId, channel];
  const n = scalar(
    `SELECT COUNT(*) AS n FROM outbound_queue
     WHERE user_id = ? AND channel = ?
       AND (template_key LIKE 'marketing.%' OR campaign_id IS NOT NULL)
       AND status IN('queued','sending','sent')
       AND datetime(COALESCE(sent_at, created_at)) >= datetime('now', '-24 hours')
       ${exclude}`,
    params as SqlParam[],
  );
  return n >= 1;
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export interface EnqueueInput {
  userId: string;
  channel: string;
  handle: string;
  templateKey: string;
  locale: string;
  params: Record<string, string | number | null | undefined>;
  deepLink: string | null;
  threadId?: string | null;
  campaignId?: number | null;
  scheduledAt?: string | null;
}

export function enqueue(input: EnqueueInput): number {
  const marketing = isMarketingKey(input.templateKey) || input.campaignId != null;
  const unsubToken = marketing ? randToken(16) : null;
  // Pre-render the subject so queued rows already show meaningful text.
  const tpl = getTemplate(input.templateKey, input.channel === "email" ? "email" : "short", input.locale);
  const subject = tpl?.subject ? interpolate(tpl.subject, input.params) : null;
  const id = insert(
    `INSERT INTO outbound_queue(user_id, channel, handle, template_key, locale, subject, body_json, deep_link,
       status, attempts, scheduled_at, campaign_id, thread_id, unsub_token, created_at)
     VALUES(?,?,?,?,?,?,?,?, 'queued', 0, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.channel,
      input.handle,
      input.templateKey,
      input.locale,
      subject,
      JSON.stringify(input.params),
      input.deepLink,
      input.scheduledAt ?? null,
      input.campaignId ?? null,
      input.threadId ?? null,
      unsubToken,
      nowIso(),
    ] as SqlParam[],
  );
  return id;
}

// ── Dispatch (worker) ─────────────────────────────────────────────────────────

function updateRow(id: number, fields: Record<string, SqlParam>): void {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  run(`UPDATE outbound_queue SET ${sets} WHERE id = ?`, [...keys.map((k) => fields[k]), id] as SqlParam[]);
}

export async function dispatchRow(id: number): Promise<void> {
  const row = get<QueueRow>(`SELECT * FROM outbound_queue WHERE id = ?`, [id]);
  if (!row || row.status !== "queued") return;
  if (row.scheduled_at && Date.parse(row.scheduled_at) > Date.now()) return; // future-scheduled
  // Paused campaign: hold its rows.
  if (row.campaign_id != null) {
    const camp = get<{ status: string }>(`SELECT status FROM campaigns WHERE id = ?`, [row.campaign_id]);
    if (camp && camp.status === "paused") return;
  }
  if (!row.channel || !row.handle || !row.template_key) {
    updateRow(row.id, { status: "dead", last_error: "incomplete queue row" });
    return;
  }
  // Suppression checked before EVERY send.
  if (isSuppressed(row.channel, row.handle)) {
    updateRow(row.id, { status: "dead", last_error: `suppressed: ${row.channel} ${row.handle}` });
    return;
  }
  const marketing = isMarketingKey(row.template_key) || row.campaign_id != null;
  if (marketing && marketingCapped(row.user_id ?? "", row.channel, row.id)) {
    updateRow(row.id, { status: "dead", last_error: "marketing frequency cap (1 per channel / 24h)" });
    return;
  }

  const locale = row.locale || "en";
  const isEmail = row.channel === "email";
  const tpl = getTemplate(row.template_key, isEmail ? "email" : "short", locale);
  if (!tpl) {
    updateRow(row.id, { status: "dead", last_error: `missing template ${row.template_key}/${locale}` });
    return;
  }
  const params = safeJsonParse<Record<string, string | number | null | undefined>>(row.body_json, {});
  const deepUrl = row.deep_link ?? `${APP_URL}/`;
  const unsubUrl =
    marketing && row.unsub_token ? `${APP_URL}/api/comms/unsub?token=${row.unsub_token}` : null;
  const full: Record<string, string | number | null | undefined> = {
    ...params,
    deepUrl,
    ...(unsubUrl ? { unsubUrl } : {}),
  };
  const subject = interpolate(tpl.subject ?? "", full);
  const bodyHtml = isEmail ? interpolate(tpl.body_html ?? "", full, { html: true }) : "";
  const bodyText = isEmail ? interpolate(tpl.body_text ?? "", full) : "";
  const shortText = interpolate(tpl.short_text ?? "", full);

  updateRow(row.id, { status: "sending", subject });

  const provider = getProvider(row.channel);
  let res;
  try {
    res = await provider.send({
      to: row.handle,
      subject,
      bodyHtml,
      bodyText,
      shortText,
      locale,
      queueId: row.id,
      deepLink: row.deep_link,
    });
  } catch (e) {
    res = { ok: false, providerMsgId: null, error: `provider threw: ${String(e)}` };
  }

  if (res.ok) {
    updateRow(row.id, {
      status: "sent",
      sent_at: nowIso(),
      provider_msg_id: res.providerMsgId,
      last_error: null,
    });
    return;
  }
  const attempts = row.attempts + 1;
  if (attempts >= 3) {
    updateRow(row.id, { status: "dead", attempts, last_error: res.error ?? "send failed" });
    return;
  }
  // Exponential backoff: 30s → 2min → 8min (capped at 3 attempts).
  const backoffMs = 30_000 * Math.pow(4, attempts - 1);
  updateRow(row.id, { status: "queued", attempts, last_error: res.error ?? "send failed", scheduled_at: isoPlus(backoffMs) });
}

/** Sweep all due rows (immediate + retry backoff). Used by the interval worker. */
export async function sweepQueue(): Promise<number> {
  const rows = allDue();
  for (const r of rows) {
    await dispatchRow(r.id);
  }
  return rows.length;
}

function allDue(): { id: number }[] {
  return all<{ id: number }>(
    `SELECT id FROM outbound_queue
     WHERE status = 'queued'
       AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime('now'))
     ORDER BY id ASC LIMIT 100`,
  );
}

// Hot-reload-safe sweeper: bun --hot re-evaluates this module; clear the old timer.
const SWEEPER_KEY = "__tucs_queue_sweeper__";
type SweeperGlobal = typeof globalThis & { [SWEEPER_KEY]?: ReturnType<typeof setInterval> };

export function startSweeper(intervalMs = 10_000): void {
  const g = globalThis as SweeperGlobal;
  if (g[SWEEPER_KEY]) clearInterval(g[SWEEPER_KEY]);
  g[SWEEPER_KEY] = setInterval(() => {
    sweepQueue().catch((e) => console.error("[comms] sweep error:", e));
  }, intervalMs);
}
