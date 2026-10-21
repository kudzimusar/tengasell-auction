"use client";

// Tengasell — My Tengasell sections (#/my/{section}). Task 5-a.
// Overview / Watchlist / Bids / Selling / Won / Profile.
// Every section: loading skeleton → error retry (useResource + bus
// events) → empty state. Counts are reported to the parent nav through
// the fetcher (async callback — never a render-phase setState).

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CreditCard,
  ExternalLink,
  Gavel,
  Heart,
  Loader2,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Package,
  Sparkles,
  Star,
  Store,
  Tag,
  Timer,
  TrendingUp,
  Trophy,
  Undo2,
  User,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LinkButton } from "./auth-shared";
import { OnboardingCard } from "./onboarding-card";
import {
  AuctionCard,
  Countdown,
  EmptyState,
  ErrorState,
  LoadingGrid,
  RatingStars,
  SectionHeader,
  VerifiedBadge,
  useNow,
} from "@/components/tengasell/ui";
import { api } from "@/lib/tengasell/api";
import { useI18n } from "@/lib/tengasell/i18n";
import { toast } from "@/hooks/use-toast";
import {
  formatDateTime,
  formatRelative,
  formatUSD,
  minNextBid,
  orderStatusLabel,
  parseImages,
} from "@/lib/tengasell/format";
import { useResource } from "@/lib/tengasell/hooks";
import { useLinkProps } from "@/lib/tengasell/router";
import type {
  Auction,
  Bid,
  CurrentUser,
  Notification,
  Order,
  OrderStatus,
} from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";

// ── shared bits ──────────────────────────────────────────────────────

export type MySection =
  | "overview"
  | "watchlist"
  | "bids"
  | "selling"
  | "won"
  | "searches" // Gap-8: saved searches + alerts
  | "offers" // Gap-8: my offers (Best-Offer)
  | "communications"
  | "earnings"
  | "tickets"
  | "privacy"
  | "security"
  | "profile";
export type MyCounts = Partial<Record<"watchlist" | "bids" | "selling" | "won", number>>;
export type OnCounts = (counts: MyCounts) => void;

/** Session-level count cache — survives route remounts (AnimatePresence). */
const countsCache: MyCounts = {};

export function readCountsCache(): MyCounts {
  return { ...countsCache };
}

export function makeCountReporter(
  setCounts: (action: (prev: MyCounts) => MyCounts) => void,
): OnCounts {
  return (c) => {
    Object.assign(countsCache, c);
    setCounts((prev) => ({ ...prev, ...c }));
  };
}

const AUCTION_EVENTS = ["auction:update", "auction:ended"] as const;

