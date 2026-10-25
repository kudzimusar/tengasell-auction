"use client";

// Tengasell orders (#/orders list + #/orders/{id} detail) — the
// transaction lifecycle view for buyers and sellers:
//   · list: Buying / Selling tabs, status chips, pay-by SLA countdowns,
//     contextual CTAs (pay / track / confirm delivery / rate / dispatch)
//   · detail: vertical timeline, item summary, payments history and a
//     role-aware action panel with payment / dispatch / confirm-delivery /
//     rating dialogs (shared with the list via order-dialogs.tsx).

import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  LogIn,
  MessageSquare,
  Package,
  PackageCheck,
  PackageX,
  ShieldCheck,
  Star,
  Tag,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useResource } from "@/lib/tengasell/hooks";
import { useLinkProps } from "@/lib/tengasell/router";
import {
  conditionLabel,
  formatDateTime,
  formatRelative,
  formatUSD,
  paymentMethodLabel,
  SLA,
} from "@/lib/tengasell/format";
import { toAuctionView, type CurrentUser, type Order, type OrderStatus, type Payment } from "@/lib/tengasell/types";
import { DisputeButton } from "./dispute-button";
import { ReceiptsCard } from "./receipts-card";
import { Avatar, EmptyState, ErrorState, PriceTag } from "@/components/tengasell/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ConfirmDeliveryDialog,
  markOrderRated,
  OrderStatusChip,
  PayByCountdown,
  PaymentDialog,
  PaymentRow,
  ratedOrderIds,
  RatingDialog,
  ShipDialog,
  useCachedAuction,
} from "./order-dialogs";
import { TrackingMap } from "@/components/tengasell/map/interactive-map";
import { cityInfo } from "@/components/tengasell/map/cities";
import { VehicleAuctionSettlementCard, VehicleSettlementActionNotice } from "./vehicle-auction-settlement";

export default function OrdersPage({ orderId }: { orderId?: number }) {
  if (orderId != null && Number.isFinite(orderId) && orderId > 0) {
    return <OrderDetailPage orderId={orderId} />;
  }
  return <OrdersListPage />;
}

// ── helpers ──────────────────────────────────────────────────────────

function orderRole(order: Order, user: CurrentUser): "buyer" | "seller" | "other" {
  if (order.buyer_user === user.id || order.buyer_username === user.username) return "buyer";
  if (order.seller_user === user.id || order.seller_username === user.username) return "seller";
  return "other";
}

function useRatedSet(): [Set<number>, (id: number) => void] {
  const [ratedIds, setRatedIds] = useState<Set<number>>(() =>
    typeof window === "undefined" ? new Set<number>() : ratedOrderIds(),
  );
  const mark = (id: number) =>
    setRatedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  return [ratedIds, mark];
}

// ── list view (#/orders) ─────────────────────────────────────────────

