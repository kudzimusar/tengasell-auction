"use client";

// Tengasell — Tickets section (My Tengasell → Support). Task 12-c.
// User support surface backed by /api/trust/me/tickets (BFF → trust-service
// :3007): my ticket list with status chips + SLA countdown, new-ticket
// dialog (category/subject/body + optional order id + ≤500KB image
// attachment), the public message thread with a reply box, CSAT thumbs
// after resolution, and the enforcement APPEAL panel (TNS-012) that appears
// when a Trust & Safety action touches the account.

import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  LifeBuoy,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Scale,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatRelative } from "@/lib/tengasell/format";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/tengasell/types";
import {
  slaText,
  trustFetch,
  TrustChip,
  useTrustLabels,
  type AppealRow,
  type EnforcementRow,
  type TicketMessage,
  type TrustStatusPayload,
  type TrustTicket,
} from "../trust-client";

const CATEGORIES = ["question", "order", "refund", "complaint", "feedback", "other"] as const;
const ATTACHMENT_MAX_BYTES = 500 * 1024;

export function TicketsSection({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const token = user.token;
  const labels = useTrustLabels();
  const [selected, setSelected] = useState<number | null>(null);

  const list = useResource<TrustTicket[]>(
    async () => {
      const d = await trustFetch<{ tickets: TrustTicket[] }>(token, "/me/tickets");
      return d.tickets ?? [];
    },
    [token],
  );
  const statusRes = useResource<TrustStatusPayload | null>(
    async () => {
      try {
        return await trustFetch<TrustStatusPayload>(token, "/me/status");
      } catch {
        return null;
      }
    },
    [token],
  );

  const tickets = list.data ?? [];
  const trustStatus = statusRes.data ?? null;

  if (selected != null) {
    return (
      <TicketThread
        user={user}
        ticketId={selected}
        onBack={() => {
          setSelected(null);
          list.reload();
        }}
      />
    );
  }

  return (
    <section aria-labelledby="tickets-heading" className="space-y-4">
      <header className="mb-1">
        <h2 id="tickets-heading" className="text-sectionTitle text-foreground">
          {t("my.tickets.title")}
        </h2>
        <p className="text-caption text-muted-foreground mt-0.5">{t("my.tickets.sub")}</p>
      </header>

      {trustStatus?.status ? (
        <TrustStatusBanner status={trustStatus} token={token} />
      ) : null}

      <NewTicketDialog token={token} onCreated={() => list.reload()} hasOrders={tickets.some((x) => x.order_id != null)} />

      {list.loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-card" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => list.reload()} />
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy className="size-10" />}
          title={t("trust.empty.tickets")}
          body={t("trust.empty.ticketsBody")}
        />
      ) : (
        <ul className="space-y-3">
          {tickets.map((ticket) => {
            const chip = labels.ticketStatus(ticket.status);
            return (
              <li key={ticket.id}>
                <button
                  type="button"
                  onClick={() => setSelected(ticket.id)}
                  aria-label={`${t("trust.ticket.ariaOpen")} ${ticket.subject}`}
                  className="w-full text-left rounded-card border border-border bg-raised p-4 transition-colors hover:border-teal/50 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-label font-bold text-foreground truncate">
                        #{ticket.id} · {ticket.subject}
                      </p>
                      <p className="text-caption text-muted-foreground mt-1">
                        {t(`trust.category.${ticket.category}`)} · {formatRelative(ticket.created_at)}
                        {ticket.order_id != null ? ` · ${t("trust.ticket.order")} #${ticket.order_id}` : ""}
                      </p>
                    </div>
                    <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <TrustChip tone={labels.priority(ticket.priority).tone}>
                      {labels.priority(ticket.priority).label}
                    </TrustChip>
                    {ticket.status !== "resolved" && ticket.status !== "closed" ? (
                      <span
                        className={cn(
                          "text-caption font-semibold",
                          ticket.sla_breached ? "text-danger" : "text-muted-foreground",
                        )}
                      >
                        {slaText(ticket.sla_due_at, ticket.sla_breached, t)}
                      </span>
                    ) : ticket.csat_score != null ? (
                      <span className="text-caption font-semibold text-muted-foreground">
                        {t("trust.csat.recorded")}: {ticket.csat_score}/5
                      </span>
                    ) : (
                      <span className="text-caption font-semibold text-teal-deep">
                        {t("trust.csat.pending")}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── trust status banner + appeal panel ──────────────────────────────────

function TrustStatusBanner({ status, token }: { status: TrustStatusPayload; token: string }) {
  const { t } = useI18n();
  const labels = useTrustLabels();
  const [openFor, setOpenFor] = useState<EnforcementRow | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const enforcement = useResource<EnforcementRow[]>(
    async () => {
      const d = await trustFetch<{ enforcement: EnforcementRow[] }>(token, "/me/enforcement");
      return d.enforcement ?? [];
    },
    [token],
  );
  const appeals = useResource<AppealRow[]>(
    async () => {
      const d = await trustFetch<{ appeals: AppealRow[] }>(token, "/me/appeals");
      return d.appeals ?? [];
    },
    [token],
  );

  const rows = enforcement.data ?? [];
  const myAppeals = appeals.data ?? [];
  const actionChip = status.status ? labels.enforcementAction(
    status.status === "warned"
      ? "warning"
      : status.status === "restricted"
        ? "restriction"
        : status.status === "suspended"
          ? "suspension"
          : "ban",
  ) : null;

  const submitAppeal = async () => {
    if (!openFor) return;
    setBusy(true);
    try {
      await trustFetch(token, "/me/appeals", {
        method: "POST",
        body: JSON.stringify({ enforcement_id: openFor.id, body }),
      });
      toast({ title: t("trust.appeal.submitted") });
      setOpenFor(null);
      setBody("");
      appeals.reload();
      enforcement.reload();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-danger/40 bg-danger/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Scale className="size-5 text-danger shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-label font-bold text-foreground">{t("trust.banner.title")}</p>
          <p className="text-caption text-muted-foreground mt-0.5">
            {t("trust.banner.body")} {status.reason_code ? `(${status.reason_code})` : ""}
            {status.until ? ` · ${t("trust.banner.until")} ${formatRelative(status.until)}` : ""}
          </p>
        </div>
        {actionChip ? <TrustChip tone={actionChip.tone}>{actionChip.label}</TrustChip> : null}
      </div>

      {enforcement.loading ? (
        <Skeleton className="h-14 w-full rounded-card" />
      ) : rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((row) => {
            const chip = labels.enforcementAction(row.action);
            const hasOpenAppeal = myAppeals.some(
              (a) => a.enforcement_id === row.id && (a.status === "received" || a.status === "under_review"),
            );
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-control border border-border bg-raised p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                    <span className="text-caption text-muted-foreground">
                      {row.reason_code} · {formatRelative(row.created_at)}
                    </span>
                  </div>
                  {row.note ? (
                    <p className="text-caption text-muted-foreground mt-1 line-clamp-2">{row.note}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={hasOpenAppeal}
                  className="min-h-11 shrink-0"
                  onClick={() => setOpenFor(row)}
                >
                  <Scale className="size-4" aria-hidden="true" />
                  {hasOpenAppeal ? t("trust.appeal.open") : t("trust.appeal.trigger")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {myAppeals.length > 0 ? (
        <div>
          <p className="text-caption font-bold text-foreground mb-1.5">{t("trust.appeal.mine")}</p>
          <ul className="space-y-1.5">
            {myAppeals.map((a) => {
              const chip = labels.appealStatus(a.status);
              return (
                <li key={a.id} className="flex items-center gap-2 flex-wrap text-caption">
                  <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                  <span className="text-muted-foreground truncate">
                    #{a.id} · {a.body.slice(0, 80)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Dialog open={openFor != null} onOpenChange={(o) => !o && setOpenFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("trust.appeal.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("trust.appeal.dialogBody")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("trust.appeal.placeholder")}
            className="min-h-28"
            aria-label={t("trust.appeal.placeholder")}
          />
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpenFor(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={busy || body.trim().length < 10}
              onClick={() => void submitAppeal()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {t("action.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── new ticket dialog ───────────────────────────────────────────────────

function NewTicketDialog({
  token,
  onCreated,
  hasOrders,
}: {
  token: string;
  onCreated: () => void;
  hasOrders: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("question");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; mime: string; data_base64: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = subject.trim().length >= 3 && body.trim().length >= 10;

  const reset = () => {
    setCategory("question");
    setSubject("");
    setBody("");
    setOrderId("");
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const pickFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: t("trust.attach.imageOnly"), variant: "destructive" });
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast({ title: t("trust.attach.tooLarge"), variant: "destructive" });
      return;
    }
    const data_base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
    setAttachment({ name: file.name, mime: file.type, data_base64 });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const d = await trustFetch<{ ticket: { id: number } }>(token, "/me/tickets", {
        method: "POST",
        body: JSON.stringify({
          category,
          subject,
          body,
          order_id: orderId.trim() ? Number(orderId.trim()) : undefined,
          attachment: attachment ?? undefined,
        }),
      });
      toast({ title: t("trust.ticket.created"), description: `#${d.ticket.id}` });
      setOpen(false);
      reset();
      onCreated();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="size-4" aria-hidden="true" />
        {t("trust.ticket.new")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto ts-scrollbar">
          <DialogHeader>
            <DialogTitle>{t("support.intake.title")}</DialogTitle>
            <DialogDescription>{t("support.intake.sla")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="ticket-category">{t("trust.ticket.category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="ticket-category" className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`trust.category.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-subject">{t("trust.ticket.subject")}</Label>
              <Input
                id="ticket-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                placeholder={t("trust.ticket.subjectPlaceholder")}
                className="min-h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-body">{t("trust.ticket.body")}</Label>
              <Textarea
                id="ticket-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-28"
                placeholder={t("trust.ticket.bodyPlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-order">{t("trust.ticket.orderOptional")}</Label>
              <Input
                id="ticket-order"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="1"
                className="min-h-11"
              />
              {hasOrders ? (
                <p className="text-caption text-muted-foreground">{t("trust.ticket.orderHint")}</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ticket-attachment">{t("trust.attach.label")}</Label>
              <input
                ref={fileRef}
                id="ticket-attachment"
                type="file"
                accept="image/*"
                className="min-h-11 text-caption text-muted-foreground file:mr-3 file:rounded-control file:border-0 file:bg-teal-tint file:px-3 file:py-2 file:text-label file:font-semibold file:text-teal-deep"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickFile(f);
                }}
              />
              {attachment ? (
                <p className="text-caption text-teal-deep font-semibold truncate">
                  <Paperclip className="size-3.5 inline" aria-hidden="true" /> {attachment.name}
                </p>
              ) : (
                <p className="text-caption text-muted-foreground">{t("trust.attach.hint")}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="button" className="min-h-11" disabled={busy || !valid} onClick={() => void submit()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {t("trust.ticket.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── ticket thread ───────────────────────────────────────────────────────

function TicketThread({
  user,
  ticketId,
  onBack,
}: {
  user: CurrentUser;
  ticketId: number;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const labels = useTrustLabels();
  const token = user.token;
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [csatComment, setCsatComment] = useState("");

  const thread = useResource<{ ticket: TrustTicket; messages: TicketMessage[] }>(
    async () => trustFetch<{ ticket: TrustTicket; messages: TicketMessage[] }>(token, `/me/tickets/${ticketId}`),
    [token, ticketId],
  );

  const messages = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  const ticket = thread.data?.ticket;

  const sendReply = async () => {
    setBusy(true);
    try {
      await trustFetch(token, `/me/tickets/${ticketId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      thread.reload();
      toast({ title: t("trust.ticket.replied") });
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const submitCsat = async (score: number) => {
    setBusy(true);
    try {
      await trustFetch(token, `/me/tickets/${ticketId}/csat`, {
        method: "POST",
        body: JSON.stringify({ score, comment: csatComment }),
      });
      toast({ title: t("trust.csat.thanks") });
      thread.reload();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="thread-heading" className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-11 items-center gap-2 rounded-control px-3 text-label font-semibold text-teal-deep hover:bg-teal-tint/50 transition-colors"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("trust.thread.back")}
      </button>

      {thread.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-card" />
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-card" />
          ))}
        </div>
      ) : thread.error ? (
        <ErrorState message={thread.error} onRetry={() => thread.reload()} />
      ) : !ticket ? null : (
        <>
          <div className="rounded-card border border-border bg-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="thread-heading" className="text-title text-foreground truncate">
                  #{ticket.id} · {ticket.subject}
                </h2>
                <p className="text-caption text-muted-foreground mt-1">
                  {t(`trust.category.${ticket.category}`)} · {formatRelative(ticket.created_at)}
                </p>
              </div>
              <TrustChip tone={labels.ticketStatus(ticket.status).tone}>
                {labels.ticketStatus(ticket.status).label}
              </TrustChip>
            </div>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto ts-scrollbar p-1">
            {messages.map((m) => {
              const mine = m.author === user.username;
              const attach = parseAttachment(m.attachment);
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-card border p-3",
                      mine
                        ? "border-teal/30 bg-teal-tint"
                        : "border-border bg-section",
                    )}
                  >
                    <p className="text-caption font-bold text-foreground mb-1">
                      {mine ? t("trust.thread.you") : `${t("trust.thread.support")} · @${m.author}`}
                    </p>
                    <p className="text-label text-foreground whitespace-pre-wrap break-words">{m.body}</p>
                    {attach && attach.mime.startsWith("image/") ? (
                      <img
                        src={`data:${attach.mime};base64,${attach.data_base64}`}
                        alt={attach.name}
                        className="mt-2 max-h-40 rounded-control border border-border"
                      />
                    ) : null}
                    <p className="text-caption text-muted-foreground mt-1.5">{formatRelative(m.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {ticket.status === "closed" ? (
            <p className="text-caption text-muted-foreground text-center py-2">{t("trust.thread.closedNote")}</p>
          ) : (
            <div className="rounded-card border border-border bg-raised p-3 flex flex-col gap-2 sm:flex-row">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t("trust.thread.replyPlaceholder")}
                className="min-h-11 flex-1"
                aria-label={t("trust.thread.replyPlaceholder")}
              />
              <Button
                type="button"
                className="min-h-11 sm:self-stretch"
                disabled={busy || reply.trim().length < 2}
                onClick={() => void sendReply()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                {t("action.send")}
              </Button>
            </div>
          )}

          {(ticket.status === "resolved" || ticket.status === "closed") &&
            (ticket.csat_score != null ? (
              <div className="rounded-card border border-ok/30 bg-ok/10 p-4 text-center">
                <p className="text-label font-bold text-foreground">
                  {t("trust.csat.recorded")}: {ticket.csat_score}/5
                </p>
                {ticket.csat_comment ? (
                  <p className="text-caption text-muted-foreground mt-1">“{ticket.csat_comment}”</p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-card border border-gold/40 bg-gold-soft/50 p-4">
                <p className="text-label font-bold text-foreground text-center">{t("trust.csat.ask")}</p>
                <div className="mt-3 flex items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 px-6"
                    disabled={busy}
                    onClick={() => void submitCsat(5)}
                    aria-label={t("trust.csat.up")}
                  >
                    <ThumbsUp className="size-4 text-ok" aria-hidden="true" />
                    {t("trust.csat.up")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 px-6"
                    disabled={busy}
                    onClick={() => void submitCsat(1)}
                    aria-label={t("trust.csat.down")}
                  >
                    <ThumbsDown className="size-4 text-danger" aria-hidden="true" />
                    {t("trust.csat.down")}
                  </Button>
                </div>
                <Textarea
                  value={csatComment}
                  onChange={(e) => setCsatComment(e.target.value)}
                  placeholder={t("trust.csat.commentPlaceholder")}
                  className="mt-3 min-h-16"
                  aria-label={t("trust.csat.commentPlaceholder")}
                />
              </div>
            ))}
        </>
      )}
    </section>
  );
}

function parseAttachment(raw: string | null | undefined): { name: string; mime: string; data_base64: string } | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as { name?: string; mime?: string; data_base64?: string };
    if (!a.data_base64) return null;
    return { name: a.name ?? "attachment", mime: a.mime ?? "image/png", data_base64: a.data_base64 };
  } catch {
    return null;
  }
}
