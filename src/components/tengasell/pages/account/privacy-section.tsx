"use client";

// Tengasell — Privacy Centre (My Tengasell → Privacy). Task 12-d.
//
// The data-subject rights surface, backed by the govern-service via the
// /api/gov/me/* BFF (401 unsigned — my-page only mounts this signed in):
//   · Export my data  — POST access request → poll status → download the
//     JSON bundle once completed (CDPA right of access + portability).
//   · Delete my account — AlertDialog-confirmed deletion request; the card
//     explains the retention exceptions (tax/audit/dispute/legal holds) and
//     shows the legal-hold state honestly when a request is blocked.
//   · Correct my data — profile self-service link + correction request.
//   · Restrict / object — restriction + marketing objection requests.
// Plus: my requests table (type/status/due/result), processing flags,
// consent snapshot (→ communications) and accepted policy versions.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  PenLine,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { CurrentUser } from "@/lib/tengasell/types";

// ── wire types (govern-service serializers) ─────────────────────────────

interface PrivacyRequest {
  id: number;
  type: string;
  status: string;
  result_note: string | null;
  handled_by: string | null;
  due_at: string;
  created_at: string;
  completed_at: string | null;
}

interface AcceptanceRow {
  policy_key: string;
  version: number;
  accepted_at: string;
  surface: string;
}

interface FlagRow {
  flag: string;
  note: string | null;
  created_at: string;
  lifted_at: string | null;
}

interface PrivacyDashboard {
  username: string;
  requests: PrivacyRequest[];
  acceptances: AcceptanceRow[];
  active_flags: FlagRow[];
}

const OPEN_STATUSES = ["received", "verifying", "in_progress"];

// ── chips ────────────────────────────────────────────────────────────────

