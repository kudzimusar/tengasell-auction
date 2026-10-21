"use client";

// Tengasell — Tenga AI trade assistant (#/assistant) · Task 5-d.
// Chat UI posting to POST /api/assistant with { messages, context }.
// History is trimmed client-side to the last 10 messages; failures render
// inline in the conversation with a retry — no toast spam mid-chat.

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  CircleUserRound,
  Flame,
  Gavel,
  Info,
  MessageCircle,
  RotateCcw,
  Send,
  Tag,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { useRouter } from "@/lib/tengasell/router";
import { TengaLogo } from "@/components/tengasell/ui";
import { cn } from "@/lib/utils";

/** Client-side history cap — the backend re-trims server-side too. */
const HISTORY_LIMIT = 10;

const STARTERS = [
  { icon: Tag, label: "Is this iPhone 13 a good deal at US$251?" },
  { icon: Gavel, label: "How does automatic bidding work?" },
  { icon: MessageCircle, label: "Draft a polite pickup question for a seller in Bulawayo" },
  { icon: Timer, label: "What happens if I win but pay late?" },
] as const;

interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
}

/**
 * Detects an "item {id}" reference in a message (chip clicks send
 * "… (item 1026)"). The id is passed as context.itemId so the backend
 * injects live listing + bid data for that auction before answering.
 */
function matchItemId(text: string): number | undefined {
  const matches = [...text.matchAll(/(?:^|[\s(#[{-])item\s*#?\s*(\d{1,9})/gi)];
  const id = Number(matches[matches.length - 1]?.[1]);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export default function AssistantPage() {
  const reduced = useReducedMotion();
  const { route } = useRouter();
  const { user } = useAuth();
  const { t } = useI18n();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // hot-auction quick picks (context chips)
  const hot = useResource(() => api.auctions({ order: "hot", limit: 3 }), []);

  // keep the newest message in view — container scroll only, no page jumps
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages, sending, error, reduced]);

  /** POST the conversation (already includes the pending user message). */
  async function post(history: ChatMsg[]) {
    setSending(true);
    setError(null);
    try {
      // newest user turn decides which item's live data gets injected
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const itemId = lastUser ? matchItemId(lastUser.content) : undefined;
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history
            .slice(-HISTORY_LIMIT)
            .map((m) => ({ role: m.role, content: m.content })),
          context: itemId ? { route: route.full, itemId } : { route: route.full },
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { reply?: string; error?: string }
        | null;
      if (!res.ok || !data || typeof data.reply !== "string" || !data.reply) {
        throw new Error(data?.error || `The assistant is unavailable (HTTP ${res.status}).`);
      }
      const reply: ChatMsg = { id: ++idRef.current, role: "assistant", content: data.reply };
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant is unavailable right now.");
    } finally {
      setSending(false);
    }
  }

  async function ask(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    const userMsg: ChatMsg = { id: ++idRef.current, role: "user", content };
    const history = [...messages, userMsg];
    setMessages(history);
    setDraft("");
    await post(history);
  }

  function retry() {
    if (sending || messages.length === 0) return;
    void post(messages);
  }

  function appendAccountContext() {
    if (!user) return;
    const tag = `My account: @${user.username}`;
    setDraft((prev) => (prev.trim() ? `${prev.trim()} ${tag}` : tag));
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-4 sm:py-8 sm:space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-start gap-4 rounded-card border border-border bg-raised p-4 sm:gap-5 sm:p-5">
        <img
          src="/brand/assistant.png"
          alt="Tenga AI — Tengasell's trading copilot"
          loading="lazy"
          className="size-[72px] shrink-0 rounded-2xl object-cover"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-headline text-foreground">Tenga AI</h1>
          <p className="mt-0.5 text-body text-muted-foreground">
            Your trading copilot — bidding strategy, price checks, message drafting.
          </p>
          <p className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-teal-tint px-2.5 py-1 text-caption font-semibold text-teal-deep">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              Server-side model · POST /api/assistant (POST-only) · replies take a few
              seconds
            </span>
          </p>
        </div>
      </header>

      {/* ── Chat ───────────────────────────────────────────────── */}
      <section
        aria-label="Conversation with Tenga AI"
        className="overflow-hidden rounded-card border border-border bg-raised"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-1.5">
          <h2 className="text-label font-bold text-foreground">Conversation</h2>
          {messages.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 h-11 px-3 text-caption"
              onClick={() => {
                setMessages([]);
                setError(null);
                setDraft("");
              }}
              disabled={sending}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              New chat
            </Button>
          )}
        </div>

        <div
          ref={logRef}
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
          className="ts-scrollbar max-h-[56vh] min-h-[320px] space-y-4 overflow-y-auto bg-section p-4"
        >
          {messages.length === 0 && !sending ? (
            <EmptyChat onPick={(s) => void ask(s)} />
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} reduced={reduced} />)
          )}

          {sending && <ThinkingBubble label={t("state.loading")} />}

          {error && !sending && (
            <div
              role="alert"
              className="flex flex-col items-start gap-2 rounded-card border border-danger/30 bg-danger/5 p-3.5"
            >
              <p className="text-caption font-semibold text-danger">{error}</p>
              <Button type="button" variant="outline" className="min-h-11" onClick={retry}>
                {t("state.retry")}
              </Button>
            </div>
          )}
        </div>

        {/* ── Composer ─────────────────────────────────────────── */}
        <div className="space-y-2.5 border-t border-border bg-raised p-3 sm:p-4">
          {/* context chips */}
          <div className="ts-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
            <span className="shrink-0 text-caption font-semibold text-muted-foreground">
              Context:
            </span>

            {hot.loading &&
              [0, 1, 2].map((i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="h-11 w-28 shrink-0 animate-pulse rounded-full bg-muted"
                />
              ))}

            {hot.data?.items.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={sending}
                onClick={() => void ask(`Tell me about ${a.title} (item ${a.id})`)}
                title={`Ask about ${a.title} (item ${a.id}) — the backend injects live item data`}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-section px-3.5 text-label text-foreground transition-colors hover:border-teal/50 hover:bg-teal-tint/50 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <Flame className="size-4 shrink-0 text-tag" aria-hidden="true" />
                <span className="max-w-40 truncate">
                  #{a.id} · {a.title}
                </span>
              </button>
            ))}

            {user && (
              <button
                type="button"
                disabled={sending}
                onClick={appendAccountContext}
                title="Append your account handle to the next message"
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-teal/40 bg-teal-tint px-3.5 text-label text-teal-deep transition-colors hover:border-teal focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
              >
                <CircleUserRound className="size-4 shrink-0" aria-hidden="true" />
                My account: @{user.username}
              </button>
            )}
          </div>

          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="tenga-composer" className="sr-only">
                Message Tenga AI
              </label>
              <textarea
                id="tenga-composer"
                ref={inputRef}
                value={draft}
                rows={1}
                maxLength={2000}
                placeholder="Ask about bidding, prices or an item — or draft a message…"
                aria-describedby="tenga-composer-hint"
                className="ts-scrollbar min-h-11 w-full resize-none rounded-input border border-input bg-section px-3.5 py-3 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(draft);
                  }
                }}
              />
            </div>
            <Button
              type="submit"
              aria-label={t("action.send")}
              disabled={sending || !draft.trim()}
              className="size-11 shrink-0"
            >
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </form>
          <p id="tenga-composer-hint" className="text-caption text-muted-foreground">
            Enter to send · Shift + Enter for a new line · last {HISTORY_LIMIT} messages are
            sent as context
          </p>
        </div>
      </section>
    </div>
  );
}

