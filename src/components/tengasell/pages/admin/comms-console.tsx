"use client";

// Tengasell — Admin Comms Console shell (TUCS admin side, task 11-c).
// Follows the My Tengasell navigation conventions: desktop sidebar + mobile
// horizontal pill nav (44px targets), section switch over the comms admin
// surfaces: overview · campaigns · mock viewers · moderation · log ·
// suppression. Route: #/admin/{section}.

import {
  Eye,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  ShieldAlert,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useCategories } from "@/lib/tengasell/hooks";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/tengasell/types";
import { ConsoleCampaigns } from "./console-campaigns";
import { ConsoleLog } from "./console-log";
import { ConsoleMock } from "./console-mock";
import { ConsoleModeration } from "./console-moderation";
import { ConsoleOverview } from "./console-overview";
import { ConsoleSuppression } from "./console-suppression";

export type AdminSection =
  | "overview"
  | "campaigns"
  | "mock"
  | "moderation"
  | "log"
  | "suppression";

export const ADMIN_SECTIONS: AdminSection[] = [
  "overview",
  "campaigns",
  "mock",
  "moderation",
  "log",
  "suppression",
];

export function CommsConsole({
  user,
  section,
}: {
  user: CurrentUser;
  section: AdminSection;
}) {
  const { t } = useI18n();
  const { categories } = useCategories();
  const active = ADMIN_SECTIONS.includes(section) ? section : "overview";
  const token = user.token;

  const nav: { key: AdminSection; label: string; icon: LucideIcon }[] = [
    { key: "overview", label: t("admin.nav.overview"), icon: LayoutDashboard },
    { key: "campaigns", label: t("admin.nav.campaigns"), icon: Megaphone },
    { key: "mock", label: t("admin.nav.mock"), icon: Eye },
    { key: "moderation", label: t("admin.nav.moderation"), icon: ShieldAlert },
    { key: "log", label: t("admin.nav.log"), icon: ListChecks },
    { key: "suppression", label: t("admin.nav.suppression"), icon: ShieldOff },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <header>
        <h1 className="text-headline text-foreground">{t("admin.title")}</h1>
        <p className="text-caption text-muted-foreground mt-0.5">{t("admin.sub")}</p>
      </header>

      <div className="grid lg:grid-cols-[248px_minmax(0,1fr)] gap-6 items-start">
        {/* desktop sidebar nav */}
        <nav
          aria-label="Comms Console sections"
          className="hidden lg:block sticky top-28 rounded-card border border-border bg-raised p-3"
        >
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1 border-b border-border/70">
            <Avatar username={user.username} size={34} />
            <div className="min-w-0">
              <p className="text-label font-bold text-foreground truncate">
                {user.profile?.display_name ?? user.username}
              </p>
              <p className="text-caption text-gold-deep truncate font-bold">{t("admin.roleBadge")}</p>
            </div>
          </div>
          <ul className="mt-1 space-y-0.5">
            {nav.map((item) => (
              <NavItem key={item.key} item={item} active={active === item.key} />
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* mobile horizontal scroll tabs */}
          <nav
            aria-label="Comms Console sections"
            className="lg:hidden -mx-4 px-4 overflow-x-auto ts-scrollbar"
          >
            <ul className="flex gap-1.5 w-max pb-1">
              {nav.map((item) => (
                <MobileNavItem key={item.key} item={item} active={active === item.key} />
              ))}
            </ul>
          </nav>

          {active === "overview" && <ConsoleOverview token={token} />}
          {active === "campaigns" && (
            <ConsoleCampaigns token={token} categories={categories} />
          )}
          {active === "mock" && <ConsoleMock token={token} />}
          {active === "moderation" && <ConsoleModeration token={token} />}
          {active === "log" && <ConsoleLog token={token} />}
          {active === "suppression" && <ConsoleSuppression token={token} />}
        </div>
      </div>
    </div>
  );
}

// ── MSCS 12 scaffold: content-only switch for the unified admin shell ──
// Renders the comms section content without the (now shell-owned) nav so the
// 11-c verified internals stay untouched. Called by admin-page.tsx.

export function CommsContent({
  user,
  section,
}: {
  user: CurrentUser;
  section: AdminSection;
}) {
  const { categories } = useCategories();
  const active = ADMIN_SECTIONS.includes(section) ? section : "overview";
  const token = user.token;

  return (
    <>
      {active === "overview" && <ConsoleOverview token={token} />}
      {active === "campaigns" && (
        <ConsoleCampaigns token={token} categories={categories} />
      )}
      {active === "mock" && <ConsoleMock token={token} />}
      {active === "moderation" && <ConsoleModeration token={token} />}
      {active === "log" && <ConsoleLog token={token} />}
      {active === "suppression" && <ConsoleSuppression token={token} />}
    </>
  );
}

// ── nav items (my-page conventions) ───────────────────────────────────

function NavItem({
  item,
  active,
}: {
  item: { key: AdminSection; label: string; icon: LucideIcon };
  active: boolean;
}) {
  const link = useLinkProps(`/admin/${item.key}`);
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
      </a>
    </li>
  );
}

function MobileNavItem({
  item,
  active,
}: {
  item: { key: AdminSection; label: string; icon: LucideIcon };
  active: boolean;
}) {
  const link = useLinkProps(`/admin/${item.key}`);
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
      </a>
    </li>
  );
}

// ── page-level skeleton (auth restoring) ─────────────────────────────

export function AdminPageSkeleton() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-6 space-y-6"
      aria-busy="true"
      aria-label="Loading Comms Console"
    >
      <Skeleton className="h-7 w-56" />
      <div className="grid lg:grid-cols-[248px_minmax(0,1fr)] gap-6 items-start">
        <div className="hidden lg:block rounded-card border border-border bg-raised p-3 space-y-2">
          <Skeleton className="h-11 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
        <div className="space-y-6 min-w-0">
          <div className="flex gap-2 lg:hidden overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-28 rounded-full shrink-0" />
            ))}
          </div>
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-card border border-border bg-raised p-4 space-y-3">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
