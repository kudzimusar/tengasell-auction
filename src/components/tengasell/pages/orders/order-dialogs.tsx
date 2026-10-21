"use client";

// Tengasell orders module — shared transaction-lifecycle dialogs and bits:
// PaymentDialog (settle a pending order), ConfirmDeliveryDialog (release
// funds), ShipDialog (seller dispatch), RatingDialog (rate the
// counterparty), plus OrderStatusChip, PayByCountdown, the payment-method
// icon map, a module-level auction cache and the localStorage rated-order
// set (ts_rated_orders).

import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  PackageCheck,
  Phone,
  ShieldCheck,
  Star,
  Truck,
  Wallet,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/tengasell/api";
import {
  formatDateTime,
  formatRemaining,
  formatUSD,
  orderStatusLabel,
  paymentMethodLabel,
} from "@/lib/tengasell/format";
import type { Auction, Order, OrderStatus, Payment } from "@/lib/tengasell/types";
import { useNow } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { cn } from "@/lib/utils";
import { useRouter } from "@/lib/tengasell/router";
import {
  emptyPaymentFields,
  isPaynowMethod,
  PaymentMethodFieldsForm,
  PaymentMethodPicker,
  paymentReference,
  startPaynowPayment,
  validatePaymentFields,
  type PaymentFields,
  type PaymentMethodId,
} from "./payment-methods";

// ── auction cache (order rows / item summaries share images) ─────────

const auctionCache = new Map<number, Auction>();

export function useCachedAuction(id: number): { auction: Auction | null; loading: boolean } {
  const [state, setState] = useState<{ auction: Auction | null; loading: boolean }>(() =>
    auctionCache.has(id)
      ? { auction: auctionCache.get(id)!, loading: false }
      : { auction: null, loading: true },
  );

  useEffect(() => {
    let alive = true;
    const cached = auctionCache.get(id);
    if (cached) {
      Promise.resolve().then(() => {
        if (alive) setState({ auction: cached, loading: false });
      });
      return () => {
        alive = false;
      };
    }
    api
      .auction(id)
      .then((a) => {
        if (a) auctionCache.set(id, a);
        if (alive) setState({ auction: a, loading: false });
      })
      .catch(() => {
        if (alive) setState({ auction: null, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return state;
}

// ── status chip (orderStatusLabel with NXS state colors) ─────────────

const STATUS_ICONS: Record<OrderStatus, LucideIcon> = {
  pending_payment: Clock,
  paid: Wallet,
  shipped: Truck,
  delivered: PackageCheck,
  completed: CheckCircle2,
  cancelled: XCircle,
  disputed: AlertTriangle,
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending_payment: "bg-gold-soft text-gold-deep",
  paid: "bg-teal-tint text-teal-deep dark:text-teal-soft",
  shipped: "bg-teal-soft/15 text-teal-deep dark:text-teal-soft",
  delivered: "bg-teal/10 text-teal-deep dark:text-teal-soft",
  completed: "bg-ok/10 text-ok",
  cancelled: "bg-danger/10 text-danger",
  disputed: "bg-danger/10 text-danger",
};

export function OrderStatusChip({ status, className }: { status: OrderStatus; className?: string }) {
  const Icon = STATUS_ICONS[status] ?? Clock;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold whitespace-nowrap",
        STATUS_STYLES[status],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {orderStatusLabel(status)}
    </span>
  );
}

// ── pay-by SLA countdown ("Pay within 43h 12m", urgent < 6h) ─────────

export function PayByCountdown({
  payBy,
  prefix = "Pay within",
  className,
}: {
  payBy: string;
  prefix?: string;
  className?: string;
}) {
  const now = useNow();
  const remaining = Date.parse(payBy) - now;
  if (isNaN(remaining)) return null;
  if (remaining <= 0) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-caption font-bold text-urgent ts-numeric", className)}>
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        Payment overdue
      </span>
    );
  }
  const urgent = remaining < 6 * 3600_000;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-caption font-semibold ts-numeric",
        urgent ? "text-urgent" : "text-warn",
        className,
      )}
    >
      <Clock className="size-3.5" aria-hidden="true" />
      {prefix} {formatRemaining(remaining)}
    </span>
  );
}

// ── payment method icon map (payments history rows) ──────────────────

const METHOD_ICONS: Record<string, LucideIcon> = {
  ecocash: Phone,
  zipit: Landmark,
  visa: CreditCard,
  mastercard: CreditCard,
  paypal: Wallet,
  cod: Banknote,
};

