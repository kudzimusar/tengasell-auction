"use client";

// Tengasell — Admin Comms Console shared pieces (TUCS admin side, task 11-c).
// Contract types (worklog Task 11-plan §B), the RELATIVE admin fetch helper
// (/api/comms/admin/… — the BFF proxies :3005 and gates on the admin role),
// status chips and channel metadata shared by every console section.
//
// NXS note: chip classNames are built as PLAIN TEMPLATE LITERALS (never
// through cn()) — tailwind-merge treats the custom text-* size tokens and
// text-* colors as one group and would silently drop one of them.

import {
  Mail,
  MessageCircle,
  MessagesSquare,
  Send,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/tengasell/i18n";

// ── contract types (worklog Task 11-plan §B) ──────────────────────────

export type Channel = "email" | "telegram" | "whatsapp" | "messenger";
export const CHANNELS: Channel[] = ["email", "telegram", "whatsapp", "messenger"];

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "done";

export interface CampaignStats {
  resolved: number;
  queued: number;
  sent: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
}

export interface Campaign {
  id: number;
  name: string | null;
  kind?: string;
  status: CampaignStatus;
  segmentKey: string | null;
  channels: Channel[];
  templateKey: string | null;
  locale: string | null;
  scheduleAt: string | null;
  stats?: CampaignStats;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CommsHealth {
  status?: string;
  service?: string;
  port?: number;
  providers?: Partial<Record<Channel, string>>;
  queue?: { depth?: number; sent24h?: number; failed?: number };
  db?: string;
}

export interface QueueItem {
  id: number;
  userId: string | null;
  channel: Channel | null;
  handle: string | null;
  eventKey: string | null;
  locale?: string | null;
  subject: string | null;
  deepLink?: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "dead";
  attempts: number;
  lastError?: string | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  providerMsgId?: string | null;
  campaignId: number | null;
  threadId?: string | null;
  createdAt?: string | null;
}

export interface MockEmail {
  id: number;
  to: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  queueId: number | null;
  campaignId: number | null;
  createdAt: string | null;
}

export interface MockMessage {
  id: number;
  channel: Channel | null;
  chatId: string | null;
  role: "bot" | "user";
  text: string | null;
  queueId: number | null;
  createdAt: string | null;
}

export interface ModFlag {
  rule?: string;
  kind?: string;
  detail?: string;
}

export interface ModItem {
  id: number;
  threadId: string | null;
  direction: "in" | "out";
  fromUserId: string | null;
  toUserId: string | null;
  channel: string | null;
  contentOriginal: string | null;
  maskedContent: string | null;
  flags: ModFlag[];
  moderationStatus: "clean" | "masked" | "blocked" | "review";
  createdAt: string | null;
}

export interface SuppressionItem {
  id: number;
  channel: string | null;
  handle: string | null;
  reason: string | null;
  createdAt: string | null;
}

export interface SeedSummary {
  alreadySeeded?: boolean;
  linksEnsured?: number;
  prefsSet?: number;
  eventsEmitted?: number;
  campaign?: { id?: number; name?: string; queued?: number; sent?: number };
  deliveriesSimulated?: number;
}

// ── client helper — RELATIVE admin fetches with the TrailBase token ────

export async function commsAdminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/comms/admin${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) {
    throw new Error(data?.error ?? `Request failed (${res.status}).`);
  }
  return data;
}

// ── channel metadata ─────────────────────────────────────────────────

export const CHANNEL_ICONS: Record<Channel, LucideIcon> = {
  email: Mail,
  telegram: Send,
  whatsapp: MessageCircle,
  messenger: MessagesSquare,
};

export function useChannelLabel(channel: Channel | null | undefined): string {
  const { t } = useI18n();
  if (!channel || !(CHANNELS as (string | null)[]).includes(channel)) return "—";
  return t(`comms.channel.${channel}`);
}

// ── status chips (teal/gold law — zero blue/indigo) ───────────────────

export type ChipTone = "ok" | "warn" | "muted" | "danger" | "teal" | "gold";

const CHIP_TONES: Record<ChipTone, string> = {
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  muted: "bg-muted text-muted-foreground border-border",
  danger: "bg-danger/10 text-danger border-danger/30",
  teal: "bg-teal-tint text-teal-deep border-teal/30",
  gold: "bg-gold-soft text-gold-on border-gold/40",
};

export function AdminChip({
  tone,
  children,
  label,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <span
      aria-label={label}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-bold whitespace-nowrap ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function campaignStatusTone(status: CampaignStatus): ChipTone {
  switch (status) {
    case "running":
      return "teal";
    case "scheduled":
      return "warn";
    case "paused":
      return "gold";
    case "done":
      return "ok";
    default:
      return "muted";
  }
}

export function queueStatusTone(status: QueueItem["status"]): ChipTone {
  switch (status) {
    case "sent":
      return "ok";
    case "queued":
    case "sending":
      return "warn";
    case "failed":
    case "dead":
      return "danger";
    default:
      return "muted";
  }
}

export function modFlagTone(flag: ModFlag): ChipTone {
  if (flag.rule === "banned_word" || flag.rule === "fraud") return "danger";
  if (flag.rule === "gray") return "gold";
  if (flag.rule === "pii") return "warn";
  return "muted";
}

/** "pii" + kind phone → "pii.phone" chip text. */
export function flagLabel(flag: ModFlag): string {
  const rule = flag.rule ?? "flag";
  return flag.kind ? `${rule}.${flag.kind}` : rule;
}
