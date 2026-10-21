"use client";

// Tengasell messaging center — member-to-member conversations tied to
// listings: #/messages, #/messages/{id} and #/messages?to={username}.
// Two panes on desktop (340px inbox | conversation), single pane on mobile
// (list → tap → conversation, back returns to the inbox).
//
// Realtime: the thread list and the open conversation both subscribe to the
// `message:new` bus event (socket.io trade engine in live mode, the local
// demo store otherwise) through useResource({ events }) — new messages
// refresh the inbox, the open history, unread dots and previews instantly.

import { useCallback, useEffect, useState } from "react";
import { LogIn, Mail, MessageSquare } from "lucide-react";
import { api } from "@/lib/tengasell/api";
import { bus } from "@/lib/tengasell/bus";
import { useAuth } from "@/lib/tengasell/auth";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import { EmptyState } from "@/components/tengasell/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Conversation } from "./conversation";
import { loadSeenThreads, notePreviewFromEvent, persistSeenThreads } from "./helpers";
import { NewMessage } from "./new-message";
import { ThreadList } from "./thread-list";

export default function MessagesPage({ threadId }: { threadId?: number }) {
  const { user, loading: authLoading, engineConnected } = useAuth();
  const router = useRouter();
  // ?to={username} only applies to the bare #/messages route
  const toUsername =
    threadId == null ? router.route.query.get("to")?.trim() || null : null;

  const threadsRes = useResource(() => api.threads(), [user?.username], {
    events: ["message:new"],
  });
  const threads = threadsRes.data ?? [];

  // keep last-message previews live from realtime events
  useEffect(() => {
    const off = bus.on("message:new", ({ message }) => notePreviewFromEvent(message));
    return () => off();
  }, []);

  // read ledger (localStorage ts_seen_threads) → unread dots
  const [seen, setSeen] = useState<Map<number, number>>(() => new Map(loadSeenThreads()));

  const markThreadRead = useCallback((id: number, lastMessageAt: string | null) => {
    const lastMs = lastMessageAt ? Date.parse(lastMessageAt) : 0;
    const at = Math.max(Date.now(), Number.isNaN(lastMs) ? 0 : lastMs);
    setSeen((prev) => {
      const seenAt = prev.get(id);
      // no-op while every existing message is already covered by the ledger
      const covered = lastMs > 0 ? seenAt != null && lastMs <= seenAt : seenAt != null;
      if (covered) return prev;
      const next = new Map(prev);
      next.set(id, at);
      persistSeenThreads(next);
      return next;
    });
  }, []);

  const openThread =
    threadId != null ? threads.find((th) => th.id === threadId) ?? null : null;

  // a deep-linked conversation is read the moment it is displayed
  // (persisted one tick after mount; row clicks mark read synchronously)
  useEffect(() => {
    const thread = openThread;
    if (!thread) return;
    const timer = setTimeout(() => markThreadRead(thread.id, thread.last_message_at), 0);
    return () => clearTimeout(timer);
  }, [openThread?.id, openThread?.last_message_at, markThreadRead, openThread]);

  const openThreadById = (id: number, lastMessageAt: string | null) => {
    markThreadRead(id, lastMessageAt);
    router.navigate(`/messages/${id}`);
  };

  // ── states ─────────────────────────────────────────────────────────
  if (authLoading) return <MessagesSkeleton />;
  if (!user) return <SignedOutGate />;

  const conversationVisible = openThread != null || toUsername != null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid gap-4 items-start md:grid-cols-[340px_1fr]">
        {/* inbox pane — hidden on mobile while a conversation is open */}
        <div className={cn(conversationVisible && "hidden md:block")}>
          <ThreadList
            threads={threads}
            loading={threadsRes.loading}
            error={threadsRes.error}
            reload={threadsRes.reload}
            activeId={threadId ?? null}
            meId={user.id}
            meUsername={user.username}
            seen={seen}
            engineConnected={engineConnected}
            onSelect={openThreadById}
          />
        </div>

        {/* conversation pane — hidden on mobile while the inbox is shown */}
        <div className={cn(!conversationVisible && "hidden md:block")}>
          {toUsername ? (
            <NewMessage toUsername={toUsername} />
          ) : threadId == null ? (
            <InboxPlaceholder />
          ) : threadsRes.loading && openThread == null ? (
            <ConversationSkeletonPane />
          ) : threadsRes.error && openThread == null ? (
            <ConversationError onRetry={threadsRes.reload} />
          ) : openThread == null ? (
            <ConversationNotFound />
          ) : (
            <Conversation
              key={openThread.id}
              thread={openThread}
              meId={user.id}
              meUsername={user.username}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── signed-out gate ──────────────────────────────────────────────────

function SignedOutGate() {
  const { t } = useI18n();
  const link = useLinkProps("/signin");
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <EmptyState
        icon={<Mail className="size-10" />}
        title="Sign in to read your messages"
        body="Conversations with buyers and sellers — questions, offers and pickup details — live here."
        action={
          <a
            {...link}
            className="inline-flex items-center gap-2 min-h-11 px-5 rounded-control bg-primary text-primary-foreground text-label font-semibold hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <LogIn className="size-4" aria-hidden="true" />
            {t("nav.signin")}
          </a>
        }
      />
    </div>
  );
}

// ── conversation-slot states ─────────────────────────────────────────

function InboxPlaceholder() {
  return (
    <div className="rounded-card border border-dashed border-border bg-section flex flex-col items-center justify-center text-center px-6 py-16">
      <MessageSquare className="size-10 text-teal-soft" aria-hidden="true" />
      <p className="text-title text-foreground mt-3">Select a conversation</p>
      <p className="text-caption text-muted-foreground mt-1 max-w-xs">
        Pick a thread from your inbox to read messages and reply.
      </p>
    </div>
  );
}

function ConversationNotFound() {
  const link = useLinkProps("/messages");
  return (
    <div className="rounded-card border border-danger/30 bg-danger/5 flex flex-col items-center justify-center text-center px-6 py-16">
      <p className="text-title text-danger">Conversation not found</p>
      <p className="text-caption text-muted-foreground mt-1 max-w-sm">
        This conversation is not in your inbox — the link may belong to another account.
      </p>
      <a
        {...link}
        className="mt-4 inline-flex items-center min-h-11 px-5 rounded-control bg-primary text-primary-foreground text-label font-semibold hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        Back to messages
      </a>
    </div>
  );
}

function ConversationError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-card border border-danger/30 bg-danger/5 flex flex-col items-center justify-center text-center px-6 py-16" role="alert">
      <p className="text-title text-danger">Something went wrong</p>
      <p className="text-caption text-muted-foreground mt-1 max-w-sm">
        We could not load your inbox right now.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-11 px-5 rounded-control bg-primary text-primary-foreground text-label font-semibold hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        Retry
      </button>
    </div>
  );
}

// ── skeletons ────────────────────────────────────────────────────────

function MessagesSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6" aria-busy="true" aria-label="Loading messages">
      <div className="grid gap-4 items-start md:grid-cols-[340px_1fr]">
        <div className="rounded-card border border-border bg-raised overflow-hidden">
          <div className="p-4 border-b border-border space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="size-10 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <ConversationSkeletonPane />
      </div>
    </div>
  );
}

function ConversationSkeletonPane() {
  const sides = [false, true, false, false, true, false];
  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden" aria-busy="true">
      <div className="flex items-center gap-3 p-3 border-b border-border">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex-1 space-y-1.5 min-w-0">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        {sides.map((own, i) => (
          <div key={i} className={cn("flex", own ? "justify-end" : "justify-start")}>
            <Skeleton className={cn("h-12 rounded-xl", own ? "w-40" : "w-56")} />
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-border flex items-end gap-2">
        <Skeleton className="flex-1 h-11 rounded-input" />
        <Skeleton className="size-11 rounded-control" />
      </div>
    </div>
  );
}
