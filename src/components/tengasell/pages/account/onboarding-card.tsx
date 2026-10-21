"use client";

// Tengasell — Onboarding checklist card (EXP-009, MSCS 12-e).
// Rendered inside My Tengasell → Overview (the single additive mount line
// in my-sections.tsx). Five honest checks with live data, done/pending
// states + deep links, and a progress chip:
//   1. Profile complete — bio + city set (TrailBase profiles)
//   2. Email verified — comms channel state (lightest honest check:
//      GET /api/comms/links, any verified email channel)
//   3. First bid placed — TrailBase bids
//   4. Item watched — TrailBase watchlist
//   5. Item listed — TrailBase auctions (seller)
// Degrades honestly: a failing check fetch (service down) shows the item
// as pending, never as a fake "done".

import { Check, Gavel, Heart, ListChecks, Mail, Store, UserRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/tengasell/api";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/tengasell/types";

interface CheckItem {
  key: string;
  labelKey: string;
  done: boolean;
  to: string;
  icon: typeof Heart;
}

interface OnboardingData {
  items: CheckItem[];
  done: number;
  total: number;
}

async function loadChecks(user: CurrentUser): Promise<OnboardingData> {
  const [bids, watchlist, selling, linksRes] = await Promise.all([
    api.myBids().catch(() => [] as unknown[]),
    api.watchlist().catch(() => [] as unknown[]),
    api.mySelling().catch(() => [] as unknown[]),
    fetch("/api/comms/links", { headers: { Authorization: `Bearer ${user.token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<{ links?: { channel: string; status: string }[] }>) : { links: [] }))
      .catch(() => ({ links: [] as { channel: string; status: string }[] })),
  ]);
  const links = (linksRes.links ?? []) as { channel: string; status: string }[];
  const profile = user.profile;
  const profileComplete =
    !!profile &&
    !!profile.city.trim() &&
    !!profile.bio.trim() &&
    profile.bio.trim() !== "New to Tengasell.";
  const emailVerified = links.some((l) => l.channel === "email" && l.status === "verified");

  const items: CheckItem[] = [
    {
      key: "profile",
      labelKey: "onboarding.profile",
      done: profileComplete,
      to: "/my/profile",
      icon: UserRound,
    },
    {
      key: "email",
      labelKey: "onboarding.email",
      done: emailVerified,
      to: "/my/communications",
      icon: Mail,
    },
    {
      key: "bid",
      labelKey: "onboarding.bid",
      done: bids.length > 0,
      to: "/search?ending=60",
      icon: Gavel,
    },
    {
      key: "watch",
      labelKey: "onboarding.watch",
      done: watchlist.length > 0,
      to: "/search",
      icon: Heart,
    },
    {
      key: "list",
      labelKey: "onboarding.list",
      done: selling.length > 0,
      to: "/sell/new",
      icon: Store,
    },
  ];
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

export function OnboardingCard({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const state = useResource<OnboardingData>(async () => loadChecks(user), [user.token, user.profile]);
  const data = state.data;

  if (state.loading && !data) {
    return (
      <div className="rounded-card border border-border bg-raised p-4" aria-busy="true" aria-label={t("onboarding.title")}>
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-teal" aria-hidden="true" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ms-auto h-4 w-10" />
        </div>
        <div className="mt-3 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (state.error || !data) return null;

  return (
    <div className="rounded-card border border-border bg-raised p-4" aria-labelledby="onboarding-heading">
      <div className="flex items-center gap-2">
        <ListChecks className="size-4 shrink-0 text-teal" aria-hidden="true" />
        <h3 id="onboarding-heading" className="min-w-0 flex-1 text-label font-bold text-foreground">
          {data.done === data.total ? t("onboarding.allDone") : t("onboarding.title")}
        </h3>
        <span
          className={cn(
            "ts-numeric shrink-0 rounded-full border px-2.5 py-1 text-caption font-bold",
            data.done === data.total ? "border-ok/40 bg-ok/10 text-ok" : "border-teal/40 bg-teal-tint text-teal-deep",
          )}
        >
          {data.done}/{data.total}
        </span>
      </div>
      <ul className="mt-2.5 divide-y divide-border/60">
        {data.items.map((item) => (
          <li key={item.key}>
            <OnboardingRow item={item} />
          </li>
        ))}
      </ul>
      {data.done < data.total && (
        <p className="mt-2.5 flex items-start gap-1.5 text-caption text-muted-foreground">
          <ListChecks className="mt-px size-3.5 shrink-0 text-teal" aria-hidden="true" />
          {t("onboarding.note")}
        </p>
      )}
    </div>
  );
}

function OnboardingRow({ item }: { item: CheckItem }) {
  const { t } = useI18n();
  const link = useLinkProps(item.to);
  const Icon = item.icon;
  return (
    <a
      {...link}
      className="flex min-h-11 items-center gap-2.5 rounded-control px-1 py-1.5 transition-colors hover:bg-accent/40"
      aria-label={`${t(item.labelKey)} — ${item.done ? t("onboarding.done") : t("onboarding.pending")}`}
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full border",
          item.done ? "border-ok/50 bg-ok/10" : "border-border bg-muted",
        )}
        aria-hidden="true"
      >
        {item.done ? (
          <Check className="size-3.5 text-ok" />
        ) : (
          <span className="size-2 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <Icon className={cn("size-4 shrink-0", item.done ? "text-muted-foreground" : "text-teal")} aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate text-body", item.done ? "text-muted-foreground line-through decoration-border" : "font-semibold text-foreground")}>
        {t(item.labelKey)}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-caption font-bold",
          item.done ? "border-ok/40 bg-ok/10 text-ok" : "border-gold-deep/40 bg-gold-soft text-gold-deep",
        )}
      >
        {item.done ? t("onboarding.done") : t("onboarding.pending")}
      </span>
    </a>
  );
}
