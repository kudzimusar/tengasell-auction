"use client";

// Tengasell orders module — Paynow return handling (the live-mode return
// path, closed). After the buyer completes (or abandons) a payment on
// paynow.co.zw they are redirected back to #/orders/{id}
// (PAYNOW_RETURN_URL). The resulturl webhook settles server-side when
// Paynow POSTs it, but that POST can trail the buyer's redirect by
// seconds — and if it is dropped entirely, only polling finishes the job.
//
// While an order sits in pending_payment, usePaynowReturn polls
// POST /api/paynow/poll { orderId } every 4s:
//   · paid   → toast + onSettled(order) — the caller reloads the order,
//              payments and receipts
//   · cancelled / failed → stop; the buyer can retry from the payment
//     panel (a note is shown)
//   · none  → stop (no gateway session for this order — nothing to watch)
//   · disputed → stop (support path; the order stays pending per ops)
// In mock mode the same loop picks up sandbox approvals from another tab,
// so the orders page updates live even without the trade engine socket.

import { useEffect, useRef, useState } from "react";
import { RefreshCw, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatUSD } from "@/lib/tengasell/format";
import type { Order } from "@/lib/tengasell/types";

export type PaynowReturnState =
  | "idle" // order is not awaiting payment — nothing to watch
  | "checking" // first status check in flight
  | "pending" // a gateway session is open — polling
  | "paid" // settled this poll (transient — reload flips the order)
  | "cancelled" // the attempt failed/was cancelled
  | "none"; // no session for this order

interface PollResponse {
  ok?: boolean;
  status?: string;
  amount?: number;
  orderId?: number;
  order?: Order | null;
  error?: string;
}

/**
 * Poll the latest Paynow session for an order while it awaits payment.
 * `onSettled` fires once, with the freshly-settled order row, when the
 * payment completes (keep it side-effect-light — it re-renders the page).
 */
export function usePaynowReturn(
  orderId: number,
  orderStatus: string,
  onSettled?: (order: Order | null) => void,
): PaynowReturnState {
  const [polled, setPolled] = useState<PaynowReturnState>("idle");
  const settledRef = useRef(onSettled);
  const firedRef = useRef(false);

  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    // Nothing to watch unless the order is awaiting payment.
    if (orderStatus !== "pending_payment") return;

    let alive = true;
    firedRef.current = false;

    const apply = (next: PaynowReturnState) => {
      if (alive) setPolled(next);
    };

    const check = async () => {
      if (!alive || firedRef.current) return;
      apply("checking");
      try {
        const res = await fetch("/api/paynow/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        const body = (await res.json().catch(() => null)) as PollResponse | null;
        if (!alive || firedRef.current) return;
        if (!res.ok || !body?.ok) {
          // 404/400 — no session or bad input: stop quietly.
          firedRef.current = true;
          apply("none");
          return;
        }
        const s = String(body.status ?? "pending");
        if (s === "paid") {
          firedRef.current = true;
          setPolled("paid");
          toast({
            title: "Payment confirmed",
            description: `Order #${orderId} · ${formatUSD(Number(body.amount ?? 0))} — the seller has been notified and dispatches within 3 days.`,
          });
          settledRef.current?.(body.order ?? null);
        } else if (s === "cancelled" || s === "failed") {
          firedRef.current = true;
          apply("cancelled");
        } else if (s === "none" || s === "disputed") {
          firedRef.current = true;
          apply("none");
        } else {
          apply("pending");
        }
      } catch {
        // transient network error — the interval retries while alive
      }
    };

    void check();
    const timer = setInterval(() => void check(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [orderId, orderStatus]);

  // Derived: once the order leaves pending_payment nothing is watchable.
  return orderStatus !== "pending_payment" ? "idle" : polled;
}

/**
 * Inline status banner for the order detail page: "payment in progress"
 * while polling, a retry note after a cancelled/failed attempt.
 * Returns null when there is nothing to say.
 */
export function PaynowReturnBanner({ state }: { state: PaynowReturnState }) {
  if (state === "checking") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-card border border-teal/40 bg-teal-tint/60 p-3.5 dark:bg-teal-tint/30 sm:p-4"
      >
        <RefreshCw
          className="mt-0.5 size-4 shrink-0 animate-spin text-teal-deep dark:text-teal-soft"
          aria-hidden="true"
        />
        <p className="text-caption font-semibold text-foreground">
          Checking the Paynow payment status…
        </p>
      </div>
    );
  }

  if (state === "pending") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-card border border-teal/40 bg-teal-tint/60 p-3.5 dark:bg-teal-tint/30 sm:p-4"
      >
        <RefreshCw
          className="mt-0.5 size-4 shrink-0 animate-spin text-teal-deep dark:text-teal-soft"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-label font-bold text-teal-deep dark:text-teal-soft">
            Paynow payment in progress
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            This page updates automatically the moment Paynow confirms —
            usually within a minute of approving the payment on your phone
            or card.
          </p>
        </div>
      </div>
    );
  }

  if (state === "cancelled") {
    return (
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-card border border-warn/40 bg-gold-soft/60 p-3.5 sm:p-4"
      >
        <XCircle className="mt-0.5 size-4 shrink-0 text-gold-deep" aria-hidden="true" />
        <p className="text-caption font-medium text-gold-deep">
          The last Paynow attempt was cancelled or failed. Payment can be
          retried from the payment panel below — Paynow (EcoCash, InnBucks,
          card) or another method.
        </p>
      </div>
    );
  }

  return null;
}