// ── empty state: starter prompts ────────────────────────────────────

function EmptyChat({ onPick }: { onPick: (starter: string) => void }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center py-4 text-center">
      <TengaLogo size={46} withWordmark={false} />
      <p className="mt-3 text-title text-foreground">Ask Tenga AI</p>
      <p className="mt-1 max-w-sm text-caption text-muted-foreground">
        Bidding strategy, price sanity-checks, or a polite message drafted for you — pick a
        starter or type below.
      </p>
      <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <motion.button
            key={s.label}
            type="button"
            whileTap={reduced ? undefined : { scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => onPick(s.label)}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-control border border-border bg-raised px-3.5 py-3 text-start text-label leading-snug text-foreground transition-colors hover:border-teal/50 hover:bg-teal-tint/40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <s.icon className="size-4.5 shrink-0 text-teal" aria-hidden="true" />
            <span>{s.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ── bubbles ─────────────────────────────────────────────────────────

function Bubble({ msg, reduced }: { msg: ChatMsg; reduced: boolean | null }) {
  const isUser = msg.role === "user";
  return (
    <motion.div
      initial={reduced ? undefined : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn("flex w-full", isUser ? "justify-end" : "items-start gap-2.5")}
    >
      {!isUser && <TengaLogo size={30} withWordmark={false} />}
      <div
        className={cn(
          "max-w-[85%] rounded-card px-3.5 py-2.5 text-body leading-relaxed break-words whitespace-pre-wrap sm:max-w-[75%]",
          isUser
            ? "rounded-br-sm bg-teal text-white"
            : "rounded-bl-sm border border-border bg-raised text-foreground",
        )}
      >
        {msg.content}
      </div>
    </motion.div>
  );
}

function ThinkingBubble({ label }: { label: string }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex w-full items-start gap-2.5">
      <TengaLogo size={30} withWordmark={false} />
      <span
        role="status"
        aria-label={label}
        className="inline-flex items-center gap-1.5 rounded-card rounded-bl-sm border border-border bg-raised px-4 py-3.5"
      >
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn("size-2 rounded-full bg-teal-soft", !reduced && "animate-bounce")}
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
        <span className="sr-only">{label}</span>
      </span>
    </div>
  );
}
