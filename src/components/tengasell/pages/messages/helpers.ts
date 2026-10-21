"use client";

// Tengasell messaging helpers — module-level caches + small utilities shared
// by the messaging center (thread list, conversation pane, new-message pane):
//   · auction cache — thumbnails + price for listing-bound conversations
//     (fetch each auction once per session, never per render)
//   · last-message preview cache — seeded by fetches, kept live by the
//     `message:new` bus event (socket trade engine / local demo store)
//   · the "seen threads" read ledger persisted in localStorage
//     (`ts_seen_threads`) → unread dots
//   · cross-channel inbound relay rows (TUCS, Task 11-d) — messages that
//     arrived from outside the app (Telegram / WhatsApp / email-inbound)
//     through the comms-service moderated relay
//   · day divider keys/labels and other-party resolution

import { useEffect, useState } from "react";
import { api } from "@/lib/tengasell/api";
import { bus } from "@/lib/tengasell/bus";
import type { BusEvent } from "@/lib/tengasell/bus";
import type { Auction, Message, Thread } from "@/lib/tengasell/types";

/** Bus events that refresh messaging resources (realtime thread updates). */
export const MESSAGE_EVENTS: BusEvent[] = ["message:new"];

// ── auction cache (thread thumbnails + current price) ────────────────
const auctionCache = new Map<number, Promise<Auction | null>>();

export function getAuctionCached(id: number): Promise<Auction | null> {
  const existing = auctionCache.get(id);
  if (existing) return existing;
  const pending = api.auction(id);
  auctionCache.set(id, pending);
  // drop rejected promises so a later mount can retry
  pending.catch(() => auctionCache.delete(id));
  return pending;
}

/** Auction meta for a thread's listing (cached module-wide, single fetch). */
export function useAuctionMeta(
  auctionId: number | null,
): { auction: Auction | null; loaded: boolean } {
  const [meta, setMeta] = useState<{ auction: Auction | null; loaded: boolean }>({
    auction: null,
    loaded: false,
  });

  useEffect(() => {
    let alive = true;
    if (auctionId == null) return;
    getAuctionCached(auctionId)
      .then((auction) => {
        if (alive) setMeta({ auction, loaded: true });
      })
      .catch(() => {
        if (alive) setMeta({ auction: null, loaded: true });
      });
    return () => {
      alive = false;
    };
  }, [auctionId]);

  return meta;
}

// ── last-message previews ────────────────────────────────────────────
const previewCache = new Map<number, string>();
const previewInflight = new Map<number, Promise<string | null>>();

export function peekPreview(threadId: number): string | null {
  return previewCache.get(threadId) ?? null;
}

/** One-line last-message preview for a thread (fetches once, cached). */
export function fetchThreadPreview(threadId: number): Promise<string | null> {
  const cached = previewCache.get(threadId);
  if (cached != null) return Promise.resolve(cached);
  const inflight = previewInflight.get(threadId);
  if (inflight) return inflight;
  const pending = api
    .threadMessages(threadId)
    .then((messages) => {
      const last = messages[messages.length - 1];
      const text = last ? last.body : null;
      if (text != null) previewCache.set(threadId, text);
      return text;
    })
    .catch(() => null)
    .finally(() => previewInflight.delete(threadId));
  previewInflight.set(threadId, pending);
  return pending;
}

/** Keep the preview cache live when a message:new bus event arrives. */
export function notePreviewFromEvent(message: Message | undefined): void {
  if (!message || !message.body) return;
  previewCache.set(message.thread_id, message.body);
}

// ── seen threads (localStorage `ts_seen_threads`) ─────────────────────
// Stored shape: { [threadId]: epochMsOfLastRead } — a thread is unread
// while its last message is newer than the recorded read timestamp.
const SEEN_KEY = "ts_seen_threads";
const seenCache = new Map<number, number>();

function loadSeen(): Map<number, number> {
  const out = new Map<number, number>();
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const id = Number(key);
          if (Number.isFinite(id) && typeof value === "number" && value > 0) {
            out.set(id, value);
          }
        }
      }
    }
  } catch {
    /* corrupted or unavailable storage — start fresh */
  }
  return out;
}

export function loadSeenThreads(): Map<number, number> {
  if (seenCache.size === 0 && typeof window !== "undefined") {
    for (const [id, at] of loadSeen()) seenCache.set(id, at);
  }
  return seenCache;
}

export function persistSeenThreads(seen: Map<number, number>): void {
  try {
    const record: Record<string, number> = {};
    for (const [id, at] of seen) record[String(id)] = at;
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(record));
  } catch {
    /* private mode — keep the ledger in memory only */
  }
}

/** A thread is unread when its last message is newer than the last read. */
export function threadUnread(thread: Thread, seen: Map<number, number>): boolean {
  if (!thread.last_message_at) return false;
  const lastMs = Date.parse(thread.last_message_at);
  if (isNaN(lastMs)) return false;
  const seenAt = seen.get(thread.id);
  return seenAt == null || lastMs > seenAt;
}

// ── cross-channel inbound relay rows (TUCS mediated relay) ──────────
// One mediated-relay row per external reply: GET /api/comms/relay?threadId=
// → {items:[…]} filtered user-scoped server-side. Only direction='in' rows
// with a delivered moderation verdict surface as received bubbles.

export interface RelayRow {
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

const RELAY_REFRESH_MS = 20_000;

/** Inbound relay rows for one thread (polled lightly + refreshed on message:new). */
export function useInboundRelay(
  token: string | null | undefined,
  threadId: number,
): { rows: RelayRow[]; loaded: boolean } {
  const [state, setState] = useState<{ rows: RelayRow[]; loaded: boolean }>({
    rows: [],
    loaded: false,
  });

  useEffect(() => {
    if (!token) return;
    let alive = true;

    const load = () => {
      fetch(`/api/comms/relay?threadId=${encodeURIComponent(threadId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { items?: RelayRow[] } | null) => {
          if (!alive) return;
          // Only cross-channel INBOUND rows with a delivered verdict render —
          // outbound rows duplicate the in-app messages themselves.
          const rows = (data?.items ?? []).filter(
            (r) =>
              r.direction === "in" &&
              (r.moderationStatus === "clean" || r.moderationStatus === "masked"),
          );
          setState({ rows, loaded: true });
        })
        .catch(() => {
          /* comms unavailable — keep whatever we have; messages still work */
        });
    };

    load();
    const iv = setInterval(load, RELAY_REFRESH_MS);
    const off = bus.on("message:new", load);
    return () => {
      alive = false;
      clearInterval(iv);
      off();
    };
  }, [token, threadId]);

  return state;
}

// ── conversation parties ─────────────────────────────────────────────
export interface ThreadParty {
  username: string;
  /** true when the other party is the buyer in this thread */
  isBuyer: boolean;
}

export function otherParty(
  thread: Thread,
  meUsername: string | null,
  meId?: string | null,
): ThreadParty {
  const iAmBuyer =
    (meId != null && thread.buyer_user === meId) || thread.buyer_username === meUsername;
  return iAmBuyer
    ? { username: thread.seller_username, isBuyer: false }
    : { username: thread.buyer_username, isBuyer: true };
}

// ── day dividers ("Today", "Yesterday", 12 Mar 2026) ─────────────────
function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diffDays = Math.round((startOfDayMs(new Date()) - startOfDayMs(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