function statusTone(s: string): string {
  switch (s) {
    case "received":
      return "bg-teal-tint text-teal-deep border-teal/30";
    case "verifying":
    case "in_progress":
      return "bg-gold-soft text-gold-on border-gold/40";
    case "completed":
      return "bg-ok/10 text-ok border-ok/30";
    case "rejected":
      return "bg-danger/10 text-danger border-danger/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function PrivacyChip({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-bold whitespace-nowrap ${statusTone(status)}`}
    >
      {label}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ── section ──────────────────────────────────────────────────────────────

export function PrivacySection({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const token = user.token;
  const profileLink = useLinkProps("/my/profile");
  const commsLink = useLinkProps("/my/communications");

  const [dash, setDash] = useState<PrivacyDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gov/me/privacy", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => null)) as (PrivacyDashboard & { error?: string }) | null;
      if (!res.ok || !data) throw new Error(data?.error ?? t("state.error"));
      setDash(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("state.error"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  // Poll while any request is still open (the export card promises live status).
  const hasOpen = (dash?.requests ?? []).some((r) => OPEN_STATUSES.includes(r.status));
  useEffect(() => {
    if (!hasOpen) return;
    const timer = setTimeout(() => setNonce((n) => n + 1), 10_000);
    return () => clearTimeout(timer);
  }, [hasOpen, nonce]);

  const submitRequest = useCallback(
    async (type: string, successKey: string) => {
      if (busy) return;
      setBusy(type);
      try {
        const res = await fetch("/api/gov/me/privacy-requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ type }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; code?: string }
          | null;
        if (!res.ok || !data?.ok) {
          if (data?.code === "duplicate_request") {
            toast({ title: t("privacy.requests.open") });
          } else {
            throw new Error(data?.error ?? t("privacy.failed"));
          }
        } else {
          toast({ title: successKey });
        }
        reload();
      } catch (err) {
        toast({
          title: t("privacy.failed"),
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      } finally {
        setBusy(null);
      }
    },
    [busy, token, t, reload],
  );

  const requests = dash?.requests ?? [];
  const exportReq = useMemo(
    () =>
      requests.find(
        (r) => (r.type === "access" || r.type === "portability") && r.status === "completed",
      ) ?? requests.find((r) => (r.type === "access" || r.type === "portability") && OPEN_STATUSES.includes(r.status)),
    [requests],
  );
  const deletionReq = useMemo(
    () =>
      requests.find((r) => r.type === "deletion" && r.status === "completed") ??
      requests.find((r) => r.type === "deletion" && OPEN_STATUSES.includes(r.status)),
    [requests],
  );
  const typeLabel = (type: string): string =>
    t(`privacy.type.${type}`) === `privacy.type.${type}` ? type : t(`privacy.type.${type}`);
  const statusLabel = (status: string): string =>
    t(`privacy.status.${status}`) === `privacy.status.${status}` ? status : t(`privacy.status.${status}`);

  const flags = (dash?.active_flags ?? []).filter((f) => !f.lifted_at);

  if (loading) {
    return (
      <section aria-labelledby="privacy-heading" aria-busy="true">
        <header className="mb-4">
          <h2 id="privacy-heading" className="text-sectionTitle text-foreground">
            {t("my.privacy.title")}
          </h2>
          <p className="text-caption text-muted-foreground mt-0.5">{t("my.privacy.sub")}</p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-card" />
          ))}
        </div>
        <Skeleton className="mt-6 h-40 rounded-card" />
      </section>
    );
  }

  if (error || !dash) {
    return (
      <section aria-labelledby="privacy-heading">
        <header className="mb-4">
          <h2 id="privacy-heading" className="text-sectionTitle text-foreground">
            {t("my.privacy.title")}
          </h2>
          <p className="text-caption text-muted-foreground mt-0.5">{t("my.privacy.sub")}</p>
        </header>
        <ErrorState message={error ?? undefined} onRetry={reload} />
      </section>
    );
  }

  return (
    <section aria-labelledby="privacy-heading" className="space-y-6">
      <header>
        <h2 id="privacy-heading" className="text-sectionTitle text-foreground">
          {t("my.privacy.title")}
        </h2>
        <p className="text-caption text-muted-foreground mt-0.5">{t("my.privacy.sub")}</p>
      </header>

      <p className="flex items-start gap-2 rounded-card border border-teal/25 bg-teal-tint/60 p-3 text-caption text-teal-deep">
        <ShieldCheck className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
        {t("privacy.authority")}
      </p>

      {/* ── rights cards ─────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Export */}
        <div className="rounded-card border border-border bg-raised p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-teal" aria-hidden="true">
              <Download className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-title text-foreground">{t("privacy.export.title")}</h3>
              <p className="text-caption text-muted-foreground mt-1">{t("privacy.export.body")}</p>
            </div>
          </div>
          <div className="mt-auto">
            {!exportReq ? (
              <Button
                onClick={() => submitRequest("access", t("privacy.export.created"))}
                disabled={busy === "access"}
                className="min-h-11"
              >
                {busy === "access" ? t("comms.saving") : t("privacy.export.cta")}
              </Button>
            ) : exportReq.status === "completed" ? (
              <a
                href="/api/gov/me/export?download=1"
                className="inline-flex min-h-11 items-center gap-2 rounded-control bg-teal px-5 text-label font-bold text-white hover:bg-teal-deep transition-colors"
              >
                <Download className="size-4" aria-hidden="true" />
                {t("privacy.export.download")}
              </a>
            ) : (
              <p className="flex items-center gap-2 text-label text-gold-deep" aria-live="polite">
                <Clock className="size-4 animate-pulse" aria-hidden="true" />
                {t("privacy.export.pending")}
                <span className="text-caption text-muted-foreground ts-numeric">
                  ({fmtDate(exportReq.due_at)})
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Delete */}
        <div className="rounded-card border border-border bg-raised p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-danger" aria-hidden="true">
              <Trash2 className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-title text-foreground">{t("privacy.delete.title")}</h3>
              <p className="text-caption text-muted-foreground mt-1">{t("privacy.delete.body")}</p>
            </div>
          </div>
          <div className="mt-auto">
            {!deletionReq ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="min-h-11">
                    {t("privacy.delete.cta")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("privacy.delete.confirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("privacy.delete.confirmBody")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      className="min-h-11"
                      onClick={() => submitRequest("deletion", t("privacy.delete.requested"))}
                    >
                      {t("privacy.delete.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : deletionReq.status === "completed" ? (
              <p className="flex items-center gap-2 text-label text-ok" aria-live="polite">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {t("privacy.flag.deletion_marked")}
              </p>
            ) : (
              <p
                className="flex items-center gap-2 text-label text-gold-deep"
                aria-live="polite"
              >
                <Clock className="size-4 animate-pulse" aria-hidden="true" />
                {statusLabel(deletionReq.status)}
                <span className="text-caption text-muted-foreground ts-numeric">
                  ({fmtDate(deletionReq.due_at)})
                </span>
              </p>
            )}
          </div>
        </div>

        {/* Correction */}
        <div className="rounded-card border border-border bg-raised p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-teal" aria-hidden="true">
              <PenLine className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-title text-foreground">{t("privacy.correction.title")}</h3>
              <p className="text-caption text-muted-foreground mt-1">{t("privacy.correction.body")}</p>
            </div>
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <a
              {...profileLink}
              className="inline-flex min-h-11 items-center rounded-control border border-teal/40 text-teal-deep px-4 text-label font-bold hover:bg-teal-tint transition-colors"
            >
              {t("privacy.correction.cta")}
            </a>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy === "correction"}
              onClick={() => submitRequest("correction", t("privacy.requests.submitted"))}
            >
              {busy === "correction" ? t("comms.saving") : t("privacy.correction.request")}
            </Button>
          </div>
        </div>

        {/* Restrict / object */}
        <div className="rounded-card border border-border bg-raised p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-gold-deep" aria-hidden="true">
              <SlidersHorizontal className="size-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-title text-foreground">{t("privacy.restrict.title")}</h3>
              <p className="text-caption text-muted-foreground mt-1">{t("privacy.restrict.body")}</p>
            </div>
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy === "restriction"}
              onClick={() => submitRequest("restriction", t("privacy.requests.submitted"))}
            >
              {busy === "restriction" ? t("comms.saving") : t("privacy.restrict.restrict")}
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy === "objection"}
              onClick={() => submitRequest("objection", t("privacy.requests.submitted"))}
            >
              {busy === "objection" ? t("comms.saving") : t("privacy.restrict.object")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── active flags ────────────────────────────────────────────── */}
      {flags.length > 0 && (
        <div className="rounded-card border border-gold/40 bg-gold-soft/50 p-4">
          <h3 className="text-title text-foreground flex items-center gap-2">
            <AlertTriangle className="size-4 text-gold-deep" aria-hidden="true" />
            {t("privacy.flags.title")}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {flags.map((f, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold-soft px-3 py-1.5 text-caption font-bold text-gold-on"
              >
                <Ban className="size-3.5" aria-hidden="true" />
                {t(`privacy.flag.${f.flag}`) === `privacy.flag.${f.flag}` ? f.flag : t(`privacy.flag.${f.flag}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── my requests ─────────────────────────────────────────────── */}
      <div>
        <h3 className="text-title text-foreground mb-2">{t("privacy.requests.title")}</h3>
        {requests.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-10" />}
            title={t("state.empty")}
            body={t("privacy.requests.empty")}
          />
        ) : (
          <div className="rounded-card border border-border bg-raised overflow-hidden">
            <div className="max-h-96 overflow-y-auto ts-scrollbar">
              <Table>
                <TableHeader className="sticky top-0 bg-raised z-10">
                  <TableRow>
                    <TableHead>{t("privacy.requests.type")}</TableHead>
                    <TableHead>{t("privacy.requests.status")}</TableHead>
                    <TableHead>{t("privacy.requests.due")}</TableHead>
                    <TableHead className="min-w-[220px]">{t("privacy.requests.result")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-semibold">{typeLabel(r.type)}</TableCell>
                      <TableCell>
                        <PrivacyChip status={r.status} label={statusLabel(r.status)} />
                      </TableCell>
                      <TableCell className="ts-numeric whitespace-nowrap">{fmtDate(r.due_at)}</TableCell>
                      <TableCell className="text-caption text-muted-foreground">
                        {r.result_note ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* ── consent snapshot ────────────────────────────────────────── */}
      <div className="rounded-card border border-border bg-raised p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-title text-foreground">{t("privacy.consent.title")}</h3>
          <p className="text-caption text-muted-foreground mt-0.5">{t("privacy.consent.body")}</p>
        </div>
        <a
          {...commsLink}
          className="inline-flex min-h-11 items-center rounded-control bg-teal px-4 text-label font-bold text-white hover:bg-teal-deep transition-colors"
        >
          {t("privacy.consent.cta")}
        </a>
      </div>

      {/* ── accepted policies ───────────────────────────────────────── */}
      <div>
        <h3 className="text-title text-foreground mb-2">{t("privacy.accepted.title")}</h3>
        {dash.acceptances.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-10" />}
            title={t("state.empty")}
            body={t("privacy.accepted.empty")}
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {dash.acceptances.slice(0, 8).map((a, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-control border border-border bg-section px-3 py-2.5",
                )}
              >
                <span className="text-label text-foreground truncate">
                  {t(`policies.${a.policy_key}.title`) === `policies.${a.policy_key}.title`
                    ? a.policy_key
                    : t(`policies.${a.policy_key}.title`)}
                </span>
                <span className="text-caption text-muted-foreground ts-numeric whitespace-nowrap">
                  v{a.version} · {fmtDate(a.accepted_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