function OrdersListPage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<"buying" | "selling">("buying");
  const ordersRes = useResource<Order[]>(() => api.orders(tab), [tab], {
    events: ["order:update"],
  });
  const [ratedIds, markRated] = useRatedSet();

  const orders = ordersRes.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-headline text-foreground">My orders</h1>
          <p className="mt-0.5 text-caption text-muted-foreground">
            Purchases and sales · live updates
          </p>
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v === "selling" ? "selling" : "buying")}
        >
          <TabsList className="grid w-full grid-cols-2 rounded-control sm:w-auto">
            <TabsTrigger value="buying" className="min-h-11 rounded-control px-6">
              Buying
            </TabsTrigger>
            <TabsTrigger value="selling" className="min-h-11 rounded-control px-6">
              Selling
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-5">
        {authLoading ? (
          <OrdersListSkeleton />
        ) : !user ? (
          <SignInGate />
        ) : ordersRes.loading ? (
          <OrdersListSkeleton />
        ) : ordersRes.error ? (
          <ErrorState message={ordersRes.error} onRetry={ordersRes.reload} />
        ) : orders.length === 0 ? (
          tab === "buying" ? (
            <EmptyState
              icon={<Package className="size-10" />}
              title="No purchases yet"
              body="When you win an auction or reserve an item with Buy-now, the order shows up here with payment and delivery tracking."
              action={<BrowseLink />
              }
            />
          ) : (
            <EmptyState
              icon={<Tag className="size-10" />}
              title="No sales yet"
              body="When your auctions sell, orders and dispatch tasks land here. List something today — the first 50 listings each month are free."
              action={<SellLink />}
            />
          )
        ) : (
          <ul className="space-y-3" aria-label={tab === "buying" ? "Orders you bought" : "Orders you sold"}>
            {orders.map((order) => (
              <li key={`${tab}-${order.id}`}>
                <OrderRow
                  order={order}
                  role={tab}
                  rated={ratedIds.has(order.id)}
                  onRated={() => markRated(order.id)}
                  onRefresh={ordersRes.reload}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BrowseLink() {
  const link = useLinkProps("/search");
  return (
    <Button asChild className="min-h-11 rounded-control px-6">
      <a {...link}>Browse auctions</a>
    </Button>
  );
}

function SellLink() {
  const link = useLinkProps("/sell");
  return (
    <Button asChild className="min-h-11 rounded-control px-6">
      <a {...link}>Start selling</a>
    </Button>
  );
}

function SignInGate() {
  const link = useLinkProps("/signin");
  return (
    <EmptyState
      icon={<LogIn className="size-10" />}
      title="Sign in to see your orders"
      body="Your purchases, sales, payments and delivery tracking live here — sign in to view them."
      action={
        <Button asChild className="min-h-11 rounded-control px-6">
          <a {...link}>Sign in</a>
        </Button>
      }
    />
  );
}

// ── order row ────────────────────────────────────────────────────────

type CtaAction = "pay" | "deliver" | "ship" | "rate" | "view";

function computeCta(
  order: Order,
  role: "buying" | "selling",
  rated: boolean,
): { label: string; kind: "gold" | "primary" | "outline-gold" | "outline" | "ghost"; action: CtaAction } {
  const isBuyer = role === "buying";
  switch (order.status) {
    case "pending_payment":
      return isBuyer
        ? { label: "Pay now", kind: "gold", action: "pay" }
        : { label: "View order", kind: "outline", action: "view" };
    case "paid":
      return isBuyer
        ? { label: "Track", kind: "outline", action: "view" }
        : { label: "Dispatch", kind: "primary", action: "ship" };
    case "shipped":
      return isBuyer
        ? { label: "Confirm delivery", kind: "primary", action: "deliver" }
        : { label: "Track", kind: "outline", action: "view" };
    case "delivered":
    case "completed":
      return rated
        ? { label: "View", kind: "ghost", action: "view" }
        : { label: "Rate", kind: "outline-gold", action: "rate" };
    default:
      return { label: "View", kind: "ghost", action: "view" };
  }
}

const CTA_VARIANTS: Record<
  "gold" | "primary" | "outline-gold" | "outline" | "ghost",
  { variant: "default" | "outline" | "ghost"; className?: string }
> = {
  gold: { variant: "default", className: "bg-gold text-gold-on hover:bg-gold/90" },
  primary: { variant: "default" },
  "outline-gold": {
    variant: "outline",
    className: "border-gold/60 text-gold-deep hover:bg-gold-soft/60 dark:border-gold/50 dark:text-gold",
  },
  outline: { variant: "outline" },
  ghost: { variant: "ghost" },
};

function OrderRow({
  order,
  role,
  rated,
  onRated,
  onRefresh,
}: {
  order: Order;
  role: "buying" | "selling";
  rated: boolean;
  onRated: () => void;
  onRefresh: () => void;
}) {
  const { auction, loading: auctionLoading } = useCachedAuction(order.auction_id);
  const itemLink = useLinkProps(`/item/${order.auction_id}`);
  const detailLink = useLinkProps(`/orders/${order.id}`);
  const profileLink = useLinkProps(`/u/${role === "buying" ? order.seller_username : order.buyer_username}`);
  const [dialog, setDialog] = useState<Exclude<CtaAction, "view"> | null>(null);
  const counterparty = role === "buying" ? order.seller_username : order.buyer_username;
  const cta = computeCta(order, role, rated);
  // null when the CTA is pure navigation (handled by the detail link)
  const openDialog: Exclude<CtaAction, "view"> | null = cta.action === "view" ? null : cta.action;
  const img = auction ? (toAuctionView(auction).imageList[0] ?? "/brand/hero-main.png") : "/brand/hero-main.png";

  return (
    <article className="rounded-card border border-border bg-raised p-3 transition-colors hover:border-teal/40 sm:p-4">
      <div className="grid grid-cols-[auto_1fr] items-start gap-3 sm:grid-cols-[auto_1fr_auto] sm:gap-4">
        <a
          {...itemLink}
          aria-label={`View item: ${order.auction_title}`}
          className="focus-visible:outline-ring size-16 shrink-0 overflow-hidden rounded-control border border-border focus-visible:outline-2 sm:size-20"
        >
          {auctionLoading ? (
            <Skeleton className="size-full" />
          ) : (
            <img src={img} alt="" loading="lazy" className="size-full object-cover" />
          )}
        </a>

        <div className="min-w-0">
          <a
            {...itemLink}
            className="line-clamp-2 leading-snug text-label font-semibold text-foreground transition-colors hover:text-teal"
          >
            {order.auction_title}
          </a>
          <p className="mt-0.5 text-caption text-muted-foreground">
            <a {...detailLink} className="ts-numeric font-semibold text-teal hover:underline">
              Order #{order.id}
            </a>{" "}
            · placed {formatRelative(order.created_at)}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
            <Avatar username={counterparty} size={16} />
            <span className="truncate">
              {role === "buying" ? "from " : "to "}
              <a {...profileLink} className="font-semibold text-foreground hover:text-teal">
                @{counterparty}
              </a>
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <OrderStatusChip status={order.status} />
            {order.status === "pending_payment" && order.pay_by && (
              <PayByCountdown payBy={order.pay_by} />
            )}
          </div>
        </div>

        <div className="col-span-2 mt-1 flex items-center justify-between gap-3 sm:col-span-1 sm:mt-0 sm:flex-col sm:items-end sm:justify-between sm:self-stretch">
          <PriceTag amount={order.final_price} size="md" tone="teal" />
          <div className="flex items-center gap-1">
            {openDialog ? (
              <Button
                variant={CTA_VARIANTS[cta.kind].variant}
                className={cn("min-h-11 rounded-control px-4 text-label", CTA_VARIANTS[cta.kind].className)}
                onClick={() => setDialog(openDialog)}
              >
                {cta.label}
              </Button>
            ) : (
              <Button
                asChild
                variant={CTA_VARIANTS[cta.kind].variant}
                className={cn("min-h-11 rounded-control px-4 text-label", CTA_VARIANTS[cta.kind].className)}
              >
                <a {...detailLink}>{cta.label}</a>
              </Button>
            )}
            <a
              {...detailLink}
              aria-label={`View order #${order.id} details`}
              className="grid size-11 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-teal-tint/60 hover:text-teal focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      {dialog === "pay" && (
        <PaymentDialog
          order={order}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onPaid={onRefresh}
        />
      )}
      {dialog === "deliver" && (
        <ConfirmDeliveryDialog
          order={order}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={onRefresh}
        />
      )}
      {dialog === "ship" && (
        <ShipDialog
          order={order}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={onRefresh}
        />
      )}
      {dialog === "rate" && (
        <RatingDialog
          order={order}
          counterparty={counterparty}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={() => {
            markOrderRated(order.id);
            onRated();
            onRefresh();
          }}
        />
      )}
    </article>
  );
}

// ── detail view (#/orders/{id}) ──────────────────────────────────────

function OrderDetailPage({ orderId }: { orderId: number }) {
  const { user, loading: authLoading } = useAuth();
  const orderRes = useResource<Order | null>(() => api.order(orderId), [orderId], {
    events: ["order:update"],
  });
  const paymentsRes = useResource<Payment[]>(() => api.paymentsFor(orderId), [orderId], {
    events: ["order:update"],
  });
  const [ratedIds, markRated] = useRatedSet();

  if (authLoading) {
    return <OrderDetailSkeleton />;
  }

  if (!user) {
    return (
      <DetailWrap>
        <SignInGate />
      </DetailWrap>
    );
  }

  if (orderRes.loading) {
    return <OrderDetailSkeleton />;
  }

  if (orderRes.error) {
    return (
      <DetailWrap>
        <ErrorState message={orderRes.error} onRetry={orderRes.reload} />
      </DetailWrap>
    );
  }

  const order = orderRes.data;
  if (!order) {
    return (
      <DetailWrap>
        <EmptyState
          icon={<PackageX className="size-10" />}
          title="Order not found"
          body="This order doesn't exist or isn't visible to your account."
          action={<AllOrdersLink />}
        />
      </DetailWrap>
    );
  }

  const role = orderRole(order, user);
  if (role === "other") {
    return (
      <DetailWrap>
        <EmptyState
          icon={<PackageX className="size-10" />} title="You don't have access to this order"
          body="Only the buyer and the seller can view this transaction."
          action={<AllOrdersLink />}
        />
      </DetailWrap>
    );
  }

  return (
    <OrderDetailBody
      order={order}
      role={role}
      payments={paymentsRes.data ?? []}
      paymentsLoading={paymentsRes.loading}
      paymentsError={paymentsRes.error}
      onPaymentsRetry={paymentsRes.reload}
      rated={ratedIds.has(order.id)}
      onRated={() => markRated(order.id)}
      onRefresh={() => {
        orderRes.reload();
        paymentsRes.reload();
      }}
    />
  );
}

function AllOrdersLink() {
  const link = useLinkProps("/orders");
  return (
    <Button asChild className="min-h-11 rounded-control px-6">
      <a {...link}>All orders</a>
    </Button>
  );
}

function DetailWrap({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">{children}</div>;
}

function OrderDetailBody({
  order,
  role,
  payments,
  paymentsLoading,
  paymentsError,
  onPaymentsRetry,
  rated,
  onRated,
  onRefresh,
}: {
  order: Order;
  role: "buyer" | "seller";
  payments: Payment[];
  paymentsLoading: boolean;
  paymentsError: string | null;
  onPaymentsRetry: () => void;
  rated: boolean;
  onRated: () => void;
  onRefresh: () => void;
}) {
  const backLink = useLinkProps("/orders");
  const isBuyer = role === "buyer";
  const counterparty = isBuyer ? order.seller_username : order.buyer_username;
  const profileLink = useLinkProps(`/u/${counterparty}`);
  const { auction } = useCachedAuction(order.auction_id);
  const vehicleAuction = auction?.asset_kind === "vehicle";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <a
        {...backLink}
        className="inline-flex min-h-11 items-center gap-1 rounded-control text-label font-semibold text-teal hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All orders
      </a>

      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-headline text-foreground">
            Order <span className="ts-numeric">#{order.id}</span>
          </h1>
          <OrderStatusChip status={order.status} />
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-muted-foreground">
          <span className="ts-numeric">Placed {formatDateTime(order.created_at)}</span>
          <span className="inline-flex items-center gap-1.5">
            <Avatar username={counterparty} size={20} />
            {isBuyer ? "Buying from" : "Selling to"}
            <a
              {...profileLink}
              className="font-semibold text-teal hover:underline"
            >
              @{counterparty}
            </a>
          </span>
        </p>
      </header>

      <div className="mt-6 grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* action panel first on mobile, right column on desktop */}
        <div className="lg:order-last lg:sticky lg:top-28">
          {vehicleAuction ? (
            <VehicleSettlementActionNotice order={order} role={role} />
          ) : (
            <ActionPanel
              order={order}
              role={role}
              rated={rated}
              onRated={onRated}
              onRefresh={onRefresh}
            />
          )}
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-6 lg:order-first">
          {vehicleAuction ? (
            <VehicleAuctionSettlementCard order={order} role={role} />
          ) : (
            <>
              <OrderTimeline order={order} payments={payments} />
              <OrderTrackingSection order={order} />
            </>
          )}
          <ItemSummaryCard order={order} />
          {isBuyer && !vehicleAuction && <DisputeButton order={order} />}
          <ReceiptsCard order={order} payments={payments} />
          <PaymentsCard
            payments={payments}
            loading={paymentsLoading}
            error={paymentsError}
            onRetry={onPaymentsRetry}
          />
        </div>
      </div>
    </div>
  );
}

// ── role-aware action panel ──────────────────────────────────────────

/** Delivery tracking map — seller city → buyer city with a simulated live
 *  courier position. Renders once the order is dispatched. */
function OrderTrackingSection({ order }: { order: Order }) {
  const { auction } = useCachedAuction(order.auction_id);
  const buyerRes = useResource(
    () =>
      order.buyer_username
        ? api.profile(order.buyer_username)
        : Promise.resolve(null),
    [order.buyer_username],
  );
  // Destination: the checkout-selected delivery address first (GIS
  // displayName, e.g. "Hauna, Zimbabwe"), else the buyer's profile city.
  const addressCity = order.address
    ? cityInfo(order.address.split(",")[0].trim())
    : null;
  const destinationCity = addressCity?.name ?? buyerRes.data?.city ?? null;
  const show =
    !!order.shipped_at &&
    !!auction?.city &&
    !!destinationCity;
  if (!show) return null;
  return (
    <TrackingMap
      originCity={auction!.city}
      destinationCity={destinationCity}
      shippedAt={order.shipped_at}
      deliveredAt={order.delivered_at}
      carrier={order.carrier}
      tracking={order.tracking}
      auctionId={order.auction_id}
    />
  );
}

function ActionPanel({
  order,
  role,
  rated,
  onRated,
  onRefresh,
}: {
  order: Order;
  role: "buyer" | "seller";
  rated: boolean;
  onRated: () => void;
  onRefresh: () => void;
}) {
  const reduced = useReducedMotion();
  const [dialog, setDialog] = useState<Exclude<CtaAction, "view"> | null>(null);
  const isBuyer = role === "buyer";
  const counterparty = isBuyer ? order.seller_username : order.buyer_username;
  const messageLink = useLinkProps(`/messages?to=${counterparty}`);
  const dispatchDue =
    order.paid_at != null
      ? new Date(Date.parse(order.paid_at) + SLA.shipWithinDays * 86_400_000)
      : null;
  const showRate = !rated && (order.status === "delivered" || order.status === "completed");

  let content: ReactNode = null;

  if (order.status === "pending_payment") {
    content = isBuyer ? (
      <div className="space-y-3">
        <p className="text-label font-bold text-foreground">Payment due</p>
        {order.pay_by && <PayByCountdown payBy={order.pay_by} className="text-body" />}
        <p className="text-caption text-muted-foreground">
          {formatUSD(order.final_price)} total · funds are held until you confirm delivery · unpaid
          orders may be cancelled after the 48h window.
        </p>
        <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
          <Button
            onClick={() => setDialog("pay")}
            className="min-h-12 w-full rounded-control bg-gold text-gold-on text-bodyStrong hover:bg-gold/90"
          >
            Pay {formatUSD(order.final_price)} now
          </Button>
        </motion.div>
      </div>
    ) : (
      <div className="space-y-2">
        <p className="text-label font-bold text-foreground">Awaiting buyer payment</p>
        {order.pay_by && <PayByCountdown payBy={order.pay_by} prefix="Buyer pays within" />}
        <p className="text-caption text-muted-foreground">
          We&apos;ll notify you the moment payment lands. Only dispatch after payment is confirmed.
        </p>
      </div>
    );
  } else if (order.status === "paid") {
    content = isBuyer ? (
      <div className="space-y-2">
        <p className="text-label font-bold text-foreground">Paid — awaiting dispatch</p>
        <p className="text-caption text-muted-foreground">
          The seller dispatches within 3 days of payment
          {dispatchDue ? ` · due by ${formatDateTime(dispatchDue.toISOString())}` : ""}.
        </p>
      </div>
    ) : (
      <div className="space-y-3">
        <p className="text-label font-bold text-foreground">Paid — dispatch due</p>
        <p className="text-caption text-muted-foreground">
          Mark the order dispatched once it&apos;s with the carrier
          {dispatchDue ? ` · SLA ${formatDateTime(dispatchDue.toISOString())}` : ""}.
        </p>
        <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
          <Button onClick={() => setDialog("ship")} className="min-h-12 w-full rounded-control text-bodyStrong">
            <Truck className="size-4" aria-hidden="true" />
            Mark as dispatched
          </Button>
        </motion.div>
      </div>
    );
  } else if (order.status === "shipped") {
    content = isBuyer ? (
      <div className="space-y-3">
        <p className="text-label font-bold text-foreground">In transit</p>
        <p className="ts-numeric text-caption text-muted-foreground">
          {order.carrier} · {order.tracking}
        </p>
        <p className="text-caption text-muted-foreground">
          Confirm delivery once the item arrives — funds are then released to the seller.
        </p>
        <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
          <Button onClick={() => setDialog("deliver")} className="min-h-12 w-full rounded-control text-bodyStrong">
            <PackageCheck className="size-4" aria-hidden="true" />
            Confirm delivery
          </Button>
        </motion.div>
      </div>
    ) : (
      <div className="space-y-2">
        <p className="text-label font-bold text-foreground">Awaiting buyer confirmation</p>
        <p className="ts-numeric text-caption text-muted-foreground">
          {order.carrier} · {order.tracking}
        </p>
        <p className="text-caption text-muted-foreground">
          Funds release when the buyer confirms delivery · 7-day dispute window applies.
        </p>
      </div>
    );
  } else if (order.status === "delivered" || order.status === "completed") {
    content = (
      <div className="space-y-3">
        <p className="text-label font-bold text-foreground">
          {order.status === "completed" ? "Completed" : "Delivered — funds released"}
        </p>
        {order.delivered_at && (
          <p className="ts-numeric text-caption text-muted-foreground">
            Delivered {formatDateTime(order.delivered_at)}
          </p>
        )}
        {showRate ? (
          <>
            <p className="text-caption text-muted-foreground">
              How was the deal with @{counterparty}? Ratings are public and mutual.
            </p>
            <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
              <Button
                onClick={() => setDialog("rate")}
                className="min-h-12 w-full rounded-control border-gold/60 bg-transparent text-gold-deep hover:bg-gold-soft/60 dark:text-gold"
                variant="outline"
              >
                <Star className="size-4" aria-hidden="true" />
                Rate {counterparty}
              </Button>
            </motion.div>
            <button
              type="button"
              onClick={() => {
                markOrderRated(order.id);
                onRated();
              }}
              className="min-h-11 w-full rounded-control text-label font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              Not now
            </button>
          </>
        ) : (
          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
            {rated ? "You already rated this transaction — thanks!" : "7-day dispute window from delivery."}
          </p>
        )}
      </div>
    );
  } else if (order.status === "cancelled") {
    content = (
      <div className="space-y-2">
        <p className="text-label font-bold text-danger">Cancelled</p>
        <p className="text-caption text-muted-foreground">
          This order was cancelled{order.paid_at ? " after payment — refunds settle within 5 days (SLA)" : " before payment"}. No
          funds are held.
        </p>
      </div>
    );
  } else if (order.status === "disputed") {
    content = (
      <div className="space-y-2">
        <p className="text-label font-bold text-danger">Under dispute</p>
        <p className="text-caption text-muted-foreground">
          Tengasell support reviews within 5 days (refund SLA). Keep your evidence and
          correspondence in Messages.
        </p>
      </div>
    );
  }

  return (
    <aside
      aria-label="Order actions"
      className="space-y-4 rounded-card border border-border bg-raised p-4 sm:p-5"
    >
      {content}

      <div className="border-t border-border pt-4">
        <Button asChild variant="outline" className="min-h-11 w-full rounded-control">
          <a {...messageLink}>
            <MessageSquare className="size-4" aria-hidden="true" />
            Message @{counterparty}
          </a>
        </Button>
      </div>

      {dialog === "pay" && (
        <PaymentDialog
          order={order}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onPaid={onRefresh}
        />
      )}
      {dialog === "deliver" && (
        <ConfirmDeliveryDialog
          order={order}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={onRefresh}
        />
      )}
      {dialog === "ship" && (
        <ShipDialog
          order={order}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={onRefresh}
        />
      )}
      {dialog === "rate" && (
        <RatingDialog
          order={order}
          counterparty={counterparty}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={() => {
            markOrderRated(order.id);
            onRated();
            onRefresh();
          }}
        />
      )}
    </aside>
  );
}

// ── timeline (vertical stepper) ──────────────────────────────────────

interface TimelineStep {
  key: string;
  label: string;
  icon: LucideIcon;
  state: "done" | "active" | "future";
  detail?: ReactNode;
  note?: ReactNode;
}

function OrderTimeline({ order, payments }: { order: Order; payments: Payment[] }) {
  const payment = payments.find((p) => p.status === "settled") ?? payments[0];
  const dispatchDue =
    order.paid_at != null
      ? new Date(Date.parse(order.paid_at) + SLA.shipWithinDays * 86_400_000)
      : null;

  const steps: TimelineStep[] = [
    {
      key: "placed",
      label: "Order placed",
      icon: ClipboardList,
      state: "done",
      detail: formatDateTime(order.created_at),
    },
    {
      key: "payment",
      label: "Payment",
      icon: CircleDollarSign,
      state: order.paid_at ? "done" : order.status === "pending_payment" ? "active" : "future",
      detail: order.paid_at
        ? `${payment ? paymentMethodLabel(payment.method) : "Paid"} · ${formatUSD(order.final_price)} · ${formatDateTime(order.paid_at)}`
        : undefined,
      note: order.paid_at
        ? undefined
        : order.status === "pending_payment"
          ? order.pay_by && <PayByCountdown payBy={order.pay_by} prefix="Due within" />
          : order.status === "cancelled"
            ? "Cancelled before payment"
            : "Awaiting payment",
    },
    {
      key: "dispatch",
      label: "Dispatched",
      icon: Truck,
      state: order.shipped_at ? "done" : order.paid_at ? "active" : "future",
      detail: order.shipped_at
        ? `${order.carrier ?? "Carrier"} · tracking ${order.tracking ?? "—"} · ${formatDateTime(order.shipped_at)}`
        : undefined,
      note: order.shipped_at
        ? undefined
        : order.paid_at
          ? `Dispatch due within ${SLA.shipWithinDays} days of payment${dispatchDue ? ` — by ${formatDateTime(dispatchDue.toISOString())}` : ""}`
          : `Seller dispatches within ${SLA.shipWithinDays} days of payment`,
    },
    {
      key: "delivered",
      label: "Delivered",
      icon: PackageCheck,
      state: order.delivered_at ? "done" : order.shipped_at ? "active" : "future",
      detail: order.delivered_at ? formatDateTime(order.delivered_at) : undefined,
      note: order.delivered_at
        ? undefined
        : order.shipped_at
          ? "Confirm delivery when the item arrives — funds are then released to the seller."
          : "Funds release to the seller when you confirm delivery.",
    },
    {
      key: "completed",
      label: "Completed",
      icon: CheckCircle2,
      state: order.completed_at ? "done" : order.delivered_at ? "active" : "future",
      detail: order.completed_at ? formatDateTime(order.completed_at) : undefined,
      note: order.completed_at
        ? undefined
        : order.delivered_at
          ? "Completes when the transaction is rated."
          : `${SLA.disputeWindowDays}-day dispute window from delivery.`,
    },
  ];

  return (
    <section aria-label="Order timeline" className="rounded-card border border-border bg-raised p-4 sm:p-5">
      <h2 className="text-label font-bold uppercase tracking-wide text-muted-foreground">Timeline</h2>

      {order.status === "cancelled" && (
        <div
          role="note"
          className="mt-3 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption font-medium text-danger"
        >
          This order was cancelled. Steps that never happened are muted below.
        </div>
      )}
      {order.status === "disputed" && (
        <div
          role="note"
          className="mt-3 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption font-medium text-danger"
        >
          This order is under dispute — support reviews within {SLA.refundDays} days (refund SLA).
        </div>
      )}

      <ol className="relative mt-4 space-y-5">
        <span aria-hidden="true" className="absolute start-[17px] top-3 bottom-3 w-0.5 bg-border" />
        {steps.map((step) => (
          <TimelineStepView key={step.key} step={step} />
        ))}
      </ol>
    </section>
  );
}

function TimelineStepView({ step }: { step: TimelineStep }) {
  const Icon = step.icon;
  return (
    <li className="relative flex gap-3 sm:gap-4">
      <span
        className={cn(
          "z-10 grid size-9 shrink-0 place-items-center rounded-full border-2",
          step.state === "done" && "border-teal bg-teal-tint text-teal-deep dark:text-teal-soft",
          step.state === "active" && "border-gold bg-gold-soft text-gold-deep",
          step.state === "future" && "border-border bg-raised text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 pt-1.5">
        <p
          className={cn(
            "text-label font-semibold",
            step.state === "future" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {step.label}
        </p>
        {step.state === "done" && step.detail && (
          <p className="mt-0.5 break-words text-caption text-muted-foreground">{step.detail}</p>
        )}
        {step.state === "active" && step.note && (
          <p className="mt-0.5 break-words text-caption font-semibold text-gold-deep">
            {step.note}
          </p>
        )}
        {step.state === "future" && step.note && (
          <p className="mt-0.5 break-words text-caption text-muted-foreground/80">{step.note}</p>
        )}
      </div>
    </li>
  );
}

// ── item summary card ────────────────────────────────────────────────

function ItemSummaryCard({ order }: { order: Order }) {
  const { auction, loading } = useCachedAuction(order.auction_id);
  const itemLink = useLinkProps(`/item/${order.auction_id}`);
  const view = auction ? toAuctionView(auction) : null;
  const img = view?.imageList[0] ?? "/brand/hero-main.png";

  return (
    <section aria-label="Item" className="rounded-card border border-border bg-raised p-4 sm:p-5">
      <h2 className="text-label font-bold uppercase tracking-wide text-muted-foreground">Item</h2>
      <div className="mt-3 flex gap-3 sm:gap-4">
        {loading ? (
          <Skeleton className="size-20 shrink-0 rounded-control sm:size-24" />
        ) : (
          <a
            {...itemLink}
            className="focus-visible:outline-ring size-20 shrink-0 overflow-hidden rounded-control border border-border focus-visible:outline-2 sm:size-24"
            aria-label={`View item: ${order.auction_title}`}
          >
            <img src={img} alt="" loading="lazy" className="size-full object-cover" />
          </a>
        )}
        <div className="min-w-0 space-y-1.5">
          <a
            {...itemLink}
            className="line-clamp-2 leading-snug text-body font-semibold text-foreground transition-colors hover:text-teal"
          >
            {order.auction_title}
          </a>
          {view && (
            <p className="text-caption text-muted-foreground">
              {conditionLabel(view.condition)} · {view.city}
            </p>
          )}
          <PriceTag amount={order.final_price} size="md" tone="teal" />
        </div>
      </div>
    </section>
  );
}

// ── payments history card ────────────────────────────────────────────

function PaymentsCard({
  payments,
  loading,
  error,
  onRetry,
}: {
  payments: Payment[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section aria-label="Payments" className="rounded-card border border-border bg-raised p-4 sm:p-5">
      <h2 className="text-label font-bold uppercase tracking-wide text-muted-foreground">
        Payments
      </h2>
      <div className="mt-3 space-y-2">
        {loading ? (
          Array.from({ length: 1 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-control" />)
        ) : error ? (
          <div role="alert" className="rounded-control border border-danger/40 bg-danger/10 p-3">
            <p className="text-caption font-medium text-danger">
              Could not load payments — {error}
            </p>
            <Button variant="outline" onClick={onRetry} className="mt-2 min-h-11 rounded-control">
              Retry
            </Button>
          </div>
        ) : payments.length === 0 ? (
          <p className="rounded-control border border-dashed border-border bg-section p-3 text-caption text-muted-foreground">
            No payments recorded yet — they appear here the moment one settles.
          </p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto ts-scrollbar pr-1">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── skeletons ────────────────────────────────────────────────────────

function OrdersListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading orders">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-card border border-border bg-raised p-3 sm:p-4">
          <div className="grid grid-cols-[auto_1fr] items-start gap-3 sm:grid-cols-[auto_1fr_auto] sm:gap-4">
            <Skeleton className="size-16 rounded-control sm:size-20" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-6 w-36 rounded-full" />
            </div>
            <div className="col-span-2 flex justify-between sm:col-span-1 sm:flex-col sm:items-end">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-11 w-28 rounded-control" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrderDetailSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8" aria-busy="true" aria-label="Loading order">
      <Skeleton className="h-8 w-40" />
      <div className="mt-3 flex gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-36 rounded-full" />
      </div>
      <div className="mt-6 grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 lg:order-first">
          <div className="space-y-4 rounded-card border border-border bg-raised p-4 sm:p-5">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3.5 w-48" />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-card border border-border bg-raised p-4 sm:p-5">
            <Skeleton className="h-4 w-16" />
            <div className="flex gap-3">
              <Skeleton className="size-20 rounded-control" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-4 rounded-card border border-border bg-raised p-4 sm:p-5 lg:order-last">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-12 w-full rounded-control" />
          <Skeleton className="h-11 w-full rounded-control" />
        </div>
      </div>
    </div>
  );
}
