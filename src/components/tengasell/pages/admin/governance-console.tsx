"use client";

// Tengasell — Governance console (admin, #/admin/{policies|privacy|registers|
// incidents|risk}). Task 12-d.
//
// Sections (internal pill sub-nav, comms/trust-console conventions):
//   policies  — the versioned bilingual policy CMS: list with status chips,
//               draft editor dialog (bilingual bodies, effective date,
//               change note), workflow buttons per state (Submit → Approve →
//               Publish, Unpublish + Rollback with a version picker),
//               version history with previews, acceptance counts.
//   privacy   — the DSAR queue (verify / process / complete / reject with
//               operator notes), export-bundle viewer + download, and the
//               legal-holds manager (create + lift; holds block deletion).
//   registers — the generic register engine: picker over the 20 registers
//               (+ data register + processors), per-type tables with inline
//               add / edit / delete.
//   incidents — declare (S1-S4 severity model), timeline append, close with
//               RCA + corrective actions.
//   risk      — the risk register (score = likelihood × impact chips) with
//               a time-bounded exceptions tab.
//
// All fetches are RELATIVE /api/gov/admin/** (BFF → :3008, 401/403 gated).

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  Clock,
  Download,
  FileText,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { CurrentUser } from "@/lib/tengasell/types";
import {
  GovChip,
  govAdminFetch,
  useGovLabels,
  type CalendarEntry,
  type DataRegisterRow,
  type ExportBundle,
  type GovAuditEntry,
  type GovPrivacyRequest,
  type GovStats,
  type Incident,
  type LegalHoldRow,
  type PolicyPreview,
  type PolicyRow,
  type PolicyVersionRow,
  type ProcessorRow,
  type RegisterCountRow,
  type RegisterEntry,
  type RiskExceptionRow,
  type RiskRow,
  type StrategyEntry,
} from "../gov-client";
import { PolicyMarkdown } from "../gov-client";

export type GovernanceSection =
  | "policies"
  | "privacy"
  | "registers"
  | "incidents"
  | "risk";

export const GOVERNANCE_SECTIONS: GovernanceSection[] = [
  "policies",
  "privacy",
  "registers",
  "incidents",
  "risk",
];

const SECTION_META: {
  key: GovernanceSection;
  labelKey: string;
  subKey: string;
  icon: LucideIcon;
}[] = [
  { key: "policies", labelKey: "admin.nav.policies", subKey: "gov.sub.policies", icon: FileText },
  { key: "privacy", labelKey: "admin.nav.privacy", subKey: "gov.sub.privacy", icon: ShieldCheck },
  { key: "registers", labelKey: "admin.nav.registers", subKey: "gov.sub.registers", icon: BookOpen },
  { key: "incidents", labelKey: "admin.nav.incidents", subKey: "gov.sub.incidents", icon: AlertTriangle },
  { key: "risk", labelKey: "admin.nav.risk", subKey: "gov.sub.risk", icon: Scale },
];

const POLICY_KEYS = [
  "tos",
  "privacy",
  "rules",
  "seller",
  "aup",
  "refunds",
  "ip",
  "accessibility",
] as const;

const REGISTERS = [
  "strategy",
  "entity",
  "ownership",
  "directors",
  "corporate_policies",
  "delegated_authority",
  "contracts",
  "employees",
  "contractors",
  "assets",
  "licenses",
  "domains",
  "insurance",
  "procurement",
  "vendors",
  "approvals",
  "integrations",
  "regulatory",
  "notices",
  "compliance_calendar",
  "data_register",
  "processors",
] as const;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-card" />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// shell
// ═══════════════════════════════════════════════════════════════════════════

