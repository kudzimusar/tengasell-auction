"use client";

// Tengasell item page — Yahoo Auctions × eBay hybrid detail page.
// Gallery + tabs on the left (≈55% desktop), sticky bid panel on the right,
// realtime bus refresh (auction:update / auction:ended / question:update),
// terminal banners for ended/sold auctions and a "You won" CTA.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock4,
  Eye,
  Gavel,
  Handshake,
  Loader2,
  MapPin,
  MessageCircle,
  MessageCircleQuestion,
  Package,
  SearchX,
  Star,
  Trophy,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { bus } from "@/lib/tengasell/bus";
import { useAuction, useCategories, useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import {
  toAuctionView,
  type Auction,
  type Bid,
  type CurrentUser,
  type Offer,
  type Order,
} from "@/lib/tengasell/types";
import {
  compactNumber,
  conditionLabel,
  formatDateTime,
  formatRelative,
  formatUSD,
  round2,
  shippingLabel,
} from "@/lib/tengasell/format";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Avatar,
  BidRules,
  Countdown,
  EmptyState,
  ErrorState,
  PriceTag,
  RatingStars,
  StatusPill,
  VerifiedBadge,
} from "@/components/tengasell/ui";
import { cn } from "@/lib/utils";
import { Gallery } from "./gallery";
import { BidSheet } from "./bid-sheet";
import { QaSection } from "./qa-section";
import { ShippingPayments } from "./shipping-payments";
import { maskUsername } from "./helpers";
import { SimilarItems } from "./similar-items";
import { SellerFeedback } from "./seller-feedback";
import { ShareMenu } from "./share-menu";
import { ReportItemButton } from "./report-item-button";
import { VehicleDetails } from "./vehicle-details";

// ── Gap-8 F2 helpers ─────────────────────────────────────────────────
/** Engine offer-broadcast payload (trade-engine emits { auctionId, offer }).
 *  The shared bus EventMap predates "offer:update" (bus.ts is orchestrator-
 *  owned), so subscribe through a typed widening shim. */
type OfferUpdatePayload = { auctionId: number; offer: Offer };

function onOfferUpdate(handler: (p: OfferUpdatePayload) => void): () => void {
  return (
    bus as unknown as {
      on: (e: string, h: (p: OfferUpdatePayload) => void) => () => void;
    }
  ).on("offer:update", handler);
}

