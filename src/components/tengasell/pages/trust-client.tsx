"use client";

// Tengasell — Support & Trust shared client helpers (Task 12-c resume).
// RELATIVE fetches only (/api/trust/** — the BFF proxies :3007 and gates on
// the TrailBase token), the wire types for every trust surface, and the
// teal/gold chip vocabulary shared by the console + user sections.
//
// NXS note: chip classNames are PLAIN TEMPLATE LITERALS (never through
// cn()) — tailwind-merge treats the custom text-* size tokens and text-*
// colors as one group and would silently drop one of them.

import { useI18n } from "@/lib/tengasell/i18n";

// ── wire types (trust-service serializers) ──────────────────────────────

export interface TrustTicket {
  id: number;
  username: string;
  subject: string;
  category: string;
  priority: string;
  order_id: number | null;
  auction_id: number | null;
  status: string;
  assignee: string | null;
  sla_due_at: string;
  first_reply_at: string | null;
  resolved_at: string | null;
  csat_score: number | null;
  csat_comment: string;
  created_at: string;
  sla_breached?: boolean;
  message_count?: number;
}

export interface TicketMessage {
  id: number;
  author: string;
  body: string;
  internal?: number | boolean;
  attachment?: string | null;
  created_at: string;
}

export interface TicketEvent {
  id: number;
  ticket_id: number;
  actor: string;
  type: string;
  payload: string;
  created_at: string;
}

export interface ReportRow {
  id: number;
  reporter: string;
  target_type: string;
  target_id: string;
  reason_code: string;
  note: string;
  status: string;
  reviewer: string | null;
  reviewed_at: string | null;
  outcome: string;
  created_at: string;
}

export interface CaseRow {
  id: number;
  report_id: number | null;
  ticket_id: number | null;
  subject: string;
  username: string;
  kind: string;
  status: string;
  risk_score: number;
  created_at: string;
  resolved_at: string | null;
  outcome: string;
  order_id?: number | null;
  auction_id?: number | null;
  ticket_status?: string | null;
  sla_breached?: boolean;
}

export interface EnforcementRow {
  id: number;
  username: string;
  action: string;
  reason_code: string;
  note: string;
  dual_approval: number;
  status: string;
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  lifts_at: string | null;
}

export interface SuspensionRow {
  username: string;
  status: string;
  reason_code: string;
  reason_note: string;
  until: string | null;
  enforced_by: string;
  enforced_at: string;
  evidence_ref: string | null;
}

export interface AppealRow {
  id: number;
  enforcement_id: number;
  username: string;
  body: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
  enforcement_action?: string;
  enforcement_reason?: string;
  enforcement_status?: string;
}

export interface ScreeningRule {
  id: number;
  pattern: string;
  category: string;
  note: string;
  active: number;
}

export interface ScreeningHit {
  id: number;
  auction_id: number;
  rule_id: number;
  pattern: string;
  status: string;
  reviewer: string | null;
  created_at: string;
  resolved_at: string | null;
  auction_title?: string | null;
  auction_seller?: string | null;
  auction_status?: string | null;
}

export interface TrustStatusPayload {
  username: string;
  suspended: boolean;
  status: string | null;
  reason_code: string;
  reason_note: string;
  until: string | null;
  roles: string[];
  mfa_active: boolean;
}

export interface MacroRow {
  id: number;
  title: string;
  body: string;
  locale: string;
}

export interface RoleRow {
  username: string;
  role: string;
  assigned_by: string;
  assigned_at: string;
  note: string;
}

export interface TrustStats {
  tickets_open: number;
  sla_breaches: number;
  reports_pending: number;
  enforcement_30d: number;
  screening_pending: number;
  appeals_open: number;
  cases_open: number;
  csat_avg: number;
}

export interface DisputeRow {
  id: number;
  ticket_id: number | null;
  subject: string;
  status: string;
  outcome: string;
  created_at: string;
  resolved_at: string | null;
  risk_score: number;
  order_id: number | null;
  auction_id: number | null;
  ticket_status: string | null;
}

// ── client fetch helpers ────────────────────────────────────────────────

