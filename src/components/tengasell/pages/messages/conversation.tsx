"use client";

// Tengasell conversation pane — one thread: header (other party, subject,
// "View item →"), scrolling message history with day dividers, and the
// composer. Realtime via useResource(message:new). Sent messages append
// immediately after the promise resolves and dedupe when the event-driven
// refresh lands. The pane stays pinned to the bottom while the reader is
// there; a "New message ↓" jump chip appears when they scrolled up.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatDateTime, formatRelative } from "@/lib/tengasell/format";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import type { Message, Thread } from "@/lib/tengasell/types";
import { toast } from "@/hooks/use-toast";
import { Avatar, ErrorState } from "@/components/tengasell/ui";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import {
  dayKey,
  dayLabel,
  MESSAGE_EVENTS,
  otherParty,
  useInboundRelay,
  type RelayRow,
} from "./helpers";

interface ConversationProps {
  thread: Thread;
  meId: string;
  meUsername: string;
}

export function Conversation({ thread, meId, meUsername }: ConversationProps) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { locale } = useI18n();
  const { user } = useAuth();
  const party = otherParty(thread, meUsername, meId);

  const messagesRes = useResource(() => api.threadMessages(thread.id), [thread.id], {
    events: MESSAGE_EVENTS,
  });

  // messages sent from this pane — merged (deduped by id) with the fetched set
  const [appended, setAppended] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);

  const messages = useMemo(() => {
    const byId = new Map<number, Message>();
    for (const m of messagesRes.data ?? []) byId.set(m.id, m);
    for (const m of appended) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [messagesRes.data, appended]);

  // ── cross-channel inbound rows (TUCS mediated relay, Task 11-d) ────
  // Replies sent from Telegram / WhatsApp / email land in the comms relay
  // log — they merge additively into this conversation as received bubbles
  // with a small "via <channel>" badge. In-app messages stay untouched.
  const relay = useInboundRelay(user?.token, thread.id);

  type ChatEntry =
    | { key: string; at: string; message: Message }
    | { key: string; at: string; relayRow: RelayRow };

  const entries = useMemo<ChatEntry[]>(() => {
    const list: ChatEntry[] = messages.map((m) => ({
      key: `m${m.id}`,
      at: m.created_at,
      message: m,
    }));
    for (const r of relay.rows) {
      list.push({ key: `r${r.id}`, at: r.createdAt ?? "", relayRow: r });
    }
    list.sort((a, b) => a.at.localeCompare(b.at));
    return list;
  }, [messages, relay.rows]);

  const entryIsMine = (e: ChatEntry): boolean =>
    "message" in e
      ? e.message.user === meId || e.message.sender_username === meUsername
      : e.relayRow.fromUserId === meUsername;

  // ── scroll tracking (the Radix viewport is the real scroller) ───────
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | null>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    viewportRef.current = viewport;
    const onScroll = () => {
      const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 60;
      atBottomRef.current = nearBottom;
      if (nearBottom) setShowJump(false);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      viewportRef.current = null;
    };
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  };

  const jumpToLatest = () => {
    scrollToBottom(reduced ? "auto" : "smooth");
    setShowJump(false);
  };

  // auto-scroll: snap on first load, follow while pinned, chip when scrolled up
  const lastCountRef = useRef(0);
  useEffect(() => {
    const count = entries.length;
    const prev = lastCountRef.current;
    lastCountRef.current = count;
    if (count === 0 || prev === count) return;
    if (prev === 0) {
      scrollToBottom("auto");
      return;
    }
    const newest = entries[count - 1];
    const own = entryIsMine(newest);
    if (atBottomRef.current || own) {
      scrollToBottom(reduced ? "auto" : "smooth");
    } else {
      setShowJump(true);
    }
  });

  // ── send (append after resolve; bus event refresh dedupes by id) ────
  const send = async (body: string): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    try {
      const { message } = await api.sendMessage({ threadId: thread.id, body });
      setAppended((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      return true;
    } catch (err) {
      toast({
        title: "Message not sent",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setSending(false);
    }
  };

  // ── render ─────────────────────────────────────────────────────────
  const profileLink = useLinkProps(`/u/${party.username}`);
  const itemLink = useLinkProps(`/item/${thread.auction_id ?? ""}`);

  const rows: ReactNode[] = [];
  let lastDay = "";
  for (const e of entries) {
    const at = "message" in e ? e.message.created_at : e.relayRow.createdAt ?? "";
    const key = dayKey(at);
    if (key !== lastDay) {
      lastDay = key;
      rows.push(<DayDivider key={`day-${key}`} label={dayLabel(at)} />);
    }
    if ("message" in e) {
      rows.push(
        <MessageBubble
          key={e.key}
          message={e.message}
          mine={entryIsMine(e)}
          reduced={reduced}
        />,
      );
    } else {
      rows.push(
        <RelayBubble
          key={e.key}
          row={e.relayRow}
          mine={entryIsMine(e)}
          locale={locale}
          reduced={reduced}
        />,
      );
    }
  }

  return (
    <section
      className="rounded-card border border-border bg-raised overflow-hidden flex flex-col"
      aria-label={`Conversation with ${party.username}`}
    >
      {/* header */}
      <header className="flex items-center gap-2 p-3 border-b border-border">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back to messages"
          className="md:hidden size-11 -ms-1 shrink-0 grid place-items-center rounded-control hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <Avatar username={party.username} size={36} className="hidden sm:inline-flex" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a
              {...profileLink}
              className="text-label font-bold text-foreground hover:text-teal truncate transition-colors"
            >
              {party.username}
            </a>
            <span className="rounded-full bg-muted text-caption text-muted-foreground px-2 py-0.5 shrink-0">
              {party.isBuyer ? "Buyer" : "Seller"}
            </span>
          </div>
          <p className="text-caption text-muted-foreground truncate mt-0.5">
            {thread.subject || "Direct message"}
          </p>
        </div>
        {thread.auction_id != null && (
          <a
            {...itemLink}
            className="hidden min-[420px]:inline-flex items-center gap-0.5 min-h-11 px-2 text-caption font-semibold text-teal hover:underline shrink-0"
          >
            View item
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </header>

      {/* messages */}
      <div ref={scrollRootRef} className="relative flex flex-col max-h-[60svh] md:max-h-96 border-b border-border">
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-3" role="log" aria-label="Messages">
            {messagesRes.error ? (
              <div className="py-8">
                <ErrorState message={messagesRes.error} onRetry={messagesRes.reload} />
              </div>
            ) : messagesRes.loading && entries.length === 0 ? (
              <ConversationSkeleton />
            ) : entries.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-body text-foreground font-semibold">No messages yet</p>
                <p className="text-caption text-muted-foreground mt-1 max-w-xs mx-auto">
                  Say hello — {party.username} usually replies within a few hours.
                </p>
              </div>
            ) : (
              rows
            )}
          </div>
        </ScrollArea>

        {showJump && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none"
          >
            <button
              type="button"
              onClick={jumpToLatest}
              className="pointer-events-auto inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full bg-raised border border-border shadow-md text-label text-foreground hover:bg-section transition-colors focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              New message
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </motion.div>
        )}
      </div>

      {/* composer */}
      <Composer onSend={send} sending={sending} placeholder={`Message ${party.username}…`} />
    </section>
  );
}

// ── bubbles + dividers ───────────────────────────────────────────────

function MessageBubble({
  message,
  mine,
  reduced,
}: {
  message: Message;
  mine: boolean;
  reduced: boolean | null;
}) {
  return (
    <motion.div
      initial={reduced ? undefined : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn("flex flex-col mt-2", mine ? "items-end" : "items-start")}
    >
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[75%] rounded-xl px-3.5 py-2.5 text-body whitespace-pre-line break-words",
          mine
            ? "bg-teal text-white dark:text-primary-foreground rounded-ee-sm"
            : "bg-muted text-foreground border border-border/60 rounded-es-sm",
        )}
      >
        {message.body}
      </div>
      <span className="text-caption text-muted-foreground mt-1 px-1 flex items-center gap-1">
        <span className="font-semibold">{mine ? "You" : message.sender_username}</span>
        <span aria-hidden="true">·</span>
        <time title={formatDateTime(message.created_at)}>{formatRelative(message.created_at)}</time>
      </span>
    </motion.div>
  );
}