export function GovernanceConsole({
  user,
  section,
}: {
  user: CurrentUser;
  section: GovernanceSection;
}) {
  const { t } = useI18n();
  const active = GOVERNANCE_SECTIONS.includes(section) ? section : "policies";
  const meta = SECTION_META.find((m) => m.key === active) ?? SECTION_META[0];
  const Icon = meta.icon;
  const token = user.token;

  return (
    <div className="min-w-0 space-y-6">
      <SectionHeader
        icon={<Icon className="size-5 text-teal" aria-hidden="true" />}
        title={t(meta.labelKey)}
        subtitle={t(meta.subKey)}
      />

      {/* internal pill sub-nav (comms-console convention) */}
      <nav aria-label="Governance sections" className="overflow-x-auto ts-scrollbar -mx-1 px-1">
        <ul className="flex gap-1.5 w-max pb-1">
          {SECTION_META.map((item) => {
            const ItemIcon = item.icon;
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
                  <ItemIcon className="size-4 shrink-0" aria-hidden="true" />
                  {t(item.labelKey)}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <GovStatsStrip token={token} />

      {active === "policies" && <PoliciesAdmin token={token} />}
      {active === "privacy" && <PrivacyAdmin token={token} />}
      {active === "registers" && <RegistersAdmin token={token} />}
      {active === "incidents" && <IncidentsAdmin token={token} />}
      {active === "risk" && <RiskAdmin token={token} />}
    </div>
  );
}

// ── stats strip ─────────────────────────────────────────────────────────

function GovStatsStrip({ token }: { token: string }) {
  const { t } = useI18n();
  const stats = useResource<GovStats | null>(
    async () => {
      try {
        return await govAdminFetch<GovStats>(token, "/stats");
      } catch {
        return null;
      }
    },
    [token],
  );
  if (stats.loading || !stats.data) return null;
  const s = stats.data;
  const items: { label: string; value: string | number; danger?: boolean }[] = [
    { label: t("gov.col.acceptances"), value: s.acceptances },
    { label: t("gov.privacy.queue"), value: s.privacy_open, danger: s.privacy_open > 0 },
    { label: t("gov.privacy.holds"), value: s.legal_holds_active, danger: s.legal_holds_active > 0 },
    { label: t("admin.nav.incidents"), value: s.incidents_total },
    { label: t("admin.nav.risk"), value: s.risks_total },
    { label: t("compliance.summary.controls"), value: s.controls_total },
    { label: "S80", value: s.controls_s80 },
    { label: "S60", value: s.controls_s60 },
  ];
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Governance overview stats">
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

// ═══════════════════════════════════════════════════════════════════════════
// POLICIES
// ═══════════════════════════════════════════════════════════════════════════

function PoliciesAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const labels = useGovLabels();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState<string>("tos");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rollbackKey, setRollbackKey] = useState<string | null>(null);

  const list = useResource<PolicyRow[]>(
    async () => {
      const d = await govAdminFetch<{ policies: PolicyRow[] }>(token, "/policies");
      return d.policies ?? [];
    },
    [token],
  );

  const act = useCallback(
    async (key: string, action: string, body?: Record<string, unknown>, toastKey?: string) => {
      try {
        await govAdminFetch(token, `/policies/${encodeURIComponent(key)}/${action}`, {
          method: "POST",
          body: JSON.stringify(body ?? {}),
        });
        if (toastKey) toast({ title: toastKey });
        list.reload();
      } catch (err) {
        toast({
          title: t("gov.toast.failed"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    },
    [token, list, t],
  );

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground ts-numeric">{rows.length} · 8</p>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-11" onClick={list.reload}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("gov.reload")}
          </Button>
          <Button className="min-h-11" onClick={() => setEditorOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("gov.action.newDraft")}
          </Button>
        </div>
      </div>

      {list.loading ? (
        <SkeletonRows rows={8} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileText className="size-10" />} title={t("gov.empty")} />
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => {
            const st = labels.policyStatus(p.status);
            const isOpen = expanded === p.key;
            return (
              <li key={p.key} className="rounded-card border border-border bg-raised overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-foreground font-semibold truncate">
                      {t(`policies.${p.key}.title`) === `policies.${p.key}.title` ? p.title : t(`policies.${p.key}.title`)}
                      <span className="text-caption text-muted-foreground font-normal ts-numeric">
                        {" "}· {t("gov.col.version")} {p.current_version}
                      </span>
                    </p>
                    <p className="text-caption text-muted-foreground truncate">
                      {p.title_ja} · {p.owner}
                      {p.scheduled_for && ` · ${t("gov.status.scheduled")} ${p.scheduled_for}`}
                    </p>
                  </div>
                  <GovChip tone={st.tone} label={p.status}>{st.label}</GovChip>
                  <span className="text-caption text-muted-foreground ts-numeric whitespace-nowrap">
                    {t("gov.col.acceptances")}: {p.acceptances}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {p.status === "draft" && (
                      <Button size="sm" className="min-h-11" onClick={() => act(p.key, "submit", {}, t("gov.toast.submit"))}>
                        {t("gov.action.submit")}
                      </Button>
                    )}
                    {p.status === "in_review" && (
                      <Button size="sm" className="min-h-11" onClick={() => act(p.key, "approve", {}, t("gov.toast.approve"))}>
                        {t("gov.action.approve")}
                      </Button>
                    )}
                    {p.status === "approved" && (
                      <Button size="sm" className="min-h-11" onClick={() => act(p.key, "publish", {}, t("gov.toast.publish"))}>
                        {t("gov.action.publish")}
                      </Button>
                    )}
                    {p.status === "published" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="min-h-11 text-danger border-danger/40">
                            {t("gov.action.unpublish")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("gov.unpublish.title")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("gov.unpublish.body")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              className="min-h-11"
                              onClick={() => act(p.key, "unpublish", {}, t("gov.toast.unpublish"))}
                            >
                              {t("gov.unpublish.confirm")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    {(p.status === "published" || p.status === "retired" || p.status === "approved") && (
                      <Button size="sm" variant="outline" className="min-h-11" onClick={() => setRollbackKey(p.key)}>
                        <Undo2 className="size-4" aria-hidden="true" />
                        {t("gov.action.rollback")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : p.key)}
                    >
                      <History className="size-4" aria-hidden="true" />
                      <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                      <span className="sr-only">{t("gov.versions.title")}</span>
                    </Button>
                  </div>
                </div>
                {isOpen && <PolicyVersions token={token} policyKey={p.key} />}
              </li>
            );
          })}
        </ul>
      )}

      <PolicyEditor
        token={token}
        open={editorOpen}
        presetKey={editorKey}
        onOpenChange={(o) => setEditorOpen(o)}
        onKeyChange={setEditorKey}
        onSaved={() => {
          setEditorOpen(false);
          list.reload();
        }}
      />

      {rollbackKey && (
        <RollbackDialog
          token={token}
          policyKey={rollbackKey}
          onClose={() => setRollbackKey(null)}
          onDone={() => {
            setRollbackKey(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

// ── policy editor (create policy / new draft version) ───────────────────

function PolicyEditor({
  token,
  open,
  presetKey,
  onOpenChange,
  onKeyChange,
  onSaved,
}: {
  token: string;
  open: boolean;
  presetKey: string;
  onOpenChange: (o: boolean) => void;
  onKeyChange: (k: string) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState(presetKey);
  const [title, setTitle] = useState("");
  const [titleJa, setTitleJa] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [bodyJa, setBodyJa] = useState("");
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [changeNote, setChangeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const copyCurrent = useCallback(async () => {
    setCopying(true);
    try {
      const res = await fetch(`/api/gov/public/policies/${encodeURIComponent(key)}`);
      const d = (await res.json().catch(() => null)) as
        | { title?: string; title_ja?: string; body?: string; effective_from?: string }
        | null;
      if (d?.body) {
        if (!title && d.title) setTitle(d.title);
        if (!titleJa && d.title_ja) setTitleJa(d.title_ja);
        if (d.effective_from) setEffective(d.effective_from);
        // seed BOTH locales from the published EN body as the editing starting point
        if (!bodyEn) setBodyEn(d.body);
        if (!bodyJa) setBodyJa(d.body);
        toast({ title: t("gov.toast.saved") });
      } else {
        throw new Error(t("policies.notPublished.title"));
      }
    } catch (err) {
      toast({
        title: t("gov.toast.failed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setCopying(false);
    }
  }, [key, title, titleJa, bodyEn, bodyJa, t]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await govAdminFetch(token, "/policies", {
        method: "POST",
        body: JSON.stringify({
          key,
          title,
          title_ja: titleJa,
          body_en: bodyEn,
          body_ja: bodyJa,
          effective_from: effective,
          change_note: changeNote || undefined,
        }),
      });
      toast({ title: t("gov.toast.draft") });
      setTitle("");
      setTitleJa("");
      setBodyEn("");
      setBodyJa("");
      setChangeNote("");
      onSaved();
    } catch (err) {
      toast({
        title: t("gov.toast.failed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [saving, token, key, title, titleJa, bodyEn, bodyJa, effective, changeNote, onSaved, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto ts-scrollbar">
        <DialogHeader>
          <DialogTitle>{t("gov.editor.title")}</DialogTitle>
          <DialogDescription>{t("gov.editor.hint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="pol-key">{t("policies.kicker")}</Label>
            <Select
              value={key}
              onValueChange={(v) => {
                setKey(v);
                onKeyChange(v);
              }}
            >
              <SelectTrigger id="pol-key" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICY_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`policies.${k}.title`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pol-title">{t("gov.editor.titleEn")}</Label>
              <Input
                id="pol-title"
                className="min-h-11"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pol-title-ja">{t("gov.editor.titleJa")}</Label>
              <Input
                id="pol-title-ja"
                className="min-h-11"
                value={titleJa}
                onChange={(e) => setTitleJa(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pol-body-en">{t("gov.editor.bodyEn")}</Label>
              <Textarea
                id="pol-body-en"
                rows={8}
                value={bodyEn}
                onChange={(e) => setBodyEn(e.target.value)}
                className="font-mono text-caption"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pol-body-ja">{t("gov.editor.bodyJa")}</Label>
              <Textarea
                id="pol-body-ja"
                rows={8}
                value={bodyJa}
                onChange={(e) => setBodyJa(e.target.value)}
                className="font-mono text-caption"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pol-effective">{t("gov.editor.effective")}</Label>
              <Input
                id="pol-effective"
                className="min-h-11 ts-numeric"
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pol-note">{t("gov.editor.changeNote")}</Label>
              <Input
                id="pol-note"
                className="min-h-11"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="min-h-11" onClick={copyCurrent} disabled={copying}>
            {copying ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <History className="size-4" aria-hidden="true" />}
            {t("gov.versions.preview")} · v1
          </Button>
          <Button
            className="min-h-11"
            onClick={save}
            disabled={saving || !title || !titleJa || !bodyEn || !bodyJa || !effective}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {t("gov.editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── versions + audit per policy ─────────────────────────────────────────

function PolicyVersions({ token, policyKey }: { token: string; policyKey: string }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const hist = useResource<{ versions: PolicyVersionRow[]; audit: GovAuditEntry[] }>(
    async () => govAdminFetch(token, `/policies/${encodeURIComponent(policyKey)}/versions`),
    [token, policyKey],
  );
  if (hist.loading) {
    return (
      <div className="border-t border-border p-3">
        <SkeletonRows rows={2} />
      </div>
    );
  }
  if (hist.error) {
    return (
      <div className="border-t border-border p-3">
        <ErrorState message={hist.error} onRetry={hist.reload} />
      </div>
    );
  }
  const versions = hist.data?.versions ?? [];
  const audit = hist.data?.audit ?? [];
  const enVersions = versions.filter((v) => v.locale === "en");
  const openPreview = async (version: number) => {
    try {
      const d = await govAdminFetch<PolicyPreview>(
        token,
        `/policies/${encodeURIComponent(policyKey)}/preview/${version}`,
      );
      setPreview(d);
    } catch (err) {
      toast({
        title: t("gov.toast.failed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };
  return (
    <div className="border-t border-border bg-section p-3 grid gap-4 md:grid-cols-2">
      <div>
        <h4 className="text-label text-foreground font-bold mb-2">{t("gov.versions.title")}</h4>
        <ul className="space-y-1.5 max-h-72 overflow-y-auto ts-scrollbar pr-1">
          {enVersions.map((v) => (
            <li
              key={v.version}
              className="flex items-center justify-between gap-2 rounded-control border border-border bg-raised px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-label text-foreground font-semibold ts-numeric">
                  {t("gov.col.version")} {v.version}{" "}
                  {v.published_at ? (
                <span className="text-ok">({t("gov.versions.published")})</span>
              ) : (
                <span className="text-muted-foreground">({t("gov.versions.draftTag")})</span>
              )}
                </p>
                <p className="text-caption text-muted-foreground truncate">
                  {v.change_note ?? "—"} · {fmtDate(v.effective_from)}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="min-h-11 shrink-0" onClick={() => void openPreview(v.version)}>
                {t("gov.versions.preview")}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-label text-foreground font-bold mb-2">Audit</h4>
        <ul className="space-y-1 max-h-72 overflow-y-auto ts-scrollbar pr-1">
          {audit.map((a) => (
            <li key={a.id} className="text-caption text-muted-foreground rounded-control border border-border bg-raised px-3 py-2">
              <span className="font-bold text-foreground">{a.action}</span>
              {a.version != null && <span className="ts-numeric"> · v{a.version}</span>}
              <span> · {a.actor} · {fmtDate(a.created_at)}</span>
              <p className="truncate">{a.detail}</p>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto ts-scrollbar">
          <DialogHeader>
            <DialogTitle>
              {preview?.title} · {t("gov.col.version")} {preview?.version}
            </DialogTitle>
            <DialogDescription>
              {preview?.change_note ?? ""} · {fmtDate(preview?.effective_from ?? null)}
            </DialogDescription>
          </DialogHeader>
          {preview && <PolicyMarkdown body={preview.body} compact />}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setPreview(null)}>
              {t("gov.versions.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── rollback dialog ─────────────────────────────────────────────────────

function RollbackDialog({
  token,
  policyKey,
  onClose,
  onDone,
}: {
  token: string;
  policyKey: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [toVersion, setToVersion] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const hist = useResource<{ versions: PolicyVersionRow[] }>(
    async () => govAdminFetch(token, `/policies/${encodeURIComponent(policyKey)}/versions`),
    [token, policyKey],
  );
  const versions = useMemo(() => {
    const set = new Set((hist.data?.versions ?? []).filter((v) => v.locale === "en").map((v) => String(v.version)));
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [hist.data]);
  const go = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await govAdminFetch(token, `/policies/${encodeURIComponent(policyKey)}/rollback`, {
        method: "POST",
        body: JSON.stringify({ toVersion, note: note || undefined }),
      });
      toast({ title: t("gov.toast.rollback") });
      onDone();
    } catch (err) {
      toast({
        title: t("gov.toast.failed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [saving, token, policyKey, toVersion, note, onDone, t]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("gov.rollback.title")}</DialogTitle>
          <DialogDescription>{t("gov.unpublish.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rb-version">{t("gov.rollback.toVersion")}</Label>
            <Select value={toVersion} onValueChange={setToVersion}>
              <SelectTrigger id="rb-version" className="min-h-11 ts-numeric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v} value={v} className="ts-numeric">
                    v{v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rb-note">{t("gov.rollback.note")}</Label>
            <Textarea id="rb-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button className="min-h-11" onClick={go} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Undo2 className="size-4" aria-hidden="true" />}
            {t("gov.rollback.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIVACY (DSAR queue + legal holds)
// ═══════════════════════════════════════════════════════════════════════════

function PrivacyAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const labels = useGovLabels();
  const [bundle, setBundle] = useState<{ username: string; data: ExportBundle } | null>(null);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);

  const queue = useResource<GovPrivacyRequest[]>(
    async () => {
      const d = await govAdminFetch<{ requests: GovPrivacyRequest[] }>(token, "/privacy-requests");
      return d.requests ?? [];
    },
    [token],
  );
  const holds = useResource<LegalHoldRow[]>(
    async () => {
      const d = await govAdminFetch<{ holds: LegalHoldRow[] }>(token, "/legal-holds");
      return d.holds ?? [];
    },
    [token],
  );

  const act = useCallback(
    async (id: number, action: string, body?: Record<string, unknown>) => {
      try {
        await govAdminFetch(token, `/privacy-requests/${id}/${action}`, {
          method: "POST",
          body: JSON.stringify(body ?? {}),
        });
        toast({ title: t("gov.toast.saved") });
        queue.reload();
      } catch (err) {
        // the service's 409 legal-hold message is the honest state — surface it in full
        toast({
          title: err instanceof Error && err.message.includes("LEGAL HOLD") ? t("privacy.delete.holdTitle") : t("gov.toast.failed"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    },
    [token, queue, t],
  );

  const viewBundle = useCallback(
    async (username: string) => {
      try {
        const d = await govAdminFetch<{ username: string; bundle: ExportBundle }>(
          token,
          `/export/${encodeURIComponent(username)}`,
        );
        setBundle({ username: d.username ?? username, data: d.bundle });
      } catch (err) {
        toast({
          title: t("gov.toast.failed"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    },
    [token, t],
  );

  const requests = queue.data ?? [];
  const activeHolds = (holds.data ?? []).filter((h) => !h.lifted_at);

  return (
    <div className="space-y-6">
      {/* DSAR queue */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-title text-foreground">{t("gov.privacy.queue")}</h3>
          <Button variant="outline" className="min-h-11" onClick={queue.reload}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("gov.reload")}
          </Button>
        </div>
        {queue.loading ? (
          <SkeletonRows rows={3} />
        ) : queue.error ? (
          <ErrorState message={queue.error} onRetry={queue.reload} />
        ) : requests.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="size-10" />} title={t("gov.privacy.queueEmpty")} />
        ) : (
          <div className="rounded-card border border-border bg-raised overflow-hidden">
            <div className="overflow-x-auto ts-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>@</TableHead>
                    <TableHead>{t("privacy.requests.type")}</TableHead>
                    <TableHead>{t("gov.col.status")}</TableHead>
                    <TableHead>{t("gov.col.due")}</TableHead>
                    <TableHead className="min-w-[200px]">{t("privacy.requests.result")}</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => {
                    const st = labels.privacyStatus(r.status);
                    const isExport = r.type === "access" || r.type === "portability";
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="ts-numeric">{r.id}</TableCell>
                        <TableCell className="font-semibold">@{r.username}</TableCell>
                        <TableCell>{labels.privacyType(r.type)}</TableCell>
                        <TableCell>
                          <GovChip tone={st.tone} label={r.status}>{st.label}</GovChip>
                        </TableCell>
                        <TableCell className="ts-numeric whitespace-nowrap">{fmtDate(r.due_at)}</TableCell>
                        <TableCell className="text-caption text-muted-foreground max-w-[260px] truncate" title={r.result_note ?? ""}>
                          {r.result_note ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {r.status === "received" && (
                              <Button size="sm" className="min-h-11" onClick={() => void act(r.id, "verify")}>
                                {t("gov.privacy.verify")}
                              </Button>
                            )}
                            {(r.status === "received" || r.status === "verifying") && (
                              <Button size="sm" variant="outline" className="min-h-11" onClick={() => void act(r.id, "process")}>
                                {t("gov.privacy.process")}
                              </Button>
                            )}
                            {r.status === "in_progress" && (
                              <Button size="sm" className="min-h-11" onClick={() => void act(r.id, "complete")}>
                                {t("gov.privacy.complete")}
                              </Button>
                            )}
                            {r.status !== "completed" && r.status !== "rejected" && (
                              <Button size="sm" variant="ghost" className="min-h-11 text-danger" onClick={() => setRejectId(r.id)}>
                                {t("gov.privacy.reject")}
                              </Button>
                            )}
                            {isExport && (r.status === "in_progress" || r.status === "completed") && (
                              <Button size="sm" variant="outline" className="min-h-11" onClick={() => void viewBundle(r.username)}>
                                <Download className="size-4" aria-hidden="true" />
                                {t("gov.privacy.exportBtn")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* legal holds */}
      <div className="rounded-card border border-border bg-raised p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-title text-foreground flex items-center gap-2">
            <Scale className="size-4 text-gold-deep" aria-hidden="true" />
            {t("gov.privacy.holds")}
            {activeHolds.length > 0 && (
              <GovChip tone="danger">{activeHolds.length}</GovChip>
            )}
          </h3>
          <Button className="min-h-11" onClick={() => setHoldOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("gov.privacy.holdCreate")}
          </Button>
        </div>
        {holds.loading ? (
          <SkeletonRows rows={1} />
        ) : (holds.data ?? []).length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("gov.privacy.holdsNone")}</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto ts-scrollbar space-y-1.5 pr-1">
            {(holds.data ?? []).map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-section px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-label text-foreground font-semibold">
                    @{h.username}
                    {h.case_ref && <span className="ts-numeric text-caption text-muted-foreground"> · {h.case_ref}</span>}
                  </p>
                  <p className="text-caption text-muted-foreground truncate">{h.reason}</p>
                </div>
                {h.lifted_at ? (
                  <GovChip tone="muted">{fmtDate(h.lifted_at)}</GovChip>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="min-h-11">
                        {t("gov.privacy.holdLift")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("gov.privacy.liftConfirmTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>{t("gov.privacy.liftConfirmBody")}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          className="min-h-11"
                          onClick={async () => {
                            try {
                              await govAdminFetch(token, `/legal-holds/${h.id}/lift`, {
                                method: "POST",
                                body: JSON.stringify({}),
                              });
                              toast({ title: t("gov.toast.saved") });
                              holds.reload();
                            } catch (err) {
                              toast({
                                title: t("gov.toast.failed"),
                                description: err instanceof Error ? err.message : undefined,
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          {t("gov.privacy.liftConfirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* hold create dialog */}
      <HoldCreateDialog
        token={token}
        open={holdOpen}
        onOpenChange={setHoldOpen}
        onSaved={() => {
          setHoldOpen(false);
          holds.reload();
        }}
      />

      {/* reject dialog */}
      <Dialog open={rejectId !== null} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("gov.privacy.reject")}</DialogTitle>
            <DialogDescription>{t("gov.privacy.rejectReason")}</DialogDescription>
          </DialogHeader>
          <RejectForm onSubmit={(note) => { if (rejectId != null) void act(rejectId, "reject", { note }); setRejectId(null); }} />
        </DialogContent>
      </Dialog>

      {/* bundle viewer */}
      <Dialog open={!!bundle} onOpenChange={(o) => !o && setBundle(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto ts-scrollbar">
          <DialogHeader>
            <DialogTitle>
              {t("gov.privacy.exportBtn")} · @{bundle?.username}
            </DialogTitle>
            <DialogDescription>{bundle?.data.manifest.purpose}</DialogDescription>
          </DialogHeader>
          {bundle && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(
                  [
                    ["profile", bundle.data.profile.count],
                    ["listings", bundle.data.listings.count],
                    ["bids", bundle.data.bids.count],
                    ["orders_as_buyer", bundle.data.orders_as_buyer.count],
                    ["orders_as_seller", bundle.data.orders_as_seller.count],
                    ["payments", bundle.data.payments.count],
                    ["ratings_given", bundle.data.ratings_given.count],
                    ["messages", bundle.data.messages.count],
                    ["governance", bundle.data.governance.count],
                  ] as const
                ).map(([k, n]) => (
                  <div key={k} className="rounded-control border border-border bg-section p-2">
                    <p className="ts-numeric text-title font-bold text-teal-deep">{n}</p>
                    <p className="text-caption text-muted-foreground truncate">{k}</p>
                  </div>
                ))}
              </div>
              <p className="text-caption text-muted-foreground">{bundle.data.manifest.retention_note}</p>
            </div>
          )}
          <DialogFooter>
            <a
              href={`/api/gov/admin/export/${encodeURIComponent(bundle?.username ?? "")}?download=1`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-teal px-5 text-label font-bold text-white hover:bg-teal-deep transition-colors"
            >
              <Download className="size-4" aria-hidden="true" />
              {t("gov.privacy.download")}
            </a>
            <Button variant="outline" className="min-h-11" onClick={() => setBundle(null)}>
              {t("gov.versions.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RejectForm({ onSubmit }: { onSubmit: (note: string) => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  return (
    <div className="grid gap-3">
      <Textarea
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label={t("gov.privacy.rejectReason")}
      />
      <Button className="min-h-11" disabled={!note.trim()} onClick={() => onSubmit(note.trim())}>
        {t("gov.privacy.reject")}
      </Button>
    </div>
  );
}

function HoldCreateDialog({
  token,
  open,
  onOpenChange,
  onSaved,
}: {
  token: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [caseRef, setCaseRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const go = useCallback(async () => {
    if (saving || !confirmed) return;
    setSaving(true);
    try {
      await govAdminFetch(token, "/legal-holds", {
        method: "POST",
        body: JSON.stringify({ username, reason, case_ref: caseRef || undefined }),
      });
      toast({ title: t("gov.toast.saved") });
      setUsername("");
      setReason("");
      setCaseRef("");
      setConfirmed(false);
      onSaved();
    } catch (err) {
      toast({
        title: t("gov.toast.failed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [saving, confirmed, token, username, reason, caseRef, onSaved, t]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("gov.privacy.holdConfirmTitle")}</DialogTitle>
          <DialogDescription>{t("gov.privacy.holdConfirmBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="hold-user">{t("gov.privacy.holdUser")}</Label>
            <Input id="hold-user" className="min-h-11" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hold-reason">{t("gov.privacy.holdReason")}</Label>
            <Textarea id="hold-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="hold-case">{t("gov.privacy.holdCase")}</Label>
            <Input id="hold-case" className="min-h-11" value={caseRef} onChange={(e) => setCaseRef(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-caption text-muted-foreground">
            <Switch checked={confirmed} onCheckedChange={setConfirmed} aria-label={t("gov.privacy.holdConfirmBody")} />
            {t("gov.privacy.holdConfirmBody")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button className="min-h-11" onClick={go} disabled={saving || !username.trim() || !reason.trim() || !confirmed}>
            {t("gov.privacy.holdConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTERS
// ═══════════════════════════════════════════════════════════════════════════

type RegisterName = (typeof REGISTERS)[number];

function RegistersAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<RegisterName>("entity");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<{ id: number; values: Record<string, string> } | null>(null);

  const catalogue = useResource<{ counts: Record<string, number>; dataCount: number; procCount: number }>(
    async () => {
      const out: { counts: Record<string, number>; dataCount: number; procCount: number } = {
        counts: {},
        dataCount: 0,
        procCount: 0,
      };
      try {
        const d = await govAdminFetch<{ registers: RegisterCountRow[] }>(token, "/registers");
        for (const r of d.registers ?? []) out.counts[r.name] = r.count;
      } catch {
        /* catalogue is a nicety */
      }
      try {
        const d = await govAdminFetch<{ rows: DataRegisterRow[] }>(token, "/data-register");
        out.dataCount = d.rows?.length ?? 0;
      } catch {
        /* ignore */
      }
      try {
        const d = await govAdminFetch<{ processors: ProcessorRow[] }>(token, "/processors");
        out.procCount = d.processors?.length ?? 0;
      } catch {
        /* ignore */
      }
      return out;
    },
    [token],
  );

  const countFor = (name: string): number | undefined => {
    if (name === "data_register") return catalogue.data?.dataCount;
    if (name === "processors") return catalogue.data?.procCount;
    return catalogue.data?.counts[name];
  };

  const loadRows = useCallback(async (): Promise<unknown[]> => {
    if (selected === "data_register") {
      const d = await govAdminFetch<{ rows: DataRegisterRow[] }>(token, "/data-register");
      return d.rows ?? [];
    }
    if (selected === "processors") {
      const d = await govAdminFetch<{ processors: ProcessorRow[] }>(token, "/processors");
      return d.processors ?? [];
    }
    const d = await govAdminFetch<{ rows: unknown[] }>(token, `/registers/${selected}`);
    return d.rows ?? [];
  }, [token, selected]);

  const rows = useResource<unknown[]>(loadRows, [token, selected]);

  const createEntry = useCallback(
    async (values: Record<string, string>) => {
      if (selected === "data_register") {
        await govAdminFetch(token, "/data-register", { method: "POST", body: JSON.stringify(values) });
      } else if (selected === "processors") {
        await govAdminFetch(token, "/processors", { method: "POST", body: JSON.stringify(values) });
      } else if (selected === "strategy") {
        await govAdminFetch(token, "/registers/strategy", { method: "POST", body: JSON.stringify(values) });
      } else if (selected === "compliance_calendar") {
        await govAdminFetch(token, "/registers/compliance_calendar", { method: "POST", body: JSON.stringify(values) });
      } else {
        await govAdminFetch(token, `/registers/${selected}`, { method: "POST", body: JSON.stringify(values) });
      }
    },
    [token, selected],
  );

  const patchEntry = useCallback(
    async (id: number, values: Record<string, string>) => {
      const body = JSON.stringify({ id: String(id), ...values });
      if (selected === "data_register") {
        await govAdminFetch(token, "/data-register", { method: "PATCH", body });
      } else if (selected === "processors") {
        await govAdminFetch(token, "/processors", { method: "PATCH", body });
      } else {
        await govAdminFetch(token, `/registers/${selected}`, { method: "PATCH", body });
      }
    },
    [token, selected],
  );

  const deleteEntry = useCallback(
    async (id: number) => {
      if (selected === "data_register" || selected === "processors") return;
      await govAdminFetch(token, `/registers/${selected}?id=${id}`, { method: "DELETE" });
    },
    [token, selected],
  );

  const label = (name: string): string => {
    if (name === "data_register") return t("gov.dataRegister");
    if (name === "processors") return t("gov.processors");
    return name.replaceAll("_", " ");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Select
            value={selected}
            onValueChange={(v) => setSelected(v as RegisterName)}
          >
            <SelectTrigger className="min-h-11" aria-label={t("gov.registers.picker")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-96">
              {REGISTERS.map((r) => (
                <SelectItem key={r} value={r}>
                  {label(r)}
                  {countFor(r) !== undefined && (
                    <span className="ts-numeric text-muted-foreground"> ({countFor(r)})</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="min-h-11" onClick={rows.reload}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("gov.reload")}
        </Button>
        <Button className="min-h-11" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          {t("gov.registers.add")}
        </Button>
      </div>

      {selected === "data_register" ? (
        <DataRegisterTable rows={rows.data as DataRegisterRow[] | null} loading={rows.loading} error={rows.error} onReload={rows.reload} />
      ) : selected === "processors" ? (
        <ProcessorsTable rows={rows.data as ProcessorRow[] | null} loading={rows.loading} error={rows.error} onReload={rows.reload} />
      ) : selected === "strategy" ? (
        <StrategyTable rows={rows.data as StrategyEntry[] | null} loading={rows.loading} error={rows.error} onReload={rows.reload} />
      ) : selected === "compliance_calendar" ? (
        <CalendarTable
          rows={rows.data as CalendarEntry[] | null}
          loading={rows.loading}
          error={rows.error}
          onReload={rows.reload}
          onDelete={selected === "compliance_calendar" ? deleteEntry : undefined}
        />
      ) : (
        <GenericRegisterTable
          rows={rows.data as RegisterEntry[] | null}
          loading={rows.loading}
          error={rows.error}
          onReload={rows.reload}
          onEdit={(id) => {
            const row = (rows.data as RegisterEntry[] | null)?.find((r) => r.id === id);
            if (row) {
              setEditRow({
                id,
                values: {
                  key: row.key ?? "",
                  title: row.title ?? "",
                  body: row.body ?? "",
                  status: row.status ?? "",
                  owner: row.owner ?? "",
                  due_date: (row.due_date ?? "").slice(0, 10),
                },
              });
            }
          }}
          onDelete={deleteEntry}
        />
      )}

      <RegisterEntryDialog
        titleKey={t("gov.registers.add")}
        register={selected}
        open={addOpen}
        onOpenChange={setAddOpen}
        initial={null}
        onSubmit={async (values) => {
          await createEntry(values);
          rows.reload();
          catalogue.reload();
        }}
      />
      <RegisterEntryDialog
        titleKey={t("gov.registers.edit")}
        register={selected}
        open={editRow !== null}
        onOpenChange={(o) => !o && setEditRow(null)}
        initial={editRow?.values ?? null}
        onSubmit={async (values) => {
          if (editRow) await patchEntry(editRow.id, values);
          rows.reload();
        }}
      />
    </div>
  );
}

function GenericRegisterTable({
  rows,
  loading,
  error,
  onReload,
  onEdit,
  onDelete,
}: {
  rows: RegisterEntry[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const { t } = useI18n();
  const [openBody, setOpenBody] = useState<number | null>(null);
  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <ErrorState message={error} onRetry={onReload} />;
  if (!rows || rows.length === 0) {
    return <EmptyState icon={<BookOpen className="size-10" />} title={t("gov.registers.empty")} />;
  }
  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden">
      <div className="overflow-x-auto ts-scrollbar">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("gov.registers.title")}</TableHead>
              <TableHead>{t("gov.col.status")}</TableHead>
              <TableHead>{t("gov.col.owner")}</TableHead>
              <TableHead>{t("gov.registers.picker")} {t("gov.col.due")}</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-[280px]">
                  <button
                    type="button"
                    className="min-h-11 text-left"
                    onClick={() => setOpenBody(openBody === r.id ? null : r.id)}
                    aria-expanded={openBody === r.id}
                  >
                    <span className="text-label text-foreground font-semibold">{r.key ? `${r.key} · ` : ""}{r.title}</span>
                    {openBody === r.id && r.body && (
                      <p className="mt-1 text-caption text-muted-foreground whitespace-pre-wrap">{r.body}</p>
                    )}
                  </button>
                </TableCell>
                <TableCell>
                  {r.status && <GovChip tone={r.status === "active" ? "ok" : "muted"}>{r.status}</GovChip>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.owner ?? "—"}</TableCell>
                <TableCell className="ts-numeric whitespace-nowrap">{r.due_date?.slice(0, 10) || "—"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" className="min-h-11" onClick={() => onEdit(r.id)}>
                      {t("gov.registers.edit")}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="min-h-11 text-danger">
                          <Trash2 className="size-4" aria-hidden="true" />
                          <span className="sr-only">{t("gov.registers.delete")}</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("gov.registers.deleteTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>{t("gov.registers.deleteBody")}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            className="min-h-11"
                            onClick={async () => {
                              await onDelete(r.id);
                              onReload();
                            }}
                          >
                            {t("gov.registers.deleteConfirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StrategyTable({
  rows,
  loading,
  error,
  onReload,
}: {
  rows: StrategyEntry[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const { t } = useI18n();
  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <ErrorState message={error} onRetry={onReload} />;
  if (!rows || rows.length === 0) {
    return <EmptyState icon={<BookOpen className="size-10" />} title={t("gov.registers.empty")} />;
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-card border border-border bg-raised p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label text-foreground font-semibold ts-numeric">{r.key}</span>
            <span className="text-label text-foreground">{r.title}</span>
            <GovChip tone={r.status === "active" ? "ok" : "muted"}>{r.status}</GovChip>
            <span className="text-caption text-muted-foreground">{r.owner}</span>
          </div>
          <p className="mt-1 text-caption text-muted-foreground line-clamp-3">{r.body}</p>
        </li>
      ))}
    </ul>
  );
}

function CalendarTable({
  rows,
  loading,
  error,
  onReload,
  onDelete,
}: {
  rows: CalendarEntry[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onDelete?: (id: number) => Promise<void>;
}) {
  const { t } = useI18n();
  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <ErrorState message={error} onRetry={onReload} />;
  if (!rows || rows.length === 0) {
    return <EmptyState icon={<BookOpen className="size-10" />} title={t("gov.registers.empty")} />;
  }
  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden">
      <div className="overflow-x-auto ts-scrollbar">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Obligation</TableHead>
              <TableHead>Authority</TableHead>
              <TableHead>{t("gov.col.due")}</TableHead>
              <TableHead>{t("gov.col.status")}</TableHead>
              <TableHead>Filed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-[300px]">
                  <p className="text-label text-foreground font-semibold">{r.obligation}</p>
                  <p className="text-caption text-muted-foreground">{r.jurisdiction}{r.notes ? ` · ${r.notes}` : ""}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.authority}</TableCell>
                <TableCell className="ts-numeric whitespace-nowrap">{r.due_date}</TableCell>
                <TableCell>
                  <GovChip tone={r.status === "filed" ? "ok" : r.status === "due" ? "warn" : "muted"}>{r.status}</GovChip>
                </TableCell>
                <TableCell className="ts-numeric whitespace-nowrap">{r.filed_at?.slice(0, 10) ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DataRegisterTable({
  rows,
  loading,
  error,
  onReload,
}: {
  rows: DataRegisterRow[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const { t } = useI18n();
  if (loading) return <SkeletonRows rows={5} />;
  if (error) return <ErrorState message={error} onRetry={onReload} />;
  if (!rows || rows.length === 0) {
    return <EmptyState icon={<BookOpen className="size-10" />} title={t("gov.registers.empty")} />;
  }
  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden">
      <div className="overflow-x-auto ts-scrollbar max-h-96 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-raised z-10">
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Legal basis</TableHead>
              <TableHead>{t("gov.col.owner")}</TableHead>
              <TableHead>Retention</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="max-w-[220px]">
                  <p className="text-label text-foreground font-semibold">{r.asset}</p>
                  <p className="text-caption text-muted-foreground">{r.category}</p>
                </TableCell>
                <TableCell className="max-w-[180px] text-caption">{r.store}</TableCell>
                <TableCell className="max-w-[240px] text-caption">{r.purpose}</TableCell>
                <TableCell className="max-w-[180px] text-caption">{r.legal_basis}</TableCell>
                <TableCell className="whitespace-nowrap text-caption">{r.owner}</TableCell>
                <TableCell className="text-caption whitespace-nowrap">{r.retention}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ProcessorsTable({
  rows,
  loading,
  error,
  onReload,
}: {
  rows: ProcessorRow[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const { t } = useI18n();
  if (loading) return <SkeletonRows rows={4} />;
  if (error) return <ErrorState message={error} onRetry={onReload} />;
  if (!rows || rows.length === 0) {
    return <EmptyState icon={<BookOpen className="size-10" />} title={t("gov.registers.empty")} />;
  }
  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden">
      <div className="overflow-x-auto ts-scrollbar max-h-96 overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-raised z-10">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Transfer</TableHead>
              <TableHead>{t("gov.col.status")}</TableHead>
              <TableHead>{t("gov.risk.review")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-label text-foreground font-semibold whitespace-nowrap">{r.name}</TableCell>
                <TableCell className="max-w-[200px] text-caption">{r.role}</TableCell>
                <TableCell className="text-caption whitespace-nowrap">{r.location}</TableCell>
                <TableCell className="max-w-[180px] text-caption">{r.data_categories}</TableCell>
                <TableCell className="max-w-[160px] text-caption">{r.transfer_basis ?? "—"}</TableCell>
                <TableCell>
                  <GovChip tone={r.contract_status === "active" ? "ok" : "muted"}>{r.contract_status}</GovChip>
                </TableCell>
                <TableCell className="ts-numeric whitespace-nowrap">{r.review_due?.slice(0, 10) ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Add/edit dialog — fields adapt per register type. */
function RegisterEntryDialog({
  titleKey,
  register,
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  titleKey: string;
  register: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Record<string, string> | null;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // reset when target changes
  const signature = `${register}:${open}:${initial ? JSON.stringify(initial) : ""}`;
  const [lastSig, setLastSig] = useState(signature);
  if (lastSig !== signature) {
    setLastSig(signature);
    setValues(initial ?? {});
    setError(null);
  }

  const fields: { key: string; label: string; area?: boolean; required?: boolean }[] =
    register === "data_register"
      ? [
          { key: "asset", label: "Asset", required: true },
          { key: "store", label: "Store", required: true },
          { key: "category", label: "Category", required: true },
          { key: "purpose", label: "Purpose", area: true, required: true },
          { key: "legal_basis", label: "Legal basis", required: true },
          { key: "owner", label: t("gov.col.owner"), required: true },
          { key: "retention", label: "Retention", required: true },
        ]
      : register === "processors"
        ? [
            { key: "name", label: "Name", required: true },
            { key: "role", label: "Role", required: true },
            { key: "location", label: "Location", required: true },
            { key: "data_categories", label: "Data categories", area: true, required: true },
            { key: "transfer_basis", label: "Transfer basis", area: true },
            { key: "contract_status", label: t("gov.col.status") },
            { key: "review_due", label: t("gov.risk.review") },
          ]
        : register === "strategy"
          ? [
              { key: "key", label: "Key", required: true },
              { key: "title", label: t("gov.registers.title"), required: true },
              { key: "body", label: t("gov.registers.body"), area: true, required: true },
              { key: "owner", label: t("gov.col.owner") },
              { key: "status", label: t("gov.col.status") },
            ]
          : register === "compliance_calendar"
            ? [
                { key: "obligation", label: "Obligation", required: true },
                { key: "authority", label: "Authority", required: true },
                { key: "jurisdiction", label: "Jurisdiction" },
                { key: "due_date", label: t("gov.col.due"), required: true },
                { key: "status", label: t("gov.col.status") },
                { key: "notes", label: "Notes", area: true },
              ]
            : [
                { key: "key", label: t("gov.registers.key") },
                { key: "title", label: t("gov.registers.title"), required: true },
                { key: "body", label: t("gov.registers.body"), area: true },
                { key: "status", label: t("gov.col.status") },
                { key: "owner", label: t("gov.col.owner") },
                { key: "due_date", label: t("gov.col.due") },
              ];

  const go = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of fields) {
        const v = (values[f.key] ?? "").trim();
        if (v) payload[f.key] = v;
      }
      await onSubmit(payload);
      setValues({});
      onOpenChange(false);
      toast({ title: t("gov.toast.saved") });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("gov.toast.failed"));
    } finally {
      setSaving(false);
    }
  }, [saving, fields, values, onSubmit, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto ts-scrollbar">
        <DialogHeader>
          <DialogTitle>{titleKey}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {fields.map((f) => (
            <div key={f.key} className="grid gap-1.5">
              <Label htmlFor={`re-${f.key}`}>
                {f.label}
                {f.required && <span className="text-danger" aria-hidden="true"> *</span>}
              </Label>
              {f.area ? (
                <Textarea
                  id={`re-${f.key}`}
                  rows={3}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`re-${f.key}`}
                  className="min-h-11"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button className="min-h-11" onClick={go} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {t("gov.registers.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INCIDENTS
// ═══════════════════════════════════════════════════════════════════════════

function IncidentsAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const labels = useGovLabels();
  const [declareOpen, setDeclareOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const list = useResource<Incident[]>(
    async () => {
      const d = await govAdminFetch<{ incidents: Incident[] }>(token, "/incidents");
      return d.incidents ?? [];
    },
    [token],
  );

  const appendEvent = useCallback(
    async (id: number, event: string) => {
      try {
        await govAdminFetch(token, `/incidents/${id}/timeline`, {
          method: "POST",
          body: JSON.stringify({ event }),
        });
        toast({ title: t("gov.toast.saved") });
        list.reload();
      } catch (err) {
        toast({
          title: t("gov.toast.failed"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    },
    [token, list, t],
  );

  const closeIncident = useCallback(
    async (id: number, rca: string, corrective: string[]) => {
      try {
        await govAdminFetch(token, `/incidents/${id}/close`, {
          method: "POST",
          body: JSON.stringify({ rca, corrective_actions: corrective }),
        });
        toast({ title: t("gov.toast.saved") });
        list.reload();
      } catch (err) {
        toast({
          title: t("gov.toast.failed"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    },
    [token, list, t],
  );

  const declare = useCallback(
    async (payload: Record<string, unknown>) => {
      await govAdminFetch(token, "/incidents", { method: "POST", body: JSON.stringify(payload) });
      list.reload();
    },
    [token, list],
  );

  const incidents = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground ts-numeric">{incidents.length}</p>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-11" onClick={list.reload}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("gov.reload")}
          </Button>
          <Button className="min-h-11" onClick={() => setDeclareOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("gov.incidents.declare")}
          </Button>
        </div>
      </div>

      {list.loading ? (
        <SkeletonRows rows={3} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : incidents.length === 0 ? (
        <EmptyState icon={<AlertTriangle className="size-10" />} title={t("gov.incidents.empty")} />
      ) : (
        <ul className="space-y-2">
          {incidents.map((inc) => {
            const sev = labels.severity(inc.severity);
            const st = labels.incidentStatus(inc.status);
            const isOpen = openId === inc.id;
            return (
              <li key={inc.id} className="rounded-card border border-border bg-raised overflow-hidden">
                <button
                  type="button"
                  className="w-full min-h-11 flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 text-left hover:bg-accent/40 transition-colors"
                  onClick={() => setOpenId(isOpen ? null : inc.id)}
                  aria-expanded={isOpen}
                >
                  <span className="ts-numeric text-label text-foreground font-bold">{inc.ref}</span>
                  <span className="text-label text-foreground flex-1 min-w-[200px] truncate">{inc.title}</span>
                  <GovChip tone={sev.tone} label={inc.severity}>{inc.severity}</GovChip>
                  <GovChip tone={st.tone} label={inc.status}>{st.label}</GovChip>
                  <span className="text-caption text-muted-foreground ts-numeric whitespace-nowrap">
                    {fmtDate(inc.detected_at)}
                  </span>
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                </button>
                {isOpen && (
                  <div className="border-t border-border bg-section p-3 space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <h4 className="text-label text-foreground font-bold">{t("gov.incidents.impact")}</h4>
                        <p className="text-caption text-muted-foreground">{inc.impact ?? "—"}</p>
                        <p className="text-caption text-muted-foreground mt-1">
                          {t("gov.incidents.commander")}: <span className="ts-numeric">{inc.commander}</span> · {inc.type}
                          {inc.regulatory_reportable && (
                            <GovChip tone="danger" className="ml-2">{t("gov.incidents.reportable")}</GovChip>
                          )}
                        </p>
                        {inc.rca && (
                          <div className="mt-2 rounded-control border border-border bg-raised p-2">
                            <h4 className="text-label text-foreground font-bold">{t("gov.incidents.rca")}</h4>
                            <p className="text-caption text-muted-foreground whitespace-pre-wrap">{inc.rca}</p>
                            {inc.corrective_actions.length > 0 && (
                              <ul className="mt-1 list-disc pl-5">
                                {inc.corrective_actions.map((ca) => (
                                  <li key={ca.id} className="text-caption text-muted-foreground">
                                    {ca.id}: {ca.what} <span className="ts-numeric">({ca.owner})</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <h4 className="text-label text-foreground font-bold mb-1.5">{t("gov.incidents.timeline")}</h4>
                        <ol className="space-y-1.5 max-h-64 overflow-y-auto ts-scrollbar pr-1 border-l-2 border-teal/30 pl-3">
                          {inc.timeline.map((ev, i) => (
                            <li key={i} className="text-caption text-foreground/90">
                              <span className="ts-numeric text-muted-foreground">{fmtDate(ev.ts)}</span> — {ev.event}
                            </li>
                          ))}
                        </ol>
                        <TimelineAppend onAppend={(ev) => void appendEvent(inc.id, ev)} />
                      </div>
                    </div>
                    {inc.status !== "closed" && (
                      <CloseIncidentButton
                        onClose={(rca, corrective) => void closeIncident(inc.id, rca, corrective)}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <DeclareIncidentDialog
        open={declareOpen}
        onOpenChange={setDeclareOpen}
        onDeclare={async (payload) => {
          await declare(payload);
          setDeclareOpen(false);
          toast({ title: t("gov.toast.saved") });
        }}
      />
    </div>
  );
}

function TimelineAppend({ onAppend }: { onAppend: (event: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onAppend(value.trim());
        setValue("");
      }}
    >
      <Input
        className="min-h-11"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("gov.incidents.appendEvent")}
        aria-label={t("gov.incidents.appendEvent")}
      />
      <Button type="submit" variant="outline" className="min-h-11 shrink-0" disabled={!value.trim()}>
        <Plus className="size-4" aria-hidden="true" />
        {t("gov.registers.add")}
      </Button>
    </form>
  );
}

function CloseIncidentButton({ onClose }: { onClose: (rca: string, corrective: string[]) => void }) {
  const { t } = useI18n();
  const [rca, setRca] = useState("");
  const [corrective, setCorrective] = useState("");
  const actions = corrective
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="min-h-11 border-gold/50 text-gold-deep">
          {t("gov.incidents.close")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("gov.incidents.closeConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("gov.incidents.closeConfirmBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="inc-rca">{t("gov.incidents.rca")} *</Label>
            <Textarea id="inc-rca" rows={4} value={rca} onChange={(e) => setRca(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inc-ca">{t("gov.incidents.corrective")}</Label>
            <Textarea id="inc-ca" rows={3} value={corrective} onChange={(e) => setCorrective(e.target.value)} />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11"
            disabled={!rca.trim()}
            onClick={() => onClose(rca.trim(), actions)}
          >
            {t("gov.incidents.closeConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeclareIncidentDialog({
  open,
  onOpenChange,
  onDeclare,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeclare: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("S3");
  const [type, setType] = useState("outage");
  const [commander, setCommander] = useState("");
  const [impact, setImpact] = useState("");
  const [reportable, setReportable] = useState(false);
  const [saving, setSaving] = useState(false);
  const go = async () => {
    if (saving || !title.trim()) return;
    setSaving(true);
    try {
      await onDeclare({
        title: title.trim(),
        severity,
        type,
        commander: commander.trim() || undefined,
        impact: impact.trim() || undefined,
        regulatory_reportable: reportable,
      });
      setTitle("");
      setCommander("");
      setImpact("");
      setReportable(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("gov.incidents.declare")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="inc-title">{t("gov.incidents.title")} *</Label>
            <Input id="inc-title" className="min-h-11" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="inc-sev">{t("gov.incidents.severity")}</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger id="inc-sev" className="min-h-11 ts-numeric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["S1", "S2", "S3", "S4"].map((s) => (
                    <SelectItem key={s} value={s} className="ts-numeric">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inc-type">{t("gov.incidents.type")}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="inc-type" className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["outage", "security", "privacy", "data", "third_party"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inc-cmd">{t("gov.incidents.commander")}</Label>
            <Input id="inc-cmd" className="min-h-11" value={commander} onChange={(e) => setCommander(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inc-impact">{t("gov.incidents.impact")}</Label>
            <Textarea id="inc-impact" rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-caption text-muted-foreground">
            <Switch checked={reportable} onCheckedChange={setReportable} />
            {t("gov.incidents.reportable")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button className="min-h-11" onClick={go} disabled={saving || !title.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {t("gov.incidents.declare")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RISK
// ═══════════════════════════════════════════════════════════════════════════

function RiskAdmin({ token }: { token: string }) {
  const { t } = useI18n();
  const labels = useGovLabels();
  const [tab, setTab] = useState<"risks" | "exceptions">("risks");
  const [addOpen, setAddOpen] = useState(false);

  const risks = useResource<RiskRow[]>(
    async () => {
      const d = await govAdminFetch<{ risks: RiskRow[] }>(token, "/risks");
      return d.risks ?? [];
    },
    [token],
  );
  const exceptions = useResource<RiskExceptionRow[]>(
    async () => {
      const d = await govAdminFetch<{ exceptions: RiskExceptionRow[] }>(token, "/risk-exceptions");
      return d.exceptions ?? [];
    },
    [token],
  );

  const addRisk = useCallback(
    async (payload: Record<string, unknown>) => {
      await govAdminFetch(token, "/risks", { method: "POST", body: JSON.stringify(payload) });
      risks.reload();
    },
    [token, risks],
  );

  return (
    <div className="space-y-4">
      {/* internal tabs */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t("admin.nav.risk")}>
        {(["risks", "exceptions"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-label font-semibold transition-colors",
              tab === k
                ? "bg-teal-tint text-teal-deep border-teal/40 font-bold"
                : "border-border bg-raised text-muted-foreground hover:text-foreground",
            )}
          >
            {t(k === "risks" ? "gov.risk.risksTab" : "gov.risk.exceptions")}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              risks.reload();
              exceptions.reload();
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("gov.reload")}
          </Button>
          {tab === "risks" && (
            <Button className="min-h-11" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t("gov.risk.add")}
            </Button>
          )}
        </div>
      </div>

      {tab === "risks" ? (
        risks.loading ? (
          <SkeletonRows rows={5} />
        ) : risks.error ? (
          <ErrorState message={risks.error} onRetry={risks.reload} />
        ) : (risks.data ?? []).length === 0 ? (
          <EmptyState icon={<Scale className="size-10" />} title={t("gov.empty")} />
        ) : (
          <div className="rounded-card border border-border bg-raised overflow-hidden">
            <div className="overflow-x-auto ts-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>{t("gov.incidents.title")}</TableHead>
                    <TableHead>{t("gov.risk.category")}</TableHead>
                    <TableHead>{t("gov.risk.score")}</TableHead>
                    <TableHead>{t("gov.col.owner")}</TableHead>
                    <TableHead>{t("gov.col.status")}</TableHead>
                    <TableHead>{t("gov.risk.review")}</TableHead>
                    <TableHead className="min-w-[160px]">{t("gov.risk.controls")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(risks.data ?? []).map((r) => {
                    const st = labels.riskStatus(r.status);
                    const tone = labels.riskScore(r.score);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="ts-numeric font-bold whitespace-nowrap">{r.ref}</TableCell>
                        <TableCell className="max-w-[280px]">
                          <p className="text-label text-foreground font-semibold">{r.title}</p>
                          {r.notes && (
                            <p className="text-caption text-muted-foreground line-clamp-2">{r.notes}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-caption whitespace-nowrap">{r.category}</TableCell>
                        <TableCell>
                          <GovChip tone={tone} label={t("gov.risk.score")}>
                            {r.likelihood}×{r.impact} = {r.score}
                          </GovChip>
                        </TableCell>
                        <TableCell className="text-caption whitespace-nowrap">{r.owner}</TableCell>
                        <TableCell>
                          <GovChip tone={st.tone} label={r.status}>{st.label}</GovChip>
                        </TableCell>
                        <TableCell className="ts-numeric whitespace-nowrap">{r.review_due?.slice(0, 10) ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {r.controls.slice(0, 3).map((c) => (
                              <GovChip key={c} tone="muted">{c}</GovChip>
                            ))}
                            {r.controls.length > 3 && (
                              <GovChip tone="muted">+{r.controls.length - 3}</GovChip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )
      ) : exceptions.loading ? (
        <SkeletonRows rows={2} />
      ) : exceptions.error ? (
        <ErrorState message={exceptions.error} onRetry={exceptions.reload} />
      ) : (exceptions.data ?? []).length === 0 ? (
        <EmptyState icon={<Scale className="size-10" />} title={t("gov.empty")} />
      ) : (
        <ul className="space-y-2">
          {(exceptions.data ?? []).map((ex) => {
            const active = ex.status === "active";
            return (
              <li key={ex.id} className="rounded-card border border-border bg-raised p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="ts-numeric text-label font-bold text-foreground">{ex.ref}</span>
                  <GovChip tone={active ? "warn" : "muted"} label={ex.status}>
                    {active ? t("gov.risk.exception.active") : t("gov.risk.exception.expired")}
                  </GovChip>
                  <GovChip tone="gold">{ex.criticality}</GovChip>
                  <span className="text-caption text-muted-foreground ts-numeric">
                    {t("gov.risk.exception.expires")}: {ex.expires_at?.slice(0, 10) ?? "—"}
                  </span>
                </div>
                <p className="mt-1 text-label text-foreground">{ex.risk_statement}</p>
                <p className="text-caption text-muted-foreground">{ex.reason}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {ex.affected_controls.map((c) => (
                    <GovChip key={c} tone="muted">{c}</GovChip>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AddRiskDialog open={addOpen} onOpenChange={setAddOpen} onAdd={addRisk} />
    </div>
  );
}

function AddRiskDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("operational");
  const [likelihood, setLikelihood] = useState("3");
  const [impact, setImpact] = useState("3");
  const [owner, setOwner] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const go = async () => {
    if (saving || !title.trim() || !owner.trim()) return;
    setSaving(true);
    try {
      await onAdd({
        title: title.trim(),
        category,
        likelihood,
        impact,
        owner: owner.trim(),
        notes: notes.trim() || undefined,
      });
      setTitle("");
      setOwner("");
      setNotes("");
      onOpenChange(false);
      toast({ title: t("gov.toast.saved") });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("gov.risk.add")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="risk-title">{t("gov.incidents.title")} *</Label>
            <Input id="risk-title" className="min-h-11" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="risk-cat">{t("gov.risk.category")}</Label>
              <Input id="risk-cat" className="min-h-11" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="risk-owner">{t("gov.col.owner")} *</Label>
              <Input id="risk-owner" className="min-h-11" value={owner} onChange={(e) => setOwner(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="risk-l">{t("gov.risk.likelihood")} (1-5)</Label>
              <Select value={likelihood} onValueChange={setLikelihood}>
                <SelectTrigger id="risk-l" className="min-h-11 ts-numeric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1", "2", "3", "4", "5"].map((n) => (
                    <SelectItem key={n} value={n} className="ts-numeric">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="risk-i">{t("gov.risk.impact")} (1-5)</Label>
              <Select value={impact} onValueChange={setImpact}>
                <SelectTrigger id="risk-i" className="min-h-11 ts-numeric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1", "2", "3", "4", "5"].map((n) => (
                    <SelectItem key={n} value={n} className="ts-numeric">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="risk-notes">{t("gov.risk.notes")}</Label>
            <Textarea id="risk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button className="min-h-11" onClick={go} disabled={saving || !title.trim() || !owner.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {t("gov.registers.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