/** Response-time label: "~5m" / "~2h" / "~1d". */
export function responseLabel(minutes: number): string {
  if (minutes < 60) return `~${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}

function Chip({
  tone,
  uppercase = true,
  className,
  children,
}: {
  tone: "teal" | "danger" | "muted" | "gold" | "ok" | "warn";
  uppercase?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const tones = {
    teal: "bg-teal/10 text-teal-deep border-teal/30",
    danger: "bg-danger/10 text-danger border-danger/30",
    muted: "bg-muted text-muted-foreground border-border",
    gold: "bg-gold/15 text-gold-deep border-gold/40",
    ok: "bg-ok/10 text-ok border-ok/30",
    warn: "bg-warn/10 text-warn border-warn/30",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-bold whitespace-nowrap",
        tones[tone],
        uppercase && "uppercase tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}

function RowImage({ auction, size = "md" }: { auction: Auction; size?: "md" | "lg" }) {
  const link = useLinkProps(`/item/${auction.id}`);
  const img = parseImages(auction.images)[0] ?? "/brand/hero-main.png";
  return (
    <a
      {...link}
      tabIndex={-1}
      aria-hidden="true"
      className={cn(
        "block shrink-0 overflow-hidden rounded-control bg-muted",
        size === "md" ? "size-20 sm:size-24" : "size-24 sm:size-28",
      )}
    >
      <img src={img} alt="" loading="lazy" className="size-full object-cover" />
    </a>
  );
}

function SectionShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="my-section-heading" className="min-w-0">
      <SectionHeader
        title={<span id="my-section-heading">{title}</span>}
        subtitle={subtitle}
      />
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// ── OVERVIEW ─────────────────────────────────────────────────────────

const NOTIF_ICONS: Record<string, typeof Bell> = {
  outbid: Gavel,
  message: Mail,
  question: MessageCircleQuestion,
  won: Trophy,
  ending: Zap,
  order: Package,
  rating: Star,
  info: Bell,
};

export function OverviewSection({
  user,
  onCounts,
}: {
  user: CurrentUser;
  onCounts: OnCounts;
}) {
  const stats = useResource(
    async () => {
      const [watchlist, bids, selling, won, orders] = await Promise.all([
        api.watchlist(),
        api.myBids(),
        api.mySelling(),
        api.myWon(),
        api.orders("buying"),
      ]);
      onCounts({
        watchlist: watchlist.length,
        bids: bids.filter((b) => b.auction.status === "live").length,
        selling: selling.filter((a) => a.status === "live").length,
        won: Math.max(won.length, orders.length),
      });
      return { watchlist, bids, selling, won };
    },
    [],
    { events: ["auction:update", "auction:ended", "order:update"] },
  );

  // mark-read on view: reflects the "seen" state honestly, no loops
  const notifications = useResource(
    async () => {
      const items = await api.notifications();
      if (items.some((n) => !n.read)) {
        await api.markNotificationsRead().catch(() => {});
      }
      return items;
    },
    [],
    { events: ["notification:new"] },
  );

  const s = stats.data;
  const displayName = user.profile?.display_name ?? user.username;

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h2 className="text-headline text-foreground">
          Mhoro, {displayName} <span aria-hidden="true">👋</span>
          <span className="sr-only"> — mhoro means hello in Shona</span>
        </h2>
        <p className="text-caption text-muted-foreground mt-0.5">
          Here&apos;s your Tengasell at a glance.
        </p>
      </div>

      {/* stat cards */}
      {stats.loading && !s ? (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          aria-busy="true"
          aria-label="Loading your stats"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-raised p-4">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-8 w-12 mt-2" />
            </div>
          ))}
        </div>
      ) : stats.error ? (
        <ErrorState message={stats.error} onRetry={stats.reload} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={Heart} label="Watching" value={s?.watchlist.length ?? 0} to="/my/watchlist" />
          <StatCard
            icon={Gavel}
            label="Active bids"
            value={s?.bids.filter((b) => b.auction.status === "live").length ?? 0}
            to="/my/bids"
          />
          <StatCard
            icon={TrendingUp}
            label="Winning now"
            value={
              s?.bids.filter((b) => b.winning && b.auction.status === "live").length ?? 0
            }
            to="/my/bids"
            tone="ok"
          />
          <StatCard
            icon={Tag}
            label="Selling"
            value={s?.selling.filter((a) => a.status === "live").length ?? 0}
            to="/my/selling"
          />
          <StatCard
            icon={Store}
            label="Sales"
            value={user.profile ? user.profile.sales : "—"}
            to={`/u/${user.username}`}
          />
        </div>
      )}

      {/* 12-e EXP-009: onboarding checklist (single additive mount) */}
      <OnboardingCard user={user} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_264px]">
        {/* recent notifications */}
        <div className="rounded-card border border-border bg-raised overflow-hidden min-w-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Bell className="size-4 text-teal-soft" aria-hidden="true" />
            <h3 className="text-label font-bold text-foreground">Recent notifications</h3>
            <span className="ms-auto text-caption text-muted-foreground">Live via trade engine</span>
          </div>
          {notifications.loading && !notifications.data ? (
            <div className="px-4 py-3 space-y-4" aria-busy="true" aria-label="Loading notifications">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 items-center">
                  <Skeleton className="size-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.error ? (
            <div className="p-4">
              <ErrorState message={notifications.error} onRetry={notifications.reload} />
            </div>
          ) : (notifications.data ?? []).length === 0 ? (
            <p className="px-4 py-10 text-center text-caption text-muted-foreground">
              No notifications yet — watch an auction to get started.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto ts-scrollbar divide-y divide-border/60">
              {(notifications.data ?? []).slice(0, 8).map((n) => (
                <NotificationRow key={n.id} n={n} />
              ))}
            </ul>
          )}
        </div>

        {/* quick actions */}
        <aside className="rounded-card border border-border bg-raised p-4 space-y-2.5 h-fit">
          <h3 className="text-label font-bold text-foreground">Quick actions</h3>
          <LinkButton to="/sell/new" variant="gold" className="w-full">
            <Tag className="size-4" aria-hidden="true" />
            Sell an item
          </LinkButton>
          <LinkButton to="/search?ending=60" variant="outline" className="w-full">
            <Zap className="size-4 text-urgent" aria-hidden="true" />
            Browse ending soon
          </LinkButton>
          <LinkButton to="/assistant" className="w-full">
            <Sparkles className="size-4" aria-hidden="true" />
            Tenga AI
          </LinkButton>
          <p className="text-caption text-muted-foreground pt-1">
            48h payment window · 3-day dispatch · buyer protection on every deal.
          </p>
        </aside>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  to,
  tone,
}: {
  icon: typeof Bell;
  label: string;
  value: number | string;
  to: string;
  tone?: "ok";
}) {
  const link = useLinkProps(to);
  const reduced = useReducedMotion();
  return (
    <motion.a
      {...link}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className="group block rounded-card border border-border bg-raised p-4 transition-colors hover:border-teal/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`${label}: ${value}`}
    >
      <span className="flex items-center gap-1.5 text-caption font-semibold text-muted-foreground">
        <Icon className="size-4 text-teal-soft" aria-hidden="true" />
        {label}
      </span>
      <span
        className={cn(
          "mt-1 block text-headline ts-numeric font-extrabold",
          tone === "ok" ? "text-ok" : "text-foreground",
        )}
      >
        {value}
      </span>
    </motion.a>
  );
}

function NotificationRow({ n }: { n: Notification }) {
  const link = useLinkProps(n.link || "#/");
  const Icon = NOTIF_ICONS[n.type] ?? Bell;
  return (
    <li>
      <a
        {...link}
        className={cn(
          "flex gap-3 px-4 py-3 transition-colors hover:bg-accent/40",
          !n.read && "bg-gold-soft/30",
        )}
      >
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-teal-tint text-teal-deep">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-label font-semibold text-foreground">{n.title}</span>
          <span className="block text-caption text-muted-foreground line-clamp-2">{n.body}</span>
        </span>
        <time
          className="shrink-0 text-caption text-muted-foreground/80"
          title={formatDateTime(n.created_at)}
        >
          {formatRelative(n.created_at)}
        </time>
      </a>
    </li>
  );
}

// ── WATCHLIST ────────────────────────────────────────────────────────

export function WatchlistSection({ onCounts }: { onCounts: OnCounts }) {
  const res = useResource(
    () =>
      api.watchlist().then((items) => {
        onCounts({ watchlist: items.length });
        return [...items].sort((a, b) => {
          const live = (x: Auction) => (x.status === "live" ? 0 : 1);
          return live(a) - live(b) || a.ends_at.localeCompare(b.ends_at);
        });
      }),
    [],
    { events: [...AUCTION_EVENTS] },
  );

  const items = res.data ?? [];

  return (
    <SectionShell
      title="Watchlist"
      subtitle={`${items.length} auction${items.length === 1 ? "" : "s"} tracked · live countdowns`}
    >
      {res.loading && !res.data ? (
        <LoadingGrid />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Heart className="size-10" />}
          title="Nothing on your watchlist yet"
          body="Tap the star on any auction to track it here — we'll show live countdowns and alert you before it ends."
          action={
            <LinkButton to="/search?ending=60" variant="gold">
              <Zap className="size-4" aria-hidden="true" />
              Find something to watch
            </LinkButton>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {items.map((a) => (
            <AuctionCard key={a.id} auction={a} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

// ── BIDS ─────────────────────────────────────────────────────────────

type MyBidRow = { auction: Auction; myMax: number; winning: boolean; active: Bid | undefined };

export function BidsSection({ onCounts }: { onCounts: OnCounts }) {
  const res = useResource(
    () =>
      api.myBids().then((rows) => {
        onCounts({ bids: rows.filter((r) => r.auction.status === "live").length });
        return [...rows].sort((a, b) => {
          const live = (x: MyBidRow) => (x.auction.status === "live" ? 0 : 1);
          return live(a) - live(b) || a.auction.ends_at.localeCompare(b.auction.ends_at);
        });
      }),
    [],
    { events: [...AUCTION_EVENTS, "order:update"] },
  );

  const rows = res.data ?? [];

  return (
    <SectionShell
      title="Your bids"
      subtitle="Proxy bidding — you set a maximum, Tengasell bids the minimum needed to win"
    >
      {res.loading && !res.data ? (
        <RowSkeletons />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Gavel className="size-10" />}
          title="You haven't bid on anything yet"
          body="Place your first bid — set your true maximum and let automatic bidding do the work."
          action={<LinkButton to="/search">Browse auctions</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <BidRowItem key={row.auction.id} row={row} onReload={res.reload} />
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

function BidRowItem({ row, onReload }: { row: MyBidRow; onReload: () => void }) {
  const { t } = useI18n();
  const [retractOpen, setRetractOpen] = useState(false);
  const now = useNow();
  const a = row.auction;
  const link = useLinkProps(`/item/${a.id}`);
  const live = a.status === "live" && Date.parse(a.ends_at) > now;
  const state: "winning" | "outbidden" | "ended" = !live
    ? "ended"
    : row.winning
      ? "winning"
      : "outbidden";
  const next = minNextBid(a.current_price, a.bid_count);

  return (
    <li className="rounded-card border border-border bg-raised p-3 sm:p-4 flex flex-wrap gap-3 sm:gap-4">
      <RowImage auction={a} />
      <div className="min-w-0 flex-1 flex flex-wrap gap-x-4 gap-y-1 items-center justify-between">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <a
            {...link}
            className="text-bodyStrong text-foreground hover:text-teal transition-colors line-clamp-2"
          >
            {a.title}
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
            <span className="ts-numeric">
              Current{" "}
              <span className="font-bold text-teal">{formatUSD(a.current_price)}</span>
            </span>
            <span className="ts-numeric">
              My max <span className="font-semibold text-foreground">{formatUSD(row.myMax)}</span>
            </span>
            <span className="ts-numeric">
              {a.bid_count} bid{a.bid_count === 1 ? "" : "s"}
            </span>
            <Countdown endsAt={a.ends_at} ended={!live} />
          </div>
        </div>
        <div className="flex items-center gap-2 ms-auto">
          {state === "winning" && <Chip tone="teal">Winning</Chip>}
          {state === "outbidden" && <Chip tone="danger">Outbidden</Chip>}
          {state === "ended" && (
            <Chip tone={a.status === "sold" ? "gold" : "muted"}>
              {a.status === "sold" ? "Sold" : "Ended"}
            </Chip>
          )}
          {/* Gap-8 F2: retract the lead bid within the 60-minute window */}
          {live && row.active && (
            <Button
              variant="outline"
              onClick={() => setRetractOpen(true)}
              title={t("bidretract.lead")}
              className="min-h-11 rounded-control px-3 text-caption"
            >
              <Undo2 className="size-4" aria-hidden="true" />
              {t("bidretract.action")}
            </Button>
          )}
          {live && (
            <LinkButton
              to={`/item/${a.id}`}
              variant={state === "outbidden" ? "primary" : "outline"}
              className="px-4"
            >
              {state === "winning" ? "Raise max" : "Bid again"}
              <span className="ts-numeric opacity-80"> · {formatUSD(next)}</span>
            </LinkButton>
          )}
          {!live && (
            <LinkButton to={`/item/${a.id}`} variant="ghost" className="px-3">
              View result
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </LinkButton>
          )}
        </div>
      </div>

      <BidRetractDialog
        bid={row.active ?? null}
        open={retractOpen}
        onOpenChange={setRetractOpen}
        onDone={onReload}
      />
    </li>
  );
}

/** Gap-8 F2: retract-bid dialog — 60-minute lead window, reason ≥10 chars
 *  (the seller sees it). Engine refusals render inline. */
function BidRetractDialog({
  bid,
  open,
  onOpenChange,
  onDone,
}: {
  bid: Bid | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (busy || !bid) return;
    if (reason.trim().length < 10) {
      setError(t("bidretract.reasonShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.retractBid(bid.id, reason.trim());
      toast({ title: t("bidretract.done") });
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("bidretract.reasonShort"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-5 text-urgent" aria-hidden="true" />
            {t("bidretract.title")}
          </DialogTitle>
          <DialogDescription>{t("bidretract.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="ts-my-retract-reason" className="text-label text-foreground">
              {t("bidretract.reasonLabel")}
            </label>
            <Textarea
              id="ts-my-retract-reason"
              rows={3}
              maxLength={200}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              disabled={busy}
              aria-invalid={!!error}
              aria-describedby="ts-my-retract-hint"
            />
            <p id="ts-my-retract-hint" className="text-caption text-muted-foreground">
              {t("bidretract.reasonHint")}
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-control border border-danger/40 bg-danger/10 text-urgent text-caption font-medium p-3"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="min-h-11 rounded-control"
            >
              {t("action.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={submit}
              disabled={busy}
              className="min-h-11 rounded-control"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("bidretract.working")}
                </>
              ) : (
                <>
                  <Undo2 className="size-4" aria-hidden="true" />
                  {t("bidretract.title")}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── SELLING ──────────────────────────────────────────────────────────

export function SellingSection({ onCounts }: { onCounts: OnCounts }) {
  const res = useResource(
    () =>
      api.mySelling().then((items) => {
        onCounts({ selling: items.filter((a) => a.status === "live").length });
        return items;
      }),
    [],
    { events: [...AUCTION_EVENTS, "question:update"] },
  );

  const items = res.data ?? [];

  return (
    <SectionShell
      title="Selling"
      subtitle={`${items.filter((a) => a.status === "live").length} live listing${
        items.filter((a) => a.status === "live").length === 1 ? "" : "s"
      } · first 50 listings each month are free`}
    >
      {res.loading && !res.data ? (
        <RowSkeletons />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Tag className="size-10" />}
          title="You haven't listed anything yet"
          body="Turn your extras into US dollars — a photo, a start price and two minutes is all it takes."
          action={
            <LinkButton to="/sell/new" variant="gold">
              <Tag className="size-4" aria-hidden="true" />
              Sell an item
            </LinkButton>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
            <SellingRowItem key={a.id} auction={a} />
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

function SellingRowItem({ auction: a }: { auction: Auction }) {
  const now = useNow();
  const link = useLinkProps(`/item/${a.id}`);
  const live = a.status === "live" && Date.parse(a.ends_at) > now;
  const reserveMet =
    a.reserve_price == null ? null : a.current_price >= a.reserve_price;

  return (
    <li className="rounded-card border border-border bg-raised p-3 sm:p-4 flex flex-wrap gap-3 sm:gap-4">
      <RowImage auction={a} />
      <div className="min-w-0 flex-1 flex flex-wrap gap-x-4 gap-y-1 items-center justify-between">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <a
            {...link}
            className="text-bodyStrong text-foreground hover:text-teal transition-colors line-clamp-2"
          >
            {a.title}
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
            <span className="ts-numeric font-bold text-teal">{formatUSD(a.current_price)}</span>
            <span className="ts-numeric">
              {a.bid_count} bid{a.bid_count === 1 ? "" : "s"}
            </span>
            <span className="ts-numeric">{a.watch_count} watching</span>
            {reserveMet != null && (
              <span className={reserveMet ? "text-ok font-semibold" : "text-warn font-semibold"}>
                {reserveMet ? "Reserve met ✓" : "Reserve not met"}
              </span>
            )}
            {live && <Countdown endsAt={a.ends_at} />}
          </div>
        </div>
        <div className="flex items-center gap-2 ms-auto">
          {live ? (
            <Chip tone="teal">
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-ok animate-pulse" aria-hidden="true" />
                Live
              </span>
            </Chip>
          ) : a.status === "sold" ? (
            <Chip tone="gold">Sold</Chip>
          ) : (
            <Chip tone="muted">{a.status === "cancelled" ? "Cancelled" : "Ended"}</Chip>
          )}
          <LinkButton to={`/item/${a.id}`} variant="outline" className="px-4">
            View listing
          </LinkButton>
          <LinkButton to={`/item/${a.id}`} variant="ghost" className="px-3">
            <MessageCircleQuestion className="size-4" aria-hidden="true" />
            Questions
          </LinkButton>
        </div>
      </div>
    </li>
  );
}

// ── WON ──────────────────────────────────────────────────────────────

type WonRow = { order: Order | null; auction: Auction | null };

export function WonSection({ onCounts }: { onCounts: OnCounts }) {
  const res = useResource(
    async () => {
      const [won, orders] = await Promise.all([api.myWon(), api.orders("buying")]);
      onCounts({ won: Math.max(won.length, orders.length) });
      const rows: WonRow[] = orders.map((order) => ({
        order,
        auction: won.find((a) => a.id === order.auction_id) ?? null,
      }));
      for (const a of won) {
        if (!orders.some((o) => o.auction_id === a.id)) rows.push({ order: null, auction: a });
      }
      rows.sort((a, b) => {
        const ta = a.order ? Date.parse(a.order.created_at) : 0;
        const tb = b.order ? Date.parse(b.order.created_at) : 0;
        return tb - ta;
      });
      return rows;
    },
    [],
    { events: ["order:update", ...AUCTION_EVENTS] },
  );

  const rows = res.data ?? [];

  return (
    <SectionShell
      title="Won"
      subtitle="Wins, payments and delivery — the 48-hour payment window applies to every win"
    >
      {res.loading && !res.data ? (
        <RowSkeletons />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-10" />}
          title="No wins yet"
          body="When you win an auction it lands here with payment, dispatch and delivery tracking."
          action={
            <LinkButton to="/search?ending=60" variant="gold">
              <Zap className="size-4" aria-hidden="true" />
              Browse ending soon
            </LinkButton>
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <WonRowItem key={row.order?.id ?? `a-${row.auction?.id}`} row={row} />
          ))}
        </ul>
      )}
    </SectionShell>
  );
}

function orderTone(status: OrderStatus): "teal" | "gold" | "ok" | "danger" | "muted" {
  switch (status) {
    case "pending_payment":
      return "gold";
    case "paid":
    case "shipped":
      return "teal";
    case "delivered":
    case "completed":
      return "ok";
    case "cancelled":
    case "disputed":
      return "danger";
    default:
      return "muted";
  }
}

function WonRowItem({ row }: { row: WonRow }) {
  const { order, auction } = row;
  const title = auction?.title ?? order?.auction_title ?? "Auction";
  const price = order?.final_price ?? auction?.current_price ?? 0;
  const orderLink = useLinkProps(order ? `/orders/${order.id}` : `/item/${auction?.id ?? 0}`);
  const img = auction ? parseImages(auction.images)[0] : undefined;

  return (
    <li className="rounded-card border border-border bg-raised p-3 sm:p-4 flex flex-wrap gap-3 sm:gap-4">
      <a
        {...orderLink}
        tabIndex={-1}
        aria-hidden="true"
        className="block shrink-0 size-20 sm:size-24 overflow-hidden rounded-control bg-muted"
      >
        <img
          src={img ?? "/brand/hero-main.png"}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
      </a>
      <div className="min-w-0 flex-1 flex flex-wrap gap-x-4 gap-y-1 items-center justify-between">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <a {...orderLink} className="text-bodyStrong text-foreground hover:text-teal transition-colors line-clamp-2">
            {title}
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
            <span className="ts-numeric font-bold text-teal">{formatUSD(price)}</span>
            <span className="ts-numeric">from @{order?.seller_username ?? "—"}</span>
            {order ? (
              <Chip tone={orderTone(order.status)} uppercase={false}>
                {orderStatusLabel(order.status)}
              </Chip>
            ) : (
              <Chip tone="teal">Order being created</Chip>
            )}
            {order?.status === "pending_payment" && order.pay_by && (
              <span className="ts-numeric text-warn font-semibold">
                Pay within <Countdown endsAt={order.pay_by} />
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 ms-auto">
          {order?.status === "pending_payment" && (
            <LinkButton to={`/orders/${order.id}`} variant="gold" className="px-4">
              <CreditCard className="size-4" aria-hidden="true" />
              Pay now
            </LinkButton>
          )}
          {(order?.status === "delivered" || order?.status === "completed") && (
            <LinkButton to={`/orders/${order.id}`} variant="gold" className="px-4">
              <Star className="size-4" aria-hidden="true" />
              Rate seller
            </LinkButton>
          )}
          <LinkButton to={order ? `/orders/${order.id}` : "/orders"} variant="ghost" className="px-3">
            View order
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </LinkButton>
        </div>
      </div>
    </li>
  );
}

// ── PROFILE (own, read-only) ─────────────────────────────────────────

export function ProfileSection({ user }: { user: CurrentUser }) {
  const p = user.profile;

  if (!p) {
    return (
      <SectionShell title="Your profile" subtitle="What buyers see at your public page">
        <EmptyState
          icon={<User className="size-10" />}
          title="Profile is syncing"
          body="Your profile row is being created on the backend — refresh in a moment."
        />
      </SectionShell>
    );
  }

  return (
    <SectionShell title="Your profile" subtitle={`What buyers see at #/u/${p.username}`}>
      <div className="space-y-4 min-w-0">
        <div className="rounded-card border border-border bg-raised p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-label font-bold text-foreground">Account</span>
            {p.verified === 1 && (
              <span className="inline-flex items-center gap-1 text-caption font-semibold text-teal">
                <VerifiedBadge className="size-4" />
                Verified seller
              </span>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="my-username" className="text-label font-semibold text-foreground">
                Username
              </label>
              <Input id="my-username" value={`@${p.username}`} readOnly disabled className="h-11 font-mono" />
              <p className="text-caption text-muted-foreground">Usernames are permanent and public.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="my-display-name" className="text-label font-semibold text-foreground">
                Display name
              </label>
              <Input id="my-display-name" value={p.display_name} readOnly disabled className="h-11" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="my-bio" className="text-label font-semibold text-foreground">
              Bio
            </label>
            <Textarea id="my-bio" value={p.bio} readOnly disabled rows={3} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="my-city" className="text-label font-semibold text-foreground">
                City
              </label>
              <Input id="my-city" value={p.city || "—"} readOnly disabled className="h-11" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="my-joined" className="text-label font-semibold text-foreground">
                Member since
              </label>
              <Input
                id="my-joined"
                value={formatDateTime(p.joined_at, { withTime: false })}
                readOnly
                disabled
                className="h-11"
              />
            </div>
          </div>
        </div>

        <div className="rounded-control border border-teal/25 bg-teal-tint p-4">
          <p className="text-label font-bold text-teal-deep">Profile editing arrives with the accounts API</p>
          <p className="text-caption text-muted-foreground mt-1">
            Display name, bio and city will become editable once account updates ship on the
            backend. Your rating, sales and response stats below update automatically as you trade.
          </p>
        </div>

        {/* stats band */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile icon={Star} label="Rating" value={<RatingStars value={p.rating_avg} count={p.rating_count} />} />
          <StatTile icon={Store} label="Sales" value={<span className="text-headline ts-numeric font-extrabold text-foreground">{p.sales}</span>} />
          <StatTile icon={Timer} label="Response time" value={<span className="text-headline ts-numeric font-extrabold text-foreground">{responseLabel(p.response_minutes)}</span>} />
          <StatTile
            icon={MapPin}
            label="City"
            value={<span className="text-title font-bold text-foreground truncate">{p.city || "—"}</span>}
          />
        </div>

        <div>
          <LinkButton to={`/u/${p.username}`} variant="outline">
            <ExternalLink className="size-4" aria-hidden="true" />
            View your public profile
          </LinkButton>
        </div>
      </div>
    </SectionShell>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bell;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-card border border-border bg-raised p-4">
      <span className="flex items-center gap-1.5 text-caption font-semibold text-muted-foreground">
        <Icon className="size-4 text-teal-soft" aria-hidden="true" />
        {label}
      </span>
      <div className="mt-1.5 min-h-8">{value}</div>
    </div>
  );
}

// ── shared row skeleton ──────────────────────────────────────────────

function RowSkeletons() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading list">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-card border border-border bg-raised p-3 sm:p-4 flex gap-3 sm:gap-4">
          <Skeleton className="size-20 sm:size-24 rounded-control shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
