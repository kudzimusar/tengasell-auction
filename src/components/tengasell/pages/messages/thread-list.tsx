"use client";

// Tengasell thread list — the inbox pane of the messaging center.
// Rows show the other party, subject, one-line last-message preview (cached
// module-wide, kept live by message:new events), relative time, an unread
// dot (localStorage `ts_seen_threads` ledger) and — when the conversation is
// tied to a listing — the auction thumbnail + current price (cached fetch).

import { useEffect, useState } from "react";
import { Inbox, Search } from "lucide-react";
import { bus } from "@/lib/tengasell/bus";
import { formatRelative, formatUSD } from "@/lib/tengasell/format";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import { toAuctionView, type Auction, type Thread } from "@/lib/tengasell/types";
import { Avatar, EmptyState, ErrorState } from "@/components/tengasell/ui";
import { cn } from "@/lib/utils";
import {
  fetchThreadPreview,
  otherParty,
  peekPreview,
  threadUnread,
  useAuctionMeta,
} from "./helpers";

interface ThreadListProps {
  threads: Thread[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  activeId: number | null;
  meId: string;
  meUsername: string;
  seen: Map<number, number>;
  engineConnected: boolean;
  onSelect: (threadId: number, lastMessageAt: string | null) => void;
}

export function ThreadList({
  threads,
  loading,
  error,
  reload,
  activeId,
  meId,
  meUsername,
  seen,
  engineConnected,
  onSelect,
}: ThreadListProps) {
  const { t } = useI18n();
  const showSkeleton = loading && threads.length === 0;

  return (
    <section className="rounded-card border border-border bg-raised overflow-hidden" aria-label="Conversations">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <h1 className="text-title text-foreground">{t("nav.messages")}</h1>
          <p className="text-caption text-muted-foreground ts-numeric">
            {showSkeleton ? t("state.loading") : `${threads.length} conversation${threads.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-caption font-semibold text-muted-foreground shrink-0"
          title={
            engineConnected
              ? "Trade engine connected — messages arrive in realtime"
              : "Realtime engine offline — your inbox refreshes as you use Tengasell"
          }
        >
          <span
            className={cn(
              "size-2 rounded-full",
              engineConnected ? "bg-ok animate-pulse" : "bg-muted-foreground/40",
            )}
            aria-hidden="true"
          />
          <span className="sr-only">
            {engineConnected ? "Realtime engine live" : "Realtime engine offline"}
          </span>
          {engineConnected ? "Live" : "Offline"}
        </span>
      </header>

      {error ? (
        <div className="p-3">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : showSkeleton ? (
        <ThreadListSkeleton />
      ) : threads.length === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={<Inbox className="size-10" />}
            title="No conversations yet"
            body="Ask a seller a question from any listing — every reply lands here."
            action={<BrowseAuctionsButton />}
          />
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto ts-scrollbar">
          <ul className="divide-y divide-border">
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === activeId}
                meId={meId}
                meUsername={meUsername}
                unread={threadUnread(thread, seen) && thread.id !== activeId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── rows ─────────────────────────────────────────────────────────────

function ThreadRow({
  thread,
  active,
  meId,
  meUsername,
  unread,
  onSelect,
}: {
  thread: Thread;
  active: boolean;
  meId: string;
  meUsername: string;
  unread: boolean;
  onSelect: (threadId: number, lastMessageAt: string | null) => void;
}) {
  const party = otherParty(thread, meUsername, meId);
  const preview = useThreadPreview(thread);
  const { auction } = useAuctionMeta(thread.auction_id);
  const time = thread.last_message_at ? formatRelative(thread.last_message_at) : "New";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(thread.id, thread.last_message_at)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "w-full text-start flex items-center gap-3 p-3 min-h-16 transition-colors outline-none",
          "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
          active && "bg-teal-tint/60 dark:bg-teal-tint/40",
        )}
      >
        <Avatar username={party.username} size={40} />
        <span className="min-w-0 flex-1 block">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "text-label truncate",
                unread ? "font-bold text-foreground" : "font-semibold text-foreground",
              )}
            >
              {party.username}
            </span>
            {unread && (
              <span className="size-2 rounded-full bg-gold shrink-0" aria-hidden="true" />
            )}
            <span className="text-caption text-muted-foreground ms-auto shrink-0 ts-numeric">
              {time}
            </span>
          </span>
          <span className="block text-caption text-teal-deep dark:text-teal-soft truncate mt-0.5">
            {thread.subject || "Direct message"}
          </span>
          <span className="block text-caption text-muted-foreground truncate mt-0.5">
            {preview ?? "No messages yet"}
          </span>
        </span>
        {auction && <AuctionThumb auction={auction} />}
      </button>
    </li>
  );
}

function AuctionThumb({ auction }: { auction: Auction }) {
  const view = toAuctionView(auction);
  const img = view.imageList[0];
  if (!img) return null;
  return (
    <span className="flex flex-col items-end gap-0.5 shrink-0">
      <img
        src={img}
        alt=""
        loading="lazy"
        width={44}
        height={33}
        className="w-11 h-8 rounded-control object-cover border border-border"
      />
      <span className="text-caption ts-numeric font-semibold text-foreground">
        {formatUSD(view.current_price, { compact: true })}
      </span>
    </span>
  );
}

/** Preview text for a thread — cached fetch + live message:new updates. */
function useThreadPreview(thread: Thread): string | null {
  const [preview, setPreview] = useState<string | null>(() => peekPreview(thread.id));

  useEffect(() => {
    let alive = true;
    fetchThreadPreview(thread.id).then((text) => {
      if (alive && text != null) setPreview(text);
    });
    const off = bus.on("message:new", ({ message }) => {
      if (message && message.thread_id === thread.id && message.body) {
        setPreview(message.body);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [thread.id]);

  return preview;
}

function ThreadListSkeleton() {
  return (
    <ul className="divide-y divide-border" aria-busy="true" aria-label="Loading conversations">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex items-center gap-3 p-3">
          <div className="size-10 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="h-3.5 w-24 bg-muted rounded animate-pulse" />
            <div className="h-3 w-full bg-muted rounded animate-pulse" />
            <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function BrowseAuctionsButton() {
  const link = useLinkProps("/search");
  return (
    <a
      {...link}
      className="inline-flex items-center gap-2 min-h-11 px-5 rounded-control bg-primary text-primary-foreground text-label font-semibold hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Search className="size-4" aria-hidden="true" />
      Browse auctions
    </a>
  );
}
