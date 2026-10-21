"use client";

// Tengasell checkout (#/checkout/{auctionId}) — buy-now reservation flow:
// item gate (live + buy-now price + no bids) → order summary + price
// breakdown → payment method picker with method-specific mini forms →
// SLA panel → api.buyNow, then either the Paynow hosted checkout (gateway
// session + redirect) or immediate simulated api.payOrder → success screen
// (or success-with-warning when the payment step fails).

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Loader2,
  Lock,
  LogIn,
  MapPin,
  PackageX,
  ShieldCheck,
  Tag,
  UserRound,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useResource } from "@/lib/tengasell/hooks";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";
import {
  conditionLabel,
  formatUSD,
  paymentMethodLabel,
  round2,
  shippingLabel,
} from "@/lib/tengasell/format";
import { toAuctionView, type Auction, type Profile } from "@/lib/tengasell/types";
import { Avatar, EmptyState, ErrorState, RatingStars } from "@/components/tengasell/ui";
import { DeliveryCard } from "@/components/tengasell/map/delivery-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  emptyPaymentFields,
  isPaynowMethod,
  PaymentMethodFieldsForm,
  PaymentMethodPicker,
  paymentReference,
  SlaPanel,
  startPaynowPayment,
  validatePaymentFields,
  type PaymentFields,
  type PaymentMethodId,
} from "./payment-methods";

export default function CheckoutPage({ auctionId }: { auctionId: number }) {
  const { user, loading: authLoading } = useAuth();
  const auctionRes = useResource<Auction | null>(() => api.auction(auctionId), [auctionId]);

  if (authLoading || auctionRes.loading) {
    return <CheckoutSkeleton />;
  }

  if (auctionRes.error) {
    return (
      <PageWrap>
        <ErrorState message={auctionRes.error} onRetry={auctionRes.reload} />
      </PageWrap>
    );
  }

  const auction = auctionRes.data;
  if (!auction) {
    return (
      <PageWrap>
        <Gate
          icon={<PackageX className="size-10" />}
          title="Item not found"
          body="This listing doesn't exist anymore — it may have been removed by the seller."
          primary={{ label: "Browse auctions", to: "/search" }}
        />
      </PageWrap>
    );
  }

  const buyNowAvailable =
    auction.status === "live" && auction.buy_now_price != null && auction.bid_count === 0;
  if (!buyNowAvailable) {
    return (
      <PageWrap>
        <Gate
          icon={<Tag className="size-10" />}
          title="Buy-now is no longer available for this item"
          body="It either received its first bid, ended, or was already reserved by another buyer. Bids placed before a reservation take precedence."
          primary={{ label: "View auction", to: `/item/${auctionId}` }}
          secondary={{ label: "Browse auctions", to: "/search" }}
        />
      </PageWrap>
    );
  }

  if (!user) {
    return (
      <PageWrap>
        <Gate
          icon={<LogIn className="size-10" />}
          title="Sign in to check out"
          body="Sign in to reserve this item with Buy-now — a snap to your happy deal."
          primary={{ label: "Sign in", to: "/signin" }}
        />
      </PageWrap>
    );
  }

  const ownAuction = auction.seller_username === user.username || auction.user === user.id;
  if (ownAuction) {
    return (
      <PageWrap>
        <Gate
          icon={<UserRound className="size-10" />}
          title="You can't buy your own item"
          body={`@${user.username} — buyers can't reserve their own listings. Sit back and let the bids roll in.`}
          primary={{ label: "View your listing", to: `/item/${auctionId}` }}
        />
      </PageWrap>
    );
  }

  return <CheckoutView auction={auction} />;
}

// ── the checkout form ────────────────────────────────────────────────

