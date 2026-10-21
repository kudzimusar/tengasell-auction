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
  CheckCircle2,
  ChevronDown,
  Clock,
  Gavel,
  Hammer,
  Info,
  ListPlus,
  Loader2,
  LogIn,
  Play,
  Plus,
  Radio,
  ShieldCheck,
  SkipForward,
  UserRound,
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
import { bus } from "@/lib/tengasell/bus";
import { formatUSD, minNextBid, round2 } from "@/lib/tengasell/format";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import {
  toAuctionView,
  type Auction,
  type Bid,
  type CurrentUser,
  type LiveSession,
} from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";
import {
  Avatar,
  EmptyState,
  ErrorState,
  LoadingGrid,
  PriceTag,
  SectionHeader,
  StatusPill,
  useNow,
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

  const [hostOpen, setHostOpen] = useState(false);

  const sessions = res.data ?? [];
  const liveNow = sessions.filter((s) => s.status === "live");
  const upcoming = sessions.filter((s) => s.status === "scheduled");
  const closed = sessions
    .filter((s) => s.status === "closed")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // lot totals per room (one small fetch per session; few sessions exist)
  const [totals, setTotals] = useState<Record<number, number>>({});
  const sessionData = res.data;
  useEffect(() => {
    if (!sessionData || sessionData.length === 0) return;
    let alive = true;
    void Promise.all(
      sessionData.map(async (s) => {
        try {
          const lots = await api.roomLots(s.id);
          return [s.id, lots.length] as const;
        } catch {
          return [s.id, 0] as const;
        }
      }),
    ).then((pairs) => {
      if (alive) setTotals(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [sessionData]);

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
            <Button onClick={openHostDialog} className="min-h-11">
              <ListPlus className="size-4" aria-hidden="true" />
              {t("live.board.host")}
            </Button>
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
                {liveNow.map((s) => (
                  <SessionCard key={s.id} session={s} total={totals[s.id] ?? 0} live />
                ))}
              </BoardGroup>
            )}
            {upcoming.length > 0 && (
              <BoardGroup title={t("live.board.upcoming")} accent="text-teal">
                {upcoming.map((s) => (
                  <SessionCard key={s.id} session={s} total={totals[s.id] ?? 0} />
                ))}
              </BoardGroup>
            )}
            {closed.length > 0 && (
              <BoardGroup title={t("live.board.closed")} accent="text-muted-foreground">
                {closed.slice(0, 6).map((s) => (
                  <SessionCard key={s.id} session={s} total={totals[s.id] ?? 0} muted />
                ))}
              </BoardGroup>
            )}
          </div>
        )}
      </section>

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
            className={cn("size-2 rounded-full bg-urgent", pulse && "animate-pulse")}
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
  live = false,
  muted = false,
}: {
  session: LiveSession;
  total: number;
  live?: boolean;
  muted?: boolean;
}) {
  const { t, locale } = useI18n();
  const link = useLinkProps(`#/live/${session.id}`);

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
      <div className="flex items-center gap-2">
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-danger/10 px-2 py-0.5 text-[11px] font-bold text-urgent">
            <span className="size-1.5 rounded-full bg-urgent animate-pulse" aria-hidden="true" />
            {t("state.live")}
          </span>
        ) : (
          <StatusPill size="xs" tone={session.status === "scheduled" ? "warn" : "muted"}>
            {session.status === "scheduled"
              ? t("room.status.scheduled")
              : t("room.status.closed")}
          </StatusPill>
        )}
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
        {live ? t("live.board.enter") : t("live.board.view")}
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

  const sessionRes = useResource(() => api.liveSession(sessionId), [sessionId, tick, lotTick]);
  // "auction:update" fires on every accepted bid (room lots included) —
  // keeps the stage price/bid count live between lot changes.
  const lotsRes = useResource(() => api.roomLots(sessionId), [sessionId, lotTick], {
    events: ["auction:update"],
  });

  const session = sessionRes.data ?? null;
  const lots = useMemo(
    () => [...(lotsRes.data ?? [])].sort((a, b) => a.id - b.id),
    [lotsRes.data],
  );
  const currentLotId = session?.current_lot_id ?? null;
  const currentLot = currentLotId != null ? lots.find((l) => l.id === currentLotId) ?? null : null;

  const bidsRes = useResource(
    () => (currentLotId != null ? api.bids(currentLotId) : Promise.resolve<Bid[]>([])),
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 space-y-4">
      {/* slim top strip: back + room status + on-air dot */}
      <div className="flex flex-wrap items-center gap-2">
        <a
          {...backLink}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-bold text-teal transition-colors hover:bg-teal-tint focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("room.backBoard")}
        </a>
        <RoomStatusPill session={session} />
        {session.status === "live" && (
          <span className="inline-flex items-center gap-1.5 text-caption font-bold text-urgent">
            <span className="size-2 rounded-full bg-urgent animate-pulse" aria-hidden="true" />
            ON AIR
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── left 2/3 — stage + lot feed ─────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          <LotStage
            session={session}
            lot={currentLot}
            sessionLoading={sessionRes.loading && !sessionRes.data}
            bids={bids}
            bidsLoading={bidsRes.loading && !bidsRes.data}
            user={user}
            onChanged={bump}
          />
        </div>

        {/* ── right 1/3 — room info, parade, presence ────────────── */}
        <div className="space-y-4">
          <section aria-label={session.title} className="rounded-card border border-border bg-raised p-4">
            <h2 className="text-bodyStrong font-bold leading-snug text-foreground">{session.title}</h2>
            <div className="mt-2 flex items-center gap-1.5">
              <Avatar username={session.host_username} size={20} />
              <span className="text-caption text-muted-foreground">
                {t("room.host")}:{" "}
                <span className="font-semibold text-foreground">{session.host_username}</span>
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <RoomStatusPill session={session} />
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

function RoomStatusPill({ session }: { session: LiveSession }) {
  const { t } = useI18n();
  if (session.status === "live")
    return (
      <StatusPill tone="good" size="sm">
        <span className="size-1.5 rounded-full bg-teal animate-pulse" aria-hidden="true" />
        {t("state.live")}
      </StatusPill>
    );
  if (session.status === "scheduled")
    return (
      <StatusPill tone="warn" size="sm">
        {t("room.status.scheduled")}
      </StatusPill>
    );
  return (
    <StatusPill tone="muted" size="sm">
      {t("room.status.closed")}
    </StatusPill>
  );
}

// ── current-lot stage ──────────────────────────────────────────────────

function LotStage({
  session,
  lot,
  sessionLoading,
  bids,
  bidsLoading,
  user,
  onChanged,
}: {
  session: LiveSession;
  lot: Auction | null;
  sessionLoading: boolean;
  bids: Bid[];
  bidsLoading: boolean;
  user: CurrentUser | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();

  const body = (() => {
    if (sessionLoading) {
      return (
        <div className="space-y-4 p-4" aria-busy="true">
          <div className="h-44 rounded-control bg-muted animate-pulse" />
          <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
          <div className="h-12 rounded bg-muted animate-pulse" />
        </div>
      );
    }
    if (session.status === "closed") {
      return (
        <EmptyState
          icon={<Gavel className="size-10" aria-hidden="true" />}
          title={t("room.closedNote")}
        />
      );
    }
    if (session.status === "scheduled") {
      return (
        <EmptyState
          icon={<CalendarClock className="size-10" aria-hidden="true" />}
          title={t("room.scheduledNote")}
        />
      );
    }
    if (session.current_lot_id != null && !lot) {
      // session arrived, lot list still loading
      return (
        <div className="space-y-4 p-4" aria-busy="true">
          <div className="h-44 rounded-control bg-muted animate-pulse" />
          <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
        </div>
      );
    }
    if (!lot) {
      return (
        <EmptyState
          icon={<Hammer className="size-10" aria-hidden="true" />}
          title={t("room.waiting")}
        />
      );
    }
    return (
      <LotStageBody
        session={session}
        lot={lot}
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
  lot,
  bids,
  bidsLoading,
  user,
  onChanged,
}: {
  session: LiveSession;
  lot: Auction;
  bids: Bid[];
  bidsLoading: boolean;
  user: CurrentUser | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const itemLink = useLinkProps(`#/item/${lot.id}`);
  const v = toAuctionView(lot);
  const img = v.imageList[0];
  const isSeller = !!user && user.username === lot.seller_username;
  const activeBid = bids.find((b) => b.status === "active") ?? null;
  const min = minNextBid(lot.current_price, lot.bid_count);

  return (
    <>
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-control bg-muted sm:w-52">
          {img ? (
            <img src={img} alt={lot.title} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center bg-gradient-to-br from-teal/10 to-gold/20 text-4xl"
              aria-hidden="true"
            >
              🧭
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="good" size="xs">
              <span className="size-1.5 rounded-full bg-teal animate-pulse" aria-hidden="true" />
              {t("room.status.current")}
            </StatusPill>
            <a
              {...itemLink}
              className="min-w-0 truncate text-label font-semibold text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {lot.title}
            </a>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <PriceTag amount={lot.current_price} size="xl" />
            <span className="ts-numeric text-caption font-semibold text-muted-foreground">
              {lot.bid_count} {t("bid.bids")}
            </span>
          </div>
          <p className="text-caption text-muted-foreground">
            {activeBid
              ? `${fill(t("room.bidsOnLot"), { n: lot.bid_count })} · ${t("room.bid.min")}: ${formatUSD(min)}`
              : t("room.clock.opens")}
          </p>
        </div>
      </div>

      <HammerClock closeAt={session.close_at} hasBids={lot.bid_count > 0} />

      <LotBidPanel lot={lot} isSeller={isSeller} signedIn={!!user} onChanged={onChanged} />

      <LotFeed bids={bids} loading={bidsLoading} />
    </>
  );
}

// ── going-going-sold hammer clock ──────────────────────────────────────

function HammerClock({ closeAt, hasBids }: { closeAt: string | null; hasBids: boolean }) {
  const { t } = useI18n();
  const now = useNow(500);
  const suffix = t("room.clock.secSuffix");

  let inner: React.ReactNode;
  let tone = "";
  if (closeAt == null) {
    inner = (
      <p className="flex items-center justify-center gap-2 text-caption font-semibold text-muted-foreground">
        <Clock className="size-4" aria-hidden="true" />
        {t("room.clock.opens")}
      </p>
    );
    tone = "bg-muted/40";
  } else {
    const msLeft = Date.parse(closeAt) - now;
    const secs = Math.max(0, Math.ceil(msLeft / 1000));
    if (msLeft <= 0) {
      if (hasBids) {
        inner = (
          <p className="ts-numeric text-3xl font-extrabold leading-none text-gold-deep sm:text-4xl">
            {t("room.clock.sold")}
          </p>
        );
        tone = "bg-gold-soft/70";
      } else {
        inner = (
          <p className="text-caption font-bold text-muted-foreground animate-pulse">
            {t("room.clock.settling")}
          </p>
        );
        tone = "bg-muted/40";
      }
    } else if (secs <= 10) {
      inner = (
        <div className="flex flex-col items-center gap-0.5">
          <p className="text-label font-extrabold uppercase tracking-wide text-urgent animate-pulse">
            {t("room.clock.twice")}
          </p>
          <p className="ts-numeric text-4xl font-extrabold leading-none text-urgent animate-pulse sm:text-5xl">
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
  lot,
  isSeller,
  signedIn,
  onChanged,
}: {
  lot: Auction;
  isSeller: boolean;
  signedIn: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const signinLink = useLinkProps("/signin");

  let body: React.ReactNode;
  if (isSeller) {
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
    body = <LotBidForm lot={lot} onChanged={onChanged} />;
  }

  return <div className="border-b border-border p-4">{body}</div>;
}

function LotBidForm({ lot, onChanged }: { lot: Auction; onChanged: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const min = minNextBid(lot.current_price, lot.bid_count);

  // prefill with the minimum next bid; resyncs when the price moves
  useEffect(() => {
    setValue(min % 1 === 0 ? String(min) : min.toFixed(2));
    setError(null);
  }, [min, lot.id]);

  const parsed = Number(value.replace(/[^0-9.]/g, ""));

  const submit = async () => {
    if (busy) return;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t("room.bid.invalid"));
      return;
    }
    if (parsed < min) {
      setError(fill(t("room.bid.belowMin"), { min: formatUSD(min) }));
      return;
    }
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
              disabled={busy}
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
        <Button onClick={submit} disabled={busy} className="min-h-12 rounded-control px-6">
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
            <div key={i} className="h-11 rounded-control bg-muted animate-pulse" />
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
      className="overflow-hidden rounded-card border border-border bg-raised"
    >
      <SectionHeader
        icon={<ListPlus className="size-4 text-teal" aria-hidden="true" />}
        title={t("room.parade")}
        subtitle={t("room.paradeSub")}
      />
      {loading && lots.length === 0 ? (
        <div className="space-y-2 p-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 rounded-control bg-muted animate-pulse" />
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
