"use client";

// Gap-8 F3: LIVE AUCTION ROOM UI.
//   #/live          schedule board — "Live now" (pulsing radio), "Upcoming"
//                   (localized start time) and "Recently closed" cards, plus
//                   the "Host a room" dialog (api.createLiveRoom).
//   #/live/{id}     the ROOM — big current-lot stage with the
//                   going-going-sold hammer clock (each accepted bid pushes
//                   close_at +20s in the engine), a compact proxy-bid panel
//                   (same automatic-bid explainer as the item page), the
//                   live lot feed (masked bidders), the lot parade sidebar
//                   (hosts remove upcoming lots right there) and — for the
//                   host/admin — the auctioneer console (open room / hammer /
//                   pass / end / add lots).
//
// Realtime: the trade engine broadcasts `room:update {session}` on every
// room mutation and every bid on the open lot (socket.ts forwards it to the
// bus). The room view refetches session+bids on every event and the lot
// list when current_lot_id/status changes; a 10s poll is the fallback when
// the socket is down.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CarFront,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileCheck2,
  Gavel,
  Gauge,
  Hammer,
  Info,
  ListPlus,
  Loader2,
  LogIn,
  MapPin,
  Play,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  UserRound,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { bus, type SocketConnectionState } from "@/lib/tengasell/bus";
import { formatUSD, minNextBid, round2 } from "@/lib/tengasell/format";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import { getConnectionState, rpc } from "@/lib/tengasell/socket";
import {
  toAuctionView,
  type Auction,
  type AuctionVenue,
  type Bid,
  type CurrentUser,
  type LiveSession,
  type VehicleBundle,
} from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";
import {
  AuctionCommsNotice,
  AuctionFollowButton,
  Avatar,
  EmptyState,
  ErrorState,
  getLiveEventDisplay,
  LiveEventStatusBadge,
  LoadingGrid,
  PriceTag,
  SectionHeader,
  StatusPill,
  useNow,
  type LiveEventDisplay,
} from "@/components/tengasell/ui";

// ── local helpers ───────────────────────────────────────────────────────

/** t() has no interpolation — fill "{name}" placeholders client-side. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** Yahoo-style bidder masking for the live feed: "simba" → "si***a".
 *  Same pattern as the item-page bid history helper. */
function maskUser(name: string): string {
  if (!name) return "—";
  if (name.length <= 3) return `${name[0]!}***`;
  return `${name.slice(0, 2)}***${name.slice(-1)}`;
}

type QualificationFloorBundle = {
  qualification?: {
    status?: string | null;
    deposit_state?: string | null;
    credit_state?: string | null;
    reason_code?: string | null;
  } | null;
  capacity?: { available?: number | null } | null;
};

type QualificationFloorState = {
  loaded: boolean;
  bundle: QualificationFloorBundle | null;
};

type BidderStanding = {
  code: "leading" | "outbid" | "watching" | "seller" | "guest";
  tone: "good" | "danger" | "muted" | "warn";
  label: string;
};

function computeBidderStanding(
  user: CurrentUser | null,
  isSeller: boolean,
  bids: Bid[],
): BidderStanding {
  if (isSeller) {
    return { code: "seller", tone: "warn", label: "Seller — cannot bid on own lot" };
  }
  if (!user) {
    return { code: "guest", tone: "muted", label: "Sign in to bid" };
  }
  const matchesUser = (b: Bid) => b.user === user.id || b.bidder_username === user.username;
  const activeBid = bids.find((b) => b.status === "active") ?? null;
  if (activeBid && matchesUser(activeBid)) {
    return { code: "leading", tone: "good", label: "Leading Bidder" };
  }
  if (bids.some((b) => b.status === "superseded" && matchesUser(b))) {
    return { code: "outbid", tone: "danger", label: "Outbid — Increase bid to lead" };
  }
  return { code: "watching", tone: "muted", label: "Watching — Ready to Bid" };
}

function formatReserveDisclosure(lot: Auction): string {
  if (lot.reserve_disclosure === "NO_RESERVE") return "No reserve";
  if (lot.reserve_disclosure === "RESERVE_APPLIES") return "Reserve applies";
  if (lot.reserve_disclosure === "UPSET_APPLIES") return "Upset price applies";
  return "Reserve disclosure pending";
}

/** Engine live-room broadcast payload. The shared bus EventMap predates
 *  "room:update" (bus.ts is orchestrator-owned) — subscribe through a
 *  typed widening shim, same pattern as the F2 offer:update subscription. */
function onRoomUpdate(handler: (p: { session?: LiveSession | null }) => void): () => void {
  return (
    bus as unknown as {
      on: (e: string, h: (p: { session?: LiveSession | null }) => void) => () => void;
    }
  ).on("room:update", handler);
}

/** Localized session start time (EN-GB / JA-JP). */
function whenLabel(iso: string, locale: "en" | "ja"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(locale === "ja" ? "ja-JP" : "en-GB");
}

// ── page entry ─────────────────────────────────────────────────────────

export default function LiveRoomPage({ sessionId }: { sessionId?: number }) {
  const valid = sessionId != null && Number.isFinite(sessionId);
  return valid ? <LiveRoom sessionId={Number(sessionId)} /> : <LiveBoard />;
}

// ═══════════════════════════════ BOARD ══════════════════════════════════

function LiveBoard() {
  const { t, locale } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const navigate = useRouter().navigate;
  const res = useResource(() => api.liveSessions(), []);
  const eventsRes = useResource(() => api.auctionEvents(), []);

  const [hostOpen, setHostOpen] = useState(false);

  const sessions = res.data ?? [];
  const events = eventsRes.data ?? [];

  // lot metadata per room (one small fetch per session; few sessions exist)
  const [lotMeta, setLotMeta] = useState<
    Record<number, { total: number; currentLotStatus: string | null; loaded: boolean; error?: boolean }>
  >({});
  const sessionData = res.data;
  useEffect(() => {
    if (!sessionData || sessionData.length === 0) return;
    let alive = true;
    void Promise.all(
      sessionData.map(async (s) => {
        try {
          const lots = await api.roomLots(s.id);
          const current =
            s.current_lot_id != null ? (lots.find((l) => l.id === s.current_lot_id) ?? null) : null;
          return [
            s.id,
            { total: lots.length, currentLotStatus: current?.status ?? null, loaded: true, error: false },
          ] as const;
        } catch {
          return [s.id, { total: 0, currentLotStatus: null, loaded: true, error: true }] as const;
        }
      }),
    ).then((pairs) => {
      if (alive) setLotMeta(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [sessionData]);

  const sessionEntries = useMemo(() => {
    return sessions.map((s) => {
      const linkedEvent =
        s.event_id != null ? (events.find((e) => Number(e.id) === Number(s.event_id)) ?? null) : null;
      const meta = lotMeta[s.id];
      const eventLoaded = s.event_id == null || (!eventsRes.loading && (Boolean(eventsRes.data) || Boolean(eventsRes.error)));
      const eventStatus = s.event_id != null ? (linkedEvent?.status ?? (eventLoaded ? "CLOSED" : null)) : null;
      const lotMatchesSession =
        s.event_id == null ||
        s.current_lot_id == null ||
        Boolean(linkedEvent?.current_lot_id != null);
      const display = getLiveEventDisplay({
        sessionStatus: s.status,
        sessionExists: true,
        sessionLoaded: !res.loading,
        eventBacked: s.event_id != null,
        eventStatus,
        eventLoaded,
        sessionMatchesEvent:
          s.event_id == null ||
          !linkedEvent ||
          (linkedEvent.session_id == null || Number(linkedEvent.session_id) === Number(s.id)),
        currentLotId: s.current_lot_id,
        eventCurrentLotId: s.event_id != null ? (linkedEvent?.current_lot_id ?? null) : undefined,
        lotMatchesSession,
        lotAuctionStatus: meta?.currentLotStatus ?? null,
        lotStatus: meta?.currentLotStatus ?? null,
        lotLoaded: Boolean(meta?.loaded && eventLoaded),
        dataError: Boolean(meta?.error || res.error || (s.event_id != null && eventsRes.error)),
        requireLotVerification: s.current_lot_id != null,
      });
      return { session: s, display, total: meta?.total ?? 0 };
    });
  }, [sessions, events, eventsRes.loading, eventsRes.data, eventsRes.error, res.loading, res.error, lotMeta]);

  const liveNow = sessionEntries.filter((e) => e.display.isAuthoritativeLive);
  const awaitingRoom = sessionEntries.filter(
    (e) =>
      !e.display.isAuthoritativeLive &&
      (e.display.state === "awaiting_lot" || e.display.state === "checking" || e.display.state === "sync_mismatch"),
  );
  const upcoming = sessionEntries.filter((e) => e.display.state === "upcoming");
  const closed = sessionEntries
    .filter((e) => e.display.state === "completed" || e.display.state === "cancelled")
    .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at));

  const openHostDialog = () => {
    if (!user && !authLoading) {
      navigate("/signin");
      return;
    }
    setHostOpen(true);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <section className="rounded-card border border-border bg-raised">
        <SectionHeader
          icon={<Radio className="size-5 text-teal" aria-hidden="true" />}
          title={t("live.title")}
          subtitle={t("live.subtitle")}
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="min-h-11">
                <a href="#/search">
                  <Gavel className="size-4" aria-hidden="true" />
                  Timed Auctions
                </a>
              </Button>
              <Button asChild variant="outline" className="min-h-11">
                <a href="#/events">
                  <CalendarClock className="size-4" aria-hidden="true" />
                  Auction Hub
                </a>
              </Button>
              <Button onClick={openHostDialog} className="min-h-11">
                <ListPlus className="size-4" aria-hidden="true" />
                {t("live.board.host")}
              </Button>
            </div>
          }
        />
        {res.loading && !res.data ? (
          <div className="p-4">
            <span role="status" className="sr-only">
              {t("state.loading")}
            </span>
            <LoadingGrid count={4} />
          </div>
        ) : res.error && !res.data ? (
          <div className="p-4">
            <ErrorState message={res.error} onRetry={res.reload} />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<Radio className="size-10" aria-hidden="true" />}
            title={t("live.empty")}
            body={t("live.emptyHint")}
            action={
              <Button onClick={openHostDialog} className="min-h-11">
                <ListPlus className="size-4" aria-hidden="true" />
                {t("live.board.host")}
              </Button>
            }
          />
        ) : (
          <div className="space-y-6 p-4">
            {liveNow.length > 0 && (
              <BoardGroup title={t("live.board.liveNow")} accent="text-urgent" dot pulse>
                {liveNow.map(({ session, display, total }) => (
                  <SessionCard key={session.id} session={session} total={total} display={display} />
                ))}
              </BoardGroup>
            )}
            {awaitingRoom.length > 0 && (
              <BoardGroup title="Room Open — Awaiting Next Lot" accent="text-warn-foreground">
                {awaitingRoom.map(({ session, display, total }) => (
                  <SessionCard key={session.id} session={session} total={total} display={display} />
                ))}
              </BoardGroup>
            )}
            {upcoming.length > 0 && (
              <BoardGroup title={t("live.board.upcoming")} accent="text-teal">
                {upcoming.map(({ session, display, total }) => (
                  <SessionCard key={session.id} session={session} total={total} display={display} />
                ))}
              </BoardGroup>
            )}
            {closed.length > 0 && (
              <BoardGroup title={t("live.board.closed")} accent="text-muted-foreground">
                {closed.slice(0, 6).map(({ session, display, total }) => (
                  <SessionCard key={session.id} session={session} total={total} display={display} muted />
                ))}
              </BoardGroup>
            )}
          </div>
        )}
      </section>

      <AuctionCommsNotice context="live" testId="live-board-comms-banner" />

      <HostRoomDialog open={hostOpen} onOpenChange={setHostOpen} locale={locale} />
    </div>
  );
}

