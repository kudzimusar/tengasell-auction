"use client";

// Tengasell home page — eBay/Yahoo-Auctions-style marketplace landing.
// Section order: hero (+ how bidding works) → closing soon (live rail) →
// featured → categories → trending/most watched → trust band → sell CTA →
// newly listed. Each async section carries loading/empty/error states.
// I18N-009 (Task 12-d): every section string is localized (home.* keys).

// Gap-8 F3: compact live-room banner rail — shows when a room is live now
// or scheduled within the next 24h; hides itself otherwise.

import { ArrowRight, Bell, Calendar, Clock, Flame, Gavel, Radio, Star } from "lucide-react";
import type { Auction, AuctionEvent, AuctionQuery, LiveSession } from "@/lib/tengasell/types";
import { api } from "@/lib/tengasell/api";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import { getLiveEventDisplay, LiveEventStatusBadge } from "@/components/tengasell/ui";
import { AuctionGridSection } from "./sections";
import { CategoryGrid } from "./category-grid";
import { ClosingSoon } from "./closing-soon";
import { Hero } from "./hero";
import { LinkButton } from "./link-button";
import { SellCta } from "./sell-cta";
import { TrustBand } from "./trust-band";

interface GatewayLiveState {
  liveSession: LiveSession | null;
  linkedEvent: AuctionEvent | null;
  nextSession: LiveSession | null;
  nextEvent: AuctionEvent | null;
  display: ReturnType<typeof getLiveEventDisplay> | null;
}

function resolveGatewayLiveState({
  sessions,
  sessionsLoaded,
  events,
  eventsLoading,
  currentLot,
  lotLoading,
  lotError,
}: {
  sessions: LiveSession[];
  sessionsLoaded: boolean;
  events: AuctionEvent[];
  eventsLoading: boolean;
  currentLot: Auction | null;
  lotLoading: boolean;
  lotError: string | null;
}): GatewayLiveState {
  const liveSession = sessions.find((s) => s.status === "live") ?? null;
  const linkedEvent = liveSession
    ? (events.find((e) => e.id === liveSession.event_id || e.session_id === liveSession.id) ?? null)
    : null;
  const nextSession = sessions
    .filter((s) => s.status === "scheduled")
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0] ?? null;
  const nextEvent = events
    .filter((e) => e.status === "SCHEDULED" || e.status === "LIVE")
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;

  if (liveSession) {
    const eventBacked = liveSession.event_id != null;
    const eventCompatibleStatus = eventBacked
      ? eventsLoading
        ? null
        : (linkedEvent?.status ?? "CLOSED")
      : null;
    const lotReady = Boolean(!lotLoading && !lotError && (!eventBacked || !eventsLoading) && (liveSession.current_lot_id == null || currentLot != null));
    const lotMatchesSession =
      liveSession.current_lot_id == null ||
      (currentLot != null && Number(currentLot.id) === Number(liveSession.current_lot_id));
    const display = getLiveEventDisplay({
      sessionStatus: liveSession.status,
      sessionExists: true,
      sessionLoaded: sessionsLoaded,
      eventBacked,
      eventStatus: eventCompatibleStatus,
      eventLoaded: !eventBacked || !eventsLoading,
      sessionMatchesEvent:
        !eventBacked ||
        !linkedEvent ||
        (linkedEvent.session_id == null || Number(linkedEvent.session_id) === Number(liveSession.id)),
      currentLotId: liveSession.current_lot_id,
      eventCurrentLotId: eventBacked ? (linkedEvent?.current_lot_id ?? null) : undefined,
      lotMatchesSession,
      lotAuctionStatus: currentLot?.status ?? null,
      lotStatus: currentLot?.status ?? null,
      lotLoaded: lotReady,
      dataError: Boolean(lotError),
      requireLotVerification: liveSession.current_lot_id != null,
    });
    return { liveSession, linkedEvent, nextSession, nextEvent, display };
  }

  if (nextEvent || nextSession) {
    return {
      liveSession: null,
      linkedEvent: nextEvent,
      nextSession,
      nextEvent,
      display: getLiveEventDisplay({
        sessionStatus: nextSession ? "scheduled" : null,
        sessionExists: Boolean(nextSession),
        sessionLoaded: sessionsLoaded,
        eventBacked: Boolean(nextEvent),
        eventStatus: nextEvent ? nextEvent.status : null,
        eventLoaded: !eventsLoading,
        currentLotId: null,
        requireLotVerification: false,
      }),
    };
  }

  return {
    liveSession: null,
    linkedEvent: null,
    nextSession: null,
    nextEvent: null,
    display: null,
  };
}