export default function ItemPage({ id }: { id: number }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const { navigate } = useRouter();
  const reduced = useReducedMotion();
  const { categories } = useCategories();

  // ── data (realtime via bus events) ─────────────────────────────────
  const auctionRes = useAuction(id);
  const auction = auctionRes.data;
  const view = useMemo(() => (auction ? toAuctionView(auction) : null), [auction]);

  const sellerRes = useResource(
    () => (auction ? api.profile(auction.seller_username) : Promise.resolve(null)),
    [auction?.seller_username],
  );
  const sellerProfile = sellerRes.data;

  const bidsRes = useResource(() => api.bids(id), [id], {
    events: ["auction:update", "auction:ended"],
  });

  const questionsRes = useResource(() => api.questions(id), [id], {
    events: ["question:update"],
  });

  // "won by me" detection — buying orders for this auction (status gates the
  // fetch so we only hit it once the auction leaves "live").
  const ordersRes = useResource<Order[]>(
    () =>
      user && auction && auction.status !== "live"
        ? api.orders("buying")
        : Promise.resolve([] as Order[]),
    [user?.username, auction?.status, auction?.id],
    { events: ["order:update", "auction:ended"] },
  );
  const wonOrder = useMemo(
    () => ordersRes.data?.find((o) => o.auction_id === id) ?? null,
    [ordersRes.data, id],
  );

  // ── Gap-8 F2: Best-Offer data (public read; rows shown per-viewer) ─
  const [offerOpen, setOfferOpen] = useState(false);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [offersLoading, setOffersLoading] = useState(true);
  const loadOffers = useCallback(async () => {
    setOffersLoading(true);
    try {
      const list = await api.offersFor(id);
      setOffers(list);
    } catch {
      /* keep the previous list — the panel degrades to the public count */
    } finally {
      setOffersLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);
  // realtime: engine broadcasts offer:update (submit/accept/counter/expire)
  useEffect(
    () =>
      onOfferUpdate(({ auctionId }) => {
        if (auctionId === id) void loadOffers();
      }),
    [id, loadOffers],
  );

  // imperative refresh after a placed bid — no memo needed (never a dep)
  const refreshAll = () => {
    auctionRes.reload();
    bidsRes.reload();
    ordersRes.reload();
  };

  // post-deadline sweep: if the countdown hit zero but the engine hasn't
  // flipped the status yet, poll until the bus event lands.
  useEffect(() => {
    if (!auction || auction.status !== "live") return;
    const endsMs = Date.parse(auction.ends_at);
    if (isNaN(endsMs)) return;
    const iv = setInterval(() => {
      if (Date.now() >= endsMs) auctionRes.reload();
    }, 15_000);
    return () => clearInterval(iv);
  }, [auction, auctionRes]);

  // ── watch / share ──────────────────────────────────────────────────
  const [watching, setWatching] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const w = user ? await api.watchState(id) : false;
        if (alive) setWatching(w);
      } catch {
        /* watch state unavailable — leave as-is */
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, id]);

  const toggleWatch = async () => {
    if (!user) {
      toast({
        title: "Sign in to watch auctions",
        description: "Create a free account to track this item.",
      });
      return;
    }
    try {
      await api.watch(id, !watching);
      setWatching(!watching);
      toast({
        title: watching ? "Removed from watchlist" : "Added to watchlist",
        description: watching ? undefined : "We'll alert you before it ends.",
      });
    } catch (err) {
      toast({
        title: "Could not update watchlist",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  // ── ui state ───────────────────────────────────────────────────────
  const [bidOpen, setBidOpen] = useState(false);
  const [tab, setTab] = useState("description");

  const scrollToFeedback = useCallback(() => {
    document
      .getElementById("seller-feedback")
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [reduced]);

  const homeLink = useLinkProps("/");
  const askLink = useLinkProps("/messages");
  const sellerLink = useLinkProps(`/u/${auction?.seller_username ?? ""}`);
  const category = useMemo(
    () => categories.find((c) => c.slug === auction?.category),
    [categories, auction?.category],
  );
  const categoryLink = useLinkProps(`/c/${auction?.category ?? ""}`);
  const ordersLink = useLinkProps(wonOrder ? `/orders/${wonOrder.id}` : "/orders");

  // ── states: loading / error / 404 ──────────────────────────────────
  if (auctionRes.loading) return <ItemPageSkeleton />;
  if (auctionRes.error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState message={auctionRes.error} onRetry={auctionRes.reload} />
      </div>
    );
  }
  if (!auction || !view) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <EmptyState
          icon={<SearchX className="size-10" />}
          title="Auction not found"
          body="This listing may have ended, been removed by the seller, or the link is incorrect."
          action={
            <Button onClick={() => navigate("/")} className="min-h-11 px-6 rounded-control">
              Back to home
            </Button>
          }
        />
      </div>
    );
  }

  // ── derived ────────────────────────────────────────────────────────
  const own = !!user && user.username === auction.seller_username;
  const isLive = auction.status === "live";
  // Gap-8 F2: seller-or-admin sees full offer management; buyers get the CTA
  const isSellerView = own || !!user?.admin;
  const canOffer = auction.allow_offers === 1 && isLive && !!user && !own;
  const canBuyNow =
    auction.buy_now_price != null && auction.bid_count === 0 && isLive;
  const bidCount = bidsRes.data?.length ?? auction.bid_count;
  const questionCount = questionsRes.data?.length ?? 0;
  const joinedYear = (() => {
    if (!sellerProfile?.joined_at) return "—";
    const d = new Date(sellerProfile.joined_at);
    return isNaN(d.getTime()) ? "—" : String(d.getFullYear());
  })();

  let endedTitle = "Auction ended";
  let endedSub = "This listing is closed.";
  if (auction.status === "sold") {
    endedTitle = "Sold — winner notified";
    endedSub = "The winner has been notified; payment is due within 48h (SLA).";
  } else if (auction.status === "ended") {
    endedSub = "No winning bid — the item was not sold.";
  } else if (auction.status === "cancelled") {
    endedTitle = "Auction cancelled";
    endedSub = "The seller cancelled this listing.";
  }

  // ── render ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6">
      {/* breadcrumb — hidden on mobile: native apps use screen titles +
          back gesture, and the space is better spent on content; the sticky
          bid bar below provides the primary actions instead. */}
      <nav aria-label="Breadcrumb" className="mb-3 hidden sm:block">
        <ol className="flex items-center gap-1.5 text-caption text-muted-foreground min-w-0">
          <li className="shrink-0">
            <a {...homeLink} className="hover:text-teal transition-colors">
              Home
            </a>
          </li>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          <li className="shrink-0 min-w-0">
            <a {...categoryLink} className="hover:text-teal transition-colors truncate block max-w-28 sm:max-w-44">
              {category?.name ?? auction.category}
            </a>
          </li>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          <li aria-current="page" className="truncate min-w-0">
            {auction.title}
          </li>
        </ol>
      </nav>

      {/* terminal banner (ended / sold / won) */}
      {auction.status !== "live" && (
        <div
          role="status"
          className={cn(
            "mb-4 rounded-card border p-4 flex flex-wrap items-center justify-between gap-3",
            wonOrder ? "border-ok/40 bg-ok/10" : "border-border bg-muted/60",
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={cn(
                "size-10 shrink-0 grid place-items-center rounded-full",
                wonOrder ? "bg-ok/15 text-ok" : "bg-muted text-muted-foreground",
              )}
            >
              <Trophy className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-title text-foreground">
                {wonOrder ? "You won — pay within 48h" : endedTitle}
              </p>
              <p className="text-caption text-muted-foreground">
                {wonOrder
                  ? `Winning bid ${formatUSD(wonOrder.final_price)} — complete payment by ${formatDateTime(wonOrder.pay_by ?? auction.ends_at)} to keep the item.`
                  : endedSub}
              </p>
            </div>
          </div>
          {wonOrder && (
            <Button asChild className="min-h-11 rounded-control shrink-0">
              <a {...ordersLink}>Go to orders &amp; pay</a>
            </Button>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-6 lg:gap-8 items-start">
        {/* ── left: gallery + tabs ─────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          <Gallery key={auction.id} auction={view} />

          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList className="w-full h-auto flex-wrap p-1 gap-0.5 rounded-control">
              <TabsTrigger value="description" className="min-h-11 flex-1 px-2 text-label rounded-control">
                Description
              </TabsTrigger>
              <TabsTrigger value="bids" className="min-h-11 flex-1 px-2 text-label rounded-control gap-1.5">
                Bid history
                <span className="rounded-pill bg-muted px-1.5 py-0.5 text-[10px] font-bold ts-numeric">
                  {bidCount}
                </span>
              </TabsTrigger>
              <TabsTrigger value="qa" className="min-h-11 flex-1 px-2 text-label rounded-control gap-1.5">
                Q&amp;A
                <span className="rounded-pill bg-muted px-1.5 py-0.5 text-[10px] font-bold ts-numeric">
                  {questionCount}
                </span>
              </TabsTrigger>
              {auction.asset_kind === "vehicle" && (
                <TabsTrigger value="vehicle" className="min-h-11 flex-1 px-2 text-label rounded-control gap-1.5">
                  Vehicle
                  <span className="hidden sm:inline"> / inspection</span>
                </TabsTrigger>
              )}
              <TabsTrigger value="shipping" className="min-h-11 flex-1 px-2 text-label rounded-control">
                <span className="hidden sm:inline">Shipping &amp; payments</span>
                <span className="sm:hidden">Shipping</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="description" className="pt-4">
              <div className="space-y-6">
                <section aria-labelledby="ts-desc-heading">
                  <h3 id="ts-desc-heading" className="text-label text-muted-foreground mb-2">
                    Item description
                  </h3>
                  <p className="text-body text-foreground whitespace-pre-line leading-relaxed">
                    {auction.description || "The seller did not add a description for this item."}
                  </p>
                </section>

                <section aria-labelledby="ts-specifics-heading">
                  <h3 id="ts-specifics-heading" className="text-label text-muted-foreground mb-2">
                    Item specifics
                  </h3>
                  <dl className="grid sm:grid-cols-2 gap-3">
                    <SpecRow label="Condition" value={conditionLabel(auction.condition)} />
                    <SpecRow
                      label="Category"
                      value={category?.name ?? auction.category}
                      linkProps={categoryLink}
                    />
                    <SpecRow label="Location" value={auction.city || "—"} />
                    <SpecRow
                      label="Shipping"
                      value={shippingLabel(auction.shipping, auction.shipping_fee)}
                    />
                    <SpecRow label="Item no." value={`#${auction.id}`} />
                    <SpecRow label="Listed" value={formatDateTime(auction.started_at)} />
                  </dl>
                </section>

                {questionCount > 0 && (
                  <button
                    onClick={() => setTab("qa")}
                    className="flex items-center gap-2 text-caption font-semibold text-teal hover:underline min-h-11"
                  >
                    <MessageCircleQuestion className="size-4" aria-hidden="true" />
                    Q&amp;A ({questionCount}) — see answered questions
                  </button>
                )}
              </div>
            </TabsContent>

            <TabsContent value="bids">
              {/* Gap-8 F2: retract-aware history (own active lead bid can be
                  retracted; retracted rows render dimmed with a reason tooltip) */}
              <BidHistoryPanel
                auction={auction}
                bids={bidsRes.data}
                loading={bidsRes.loading}
                onChanged={refreshAll}
              />
            </TabsContent>

            <TabsContent value="qa">
              <QaSection
                auction={auction}
                questions={questionsRes.data}
                loading={questionsRes.loading}
                reload={questionsRes.reload}
              />
            </TabsContent>

            {auction.asset_kind === "vehicle" && (
              <TabsContent value="vehicle" className="pt-4">
                <VehicleDetails auctionId={auction.id} />
              </TabsContent>
            )}

            <TabsContent value="shipping" className="pt-4">
              <ShippingPayments auction={auction} />
            </TabsContent>
          </Tabs>
        </div>

        {/* ── right: sticky bid panel ───────────────────────────────── */}
        <aside className="lg:sticky lg:top-28 space-y-4 min-w-0" aria-label="Auction summary">
          <div className="space-y-2">
            <h1 className="text-headline text-foreground leading-snug">{auction.title}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Package className="size-3.5" aria-hidden="true" />
                {conditionLabel(auction.condition)}
              </span>
              {auction.city && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {auction.city}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 ts-numeric">
                <Eye className="size-3.5" aria-hidden="true" />
                {compactNumber(auction.views)} views
              </span>
              <span className="inline-flex items-center gap-1.5 ts-numeric">
                <Star className="size-3.5" aria-hidden="true" />
                {compactNumber(auction.watch_count)} watching
              </span>
            </div>
          </div>

          <div className="rounded-card border border-border bg-raised p-4 sm:p-5 space-y-4">
            {/* price + countdown */}
            <div>
              <p className="text-label text-muted-foreground">{t("bid.current")}</p>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <PriceTag amount={auction.current_price} size="xl" tone="teal" />
                <span className="text-caption text-muted-foreground ts-numeric">
                  {auction.bid_count} {t("bid.bids")}
                </span>
              </div>
            </div>

            <div className="rounded-control bg-muted/60 p-3 space-y-1">
              <p className="text-caption text-muted-foreground">{t("bid.timeLeft")}</p>
              <Countdown
                endsAt={auction.ends_at}
                ended={!isLive}
                className="text-headline"
              />
              <p className="text-caption text-muted-foreground ts-numeric">
                Ends {formatDateTime(auction.ends_at)}
              </p>
              {auction.extension_count > 0 && (
                <p className="text-caption font-semibold text-teal flex items-center gap-1">
                  <Clock4 className="size-3.5" aria-hidden="true" />
                  Extended ×{auction.extension_count} (anti-snipe)
                </p>
              )}
            </div>

            {/* reserve indicator */}
            {auction.reserve_price != null && view.reserveMet === false && (
              <p className="flex items-center gap-1.5 text-caption font-semibold text-warn">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Reserve price not met
              </p>
            )}
            {auction.reserve_price != null && view.reserveMet === true && auction.bid_count > 0 && (
              <p className="flex items-center gap-1.5 text-caption font-semibold text-ok">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Reserve met
              </p>
            )}

            {/* buy now (gold, until first bid) */}
            {canBuyNow && auction.buy_now_price != null && (
              <div className="space-y-1.5">
                <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
                  <Button
                    onClick={() => navigate(`/checkout/${auction.id}`)}
                    className="w-full min-h-12 text-bodyStrong rounded-control bg-gold text-gold-on hover:bg-gold/90 shadow-sm"
                  >
                    <Zap className="size-5" aria-hidden="true" />
                    {t("action.buyNow")} — {formatUSD(auction.buy_now_price)}
                  </Button>
                </motion.div>
                <p className="text-caption text-muted-foreground text-center">
                  Instant purchase — disappears after the first bid
                </p>
              </div>
            )}

            {/* place bid */}
            <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
              <Button
                onClick={() => setBidOpen(true)}
                disabled={!isLive}
                aria-haspopup="dialog"
                className="w-full min-h-12 text-bodyStrong rounded-control"
              >
                <Gavel className="size-5" aria-hidden="true" />
                {isLive ? t("action.bid") : "Bidding closed"}
              </Button>
            </motion.div>
            {/* Gap-8 F2: Best-Offer secondary CTA (offers-enabled live items) */}
            {canOffer && (
              <Button
                variant="outline"
                onClick={() => setOfferOpen(true)}
                aria-haspopup="dialog"
                className="w-full min-h-11 rounded-control"
              >
                <Handshake className="size-4" aria-hidden="true" />
                {t("itemoffer.make")}
              </Button>
            )}

            {own && (
              <p className="text-caption text-gold-deep text-center font-semibold">
                This is your listing — you can&apos;t bid on it.
              </p>
            )}

            {/* watch / share / ask */}
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                onClick={toggleWatch}
                aria-pressed={!!watching}
                className="min-h-11 rounded-control"
              >
                <Star
                  className={cn("size-4", watching && "fill-gold text-gold")}
                  aria-hidden="true"
                />
                <span className="truncate">
                  {watching ? t("action.watching") : t("action.watch")}
                </span>
              </Button>
              <ShareMenu auctionId={auction.id} title={auction.title} />
              <ReportItemButton
                auctionId={auction.id}
                sellerUsername={auction.seller_username}
              />
              <Button asChild variant="outline" className="min-h-11 rounded-control">
                <a {...askLink}>
                  <MessageCircle className="size-4" aria-hidden="true" />
                  <span className="truncate">Ask seller</span>
                </a>
              </Button>
            </div>
          </div>

          {/* Gap-8 F2: offers block — public count, buyer's own rows,
              full seller management (accept / decline / counter) */}
          <ItemOffersPanel
            auction={auction}
            offers={offers}
            loading={offersLoading}
            viewer={user}
            onChanged={() => {
              void loadOffers();
              auctionRes.reload();
            }}
          />

          <BidRules auction={auction} />

          {/* seller card (Yahoo-style box) */}
          <div className="rounded-card border border-border bg-raised p-4 space-y-3">
            <p className="text-label text-muted-foreground">Seller</p>
            <div className="flex items-center gap-3">
              <Avatar username={auction.seller_username} size={44} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <a
                    {...sellerLink}
                    className="text-label font-bold text-foreground hover:text-teal transition-colors truncate"
                  >
                    {sellerProfile?.display_name ?? auction.seller_username}
                  </a>
                  {sellerProfile?.verified === 1 && <VerifiedBadge />}
                </div>
                <RatingStars
                  value={sellerProfile?.rating_avg ?? 0}
                  count={sellerProfile?.rating_count}
                />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-control bg-muted/60 p-2">
                <dt className="text-caption text-muted-foreground">Sales</dt>
                <dd className="text-label font-bold ts-numeric text-foreground">
                  {sellerProfile?.sales ?? "—"}
                </dd>
              </div>
              <div className="rounded-control bg-muted/60 p-2">
                <dt className="text-caption text-muted-foreground">Responds</dt>
                <dd className="text-label font-bold text-foreground">
                  ~{sellerProfile?.response_minutes ?? "—"}m
                </dd>
              </div>
              <div className="rounded-control bg-muted/60 p-2">
                <dt className="text-caption text-muted-foreground">Member since</dt>
                <dd className="text-label font-bold ts-numeric text-foreground">
                  {joinedYear}
                </dd>
              </div>
            </dl>
            <Button
              variant="outline"
              onClick={scrollToFeedback}
              className="w-full min-h-11 rounded-control"
            >
              <MessageCircleQuestion className="size-4" aria-hidden="true" />
              View feedback
            </Button>
          </div>
        </aside>
      </div>

      <SimilarItems auction={auction} />
      <SellerFeedback username={auction.seller_username} />

      {/* native mobile pattern: the bid/buy CTA rides at the viewport bottom
          (above the tab bar) while the item is live, so the golden path is
          always one thumb-tap away — exactly like eBay/Yahoo! auction apps.
          Sticky (not fixed): when the page content ends it settles above the
          footer instead of covering it. Desktop keeps the full aside. */}
      <MobileBidBar
        auction={auction}
        isLive={isLive}
        canBuyNow={canBuyNow}
        canOffer={canOffer}
        onBid={() => setBidOpen(true)}
        onOffer={() => setOfferOpen(true)}
      />

      <BidSheet
        auction={auction}
        open={bidOpen}
        onOpenChange={setBidOpen}
        onRefresh={refreshAll}
      />

      {/* Gap-8 F2: Best-Offer dialog (offers-enabled live items, buyers) */}
      {canOffer && (
        <MakeOfferDialog
          auction={auction}
          open={offerOpen}
          onOpenChange={setOfferOpen}
          onSent={() => void loadOffers()}
        />
      )}
    </div>
  );
}

// ── Gap-8 F2: Best-Offer / retraction components ──────────────────────

/** Offer status pill — pending=teal, countered=gold, accepted=teal-deep,
 *  declined=urgent, expired/withdrawn=muted. */
function OfferPill({ status, label }: { status: Offer["status"]; label: string }) {
  const tones: Record<Offer["status"], string> = {
    pending:
      "bg-teal-tint text-teal-deep dark:text-teal-soft border-teal/25",
    countered: "bg-gold-soft text-gold-deep border-gold/30",
    accepted: "bg-teal-deep text-white border-teal-deep",
    declined: "bg-danger/10 text-urgent border-danger/25",
    expired: "bg-muted text-muted-foreground border-border",
    withdrawn: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border px-2 py-0.5 text-caption font-bold whitespace-nowrap",
        tones[status],
      )}
    >
      {label}
    </span>
  );
}

/** Make-offer dialog — price context, US$ amount, optional 300-char message.
 *  Engine rejections (minimum offer, buy-now ceiling, duplicate…) render
 *  inline; success closes after a beat. */
function MakeOfferDialog({
  auction,
  open,
  onOpenChange,
  onSent,
}: {
  auction: Auction;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSent: () => void;
}) {
  const { t, locale } = useI18n();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setMessage("");
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  const valid = Number.isFinite(parsed) && parsed >= 1;

  const submit = async () => {
    if (busy || success != null) return;
    if (!valid) {
      setError(t("itemoffer.minAmount"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const offer = await api.submitOffer(auction.id, round2(parsed), message.trim() || undefined);
      setSuccess(offer.amount);
      onSent();
      setTimeout(() => onOpenChange(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("itemoffer.errGeneric"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[88vh] overflow-y-auto ts-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="size-5 text-teal" aria-hidden="true" />
            {t("itemoffer.make")}
          </DialogTitle>
          <DialogDescription className="line-clamp-1">{auction.title}</DialogDescription>
        </DialogHeader>

        {success != null ? (
          <div className="py-6 flex flex-col items-center text-center gap-3" role="status">
            <CheckCircle2 className="size-12 text-ok" aria-hidden="true" />
            <p className="text-title text-foreground">{t("itemoffer.sentTitle")}</p>
            <p className="text-caption text-muted-foreground">{t("itemoffer.sentBody")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-caption text-muted-foreground">{t("itemoffer.dialogDesc")}</p>

            {/* price context */}
            <div className="rounded-control bg-muted/60 p-3 space-y-1 text-caption">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("bid.current")}</span>
                <PriceTag amount={auction.current_price} size="sm" />
              </div>
              {auction.buy_now_price != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("action.buyNow")}</span>
                  <PriceTag amount={auction.buy_now_price} size="sm" tone="gold" />
                </div>
              )}
            </div>

            {auction.offer_min != null && (
              <p className="text-caption font-medium text-warn" role="note">
                {locale === "ja"
                  ? `${t("itemoffer.minPre")}${formatUSD(auction.offer_min)}${t("itemoffer.minPost")}`
                  : `${t("itemoffer.minPre")} ${formatUSD(auction.offer_min)} ${t("itemoffer.minPost")}`}
              </p>
            )}

            <div className="space-y-1.5">
              <label htmlFor="ts-offer-amount" className="text-label text-foreground">
                {t("itemoffer.amountLabel")}
              </label>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 start-3 flex items-center text-bodyStrong font-bold text-muted-foreground pointer-events-none"
                >
                  $
                </span>
                <Input
                  id="ts-offer-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={busy}
                  aria-invalid={!!error}
                  placeholder="10"
                  className="pl-7 h-12 text-title font-bold ts-numeric"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ts-offer-msg" className="text-label text-foreground">
                {t("itemoffer.messageLabel")}
              </label>
              <Textarea
                id="ts-offer-msg"
                rows={3}
                maxLength={300}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={busy}
                aria-describedby="ts-offer-msg-hint"
              />
              <p id="ts-offer-msg-hint" className="text-caption text-muted-foreground">
                {t("itemoffer.messageHint")}
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

            <Button
              onClick={submit}
              disabled={busy}
              className="w-full min-h-12 text-bodyStrong rounded-control"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("itemoffer.sending")}
                </>
              ) : (
                <>
                  <Handshake className="size-4" aria-hidden="true" />
                  {t("itemoffer.send")}
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Offers block below the bid panel: public count only; buyers see their own
 *  rows; the seller (or an admin) gets full management. */
function ItemOffersPanel({
  auction,
  offers,
  loading,
  viewer,
  onChanged,
}: {
  auction: Auction;
  offers: Offer[] | null;
  loading: boolean;
  viewer: CurrentUser | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const isSellerView =
    (viewer && viewer.username === auction.seller_username) || !!viewer?.admin;
  const list = offers ?? [];
  const count = list.length;
  const ownRows = viewer
    ? list.filter((o) => o.buyer_username === viewer.username)
    : [];
  const rows = isSellerView ? list : ownRows;
  const show =
    auction.allow_offers === 1 && (isSellerView || rows.length > 0 || count > 0);
  if (!show) return null;

  return (
    <section
      aria-labelledby="ts-item-offers"
      className="rounded-card border border-border bg-raised p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="ts-item-offers" className="text-label font-bold text-foreground">
          {t("itemoffer.title")}
        </h3>
        {count > 0 && (
          <p className="text-caption text-muted-foreground ts-numeric" aria-live="polite">
            {count} {t("itemoffer.countLabel")}
          </p>
        )}
      </div>

      {loading && !offers ? (
        <div className="space-y-2" aria-busy="true" aria-label={t("state.loading")}>
          {[0, 1].map((i) => (
            <div key={i} className="h-16 rounded-control bg-muted animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {isSellerView ? t("itemoffer.noneYet") : t("itemoffer.privacyNote")}
        </p>
      ) : (
        <>
          <div
            className={cn(
              "space-y-2",
              rows.length > 8 && "max-h-96 overflow-y-auto ts-scrollbar",
            )}
          >
            {rows.map((o) => (
              <OfferRowItem
                key={o.id}
                auction={auction}
                offer={o}
                isSeller={isSellerView}
                isOwn={!!viewer && o.buyer_username === viewer.username}
                onChanged={onChanged}
              />
            ))}
          </div>
          {!isSellerView && (
            <p className="text-caption text-muted-foreground">{t("itemoffer.privacyNote")}</p>
          )}
        </>
      )}
    </section>
  );
}

type OfferAction = "accept" | "decline" | "withdraw" | "acceptCounter" | "declineCounter";

/** One offer row — buyer identity masked for the seller; buyer sees "You".
 *  Pending (seller): Accept [confirm] / Counter / Decline. Countered (buyer):
 *  Accept counter [confirm] / Decline. Own pending (buyer): Withdraw. */
function OfferRowItem({
  auction,
  offer,
  isSeller,
  isOwn,
  onChanged,
}: {
  auction: Auction;
  offer: Offer;
  isSeller: boolean;
  isOwn: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<OfferAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptCounterOpen, setAcceptCounterOpen] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);

  const live = auction.status === "live";
  const sellerPending = isSeller && offer.status === "pending" && live;
  const sellerCountered = isSeller && offer.status === "countered";
  const buyerPending = isOwn && offer.status === "pending" && live;
  const buyerCountered = isOwn && offer.status === "countered" && live;

  const run = async (kind: OfferAction, fn: () => Promise<unknown>, okTitle: string) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await fn();
      toast({ title: okTitle });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("itemoffer.errGeneric"));
    } finally {
      setBusy(null);
    }
  };

  const buyerLabel = isOwn ? t("itemoffer.you") : maskUsername(offer.buyer_username);
  const acceptSentence =
    locale === "ja"
      ? `${t("itemoffer.acceptPre")}${buyerLabel}${t("itemoffer.acceptMid")}${formatUSD(offer.amount)}${t("itemoffer.acceptPost")}`
      : `${t("itemoffer.acceptPre")} ${buyerLabel} ${t("itemoffer.acceptMid")} ${formatUSD(offer.amount)} ${t("itemoffer.acceptPost")}`;
  const counterSentence =
    locale === "ja"
      ? `${t("itemoffer.acceptCounterPre")}${formatUSD(offer.counter_amount ?? offer.amount)}${t("itemoffer.acceptCounterPost")}`
      : `${t("itemoffer.acceptCounterPre")} ${formatUSD(offer.counter_amount ?? offer.amount)} ${t("itemoffer.acceptCounterPost")}`;

  return (
    <article className="rounded-control border border-border bg-muted/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-label font-semibold text-foreground">{buyerLabel}</span>
        <PriceTag amount={offer.amount} size="md" />
        <OfferPill status={offer.status} label={t(`offers.status.${offer.status}`)} />
        <time
          title={formatDateTime(offer.updated_at)}
          className="text-caption text-muted-foreground"
        >
          {formatRelative(offer.updated_at)}
        </time>
      </div>

      {offer.message && (
        <p className="text-caption text-muted-foreground italic border-s-2 border-border ps-2">
          “{offer.message}”
        </p>
      )}

      {offer.status === "countered" && (
        <div className="rounded-control bg-gold-soft/70 dark:bg-gold-soft/25 p-2.5 space-y-1">
          <p className="text-caption font-semibold text-gold-deep">
            {isOwn ? t("itemoffer.counteredBy") : `${t("itemoffer.counter")} · ${t("itemoffer.waitingBuyer")}`}{" "}
            <span className="ts-numeric">{formatUSD(offer.counter_amount ?? offer.amount)}</span>
          </p>
          {offer.counter_message && (
            <p className="text-caption text-foreground italic">“{offer.counter_message}”</p>
          )}
        </div>
      )}

      {(sellerPending || buyerPending || buyerCountered) && (
        <div className="flex flex-wrap items-center gap-2">
          {sellerPending && (
            <>
              <Button
                onClick={() => setAcceptOpen(true)}
                disabled={busy != null}
                className="min-h-11 rounded-control"
              >
                {busy === "accept" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                {t("itemoffer.accept")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setCounterOpen(true)}
                disabled={busy != null}
                className="min-h-11 rounded-control"
              >
                {busy === "decline" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowLeftRight className="size-4" aria-hidden="true" />
                )}
                {t("itemoffer.counter")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void run("decline", () => api.respondOffer(offer.id, "decline"), t("itemoffer.declined"))}
                disabled={busy != null}
                className="min-h-11 rounded-control text-muted-foreground"
              >
                {busy === "decline" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <X className="size-4" aria-hidden="true" />
                )}
                {t("itemoffer.decline")}
              </Button>
            </>
          )}
          {buyerPending && (
            <Button
              variant="outline"
              onClick={() => void run("withdraw", () => api.withdrawOffer(offer.id), t("itemoffer.withdrawn"))}
              disabled={busy != null}
              className="min-h-11 rounded-control"
            >
              {busy === "withdraw" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="size-4" aria-hidden="true" />
              )}
              {t("itemoffer.withdraw")}
            </Button>
          )}
          {buyerCountered && (
            <>
              <Button
                onClick={() => setAcceptCounterOpen(true)}
                disabled={busy != null}
                className="min-h-11 rounded-control"
              >
                {busy === "acceptCounter" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                {t("itemoffer.acceptCounter")}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run("declineCounter", () => api.acceptCounter(offer.id, false), t("itemoffer.counterDeclined"))
                }
                disabled={busy != null}
                className="min-h-11 rounded-control"
              >
                {busy === "declineCounter" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <X className="size-4" aria-hidden="true" />
                )}
                {t("itemoffer.declineCounter")}
              </Button>
            </>
          )}
        </div>
      )}

      {sellerCountered && !sellerPending && (
        <p className="text-caption text-muted-foreground">{t("itemoffer.waitingBuyer")}</p>
      )}

      {error && (
        <p role="alert" className="text-caption font-medium text-urgent">
          {error}
        </p>
      )}

      {/* seller accepting = instant sale — confirm */}
      <AlertDialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("itemoffer.acceptTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{acceptSentence}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run("accept", () => api.respondOffer(offer.id, "accept"), t("itemoffer.accepted"))
              }
            >
              {t("itemoffer.accept")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* buyer accepting the counter = instant sale at counter price — confirm */}
      <AlertDialog open={acceptCounterOpen} onOpenChange={setAcceptCounterOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("itemoffer.acceptCounterTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{counterSentence}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run("acceptCounter", () => api.acceptCounter(offer.id, true), t("itemoffer.youWon"))
              }
            >
              {t("itemoffer.acceptCounter")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CounterOfferDialog
        offer={offer}
        open={counterOpen}
        onOpenChange={setCounterOpen}
        onDone={() => {
          setCounterOpen(false);
          toast({ title: t("itemoffer.counterSent") });
          onChanged();
        }}
      />
    </article>
  );
}

/** Seller counter-offer composer — amount (must stay below buy-now) + message. */
function CounterOfferDialog({
  offer,
  open,
  onOpenChange,
  onDone,
}: {
  offer: Offer;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(offer.amount % 1 === 0 ? String(offer.amount) : offer.amount.toFixed(2));
      setMessage("");
      setError(null);
    }
  }, [open, offer.amount]);

  const parsed = Number(value.replace(/[^0-9.]/g, ""));

  const submit = async () => {
    if (busy) return;
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError(t("itemoffer.minAmount"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.respondOffer(offer.id, "counter", round2(parsed), message.trim() || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("itemoffer.errGeneric"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("itemoffer.counterTitle")}</DialogTitle>
          <DialogDescription>{t("itemoffer.counterDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-control bg-muted/60 p-3 text-caption flex items-center justify-between">
            <span className="text-muted-foreground">
              {t("itemoffer.buyer")} · {maskUsername(offer.buyer_username)}
            </span>
            <PriceTag amount={offer.amount} size="sm" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ts-counter-amount" className="text-label text-foreground">
              {t("itemoffer.counterAmount")}
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 start-3 flex items-center text-bodyStrong font-bold text-muted-foreground pointer-events-none"
              >
                $
              </span>
              <Input
                id="ts-counter-amount"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(null);
                }}
                disabled={busy}
                aria-invalid={!!error}
                className="pl-7 h-12 text-title font-bold ts-numeric"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ts-counter-msg" className="text-label text-foreground">
              {t("itemoffer.counterMessage")}
            </label>
            <Textarea
              id="ts-counter-msg"
              rows={3}
              maxLength={300}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
            />
            <p className="text-caption text-muted-foreground">{t("itemoffer.messageHint")}</p>
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
            <Button onClick={submit} disabled={busy} className="min-h-11 rounded-control">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("itemoffer.counterSend")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Bid history with Gap-8 retraction: own active lead bid on a live auction
 *  gets a Retract action; retracted rows dim with a "Retracted" pill (reason
 *  tooltip only on the viewer's own row or for admins). */
function BidHistoryPanel({
  auction,
  bids,
  loading,
  onChanged,
}: {
  auction: Auction;
  bids: Bid[] | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [retractTarget, setRetractTarget] = useState<Bid | null>(null);
  const list = useMemo(() => [...(bids ?? [])].sort((a, b) => b.id - a.id), [bids]);
  const live = auction.status === "live";

  if (loading && list.length === 0) {
    return (
      <div className="space-y-2 pt-4" aria-busy="true" aria-label={t("state.loading")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-control bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="pt-4">
        <EmptyState
          icon={<Gavel className="size-10" />}
          title={t("bidretract.noBidsTitle")}
          body={t("bidretract.noBidsBody")}
        />
      </div>
    );
  }

  return (
    <div className="pt-4">
      <div className="rounded-card border border-border bg-raised overflow-hidden">
        <div className="max-h-96 overflow-auto ts-scrollbar">
          <Table>
            <TableHeader>
              <TableRow className="sticky top-0 z-10 bg-raised hover:bg-raised">
                <TableHead className="text-caption">{t("bidretract.bidder")}</TableHead>
                <TableHead className="text-caption text-right">{t("bidretract.amount")}</TableHead>
                <TableHead className="text-caption">{t("bidretract.type")}</TableHead>
                <TableHead className="text-caption">{t("bidretract.time")}</TableHead>
                <TableHead className="text-caption">{t("bidretract.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((b) => {
                const mine = !!user && b.bidder_username === user.username;
                const retracted = b.status === "retracted";
                const winning = b.status === "active";
                const canRetract = mine && winning && live;
                const reasonTitle =
                  (mine || user?.admin) && b.retraction_reason ? b.retraction_reason : undefined;
                return (
                  <TableRow
                    key={b.id}
                    className={cn(
                      retracted && "opacity-60",
                      mine && !retracted && "bg-teal-tint/40 dark:bg-teal-tint/25",
                    )}
                  >
                    <TableCell className="text-caption font-semibold text-foreground whitespace-nowrap">
                      <span
                        title={
                          mine ? `You (${b.bidder_username})` : "Bidder identity protected"
                        }
                      >
                        {maskUsername(b.bidder_username)}
                        {mine ? ` (${t("itemoffer.you")})` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span
                        className={cn(
                          "font-bold ts-numeric text-foreground",
                          retracted && "line-through",
                        )}
                      >
                        {formatUSD(b.amount)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {b.is_auto === 1 ? (
                        <span
                          title={t("bidretract.autoNote")}
                          className="inline-flex items-center gap-1 text-caption text-gold-deep font-semibold"
                        >
                          <Zap className="size-3.5" aria-hidden="true" />
                          {t("bidretract.auto")}
                          <span className="sr-only">{t("bidretract.autoNote")}</span>
                        </span>
                      ) : (
                        <span className="text-caption text-muted-foreground">
                          {t("bidretract.manual")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <time
                        title={formatDateTime(b.created_at)}
                        className="text-caption text-muted-foreground"
                      >
                        {formatRelative(b.created_at)}
                      </time>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {retracted ? (
                          <span title={reasonTitle}>
                            <StatusPill size="xs" tone="danger">
                              {t("bidretract.retracted")}
                            </StatusPill>
                          </span>
                        ) : winning ? (
                          <span className="rounded-pill bg-teal-tint text-teal-deep dark:text-teal-soft px-2 py-0.5 text-caption font-bold">
                            {t("bidretract.winning")}
                          </span>
                        ) : (
                          <span className="rounded-pill bg-muted text-muted-foreground px-2 py-0.5 text-caption font-semibold">
                            {t("bidretract.outbid")}
                          </span>
                        )}
                        {canRetract && (
                          <Button
                            variant="outline"
                            onClick={() => setRetractTarget(b)}
                            title={t("bidretract.lead")}
                            aria-label={t("bidretract.action")}
                            className="min-h-11 min-w-11 px-2.5 text-caption rounded-control"
                          >
                            <Undo2 className="size-3.5" aria-hidden="true" />
                            {t("bidretract.action")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="text-caption text-muted-foreground mt-2">{t("bidretract.maskNote")}</p>

      <RetractBidDialog
        bid={retractTarget}
        onOpenChange={(o) => {
          if (!o) setRetractTarget(null);
        }}
        onChanged={onChanged}
      />
    </div>
  );
}

/** Retract-bid dialog — 60-minute lead window, reason ≥10 chars shown to the
 *  seller. Engine refusals (window elapsed, outbid, ended…) show inline. */
function RetractBidDialog({
  bid,
  onOpenChange,
  onChanged,
}: {
  bid: Bid | null;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = !!bid;

  useEffect(() => {
    if (bid) {
      setReason("");
      setError(null);
    }
  }, [bid]);

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
      onChanged();
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
            <label htmlFor="ts-retract-reason" className="text-label text-foreground">
              {t("bidretract.reasonLabel")}
            </label>
            <Textarea
              id="ts-retract-reason"
              rows={3}
              maxLength={200}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              disabled={busy}
              aria-invalid={!!error}
              aria-describedby="ts-retract-hint"
            />
            <p id="ts-retract-hint" className="text-caption text-muted-foreground">
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

// ── item specifics row ────────────────────────────────────────────────

function SpecRow({
  label,
  value,
  linkProps,
}: {
  label: string;
  value: string;
  linkProps?: { href: string; onClick: (e: React.MouseEvent) => void };
}) {
  return (
    <div className="rounded-control bg-muted/60 p-3 min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-label font-semibold text-foreground truncate">
        {linkProps ? (
          <a {...linkProps} className="hover:text-teal transition-colors">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// ── native mobile bid/buy bar (sticky in the thumb zone) ──────────────

function MobileBidBar({
  auction,
  isLive,
  canBuyNow,
  canOffer,
  onBid,
  onOffer,
}: {
  auction: Auction;
  isLive: boolean;
  canBuyNow: boolean;
  canOffer: boolean;
  onBid: () => void;
  onOffer: () => void;
}) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  if (!isLive) return null;
  return (
    <div
      aria-label="Bid actions"
      className="md:hidden sticky bottom-[calc(57px+env(safe-area-inset-bottom,0px))] z-30 -mx-3 px-3 mt-4 border-t border-border bg-section/95 backdrop-blur"
    >
      <div className="flex items-center gap-3 py-2 min-h-16">
        <div className="min-w-0 shrink-0 leading-none">
          <p className="ts-numeric text-bodyStrong font-bold text-teal">
            {formatUSD(auction.current_price)}
          </p>
          <p className="text-caption text-muted-foreground mt-1 flex items-center gap-1.5">
            <span className="ts-numeric">
              {auction.bid_count} {t("bid.bids")}
            </span>
            <span aria-hidden="true">·</span>
            <Countdown
              endsAt={auction.ends_at}
              ended={false}
              className="text-caption"
            />
          </p>
        </div>
        <div className="flex flex-1 items-center gap-2">
          {canBuyNow && auction.buy_now_price != null && (
            <Button
              onClick={() => navigate(`/checkout/${auction.id}`)}
              className="flex-1 min-h-11 rounded-control bg-gold text-gold-on hover:bg-gold/90 text-label"
            >
              {t("action.buyNow")}
            </Button>
          )}
          <Button
            onClick={onBid}
            aria-haspopup="dialog"
            className="flex-1 min-h-11 rounded-control text-label"
          >
            <Gavel className="size-4" aria-hidden="true" />
            {t("action.bid")}
          </Button>
          {canOffer && (
            <Button
              onClick={onOffer}
              variant="outline"
              aria-haspopup="dialog"
              className="flex-1 min-h-11 rounded-control text-label"
            >
              <Handshake className="size-4" aria-hidden="true" />
              {t("itemoffer.make")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── loading skeleton ──────────────────────────────────────────────────

function ItemPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6" aria-busy="true" aria-label="Loading auction">
      <Skeleton className="h-4 w-64 mb-4 rounded-control" />
      <div className="grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-6 lg:gap-8 items-start">
        <div className="space-y-6">
          <Skeleton className="aspect-[4/3] w-full rounded-card" />
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="w-20 h-14 rounded-control" />
            ))}
          </div>
          <Skeleton className="h-11 w-full rounded-control" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-56 w-full rounded-card" />
          <Skeleton className="h-24 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