function BoardGroup({
  title,
  accent,
  dot = false,
  pulse = false,
  children,
}: {
  title: string;
  accent: string;
  dot?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h3 className={cn("mb-2 flex items-center gap-2 text-label font-bold tracking-tight", accent)}>
        {dot && (
          <span
            className={cn("size-2 rounded-full bg-urgent", pulse && "motion-safe:animate-pulse")}
            aria-hidden="true"
          />
        )}
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function SessionCard({
  session,
  total,
  display,
  muted = false,
}: {
  session: LiveSession;
  total: number;
  display: LiveEventDisplay;
  muted?: boolean;
}) {
  const { t, locale } = useI18n();
  const link = useLinkProps(`#/live/${session.id}`);
  const live = display.isAuthoritativeLive;

  const lotLine =
    session.lot_index > 0
      ? fill(t("live.board.lotOf"), {
          n: session.lot_index,
          total: Math.max(total, session.lot_index),
        })
      : fill(t("room.lotsCount"), { n: total });

  return (
    <a
      {...link}
      className={cn(
        "group block rounded-card border border-border bg-raised p-4 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        live
          ? "border-teal/40 hover:border-teal hover:shadow-md"
          : muted
            ? "opacity-80 hover:opacity-100"
            : "hover:border-teal/40 hover:shadow-sm",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <LiveEventStatusBadge display={display} showOnAir={display.isAuthoritativeLive} />
        <span className="ms-auto inline-flex min-w-0 items-center gap-1 truncate text-caption text-muted-foreground">
          {session.status === "scheduled" ? (
            <>
              <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
              {whenLabel(session.scheduled_at, locale)}
            </>
          ) : (
            <span className="ts-numeric truncate">{lotLine}</span>
          )}
        </span>
      </div>
      <p className="mt-2 line-clamp-1 text-bodyStrong font-bold text-foreground">{session.title}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Avatar username={session.host_username} size={18} />
        <span className="truncate text-caption text-muted-foreground">
          {t("live.board.hostedBy")}{" "}
          <span className="font-semibold text-foreground">{session.host_username}</span>
        </span>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control px-4 text-label font-bold transition",
          live
            ? "bg-teal text-white group-hover:bg-teal-deep"
            : "border border-border text-foreground group-hover:bg-accent/60",
        )}
      >
        {display.ctaLabel}
        <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </a>
  );
}

// ── "Host a room" dialog (board only) ───────────────────────────────────

function HostRoomDialog({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  locale: "en" | "ja";
}) {
  const { t } = useI18n();
  const navigate = useRouter().navigate;
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle("");
    setWhen("");
    setError(null);
    setBusy(false);
  };

  const submit = async () => {
    if (busy) return;
    const clean = title.trim();
    if (clean.length < 3) {
      setError(t("live.new.needTitle"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scheduledAt = when ? new Date(when).toISOString() : undefined;
      const room = await api.createLiveRoom({ title: clean, scheduledAt });
      toast({ title: t("live.new.created"), description: room.title });
      onOpenChange(false);
      reset();
      navigate(`/live/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("state.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-5 text-teal" aria-hidden="true" />
            {t("live.new.title")}
          </DialogTitle>
          <DialogDescription>{t("live.new.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ts-live-room-title" className="text-label">
              {t("live.new.nameLabel")}
            </Label>
            <Input
              id="ts-live-room-title"
              value={title}
              maxLength={120}
              autoComplete="off"
              placeholder={t("live.new.namePlaceholder")}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              className="min-h-11"
              aria-invalid={!!error}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ts-live-room-when" className="text-label">
              {t("live.new.whenLabel")}
            </Label>
            <Input
              id="ts-live-room-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="min-h-11"
            />
            {when ? (
              <p className="text-caption text-muted-foreground">
                {whenLabel(new Date(when).toISOString(), locale)}
              </p>
            ) : null}
          </div>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption text-danger"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="font-medium">{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
            variant="outline"
            className="min-h-11"
          >
            {t("action.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy} className="min-h-11">
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("state.loading")}
              </>
            ) : (
              <>
                <Gavel className="size-4" aria-hidden="true" /> {t("live.new.submit")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════ ROOM ══════════════════════════════════

function LiveRoom({ sessionId }: { sessionId: number }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const backLink = useLinkProps("/live");

  // tick → session + bids of the current lot; lotTick → the lot list too.
  const [tick, setTick] = useState(0);
  const [lotTick, setLotTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  const bumpLots = useCallback(() => setLotTick((n) => n + 1), []);

  const bestLotSnapshotRef = useRef<Map<number, Auction>>(new Map());
  const bestBidsSnapshotRef = useRef<Map<number, Bid[]>>(new Map());

  const sessionRes = useResource(() => api.liveSession(sessionId), [sessionId, tick, lotTick]);
  // "auction:update" fires on every accepted bid (room lots included) —
  // keeps the stage price/bid count live between lot changes.
  const lotsRes = useResource(
    async () => {
      const rows = await api.roomLots(sessionId);
      return rows.map((row) => {
        const prev = bestLotSnapshotRef.current.get(row.id);
        if (prev && prev.status === "live" && row.status === "live") {
          if (row.bid_count < prev.bid_count || row.current_price < prev.current_price) {
            return prev;
          }
        }
        bestLotSnapshotRef.current.set(row.id, row);
        return row;
      });
    },
    [sessionId, lotTick],
    {
      events: ["auction:update"],
    },
  );

  const session = sessionRes.data ?? null;
  const eventBacked = session?.event_id != null;
  const eventBundleRes = useResource(
    () =>
      session?.event_id != null
        ? api.auctionEventBundle(Number(session.event_id))
        : Promise.resolve(null),
    [session?.event_id, tick, lotTick],
  );
  const lots = useMemo(
    () => eventBacked
      ? [...(lotsRes.data ?? [])]
      : [...(lotsRes.data ?? [])].sort((a, b) => a.id - b.id),
    [lotsRes.data, eventBacked],
  );
  const currentLotId = session?.current_lot_id ?? null;
  const currentLot = currentLotId != null ? lots.find((l) => l.id === currentLotId) ?? null : null;
  const currentLotIdx = currentLot != null ? lots.findIndex((l) => l.id === currentLot.id) : -1;
  const nextUpLot = useMemo(() => {
    if (lots.length === 0) return null;
    if (currentLotIdx >= 0) {
      return lots.slice(currentLotIdx + 1).find((l) => l.status === "live") ?? null;
    }
    return lots.find((l) => l.id !== currentLotId && l.status === "live") ?? null;
  }, [lots, currentLotIdx, currentLotId]);

  const [socketState, setSocketState] = useState<SocketConnectionState>(() => getConnectionState());
  const [socketReconnecting, setSocketReconnecting] = useState(false);
  const wasSocketConnectedRef = useRef(getConnectionState() === "connected");
  useEffect(() => {
    return bus.on("connection:changed", ({ connected, reconnecting, state }) => {
      const nextState: SocketConnectionState =
        state ?? (connected ? "connected" : reconnecting ? "reconnecting" : "disconnected");
      setSocketState(nextState);
      if (connected) {
        wasSocketConnectedRef.current = true;
        setSocketReconnecting(false);
        bump();
        bumpLots();
      } else if (wasSocketConnectedRef.current || reconnecting) {
        setSocketReconnecting(true);
      }
    });
  }, [bump, bumpLots]);

  const vehicleRes = useResource(
    async (): Promise<VehicleBundle | null> => {
      if (!currentLot) return null;
      try {
        return await api.vehicleForAuction(currentLot.id);
      } catch {
        return null;
      }
    },
    [currentLot?.id, lotTick],
  );

  const qualificationRes = useResource(
    async (): Promise<QualificationFloorState> => {
      if (!session?.event_id || !user) {
        return { loaded: false, bundle: null };
      }
      try {
        const response = await rpc<{ ok: boolean; bundle?: QualificationFloorBundle }>(
          "qualification:bundle",
          { eventId: Number(session.event_id) },
        );
        return { loaded: Boolean(response?.ok), bundle: response?.bundle ?? null };
      } catch {
        return { loaded: false, bundle: null };
      }
    },
    [session?.event_id, user?.id, tick],
  );

  const associatedEvent = eventBacked ? (eventBundleRes.data?.event ?? null) : null;
  const associatedVenue: AuctionVenue | null = eventBacked ? (eventBundleRes.data?.venue ?? null) : null;
  const associatedLotRecord =
    eventBacked && associatedEvent?.current_lot_id != null
      ? (eventBundleRes.data?.lots.find((l) => l.id === associatedEvent.current_lot_id) ?? null)
      : null;
  const eventLoaded =
    !eventBacked || Boolean((eventBundleRes.data || eventBundleRes.error) && !eventBundleRes.loading);
  const dataStaleOrErrored = Boolean(
    sessionRes.error || lotsRes.error || (eventBacked && eventBundleRes.error),
  );
  const sessionMatchesEvent = Boolean(
    !eventBacked ||
      !associatedEvent ||
      ((session?.event_id == null || Number(session.event_id) === Number(associatedEvent.id)) &&
        (associatedEvent.session_id == null ||
          Number(associatedEvent.session_id) === Number(session?.id))),
  );
  const lotMatchesSession = Boolean(
    currentLot != null &&
      session?.current_lot_id != null &&
      Number(currentLot.id) === Number(session.current_lot_id) &&
      (!eventBacked ||
        (associatedLotRecord != null &&
          Number(associatedLotRecord.auction_id) === Number(session.current_lot_id))),
  );
  const lotsAndEventLoaded = Boolean(!lotsRes.loading && !lotsRes.error && eventLoaded);
  const roomDisplay = session
    ? getLiveEventDisplay({
        sessionStatus: session.status,
        sessionExists: true,
        sessionLoaded: !sessionRes.loading,
        eventBacked,
        eventStatus: eventBacked ? (associatedEvent?.status ?? (eventLoaded ? "CLOSED" : null)) : null,
        eventLoaded,
        sessionMatchesEvent,
        currentLotId: session.current_lot_id,
        eventCurrentLotId: eventBacked ? (associatedEvent?.current_lot_id ?? null) : undefined,
        lotMatchesSession: session.current_lot_id == null ? true : lotMatchesSession,
        eventLotStatus: associatedLotRecord?.status ?? null,
        lotAuctionStatus: currentLot?.status ?? null,
        lotStatus: currentLot?.status ?? null,
        lotLoaded: lotsAndEventLoaded,
        reconnecting: socketReconnecting,
        stale: dataStaleOrErrored,
        dataError: dataStaleOrErrored,
        requireLotVerification: session.current_lot_id != null,
      })
    : null;

  const bidsRes = useResource(
    async () => {
      if (currentLotId == null) return [] as Bid[];
      const fetched = await api.bids(currentLotId);
      const prevLot = bestLotSnapshotRef.current.get(currentLotId);
      const prevBids = bestBidsSnapshotRef.current.get(currentLotId);
      if (prevBids && prevLot?.status === "live" && fetched.length < prevBids.length) {
        return prevBids;
      }
      bestBidsSnapshotRef.current.set(currentLotId, fetched);
      return fetched;
    },
    [currentLotId, tick, lotTick],
  );
  const bids = useMemo(
    () => [...(bidsRes.data ?? [])].sort((a, b) => b.id - a.id),
    [bidsRes.data],
  );

  const firstLoad = (sessionRes.loading && !sessionRes.data) || (lotsRes.loading && !lotsRes.data);

  // Realtime: engine `room:update` → refetch session + current-lot bids;
  // when the open lot or the room status changes, refetch the parade too.
  const lastLotKey = useRef<string>("");
  useEffect(() => {
    const off = onRoomUpdate((p) => {
      const s = p?.session;
      const key = s ? `${s.status}:${s.current_lot_id ?? "none"}` : null;
      if (key && key !== lastLotKey.current) {
        lastLotKey.current = key;
        bumpLots();
        return;
      }
      bump();
    });
    return off;
  }, [bump, bumpLots]);

  const sessionStatus = session?.status;
  const sessionLotId = session?.current_lot_id;
  useEffect(() => {
    if (session) lastLotKey.current = `${session.status}:${session.current_lot_id ?? "none"}`;
  }, [sessionStatus, sessionLotId]);

  // Poll fallback (socket can drop): session+bids every 10s, parade every 30s.
  useEffect(() => {
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      if (n % 3 === 0) bumpLots();
      else bump();
    }, 10_000);
    return () => clearInterval(timer);
  }, [bump, bumpLots]);

  const isHost = !!user && !!session && (user.id === session.host_user || user.admin);

  // host removal of upcoming lots from the parade (api.removeRoomLot)
  const [removing, setRemoving] = useState<Set<number>>(new Set());
  const [removeError, setRemoveError] = useState<string | null>(null);
  const removeLot = useCallback(
    async (auctionId: number) => {
      if (removing.has(auctionId)) return;
      setRemoving((prev) => new Set(prev).add(auctionId));
      setRemoveError(null);
      try {
        await api.removeRoomLot(sessionId, auctionId);
        toast({ title: t("room.host.removedToast") });
        bump();
        bumpLots();
      } catch (err) {
        setRemoveError(err instanceof Error ? err.message : t("state.error"));
      } finally {
        setRemoving((prev) => {
          const next = new Set(prev);
          next.delete(auctionId);
          return next;
        });
      }
    },
    [removing, sessionId, t, bump, bumpLots],
  );

  if (firstLoad) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <span role="status" className="sr-only">
          {t("state.loading")}
        </span>
        <LoadingGrid count={4} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-4">
        <a
          {...backLink}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-bold text-teal transition-colors hover:bg-teal-tint focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("room.backBoard")}
        </a>
        <div className="rounded-card border border-border bg-raised">
          <EmptyState
            icon={<Radio className="size-10" aria-hidden="true" />}
            title={t("room.notFound")}
            action={
              <Button asChild className="min-h-11">
                <a {...backLink}>{t("room.backBoard")}</a>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const syncStatus: "unavailable" | "reconnecting" | "connected" | "updates_delayed" =
    dataStaleOrErrored
      ? "unavailable"
      : socketReconnecting || socketState === "reconnecting"
        ? "reconnecting"
        : socketState === "connected"
          ? "connected"
          : "updates_delayed";

  const lotPosition = currentLotIdx >= 0 ? currentLotIdx + 1 : Math.max(0, session.lot_index || 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 space-y-4">
      {/* slim top strip: back + room status + event link + sync telemetry */}
      <div className="flex flex-wrap items-center gap-2">
        <a
          {...backLink}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-bold text-teal transition-colors hover:bg-teal-tint focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("room.backBoard")}
        </a>
        {roomDisplay ? (
          <LiveEventStatusBadge display={roomDisplay} showOnAir={roomDisplay.isAuthoritativeLive} />
        ) : null}
        {session.event_id != null ? (
          <Button asChild variant="outline" size="sm" className="min-h-10">
            <a href={`#/events/${session.event_id}`}>
              <ListPlus className="size-4" aria-hidden="true" />
              Run List
            </a>
          </Button>
        ) : null}
        {session.event_id != null ? (
          <AuctionFollowButton
            targetType="event"
            targetId={session.event_id}
            eventId={session.event_id}
            sessionId={session.id}
            title={event?.title ?? session.title}
            startsAt={event?.starts_at}
            testId="live-room-follow-event-btn"
            size="sm"
            compact
          />
        ) : null}
        <span
          data-testid="live-sync-banner"
          data-sync-state={syncStatus}
          role={syncStatus === "unavailable" || syncStatus === "reconnecting" ? "alert" : "status"}
          className={cn(
            "ms-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-caption font-semibold",
            syncStatus === "connected" && "border-teal/30 bg-teal-tint/60 text-teal-deep dark:text-teal",
            syncStatus === "reconnecting" && "border-warn/40 bg-warn/15 text-warn-foreground",
            syncStatus === "unavailable" && "border-danger/40 bg-danger/10 text-danger",
            syncStatus === "updates_delayed" && "border-border bg-muted/60 text-muted-foreground",
          )}
        >
          {syncStatus === "connected" ? (
            <Wifi className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {syncStatus === "connected"
              ? "Realtime Floor Connected"
              : syncStatus === "reconnecting"
                ? "Reconnecting to live bidding floor…"
                : syncStatus === "unavailable"
                  ? "Live updates unavailable"
                  : "Live updates via polling sync"}
          </span>
          {(syncStatus === "unavailable" || syncStatus === "updates_delayed") && (
            <button
              type="button"
              onClick={() => {
                bump();
                bumpLots();
              }}
              className="ms-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-bold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              Sync
            </button>
          )}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── left 2/3 — stage + lot feed ─────────────────────────── */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <LotStage
            session={session}
            eventTitle={associatedEvent?.title ?? null}
            venue={associatedVenue}
            lot={currentLot}
            lotPosition={lotPosition}
            totalLots={lots.length}
            nextUpLot={nextUpLot}
            vehicleBundle={vehicleRes.data ?? null}
            qualificationState={qualificationRes.data ?? { loaded: false, bundle: null }}
            display={roomDisplay}
            eventLotStatus={associatedLotRecord?.status ?? null}
            lotLoaded={lotsAndEventLoaded}
            sessionLoading={sessionRes.loading && !sessionRes.data}
            reconnecting={socketReconnecting}
            dataStale={dataStaleOrErrored}
            bids={bids}
            bidsLoading={bidsRes.loading && !bidsRes.data}
            user={user}
            onChanged={bump}
          />
        </div>

        {/* ── right 1/3 — room info, parade, presence ────────────── */}
        <div className="min-w-0 space-y-4">
          <section aria-label={session.title} className="rounded-card border border-border bg-raised p-4">
            <h2 className="text-bodyStrong font-bold leading-snug text-foreground">
              {associatedEvent?.title ?? session.title}
            </h2>
            <div className="mt-2 flex items-center gap-1.5">
              <Avatar username={session.host_username} size={20} />
              <span className="text-caption text-muted-foreground">
                {t("room.host")}:{" "}
                <span className="font-semibold text-foreground">{session.host_username}</span>
              </span>
            </div>
            {associatedVenue ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-caption text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                {associatedVenue.name}
                {associatedVenue.city ? ` · ${associatedVenue.city}` : ""}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {roomDisplay ? <LiveEventStatusBadge display={roomDisplay} /> : null}
              <span className="ts-numeric text-caption text-muted-foreground">
                {session.lot_index > 0
                  ? fill(t("live.board.lotOf"), { n: session.lot_index, total: lots.length })
                  : fill(t("room.lotsCount"), { n: lots.length })}
              </span>
            </div>
            {session.status === "scheduled" && (
              <p className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
                <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                {whenLabel(session.scheduled_at, locale)}
              </p>
            )}
          </section>

          <AuctionCommsNotice context="live" compact testId="live-room-comms-banner" />

          <LotParade
            session={session}
            lots={lots}
            loading={lotsRes.loading && !lotsRes.data}
            bids={bids}
            isHost={isHost}
            removing={removing}
            onRemove={removeLot}
            removeError={removeError}
          />
        </div>
      </div>

      {isHost && (
        <HostConsole
          session={session}
          currentLot={currentLot}
          bids={bids}
          onChanged={() => {
            bump();
            bumpLots();
          }}
        />
      )}
    </div>
  );
}

// ── current-lot stage ──────────────────────────────────────────────────

function LotStage({
  session,
  eventTitle = null,
  venue = null,
  lot,
  lotPosition = 0,
  totalLots = 0,
  nextUpLot = null,
  vehicleBundle = null,
  qualificationState = { loaded: false, bundle: null },
  display,
  eventLotStatus = null,
  lotLoaded,
  sessionLoading,
  reconnecting = false,
  dataStale = false,
  bids,
  bidsLoading,
  user,
  onChanged,
}: {
  session: LiveSession;
  eventTitle?: string | null;
  venue?: AuctionVenue | null;
  lot: Auction | null;
  lotPosition?: number;
  totalLots?: number;
  nextUpLot?: Auction | null;
  vehicleBundle?: VehicleBundle | null;
  qualificationState?: QualificationFloorState;
  display: LiveEventDisplay | null;
  eventLotStatus?: string | null;
  lotLoaded: boolean;
  sessionLoading: boolean;
  reconnecting?: boolean;
  dataStale?: boolean;
  bids: Bid[];
  bidsLoading: boolean;
  user: CurrentUser | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();

  const canBidAuthoritatively = Boolean(
    display?.isAuthoritativeLive === true &&
      display?.state === "live_bidding" &&
      session.status === "live" &&
      lot != null &&
      lot.status === "live" &&
      !reconnecting &&
      !dataStale,
  );

  const body = (() => {
    if (sessionLoading) {
      return (
        <div className="space-y-4 p-4" aria-busy="true">
          <div className="h-44 rounded-control bg-muted motion-safe:animate-pulse" />
          <div className="h-8 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
          <div className="h-12 rounded bg-muted motion-safe:animate-pulse" />
        </div>
      );
    }
    if (display?.state === "cancelled") {
      return (
        <EmptyState
          icon={<XCircle className="size-10 text-danger" aria-hidden="true" />}
          title="Event Cancelled"
          body="This live auction event has been cancelled. Bidding is closed."
        />
      );
    }
    if (session.status === "closed" || display?.state === "completed") {
      return (
        <EmptyState
          icon={<Gavel className="size-10" aria-hidden="true" />}
          title={t("room.closedNote")}
        />
      );
    }
    if (session.status === "scheduled" || display?.state === "upcoming") {
      return (
        <EmptyState
          icon={<CalendarClock className="size-10" aria-hidden="true" />}
          title={t("room.scheduledNote")}
        />
      );
    }
    if (reconnecting || dataStale) {
      return (
        <EmptyState
          icon={<AlertTriangle className="size-10 text-warn" aria-hidden="true" />}
          title="Reconnecting to live bidding floor"
          body="Official state is being synchronized before live bidding can proceed."
        />
      );
    }
    if (display?.state === "sync_mismatch") {
      return (
        <EmptyState
          icon={<AlertTriangle className="size-10 text-warn" aria-hidden="true" />}
          title="Status temporarily unavailable"
          body="This live room is waiting for synchronized event, session, and lot status before bidding opens."
        />
      );
    }
    if (display?.state === "checking" || (session.current_lot_id != null && (!lot || !lotLoaded))) {
      return (
        <EmptyState
          icon={<Clock className="size-10 text-teal" aria-hidden="true" />}
          title="Verifying live floor state"
          body="Checking the official session, event, and current lot state before enabling bidding."
        />
      );
    }
    if (!lot || display?.state === "awaiting_lot") {
      return (
        <EmptyState
          icon={<Hammer className="size-10 text-warn" aria-hidden="true" />}
          title="Room Open — Awaiting Next Lot"
          body={t("room.waiting")}
        />
      );
    }
    return (
      <LotStageBody
        session={session}
        eventTitle={eventTitle}
        venue={venue}
        lot={lot}
        lotPosition={lotPosition}
        totalLots={totalLots}
        nextUpLot={nextUpLot}
        vehicleBundle={vehicleBundle}
        qualificationState={qualificationState}
        display={display}
        eventLotStatus={eventLotStatus}
        canBid={canBidAuthoritatively}
        bids={bids}
        bidsLoading={bidsLoading}
        user={user}
        onChanged={onChanged}
      />
    );
  })();

  return (
    <article
      aria-label={lot ? lot.title : t("live.title")}
      className="overflow-hidden rounded-card border border-border bg-raised"
    >
      {body}
    </article>
  );
}

function LotStageBody({
  session,
  eventTitle = null,
  venue = null,
  lot,
  lotPosition = 0,
  totalLots = 0,
  nextUpLot = null,
  vehicleBundle = null,
  qualificationState = { loaded: false, bundle: null },
  display = null,
  eventLotStatus = null,
  canBid,
  bids,
  bidsLoading,
  user,
  onChanged,
}: {
  session: LiveSession;
  eventTitle?: string | null;
  venue?: AuctionVenue | null;
  lot: Auction;
  lotPosition?: number;
  totalLots?: number;
  nextUpLot?: Auction | null;
  vehicleBundle?: VehicleBundle | null;
  qualificationState?: QualificationFloorState;
  display?: LiveEventDisplay | null;
  eventLotStatus?: string | null;
  canBid: boolean;
  bids: Bid[];
  bidsLoading: boolean;
  user: CurrentUser | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const itemLink = useLinkProps(`#/item/${lot.id}`);
  const v = toAuctionView(lot);
  const [photoSelection, setPhotoSelection] = useState<{ lotId: number; index: number }>({
    lotId: lot.id,
    index: 0,
  });
  const [specsOpen, setSpecsOpen] = useState(false);

  const rawIndex = photoSelection.lotId === lot.id ? photoSelection.index : 0;
  const activePhotoIndex =
    rawIndex >= 0 && rawIndex < v.imageList.length ? rawIndex : 0;
  const img = v.imageList[activePhotoIndex];

  const isSeller = !!user && user.username === lot.seller_username;
  const activeBid = bids.find((b) => b.status === "active") ?? null;
  const min = minNextBid(lot.current_price, lot.bid_count);
  const standing = computeBidderStanding(user, isSeller, bids);

  const vehicle = vehicleBundle?.vehicle ?? null;
  const inspection = vehicleBundle?.inspection ?? null;
  const findings = vehicleBundle?.findings ?? [];
  const documents = vehicleBundle?.documents ?? [];
  const verifiedDocsCount = documents.filter((d) => d.status === "VERIFIED").length;
  const criticalFindingsCount = findings.filter(
    (f) => f.severity === "CRITICAL" || f.severity === "MAJOR" || f.safety_critical === 1,
  ).length;
  const vehicleHeading = vehicle
    ? `${vehicle.model_year} ${vehicle.make} ${vehicle.model}${vehicle.variant ? ` ${vehicle.variant}` : ""}`
    : lot.title;
  const lotCounterLabel =
    totalLots > 0 && lotPosition > 0
      ? fill(t("live.board.lotOf"), { n: lotPosition, total: totalLots })
      : `Lot #${lot.id}`;

  return (
    <>
      {/* 1–3: Event / Venue / Host + Authoritative Status + Lot Counter + Bidder Standing */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/50 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {display ? (
            <LiveEventStatusBadge display={display} showOnAir={display.isAuthoritativeLive} />
          ) : null}
          <StatusPill tone="muted" size="xs">
            {lotCounterLabel}
          </StatusPill>
          <span className="truncate text-caption font-semibold text-foreground">
            {eventTitle ?? session.title}
          </span>
          {venue ? (
            <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              {venue.name}
            </span>
          ) : null}
        </div>
        <span
          data-testid="bidder-standing-badge"
          data-bidder-standing={standing.code}
          className={cn(
            "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-bold",
            standing.tone === "good" && "border-teal/40 bg-teal-tint/70 text-teal-deep dark:text-teal",
            standing.tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
            standing.tone === "warn" && "border-warn/40 bg-warn/15 text-warn-foreground",
            standing.tone === "muted" && "border-border bg-muted/60 text-muted-foreground",
          )}
        >
          {standing.label}
        </span>
      </div>

      {/* 4–8: Photo Gallery + Vehicle Identity + Key Specs + Authoritative Price */}
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="w-full shrink-0 space-y-2 sm:w-64">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-control bg-muted">
            {img ? (
              <img src={img} alt={vehicleHeading} className="h-full w-full object-cover" loading="eager" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center bg-gradient-to-br from-teal/10 to-gold/20 text-muted-foreground"
                aria-hidden="true"
              >
                <CarFront className="size-10 opacity-70" />
              </div>
            )}
          </div>
          {v.imageList.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vehicle photos">
              {v.imageList.slice(0, 5).map((src, idx) => (
                <button
                  key={`${src}-${idx}`}
                  type="button"
                  onClick={() => setPhotoSelection({ lotId: lot.id, index: idx })}
                  aria-label={`View photo ${idx + 1}`}
                  aria-pressed={activePhotoIndex === idx}
                  className={cn(
                    "size-11 overflow-hidden rounded-control border transition focus-visible:outline-2 focus-visible:outline-ring",
                    activePhotoIndex === idx
                      ? "border-teal ring-2 ring-teal/40"
                      : "border-border opacity-75 hover:opacity-100",
                  )}
                >
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="good" size="xs">
                  <span className="size-1.5 rounded-full bg-teal motion-safe:animate-pulse" aria-hidden="true" />
                  {t("room.status.current")}
                </StatusPill>
                {vehicle?.tengasell_grade ? (
                  <StatusPill tone="gold" size="xs">
                    Grade {vehicle.tengasell_grade}
                  </StatusPill>
                ) : null}
                <StatusPill tone="muted" size="xs">
                  {formatReserveDisclosure(lot)}
                </StatusPill>
                <div className="ms-auto">
                  <AuctionFollowButton
                    targetType="lot"
                    targetId={lot.id}
                    lotId={lot.id}
                    auctionId={lot.id}
                    sessionId={session.id}
                    eventId={session.event_id}
                    title={lot.title}
                    testId="live-room-follow-lot-btn"
                    size="sm"
                    compact
                  />
                </div>
              </div>
              <h2 className="text-lg font-bold leading-snug text-foreground">{vehicleHeading}</h2>
              <a
                {...itemLink}
                className="block max-w-full break-words text-caption font-semibold text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {lot.title} · View vehicle dossier
              </a>
            </div>
          </div>

          {vehicle ? (
            <div className="grid grid-cols-2 gap-2 rounded-control border border-border bg-background p-2.5 text-caption sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Odometer</p>
                <p className="font-semibold text-foreground ts-numeric">
                  {vehicle.odometer_km.toLocaleString()} km
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Transmission</p>
                <p className="font-semibold text-foreground">{vehicle.transmission}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Fuel / Drive</p>
                <p className="font-semibold text-foreground">
                  {vehicle.fuel_type} · {vehicle.drivetrain}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Engine</p>
                <p className="font-semibold text-foreground">
                  {vehicle.engine_displacement_cc ? `${vehicle.engine_displacement_cc.toLocaleString()} cc` : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Condition / Inspection</p>
                <p className="font-semibold text-foreground">
                  {inspection
                    ? `${inspection.roadworthy ? "Roadworthy" : "Non-roadworthy"}${criticalFindingsCount > 0 ? ` · ${criticalFindingsCount} major/critical` : " · Inspected"}`
                    : lot.condition}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Location</p>
                <p className="font-semibold text-foreground">{vehicle.location_city}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 text-caption text-muted-foreground">
              <span>Condition: <strong className="text-foreground">{lot.condition}</strong></span>
              <span>· City: <strong className="text-foreground">{lot.city || "Harare"}</strong></span>
            </div>
          )}

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <PriceTag amount={lot.current_price} size="xl" />
            <span className="ts-numeric text-caption font-semibold text-muted-foreground">
              {lot.bid_count} {t("bid.bids")}
            </span>
            {activeBid ? (
              <span className="text-caption text-muted-foreground">
                · Leading: <strong className="text-foreground">{maskUser(activeBid.bidder_username)}</strong>
              </span>
            ) : null}
          </div>
          <p className="text-caption text-muted-foreground">
            {activeBid
              ? `${fill(t("room.bidsOnLot"), { n: lot.bid_count })} · ${t("room.bid.min")}: ${formatUSD(min)}`
              : `${t("room.clock.opens")} · ${t("room.bid.min")}: ${formatUSD(min)}`}
          </p>
        </div>
      </div>

      {/* Collapsible Vehicle Specs, Inspection Findings & Documents (compact on 390px mobile) */}
      <Collapsible
        open={specsOpen}
        onOpenChange={setSpecsOpen}
        data-testid="live-vehicle-details-collapsible"
        className="border-t border-border bg-background/40"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-caption font-bold text-foreground transition hover:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Gauge className="size-4 shrink-0 text-teal" aria-hidden="true" />
              Vehicle Specifications, Inspection & Disclosure Summary
              {findings.length > 0 ? (
                <StatusPill size="xs" tone={criticalFindingsCount > 0 ? "warn" : "muted"}>
                  {findings.length} {findings.length === 1 ? "finding" : "findings"}
                </StatusPill>
              ) : null}
            </span>
            <ChevronDown
              className={cn("size-4 shrink-0 transition-transform", specsOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border px-4 py-3 text-caption space-y-3">
          {vehicle ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="font-bold text-foreground">Vehicle Dossier</p>
                <p className="text-muted-foreground">
                  Lifecycle: <strong className="text-foreground">{vehicle.lifecycle}</strong> ·
                  Ownership: <strong className="text-foreground">{vehicle.ownership_status}</strong> ·
                  Customs: <strong className="text-foreground">{vehicle.customs_status}</strong>
                </p>
                <p className="text-muted-foreground">
                  Documents verified: <strong className="text-foreground">{verifiedDocsCount}/{documents.length}</strong> ·
                  Owner bid disclosure:{" "}
                  <strong className="text-foreground">
                    {lot.owner_bid_right_disclosure === "DISCLOSED" ? "Owner bidding disclosed" : "Not permitted"}
                  </strong>
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-bold text-foreground flex items-center gap-1.5">
                  <FileCheck2 className="size-4 text-teal" aria-hidden="true" />
                  Inspection & Condition Report
                </p>
                {inspection ? (
                  <p className="text-muted-foreground">
                    Inspector: <strong className="text-foreground">{inspection.inspector_name}</strong> ·
                    Status: <strong className="text-foreground">{inspection.lifecycle}</strong> ·
                    {inspection.grade_score != null ? ` Score: ${inspection.grade_score}/100` : ""}
                  </p>
                ) : (
                  <p className="text-muted-foreground">Seller condition: {lot.condition}</p>
                )}
                {findings.length > 0 ? (
                  <ul className="space-y-1 text-muted-foreground">
                    {findings.slice(0, 4).map((f) => (
                      <li key={f.id}>
                        <span className="font-semibold text-foreground">[{f.severity}] {f.component}:</span>{" "}
                        {f.description}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">{lot.description}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-muted-foreground">
              <p className="font-bold text-foreground">Lot Disclosure</p>
              <p>{lot.description}</p>
              <p>Reserve policy: {formatReserveDisclosure(lot)}</p>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <HammerClock
        closeAt={session.close_at}
        lotStatus={lot.status}
        eventLotStatus={eventLotStatus}
        onTimerElapsed={onChanged}
      />

      <LotBidPanel
        session={session}
        lot={lot}
        isSeller={isSeller}
        signedIn={!!user}
        canBid={canBid}
        qualificationState={qualificationState}
        onChanged={onChanged}
      />

      {nextUpLot ? (
        <div
          data-testid="next-vehicle-preview"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/60 px-4 py-3 text-caption"
        >
          <div className="min-w-0">
            <span className="font-bold uppercase tracking-wide text-teal">Next Vehicle Preview · </span>
            <span className="font-semibold text-foreground">{nextUpLot.title}</span>
            <span className="ms-2 text-muted-foreground">
              · Opens at <strong className="ts-numeric text-foreground">{formatUSD(nextUpLot.current_price)}</strong>
            </span>
          </div>
          <a
            href={`#/item/${nextUpLot.id}`}
            className="inline-flex items-center gap-1 font-bold text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Preview lot <ArrowRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <LotFeed bids={bids} loading={bidsLoading} />
    </>
  );
}

// ── going-going-sold hammer clock ──────────────────────────────────────

function HammerClock({
  closeAt,
  lotStatus,
  eventLotStatus = null,
  onTimerElapsed,
}: {
  closeAt: string | null;
  lotStatus?: Auction["status"];
  eventLotStatus?: string | null;
  onTimerElapsed?: () => void;
}) {
  const { t } = useI18n();
  const now = useNow(500);
  const suffix = t("room.clock.secSuffix");
  const reconciledCloseAtRef = useRef<string | null>(null);

  const msLeft = closeAt != null ? Date.parse(closeAt) - now : null;
  const elapsed = closeAt != null && msLeft != null && Number.isFinite(msLeft) && msLeft <= 0;

  useEffect(() => {
    if (!elapsed || !closeAt || !onTimerElapsed) return;
    if (reconciledCloseAtRef.current === closeAt) return;
    reconciledCloseAtRef.current = closeAt;
    onTimerElapsed();
  }, [elapsed, closeAt, onTimerElapsed]);

  const normalizedEventLotStatus = String(eventLotStatus ?? "").toUpperCase();
  const isSoldAuthoritatively = lotStatus === "sold" || normalizedEventLotStatus === "SOLD";
  const isPassedAuthoritatively =
    lotStatus === "ended" || normalizedEventLotStatus === "PASSED" || normalizedEventLotStatus === "UNSOLD";

  let inner: React.ReactNode;
  let tone = "";
  if (isSoldAuthoritatively) {
    inner = (
      <p className="ts-numeric text-3xl font-extrabold leading-none text-gold-deep sm:text-4xl">
        {t("room.clock.sold")}
      </p>
    );
    tone = "bg-gold-soft/70";
  } else if (isPassedAuthoritatively) {
    inner = (
      <p className="text-bodyStrong font-bold text-muted-foreground">
        Passed / Unsold
      </p>
    );
    tone = "bg-muted/60";
  } else if (closeAt == null) {
    inner = (
      <p className="flex items-center justify-center gap-2 text-caption font-semibold text-muted-foreground">
        <Clock className="size-4" aria-hidden="true" />
        {t("room.clock.opens")}
      </p>
    );
    tone = "bg-muted/40";
  } else {
    const secs = Math.max(0, Math.ceil((msLeft ?? 0) / 1000));
    if (elapsed) {
      inner = (
        <p data-testid="hammer-clock-pending" className="text-caption font-bold text-muted-foreground">
          Countdown elapsed · Awaiting official auctioneer decision
        </p>
      );
      tone = "bg-muted/40";
    } else if (secs <= 10) {
      inner = (
        <div className="flex flex-col items-center gap-0.5">
          <p className="text-label font-extrabold uppercase tracking-wide text-urgent motion-safe:animate-pulse">
            {t("room.clock.twice")}
          </p>
          <p className="ts-numeric text-4xl font-extrabold leading-none text-urgent motion-safe:animate-pulse sm:text-5xl">
            {secs}
            <span className="text-xl">{suffix}</span>
          </p>
        </div>
      );
      tone = "bg-danger/10";
    } else {
      inner = (
        <div className="flex flex-col items-center gap-0.5">
          <p className="text-label font-bold uppercase tracking-wide text-teal">
            {t("room.clock.once")}
          </p>
          <p className="ts-numeric text-4xl font-extrabold leading-none text-teal sm:text-5xl">
            {secs}
            <span className="text-xl">{suffix}</span>
          </p>
        </div>
      );
      tone = "bg-teal-tint/60";
    }
  }

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn("border-y border-border px-4 py-5 text-center transition-colors", tone)}
    >
      {inner}
    </div>
  );
}

// ── bid panel ──────────────────────────────────────────────────────────

function LotBidPanel({
  session,
  lot,
  isSeller,
  signedIn,
  canBid,
  qualificationState,
  onChanged,
}: {
  session: LiveSession;
  lot: Auction;
  isSeller: boolean;
  signedIn: boolean;
  canBid: boolean;
  qualificationState: QualificationFloorState;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const signinLink = useLinkProps("/signin");

  const qualRecord = qualificationState.bundle?.qualification ?? null;
  const qualStatus = qualRecord?.status ?? null;
  const qualificationBlocked = Boolean(
    session.event_id != null &&
      lot.asset_kind === "vehicle" &&
      qualificationState.loaded &&
      qualStatus !== "QUALIFIED",
  );
  const availableCapacity = Number(qualificationState.bundle?.capacity?.available ?? 0);

  let body: React.ReactNode;
  if (!canBid || lot.status !== "live") {
    body = (
      <p className="flex items-center gap-2 rounded-control bg-muted/60 p-3 text-caption font-semibold text-muted-foreground">
        <Info className="size-4 shrink-0" aria-hidden="true" />
        Live bidding is currently closed until the lot is authoritatively open on the floor.
      </p>
    );
  } else if (isSeller) {
    body = (
      <p className="flex items-center gap-2 rounded-control bg-gold-soft/60 p-3 text-caption font-semibold text-gold-deep">
        <UserRound className="size-4 shrink-0" aria-hidden="true" />
        {t("room.bid.selling")}
      </p>
    );
  } else if (!signedIn) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-caption font-semibold text-muted-foreground">
          <LogIn className="size-4 shrink-0" aria-hidden="true" />
          {t("room.bid.needSignin")}
        </p>
        <Button asChild className="min-h-11">
          <a {...signinLink}>{t("nav.signin")}</a>
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {session.event_id != null && qualificationState.loaded ? (
          qualStatus === "QUALIFIED" ? (
            <div
              data-testid="live-qualification-status"
              className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-teal/30 bg-teal-tint/50 px-3 py-2 text-caption"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold text-teal-deep dark:text-teal">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                Qualified bidder
              </span>
              <span className="ts-numeric font-bold text-foreground">
                Capacity: {formatUSD(availableCapacity)}
              </span>
            </div>
          ) : (
            <div
              data-testid="qualification-gate-warning"
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-warn/50 bg-warn/15 p-3 text-caption"
            >
              <div className="space-y-0.5">
                <p className="font-bold text-foreground">
                  Bidder qualification required ({qualStatus ?? "NOT QUALIFIED"})
                </p>
                <p className="text-muted-foreground">
                  {qualRecord?.reason_code
                    ? `Action required: ${qualRecord.reason_code}`
                    : "Complete event qualification and deposit verification before placing live vehicle bids."}
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="min-h-10">
                <a href={`#/events/${session.event_id}`}>View event qualification</a>
              </Button>
            </div>
          )
        ) : null}
        <LotBidForm
          lot={lot}
          qualificationBlocked={qualificationBlocked}
          onChanged={onChanged}
        />
      </div>
    );
  }

  return <div className="border-b border-border p-4">{body}</div>;
}

function LotBidForm({
  lot,
  qualificationBlocked = false,
  onChanged,
}: {
  lot: Auction;
  qualificationBlocked?: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const min = minNextBid(lot.current_price, lot.bid_count);
  const draftKey = `${lot.id}:${min}`;
  const defaultDraft = min % 1 === 0 ? String(min) : min.toFixed(2);
  const [draft, setDraft] = useState<{ key: string; value: string }>(() => ({
    key: draftKey,
    value: defaultDraft,
  }));
  const [errorState, setErrorState] = useState<{ key: string; message: string | null }>({
    key: draftKey,
    message: null,
  });
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const value = draft.key === draftKey ? draft.value : defaultDraft;
  const error = errorState.key === draftKey ? errorState.message : null;
  const setValue = (nextVal: string) => setDraft({ key: draftKey, value: nextVal });
  const setError = (nextErr: string | null) =>
    setErrorState({ key: draftKey, message: nextErr });

  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  const quickIncrements = [
    { label: `Min (${formatUSD(min)})`, amount: round2(min) },
    { label: "+$100", amount: round2(min + 100) },
    { label: "+$250", amount: round2(min + 250) },
    { label: "+$500", amount: round2(min + 500) },
  ];

  const requestConfirmation = () => {
    if (busy || qualificationBlocked) return;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("room.bid.invalid"));
      return;
    }
    if (parsed < min) {
      setError(fill(t("room.bid.belowMin"), { min: formatUSD(min) }));
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const submit = async () => {
    if (busy || qualificationBlocked) return;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("room.bid.invalid"));
      return;
    }
    if (parsed < min) {
      setError(fill(t("room.bid.belowMin"), { min: formatUSD(min) }));
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await api.placeBid(lot.id, round2(parsed));
      if (res.ok) {
        if (res.outbid) {
          toast({ title: t("room.bid.outbidToast"), variant: "destructive" });
        } else {
          toast({
            title: t("room.bid.okToast"),
            description: `${formatUSD(round2(parsed))} · ${lot.title}`,
          });
        }
        onChanged();
      } else {
        setError(res.error ?? t("state.error"));
        onChanged(); // price may have moved — render the new minimum
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("state.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick bid increments">
        {quickIncrements.map((step) => (
          <Button
            key={step.label}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || qualificationBlocked}
            onClick={() => {
              setValue(step.amount % 1 === 0 ? String(step.amount) : step.amount.toFixed(2));
              if (error) setError(null);
            }}
            className="min-h-10 ts-numeric font-semibold"
          >
            {step.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1 space-y-1.5">
          <label htmlFor="ts-room-max-bid" className="text-label text-foreground">
            {t("room.bid.max")}
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-3 flex items-center font-bold text-muted-foreground"
            >
              $
            </span>
            <Input
              id="ts-room-max-bid"
              inputMode="decimal"
              autoComplete="off"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              disabled={busy || qualificationBlocked}
              aria-invalid={!!error}
              aria-describedby="ts-room-max-bid-hint"
              placeholder={min % 1 === 0 ? String(min) : min.toFixed(2)}
              className="h-12 pl-7 text-title font-bold ts-numeric rounded-control"
            />
          </div>
          <p id="ts-room-max-bid-hint" className="text-caption text-muted-foreground">
            {t("room.bid.min")}:{" "}
            <span className="ts-numeric font-semibold text-foreground">{formatUSD(min)}</span>
          </p>
        </div>
        <Button
          onClick={requestConfirmation}
          disabled={busy || qualificationBlocked}
          className="min-h-12 rounded-control px-6"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {t("room.bid.placing")}
            </>
          ) : (
            <>
              <Zap className="size-4" aria-hidden="true" /> {t("room.bid.place")}
            </>
          )}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="live-bid-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Live Floor Bid</AlertDialogTitle>
            <AlertDialogDescription>
              You are submitting a binding automatic maximum bid of{" "}
              <strong className="ts-numeric text-foreground">{formatUSD(round2(parsed || min))}</strong> on{" "}
              <strong className="text-foreground">{lot.title}</strong>. {t("room.bid.sla")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <Button
              type="button"
              data-testid="live-bid-confirm-submit"
              onClick={() => void submit()}
              disabled={busy}
              className="min-h-11"
            >
              <Zap className="size-4" aria-hidden="true" />
              Confirm Live Bid ({formatUSD(round2(parsed || min))})
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* compact proxy-bid explainer (mirrors the item-page bid sheet) */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-control border border-teal/30 bg-teal-tint/70 p-3 dark:bg-teal-tint/40"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-teal-soft" aria-hidden="true" />
        <p className="text-caption leading-relaxed text-foreground">
          <span className="font-bold">{t("bid.auto")}</span>
          <span className="text-muted-foreground"> — {t("room.bid.explainer")}</span>
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <p className="flex items-start gap-2 text-caption text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-soft" aria-hidden="true" />
        {t("room.bid.sla")}
      </p>
    </div>
  );
}

// ── live lot feed ──────────────────────────────────────────────────────

function LotFeed({ bids, loading }: { bids: Bid[]; loading: boolean }) {
  const { t } = useI18n();
  const { user } = useAuth();

  return (
    <section aria-label={t("room.feed.title")} className="p-4">
      <h3 className="mb-2 flex items-center justify-between gap-2 text-label font-bold text-foreground">
        <span className="flex items-center gap-1.5">
          <Gavel className="size-4 text-teal" aria-hidden="true" />
          {t("room.feed.title")}
        </span>
        <span className="ts-numeric text-caption font-semibold text-muted-foreground">
          {bids.length}
        </span>
      </h3>
      {loading && bids.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 rounded-control bg-muted motion-safe:animate-pulse" />
          ))}
        </div>
      ) : bids.length === 0 ? (
        <p className="rounded-control border border-dashed border-border bg-muted/40 p-4 text-center text-caption text-muted-foreground">
          {t("room.feed.empty")}
        </p>
      ) : (
        <ul
          aria-live="polite"
          className="max-h-72 divide-y divide-border overflow-y-auto rounded-control border border-border ts-scrollbar"
        >
          {bids.map((b) => {
            const mine = !!user && b.bidder_username === user.username;
            return (
              <li
                key={b.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-caption",
                  mine && "bg-teal-tint/40 dark:bg-teal-tint/25",
                )}
              >
                <span
                  className="font-semibold text-foreground"
                  title={mine ? b.bidder_username : undefined}
                >
                  {maskUser(b.bidder_username)}
                  {mine ? ` ${t("room.feed.you")}` : ""}
                </span>
                <span className="ts-numeric font-bold text-foreground">{formatUSD(b.amount)}</span>
                {b.is_auto === 1 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-gold-deep">
                    <Zap className="size-3" aria-hidden="true" />
                    {t("room.feed.auto")}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("room.feed.manual")}</span>
                )}
                <span
                  className={cn(
                    "ms-auto rounded-pill px-2 py-0.5 font-bold",
                    b.status === "active"
                      ? "bg-teal-tint text-teal-deep dark:text-teal-soft"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {b.status === "active"
                    ? t("room.feed.winning")
                    : b.status === "retracted"
                      ? t("room.feed.retracted")
                      : t("room.feed.outbid")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-caption text-muted-foreground">{t("room.feed.privacy")}</p>
    </section>
  );
}

// ── lot parade (sidebar) ───────────────────────────────────────────────

function LotParade({
  session,
  lots,
  loading,
  bids,
  isHost,
  removing,
  onRemove,
  removeError,
}: {
  session: LiveSession;
  lots: Auction[];
  loading: boolean;
  bids: Bid[];
  isHost: boolean;
  removing: Set<number>;
  onRemove: (auctionId: number) => void;
  removeError: string | null;
}) {
  const { t } = useI18n();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  // presence line counts live rows (retracted bids drop out of the count)
  const bidCount = bids.filter((b) => b.status !== "retracted").length;

  const pillFor = (lot: Auction): { tone: "good" | "gold" | "muted" | "warn"; label: string } => {
    if (session.current_lot_id === lot.id) return { tone: "good", label: t("room.status.current") };
    if (lot.status === "sold") return { tone: "gold", label: t("room.status.sold") };
    if (lot.status === "ended") return { tone: "muted", label: t("room.status.ended") };
    return { tone: "warn", label: t("room.status.upcoming") };
  };

  return (
    <section
      aria-label={t("room.parade")}
      data-testid="live-run-list"
      className="overflow-hidden rounded-card border border-border bg-raised"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <SectionHeader
            icon={<ListPlus className="size-4 text-teal" aria-hidden="true" />}
            title={t("room.parade")}
            subtitle={t("room.paradeSub")}
          />
        </div>
        <button
          type="button"
          onClick={() => setMobileExpanded((prev) => !prev)}
          aria-expanded={mobileExpanded}
          aria-controls="ts-live-run-list-body"
          className="me-3 inline-flex min-h-11 items-center gap-1 rounded-control border border-border px-2.5 text-caption font-bold text-foreground lg:hidden focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span>{mobileExpanded ? "Hide" : `Show (${lots.length})`}</span>
          <ChevronDown
            className={cn("size-4 transition-transform", mobileExpanded && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </div>
      <div id="ts-live-run-list-body" className={cn(!mobileExpanded && "hidden lg:block")}>
        {loading && lots.length === 0 ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 rounded-control bg-muted motion-safe:animate-pulse" />
            ))}
          </div>
        ) : lots.length === 0 ? (
          <p className="p-4 text-caption text-muted-foreground">{t("live.emptyHint")}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto ts-scrollbar">
            {lots.map((lot, i) => (
              <ParadeRow
                key={lot.id}
                lot={lot}
                index={i + 1}
                pill={pillFor(lot)}
                current={session.current_lot_id === lot.id}
                removable={
                  isHost &&
                  session.current_lot_id !== lot.id &&
                  lot.status === "live" &&
                  session.status !== "closed"
                }
                removing={removing.has(lot.id)}
                onRemove={onRemove}
              />
            ))}
          </ul>
        )}
        {removeError && (
          <div
            role="alert"
            className="flex items-start gap-2 border-t border-border px-3 py-2.5 text-caption text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="font-medium">{removeError}</span>
          </div>
        )}
      </div>
      <p className="border-t border-border px-3 py-2 text-caption text-muted-foreground">
        {session.current_lot_id != null
          ? fill(t("room.bidsOnLot"), { n: bidCount })
          : fill(t("room.lotsCount"), { n: lots.length })}
      </p>
    </section>
  );
}

function ParadeRow({
  lot,
  index,
  pill,
  current,
  removable,
  removing,
  onRemove,
}: {
  lot: Auction;
  index: number;
  pill: { tone: "good" | "gold" | "muted" | "warn"; label: string };
  current: boolean;
  removable: boolean;
  removing: boolean;
  onRemove: (auctionId: number) => void;
}) {
  const { t } = useI18n();
  const link = useLinkProps(`#/item/${lot.id}`);
  const done = lot.status === "sold" || lot.status === "ended";
  return (
    <li className={cn("flex items-stretch", done && "opacity-70")}>
      <a
        {...link}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          current && "bg-teal-tint/60 dark:bg-teal-tint/40",
        )}
      >
        <span className="ts-numeric w-6 shrink-0 text-center text-caption font-bold text-muted-foreground">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-caption font-semibold text-foreground">
            {lot.title}
          </span>
          <span className="ts-numeric text-caption text-muted-foreground">
            {formatUSD(lot.current_price)}
          </span>
        </span>
        <StatusPill size="xs" tone={pill.tone}>
          {pill.label}
        </StatusPill>
      </a>
      {removable && (
        <button
          type="button"
          onClick={() => void onRemove(lot.id)}
          disabled={removing}
          aria-label={fill(t("room.host.removeLabel"), { title: lot.title })}
          title={t("room.host.remove")}
          className="flex w-11 shrink-0 items-center justify-center rounded-l-none text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
        >
          {removing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <X className="size-4" aria-hidden="true" />
          )}
        </button>
      )}
    </li>
  );
}

// ── host console ───────────────────────────────────────────────────────

function HostConsole({
  session,
  currentLot,
  bids,
  onChanged,
}: {
  session: LiveSession;
  currentLot: Auction | null;
  bids: Bid[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const activeBid = bids.find((b) => b.status === "active") ?? null;
  const lotOpen = session.status === "live" && !!currentLot;

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("state.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("room.host.console")}
      className="rounded-card border border-border bg-raised p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-title text-foreground">
            <Hammer className="size-5 text-ochre" aria-hidden="true" />
            {t("room.host.console")}
          </h2>
          <p className="mt-0.5 truncate text-caption text-muted-foreground">
            {t("room.host.consoleSub")}
          </p>
        </div>
        <StatusPill tone="gold" size="sm">
          {session.host_username}
        </StatusPill>
      </div>

      {/* primary auctioneer actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(session.status === "scheduled" || (session.status === "live" && !session.current_lot_id)) && (
          <Button
            onClick={() => void run(() => api.openRoomLot(session.id))}
            disabled={busy}
            className="min-h-11"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {busy ? t("room.host.opening") : t("room.host.open")}
          </Button>
        )}
        {lotOpen && currentLot && (
          <>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy} className="min-h-11">
                  <Hammer className="size-4" aria-hidden="true" />
                  {t("room.host.hammer")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("room.host.confirmSellTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {fill(t("room.host.confirmSell"), {
                      title: currentLot.title,
                      price: formatUSD(currentLot.current_price),
                      bidder: activeBid ? maskUser(activeBid.bidder_username) : "—",
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
                  <AlertDialogAction className="min-h-11" onClick={() => void run(() => api.closeRoomLot(session.id, true))}>
                    <Hammer className="size-4" aria-hidden="true" />
                    {t("action.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy} className="min-h-11">
                  <SkipForward className="size-4" aria-hidden="true" />
                  {t("room.host.pass")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("room.host.confirmPassTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {fill(t("room.host.confirmPass"), { title: currentLot.title })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
                  <AlertDialogAction className="min-h-11" onClick={() => void run(() => api.closeRoomLot(session.id, false))}>
                    <SkipForward className="size-4" aria-hidden="true" />
                    {t("action.confirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              disabled={busy || session.status === "closed"}
              className="min-h-11 text-danger hover:bg-danger/10 hover:text-danger"
            >
              <XCircle className="size-4" aria-hidden="true" />
              {t("room.host.end")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("room.host.confirmEndTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("room.host.confirmEnd")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
              <AlertDialogAction className="min-h-11" onClick={() => void run(() => api.endLiveRoom(session.id))}>
                <XCircle className="size-4" aria-hidden="true" />
                {t("action.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* add-lots collapsible */}
      <Collapsible open={addOpen} onOpenChange={setAddOpen} className="mt-4 rounded-control border border-border">
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 rounded-control px-3 py-2.5 text-label font-bold text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
          <span className="flex items-center gap-2">
            <Plus className="size-4 text-teal" aria-hidden="true" />
            {t("room.host.addLots")}
          </span>
          <ChevronDown
            className={cn("size-4 transition-transform", addOpen && "rotate-180")}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border p-3">
          <AddLotsPanel session={session} onChanged={onChanged} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function AddLotsPanel({
  session,
  onChanged,
}: {
  session: LiveSession;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const mine = useResource(() => api.mySelling(), []);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // host lot-picker: live listings, no bids, not already in a room
  const candidates = useMemo(
    () =>
      (mine.data ?? []).filter(
        (a) => a.status === "live" && a.bid_count === 0 && a.live_session_id == null,
      ),
    [mine.data],
  );

  // (lots already in the room are removed from the parade sidebar)

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addLot = async (auctionId: number) => {
    if (busyIds.has(auctionId)) return;
    setBusyIds((prev) => new Set(prev).add(auctionId));
    setError(null);
    try {
      await api.addRoomLot(session.id, auctionId);
      toast({ title: t("room.host.addedToast") });
      mine.reload(); // refresh the candidates (lot now has live_session_id)
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(auctionId);
        return next;
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("state.error"));
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(auctionId);
        return next;
      });
    }
  };

  const addSelected = async () => {
    for (const id of selected) await addLot(id);
  };

  return (
    <div className="space-y-3">
      {mine.loading && !mine.data ? (
        <p className="flex items-center gap-2 py-2 text-caption text-muted-foreground" aria-busy="true">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("state.loading")}
        </p>
      ) : (
        <>
          <p className="text-caption text-muted-foreground">{t("room.host.addLotsHint")}</p>
          {candidates.length === 0 ? (
            <p className="rounded-control border border-dashed border-border bg-muted/40 p-3 text-caption text-muted-foreground">
              {t("room.host.noCandidates")}
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto ts-scrollbar">
              {candidates.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 rounded-control border border-border px-2.5 py-2"
                >
                  <Checkbox
                    id={`ts-lot-cand-${a.id}`}
                    checked={selected.has(a.id)}
                    onCheckedChange={() => toggle(a.id)}
                    aria-label={a.title}
                    className="size-5"
                    disabled={busyIds.has(a.id)}
                  />
                  <label
                    htmlFor={`ts-lot-cand-${a.id}`}
                    className="min-w-0 flex-1 cursor-pointer truncate text-caption font-semibold text-foreground"
                  >
                    {a.title}
                  </label>
                  <span className="ts-numeric shrink-0 text-caption font-bold text-teal">
                    {formatUSD(a.start_price)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void addLot(a.id)}
                    disabled={busyIds.has(a.id)}
                    className="min-h-11 px-3"
                  >
                    {busyIds.has(a.id) ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus className="size-4" aria-hidden="true" />
                    )}
                    <span className="sr-only sm:not-sr-only">{t("room.host.add")}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {selected.size > 0 && (
            <Button
              onClick={() => void addSelected()}
              disabled={busyIds.size > 0}
              className="min-h-11 w-full"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {t("room.host.add")} ({selected.size})
            </Button>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption text-danger"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="font-medium">{error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