// ── cross-channel relay bubble (TUCS mediated relay, Task 11-d) ──────

const RELAY_CHANNEL_LABEL: Record<string, string> = {
  email: "comms.channel.email",
  telegram: "comms.channel.telegram",
  whatsapp: "comms.channel.whatsapp",
  messenger: "comms.channel.messenger",
};

/** "via WhatsApp" — locale-aware composition (ja: 「WhatsApp経由」). */
function viaLabel(
  channel: string | null,
  locale: string,
  t: (k: string) => string,
): string | null {
  if (!channel) return null;
  const key = RELAY_CHANNEL_LABEL[channel];
  const label = key ? t(key) : channel;
  const suffix = t("messages.viaSuffix");
  return locale === "ja" ? `${label}${suffix}` : `${suffix} ${label}`;
}

function RelayBubble({
  row,
  mine,
  locale,
  reduced,
}: {
  row: RelayRow;
  mine: boolean;
  locale: string;
  reduced: boolean | null;
}) {
  const { t } = useI18n();
  const via = viaLabel(row.channel, locale, t);
  const name = mine ? "You" : row.fromUserId ?? "Tengasell";
  const at = row.createdAt ?? "";
  return (
    <motion.div
      initial={reduced ? undefined : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn("flex flex-col mt-2", mine ? "items-end" : "items-start")}
    >
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[75%] rounded-xl px-3.5 py-2.5 text-body whitespace-pre-line break-words",
          mine
            ? "bg-teal text-white dark:text-primary-foreground rounded-ee-sm"
            : "bg-gold-soft/70 text-foreground border border-gold-deep/25 rounded-es-sm",
        )}
      >
        {row.maskedContent}
      </div>
      <span className="text-caption text-muted-foreground mt-1 px-1 flex items-center gap-1 flex-wrap">
        <span className="font-semibold">{name}</span>
        {via && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center rounded-full bg-teal-tint px-1.5 py-0.5 text-[11px] font-semibold text-teal-deep">
              {via}
            </span>
          </>
        )}
        {at && (
          <>
            <span aria-hidden="true">·</span>
            <time title={formatDateTime(at)}>{formatRelative(at)}</time>
          </>
        )}
      </span>
    </motion.div>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2 mt-1">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="text-caption text-muted-foreground font-semibold uppercase tracking-wide">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

function ConversationSkeleton() {
  const sides = [false, true, false, false, true, false];
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading messages">
      {sides.map((own, i) => (
        <div key={i} className={cn("flex", own ? "justify-end" : "justify-start")}>
          <div className={cn("h-12 rounded-xl animate-pulse", own ? "bg-teal-tint/50 w-40" : "bg-muted w-56")} />
        </div>
      ))}
    </div>
  );
}
