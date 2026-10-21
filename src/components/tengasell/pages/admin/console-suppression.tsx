"use client";

// Admin Comms Console — SUPPRESSION LIST: channel + handle scoped opt-outs
// (one-click unsubscribe, bounces, complaints) with the compliance note.

import { ShieldOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatDateTime } from "@/lib/tengasell/format";
import { CHANNEL_ICONS, commsAdminFetch, type Channel, type SuppressionItem } from "./console-shared";

export function ConsoleSuppression({ token }: { token: string }) {
  const { t } = useI18n();
  const list = useResource<SuppressionItem[]>(
    async () => {
      const data = await commsAdminFetch<{ items?: SuppressionItem[] }>(token, "/suppression");
      return data.items ?? [];
    },
    [token],
  );

  const items = list.data ?? [];

  return (
    <section aria-labelledby="admin-sup-heading" className="min-w-0 space-y-6">
      <SectionHeader
        title={<span id="admin-sup-heading">{t("admin.sup.title")}</span>}
        subtitle={t("admin.sup.sub")}
      />

      {/* compliance note */}
      <p className="rounded-card border border-gold/40 bg-gold-soft/50 p-4 text-body text-foreground">
        {t("admin.sup.note")}
      </p>

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <div className="space-y-2" aria-busy="true" aria-label={t("admin.sup.title")}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldOff className="size-10" />}
          title={t("admin.sup.empty")}
          body={t("admin.sup.emptyBody")}
        />
      ) : (
        <div
          className="overflow-hidden rounded-card border border-border bg-raised"
          role="table"
          aria-label={t("admin.sup.title")}
        >
          <div
            role="row"
            className="hidden border-b border-border bg-canvas px-4 py-2.5 text-caption font-bold text-muted-foreground sm:grid"
            style={{ gridTemplateColumns: "120px minmax(0,1.6fr) minmax(0,1fr) 170px" }}
          >
            <span role="columnheader">{t("admin.sup.channel")}</span>
            <span role="columnheader">{t("admin.sup.handle")}</span>
            <span role="columnheader">{t("admin.sup.reason")}</span>
            <span role="columnheader">{t("admin.sup.since")}</span>
          </div>
          {items.map((row) => {
            const ch = (row.channel ?? "") as Channel;
            const Icon = CHANNEL_ICONS[ch];
            return (
              <div
                key={row.id}
                role="row"
                className="grid grid-cols-1 gap-x-3 gap-y-1 border-b border-border/70 px-4 py-3 last:border-b-0 transition-colors hover:bg-accent/40 sm:items-center"
                style={{ gridTemplateColumns: "120px minmax(0,1.6fr) minmax(0,1fr) 170px" }}
              >
                <span role="cell" className="flex items-center gap-1.5 text-label font-bold text-teal-deep">
                  {Icon && <Icon className="size-4" aria-hidden="true" />}
                  {row.channel ? t(`comms.channel.${row.channel}`) : "—"}
                </span>
                <span role="cell" className="min-w-0 truncate text-body text-foreground">
                  {row.handle ?? "—"}
                </span>
                <span role="cell" className="min-w-0 truncate text-caption text-muted-foreground">
                  {row.reason ?? "—"}
                </span>
                <span role="cell" className="text-caption text-muted-foreground ts-numeric">
                  {row.createdAt ? formatDateTime(row.createdAt) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
