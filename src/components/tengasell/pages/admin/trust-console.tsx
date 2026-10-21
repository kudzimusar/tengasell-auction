"use client";

// Tengasell — Support & Trust console (admin, #/admin/{tickets|reports|
// enforcement|screening}). Task 12-c.
//
// Sections (internal pill sub-nav, comms-console conventions):
//   tickets     — queue table (SLA breach highlight) + detail Sheet: thread
//                 with visually-distinct INTERNAL notes, macro insert,
//                 reply box w/ internal toggle, assign, status+resolution
//                 note, CSAT display, event log, customer record chip.
//   reports     — queue → review (opens case) / action (outcome + takedown,
//                 AlertDialog-confirmed) / dismiss; case link chips.
//   enforcement — current suspensions + restore, action form (reason_code
//                 REQUIRED), pending DUAL-APPROVAL list + approve (the
//                 service rejects the requesting admin — CTL-021), appeals
//                 queue w/ decide, action history, staff roles, seller
//                 health check.
//   screening   — rules, Scan now, hits queue with clear / action
//                 (takedown, AlertDialog-confirmed) + stats.
//
// All fetches are RELATIVE /api/trust/admin/** (BFF → :3007, 401/403 gated).

import { useMemo, useState } from "react";
import {
  Activity,
  Eye,
  Gavel,
  HeartPulse,
  LifeBuoy,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldOff,
  UserCheck,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatRelative } from "@/lib/tengasell/format";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/tengasell/types";
import {
  slaText,
  TrustChip,
  trustAdminFetch,
  useTrustLabels,
  type AppealRow,
  type CaseRow,
  type EnforcementRow,
  type MacroRow,
  type ReportRow,
  type RoleRow,
  type ScreeningHit,
  type ScreeningRule,
  type SuspensionRow,
  type TicketEvent,
  type TicketMessage,
  type TrustStats,
  type TrustStatusPayload,
  type TrustTicket,
} from "../trust-client";

export type TrustSection = "tickets" | "reports" | "enforcement" | "screening";

export const TRUST_SECTIONS: TrustSection[] = [
  "tickets",
  "reports",
  "enforcement",
  "screening",
];

const SECTION_META: { key: TrustSection; labelKey: string; icon: LucideIcon }[] = [
  { key: "tickets", labelKey: "admin.nav.tickets", icon: LifeBuoy },
  { key: "reports", labelKey: "admin.nav.reports", icon: ShieldAlert },
  { key: "enforcement", labelKey: "admin.nav.enforcement", icon: ShieldOff },
  { key: "screening", labelKey: "admin.nav.screening", icon: Eye },
];

