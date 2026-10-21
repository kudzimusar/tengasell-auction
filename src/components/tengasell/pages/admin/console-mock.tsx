"use client";

// Admin Comms Console — MOCK VIEWERS: pixel-accurate previews of what users
// actually receive.
//   · Email — mock_inbox list → full HTML in a sandboxed <iframe srcDoc> at
//     600px width + "open raw" in a new tab (Blob URL, no extra BFF route).
//   · Telegram / WhatsApp — pick a mock chat → phone-style transcript
//     (bot bubbles left, user bubbles right — teal/gold, zero blue/indigo).

import { useMemo, useState } from "react";
import {
  ExternalLink,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatRelative } from "@/lib/tengasell/format";
import { cn } from "@/lib/utils";
import {
  CHANNEL_ICONS,
  commsAdminFetch,
  type Channel,
  type MockEmail,
  type MockMessage,
} from "./console-shared";

type ViewerMode = "email" | "telegram" | "whatsapp";

export function ConsoleMock({ token }: { token: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ViewerMode>("email");

  const modes: { key: ViewerMode; label: string; icon: React.ReactNode }[] = [
    { key: "email", label: t("comms.channel.email"), icon: <Inbox className="size-4" aria-hidden="true" /> },
    { key: "telegram", label: t("comms.channel.telegram"), icon: <Send className="size-4" aria-hidden="true" /> },
    { key: "whatsapp", label: t("comms.channel.whatsapp"), icon: <MessageCircle className="size-4" aria-hidden="true" /> },
  ];

  return (
    <section aria-labelledby="admin-mock-heading" className="min-w-0 space-y-6">
      <SectionHeader
        title={<span id="admin-mock-heading">{t("admin.mock.title")}</span>}
        subtitle={t("admin.mock.sub")}
      />

      <div className="flex gap-2 overflow-x-auto ts-scrollbar -mx-4 px-4" role="group" aria-label={t("admin.mock.title")}>
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={mode === m.key}
            onClick={() => setMode(m.key)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-label font-semibold transition-colors",
              mode === m.key
                ? "border-teal bg-teal-tint text-teal-deep font-bold"
                : "border-border bg-raised text-muted-foreground hover:text-foreground",
            )}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {mode === "email" ? <EmailViewer token={token} /> : <ChatViewer token={token} channel={mode} />}
    </section>
  );
}

// ── email viewer ──────────────────────────────────────────────────────

