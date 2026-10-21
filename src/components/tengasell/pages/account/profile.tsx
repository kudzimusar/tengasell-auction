"use client";

// Tengasell — public seller profile (#/u/{username}). Task 5-a.
// api.profile → 404 empty state; header with avatar / verified badge /
// city / member-since / response chip / rating stars; stat band;
// feedback (Yahoo-style, ratee-perspective direction labels); live
// auctions grid; "Contact @user" → #/messages?to={username}.

import type { ReactNode } from "react";
import { LinkButton } from "./auth-shared";
import { responseLabel } from "./my-sections";
import {
  AuctionCard,
  Avatar,
  EmptyState,
  ErrorState,
  LoadingGrid,
  RatingStars,
  SectionHeader,
  VerifiedBadge,
} from "@/components/tengasell/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/tengasell/api";
import { formatRelative } from "@/lib/tengasell/format";
import { useResource } from "@/lib/tengasell/hooks";
import { useAuth } from "@/lib/tengasell/auth";
import { cityInfo } from "@/components/tengasell/map/cities";
import { LocationCard } from "@/components/tengasell/map/location-card";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  MapPin,
  MessageCircle,
  Star,
  Store,
  Timer,
  UserSearch,
} from "lucide-react";

/**
 * `Rating.direction` records the RATER's role in the order
 * ("as_buyer" = the rater was the buyer). On the ratee's public page we
 * show the ratee's own role, so the label is the inverse.
 */
function rateeRoleLabel(direction: string): string {
  return direction === "as_buyer" ? "as seller" : "as buyer";
}

