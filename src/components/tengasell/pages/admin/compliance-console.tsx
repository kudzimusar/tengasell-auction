"use client";

// Tengasell — Compliance console (admin, #/admin/compliance). Task 12-d.
//
// THE MSCS 1.0 CONFORMANCE WORKSHEET — 609 controls / 37 domains, seeded
// from agent-ctx/mscs-worksheet-12.json. This is the tick-every-box
// register the certification wave (12-f) works through:
//   · summary header — totals by status / applicability + progress %
//   · filter bar — domain (37), status (S00..S90), applicability, search
//   · the register table — 50/page, per-row inline STATUS select (PATCH)
//     + expandable editable evidence note, floor/criticality chips,
//     applicability badge, owner wave
//   · CSV export (full worksheet) + idempotent re-import
//   · certification panel (latest record) + evidence & findings panels
//   · 390px: rows collapse to stacked cards (zero horizontal overflow)
//
// All fetches are RELATIVE /api/compliance/admin/** (BFF → :3008).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { CurrentUser } from "@/lib/tengasell/types";
import {
  complianceAdminFetch,
  GovChip,
  useGovLabels,
  type CertificationRow,
  type ControlRow,
  type ControlsSummary,
  type EvidenceRow,
  type FindingRow,
} from "../gov-client";

const PAGE_SIZE = 50;
const ALL = "__all__";
const STATUSES = ["S00", "S10", "S20", "S30", "S40", "S50", "S60", "S80", "S90"];
const APPLICABILITY = ["R", "C", "O", "NA", "F"];