export function TrustConsole({
  user,
  section,
}: {
  user: CurrentUser;
  section: TrustSection;
}) {
  const { t } = useI18n();
  const active = TRUST_SECTIONS.includes(section) ? section : "tickets";
  const token = user.token;

  return (
    <div className="min-w-0 space-y-6">
      <SectionHeader
        icon={<LifeBuoy className="size-5 text-teal" aria-hidden="true" />}
        title={t("admin.trust.title")}
        subtitle={t("admin.trust.sub")}
      />

      {/* internal pill sub-nav (comms-console convention) */}
      <nav aria-label="Support & Trust sections" className="overflow-x-auto ts-scrollbar -mx-1 px-1">
        <ul className="flex gap-1.5 w-max pb-1">
          {SECTION_META.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <a
                  href={`#/admin/${item.key}`}
                  aria-current={active === item.key ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-label font-semibold transition-colors",
                    active === item.key
                      ? "bg-teal-tint text-teal-deep border-teal/40 font-bold"
                      : "border-border bg-raised text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {t(item.labelKey)}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <StatsStrip token={token} />

      {active === "tickets" && <TicketsAdmin token={token} />}
      {active === "reports" && <ReportsAdmin token={token} />}
      {active === "enforcement" && <EnforcementAdmin token={token} actor={user.username} />}
      {active === "screening" && <ScreeningAdmin token={token} />}
    </div>
  );
}

// ── stats strip ─────────────────────────────────────────────────────────

function StatsStrip({ token }: { token: string }) {
  const { t } = useI18n();
  const stats = useResource<TrustStats | null>(
    async () => {
      try {
        return await trustAdminFetch<TrustStats>(token, "/stats");
      } catch {
        return null;
      }
    },
    [token],
  );
  if (stats.loading || !stats.data) return null;
  const s = stats.data;
  const items: { label: string; value: string | number; danger?: boolean }[] = [
    { label: t("trust.stats.ticketsOpen"), value: s.tickets_open },
    { label: t("trust.stats.slaBreaches"), value: s.sla_breaches, danger: s.sla_breaches > 0 },
    { label: t("trust.stats.reportsPending"), value: s.reports_pending },
    { label: t("trust.stats.casesOpen"), value: s.cases_open },
    { label: t("trust.stats.appealsOpen"), value: s.appeals_open },
    { label: t("trust.stats.screeningPending"), value: s.screening_pending, danger: s.screening_pending > 0 },
    { label: t("trust.stats.enforcement30d"), value: s.enforcement_30d },
    { label: t("trust.stats.csat"), value: `${s.csat_avg}/5` },
  ];
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Trust overview stats">
      {items.map((it) => (
        <li
          key={it.label}
          className={cn(
            "rounded-card border p-3",
            it.danger ? "border-danger/40 bg-danger/5" : "border-border bg-raised",
          )}
        >
          <p className={cn("ts-numeric text-title font-bold", it.danger ? "text-danger" : "text-teal-deep")}>
            {it.value}
          </p>
          <p className="text-caption text-muted-foreground truncate">{it.label}</p>
        </li>
      ))}
    </ul>
  );
}

// ── TICKETS ─────────────────────────────────────────────────────────────

function TicketsAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const labels = useTrustLabels();
  const [status, setStatus] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [openId, setOpenId] = useState<number | null>(null);

  const queue = useResource<TrustTicket[]>(
    async () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (assignee !== "all") params.set("assignee", assignee);
      const qs = params.toString();
      const d = await trustAdminFetch<{ tickets: TrustTicket[] }>(
        token,
        `/tickets${qs ? `?${qs}` : ""}`,
      );
      return d.tickets ?? [];
    },
    [token, status, assignee],
  );
  const roles = useResource<RoleRow[]>(
    async () => {
      try {
        const d = await trustAdminFetch<{ roles: RoleRow[] }>(token, "/roles");
        return d.roles ?? [];
      } catch {
        return [];
      }
    },
    [token],
  );

  const tickets = queue.data ?? [];
  const staff = useMemo(() => {
    const set = new Set<string>();
    for (const r of roles.data ?? []) {
      if (r.role === "support" || r.role === "admin") set.add(r.username);
    }
    return [...set];
  }, [roles.data]);

  return (
    <section aria-labelledby="trust-tickets-heading" className="min-w-0 space-y-4">
      <SectionHeader
        title={<span id="trust-tickets-heading">{t("trust.console.tickets")}</span>}
        subtitle={t("trust.console.ticketsSub")}
        action={
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => queue.reload()}
            aria-label={t("state.retry")}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("state.retry")}</span>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="min-h-11 w-40" aria-label={t("trust.filter.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("trust.filter.all")}</SelectItem>
            {["open", "pending", "resolved", "closed"].map((s) => (
              <SelectItem key={s} value={s}>
                {labels.ticketStatus(s).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="min-h-11 w-44" aria-label={t("trust.filter.assignee")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("trust.filter.all")}</SelectItem>
            <SelectItem value="unassigned">{t("trust.filter.unassigned")}</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s} value={s}>
                @{s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {queue.loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card" />
          ))}
        </div>
      ) : queue.error ? (
        <ErrorState message={queue.error} onRetry={() => queue.reload()} />
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-10" />}
          title={t("trust.empty.queue")}
          body={t("trust.empty.queueBody")}
        />
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden md:block rounded-card border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{t("trust.col.user")}</TableHead>
                  <TableHead>{t("trust.col.subject")}</TableHead>
                  <TableHead>{t("trust.col.category")}</TableHead>
                  <TableHead>{t("trust.col.priority")}</TableHead>
                  <TableHead>{t("trust.col.status")}</TableHead>
                  <TableHead>{t("trust.col.assignee")}</TableHead>
                  <TableHead>{t("trust.col.sla")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => {
                  const chip = labels.ticketStatus(ticket.status);
                  return (
                    <TableRow
                      key={ticket.id}
                      onClick={() => setOpenId(ticket.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="ts-numeric font-bold">{ticket.id}</TableCell>
                      <TableCell>@{ticket.username}</TableCell>
                      <TableCell className="max-w-64 truncate">{ticket.subject}</TableCell>
                      <TableCell>{t(`trust.category.${ticket.category}`)}</TableCell>
                      <TableCell>
                        <TrustChip tone={labels.priority(ticket.priority).tone}>
                          {labels.priority(ticket.priority).label}
                        </TrustChip>
                      </TableCell>
                      <TableCell>
                        <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                      </TableCell>
                      <TableCell>{ticket.assignee ? `@${ticket.assignee}` : "—"}</TableCell>
                      <TableCell
                        className={cn("ts-numeric whitespace-nowrap", ticket.sla_breached && "text-danger font-bold")}
                      >
                        {ticket.status === "resolved" || ticket.status === "closed"
                          ? "—"
                          : slaText(ticket.sla_due_at, ticket.sla_breached, t)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* mobile cards */}
          <ul className="md:hidden space-y-2">
            {tickets.map((ticket) => {
              const chip = labels.ticketStatus(ticket.status);
              return (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(ticket.id)}
                    className="w-full text-left rounded-card border border-border bg-raised p-3"
                    aria-label={`${t("trust.ticket.ariaOpen")} ${ticket.subject}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-label font-bold text-foreground truncate">
                        #{ticket.id} · {ticket.subject}
                      </p>
                      <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                    </div>
                    <p className="text-caption text-muted-foreground mt-1">
                      @{ticket.username} · {t(`trust.category.${ticket.category}`)}
                      {ticket.assignee ? ` · @${ticket.assignee}` : ""}
                    </p>
                    {ticket.sla_breached ? (
                      <p className="text-caption font-bold text-danger mt-1">{t("trust.sla.breached")}</p>
                    ) : ticket.status !== "resolved" && ticket.status !== "closed" ? (
                      <p className="text-caption text-muted-foreground mt-1">
                        {slaText(ticket.sla_due_at, false, t)}
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {openId != null ? (
        <TicketDrawer token={token} ticketId={openId} staff={staff} onClose={() => {
          setOpenId(null);
          queue.reload();
        }} />
      ) : null}
    </section>
  );
}

function TicketDrawer({
  token,
  ticketId,
  staff,
  onClose,
}: {
  token: string;
  ticketId: number;
  staff: string[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const labels = useTrustLabels();
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextStatus, setNextStatus] = useState<string>("");
  const [resolutionNote, setResolutionNote] = useState("");

  const detail = useResource<{
    ticket: TrustTicket;
    messages: TicketMessage[];
    events: TicketEvent[];
  }>(async () => trustAdminFetch<{ ticket: TrustTicket; messages: TicketMessage[]; events: TicketEvent[] }>(token, `/tickets/${ticketId}`), [token, ticketId]);

  const macros = useResource<MacroRow[]>(
    async () => {
      try {
        const d = await trustAdminFetch<{ macros: MacroRow[] }>(token, "/macros");
        return d.macros ?? [];
      } catch {
        return [];
      }
    },
    [token],
  );
  const customer = useResource<TrustStatusPayload | null>(
    async () => {
      try {
        return await trustAdminFetch<TrustStatusPayload>(
          token,
          `/user-status?username=${encodeURIComponent(detail.data?.ticket.username ?? "")}`,
        );
      } catch {
        return null;
      }
    },
    [token, detail.data?.ticket.username],
  );

  const ticket = detail.data?.ticket;
  const messages = detail.data?.messages ?? [];

  const act = async (path: string, body: Record<string, unknown>, okToast: string) => {
    setBusy(true);
    try {
      await trustAdminFetch(token, path, { method: "POST", body: JSON.stringify(body) });
      toast({ title: okToast });
      detail.reload();
      setReply("");
      setResolutionNote("");
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
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto ts-scrollbar p-4 sm:p-6">
        <SheetHeader className="p-0">
          <SheetTitle className="text-left">
            #{ticketId} · {ticket?.subject ?? t("state.loading")}
          </SheetTitle>
          <SheetDescription className="text-left">
            {ticket
              ? `@${ticket.username} · ${t(`trust.category.${ticket.category}`)} · ${formatRelative(ticket.created_at)}${
                  ticket.order_id != null ? ` · ${t("trust.ticket.order")} #${ticket.order_id}` : ""
                }`
              : ""}
          </SheetDescription>
        </SheetHeader>

        {detail.loading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-14 w-full rounded-card" />
            <Skeleton className="h-14 w-full rounded-card" />
          </div>
        ) : detail.error ? (
          <ErrorState message={detail.error} onRetry={() => detail.reload()} />
        ) : !ticket ? null : (
          <div className="mt-4 space-y-4">
            {/* meta + customer record */}
            <div className="flex flex-wrap items-center gap-2">
              <TrustChip tone={labels.ticketStatus(ticket.status).tone}>
                {labels.ticketStatus(ticket.status).label}
              </TrustChip>
              <TrustChip tone={labels.priority(ticket.priority).tone}>
                {labels.priority(ticket.priority).label}
              </TrustChip>
              {ticket.sla_breached ? (
                <TrustChip tone="danger">{t("trust.sla.breached")}</TrustChip>
              ) : (
                <span className="text-caption text-muted-foreground">
                  {ticket.status !== "resolved" && ticket.status !== "closed"
                    ? slaText(ticket.sla_due_at, false, t)
                    : ""}
                </span>
              )}
              {customer.data ? (
                <TrustChip tone={customer.data.suspended ? "danger" : customer.data.status ? "warn" : "ok"}>
                  {t("trust.customer.record")}:{" "}
                  {customer.data.suspended
                    ? t("trust.customer.suspended")
                    : customer.data.status
                      ? customer.data.status
                      : t("trust.customer.ok")}
                  {customer.data.roles.length ? ` · ${customer.data.roles.join("/")}` : ""}
                  {customer.data.mfa_active ? ` · MFA` : ""}
                </TrustChip>
              ) : null}
              {ticket.csat_score != null ? (
                <TrustChip tone="gold">
                  {t("trust.csat.recorded")}: {ticket.csat_score}/5
                </TrustChip>
              ) : null}
            </div>
            {ticket.csat_score != null && ticket.csat_comment ? (
              <p className="text-caption text-muted-foreground">“{ticket.csat_comment}”</p>
            ) : null}

            {/* thread */}
            <div className="space-y-3 max-h-96 overflow-y-auto ts-scrollbar p-1">
              {messages.map((m) => {
                const isInternal = m.internal === 1 || m.internal === true;
                return (
                  <div key={m.id} className={cn("rounded-card border p-3", isInternal ? "border-gold/60 bg-gold-soft/40 border-dashed" : "border-border bg-section")}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-caption font-bold text-foreground">
                        @{m.author}
                        {isInternal ? (
                          <TrustChip tone="gold" className="ml-2">
                            {t("trust.note.internal")}
                          </TrustChip>
                        ) : null}
                      </p>
                      <p className="text-caption text-muted-foreground">{formatRelative(m.created_at)}</p>
                    </div>
                    <p className="text-label text-foreground whitespace-pre-wrap break-words mt-1">{m.body}</p>
                  </div>
                );
              })}
            </div>

            {/* reply box + macro insert + internal toggle */}
            <div className="rounded-card border border-border bg-raised p-3 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-label font-semibold text-foreground cursor-pointer">
                  <Switch checked={internal} onCheckedChange={setInternal} aria-label={t("trust.note.toggle")} />
                  {t("trust.note.toggle")}
                </label>
                <Select
                  onValueChange={(v) => {
                    const macro = (macros.data ?? []).find((m) => String(m.id) === v);
                    if (macro) setReply((prev) => (prev.trim() ? `${prev}\n\n${macro.body}` : macro.body));
                  }}
                >
                  <SelectTrigger className="min-h-11 w-56" aria-label={t("trust.macro.insert")}>
                    <SelectValue placeholder={t("trust.macro.insert")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(macros.data ?? []).map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={internal ? t("trust.note.placeholder") : t("trust.reply.placeholder")}
                className="min-h-24"
                aria-label={t("trust.reply.placeholder")}
              />
              <Button
                type="button"
                className="min-h-11 w-full sm:w-auto"
                disabled={busy || reply.trim().length < 2}
                onClick={() =>
                  void act(`/tickets/${ticketId}/reply`, { body: reply, internal }, internal ? t("trust.note.added") : t("trust.reply.sent"))
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {internal ? t("trust.note.submit") : t("trust.reply.submit")}
              </Button>
            </div>

            {/* assign + status */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-card border border-border bg-raised p-3 space-y-2">
                <p className="text-label font-bold text-foreground">{t("trust.assign.title")}</p>
                <Select
                  value={ticket.assignee ?? "unassigned"}
                  onValueChange={(v) =>
                    void act(
                      `/tickets/${ticketId}/assign`,
                      { assignee: v === "unassigned" ? "" : v },
                      t("trust.assign.done"),
                    )
                  }
                >
                  <SelectTrigger className="min-h-11" aria-label={t("trust.assign.title")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">{t("trust.filter.unassigned")}</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s} value={s}>
                        @{s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-caption text-muted-foreground">
                  {t("trust.assign.current")}: {ticket.assignee ? `@${ticket.assignee}` : "—"}
                </p>
              </div>
              <div className="rounded-card border border-border bg-raised p-3 space-y-2">
                <p className="text-label font-bold text-foreground">{t("trust.status.change")}</p>
                <Select value={nextStatus || ticket.status} onValueChange={setNextStatus}>
                  <SelectTrigger className="min-h-11" aria-label={t("trust.status.change")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["open", "pending", "resolved", "closed"].map((s) => (
                      <SelectItem key={s} value={s}>
                        {labels.ticketStatus(s).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder={t("trust.status.resolutionNote")}
                  className="min-h-11"
                  aria-label={t("trust.status.resolutionNote")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full"
                  disabled={busy || !nextStatus || nextStatus === ticket.status}
                  onClick={() =>
                    void act(
                      `/tickets/${ticketId}/status`,
                      { status: nextStatus, resolution_note: resolutionNote },
                      t("trust.status.changed"),
                    )
                  }
                >
                  {t("trust.status.apply")}
                </Button>
              </div>
            </div>

            {/* event log */}
            <div>
              <p className="text-label font-bold text-foreground mb-2">{t("trust.events.title")}</p>
              <ul className="space-y-1.5 max-h-48 overflow-y-auto ts-scrollbar">
                {(detail.data?.events ?? []).map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-caption text-muted-foreground">
                    <Activity className="size-3.5 shrink-0 text-teal" aria-hidden="true" />
                    <span className="font-semibold text-foreground">{e.type}</span>
                    <span>@{e.actor}</span>
                    <span>· {formatRelative(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── REPORTS ─────────────────────────────────────────────────────────────

function ReportsAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const labels = useTrustLabels();
  const [status, setStatus] = useState("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionTarget, setActionTarget] = useState<ReportRow | null>(null);
  const [outcome, setOutcome] = useState("");
  const [takedown, setTakedown] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<ReportRow | null>(null);
  const [dismissNote, setDismissNote] = useState("");

  const queue = useResource<ReportRow[]>(
    async () => {
      const qs = status !== "all" ? `?status=${status}` : "";
      const d = await trustAdminFetch<{ reports: ReportRow[] }>(token, `/reports${qs}`);
      return d.reports ?? [];
    },
    [token, status],
  );
  const cases = useResource<CaseRow[]>(
    async () => {
      try {
        const d = await trustAdminFetch<{ cases: CaseRow[] }>(token, "/cases");
        return d.cases ?? [];
      } catch {
        return [];
      }
    },
    [token],
  );

  const caseForReport = (reportId: number) =>
    (cases.data ?? []).find((c) => c.report_id === reportId);

  const doReview = async (r: ReportRow) => {
    setBusyId(r.id);
    try {
      const d = await trustAdminFetch<{ case_id: number }>(token, `/reports/${r.id}/review`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: t("trust.reports.reviewed"), description: `${t("trust.reports.case")} #${d.case_id}` });
      queue.reload();
      cases.reload();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const doAction = async () => {
    if (!actionTarget) return;
    setBusyId(actionTarget.id);
    try {
      const d = await trustAdminFetch<{ takedown?: { ended: boolean; notified: number } | null }>(
        token,
        `/reports/${actionTarget.id}/action`,
        { method: "POST", body: JSON.stringify({ outcome, takedown }) },
      );
      toast({
        title: t("trust.reports.actioned"),
        description: d.takedown
          ? t("trust.reports.takenDown").replace("{n}", String(d.takedown.notified))
          : undefined,
      });
      setActionTarget(null);
      setOutcome("");
      setTakedown(false);
      queue.reload();
      cases.reload();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const doDismiss = async () => {
    if (!dismissTarget) return;
    setBusyId(dismissTarget.id);
    try {
      await trustAdminFetch(token, `/reports/${dismissTarget.id}/dismiss`, {
        method: "POST",
        body: JSON.stringify({ outcome: dismissNote }),
      });
      toast({ title: t("trust.reports.dismissed") });
      setDismissTarget(null);
      setDismissNote("");
      queue.reload();
      cases.reload();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const reports = queue.data ?? [];

  return (
    <section aria-labelledby="trust-reports-heading" className="min-w-0 space-y-4">
      <SectionHeader
        title={<span id="trust-reports-heading">{t("trust.console.reports")}</span>}
        subtitle={t("trust.console.reportsSub")}
        action={
          <Button type="button" variant="outline" className="min-h-11" onClick={() => queue.reload()} aria-label={t("state.retry")}>
            <RefreshCw className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("state.retry")}</span>
          </Button>
        }
      />

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="min-h-11 w-44" aria-label={t("trust.filter.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("trust.filter.all")}</SelectItem>
          {["received", "reviewing", "actioned", "dismissed"].map((s) => (
            <SelectItem key={s} value={s}>
              {labels.reportStatus(s).label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {queue.loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : queue.error ? (
        <ErrorState message={queue.error} onRetry={() => queue.reload()} />
      ) : reports.length === 0 ? (
        <EmptyState icon={<ShieldAlert className="size-10" />} title={t("trust.empty.queue")} body={t("trust.empty.queueBody")} />
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const chip = labels.reportStatus(r.status);
            const linked = caseForReport(r.id);
            return (
              <li key={r.id} className="rounded-card border border-border bg-raised p-4 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-label font-bold text-foreground">
                      #{r.id} · {t(`reports.reason.${r.reason_code}`)}
                    </p>
                    <p className="text-caption text-muted-foreground mt-0.5">
                      @{r.reporter} → {r.target_type} {r.target_id} · {formatRelative(r.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {linked ? (
                      <TrustChip tone="teal">
                        {t("trust.reports.case")} #{linked.id}
                      </TrustChip>
                    ) : null}
                    <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                  </div>
                </div>
                {r.note ? (
                  <p className="text-caption text-foreground/90 line-clamp-3">{r.note}</p>
                ) : null}
                {r.outcome ? (
                  <p className="text-caption text-muted-foreground">
                    {t("trust.reports.outcome")}: {r.outcome}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {r.status === "received" ? (
                    <Button type="button" variant="outline" className="min-h-11" disabled={busyId === r.id} onClick={() => void doReview(r)}>
                      {busyId === r.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                      {t("trust.reports.review")}
                    </Button>
                  ) : null}
                  {r.status === "received" || r.status === "reviewing" ? (
                    <>
                      <Button
                        type="button"
                        className="min-h-11 bg-warn text-warn-foreground hover:bg-warn/90"
                        disabled={busyId === r.id}
                        onClick={() => {
                          setActionTarget(r);
                          setTakedown(r.target_type === "listing");
                        }}
                      >
                        <Gavel className="size-4" aria-hidden="true" />
                        {t("trust.reports.action")}
                      </Button>
                      <Button type="button" variant="outline" className="min-h-11" disabled={busyId === r.id} onClick={() => setDismissTarget(r)}>
                        {t("trust.reports.dismiss")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* action dialog */}
      <Dialog open={actionTarget != null} onOpenChange={(o) => !o && setActionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("trust.reports.actionTitle")}</DialogTitle>
            <DialogDescription>
              {actionTarget
                ? `#${actionTarget.id} · ${actionTarget.target_type} ${actionTarget.target_id}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="report-outcome">{t("trust.reports.outcome")}</Label>
              <Input
                id="report-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="min-h-11"
                placeholder={t("trust.reports.outcomePlaceholder")}
              />
            </div>
            {actionTarget?.target_type === "listing" ? (
              <label className="flex items-center gap-2 rounded-control border border-border bg-section p-3 text-label text-foreground cursor-pointer">
                <Switch checked={takedown} onCheckedChange={setTakedown} aria-label={t("trust.reports.takedown")} />
                {t("trust.reports.takedown")}
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setActionTarget(null)}>
              {t("action.cancel")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" className="min-h-11" disabled={outcome.trim().length < 3}>
                  {takedown ? t("trust.reports.actionConfirm") : t("trust.reports.action")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("trust.reports.confirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {takedown ? t("trust.reports.confirmTakedown") : t("trust.reports.confirmAction")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
                  <AlertDialogAction className="min-h-11" onClick={() => void doAction()}>
                    {t("action.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dismiss dialog */}
      <Dialog open={dismissTarget != null} onOpenChange={(o) => !o && setDismissTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("trust.reports.dismissTitle")}</DialogTitle>
            <DialogDescription>{t("trust.reports.dismissBody")}</DialogDescription>
          </DialogHeader>
          <Input
            value={dismissNote}
            onChange={(e) => setDismissNote(e.target.value)}
            className="min-h-11"
            placeholder={t("trust.reports.outcomePlaceholder")}
            aria-label={t("trust.reports.outcome")}
          />
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setDismissTarget(null)}>
              {t("action.cancel")}
            </Button>
            <Button type="button" className="min-h-11" onClick={() => void doDismiss()}>
              {t("trust.reports.dismiss")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── ENFORCEMENT ─────────────────────────────────────────────────────────

function EnforcementAdmin({ token, actor }: { token: string; actor: string }) {
  const { t } = useI18n();
  const labels = useTrustLabels();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", action: "warning", reason: "", note: "", days: "" });
  const [confirmAction, setConfirmAction] = useState(false);
  const [approveTarget, setApproveTarget] = useState<EnforcementRow | null>(null);
  const [appealTarget, setAppealTarget] = useState<AppealRow | null>(null);
  const [appealDecision, setAppealDecision] = useState("granted");
  const [appealNote, setAppealNote] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<SuspensionRow | null>(null);
  const [restoreReason, setRestoreReason] = useState("");

  const data = useResource<{ enforcement: EnforcementRow[]; suspensions: SuspensionRow[] }>(
    async () => trustAdminFetch(token, "/enforcement"),
    [token],
  );
  const appeals = useResource<AppealRow[]>(
    async () => {
      const d = await trustAdminFetch<{ appeals: AppealRow[] }>(token, "/appeals");
      return d.appeals ?? [];
    },
    [token],
  );
  const roles = useResource<RoleRow[]>(
    async () => {
      const d = await trustAdminFetch<{ roles: RoleRow[] }>(token, "/roles");
      return d.roles ?? [];
    },
    [token],
  );

  const reloadAll = () => {
    data.reload();
    appeals.reload();
    roles.reload();
  };

  const rows = data.data?.enforcement ?? [];
  const suspensions = data.data?.suspensions ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const openAppeals = (appeals.data ?? []).filter((a) => a.status === "received" || a.status === "under_review");

  const createAction = async () => {
    setBusy(true);
    try {
      const d = await trustAdminFetch<{ id: number; pending: boolean }>(token, "/enforcement", {
        method: "POST",
        body: JSON.stringify({
          username: form.username.trim().toLowerCase(),
          action: form.action,
          reason_code: form.reason.trim(),
          note: form.note.trim(),
          days: form.action === "suspension" && form.days.trim() ? Number(form.days) : undefined,
        }),
      });
      toast({
        title: d.pending ? t("trust.enforcement.pendingToast") : t("trust.enforcement.appliedToast"),
        description: `#${d.id}`,
      });
      setForm({ username: "", action: "warning", reason: "", note: "", days: "" });
      reloadAll();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setConfirmAction(false);
    }
  };

  const approve = async () => {
    if (!approveTarget) return;
    setBusy(true);
    try {
      await trustAdminFetch(token, `/enforcement/${approveTarget.id}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: t("trust.enforcement.approvedToast") });
      setApproveTarget(null);
      reloadAll();
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

  const decideAppeal = async () => {
    if (!appealTarget) return;
    setBusy(true);
    try {
      await trustAdminFetch(token, `/appeals/${appealTarget.id}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision: appealDecision, decision_note: appealNote }),
      });
      toast({ title: t("trust.appeal.decidedToast") });
      setAppealTarget(null);
      setAppealNote("");
      reloadAll();
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

  const restore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      await trustAdminFetch(token, "/enforcement", {
        method: "POST",
        body: JSON.stringify({
          username: restoreTarget.username,
          action: "reinstate",
          reason_code: restoreReason.trim() || "restored_by_admin",
          note: `Restored from the Support & Trust console by @${actor}.`,
        }),
      });
      toast({ title: t("trust.enforcement.restoredToast") });
      setRestoreTarget(null);
      setRestoreReason("");
      reloadAll();
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
    <section aria-labelledby="trust-enf-heading" className="min-w-0 space-y-6">
      <SectionHeader
        title={<span id="trust-enf-heading">{t("trust.console.enforcement")}</span>}
        subtitle={t("trust.console.enforcementSub")}
      />

      {/* action form */}
      <div className="rounded-card border border-border bg-raised p-4 space-y-3">
        <p className="text-label font-bold text-foreground">{t("trust.enforcement.formTitle")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="enf-username">{t("trust.enforcement.username")}</Label>
            <Input
              id="enf-username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="chipo"
              className="min-h-11"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="enf-action">{t("trust.enforcement.action")}</Label>
            <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
              <SelectTrigger id="enf-action" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["warning", "restriction", "suspension", "ban"].map((a) => (
                  <SelectItem key={a} value={a}>
                    {labels.enforcementAction(a).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="enf-reason">
              {t("trust.enforcement.reason")} <span className="text-danger">*</span>
            </Label>
            <Input
              id="enf-reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder={t("trust.enforcement.reasonPlaceholder")}
              className="min-h-11"
              required
            />
          </div>
          {form.action === "suspension" ? (
            <div className="grid gap-2">
              <Label htmlFor="enf-days">{t("trust.enforcement.days")}</Label>
              <Input
                id="enf-days"
                value={form.days}
                onChange={(e) => setForm({ ...form, days: e.target.value.replace(/\D/g, "") })}
                inputMode="numeric"
                placeholder="3"
                className="min-h-11"
              />
            </div>
          ) : null}
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="enf-note">{t("trust.enforcement.note")}</Label>
            <Textarea
              id="enf-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="min-h-16"
              placeholder={t("trust.enforcement.notePlaceholder")}
            />
          </div>
        </div>
        <p className="text-caption text-muted-foreground">{t("trust.enforcement.dualNote")}</p>
        <AlertDialog open={confirmAction} onOpenChange={setConfirmAction}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              className="min-h-11 bg-danger text-white hover:bg-danger/90"
              disabled={busy || !form.username.trim() || !form.reason.trim()}
            >
              <Gavel className="size-4" aria-hidden="true" />
              {t("trust.enforcement.apply")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("trust.enforcement.confirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("trust.enforcement.confirmBody")
                  .replace("{action}", labels.enforcementAction(form.action).label)
                  .replace("{user}", form.username.trim() || "—")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
              <AlertDialogAction className="min-h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void createAction()}>
                {t("action.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* current suspensions */}
      <div>
        <p className="text-label font-bold text-foreground mb-2">{t("trust.enforcement.current")}</p>
        {data.loading ? (
          <Skeleton className="h-20 w-full rounded-card" />
        ) : suspensions.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("trust.enforcement.noneCurrent")}</p>
        ) : (
          <ul className="space-y-2">
            {suspensions.map((s) => (
              <li key={s.username} className="flex items-center justify-between gap-3 flex-wrap rounded-card border border-danger/30 bg-danger/5 p-3">
                <div className="min-w-0">
                  <p className="text-label font-bold text-foreground flex items-center gap-2 flex-wrap">
                    <span>@{s.username}</span>
                    <TrustChip tone={labels.enforcementAction(s.status === "warned" ? "warning" : s.status === "restricted" ? "restriction" : s.status === "suspended" ? "suspension" : "ban").tone}>
                      {labels.enforcementAction(s.status === "warned" ? "warning" : s.status === "restricted" ? "restriction" : s.status === "suspended" ? "suspension" : "ban").label}
                    </TrustChip>
                  </p>
                  <p className="text-caption text-muted-foreground mt-1 truncate">
                    {s.reason_code} · {formatRelative(s.enforced_at)}
                    {s.until ? ` · ${t("trust.banner.until")} ${formatRelative(s.until)}` : ""}
                  </p>
                </div>
                <Button type="button" variant="outline" className="min-h-11" onClick={() => setRestoreTarget(s)}>
                  <UserCheck className="size-4" aria-hidden="true" />
                  {t("trust.enforcement.restore")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* pending dual approvals */}
      <div>
        <p className="text-label font-bold text-foreground mb-2">{t("trust.enforcement.pendingTitle")}</p>
        {data.loading ? (
          <Skeleton className="h-16 w-full rounded-card" />
        ) : pending.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("trust.enforcement.nonePending")}</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((p) => {
              const chip = labels.enforcementAction(p.action);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 flex-wrap rounded-card border border-warn/40 bg-warn/10 p-3">
                  <div className="min-w-0">
                    <p className="text-label font-bold text-foreground">
                      #{p.id} · @{p.username} · <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                    </p>
                    <p className="text-caption text-muted-foreground mt-1 truncate">
                      {p.reason_code} · {t("trust.enforcement.by")} @{p.requested_by} · {formatRelative(p.created_at)}
                    </p>
                  </div>
                  <Button type="button" className="min-h-11" disabled={p.requested_by === actor} onClick={() => setApproveTarget(p)}>
                    <UserCheck className="size-4" aria-hidden="true" />
                    {t("trust.enforcement.approve")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-caption text-muted-foreground mt-1.5">{t("trust.enforcement.dualHonest")}</p>
      </div>

      {/* appeals queue */}
      <div>
        <p className="text-label font-bold text-foreground mb-2">{t("trust.appeal.queueTitle")}</p>
        {appeals.loading ? (
          <Skeleton className="h-16 w-full rounded-card" />
        ) : openAppeals.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("trust.appeal.noneOpen")}</p>
        ) : (
          <ul className="space-y-2">
            {openAppeals.map((a) => {
              const chip = labels.appealStatus(a.status);
              return (
                <li key={a.id} className="rounded-card border border-border bg-raised p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-label font-bold text-foreground">
                      #{a.id} · @{a.username}
                    </p>
                    <div className="flex items-center gap-2">
                      {a.enforcement_action ? (
                        <TrustChip tone={labels.enforcementAction(a.enforcement_action).tone}>
                          {labels.enforcementAction(a.enforcement_action).label}
                        </TrustChip>
                      ) : null}
                      <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                    </div>
                  </div>
                  <p className="text-caption text-foreground/90 line-clamp-3">{a.body}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      setAppealTarget(a);
                      setAppealDecision("granted");
                    }}
                  >
                    <Gavel className="size-4" aria-hidden="true" />
                    {t("trust.appeal.decide")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* history */}
      <div>
        <p className="text-label font-bold text-foreground mb-2">{t("trust.enforcement.history")}</p>
        <ul className="space-y-1.5 max-h-96 overflow-y-auto ts-scrollbar pr-1">
          {rows.map((r) => {
            const chip = labels.enforcementAction(r.action);
            return (
              <li key={r.id} className="flex items-center gap-2 flex-wrap text-caption rounded-control border border-border bg-raised px-3 py-2">
                <span className="ts-numeric font-bold text-foreground">#{r.id}</span>
                <span className="font-semibold text-foreground">@{r.username}</span>
                <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                {r.status === "pending" ? <TrustChip tone="warn">{t("trust.status.pendingHit")}</TrustChip> : null}
                <span className="text-muted-foreground truncate">{r.reason_code}</span>
                <span className="text-muted-foreground ml-auto whitespace-nowrap">{formatRelative(r.created_at)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <RolesCard token={token} roles={roles} onReload={reloadAll} />
      <HealthCard token={token} />

      {/* approve confirm */}
      <AlertDialog open={approveTarget != null} onOpenChange={(o) => !o && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trust.enforcement.approveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {approveTarget
                ? t("trust.enforcement.approveBody")
                    .replace("{user}", approveTarget.username)
                    .replace("{action}", labels.enforcementAction(approveTarget.action).label)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void approve()}>
              {t("action.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* appeal decide dialog */}
      <Dialog open={appealTarget != null} onOpenChange={(o) => !o && setAppealTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("trust.appeal.decideTitle")}</DialogTitle>
            <DialogDescription>
              {appealTarget ? `#${appealTarget.id} · @${appealTarget.username}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={appealDecision} onValueChange={setAppealDecision}>
              <SelectTrigger className="min-h-11" aria-label={t("trust.appeal.decision")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="granted">{t("trust.appeal.granted")}</SelectItem>
                <SelectItem value="denied">{t("trust.appeal.denied")}</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={appealNote}
              onChange={(e) => setAppealNote(e.target.value)}
              placeholder={t("trust.appeal.decisionNote")}
              className="min-h-20"
              aria-label={t("trust.appeal.decisionNote")}
            />
            {appealDecision === "granted" ? (
              <p className="text-caption text-teal-deep">{t("trust.appeal.grantedNote")}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setAppealTarget(null)}>
              {t("action.cancel")}
            </Button>
            <Button type="button" className="min-h-11" disabled={busy} onClick={() => void decideAppeal()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {t("trust.appeal.decide")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* restore dialog */}
      <Dialog open={restoreTarget != null} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("trust.enforcement.restoreTitle")}</DialogTitle>
            <DialogDescription>
              {restoreTarget
                ? t("trust.enforcement.restoreBody").replace("{user}", restoreTarget.username)
                : ""}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={restoreReason}
            onChange={(e) => setRestoreReason(e.target.value)}
            className="min-h-11"
            placeholder={t("trust.enforcement.reasonPlaceholder")}
            aria-label={t("trust.enforcement.reason")}
          />
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setRestoreTarget(null)}>
              {t("action.cancel")}
            </Button>
            <Button type="button" className="min-h-11" disabled={busy} onClick={() => void restore()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {t("trust.enforcement.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RolesCard({
  token,
  roles,
  onReload,
}: {
  token: string;
  roles: { data: RoleRow[] | null; loading: boolean; reload: () => void };
  onReload: () => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("support");
  const [busy, setBusy] = useState(false);

  const assign = async () => {
    setBusy(true);
    try {
      await trustAdminFetch(token, "/roles", {
        method: "POST",
        body: JSON.stringify({ username: username.trim().toLowerCase(), role }),
      });
      toast({ title: t("trust.roles.assigned") });
      setUsername("");
      onReload();
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

  const revoke = async (row: RoleRow) => {
    setBusy(true);
    try {
      await trustAdminFetch(token, "/roles", {
        method: "DELETE",
        body: JSON.stringify({ username: row.username }),
      });
      toast({ title: t("trust.roles.revoked") });
      onReload();
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
    <div className="rounded-card border border-border bg-raised p-4 space-y-3">
      <p className="text-label font-bold text-foreground">{t("trust.roles.title")}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          className="min-h-11 w-40"
          aria-label={t("trust.enforcement.username")}
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="min-h-11 w-40" aria-label={t("trust.roles.role")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["admin", "support", "finance", "moderator", "compliance"].map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" className="min-h-11" disabled={busy || !username.trim()} onClick={() => void assign()}>
          {t("trust.roles.assign")}
        </Button>
      </div>
      <ul className="space-y-1.5 max-h-48 overflow-y-auto ts-scrollbar pr-1">
        {(roles.data ?? []).map((r) => (
          <li key={r.username} className="flex items-center gap-2 flex-wrap text-caption rounded-control border border-border bg-section px-3 py-2">
            <span className="font-bold text-foreground">@{r.username}</span>
            <TrustChip tone="teal">{r.role}</TrustChip>
            <span className="text-muted-foreground truncate">@{r.assigned_by}</span>
            <Button
              type="button"
              variant="ghost"
              className="ml-auto min-h-11 px-2 text-danger"
              disabled={busy}
              onClick={() => void revoke(r)}
              aria-label={t("trust.roles.revoke")}
            >
              {t("trust.roles.revoke")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HealthCard({ token }: { token: string }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{
    score: number;
    dispatch_on_time: number;
    dispute_rate: number;
    rating_avg: number;
    flag_count: number;
    orders_total: number;
    computed_at: string;
  } | null>(null);

  const check = async () => {
    setBusy(true);
    try {
      const d = await trustAdminFetch<{ health: typeof health }>(
        token,
        `/health-score?username=${encodeURIComponent(username.trim().toLowerCase())}`,
      );
      setHealth(d.health);
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
    <div className="rounded-card border border-border bg-raised p-4 space-y-3">
      <p className="text-label font-bold text-foreground flex items-center gap-2">
        <HeartPulse className="size-4 text-teal" aria-hidden="true" />
        {t("trust.health.title")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="rufaro"
          className="min-h-11 w-40"
          aria-label={t("trust.enforcement.username")}
        />
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || !username.trim()} onClick={() => void check()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
          {t("trust.health.check")}
        </Button>
      </div>
      {health ? (
        <div className="flex flex-wrap items-center gap-2">
          <TrustChip tone={health.score >= 80 ? "ok" : health.score >= 50 ? "warn" : "danger"}>
            {t("trust.health.score")}: {health.score}/100
          </TrustChip>
          <span className="text-caption text-muted-foreground">
            {t("trust.health.dispatch")}: {Math.round(health.dispatch_on_time * 100)}% · {t("trust.health.disputes")}:{" "}
            {Math.round(health.dispute_rate * 100)}% · ★ {health.rating_avg} · {t("trust.health.flags")}: {health.flag_count} ·{" "}
            {health.orders_total} {t("trust.health.orders")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ── SCREENING ───────────────────────────────────────────────────────────

function ScreeningAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const labels = useTrustLabels();
  const [busy, setBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [takedownTarget, setTakedownTarget] = useState<ScreeningHit | null>(null);

  const data = useResource<{
    rules: ScreeningRule[];
    hits: ScreeningHit[];
    stats: { pending: number; cleared: number; actioned: number };
  }>(async () => trustAdminFetch(token, "/screening"), [token]);

  const scan = async () => {
    setScanBusy(true);
    try {
      const d = await trustAdminFetch<{ scanned: number; newHits: number; totalPending: number }>(
        token,
        "/screening/scan",
        { method: "POST", body: JSON.stringify({}) },
      );
      toast({
        title: t("trust.screening.scanToast"),
        description: `${d.scanned} scanned · ${d.newHits} new · ${d.totalPending} pending`,
      });
      data.reload();
    } catch (err) {
      toast({
        title: t("admin.actionFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setScanBusy(false);
    }
  };

  const clearHit = async (hit: ScreeningHit) => {
    setBusy(true);
    try {
      await trustAdminFetch(token, `/screening/hits/${hit.id}/clear`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: t("trust.screening.clearedToast") });
      data.reload();
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

  const actionHit = async () => {
    if (!takedownTarget) return;
    setBusy(true);
    try {
      const d = await trustAdminFetch<{ takedown?: { ended: boolean; notified: number } }>(
        token,
        `/screening/hits/${takedownTarget.id}/action`,
        { method: "POST", body: JSON.stringify({}) },
      );
      toast({
        title: t("trust.screening.actionedToast"),
        description: d.takedown
          ? t("trust.reports.takenDown").replace("{n}", String(d.takedown.notified))
          : undefined,
      });
      setTakedownTarget(null);
      data.reload();
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

  const rules = data.data?.rules ?? [];
  const hits = data.data?.hits ?? [];
  const stats = data.data?.stats;

  return (
    <section aria-labelledby="trust-screen-heading" className="min-w-0 space-y-4">
      <SectionHeader
        title={<span id="trust-screen-heading">{t("trust.console.screening")}</span>}
        subtitle={t("trust.console.screeningSub")}
        action={
          <Button type="button" className="min-h-11" disabled={scanBusy} onClick={() => void scan()}>
            {scanBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{t("trust.screening.scanNow")}</span>
          </Button>
        }
      />

      {stats ? (
        <div className="flex flex-wrap gap-2">
          <TrustChip tone="warn">{t("trust.status.pendingHit")}: {stats.pending}</TrustChip>
          <TrustChip tone="ok">{t("trust.status.cleared")}: {stats.cleared}</TrustChip>
          <TrustChip tone="danger">{t("trust.status.actionedHit")}: {stats.actioned}</TrustChip>
          <TrustChip tone="teal">{t("trust.screening.rulesCount")}: {rules.length}</TrustChip>
        </div>
      ) : null}

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* rules */}
        <div className="rounded-card border border-border bg-raised p-4">
          <p className="text-label font-bold text-foreground mb-2">{t("trust.screening.rules")}</p>
          {data.loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-control" />
              ))}
            </div>
          ) : (
            <ul className="space-y-1.5 max-h-96 overflow-y-auto ts-scrollbar pr-1">
              {rules.map((r) => (
                <li key={r.id} className="text-caption rounded-control border border-border bg-section px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <TrustChip tone={r.category === "prohibited" ? "danger" : "gold"}>{r.category}</TrustChip>
                    <code className="text-muted-foreground break-all">{r.pattern}</code>
                  </div>
                  {r.note ? <p className="text-muted-foreground mt-1">{r.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* hits */}
        <div className="rounded-card border border-border bg-raised p-4">
          <p className="text-label font-bold text-foreground mb-2">{t("trust.screening.hits")}</p>
          {data.loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-control" />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("trust.empty.queueBody")}</p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto ts-scrollbar pr-1">
              {hits.map((h) => {
                const chip = labels.hitStatus(h.status);
                return (
                  <li key={h.id} className="rounded-control border border-border bg-section p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-label font-bold text-foreground truncate">
                          #{h.id} · {h.auction_title ?? `Auction ${h.auction_id}`}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          @{h.auction_seller ?? "?"} · {h.auction_status ?? ""} · {formatRelative(h.created_at)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <TrustChip tone={chip.tone}>{chip.label}</TrustChip>
                        <TrustChip tone="muted">{h.pattern.slice(0, 24)}…</TrustChip>
                      </div>
                    </div>
                    {h.status === "pending" ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 flex-1"
                          disabled={busy}
                          onClick={() => void clearHit(h)}
                        >
                          {t("trust.screening.clear")}
                        </Button>
                        <Button
                          type="button"
                          className="min-h-11 flex-1 bg-danger text-white hover:bg-danger/90"
                          disabled={busy}
                          onClick={() => setTakedownTarget(h)}
                        >
                          <Gavel className="size-4" aria-hidden="true" />
                          {t("trust.screening.takedown")}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* takedown confirm */}
      <AlertDialog open={takedownTarget != null} onOpenChange={(o) => !o && setTakedownTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trust.screening.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {takedownTarget
                ? t("trust.screening.confirmBody").replace("{title}", takedownTarget.auction_title ?? `Auction ${takedownTarget.auction_id}`)
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void actionHit()}>
              {t("action.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
