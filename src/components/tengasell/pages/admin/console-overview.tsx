"use client";

// Admin Comms Console — OVERVIEW: channel health (mock|real per provider),
// queue stats (depth / sent 24h / failed) and the one-click demo seeder.

import { useEffect, useState } from "react";
import { Loader2, RadioTower, RefreshCw, Sprout, Activity, CheckCircle2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { compactNumber } from "@/lib/tengasell/format";
import {
  AdminChip,
  CHANNELS,
  CHANNEL_ICONS,
  commsAdminFetch,
  type Campaign,
  type CommsHealth,
  type SeedSummary,
} from "./console-shared";

const SEED_CAMPAIGN_NAME = "NXS 1.0 Launch Digest";

export function ConsoleOverview({ token }: { token: string }) {
  const { t } = useI18n();

  const health = useResource<CommsHealth>(
    () => commsAdminFetch<CommsHealth>(token, "/health"),
    [token],
  );
  const campaigns = useResource<Campaign[]>(
    async () => {
      const data = await commsAdminFetch<{ campaigns?: Campaign[] }>(token, "/campaigns");
      return data.campaigns ?? [];
    },
    [token],
  );

  // live-ish health: re-probe every 30s while the overview is mounted
  const reloadHealth = health.reload;
  useEffect(() => {
    const timer = setInterval(() => reloadHealth(), 30_000);
    return () => clearInterval(timer);
  }, [reloadHealth]);

  const [seedState, setSeedState] = useState<{ seeding: boolean; seeded: boolean }>({
    seeding: false,
    seeded: false,
  });
  const alreadySeeded =
    (campaigns.data ?? []).some((c) => c.name === SEED_CAMPAIGN_NAME) || seedState.seeded;

  const onSeed = async () => {
    setSeedState({ seeding: true, seeded: false });
    try {
      const data = await commsAdminFetch<{ summary?: SeedSummary }>(token, "/seed-demo", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (data.summary?.alreadySeeded) {
        toast({ title: t("admin.overview.alreadyToast") });
      } else {
        toast({
          title: t("admin.overview.seedToast"),
          description: `${data.summary?.linksEnsured ?? 0} links · ${data.summary?.eventsEmitted ?? 0} events · campaign ${data.summary?.campaign?.name ?? ""}`,
        });
      }
      setSeedState({ seeding: false, seeded: true });
      health.reload();
      campaigns.reload();
    } catch (err) {
      setSeedState({ seeding: false, seeded: false });
      toast({
        title: t("admin.loadFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const h = health.data;
  const loading = health.loading && !h;

  return (
    <section aria-labelledby="admin-overview-heading" className="min-w-0 space-y-8">
      <SectionHeader
        title={<span id="admin-overview-heading">{t("admin.overview.title")}</span>}
        subtitle={t("admin.overview.sub")}
      />

      {/* ── channel health cards ─────────────────────────────────── */}
      <div className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-title text-foreground">{t("admin.overview.healthTitle")}</h2>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={health.reload}
            aria-label={t("admin.refresh")}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("admin.refresh")}
          </Button>
        </div>
        {health.error ? (
          <ErrorState message={health.error} onRetry={health.reload} />
        ) : loading ? (
          <div
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-busy="true"
            aria-label={t("admin.overview.healthTitle")}
          >
            {CHANNELS.map((ch) => (
              <div key={ch} className="rounded-card border border-border bg-raised p-4 space-y-3">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 list-none p-0 m-0">
            {CHANNELS.map((ch) => {
              const Icon = CHANNEL_ICONS[ch];
              const mode = h?.providers?.[ch] ?? "mock";
              const isReal = mode !== "mock";
              return (
                <li
                  key={ch}
                  className="rounded-card border border-border bg-raised p-4 flex flex-col gap-3 transition-colors hover:border-teal/40"
                  aria-label={t(`comms.channel.${ch}`)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-tint text-teal-deep">
                        <Icon className="size-5" aria-hidden="true" />
                      </span>
                      <span className="text-label font-bold text-foreground">
                        {t(`comms.channel.${ch}`)}
                      </span>
                    </span>
                    <AdminChip tone={isReal ? "gold" : "teal"} label={mode}>
                      {isReal ? t("admin.overview.mode.live") : t("admin.overview.mode.mock")}
                    </AdminChip>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {isReal ? t("admin.overview.providerLive") : t("admin.overview.providerMock")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── queue stats ─────────────────────────────────────────── */}
      <div className="min-w-0 space-y-3">
        <h2 className="text-title text-foreground">{t("admin.overview.queueTitle")}</h2>
        {loading ? (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-card border border-border bg-raised p-4 space-y-3">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <QueueStat
              icon={<Activity className="size-4" aria-hidden="true" />}
              label={t("admin.overview.depth")}
              value={h?.queue?.depth}
            />
            <QueueStat
              icon={<SendIcon />}
              label={t("admin.overview.sent24h")}
              value={h?.queue?.sent24h}
            />
            <QueueStat
              icon={<TriangleAlert className="size-4" aria-hidden="true" />}
              label={t("admin.overview.failed")}
              value={h?.queue?.failed}
              danger={(h?.queue?.failed ?? 0) > 0}
            />
          </div>
        )}
        <p className="text-caption text-muted-foreground">
          {t("admin.overview.queueSub")}
        </p>
      </div>

      {/* ── demo data seeder ────────────────────────────────────── */}
      <div className="rounded-card border border-border bg-raised p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold-deep">
              <Sprout className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-label font-bold text-foreground">
                {t("admin.overview.seedTitle")}
              </h2>
              <p className="text-caption text-muted-foreground mt-0.5">
                {t("admin.overview.seedBody")}
              </p>
            </div>
          </div>
          <Button
            onClick={onSeed}
            disabled={seedState.seeding || alreadySeeded}
            className="min-h-11 font-bold shrink-0"
            aria-label={t("admin.overview.seed")}
          >
            {seedState.seeding ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("admin.overview.seeding")}
              </>
            ) : alreadySeeded ? (
              <>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {t("admin.overview.seeded")}
              </>
            ) : (
              <>
                <Sprout className="size-4" aria-hidden="true" />
                {t("admin.overview.seed")}
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

function QueueStat({
  icon,
  label,
  value,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  danger?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-raised p-4 sm:p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-caption font-bold">{label}</span>
      </div>
      <p
        className={`ts-numeric text-headline font-bold mt-1.5 ${danger ? "text-danger" : "text-teal-deep"}`}
      >
        {value == null ? "—" : compactNumber(value)}
      </p>
    </div>
  );
}

function SendIcon() {
  return <RadioTower className="size-4" aria-hidden="true" />;
}