export function ComplianceConsole({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const labels = useGovLabels();
  const token = user.token;

  const [domain, setDomain] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [applicability, setApplicability] = useState(ALL);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  // debounce the search input → query param
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const summary = useResource<ControlsSummary | null>(
    async () => {
      try {
        return await complianceAdminFetch<ControlsSummary>(token, "/controls/summary");
      } catch {
        return null;
      }
    },
    [token],
  );

  const filtersActive = domain !== ALL || status !== ALL || applicability !== ALL || query !== "";

  const list = useResource<{ rows: ControlRow[]; total: number; pages: number }>(
    async () => {
      const params = new URLSearchParams();
      if (domain !== ALL) params.set("domain", domain);
      if (status !== ALL) params.set("status", status);
      if (applicability !== ALL) params.set("applicability", applicability);
      if (query) params.set("q", query);
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const qs = params.toString();
      const d = await complianceAdminFetch<{
        controls: ControlRow[];
        total: number;
        pages: number;
      }>(token, `/controls${qs ? `?${qs}` : ""}`);
      return { rows: d.controls ?? [], total: d.total, pages: d.pages ?? 1 };
    },
    [token, domain, status, applicability, query, page],
  );

  const certs = useResource<CertificationRow[]>(
    async () => {
      try {
        const d = await complianceAdminFetch<{ certifications: CertificationRow[] }>(token, "/certifications");
        return d.certifications ?? [];
      } catch {
        return [];
      }
    },
    [token],
  );
  const evidence = useResource<EvidenceRow[]>(
    async () => {
      try {
        const d = await complianceAdminFetch<{ evidence: EvidenceRow[] }>(token, "/evidence");
        return d.evidence ?? [];
      } catch {
        return [];
      }
    },
    [token],
  );
  const findings = useResource<FindingRow[]>(
    async () => {
      try {
        const d = await complianceAdminFetch<{ findings: FindingRow[] }>(token, "/findings");
        return d.findings ?? [];
      } catch {
        return [];
      }
    },
    [token],
  );

  // PATCH a control (status select / evidence note save) — reloads the
  // current page (filters + page number preserved) and the summary.
  const patchControl = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      try {
        await complianceAdminFetch(token, `/controls/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast({ title: t("compliance.saved") });
        list.reload();
        summary.reload();
      } catch (err) {
        toast({
          title: t("compliance.saveFailed"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      }
    },
    [token, list, summary, t],
  );

  const importWorksheet = useCallback(async () => {
    try {
      const d = await complianceAdminFetch<{ message: string }>(token, "/controls/import", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: t("compliance.importToast"), description: d.message });
      list.reload();
      summary.reload();
    } catch (err) {
      toast({
        title: t("compliance.saveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }, [token, list, summary, t]);

  const s = summary.data;
  const domains = useMemo(
    () => (s?.by_domain ?? []).map((d) => d.domain).sort((a, b) => a.localeCompare(b)),
    [s],
  );
  const progress = useMemo(() => {
    if (!s || !s.in_scope) return 0;
    const done = (s.by_status ?? [])
      .filter((x) => ["S60", "S80", "S90"].includes(x.status))
      .reduce((acc, x) => acc + x.n, 0);
    return Math.round((done / s.in_scope) * 100);
  }, [s]);
  const latestCert = certs.data?.[0] ?? null;

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pages = list.data?.pages ?? 1;

  return (
    <div className="min-w-0 space-y-6">
      <SectionHeader
        icon={<ClipboardCheck className="size-5 text-teal" aria-hidden="true" />}
        title={t("admin.compliance.title")}
        subtitle={t("admin.compliance.sub")}
        action={
          <div className="hidden sm:flex gap-2">
            <Button variant="outline" className="min-h-11" onClick={importWorksheet}>
              <RotateCw className="size-4" aria-hidden="true" />
              {t("compliance.import")}
            </Button>
            <a
              href="/api/compliance/admin/controls/export"
              className="inline-flex min-h-11 items-center gap-2 rounded-control bg-teal px-4 text-label font-bold text-white hover:bg-teal-deep transition-colors"
            >
              <Download className="size-4" aria-hidden="true" />
              {t("compliance.export")}
            </a>
          </div>
        }
      />

      {/* mobile export row */}
      <div className="flex sm:hidden gap-2">
        <Button variant="outline" className="min-h-11 flex-1" onClick={importWorksheet}>
          <RotateCw className="size-4" aria-hidden="true" />
          {t("compliance.import")}
        </Button>
        <a
          href="/api/compliance/admin/controls/export"
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control bg-teal px-4 text-label font-bold text-white"
        >
          <Download className="size-4" aria-hidden="true" />
          {t("compliance.export")}
        </a>
      </div>

      {/* ── summary header ──────────────────────────────────────────── */}
      {summary.loading ? (
        <Skeleton className="h-28 rounded-card" />
      ) : s ? (
        <div className="rounded-card border border-border bg-raised p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <p className="ts-numeric text-headline font-bold text-teal-deep">{s.total}</p>
              <p className="text-caption text-muted-foreground">{t("compliance.summary.controls")}</p>
            </div>
            <div>
              <p className="ts-numeric text-headline font-bold text-foreground">{s.in_scope}</p>
              <p className="text-caption text-muted-foreground">{t("compliance.summary.inScope")}</p>
            </div>
            <div className="min-w-[140px]">
              <div className="flex items-baseline gap-1.5">
                <p className="ts-numeric text-headline font-bold text-gold-deep">{progress}%</p>
                <p className="text-caption text-muted-foreground">{t("compliance.summary.progress")} S60+</p>
              </div>
              <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t("compliance.summary.progress")}>
                <div className="h-full bg-gold" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(s.by_status ?? []).map((x) => {
                const meta = labels.controlStatus(x.status);
                return (
                  <GovChip key={x.status} tone={meta.tone}>
                    {x.status}: {x.n}
                  </GovChip>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(s.by_applicability ?? []).map((x) => {
              const meta = labels.applicability(x.applicability);
              return (
                <GovChip key={x.applicability} tone={meta.tone}>
                  {meta.label}: {x.n}
                </GovChip>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── filter bar ─────────────────────────────────────────────── */}
      <div className="rounded-card border border-border bg-raised p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="grid gap-1">
          <Label htmlFor="cf-domain" className="sr-only">{t("compliance.filter.domain")}</Label>
          <Select
            value={domain}
            onValueChange={(v) => {
              setDomain(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="cf-domain" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>
                {t("compliance.filter.domain")} · {t("compliance.filter.all")}
              </SelectItem>
              {domains.map((d) => (
                <SelectItem key={d} value={d} className="ts-numeric">
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cf-status" className="sr-only">{t("compliance.filter.status")}</Label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="cf-status" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("compliance.filter.status")} · {t("compliance.filter.all")}
              </SelectItem>
              {STATUSES.map((st) => (
                <SelectItem key={st} value={st}>{t(`compliance.status.${st}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cf-app" className="sr-only">{t("compliance.filter.applicability")}</Label>
          <Select
            value={applicability}
            onValueChange={(v) => {
              setApplicability(v);
              setPage(1);
            }}
          >
            <SelectTrigger id="cf-app" className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t("compliance.filter.applicability")} · {t("compliance.filter.all")}
              </SelectItem>
              {APPLICABILITY.map((a) => (
                <SelectItem key={a} value={a}>
                  {t(`compliance.app.${a}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            className="min-h-11 pl-9"
            placeholder={t("compliance.filter.search")}
            aria-label={t("compliance.filter.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={!filtersActive}
          onClick={() => {
            setDomain(ALL);
            setStatus(ALL);
            setApplicability(ALL);
            setSearch("");
            setQuery("");
            setPage(1);
          }}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("compliance.filter.clear")}
        </Button>
      </div>

      {/* ── register table ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground ts-numeric">
          {t("compliance.rows").replace("{n}", String(total))}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={page <= 1 || list.loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label={t("compliance.page.prev")}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="text-label ts-numeric text-foreground whitespace-nowrap">
            {t("compliance.page.of").replace("{p}", String(page)).replace("{pp}", String(pages))}
          </span>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={page >= pages || list.loading}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            aria-label={t("compliance.page.next")}
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {list.loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-card" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="size-10" />} title={t("state.empty")} />
      ) : (
        <>
          {/* ≥md: table */}
          <div className="hidden md:block rounded-card border border-border bg-raised overflow-hidden">
            <div className="overflow-x-auto ts-scrollbar max-h-[70vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-raised z-10">
                  <TableRow>
                    <TableHead>{t("compliance.col.id")}</TableHead>
                    <TableHead className="min-w-[240px]">{t("compliance.col.name")}</TableHead>
                    <TableHead>{t("compliance.col.floor")}</TableHead>
                    <TableHead>{t("compliance.col.applicability")}</TableHead>
                    <TableHead>{t("compliance.col.wave")}</TableHead>
                    <TableHead className="min-w-[150px]">{t("compliance.col.status")}</TableHead>
                    <TableHead>{t("compliance.expand")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <ControlTableRow
                      key={r.id}
                      row={r}
                      expanded={expanded === r.id}
                      onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                      onPatch={patchControl}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* <md: stacked cards (390px zero-overflow) */}
          <ul className="md:hidden space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-card border border-border bg-raised p-3">
                <ControlCard
                  row={r}
                  expanded={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                  onPatch={patchControl}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ── certification panel ────────────────────────────────────── */}
      <div className="rounded-card border border-border bg-raised p-4">
        <h3 className="text-title text-foreground flex items-center gap-2 mb-2">
          <Award className="size-4 text-gold-deep" aria-hidden="true" />
          {t("compliance.cert.title")}
        </h3>
        {latestCert ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <GovChip tone={latestCert.disposition.startsWith("PASS") ? "ok" : "danger"}>
              {latestCert.disposition}
            </GovChip>
            <span className="text-label text-foreground font-semibold">{latestCert.profile}</span>
            {latestCert.score != null && (
              <span className="ts-numeric text-label text-gold-deep font-bold">
                {t("compliance.cert.score")}: {latestCert.score}
              </span>
            )}
            <span className="text-caption text-muted-foreground">
              {t("compliance.cert.issued")}: <span className="ts-numeric">{fmt(latestCert.issued_at)}</span>
            </span>
            <p className="w-full text-caption text-muted-foreground">
              {t("compliance.cert.scope")}: {latestCert.scope} · {latestCert.source_authority} · {latestCert.environment}
            </p>
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">{t("compliance.cert.none")}</p>
        )}
      </div>

      {/* ── evidence + findings panels ─────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-card border border-border bg-raised p-4">
          <h3 className="text-title text-foreground mb-2">{t("compliance.evidence.title")}</h3>
          {evidence.loading ? (
            <Skeleton className="h-16" />
          ) : (evidence.data ?? []).length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("compliance.evidence.empty")}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto ts-scrollbar space-y-1.5 pr-1">
              {(evidence.data ?? []).map((e) => (
                <li key={e.id} className="rounded-control border border-border bg-section px-3 py-2">
                  <p className="text-label text-foreground font-semibold">
                    <span className="ts-numeric">{e.class}</span> · {e.source}
                  </p>
                  <p className="text-caption text-muted-foreground truncate">
                    {e.authority} · {(e.control_ids ?? []).slice(0, 4).join(", ")}
                    {(e.control_ids ?? []).length > 4 ? ` +${(e.control_ids ?? []).length - 4}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-card border border-border bg-raised p-4">
          <h3 className="text-title text-foreground mb-2">{t("compliance.findings.title")}</h3>
          {findings.loading ? (
            <Skeleton className="h-16" />
          ) : (findings.data ?? []).length === 0 ? (
            <p className="text-caption text-muted-foreground">{t("compliance.findings.empty")}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto ts-scrollbar space-y-1.5 pr-1">
              {(findings.data ?? []).map((f) => (
                <li key={f.id} className="rounded-control border border-border bg-section px-3 py-2">
                  <p className="text-label text-foreground font-semibold">
                    <span className="ts-numeric">{f.control_id}</span> · {f.class}
                    <GovChip tone={f.severity === "high" ? "danger" : "warn"} className="ml-2">{f.severity}</GovChip>
                  </p>
                  <p className="text-caption text-muted-foreground line-clamp-2">{f.description}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toISOString().slice(0, 10);
}

// ── shared row pieces ─────────────────────────────────────────────────────

function StatusSelect({
  row,
  onPatch,
}: {
  row: ControlRow;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={row.status}
        onValueChange={async (v) => {
          if (v === row.status || busy) return;
          setBusy(true);
          await onPatch(row.id, { status: v });
          setBusy(false);
        }}
      >
        <SelectTrigger
          className="min-h-11 ts-numeric h-11"
          aria-label={`${t("compliance.col.status")} ${row.id}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((st) => (
            <SelectItem key={st} value={st}>{t(`compliance.status.${st}`)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {busy && <Loader2 className="size-4 animate-spin text-teal" aria-hidden="true" />}
    </div>
  );
}

function EvidenceEditor({
  row,
  onPatch,
}: {
  row: ControlRow;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState(row.evidence_note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      {row.note && (
        <p className="text-caption text-muted-foreground">
          <span className="font-bold text-foreground">Worksheet:</span> {row.note}
        </p>
      )}
      <p className="text-caption text-muted-foreground ts-numeric">
        {t("compliance.col.floor")}: {row.floor} · {t("compliance.col.criticality")}: {row.criticality} · E: {row.evidence_floor}
        {row.updated_by && ` · ${t("compliance.updatedBy").replace("{u}", row.updated_by)} ${fmt(row.updated_at)}`}
      </p>
      <Textarea
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label={`${t("compliance.evidenceNote")} ${row.id}`}
        placeholder={t("compliance.evidenceNote")}
      />
      <Button
        size="sm"
        className="min-h-11"
        disabled={busy || note === (row.evidence_note ?? "")}
        onClick={async () => {
          setBusy(true);
          await onPatch(row.id, { evidence_note: note });
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {t("compliance.saveNote")}
      </Button>
    </div>
  );
}

function ControlTableRow({
  row,
  expanded,
  onToggle,
  onPatch,
}: {
  row: ControlRow;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const labels = useGovLabels();
  const app = labels.applicability(row.applicability);
  return (
    <TableRow>
      <TableCell className="ts-numeric font-bold whitespace-nowrap">{row.id}</TableCell>
      <TableCell>
        <p className="text-label text-foreground font-semibold">{row.name}</p>
        {expanded && (
          <div className="mt-2 max-w-lg">
            <EvidenceEditor row={row} onPatch={onPatch} />
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1 items-start">
          <GovChip tone="muted">{row.floor}</GovChip>
          <GovChip tone={row.criticality === "C3" || row.criticality === "C4" ? "danger" : "gold"}>
            {row.criticality}
          </GovChip>
        </div>
      </TableCell>
      <TableCell>
        <GovChip tone={app.tone} label={row.applicability}>{app.label}</GovChip>
      </TableCell>
      <TableCell className="text-caption text-muted-foreground whitespace-nowrap ts-numeric">{row.owner_wave}</TableCell>
      <TableCell>
        <StatusSelect row={row} onPatch={onPatch} />
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11"
          aria-expanded={expanded}
          aria-label={`${t("compliance.expand")} ${row.id}`}
          onClick={onToggle}
        >
          {expanded ? "−" : "+"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ControlCard({
  row,
  expanded,
  onToggle,
  onPatch,
}: {
  row: ControlRow;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const labels = useGovLabels();
  const app = labels.applicability(row.applicability);
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="ts-numeric text-caption font-bold text-teal-deep">{row.id}</p>
          <p className="text-label text-foreground font-semibold">{row.name}</p>
        </div>
        <GovChip tone={app.tone}>{app.label}</GovChip>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <GovChip tone="muted">{row.floor}</GovChip>
        <GovChip tone={row.criticality === "C3" || row.criticality === "C4" ? "danger" : "gold"}>
          {row.criticality}
        </GovChip>
        <GovChip tone="muted">{row.owner_wave}</GovChip>
      </div>
      <StatusSelect row={row} onPatch={onPatch} />
      <Button size="sm" variant="outline" className="min-h-11 w-full" aria-expanded={expanded} onClick={onToggle}>
        {expanded ? "−" : "+"} Evidence
      </Button>
      {expanded && <EvidenceEditor row={row} onPatch={onPatch} />}
    </div>
  );
}
