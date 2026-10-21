"use client";

// Tengasell — My Tengasell (#/my/{section}). Task 5-a.
// Auth gate (skeleton while loading, sign-in prompt when signed out),
// desktop sidebar / mobile scroll-tab section nav with live counts,
// and the section router: overview · watchlist · bids · selling · won ·
// profile.

import { useMemo, useState } from "react";
import {
  Bell,
  Gavel,
  Handshake,
  Heart,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogIn,
  ShieldCheck,
  Tag,
  Trophy,
  User,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { LinkButton } from "./auth-shared";
import { CommsSection } from "./comms-center";
import { EarningsSection } from "./earnings-section";
import { OffersSection } from "./offers-section";
import { PrivacySection } from "./privacy-section";
import { SavedSearchesSection } from "./saved-searches-section";
import { SecuritySection } from "./security-section";
import { TicketsSection } from "./tickets-section";
import {
  BidsSection,
  makeCountReporter,
  OverviewSection,
  ProfileSection,
  readCountsCache,
  SellingSection,
  WatchlistSection,
  WonSection,
  type MyCounts,
  type MySection,
} from "./my-sections";
import { Avatar, EmptyState } from "@/components/tengasell/ui";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";

const MY_SECTIONS: MySection[] = [
  "overview",
  "watchlist",
  "bids",
  "selling",
  "won",
  "searches",
  "offers",
  "communications",
  "earnings",
  "tickets",
  "privacy",
  "security",
  "profile",
];

export default function MyPage({ section }: { section: MySection }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [counts, setCounts] = useState<MyCounts>(readCountsCache);
  const reportCounts = useMemo(() => makeCountReporter(setCounts), []);

  const active = MY_SECTIONS.includes(section) ? section : "overview";

  // ── auth loading → calm skeleton ─────────────────────────────────
  if (loading) {
    return <MyPageSkeleton />;
  }

  // ── signed out → sign-in prompt ──────────────────────────────────
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <EmptyState
          icon={<UserX className="size-10" />}
          title="Sign in to view My Tengasell"
          body="Your watchlist, bids, listings, wins and profile live here. Sign in or create a free account to get started — it takes a snap."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton to="/signin">
                <LogIn className="size-4" aria-hidden="true" />
                {t("nav.signin")}
              </LinkButton>
              <LinkButton to="/register" variant="outline">
                {t("nav.register")}
              </LinkButton>
            </div>
          }
        />
      </div>
    );
  }

  const nav: { key: MySection; label: string; icon: LucideIcon }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "watchlist", label: t("nav.watchlist"), icon: Heart },
    { key: "bids", label: t("nav.bids"), icon: Gavel },
    { key: "selling", label: t("nav.selling"), icon: Tag },
    { key: "won", label: "Won", icon: Trophy },
    { key: "searches", label: t("nav.searches"), icon: Bell },
    { key: "offers", label: t("nav.offers"), icon: Handshake },
    { key: "communications", label: t("nav.communications"), icon: Inbox },
    { key: "earnings", label: t("my.earnings.nav"), icon: Wallet },
    { key: "tickets", label: t("my.tickets.nav"), icon: LifeBuoy },
    { key: "privacy", label: t("my.privacy.nav"), icon: ShieldCheck },
    { key: "security", label: t("my.security.nav"), icon: KeyRound },
    { key: "profile", label: "Profile", icon: User },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <header>
        <h1 className="text-headline text-foreground">{t("nav.my")}</h1>
        <p className="text-caption text-muted-foreground mt-0.5">
          Bids, watchlist, listings, wins and profile — one place, live.
        </p>
      </header>

      <div className="grid lg:grid-cols-[248px_minmax(0,1fr)] gap-6 items-start">
        {/* desktop sidebar nav */}
        <nav
          aria-label="My Tengasell sections"
          className="hidden lg:block sticky top-28 rounded-card border border-border bg-raised p-3"
        >
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1 border-b border-border/70">
            <Avatar username={user.username} size={34} />
            <div className="min-w-0">
              <p className="text-label font-bold text-foreground truncate">
                {user.profile?.display_name ?? user.username}
              </p>
              <p className="text-caption text-muted-foreground truncate">@{user.username}</p>
            </div>
          </div>
          <ul className="mt-1 space-y-0.5">
            {nav.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                active={active === item.key}
                count={counts[item.key]}
              />
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* mobile horizontal scroll tabs */}
          <nav
            aria-label="My Tengasell sections"
            className="lg:hidden -mx-4 px-4 overflow-x-auto ts-scrollbar"
          >
            <ul className="flex gap-1.5 w-max pb-1">
              {nav.map((item) => (
                <MobileNavItem
                  key={item.key}
                  item={item}
                  active={active === item.key}
                  count={counts[item.key]}
                />
              ))}
            </ul>
          </nav>

          {active === "overview" && <OverviewSection user={user} onCounts={reportCounts} />}
          {active === "watchlist" && <WatchlistSection onCounts={reportCounts} />}
          {active === "bids" && <BidsSection onCounts={reportCounts} />}
          {active === "selling" && <SellingSection onCounts={reportCounts} />}
          {active === "won" && <WonSection onCounts={reportCounts} />}
          {active === "searches" && <SavedSearchesSection />}
          {active === "offers" && <OffersSection />}
          {active === "communications" && <CommsSection user={user} />}
          {active === "earnings" && <EarningsSection user={user} />}
          {active === "tickets" && <TicketsSection user={user} />}
          {active === "privacy" && <PrivacySection user={user} />}
          {active === "security" && <SecuritySection user={user} />}
          {active === "profile" && <ProfileSection user={user} />}
        </div>
      </div>
    </div>
  );
}

// ── nav items ────────────────────────────────────────────────────────

function NavItem({
  item,
  active,
  count,
}: {
  item: { key: MySection; label: string; icon: LucideIcon };
  active: boolean;
  count?: number;
}) {
  const link = useLinkProps(`/my/${item.key}`);
  const Icon = item.icon;
  return (
    <li>
      <a
        {...link}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-control px-3 text-label font-semibold transition-colors",
          active
            ? "bg-teal-tint text-teal-deep font-bold"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1">{item.label}</span>
        {count != null && (
          <span className="ts-numeric text-caption text-muted-foreground font-bold">{count}</span>
        )}
      </a>
    </li>
  );
}

function MobileNavItem({
  item,
  active,
  count,
}: {
  item: { key: MySection; label: string; icon: LucideIcon };
  active: boolean;
  count?: number;
}) {
  const link = useLinkProps(`/my/${item.key}`);
  const Icon = item.icon;
  return (
    <li>
      <a
        {...link}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-label font-semibold transition-colors",
          active
            ? "bg-primary text-primary-foreground border-transparent font-bold"
            : "border-border bg-raised text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {item.label}
        {count != null && <span className="ts-numeric text-caption font-bold">{count}</span>}
      </a>
    </li>
  );
}

// ── page-level skeleton (auth restoring) ─────────────────────────────

function MyPageSkeleton() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-6 space-y-6"
      aria-busy="true"
      aria-label="Loading My Tengasell"
    >
      <Skeleton className="h-7 w-40" />
      <div className="grid lg:grid-cols-[248px_minmax(0,1fr)] gap-6 items-start">
        <div className="hidden lg:block rounded-card border border-border bg-raised p-3 space-y-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
        <div className="space-y-6 min-w-0">
          <div className="flex gap-2 lg:hidden overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-24 rounded-full shrink-0" />
            ))}
          </div>
          <Skeleton className="h-8 w-56" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-card border border-border bg-raised p-4">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-8 w-12 mt-2" />
              </div>
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