export async function trustFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/trust${path}`, {
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

export async function trustAdminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return trustFetch<T>(token, `/admin${path}`, init);
}

// ── chip vocabulary (teal/gold law — zero blue/indigo) ──────────────────

export type TrustTone = "ok" | "warn" | "muted" | "danger" | "teal" | "gold";

const TONE_CLASSES: Record<TrustTone, string> = {
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  muted: "bg-muted text-muted-foreground border-border",
  danger: "bg-danger/10 text-danger border-danger/30",
  teal: "bg-teal-tint text-teal-deep border-teal/30",
  gold: "bg-gold-soft text-gold-on border-gold/40",
};

export function TrustChip({
  tone,
  children,
  label,
  className = "",
}: {
  tone: TrustTone;
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <span
      aria-label={label}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-bold whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ── label maps (i18n) ───────────────────────────────────────────────────

export function useTrustLabels() {
  const { t } = useI18n();
  const ticketStatus = (s: string): { tone: TrustTone; label: string } => {
    switch (s) {
      case "open":
        return { tone: "teal", label: t("trust.status.open") };
      case "pending":
        return { tone: "gold", label: t("trust.status.pending") };
      case "resolved":
        return { tone: "ok", label: t("trust.status.resolved") };
      case "closed":
        return { tone: "muted", label: t("trust.status.closed") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const priority = (p: string): { tone: TrustTone; label: string } => {
    switch (p) {
      case "urgent":
        return { tone: "danger", label: t("trust.priority.urgent") };
      case "high":
        return { tone: "warn", label: t("trust.priority.high") };
      case "normal":
        return { tone: "muted", label: t("trust.priority.normal") };
      case "low":
        return { tone: "muted", label: t("trust.priority.low") };
      default:
        return { tone: "muted", label: p };
    }
  };
  const reportStatus = (s: string): { tone: TrustTone; label: string } => {
    switch (s) {
      case "received":
        return { tone: "teal", label: t("trust.status.received") };
      case "reviewing":
        return { tone: "gold", label: t("trust.status.reviewing") };
      case "actioned":
        return { tone: "ok", label: t("trust.status.actioned") };
      case "dismissed":
        return { tone: "muted", label: t("trust.status.dismissed") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const caseStatus = (s: string): { tone: TrustTone; label: string } => {
    switch (s) {
      case "open":
        return { tone: "danger", label: t("trust.status.openCase") };
      case "under_review":
        return { tone: "gold", label: t("trust.status.underReview") };
      case "resolved":
        return { tone: "ok", label: t("trust.status.resolved") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const enforcementAction = (a: string): { tone: TrustTone; label: string } => {
    switch (a) {
      case "warning":
        return { tone: "gold", label: t("trust.enforcement.warning") };
      case "restriction":
        return { tone: "warn", label: t("trust.enforcement.restriction") };
      case "suspension":
        return { tone: "danger", label: t("trust.enforcement.suspension") };
      case "ban":
        return { tone: "danger", label: t("trust.enforcement.ban") };
      case "reinstate":
        return { tone: "ok", label: t("trust.enforcement.reinstate") };
      default:
        return { tone: "muted", label: a };
    }
  };
  const appealStatus = (s: string): { tone: TrustTone; label: string } => {
    switch (s) {
      case "received":
        return { tone: "teal", label: t("trust.status.received") };
      case "under_review":
        return { tone: "gold", label: t("trust.status.underReview") };
      case "granted":
        return { tone: "ok", label: t("trust.appeal.granted") };
      case "denied":
        return { tone: "danger", label: t("trust.appeal.denied") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const hitStatus = (s: string): { tone: TrustTone; label: string } => {
    switch (s) {
      case "pending":
        return { tone: "warn", label: t("trust.status.pendingHit") };
      case "cleared":
        return { tone: "ok", label: t("trust.status.cleared") };
      case "actioned":
        return { tone: "danger", label: t("trust.status.actionedHit") };
      default:
        return { tone: "muted", label: s };
    }
  };
  return { ticketStatus, priority, reportStatus, caseStatus, enforcementAction, appealStatus, hitStatus };
}

/** "d left" / "overdue by d" helper for SLA countdown text. */
export function slaText(dueIso: string, breached: boolean | undefined, t: (k: string) => string): string {
  const diffMs = Date.parse(dueIso) - Date.now();
  if (breached) return t("trust.sla.breached");
  if (!Number.isFinite(diffMs)) return "";
  const h = Math.max(0, Math.round(diffMs / 3_600_000));
  if (h < 1) return t("trust.sla.now");
  if (h < 48) return `${h}h ${t("trust.sla.left")}`;
  return `${Math.round(h / 24)}d ${t("trust.sla.left")}`;
}
