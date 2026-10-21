"use client";

// Tengasell home page — eBay/Yahoo-Auctions-style marketplace landing.
// Section order: hero (+ how bidding works) → closing soon (live rail) →
// featured → categories → trending/most watched → trust band → sell CTA →
// newly listed. Each async section carries loading/empty/error states.
// I18N-009 (Task 12-d): every section string is localized (home.* keys).

// Gap-8 F3: compact live-room banner rail — shows when a room is live now
// or scheduled within the next 24h; hides itself otherwise.

import { ArrowRight, Clock, Flame, Radio, Star } from "lucide-react";
import type { AuctionQuery } from "@/lib/tengasell/types";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import { AuctionGridSection } from "./sections";
import { CategoryGrid } from "./category-grid";
import { ClosingSoon } from "./closing-soon";
import { Hero } from "./hero";
import { LinkButton } from "./link-button";
import { SellCta } from "./sell-cta";
import { TrustBand } from "./trust-band";

function LiveRoomRail() {
  const { t, locale } = useI18n();
  const res = useResource(() => api.liveSessions(), []);

  const sessions = res.data ?? [];
  const live = sessions.find((s) => s.status === "live");
  const next = sessions
    .filter((s) => s.status === "scheduled" && Date.parse(s.scheduled_at) - Date.now() < 24 * 3600_000)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];

  // hook order must be stable — resolve the link target before the early return
  const link = useLinkProps(live ? `#/live/${live.id}` : next ? `#/live/${next.id}` : "/live");

  if (res.loading || res.error || (!live && !next)) return null;

  const banner = live
    ? {
        live: true,
        text: fill(t("home.liveBanner"), { title: live.title, n: Math.max(live.lot_index, 1) }),
        href: `#/live/${live.id}`,
      }
    : {
        live: false,
        text: fill(t("home.nextBanner"), {
          title: next.title,
          time: whenLabel(next.scheduled_at, locale),
        }),
        href: `#/live/${next.id}`,
      };

  return (
    <section aria-label={t("home.liveAria")} className="py-3">
      <div className="mx-auto max-w-7xl px-4">
        <a
          {...link}
          className="group flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-teal/30 bg-teal-tint/60 px-4 py-2.5 transition-colors hover:bg-teal-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:bg-teal-tint/30"
        >
          {banner.live ? (
            <span className="inline-flex items-center gap-1.5 text-label font-extrabold text-urgent">
              <span className="size-2 rounded-full bg-urgent animate-pulse" aria-hidden="true" />
              <Radio className="size-4" aria-hidden="true" />
              {t("state.live")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-label font-bold text-teal">
              <Clock className="size-4" aria-hidden="true" />
              {t("live.board.upcoming")}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">
            {banner.text}
          </span>
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control bg-teal px-4 text-label font-bold text-white transition-colors group-hover:bg-teal-deep">
            {t("home.liveEnter")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </span>
        </a>
      </div>
    </section>
  );
}

// t() has no interpolation — fill client-side (same helper as live-room.tsx).
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

function whenLabel(iso: string, locale: "en" | "ja"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale === "ja" ? "ja-JP" : "en-GB");
}

// module-level constants keep query identities stable across renders
// (useResource keys its fetch effect on these deps)
const FEATURED_QUERY: AuctionQuery = {
  featured: true,
  status: "live",
  order: "hot",
  limit: 8,
};
const TRENDING_QUERY: AuctionQuery = { order: "hot", status: "live", limit: 8 };
const NEWEST_QUERY: AuctionQuery = { order: "newest", status: "live", limit: 8 };

function ViewAll({ to, label }: { to: string; label: string }) {
  return (
    <LinkButton to={to} variant="ghost" className="px-3" ariaLabel={label}>
      {label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </LinkButton>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  return (
    <div>
      <Hero />
      <LiveRoomRail />
      <ClosingSoon />
      <AuctionGridSection
        ariaLabel={t("home.featured.aria")}
        title={t("home.featured.title")}
        subtitle={t("home.featured.sub")}
        icon={<Star className="size-5 text-gold-deep" aria-hidden="true" />}
        action={<ViewAll to="/search" label={t("home.viewAll")} />}
        query={FEATURED_QUERY}
        emptyTitle={t("home.featured.empty")}
        emptyBody={t("home.featured.emptyBody")}
      />
      <CategoryGrid />
      <AuctionGridSection
        ariaLabel={t("home.trending.aria")}
        title={t("home.trending.title")}
        subtitle={t("home.trending.sub")}
        icon={<Flame className="size-5 text-tag" aria-hidden="true" />}
        action={<ViewAll to="/search" label={t("home.viewAll")} />}
        query={TRENDING_QUERY}
        emptyTitle={t("home.trending.empty")}
        emptyBody={t("home.trending.emptyBody")}
      />
      <TrustBand />
      <SellCta />
      <AuctionGridSection
        ariaLabel={t("home.new.aria")}
        title={t("home.new.title")}
        subtitle={t("home.new.sub")}
        icon={<Clock className="size-5 text-teal" aria-hidden="true" />}
        action={<ViewAll to="/search" label={t("home.viewAll")} />}
        query={NEWEST_QUERY}
        emptyTitle={t("home.new.empty")}
        emptyBody={t("home.new.emptyBody")}
      />
    </div>
  );
}
