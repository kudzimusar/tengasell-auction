"use client";

// Reusable auction grid section — the NXS async view pattern for the home
// page: LoadingGrid while first load, ErrorState with retry, EmptyState
// when nothing matches, and a responsive AuctionCard grid on success.

import type { ReactNode } from "react";
import { PackageSearch } from "lucide-react";
import {
  AuctionCard,
  EmptyState,
  ErrorState,
  LoadingGrid,
  SectionHeader,
} from "@/components/tengasell/ui";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import type { Auction, AuctionQuery, Paginated } from "@/lib/tengasell/types";

export function AuctionGridSection({
  ariaLabel,
  title,
  subtitle,
  icon,
  action,
  query,
  emptyTitle,
  emptyBody,
}: {
  ariaLabel: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  query: AuctionQuery;
  emptyTitle: string;
  emptyBody?: string;
}) {
  const { t } = useI18n();
  const res = useResource<Paginated<Auction>>(
    () => api.auctions(query),
    [query],
  );
  const items = res.data?.items ?? [];

  return (
    <section className="py-6" aria-label={ariaLabel}>
      <div className="mx-auto max-w-7xl px-4">
        <SectionHeader title={title} subtitle={subtitle} icon={icon} action={action} />
        {res.loading && !res.data ? (
          <div>
            <span role="status" className="sr-only">
              {t("state.loading")}
            </span>
            <LoadingGrid count={8} />
          </div>
        ) : res.error ? (
          <ErrorState message={res.error} onRetry={res.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PackageSearch className="size-8" aria-hidden="true" />}
            title={emptyTitle}
            body={emptyBody}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {items.map((a) => (
              <AuctionCard key={a.id} auction={a} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