function EmailViewer({ token }: { token: string }) {
  const { t } = useI18n();
  const inbox = useResource<MockEmail[]>(
    async () => {
      const data = await commsAdminFetch<{ emails?: MockEmail[] }>(token, "/mock/inbox?limit=60");
      return data.emails ?? [];
    },
    [token],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const emails = inbox.data ?? [];
  const selected = emails.find((e) => e.id === selectedId) ?? emails[0] ?? null;

  const openRaw = (email: MockEmail) => {
    const blob = new Blob([email.html ?? email.text ?? ""], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-title text-foreground">{t("admin.mock.emailList")}</h2>
        <Button variant="outline" className="min-h-11" onClick={inbox.reload}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("admin.refresh")}
        </Button>
      </div>

      {inbox.error ? (
        <ErrorState message={inbox.error} onRetry={inbox.reload} />
      ) : inbox.loading && !inbox.data ? (
        <div className="space-y-2" aria-busy="true" aria-label={t("admin.mock.emailList")}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card" />
          ))}
        </div>
      ) : emails.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-10" />}
          title={t("admin.mock.noEmails")}
          body={t("admin.mock.noEmailsBody")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] items-start">
          {/* list */}
          <ul
            className="list-none p-0 m-0 rounded-card border border-border bg-raised divide-y divide-border/70 max-h-[420px] overflow-y-auto ts-scrollbar"
            aria-label={t("admin.mock.emailList")}
          >
            {emails.map((e) => {
              const active = selected?.id === e.id;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "w-full min-h-11 text-start px-4 py-3 transition-colors",
                      active ? "bg-teal-tint/70" : "hover:bg-accent/50",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-label font-bold text-foreground truncate">
                        {e.subject ?? "(no subject)"}
                      </span>
                      {e.campaignId != null && (
                        <span className="shrink-0 rounded-full border border-gold/50 bg-gold-soft px-2 py-0.5 text-caption font-bold text-gold-on">
                          #{e.campaignId}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-caption text-muted-foreground">
                      <span className="truncate">{e.to ?? "—"}</span>
                      <span className="shrink-0">{e.createdAt ? formatRelative(e.createdAt) : ""}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* preview */}
          {selected && (
            <div className="min-w-0 rounded-card border border-border bg-raised overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="text-label font-bold text-foreground truncate">{selected.subject}</p>
                  <p className="text-caption text-muted-foreground truncate">
                    {t("admin.mock.sentTo")} {selected.to ?? "—"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="min-h-11 shrink-0"
                  onClick={() => openRaw(selected)}
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t("admin.mock.openRaw")}
                </Button>
              </div>
              <div className="overflow-x-auto ts-scrollbar bg-canvas p-3">
                {/* pixel-accurate: the template is a 600px inline-CSS table */}
                <iframe
                  title={selected.subject ?? "Email preview"}
                  srcDoc={selected.html ?? `<pre>${selected.text ?? ""}</pre>`}
                  sandbox=""
                  className="block h-[520px] w-[600px] max-w-full border-0 bg-white sm:w-[600px]"
                  style={{ minWidth: "min(600px, 100%)" }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── telegram / whatsapp chat viewer ────────────────────────────────────

function ChatViewer({ token, channel }: { token: string; channel: Extract<Channel, "telegram" | "whatsapp"> }) {
  const { t } = useI18n();
  const chats = useResource<MockMessage[]>(
    async () => {
      const data = await commsAdminFetch<{ messages?: MockMessage[] }>(
        token,
        `/mock/chats?channel=${channel}&limit=500`,
      );
      return data.messages ?? [];
    },
    [token, channel],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, MockMessage[]>();
    for (const m of chats.data ?? []) {
      const key = m.chatId ?? "—";
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => (b[1][0]?.id ?? 0) - (a[1][0]?.id ?? 0));
  }, [chats.data]);

  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const active = selectedChat != null && grouped.some(([k]) => k === selectedChat)
    ? selectedChat
    : (grouped[0]?.[0] ?? null);
  const messages = grouped.find(([k]) => k === active)?.[1] ?? [];
  const Icon = CHANNEL_ICONS[channel];
  const isWhatsApp = channel === "whatsapp";

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-title text-foreground">
          {t("admin.mock.chatList")} · {t(`comms.channel.${channel}`)}
        </h2>
        <Button variant="outline" className="min-h-11" onClick={chats.reload}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("admin.refresh")}
        </Button>
      </div>

      {chats.error ? (
        <ErrorState message={chats.error} onRetry={chats.reload} />
      ) : chats.loading && !chats.data ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={<Smartphone className="size-10" />}
          title={t("admin.mock.noChats")}
          body={t("admin.mock.noChatsBody")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,420px)] items-start justify-start">
          {/* chat list */}
          <ul
            className="list-none p-0 m-0 rounded-card border border-border bg-raised divide-y divide-border/70 max-h-[420px] overflow-y-auto ts-scrollbar"
            aria-label={t("admin.mock.chatList")}
          >
            {grouped.map(([chatId, msgs]) => {
              const isActive = active === chatId;
              const last = msgs[msgs.length - 1];
              return (
                <li key={chatId}>
                  <button
                    type="button"
                    onClick={() => setSelectedChat(chatId)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "w-full min-h-11 text-start px-4 py-3 transition-colors",
                      isActive ? "bg-teal-tint/70" : "hover:bg-accent/50",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 text-teal shrink-0" aria-hidden="true" />
                      <span className="text-label font-bold text-foreground ts-numeric">{chatId}</span>
                      <span className="ms-auto text-caption text-muted-foreground ts-numeric shrink-0">
                        {msgs.length}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-caption text-muted-foreground truncate">
                      {last?.text ?? ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* phone-style transcript */}
          <PhoneTranscript
            chatId={active}
            messages={messages}
            isWhatsApp={isWhatsApp}
          />
        </div>
      )}
    </div>
  );
}

function PhoneTranscript({
  chatId,
  messages,
  isWhatsApp,
}: {
  chatId: string | null;
  messages: MockMessage[];
  isWhatsApp: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className="mx-auto w-full max-w-[420px] rounded-[1.75rem] border-[6px] border-teal-deep bg-canvas overflow-hidden shadow-lg"
      aria-label={t("admin.mock.transcript")}
    >
      {/* phone header */}
      <div className="flex items-center gap-2.5 bg-teal-deep px-4 py-3 text-white">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold text-gold-on">
          <Send className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-label font-bold truncate">Tengasell Bot</p>
          <p className="text-caption text-white/70 truncate ts-numeric">
            {isWhatsApp ? "WhatsApp · " : "Telegram · "}
            {chatId ?? "—"}
          </p>
        </div>
        <span className="ms-auto shrink-0 rounded-full bg-gold/20 px-2 py-0.5 text-caption font-bold text-gold">
          mock
        </span>
      </div>

      {/* messages */}
      <div
        className="max-h-[420px] min-h-[220px] overflow-y-auto ts-scrollbar space-y-2.5 p-3"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-caption text-muted-foreground">
            {t("admin.mock.noMessages")}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.role === "user";
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5",
                    mine
                      ? isWhatsApp
                        ? "rounded-ee-sm bg-gold-soft text-gold-on border border-gold/40"
                        : "rounded-ee-sm bg-teal text-white"
                      : "rounded-es-sm border border-border bg-raised text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words text-body">
                    {m.text ?? ""}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-caption ts-numeric",
                      mine && !isWhatsApp ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {m.createdAt ? formatRelative(m.createdAt) : ""}
                    {mine ? ` · ${t("admin.mock.you")}` : ""}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
