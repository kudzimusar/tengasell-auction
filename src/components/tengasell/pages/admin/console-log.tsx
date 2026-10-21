"use client";

// Admin Comms Console — DELIVERY LOG: outbound_queue rows (user, channel,
// subject, status, attempts, times) with an all/queued/sent/failed/dead
// filter and the project's max-h-96 + ts-scrollbar long-list treatment.

import { useState } from "react";
import { ListChecks, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatRelative } from "@/lib/tengasell/format";
import { cn } from "@/lib/utils";
import {
  AdminChip,
  CHANNEL_ICONS,
  commsAdminFetch,
  queueStatusTone,
  type Channel,
  type QueueItem,
} from "./console-shared";

const FILTERS = ["all", "queued", "sent", "failed", "dead"] as const;
type LogFilter = (typeof FILTERS)[number];

export function ConsoleLog({ token }: { token: string }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<LogFilter>("all");

  const log = useResource<QueueItem[]>(
    async () => {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const data = await commsAdminFetch<{ items?: QueueItem[] }>(token, `/queue${qs}`);
      return data.items ?? [];
    },
    [token, filter],
  );

  const items = log.data ?? [];

  return (
    <section aria-labelledby="admin-log-heading" className="min-w-0 space-y-6">
      <SectionHeader
        title={<span id="admin-log-heading">{t("admin.log.title")}</span>}
        subtitle={t("admin.log.sub")}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex gap-1.5 overflow-x-auto ts-scrollbar"
          role="group"
          aria-label={t("admin.log.filter")}
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "flex min-h-11 shrink-0 items-center rounded-full border px-4 text-label font-semibold transition-colors",
                filter === f
                  ? "border-teal bg-teal-tint font-bold text-teal-deep"
                  : "border-border bg-raised text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`admin.log.filter.${f}`)}
            </button>
          ))}
        </div>
        <Button variant="outline" className="min-h-11" onClick={log.reload}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("admin.refresh")}
        </Button>
      </div>

      {log.error ? (
        <ErrorState message={log.error} onRetry={log.reload} />
      ) : log.loading && !log.data ? (
        <div
          className="max-h-96 overflow-hidden rounded-card border border-border bg-raised space-y-2 p-3"
          aria-busy="true"
          aria-label={t("admin.log.title")}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-control" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="size-10" />}
          title={t("admin.log.empty")}
          body={t("admin.log.emptyBody")}
        />
      ) : (
        <div
          className="max-h-96 overflow-y-auto ts-scrollbar rounded-card border border-border bg-raised"
          role="table"
          aria-label={t("admin.log.title")}
        >
          {items.map((row) => {
            const Icon = row.channel ? CHANNEL_ICONS[row.channel as Channel] : null;
            return (
              <div
                key={row.id}
                role="row"
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/70 px-4 py-3 last:border-b-0 hover:bg-accent/40 transition-colors"
              >
                {/* user + channel */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {Icon && (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-tint text-teal-deep">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-label font-bold text-foreground">
                      {row.subject ?? row.eventKey ?? "—"}
                    </p>
                    <p className="truncate text-caption text-muted-foreground ts-numeric">
                      {row.userId ?? "—"}
                      {row.campaignId != null && ` · campaign #${row.campaignId}`}
                    </p>
                  </div>
                </div>

                {/* status + attempts + times */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <AdminChip tone={queueStatusTone(row.status)}>{row.status}</AdminChip>
                  <span className="text-caption text-muted-foreground ts-numeric">
                    {t("admin.log.attempts")}: {row.attempts}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {row.createdAt ? formatRelative(row.createdAt) : ""}
                    {row.sentAt ? ` · ${t("comms.status.sent")} ${formatRelative(row.sentAt)}` : ""}
                  </span>
                  {row.lastError && (
                    <span
                      className="max-w-[220px] truncate text-caption text-danger"
                      title={row.lastError}
                    >
                      {row.lastError}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