function AuctionModeGateways({
  timedOpenCount,
  timedLoading,
  closingSoonCount,
  liveState,
  locale,
}: {
  timedOpenCount: number | null;
  timedLoading: boolean;
  closingSoonCount: number | null;
  liveState: ReturnType<typeof resolveGatewayLiveState>;
  locale: "en" | "ja";
}) {
  const timedLink = useLinkProps("/search");
  const timedClosingLink = useLinkProps("/search?ending=90");
  const eventsLink = useLinkProps("/events");
  const liveRoomsLink = useLinkProps(liveState.liveSession ? `/live/${liveState.liveSession.id}` : "/live");
  const commsLink = useLinkProps("/my/communications");

  return (
    <section
      aria-label="Choose how you want to bid on Tengasell"
      data-testid="auction-mode-gateways"
      className="border-b border-border bg-canvas py-6"
    >
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
              Two ways to bid on Tengasell
            </h2>
            <p className="text-caption text-muted-foreground">
              Browse individual timed listings at your own pace, or join scheduled auctioneer-led live events.
            </p>
          </div>
          <a
            {...commsLink}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-semibold text-teal hover:bg-teal-tint transition-colors"
          >
            <Bell className="size-4" aria-hidden="true" />
            Communications Centre
          </a>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Permanent Gateway 1: Timed Auctions */}
          <article
            data-testid="gateway-timed-auctions"
            className="flex min-w-0 flex-col rounded-card border border-border bg-raised p-5 shadow-xs transition-colors hover:border-teal/40"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-teal/25 bg-teal/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-teal">
                <Gavel className="size-3.5" aria-hidden="true" />
                Timed Auctions
              </span>
              <span className="inline-flex items-center gap-1 rounded-pill border border-teal/25 bg-teal-tint px-2.5 py-0.5 text-[11px] font-bold text-teal-deep dark:text-teal-soft">
                <Clock className="size-3" aria-hidden="true" />
                Open for Bids
              </span>
            </div>

            <h3 className="mt-3 text-xl font-extrabold tracking-tight text-foreground">
              Bid at Your Pace
            </h3>
            <p className="mt-1.5 text-body text-muted-foreground leading-relaxed">
              Discover vehicles and other items, review the details, and place bids before the auction closes.
            </p>

            <div className="mt-4 rounded-control border border-border bg-background/70 px-3 py-2.5 text-caption text-muted-foreground">
              {timedLoading && timedOpenCount == null ? (
                <span>Checking available timed listings…</span>
              ) : timedOpenCount != null && timedOpenCount > 0 ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <strong className="ts-numeric font-bold text-foreground">
                    {timedOpenCount} Open for Bids
                  </strong>
                  {closingSoonCount != null && closingSoonCount > 0 && (
                    <span className="ts-numeric font-semibold text-warn">
                      · {closingSoonCount} Closing Soon (&lt; 90m)
                    </span>
                  )}
                </span>
              ) : (
                <span>Individual listings open for bids appear here as sellers publish them.</span>
              )}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
              <a
                {...timedLink}
                className="inline-flex min-h-11 items-center gap-2 rounded-control bg-primary px-5 text-label font-bold text-primary-foreground shadow-sm transition hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ring"
              >
                Browse Timed Auctions
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <a
                {...timedClosingLink}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border bg-background px-4 text-label font-semibold text-foreground hover:bg-accent/60 transition-colors"
              >
                <Clock className="size-4 text-warn" aria-hidden="true" />
                Closing Soon
              </a>
            </div>
          </article>

          {/* Permanent Gateway 2: Live Auction Events */}
          <article
            data-testid="gateway-live-events"
            className="flex min-w-0 flex-col rounded-card border border-teal/35 bg-gradient-to-br from-raised to-teal-tint/35 p-5 shadow-xs transition-colors hover:border-teal"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-teal/30 bg-teal-tint px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-teal-deep dark:text-teal-soft">
                <Radio className="size-3.5" aria-hidden="true" />
                Live Auction Events
              </span>
              {liveState.display ? (
                <LiveEventStatusBadge display={liveState.display} />
              ) : (
                <span
                  data-live-state="none_scheduled"
                  className="inline-flex items-center gap-1 rounded-pill border border-border bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground"
                >
                  <Calendar className="size-3" aria-hidden="true" />
                  Event Schedule
                </span>
              )}
            </div>

            <h3 className="mt-3 text-xl font-extrabold tracking-tight text-foreground">
              Experience the Live Bidding Floor
            </h3>
            <p className="mt-1.5 text-body text-muted-foreground leading-relaxed">
              Explore scheduled events, follow the vehicle run list, and join other bidders when the auction begins.
            </p>

            <div className="mt-4 rounded-control border border-border bg-background/80 px-3 py-2.5 text-caption text-muted-foreground">
              {liveState.liveSession ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <strong className="font-semibold text-foreground">{liveState.liveSession.title}</strong>
                  <span>· {liveState.display?.label}</span>
                </span>
              ) : liveState.nextEvent ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <strong className="font-semibold text-foreground">{liveState.nextEvent.title}</strong>
                  <span>· {whenLabel(liveState.nextEvent.starts_at, locale)}</span>
                </span>
              ) : liveState.nextSession ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <strong className="font-semibold text-foreground">{liveState.nextSession.title}</strong>
                  <span>· {whenLabel(liveState.nextSession.scheduled_at, locale)}</span>
                </span>
              ) : (
                <span>
                  No live events are currently scheduled — check the Auction Hub calendar or set notification preferences.
                </span>
              )}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
              <a
                {...eventsLink}
                className="inline-flex min-h-11 items-center gap-2 rounded-control bg-teal-deep px-5 text-label font-bold text-white shadow-sm transition hover:bg-teal focus-visible:outline-2 focus-visible:outline-ring"
              >
                Explore Live Events
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <a
                {...liveRoomsLink}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border bg-background px-4 text-label font-semibold text-foreground hover:bg-accent/60 transition-colors"
              >
                <Radio className="size-4 text-teal" aria-hidden="true" />
                {liveState.liveSession ? "Enter Live Room" : "Live Rooms"}
              </a>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function LiveRoomRail({
  sessions,
  events,
  liveState,
  loading,
  error,
}: {
  sessions: LiveSession[];
  events: AuctionEvent[];
  liveState: ReturnType<typeof resolveGatewayLiveState>;
  loading: boolean;
  error: string | null;
}) {
  const { t, locale } = useI18n();

  const live = liveState.liveSession;
  const upcomingWithin24h = sessions
    .filter((s) => s.status === "scheduled" && Date.parse(s.scheduled_at) - Date.now() < 24 * 3600_000)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const nextEvent = !upcomingWithin24h
    ? events
        .filter((e) => e.status === "SCHEDULED" && Date.parse(e.starts_at) - Date.now() < 24 * 3600_000)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
    : null;

  // hook order must be stable — resolve the link target before the early return
  const link = useLinkProps(
    live ? `/live/${live.id}` : upcomingWithin24h ? `/live/${upcomingWithin24h.id}` : nextEvent ? `/events/${nextEvent.id}` : "/events",
  );

  if (loading || error || (!live && !upcomingWithin24h && !nextEvent)) return null;

  const isLiveNow = !!live && liveState.display?.isAuthoritativeLive === true;
  const isAwaitingLot = !!live && liveState.display?.state === "awaiting_lot";

  const text = live
    ? isAwaitingLot || !isLiveNow
      ? fill(t("home.awaitingBanner"), { title: live.title })
      : fill(t("home.liveBanner"), { title: live.title, n: Math.max(live.lot_index, 1) })
    : upcomingWithin24h
      ? fill(t("home.nextBanner"), {
          title: upcomingWithin24h.title,
          time: whenLabel(upcomingWithin24h.scheduled_at, locale),
        })
      : fill(t("home.nextBanner"), {
          title: nextEvent!.title,
          time: whenLabel(nextEvent!.starts_at, locale),
        });

  const badgeDisplay = live && liveState.display
    ? liveState.display
    : getLiveEventDisplay({ sessionStatus: "scheduled", requireLotVerification: false });

  return (
    <section aria-label={t("home.liveAria")} className="py-3">
      <div className="mx-auto max-w-7xl px-4">
        <a
          {...link}
          className="group flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-teal/30 bg-teal-tint/60 px-4 py-2.5 transition-colors hover:bg-teal-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:bg-teal-tint/30"
        >
          <LiveEventStatusBadge display={badgeDisplay} showOnAir={isLiveNow} />
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">
            {text}
          </span>
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control bg-teal px-4 text-label font-bold text-white transition-colors group-hover:bg-teal-deep">
            {live ? "Enter Live Room" : "Explore Live Events"}
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

const TIMED_SUMMARY_QUERY: AuctionQuery = { status: "live", limit: 1 };
const CLOSING_SUMMARY_QUERY: AuctionQuery = { status: "live", endingWithinMinutes: 90, limit: 1 };

export default function HomePage() {
  const { t, locale } = useI18n();
  const sessionsRes = useResource(() => api.liveSessions(), []);
  const eventsRes = useResource(() => api.auctionEvents(), []);
  const timedRes = useResource(() => api.auctions(TIMED_SUMMARY_QUERY), []);
  const closingRes = useResource(() => api.auctions(CLOSING_SUMMARY_QUERY), []);

  const sessions = sessionsRes.data ?? [];
  const events = eventsRes.data ?? [];
  const liveCandidate = sessions.find((s) => s.status === "live") ?? null;
  const candidateLotId = liveCandidate?.current_lot_id ?? null;

  const currentLotRes = useResource(
    () => (candidateLotId != null ? api.auction(candidateLotId) : Promise.resolve<Auction | null>(null)),
    [candidateLotId],
  );

  const liveState = resolveGatewayLiveState({
    sessions,
    sessionsLoaded: !sessionsRes.loading || Boolean(sessionsRes.data),
    events,
    eventsLoading: eventsRes.loading && !eventsRes.data,
    currentLot: currentLotRes.data ?? null,
    lotLoading: candidateLotId != null && currentLotRes.loading && !currentLotRes.data,
    lotError: currentLotRes.error,
  });

  return (
    <div>
      <Hero />
      <AuctionModeGateways
        timedOpenCount={timedRes.data?.total ?? null}
        timedLoading={timedRes.loading && !timedRes.data}
        closingSoonCount={closingRes.data?.total ?? null}
        liveState={liveState}
        locale={locale}
      />
      <LiveRoomRail
        sessions={sessions}
        events={events}
        liveState={liveState}
        loading={sessionsRes.loading && !sessionsRes.data}
        error={sessionsRes.error}
      />
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
