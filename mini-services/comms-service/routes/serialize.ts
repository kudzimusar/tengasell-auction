// camelCase row serializers (contract section B response shapes).

import type { LinkRow } from "../emit";
import type { QueueRow } from "../queue";
import type { RelayLogRow } from "../relay";
import { getTemplate, interpolate } from "../templates";
import { safeJsonParse, toIsoOut } from "../util";

export interface LinkOut {
  id: number;
  channel: string;
  handle: string;
  displayLabel: string | null;
  status: string;
  createdAt: string | null;
  verifiedAt: string | null;
}

export function linkOut(row: LinkRow): LinkOut {
  return {
    id: row.id,
    channel: row.channel,
    handle: row.handle,
    displayLabel: row.display_label,
    status: row.status,
    createdAt: toIsoOut(row.created_at),
    verifiedAt: toIsoOut(row.verified_at),
  };
}

// Task 11-d — additive: /me/relay row shape (cross-channel reply surfacing).
export interface RelayOut {
  id: number;
  threadId: string | null;
  direction: "out" | "in";
  fromUserId: string | null;
  toUserId: string | null;
  channel: string | null;
  maskedContent: string | null;
  moderationStatus: string;
  createdAt: string | null;
}

export function relayOut(row: RelayLogRow): RelayOut {
  return {
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    channel: row.channel,
    maskedContent: row.masked_content,
    moderationStatus: row.moderation_status,
    createdAt: toIsoOut(row.created_at),
  };
}

export interface QueueOut {
  id: number;
  userId: string | null;
  channel: string | null;
  handle: string | null;
  eventKey: string | null;
  locale: string | null;
  subject: string | null;
  deepLink: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  providerMsgId: string | null;
  campaignId: number | null;
  threadId: string | null;
  createdAt: string | null;
}

export function queueOut(row: QueueRow): QueueOut {
  return {
    id: row.id,
    userId: row.user_id,
    channel: row.channel,
    handle: row.handle,
    eventKey: row.template_key,
    locale: row.locale,
    subject: row.subject,
    deepLink: row.deep_link,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    scheduledAt: toIsoOut(row.scheduled_at),
    sentAt: toIsoOut(row.sent_at),
    providerMsgId: row.provider_msg_id,
    campaignId: row.campaign_id,
    threadId: row.thread_id,
    createdAt: toIsoOut(row.created_at),
  };
}

/** One-line snippet for notification items (re-rendered from the template + params). */
export function notificationSnippet(row: QueueRow, max = 140): string {
  const params = safeJsonParse<Record<string, string | number | null | undefined>>(row.body_json, {});
  const channel: "email" | "short" = row.channel === "email" ? "email" : "short";
  const tpl = getTemplate(row.template_key ?? "", channel, row.locale || "en");
  let s = "";
  if (tpl) {
    const src = channel === "email" ? (tpl.body_text ?? tpl.subject ?? "") : (tpl.short_text ?? tpl.subject ?? "");
    s = interpolate(src, { ...params, deepUrl: row.deep_link ?? "" }).replace(/\s+/g, " ").trim();
  }
  if (!s) {
    const fallback = params.snippet ?? params.auctionTitle ?? params.securityNote ?? params.spotlightTitle ?? row.subject ?? "";
    s = String(fallback).replace(/\s+/g, " ").trim();
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
