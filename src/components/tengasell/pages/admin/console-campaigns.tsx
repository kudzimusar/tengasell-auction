"use client";

// Admin Comms Console — CAMPAIGNS: list with live stats + status badges,
// Run/Pause with confirm + toasts, and the New-campaign builder dialog
// (name, segment, channels, marketing template, locale, optional schedule).
// The BFF resolves the segment to userIds and pushes the audience to the
// comms-service; the resolved count is surfaced in the create toast.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Users,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatDateTime, formatRelative } from "@/lib/tengasell/format";
import type { Category } from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";
import {
  AdminChip,
  campaignStatusTone,
  CHANNELS,
  CHANNEL_ICONS,
  commsAdminFetch,
  type Campaign,
  type CampaignStats,
  type Channel,
} from "./console-shared";

const SEGMENTS = [
  "active_bidders",
  "ending_soon_watchers",
  "dormant_30d",
  "category_fans",
  "all_users",
] as const;
type Segment = (typeof SEGMENTS)[number];

const TEMPLATES = ["marketing.digest", "marketing.spotlight", "marketing.winback"] as const;

export function ConsoleCampaigns({
  token,
  categories,
}: {
  token: string;
  categories: Category[];
}) {
  const { t } = useI18n();

  const campaigns = useResource<Campaign[]>(
    async () => {
      const data = await commsAdminFetch<{ campaigns?: Campaign[] }>(token, "/campaigns");
      return data.campaigns ?? [];
    },
    [token],
  );

  const [newOpen, setNewOpen] = useState(false);
  const [runTarget, setRunTarget] = useState<Campaign | null>(null);
  const [pauseTarget, setPauseTarget] = useState<Campaign | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // live stats: poll while any campaign is running/scheduled (or shortly
  // after an action), so the admin sees stats move without a manual reload.
  const watchRef = useRef(0);
  const hasActive = (campaigns.data ?? []).some(
    (c) => c.status === "running" || c.status === "scheduled",
  );
  const watching = hasActive || Date.now() < watchRef.current;
  const reloadCampaigns = campaigns.reload;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => reloadCampaigns(), 8_000);
    const stop = setTimeout(() => {
      watchRef.current = 0;
      reloadCampaigns();
    }, 90_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [watching, reloadCampaigns]);

  const onRun = async () => {
    if (!runTarget) return;
    const id = runTarget.id;
    setRunTarget(null);
    setBusyId(id);
    try {
      const data = await commsAdminFetch<{ started?: boolean; queued?: number }>(
        token,
        `/campaigns/${id}/run`,
        { method: "POST", body: JSON.stringify({}) },
      );
      watchRef.current = Date.now() + 90_000;
      toast({
        title: t("admin.campaigns.runToast"),
        description: t("admin.campaigns.queuedCount").replace(
          "{n}",
          String(data.queued ?? 0),
        ),
      });
      reloadCampaigns();
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

  const onPause = async () => {
    if (!pauseTarget) return;
    const id = pauseTarget.id;
    setPauseTarget(null);
    setBusyId(id);
    try {
      await commsAdminFetch(token, `/campaigns/${id}/pause`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: t("admin.campaigns.pauseToast") });
      reloadCampaigns();
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

  const list = campaigns.data ?? [];

  return (
    <section aria-labelledby="admin-campaigns-heading" className="min-w-0 space-y-8">
      <SectionHeader
        title={<span id="admin-campaigns-heading">{t("admin.campaigns.title")}</span>}
        subtitle={t("admin.campaigns.sub")}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setNewOpen(true)} className="min-h-11 font-bold">
          <Plus className="size-4" aria-hidden="true" />
          {t("admin.campaigns.new")}
        </Button>
        <Button variant="outline" className="min-h-11" onClick={campaigns.reload}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("admin.refresh")}
        </Button>
      </div>

      {campaigns.error ? (
        <ErrorState message={campaigns.error} onRetry={campaigns.reload} />
      ) : campaigns.loading && !campaigns.data ? (
        <div className="space-y-4" aria-busy="true" aria-label={t("admin.campaigns.title")}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-raised p-4 space-y-3">
              <Skeleton className="h-5 w-1/3" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, j) => (
                  <Skeleton key={j} className="h-14 rounded-card" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="size-10" />}
          title={t("admin.campaigns.empty")}
          body={t("admin.campaigns.emptyBody")}
          action={
            <Button onClick={() => setNewOpen(true)} className="min-h-11 font-bold">
              <Plus className="size-4" aria-hidden="true" />
              {t("admin.campaigns.new")}
            </Button>
          }
        />
      ) : (
        <ul className="list-none p-0 m-0 space-y-4">
          {list.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              busy={busyId === c.id}
              onRun={() => setRunTarget(c)}
              onPause={() => setPauseTarget(c)}
            />
          ))}
        </ul>
      )}

      <NewCampaignDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        token={token}
        categories={categories}
        onCreated={(resolved, requested) => {
          reloadCampaigns();
          // resolved = audience rows stored; requested = segment size pushed.
          // They only differ on re-pushes/audience merges — show both then.
          toast({
            title: t("admin.campaigns.createdToast"),
            description:
              t("admin.campaigns.resolvedCount").replace("{n}", String(resolved)) +
              (requested !== resolved
                ? ` · ${t("admin.campaigns.requestedCount").replace("{n}", String(requested))}`
                : ""),
          });
        }}
      />

      {/* run confirm */}
      <AlertDialog
        open={runTarget != null}
        onOpenChange={(open) => {
          if (!open) setRunTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.campaigns.runTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.campaigns.runBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={onRun}>
              <Play className="size-4" aria-hidden="true" />
              {t("admin.campaigns.run")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* pause confirm */}
      <AlertDialog
        open={pauseTarget != null}
        onOpenChange={(open) => {
          if (!open) setPauseTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.campaigns.pauseTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.campaigns.pauseBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={onPause}>
              <Pause className="size-4" aria-hidden="true" />
              {t("admin.campaigns.pause")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ── campaign card ─────────────────────────────────────────────────────

function CampaignCard({
  campaign,
  busy,
  onRun,
  onPause,
}: {
  campaign: Campaign;
  busy: boolean;
  onRun: () => void;
  onPause: () => void;
}) {
  const { t } = useI18n();
  const stats = campaign.stats;
  const canRun =
    campaign.status !== "done" && campaign.status !== "running" && !busy;
  const canPause =
    (campaign.status === "running" || campaign.status === "scheduled") && !busy;

  return (
    <li className="rounded-card border border-border bg-raised p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title text-foreground font-bold break-words">
              {campaign.name ?? "—"}
            </h3>
            <AdminChip tone={campaignStatusTone(campaign.status)}>
              {t(`admin.campaigns.status.${campaign.status}`)}
            </AdminChip>
            <AdminChip tone="muted">{campaign.locale === "ja" ? "JA" : "EN"}</AdminChip>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden="true" />
              {campaign.segmentKey
                ? t(`admin.segment.${campaign.segmentKey}`)
                : t("admin.segment.all_users")}
            </span>
            <span>{campaign.templateKey ?? "—"}</span>
            <span className="flex items-center gap-1">
              {(campaign.channels ?? []).map((ch) => {
                const Icon = CHANNEL_ICONS[ch] ?? Users;
                return (
                  <Icon
                    key={ch}
                    className="size-4 text-teal"
                    aria-label={t(`comms.channel.${ch}`)}
                    aria-hidden="false"
                  />
                );
              })}
            </span>
            {campaign.createdAt && (
              <span>{t("admin.campaigns.created")} {formatRelative(campaign.createdAt)}</span>
            )}
            {campaign.scheduleAt && (
              <span className="flex items-center gap-1 text-warn">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                {formatDateTime(campaign.scheduleAt, { withTime: true })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="size-4 animate-spin text-teal" aria-label="loading" />}
          {canRun && (
            <Button onClick={onRun} className="min-h-11 font-bold">
              <Play className="size-4" aria-hidden="true" />
              {t("admin.campaigns.run")}
            </Button>
          )}
          {canPause && (
            <Button onClick={onPause} variant="outline" className="min-h-11">
              <Pause className="size-4" aria-hidden="true" />
              {t("admin.campaigns.pause")}
            </Button>
          )}
        </div>
      </div>

      <StatGrid stats={stats} />
    </li>
  );
}

function StatGrid({ stats }: { stats: CampaignStats | undefined }) {
  const { t } = useI18n();
  const cells: { key: keyof CampaignStats; tone: string }[] = [
    { key: "resolved", tone: "text-teal-deep" },
    { key: "queued", tone: "text-warn" },
    { key: "sent", tone: "text-ok" },
    { key: "opened", tone: "text-teal" },
    { key: "clicked", tone: "text-gold-deep" },
    { key: "unsubscribed", tone: "text-danger" },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {cells.map(({ key, tone }) => (
        <div
          key={key}
          className="rounded-control border border-border/70 bg-canvas px-2.5 py-2"
          aria-label={`${t(`admin.campaigns.stat.${key}`)}: ${stats?.[key] ?? 0}`}
        >
          <p className="text-caption text-muted-foreground font-bold truncate">
            {t(`admin.campaigns.stat.${key}`)}
          </p>
          <p className={`ts-numeric text-title font-bold mt-0.5 ${tone}`}>{stats?.[key] ?? 0}</p>
        </div>
      ))}
    </div>
  );
}

// ── new campaign dialog ───────────────────────────────────────────────

function NewCampaignDialog({
  open,
  onOpenChange,
  token,
  categories,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  categories: Category[];
  onCreated: (resolved: number, requested: number) => void;
}) {
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [segment, setSegment] = useState<Segment>("active_bidders");
  const [category, setCategory] = useState<string>(categories[0]?.slug ?? "");
  const [channels, setChannels] = useState<Channel[]>(["email"]);
  const [template, setTemplate] = useState<string>("marketing.digest");
  const [locale, setLocale] = useState<"en" | "ja">("en");
  const [scheduleAt, setScheduleAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSegment("active_bidders");
      setCategory(categories[0]?.slug ?? "");
      setChannels(["email"]);
      setTemplate("marketing.digest");
      setLocale("en");
      setScheduleAt("");
      setError(null);
    }
  }, [open, categories]);

  const submitDisabled =
    submitting || !name.trim() || channels.length === 0 || (segment === "category_fans" && !category);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const data = await commsAdminFetch<{
        resolved?: number;
        requested?: number;
        segmentFallback?: string;
      }>(token, "/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          segmentKey: segment,
          ...(segment === "category_fans" ? { category } : {}),
          channels,
          templateKey: template,
          locale,
          ...(scheduleAt ? { scheduleAt: new Date(scheduleAt).toISOString() } : {}),
        }),
      });
      const resolved = data.resolved ?? 0;
      const requested = data.requested ?? resolved;
      onOpenChange(false);
      onCreated(resolved, requested);
      if (data.segmentFallback) {
        toast({ title: t("admin.campaigns.fallbackToast") });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the campaign.");
    } finally {
      setSubmitting(false);
    }
  };

  const categoryOptions = useMemo(() => categories, [categories]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto ts-scrollbar sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("admin.campaigns.new")}</DialogTitle>
          <DialogDescription>{t("admin.campaigns.newSub")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* name */}
          <div className="space-y-1.5">
            <Label htmlFor="camp-name">{t("admin.campaigns.name")}</Label>
            <Input
              id="camp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("admin.campaigns.namePlaceholder")}
              maxLength={160}
              className="min-h-11"
            />
          </div>

          {/* segment */}
          <div className="space-y-1.5">
            <Label htmlFor="camp-segment">{t("admin.campaigns.segment")}</Label>
            <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
              <SelectTrigger id="camp-segment" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEGMENTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`admin.segment.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-caption text-muted-foreground">{t(`admin.segment.${segment}.desc`)}</p>
          </div>

          {/* category (category_fans only) */}
          {segment === "category_fans" && (
            <div className="space-y-1.5">
              <Label htmlFor="camp-category">{t("admin.campaigns.category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="camp-category" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* channels */}
          <div className="space-y-1.5">
            <Label>{t("admin.campaigns.channels")}</Label>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("admin.campaigns.channels")}>
              {CHANNELS.map((ch) => {
                const Icon = CHANNEL_ICONS[ch];
                const active = channels.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setChannels((prev) =>
                        prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
                      );
                    }}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-control border px-3 text-label font-semibold transition-colors",
                      active
                        ? "border-teal bg-teal-tint text-teal-deep"
                        : "border-border bg-raised text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {t(`comms.channel.${ch}`)}
                  </button>
                );
              })}
            </div>
            <p className="text-caption text-muted-foreground">{t("admin.campaigns.channelsHint")}</p>
          </div>

          {/* template */}
          <div className="space-y-1.5">
            <Label htmlFor="camp-template">{t("admin.campaigns.template")}</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger id="camp-template" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((tpl) => (
                  <SelectItem key={tpl} value={tpl}>
                    {t(`admin.template.${tpl}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* locale + schedule */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("admin.campaigns.locale")}</Label>
              <div className="flex gap-2" role="group" aria-label={t("admin.campaigns.locale")}>
                {(["en", "ja"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={locale === l}
                    onClick={() => setLocale(l)}
                    className={cn(
                      "flex min-h-11 flex-1 items-center justify-center rounded-control border px-3 text-label font-semibold transition-colors",
                      locale === l
                        ? "border-gold bg-gold-soft text-gold-on"
                        : "border-border bg-raised text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {l === "en" ? "English" : "日本語"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-schedule">{t("admin.campaigns.schedule")}</Label>
              <Input
                id="camp-schedule"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="min-h-11"
              />
              <p className="text-caption text-muted-foreground">{t("admin.campaigns.scheduleHint")}</p>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-control border border-danger/40 bg-danger/10 p-3 text-label text-danger">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button onClick={submit} disabled={submitDisabled} className="min-h-11 font-bold">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("admin.campaigns.creating")}
              </>
            ) : (
              <>
                <Megaphone className="size-4" aria-hidden="true" />
                {t("admin.campaigns.create")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