export function PaymentMethodIcon({
  method,
  className,
}: {
  method: string;
  className?: string;
}) {
  const Icon = METHOD_ICONS[method] ?? CreditCard;
  return <Icon className={className} aria-hidden="true" />;
}

export function paymentStatusLabel(status: string): ReactNode {
  switch (status) {
    case "settled":
    case "succeeded":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-ok">
          <CheckCircle2 className="size-3.5" aria-hidden="true" /> Settled
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-warn">
          <Clock className="size-3.5" aria-hidden="true" /> Pending
        </span>
      );
    case "failed":
    case "refunded":
      return (
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-danger">
          <XCircle className="size-3.5" aria-hidden="true" /> {status === "refunded" ? "Refunded" : "Failed"}
        </span>
      );
    default:
      return <span className="text-caption font-semibold text-muted-foreground">{status}</span>;
  }
}

// ── rated-order bookkeeping (localStorage ts_rated_orders) ───────────

const RATED_KEY = "ts_rated_orders";

function readRatedOrders(): number[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RATED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export function ratedOrderIds(): Set<number> {
  return new Set(readRatedOrders());
}

export function markOrderRated(orderId: number): void {
  const cur = readRatedOrders();
  if (cur.includes(orderId)) return;
  try {
    window.localStorage.setItem(RATED_KEY, JSON.stringify([...cur, orderId]));
  } catch {
    /* ignore */
  }
}

// ── inline error note (shared by dialogs) ────────────────────────────

function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-control border border-danger/40 bg-danger/10 p-3 text-caption font-medium text-danger"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

// ── PaymentDialog — settle a pending order ───────────────────────────

export function PaymentDialog({
  order,
  open,
  onOpenChange,
  onPaid,
}: {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
}) {
  const isMobile = useIsMobile();
  const heading = "Complete payment";
  const description = order.auction_title;

  const body = (
    <PaymentDialogBody order={order} onPaid={onPaid} onDone={() => onOpenChange(false)} />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-sheet max-h-[92dvh] overflow-y-auto ts-scrollbar px-0 pt-2 pb-6 gap-2"
        >
          <SheetHeader className="px-4 text-left">
            <SheetTitle className="text-headline">{heading}</SheetTitle>
            <SheetDescription className="line-clamp-1">Order #{order.id} · {description}</SheetDescription>
          </SheetHeader>
          <div className="px-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[88vh] overflow-y-auto ts-scrollbar">
        <DialogHeader>
          <DialogTitle className="text-headline">{heading}</DialogTitle>
          <DialogDescription className="line-clamp-1">Order #{order.id} · {description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialogBody({
  order,
  onPaid,
  onDone,
}: {
  order: Order;
  onPaid: () => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const { navigate } = useRouter();
  const [method, setMethod] = useState<PaymentMethodId>("paynow");
  const [fields, setFields] = useState<PaymentFields>(emptyPaymentFields);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState<PaymentMethodId | null>(null);

  const pay = async () => {
    if (submitting || paid) return;
    const validation = validatePaymentFields(method, fields);
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);

    // Paynow — open a gateway session, then continue on the hosted checkout
    // page (sandbox in mock mode, paynow.co.zw in production). The sandbox
    // page settles the order and broadcasts order:update.
    if (isPaynowMethod(method)) {
      try {
        const res = await startPaynowPayment({
          orderId: order.id,
          channel: fields.paynowChannel,
          phone: fields.phone,
        });
        if (res.ok && res.redirectUrl) {
          toast({
            title: "Continue on Paynow",
            description: `Complete the payment on the Paynow page — reference ${res.reference}.`,
          });
          onPaid();
          onDone();
          if (res.redirectUrl.startsWith("http")) {
            window.location.assign(res.redirectUrl);
          } else {
            navigate(res.redirectUrl.replace(/^#/, ""));
          }
        } else {
          setError(res.error ?? "Could not start the Paynow payment.");
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      await api.payOrder(order.id, method, paymentReference(method, fields));
      setPaid(method);
      toast({
        title: "Payment complete",
        description: `${paymentMethodLabel(method)} · ${formatUSD(order.final_price)} — the seller has been notified and dispatches within 3 days.`,
      });
      onPaid();
      setTimeout(() => onDone(), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment could not be completed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (paid) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <motion.span
          initial={reduced ? undefined : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          className="inline-flex"
        >
          <span className="grid size-14 place-items-center rounded-full bg-gold text-gold-on">
            <Check className="size-8" strokeWidth={3} aria-hidden="true" />
          </span>
        </motion.span>
        <p className="text-title text-foreground">Paid — order #{order.id} is confirmed</p>
        <p className="text-caption text-muted-foreground">
          {paymentMethodLabel(paid)} · {formatUSD(order.final_price)} · funds held until delivery
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 rounded-control bg-muted/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-muted-foreground">Amount due</span>
          <span className="text-bodyStrong font-bold text-foreground ts-numeric">
            {formatUSD(order.final_price)}
          </span>
        </div>
        {order.pay_by && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-muted-foreground">Deadline</span>
            <PayByCountdown payBy={order.pay_by} />
          </div>
        )}
      </div>

      <PaymentMethodPicker
        method={method}
        onMethodChange={(m) => {
          setMethod(m);
          if (error) setError(null);
        }}
        disabled={submitting}
        name={`ts-pay-method-${order.id}`}
      />

      <PaymentMethodFieldsForm
        method={method}
        fields={fields}
        onFieldsChange={(next) => {
          setFields(next);
          if (error) setError(null);
        }}
        disabled={submitting}
        idPrefix={`ts-pay-${order.id}`}
      />

      {error && <InlineError message={error} />}

      <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
        <Button
          onClick={pay}
          disabled={submitting}
          className="w-full min-h-12 rounded-control bg-gold text-gold-on text-bodyStrong hover:bg-gold/90"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Paying…
            </>
          ) : isPaynowMethod(method) ? (
            <>
              <Lock className="size-4" aria-hidden="true" /> Continue to Paynow ·{" "}
              {formatUSD(order.final_price)}
            </>
          ) : (
            <>
              <Lock className="size-4" aria-hidden="true" /> Pay {formatUSD(order.final_price)} now
            </>
          )}
        </Button>
      </motion.div>

      <p className="flex items-start gap-2 text-caption text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
        Funds are held by Tengasell until you confirm delivery · 7-day dispute window.
      </p>
    </div>
  );
}

// ── ConfirmDeliveryDialog — buyer releases the funds ─────────────────

export function ConfirmDeliveryDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.confirmDelivery(order.id);
      toast({
        title: "Delivery confirmed",
        description: `Funds released to @${order.seller_username}. You can now rate the transaction.`,
      });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm delivery.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <PackageCheck className="size-5 text-teal" aria-hidden="true" />
            Confirm delivery
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p className="font-medium text-foreground">{order.auction_title}</p>
              <p>
                Only confirm after you received the item. Funds are then released to the seller
                (@{order.seller_username}) and can no longer be held back.
              </p>
              {order.tracking && (
                <p className="ts-numeric">
                  {order.carrier} · tracking {order.tracking}
                </p>
              )}
              {error && <InlineError message={error} />}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11" disabled={submitting}>
            Not yet
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault(); // keep the dialog open while we settle
              void confirm();
            }}
            disabled={submitting}
            className="min-h-11 bg-primary text-primary-foreground hover:opacity-90"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Confirming…
              </>
            ) : (
              "Confirm delivery"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── ShipDialog — seller marks the order dispatched ───────────────────

const CARRIERS = ["SwiftExpress", "ZimPost", "DHL", "Self-delivery"] as const;

export function ShipDialog({
  order,
  open,
  onOpenChange,
  onDone,
}: {
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [carrier, setCarrier] = useState<string>("");
  const [tracking, setTracking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    if (!carrier) {
      setError("Choose a carrier.");
      return;
    }
    const track = tracking.trim();
    if (carrier !== "Self-delivery" && !track) {
      setError("Enter a tracking number so the buyer can follow the parcel.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.markShipped(order.id, carrier, track || "In person");
      toast({
        title: "Marked as dispatched",
        description: `${carrier}${track ? ` · tracking ${track}` : ""} — the buyer has been notified.`,
      });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark as shipped.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-headline">Mark as dispatched</DialogTitle>
          <DialogDescription>
            Order #{order.id} · {order.auction_title}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Carrier</Label>
            <Select value={carrier || undefined} onValueChange={(v) => { setCarrier(v); if (error) setError(null); }} disabled={submitting}>
              <SelectTrigger className="w-full min-h-12 rounded-input">
                <SelectValue placeholder="Choose carrier" />
              </SelectTrigger>
              <SelectContent>
                {CARRIERS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ts-tracking-${order.id}`}>Tracking number</Label>
            <Input
              id={`ts-tracking-${order.id}`}
              placeholder="e.g. SW7841203ZW"
              value={tracking}
              onChange={(e) => { setTracking(e.target.value); if (error) setError(null); }}
              disabled={submitting}
              className="min-h-12 rounded-input ts-numeric"
              autoComplete="off"
            />
            <p className="text-caption text-muted-foreground">
              {carrier === "Self-delivery"
                ? "Optional for self-delivery — say how you'll hand it over in Messages."
                : "From the carrier's dispatch receipt."}
            </p>
          </div>
          {error && <InlineError message={error} />}
          <div className="rounded-control bg-muted/60 p-3 flex items-start gap-2 text-caption text-muted-foreground">
            <Truck className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
            <span>
              Dispatch SLA: within 3 days of payment. Paid {order.paid_at ? formatDateTime(order.paid_at) : "—"}.
            </span>
          </div>
          <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
            <Button
              onClick={submit}
              disabled={submitting}
              className="w-full min-h-12 rounded-control text-bodyStrong"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Dispatching…
                </>
              ) : (
                <>
                  <Truck className="size-4" aria-hidden="true" /> Mark as dispatched
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── RatingDialog — rate the counterparty ─────────────────────────────

const SCORE_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Great",
  5: "Excellent",
};

export function RatingDialog({
  order,
  counterparty,
  open,
  onOpenChange,
  onDone,
}: {
  order: Order;
  counterparty: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const shown = hover ?? score;

  const submit = async () => {
    if (submitting || score === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.rateOrder(order.id, score, comment.trim());
      markOrderRated(order.id);
      toast({
        title: "Rating submitted",
        description: `${score}★ for @${counterparty} — thanks for keeping Tengasell honest.`,
      });
      onDone();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit rating.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-headline">Rate {counterparty}</DialogTitle>
          <DialogDescription>
            Order #{order.id} · {order.auction_title}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            role="radiogroup"
            aria-label={`Rate ${counterparty}`}
            className="flex justify-center gap-1"
            onMouseLeave={() => setHover(null)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)}>
                <input
                  type="radio"
                  name={`ts-rate-${order.id}`}
                  className="sr-only"
                  checked={score === n}
                  onChange={() => setScore(n)}
                  disabled={submitting}
                />
                <span
                  className={cn(
                    "grid size-11 place-items-center rounded-control transition-colors",
                    shown >= n && "bg-gold-soft",
                  )}
                >
                  <Star
                    className={cn(
                      "size-7",
                      shown >= n ? "fill-gold text-gold" : "fill-transparent text-border",
                    )}
                  />
                </span>
              </label>
            ))}
          </div>
          <p className="text-center text-caption text-muted-foreground" aria-live="polite">
            {shown > 0 ? SCORE_LABELS[shown] : "Tap a star to rate (hover to preview)"}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`ts-rate-comment-${order.id}`}>Comment (optional)</Label>
            <Textarea
              id={`ts-rate-comment-${order.id}`}
              rows={3}
              maxLength={300}
              placeholder={`How was the deal with @${counterparty}?`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={submitting}
              className="rounded-input"
            />
            <p className="text-right text-caption text-muted-foreground ts-numeric">
              {comment.length}/300
            </p>
          </div>
          {error && <InlineError message={error} />}
          <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
            <Button
              onClick={submit}
              disabled={submitting || score === 0}
              className="w-full min-h-12 rounded-control bg-gold text-gold-on text-bodyStrong hover:bg-gold/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Submitting…
                </>
              ) : (
                <>
                  <Star className="size-4 fill-gold-on" aria-hidden="true" /> Rate {counterparty}
                </>
              )}
            </Button>
          </motion.div>
          <p className="flex items-start gap-2 text-caption text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
            Ratings are public on the profile — both sides can rate once per order.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── payments history row (shared by detail view) ─────────────────────

export function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <div className="flex items-center gap-3 rounded-control border border-border bg-raised p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-teal-tint text-teal-deep dark:text-teal-soft">
        <PaymentMethodIcon method={payment.method} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-label font-semibold text-foreground truncate">
          {paymentMethodLabel(payment.method)}
        </p>
        <p className="truncate text-caption text-muted-foreground">
          <span className="ts-numeric font-mono">{payment.reference}</span> ·{" "}
          {formatDateTime(payment.created_at)}
        </p>
      </div>
      <div className="shrink-0 text-right space-y-0.5">
        <p className="text-label font-bold text-foreground ts-numeric">
          {formatUSD(payment.amount)}
        </p>
        {paymentStatusLabel(payment.status)}
      </div>
    </div>
  );
}
