"use client";

// Tengasell — governance & compliance shared client helpers (Task 12-d).
// RELATIVE fetches only (/api/gov/** and /api/compliance/** — the BFF proxies
// govern-service :3008 and gates on the TrailBase token), the wire types for
// every governance surface, and the teal/gold chip vocabulary shared by the
// governance console + compliance console + public policy reader.
//
// NXS note: chip classNames are PLAIN TEMPLATE LITERALS (never through
// cn()) — tailwind-merge treats the custom text-* size tokens and text-*
// colors as one group and would silently drop one of them.

import { useMemo } from "react";
import { useI18n } from "@/lib/tengasell/i18n";

// ── markdown-lite (policy body renderer — React-escaped by construction) ──

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "para"; text: string };

function parseMarkdownLite(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.split(/\r?\n/);
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: "para", text: para.join(" ") });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ kind: "list", items: list });
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("- ")) {
      flushPara();
      list.push(line.slice(2).trim());
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/** Renders a stored policy body (## headings, - lists, paragraphs) as styled
 *  JSX. Text only ever flows through React elements — HTML is escaped by
 *  construction (no dangerouslySetInnerHTML anywhere in this module). */
export function PolicyMarkdown({ body, compact = false }: { body: string; compact?: boolean }) {
  const blocks = useMemo(() => parseMarkdownLite(body), [body]);
  return (
    <div className={compact ? "space-y-2 max-h-72 overflow-y-auto ts-scrollbar pr-1" : "space-y-4"}>
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          return (
            <h4
              key={i}
              className="text-label text-teal-deep font-bold pt-2 border-t border-border/60 first:border-0 first:pt-0"
            >
              {b.text}
            </h4>
          );
        }
        if (b.kind === "list") {
          return (
            <ul key={i} className="space-y-1 list-disc pl-5">
              {b.items.map((it, j) => (
                <li key={j} className="text-caption text-foreground/90">
                  {it}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-caption text-foreground/90 leading-relaxed">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}

// ── fetch helpers ────────────────────────────────────────────────────────

export async function govFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/gov${path}`, {
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

export async function govAdminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return govFetch<T>(token, `/admin${path}`, init);
}

export async function complianceAdminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/compliance/admin${path}`, {
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

// ── wire types (govern-service serializers) ─────────────────────────────

export interface GovStats {
  policies: number;
  published_policies: number;
  policy_versions: number;
  acceptances: number;
  privacy_requests: number;
  privacy_open: number;
  legal_holds_active: number;
  registers: number;
  incidents_open: number;
  incidents_total: number;
  risks_open: number;
  risks_total: number;
  risk_exceptions_active: number;
  decisions: number;
  controls_total: number;
  controls_s80: number;
  controls_s60: number;
  evidence_rows: number;
  findings_open: number;
  processors: number;
  data_register_rows: number;
  generated_at: string;
}

export interface PolicyRow {
  key: string;
  title: string;
  title_ja: string;
  status: string;
  current_version: number;
  owner: string;
  scheduled_for: string | null;
  updated_at: string;
  acceptances: number;
  draft_versions: number;
}

export interface PolicyVersionRow {
  version: number;
  locale: string;
  effective_from: string;
  published_at: string | null;
  published_by: string | null;
  change_note: string | null;
  created_at: string;
  created_by: string | null;
}

export interface GovAuditEntry {
  id: number;
  action: string;
  version: number | null;
  actor: string | null;
  detail: string | null;
  created_at: string;
}

export interface PolicyPreview {
  key: string;
  version: number;
  locale: string;
  preview: boolean;
  is_current: boolean;
  title: string;
  effective_from: string;
  change_note: string | null;
  created_at: string;
  created_by: string | null;
  body: string;
}

export interface GovPrivacyRequest {
  id: number;
  username: string;
  type: string;
  status: string;
  details: { note?: string } | null;
  result_note: string | null;
  handled_by: string | null;
  due_at: string;
  created_at: string;
  completed_at: string | null;
  has_bundle?: boolean;
}

export interface LegalHoldRow {
  id: number;
  username: string;
  reason: string;
  case_ref: string | null;
  created_by: string | null;
  created_at: string;
  lifted_at: string | null;
}

export interface RegisterCountRow {
  name: string;
  count: number;
}

export interface RegisterEntry {
  id: number;
  register?: string;
  key: string | null;
  title: string;
  body: string | null;
  status: string | null;
  owner: string | null;
  due_date: string | null;
  meta: unknown;
  created_at?: string;
  updated_at?: string;
}

export interface CalendarEntry {
  id: number;
  obligation: string;
  jurisdiction: string;
  authority: string;
  due_date: string;
  status: string;
  filed_at: string | null;
  notes: string | null;
}

export interface StrategyEntry {
  id: number;
  key: string;
  title: string;
  body: string;
  owner: string;
  status: string;
}

export interface DataRegisterRow {
  id: number;
  asset: string;
  store: string;
  category: string;
  purpose: string;
  legal_basis: string;
  owner: string;
  retention: string;
  retention_days: number | null;
  processing_notes: string | null;
  notes: string | null;
}

export interface ProcessorRow {
  id: number;
  name: string;
  role: string;
  location: string;
  data_categories: string;
  transfer_basis: string | null;
  risk_notes: string | null;
  contract_status: string;
  review_due: string | null;
}

export interface IncidentAction {
  id: string;
  what: string;
  owner: string;
  due: string;
  status: string;
}

export interface Incident {
  id: number;
  ref: string;
  title: string;
  severity: string;
  type: string;
  status: string;
  commander: string;
  detected_at: string;
  timeline: { ts: string; event: string }[];
  impact: string | null;
  rca: string | null;
  corrective_actions: IncidentAction[];
  regulatory_reportable: boolean;
  reported_at: string | null;
  created_at: string;
}

export interface RiskRow {
  id: number;
  ref: string;
  title: string;
  category: string;
  likelihood: number;
  impact: number;
  score: number;
  owner: string;
  status: string;
  controls: string[];
  review_due: string | null;
  notes: string | null;
}

export interface RiskExceptionRow {
  id: number;
  ref: string;
  affected_controls: string[];
  reason: string;
  risk_statement: string;
  criticality: string;
  compensating_controls: string | null;
  owner: string;
  approved_by: string | null;
  expires_at: string;
  status: string;
}

export interface ControlRow {
  id: string;
  domain: string;
  name: string;
  floor: string;
  criticality: string;
  evidence_floor: string;
  applicability: string;
  status: string;
  owner_wave: string;
  note: string | null;
  in_scope: number;
  evidence_note: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export interface ControlsSummary {
  total: number;
  in_scope: number;
  by_status: { status: string; n: number }[];
  by_applicability: { applicability: string; n: number }[];
  by_domain: { domain: string; n: number }[];
  by_criticality: { criticality: string; n: number }[];
}

export interface CertificationRow {
  id: number;
  profile: string;
  scope: string;
  source_authority: string;
  environment: string;
  disposition: string;
  score: number | null;
  gates: unknown;
  issued_at: string;
  valid_until: string | null;
  report: unknown;
}

export interface EvidenceRow {
  id: number;
  control_ids: string[];
  class: string;
  source: string;
  authority: string;
  observed: string | null;
  expected: string | null;
  captured_at: string;
  captured_by: string | null;
  integrity_ref: string | null;
  validity: string;
}

export interface FindingRow {
  id: number;
  control_id: string;
  class: string;
  description: string;
  severity: string;
  owner: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
}

export interface ExportBundle {
  manifest: {
    subject: string;
    generated_at: string;
    format: string;
    purpose: string;
    scope: string[];
    scope_notes: string[];
    retention_note: string;
    authority: string;
    app_url: string;
  };
  profile: { count: number; note?: string };
  listings: { count: number };
  bids: { count: number };
  orders_as_buyer: { count: number };
  orders_as_seller: { count: number };
  payments: { count: number };
  ratings_given: { count: number };
  ratings_received: { count: number };
  watchlist: { count: number };
  threads: { count: number };
  messages: { count: number };
  questions: { count: number };
  notifications: { count: number };
  governance: { count: number };
}

// ── chip vocabulary (teal/gold law — zero blue/indigo) ──────────────────

export type GovTone = "ok" | "warn" | "muted" | "danger" | "teal" | "gold";

const TONE_CLASSES: Record<GovTone, string> = {
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  muted: "bg-muted text-muted-foreground border-border",
  danger: "bg-danger/10 text-danger border-danger/30",
  teal: "bg-teal-tint text-teal-deep border-teal/30",
  gold: "bg-gold-soft text-gold-on border-gold/40",
};

export function GovChip({
  tone,
  children,
  label,
  className = "",
}: {
  tone: GovTone;
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

/** Policy workflow status → tone + i18n label. */
export function useGovLabels() {
  const { t } = useI18n();
  const policyStatus = (s: string): { tone: GovTone; label: string } => {
    switch (s) {
      case "draft":
        return { tone: "muted", label: t("gov.status.draft") };
      case "in_review":
        return { tone: "gold", label: t("gov.status.in_review") };
      case "approved":
        return { tone: "teal", label: t("gov.status.approved") };
      case "published":
        return { tone: "ok", label: t("gov.status.published") };
      case "retired":
        return { tone: "danger", label: t("gov.status.retired") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const privacyStatus = (s: string): { tone: GovTone; label: string } => {
    switch (s) {
      case "received":
        return { tone: "teal", label: t("privacy.status.received") };
      case "verifying":
        return { tone: "gold", label: t("privacy.status.verifying") };
      case "in_progress":
        return { tone: "gold", label: t("privacy.status.in_progress") };
      case "completed":
        return { tone: "ok", label: t("privacy.status.completed") };
      case "rejected":
        return { tone: "danger", label: t("privacy.status.rejected") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const privacyType = (ty: string): string => {
    const k = `privacy.type.${ty}`;
    return t(k) === k ? ty : t(k);
  };
  const severity = (s: string): { tone: GovTone; label: string } => {
    switch (s) {
      case "S1":
        return { tone: "danger", label: "S1" };
      case "S2":
        return { tone: "danger", label: "S2" };
      case "S3":
        return { tone: "warn", label: "S3" };
      case "S4":
        return { tone: "muted", label: "S4" };
      default:
        return { tone: "muted", label: s };
    }
  };
  const incidentStatus = (s: string): { tone: GovTone; label: string } => {
    switch (s) {
      case "open":
        return { tone: "danger", label: t("trust.status.open") };
      case "mitigated":
        return { tone: "warn", label: t("gov.risk.status.mitigated") };
      case "resolved":
        return { tone: "teal", label: t("trust.status.resolved") };
      case "closed":
        return { tone: "muted", label: t("trust.status.closed") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const riskStatus = (s: string): { tone: GovTone; label: string } => {
    switch (s) {
      case "open":
        return { tone: "danger", label: t("gov.risk.status.open") };
      case "mitigated":
        return { tone: "ok", label: t("gov.risk.status.mitigated") };
      case "closed":
        return { tone: "muted", label: t("gov.risk.status.closed") };
      default:
        return { tone: "muted", label: s };
    }
  };
  const riskScore = (score: number): GovTone => {
    if (score >= 15) return "danger";
    if (score >= 8) return "warn";
    return "teal";
  };
  const controlStatus = (s: string): { tone: GovTone; label: string } => {
    switch (s) {
      case "S80":
      case "S90":
        return { tone: "ok", label: t(`compliance.status.${s}`) };
      case "S60":
      case "S50":
        return { tone: "teal", label: t(`compliance.status.${s}`) };
      case "S30":
      case "S40":
        return { tone: "gold", label: t(`compliance.status.${s}`) };
      default:
        return { tone: "muted", label: t(`compliance.status.${s}`) === `compliance.status.${s}` ? s : t(`compliance.status.${s}`) };
    }
  };
  const applicability = (a: string): { tone: GovTone; label: string } => {
    switch (a) {
      case "R":
        return { tone: "teal", label: t("compliance.app.R") };
      case "C":
        return { tone: "gold", label: t("compliance.app.C") };
      case "O":
        return { tone: "muted", label: t("compliance.app.O") };
      case "NA":
        return { tone: "muted", label: t("compliance.app.NA") };
      case "F":
        return { tone: "muted", label: t("compliance.app.F") };
      default:
        return { tone: "muted", label: a };
    }
  };
  return {
    policyStatus,
    privacyStatus,
    privacyType,
    severity,
    incidentStatus,
    riskStatus,
    riskScore,
    controlStatus,
    applicability,
  };
}
