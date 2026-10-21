// Event fan-out — POST /events core: resolve the user's preference rows
// (defaults applied when no rows exist; marketing.* requires explicit opt-in),
// then enqueue one outbound_queue row per verified linked channel, skipping
// suppressed handles and marketing frequency caps, and dispatch immediately.

import { APP_URL } from "./config";
import { all, get } from "./db";
import { CHANNELS, eventDef, isMarketingKey, type Channel } from "./taxonomy";
import { effectivePrefs } from "./prefs";
import { enqueue, dispatchRow, isSuppressed, marketingCapped } from "./queue";

export interface LinkRow {
  id: number;
  user_id: string;
  channel: Channel;
  handle: string;
  display_label: string | null;
  status: string;
  verify_token: string | null;
  verify_code: string | null;
  verified_at: string | null;
  created_at: string;
}

export function linksFor(userId: string): LinkRow[] {
  return all<LinkRow>(`SELECT * FROM channel_links WHERE user_id = ? ORDER BY channel ASC, id ASC`, [userId]);
}

/** Most recent VERIFIED link for user+channel (one queue row per channel). */
export function verifiedLink(userId: string, channel: string): LinkRow | null {
  return (
    get<LinkRow>(
      `SELECT * FROM channel_links
       WHERE user_id = ? AND channel = ? AND status = 'verified'
       ORDER BY verified_at DESC, id DESC LIMIT 1`,
      [userId, channel],
    ) ?? null
  );
}

/** Sensible on-platform deep links per event when the caller doesn't supply one. */
export function defaultDeepLink(
  eventKey: string,
  params: Record<string, string | number | null | undefined>,
  threadId?: string | null,
): string {
  const auctionItem = params.auctionId != null ? `${APP_URL}/#/item/${params.auctionId}` : null;
  switch (eventKey) {
    case "comms.verify":
      return `${APP_URL}/#/my/communications`;
    case "auction.won":
    case "auction.sold":
      return auctionItem ?? `${APP_URL}/#/my/bids`;
    case "auction.outbid":
    case "auction.ending_soon":
      return auctionItem ?? `${APP_URL}/#/my/bids`;
    case "auction.question":
      return auctionItem ?? `${APP_URL}/#/my/selling`;
    case "message.received":
      return threadId ? `${APP_URL}/#/messages?thread=${threadId}` : `${APP_URL}/#/messages`;
    case "payment.reminder":
    case "sla.warning":
      return `${APP_URL}/#/my/orders`;
    case "booking.confirmed":
    case "booking.reminder":
      return `${APP_URL}/#/my/bookings`;
    case "account.security":
      return `${APP_URL}/#/my/settings`;
    default:
      if (isMarketingKey(eventKey)) {
        return `${APP_URL}/#/?utm_source=comms&utm_medium=${encodeURIComponent(eventKey)}`;
      }
      return `${APP_URL}/#/`;
  }
}

export interface EmitInput {
  userId: string;
  eventKey: string;
  params: Record<string, string | number | null | undefined>;
  locale?: string;
  threadId?: string | null;
  deepLink?: string | null;
  campaignId?: number | null;
  scheduledAt?: string | null;
}

export interface EmitOutcome {
  queued: number;
  channels: Channel[];
}

export async function emitEvent(input: EmitInput): Promise<EmitOutcome> {
  const def = eventDef(input.eventKey);
  if (!def) return { queued: 0, channels: [] };
  const locale = input.locale || "en";
  const marketing = isMarketingKey(input.eventKey) || input.campaignId != null;
  const prefs = effectivePrefs(input.userId, input.eventKey);

  const queuedChannels: Channel[] = [];
  for (const channel of CHANNELS) {
    if (prefs[channel] !== 1) continue; // off for this user (marketing ⇒ requires explicit opt-in row)
    const link = verifiedLink(input.userId, channel);
    if (!link) continue; // no verified link ⇒ skip (email default ON still needs verification)
    if (isSuppressed(channel, link.handle)) continue;
    if (marketing && marketingCapped(input.userId, channel)) continue;
    const deepLink =
      input.deepLink && input.deepLink.trim() ? input.deepLink : defaultDeepLink(input.eventKey, input.params, input.threadId);
    const id = enqueue({
      userId: input.userId,
      channel,
      handle: link.handle,
      templateKey: input.eventKey,
      locale,
      params: input.params,
      deepLink,
      threadId: input.threadId ?? null,
      campaignId: input.campaignId ?? null,
      scheduledAt: input.scheduledAt ?? null,
    });
    await dispatchRow(id);
    queuedChannels.push(channel);
  }
  return { queued: queuedChannels.length, channels: queuedChannels };
}