function CheckoutView({ auction }: { auction: Auction }) {
  const reduced = useReducedMotion();
  const { navigate } = useRouter();
  const { user } = useAuth();
  const buyNow = auction.buy_now_price ?? 0;
  // Delivery address chosen in the DeliveryCard (GIS displayName) — stored on
  // the order at buy-now time so tracking maps route to the real destination.
  const [address, setAddress] = useState<string | null>(null);
  const shipping = auction.shipping_fee ?? 0;
  const total = round2(buyNow + shipping);

  const [method, setMethod] = useState<PaymentMethodId>("paynow");
  const [fields, setFields] = useState<PaymentFields>(emptyPaymentFields);
  const [formError, setFormError] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{
    orderId: number;
    paid: boolean;
    total: number;
    method: PaymentMethodId;
    warning?: string;
  } | null>(null);

  const backLink = useLinkProps(`/item/${auction.id}`);

  const submit = async () => {
    if (submitting || success) return;
    const validation = validatePaymentFields(method, fields);
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError(null);
    setBuyError(null);
    setSubmitting(true);
    try {
      // 1) reserve the item — the trade engine re-validates buy-now rules
      const { orderId } = await api.buyNow(auction.id, address);

      // 2) Paynow — open a gateway session and redirect to the hosted
      //    checkout (sandbox page in mock mode, paynow.co.zw in production)
      if (isPaynowMethod(method)) {
        const res = await startPaynowPayment({
          orderId,
          channel: fields.paynowChannel,
          phone: fields.phone,
        });
        if (res.ok && res.redirectUrl) {
          toast({
            title: "Continue on Paynow",
            description: `Order #${orderId} reserved · completing payment on the Paynow page — reference ${res.reference}.`,
          });
          if (res.redirectUrl.startsWith("http")) {
            window.location.assign(res.redirectUrl);
          } else {
            navigate(res.redirectUrl.replace(/^#/, ""));
          }
          return;
        }
        // gateway hiccup — the order stays reserved, pay within 48h
        toast({
          title: "Reserved — payment pending",
          description: `${res.error ?? "Paynow could not be reached."} Order #${orderId} is held for you — pay from Orders within 48h.`,
        });
        setSuccess({
          orderId,
          paid: false,
          total,
          method,
          warning: res.error ?? "Paynow could not be reached.",
        });
        return;
      }

      // 3) direct (simulated) settlement for the classic methods
      let paid = false;
      try {
        await api.payOrder(orderId, method, paymentReference(method, fields));
        paid = true;
      } catch {
        // payment channel down — the order stays reserved, pay within 48h
        paid = false;
      }
      setSuccess({ orderId, paid, total, method });
      toast(
        paid
          ? {
              title: "Reserved & paid 🎉",
              description: `Order #${orderId} · ${paymentMethodLabel(method)} · ${formatUSD(total)} — seller dispatches within 3 days.`,
            }
          : {
              title: "Reserved — payment pending",
              description: `Order #${orderId} is held for you. Complete payment within 48h from Orders.`,
            },
      );
    } catch (err) {
      // e.g. "Buy-now is no longer available after the first bid."
      setBuyError(err instanceof Error ? err.message : "Buy-now could not be completed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return <SuccessScreen success={success} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
      <a
        {...backLink}
        className="inline-flex min-h-11 items-center gap-1 rounded-control text-label font-semibold text-teal hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to item
      </a>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-headline text-foreground">Checkout</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-tint px-2.5 py-1 text-caption font-semibold text-teal-deep dark:text-teal-soft">
          <Lock className="size-3.5" aria-hidden="true" />
          Secure buy-now
        </span>
      </div>
      <p className="mt-1 text-body text-muted-foreground">
        Reserve instantly — no bidding, no waiting. Pay with Paynow, mobile money
        or card; funds are held until delivery.
      </p>

      <div className="mt-6 grid gap-4 sm:gap-6 lg:grid-cols-[5fr_6fr]">
        {/* left: order summary + price breakdown */}
        <div className="space-y-4 sm:space-y-6 lg:self-start">
          <OrderSummaryCard auction={auction} />
          <DeliveryCard
            auction={auction}
            buyerCity={user?.profile?.city ?? null}
            onAddress={setAddress}
          />
          <PriceBreakdownCard buyNow={buyNow} shipping={shipping} total={total} />
        </div>

        {/* right: payment method + confirm */}
        <section
          aria-label="Payment"
          className="rounded-card border border-border bg-raised p-4 sm:p-5 space-y-4"
        >
          <h2 className="text-title text-foreground">Payment method</h2>

          {buyError && (
            <div
              role="alert"
              className="space-y-2 rounded-control border border-danger/40 bg-danger/10 p-3"
            >
              <p className="flex items-start gap-2 text-caption font-medium text-danger">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                <span>{buyError}</span>
              </p>
              <a
                {...backLink}
                className="inline-flex min-h-11 items-center gap-1 rounded-control text-label font-semibold text-teal hover:underline"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Back to the item
              </a>
            </div>
          )}

          <PaymentMethodPicker
            method={method}
            onMethodChange={(m) => {
              setMethod(m);
              if (formError) setFormError(null);
            }}
            disabled={submitting}
            name="ts-checkout-method"
          />

          <PaymentMethodFieldsForm
            method={method}
            fields={fields}
            onFieldsChange={(next) => {
              setFields(next);
              if (formError) setFormError(null);
            }}
            disabled={submitting}
            idPrefix="ts-checkout"
          />

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption font-medium text-danger"
            >
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <SlaPanel />

          <motion.div
            whileTap={reduced ? undefined : { scale: 0.98 }}
            className="hidden md:block"
          >
            <Button
              onClick={submit}
              disabled={submitting}
              className="w-full min-h-12 rounded-control bg-gold text-gold-on text-bodyStrong hover:bg-gold/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Reserving…
                </>
              ) : (
                <>
                  <Lock className="size-4" aria-hidden="true" />
                  Confirm &amp; reserve · {formatUSD(total)}
                </>
              )}
            </Button>
          </motion.div>

          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
            The item is reserved the moment you confirm. If the payment step can&apos;t complete,
            your order stays reserved and you can pay from Orders within 48h.
          </p>
        </section>
      </div>

      {/* native mobile pattern: the pay CTA rides at the thumb zone,
          sticky above the tab bar. Settles above the footer at page end
          instead of covering it. Desktop uses the inline button above. */}
      <div
        aria-label="Confirm order"
        className="md:hidden sticky bottom-[calc(57px+env(safe-area-inset-bottom,0px))] z-30 -mx-4 px-4 mt-4 border-t border-border bg-section/95 backdrop-blur"
      >
        <Button
          onClick={submit}
          disabled={submitting}
          className="my-2 w-full min-h-12 rounded-control bg-gold text-gold-on text-bodyStrong hover:bg-gold/90"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reserving…
            </>
          ) : (
            <>
              <Lock className="size-4" aria-hidden="true" />
              Confirm &amp; reserve · {formatUSD(total)}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ── success screen ───────────────────────────────────────────────────

function SuccessScreen({
  success,
}: {
  success: { orderId: number; paid: boolean; total: number; method: PaymentMethodId; warning?: string };
}) {
  const reduced = useReducedMotion();
  const orderLink = useLinkProps(`/orders/${success.orderId}`);
  const browseLink = useLinkProps("/");

  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-center sm:py-16">
      <div className="relative mx-auto size-24">
        {!reduced && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-gold/40"
            initial={{ scale: 0.8, opacity: 0.8 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
        <motion.div
          role="img"
          aria-label="Order reserved successfully"
          className="ts-energy relative grid size-24 place-items-center rounded-full bg-gold text-gold-on"
          initial={reduced ? undefined : { scale: 0, rotate: -24 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
        >
          <Check className="size-12" strokeWidth={3} aria-hidden="true" />
        </motion.div>
      </div>

      <h1 className="mt-6 text-display text-foreground">
        {success.paid ? "Reserved & paid 🎉" : "Reserved 🎉"}
      </h1>
      <p className="mt-2 text-body text-muted-foreground">
        Order <span className="ts-numeric font-bold text-foreground">#{success.orderId}</span> ·{" "}
        {formatUSD(success.total)} · {paymentMethodLabel(success.method)}
      </p>

      {success.paid ? (
        <p className="mx-auto mt-2 max-w-md text-caption text-muted-foreground">
          The seller has been notified and dispatches within 3 days. Funds are held by Tengasell
          until you confirm delivery.
        </p>
      ) : (
        <div
          role="alert"
          className="mx-auto mt-4 flex max-w-md items-start gap-2 rounded-control border border-warn/40 bg-gold-soft/60 p-3 text-caption font-medium text-gold-deep"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {success.warning ? `${success.warning} — ` : ""}
            reserved, payment pending. Pay from Orders within 48h to keep the
            reservation.
          </span>
        </div>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Button asChild size="lg" className="min-h-12 rounded-control text-base">
          <a {...orderLink}>
            <Check className="size-4" aria-hidden="true" />
            View order
          </a>
        </Button>
        <Button asChild variant="outline" size="lg" className="min-h-12 rounded-control text-base">
          <a {...browseLink}>Keep browsing</a>
        </Button>
      </div>
    </div>
  );
}

// ── order summary card ───────────────────────────────────────────────

function OrderSummaryCard({ auction }: { auction: Auction }) {
  const view = toAuctionView(auction);
  const itemLink = useLinkProps(`/item/${auction.id}`);
  const sellerLink = useLinkProps(`/u/${auction.seller_username}`);
  const profileRes = useResource<Profile | null>(
    () => api.profile(auction.seller_username),
    [auction.seller_username],
  );
  const img = view.imageList[0] ?? "/brand/hero-main.png";
  const profile = profileRes.data;

  return (
    <section
      aria-label="Order summary"
      className="rounded-card border border-border bg-raised p-4 sm:p-5 space-y-4"
    >
      <h2 className="text-label font-bold uppercase tracking-wide text-muted-foreground">
        Order summary
      </h2>
      <div className="flex gap-3 sm:gap-4">
        <img
          src={img}
          alt={auction.title}
          loading="lazy"
          className="size-20 shrink-0 rounded-control border border-border object-cover sm:size-24"
        />
        <div className="min-w-0 space-y-1.5">
          <a
            {...itemLink}
            className="line-clamp-2 leading-snug text-body font-semibold text-foreground transition-colors hover:text-teal"
          >
            {auction.title}
          </a>
          <p className="text-caption text-muted-foreground">
            {conditionLabel(auction.condition)} · 0 bids
          </p>
          <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <Avatar username={auction.seller_username} size={20} />
            <a {...sellerLink} className="font-semibold text-teal hover:underline">
              @{auction.seller_username}
            </a>
            {profileRes.loading ? (
              <Skeleton className="h-3.5 w-20" />
            ) : profile && profile.rating_count > 0 ? (
              <RatingStars value={profile.rating_avg} count={profile.rating_count} size={12} />
            ) : (
              <span className="text-muted-foreground">· New seller</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5" aria-hidden="true" />
          {auction.city}
        </span>
        <span aria-hidden="true">·</span>
        <span>{shippingLabel(auction.shipping, auction.shipping_fee)}</span>
      </div>
    </section>
  );
}

// ── price breakdown card ─────────────────────────────────────────────

function PriceBreakdownCard({
  buyNow,
  shipping,
  total,
}: {
  buyNow: number;
  shipping: number;
  total: number;
}) {
  return (
    <section
      aria-label="Price breakdown"
      className="rounded-card border border-border bg-raised p-4 sm:p-5 space-y-3"
    >
      <h2 className="text-label font-bold uppercase tracking-wide text-muted-foreground">
        Price breakdown
      </h2>
      <dl className="space-y-2 text-body">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Buy-now price</dt>
          <dd className="ts-numeric font-semibold text-foreground">{formatUSD(buyNow)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Shipping</dt>
          <dd className="ts-numeric font-semibold text-foreground">
            {shipping > 0 ? formatUSD(shipping) : "Free"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
            <ShieldCheck className="size-4 text-teal-soft" aria-hidden="true" />
            Tengasell buyer protection
          </dt>
          <dd className="text-caption font-semibold text-teal">Included</dd>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <dt className="font-bold text-foreground">Total</dt>
          <dd className="ts-numeric text-headline font-extrabold text-gold-deep">
            {formatUSD(total)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ── gate (empty state with link actions) ─────────────────────────────

function Gate({
  icon,
  title,
  body,
  primary,
  secondary,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  primary: { label: string; to: string };
  secondary?: { label: string; to: string };
}) {
  const primaryLink = useLinkProps(primary.to);
  const secondaryLink = useLinkProps(secondary?.to ?? primary.to);
  return (
    <EmptyState
      icon={icon}
      title={title}
      body={body}
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild className="min-h-11 rounded-control px-6">
            <a {...primaryLink}>{primary.label}</a>
          </Button>
          {secondary && (
            <Button asChild variant="outline" className="min-h-11 rounded-control px-6">
              <a {...secondaryLink}>{secondary.label}</a>
            </Button>
          )}
        </div>
      }
    />
  );
}

// ── skeleton + page wrap ─────────────────────────────────────────────

function CheckoutSkeleton() {
  return (
    <div
      className="mx-auto max-w-5xl px-4 py-6 sm:py-10"
      aria-busy="true"
      aria-label="Loading checkout"
    >
      <Skeleton className="h-8 w-40" />
      <div className="mt-6 grid gap-4 sm:gap-6 lg:grid-cols-[5fr_6fr]">
        <div className="space-y-4 sm:space-y-6">
          <div className="space-y-4 rounded-card border border-border bg-raised p-4 sm:p-5">
            <Skeleton className="h-4 w-28" />
            <div className="flex gap-3">
              <Skeleton className="size-20 rounded-control sm:size-24" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
          <div className="space-y-3 rounded-card border border-border bg-raised p-4 sm:p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-8 w-1/3" />
          </div>
        </div>
        <div className="space-y-4 rounded-card border border-border bg-raised p-4 sm:p-5">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-control" />
            ))}
          </div>
          <Skeleton className="h-14 rounded-control" />
          <Skeleton className="h-12 rounded-control" />
        </div>
      </div>
    </div>
  );
}

function PageWrap({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">{children}</div>;
}