export default function ProfilePage({ username }: { username: string }) {
  const uname = (username || "").trim();
  const { user } = useAuth();

  const prof = useResource(() => api.profile(uname), [uname]);
  const live = useResource(
    () => api.auctions({ seller: uname, status: "live", limit: 12, order: "ending" }),
    [uname],
    { events: ["auction:update", "auction:ended"] },
  );
  const ratings = useResource(() => api.ratingsFor(uname), [uname]);

  // ── loading ───────────────────────────────────────────────────────
  if (prof.loading && !prof.data) {
    return (
      <div
        className="mx-auto max-w-7xl px-4 py-6 space-y-6"
        aria-busy="true"
        aria-label="Loading profile"
      >
        <Skeleton className="h-40 w-full rounded-card" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-card" />
          ))}
        </div>
        <LoadingGrid />
      </div>
    );
  }

  // ── error / not found ─────────────────────────────────────────────
  if (prof.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <ErrorState message={prof.error} onRetry={prof.reload} />
      </div>
    );
  }

  const p = prof.data;
  if (!p) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <EmptyState
          icon={<UserSearch className="size-10" />}
          title="User not found"
          body={`@${uname || "?"} isn't on Tengasell — check the link and try again, or browse what's live right now.`}
          action={<LinkButton to="/search">Browse auctions</LinkButton>}
        />
      </div>
    );
  }

  const isMe = user?.username === p.username;
  const joinedYear = new Date(p.joined_at).getFullYear();
  const ratingList = ratings.data ?? [];
  const liveItems = live.data?.items ?? [];
  // Known marketplace city → rich location card (map + province + directions);
  // otherwise fall back to the plain city chip in the meta row.
  const cityKnown = !!cityInfo(p.city);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-8">
      {/* ── header ────────────────────────────────────────────────── */}
      <section
        aria-labelledby="profile-name"
        className="rounded-card border border-border bg-raised p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start gap-4 sm:gap-5">
          <Avatar username={p.username} size={72} className="rounded-card" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="profile-name" className="text-headline text-foreground">
                {p.display_name}
              </h1>
              {p.verified === 1 && <VerifiedBadge className="size-5" />}
              {isMe && (
                <span className="rounded-full bg-teal-tint px-3 py-1 text-caption font-bold text-teal-deep">
                  This is you
                </span>
              )}
            </div>
            <p className="text-body text-teal font-semibold mt-0.5">@{p.username}</p>
            {p.bio && (
              <p className="text-caption text-muted-foreground mt-1.5 max-w-2xl">{p.bio}</p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-muted-foreground">
              {p.city && !cityKnown && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {p.city}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                Member since {joinedYear}
              </span>
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3.5" aria-hidden="true" />
                Responds in {responseLabel(p.response_minutes)}
              </span>
              <RatingStars value={p.rating_avg} count={p.rating_count} />
            </div>
          </div>
          <div className="shrink-0">
            {isMe ? (
              <LinkButton to="/my" variant="outline">
                My Tengasell
              </LinkButton>
            ) : (
              <LinkButton to={`/messages?to=${encodeURIComponent(p.username)}`}>
                <MessageCircle className="size-4" aria-hidden="true" />
                Contact @{p.username}
              </LinkButton>
            )}
          </div>
        </div>

        {/* location — compact city card (mini Zimbabwe map + directions) */}
        {cityKnown && (
          <div className="mt-4 max-w-md">
            <LocationCard city={p.city} compact />
          </div>
        )}
      </section>

      {/* ── stat band ─────────────────────────────────────────────── */}
      <section aria-label="Seller statistics" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile
          icon={Store}
          label="Sales"
          value={
            <span className="text-headline ts-numeric font-extrabold text-foreground">{p.sales}</span>
          }
          caption="completed orders"
        />
        <StatTile
          icon={Star}
          label="Rating"
          value={
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-headline ts-numeric font-extrabold text-foreground">
                {p.rating_avg.toFixed(1)}
              </span>
              <RatingStars value={p.rating_avg} showCount={false} />
            </span>
          }
          caption={`${p.rating_count} rating${p.rating_count === 1 ? "" : "s"}`}
        />
        <StatTile
          icon={Timer}
          label="Response SLA"
          value={
            <span className="text-headline ts-numeric font-extrabold text-foreground">
              {responseLabel(p.response_minutes)}
            </span>
          }
          caption="average reply time"
        />
      </section>

      {/* ── live auctions ─────────────────────────────────────────── */}
      <section aria-labelledby="profile-live">
        <SectionHeader
          title={<span id="profile-live">Live auctions from @{p.username}</span>}
          subtitle={`${liveItems.length} live listing${liveItems.length === 1 ? "" : "s"} · updated in realtime`}
        />
        {live.loading && !live.data ? (
          <LoadingGrid count={4} />
        ) : live.error ? (
          <ErrorState message={live.error} onRetry={live.reload} />
        ) : liveItems.length === 0 ? (
          <EmptyState
            icon={<Store className="size-10" />}
            title="No live auctions right now"
            body={`@${p.username} has nothing on the block at the moment — check back soon.`}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {liveItems.map((a) => (
              <AuctionCard key={a.id} auction={a} showSeller={false} />
            ))}
          </div>
        )}
      </section>

      {/* ── feedback ──────────────────────────────────────────────── */}
      <section aria-labelledby="profile-feedback">
        <SectionHeader
          title={<span id="profile-feedback">Feedback</span>}
          subtitle={`${ratingList.length} rating${ratingList.length === 1 ? "" : "s"} received · buyers and sellers`}
        />
        {ratings.loading && !ratings.data ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading feedback">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-card border border-border bg-raised p-4 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : ratings.error ? (
          <ErrorState message={ratings.error} onRetry={ratings.reload} />
        ) : ratingList.length === 0 ? (
          <EmptyState
            icon={<Star className="size-10" />}
            title="No feedback yet"
            body={`@${p.username} hasn't received ratings on completed orders yet.`}
          />
        ) : (
          <ul className="max-h-96 overflow-y-auto ts-scrollbar space-y-3 pe-1">
            {ratingList.map((r) => (
              <li key={r.id} className="rounded-card border border-border bg-raised p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <RatingStars value={r.score} showCount={false} />
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-caption font-bold",
                      r.direction === "as_buyer"
                        ? "border-teal/30 bg-teal/10 text-teal-deep"
                        : "border-gold/40 bg-gold/15 text-gold-deep",
                    )}
                  >
                    {rateeRoleLabel(r.direction)}
                  </span>
                  <time
                    title={r.created_at}
                    className="ms-auto text-caption text-muted-foreground"
                  >
                    {formatRelative(r.created_at)}
                  </time>
                </div>
                {r.comment && (
                  <p className="text-body text-foreground mt-2 whitespace-pre-line">{r.comment}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: typeof Store;
  label: string;
  value: ReactNode;
  caption?: string;
}) {
  return (
    <div className="rounded-card border border-border bg-raised p-4">
      <span className="flex items-center gap-1.5 text-caption font-semibold text-muted-foreground">
        <Icon className="size-4 text-teal-soft" aria-hidden="true" />
        {label}
      </span>
      <div className="mt-1.5 min-h-9 flex items-center">{value}</div>
      {caption && <p className="text-caption text-muted-foreground/80 mt-0.5">{caption}</p>}
    </div>
  );
}
