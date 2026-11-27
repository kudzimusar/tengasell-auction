"use client";

// Tengasell orders module — Paynow return handling (the live-mode return
// path, closed). After the buyer completes (or abandons) a payment on
// paynow.co.zw they are redirected back to #/orders/{id}
// (PAYNOW_RETURN_URL). The resulturl webhook settles server-side when
// Paynow POSTs it, but that POST can trail the buyer's redirect by
// seconds — and if it is dropped entirely, only polling finishes the job.
//
// While an order sits in pending_payment, usePaynowReturn polls
// POST /api/paynow/poll { orderId } every 4s WITH THE SESSION CREDENTIALS
// (the server authenticates and authorizes the caller as an order party):
//   · paid   → toast + onSettled() — the caller reloads the order,
//              payments and receipts
//   · cancelled / failed → stop; the buyer can retry from the payment
//     panel (a note is shown)
//   · none  → stop (no gateway session for this order — nothing to watch)
//   · disputed → stop (support path; the order stays pending per ops)
//   · 401   → stop ("signin") — the buyer must sign in again to watch the
//     payment (never a fake success)
//   · 5xx / network / malformed response → TRANSIENT: keep retrying (up
//     to MAX_TRANSIENT_ERRORS consecutive failures) and then stop with
//     "unreachable" + a manual re-check action — never claim success and
//     never permanently stop on the first hiccup (R5).
// In mock mode the same loop picks up sandbox approvals from another tab,
// so the orders page updates live even without the trade engine socket.

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, XCircle, WifiOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatUSD } from "@/lib/tengasell/format";
import { postPaynowPoll, type PaynowPollOutcome } from "@/lib/tengasell/paynow-client";
import type { Order } from "@/lib/tengasell/types";

export type PaynowReturnState =
  | "idle" // order is not awaiting payment — nothing to watch
  | "checking" // first status check in flight
  | "pending" // a gateway session is open — polling
  | "paid" // settled this poll (transient — reload flips the order)
  | "cancelled" // the attempt failed/was cancelled
  | "none" // no session for this order
  | "unreachable" // transient errors exhausted — manual re-check offered
  | "signin"; // session expired — sign in to watch this payment

/** Consecutive transient failures tolerated before "unreachable". */
export const MAX_TRANSIENT_ERRORS = 6;

// ── the decision table (pure — exported for unit tests) ────────────────

export interface PollSignal {
  /** HTTP status (0 = network failure). */
  http: number;
  /** Parsed body (null on network error / malformed JSON). */
  body: PaynowPollOutcome["body"];
}

export type PollDecision =
  | { kind: "paid"; amount: number }
  | { kind: "terminal"; state: "cancelled" | "none" }
  | { kind: "signin" }
  | { kind: "retry" }
  | { kind: "pending" };

/**
 * Classify one poll result. NEVER returns "paid" unless the server said
 * paid with ok:true — errors of every kind map to retry/stop states, so
 * a failing network can never be mistaken for a completed payment.
 */
export function decidePoll(signal: PollSignal): PollDecision {
  const { http, body } = signal;
  if (http === 401) return { kind: "signin" };
  if (http === 0 || http >= 500) return { kind: "retry" }; // transient
  if (!body?.ok) {
    // 400/404 and malformed bodies — no session or bad input: stop
    // quietly; there is nothing this client can do about it by polling.
    return { kind: "terminal", state: "none" };
  }
  const s = String(body.status ?? "pending");
  if (s === "paid") return { kind: "paid", amount: Number(body.amount ?? 0) };
  if (s === "cancelled" || s === "failed") {
    return { kind: "terminal", state: "cancelled" };
  }
  if (s === "none" || s === "disputed") return { kind: "terminal", state: "none" };
  return { kind: "pending" };
}

// ── the hook ──────────────────────────────────────────────────────────

/**
 * Poll the latest Paynow session for an order while it awaits payment.
 * `onSettled` fires once, with null (the minimal DTO carries no order row —
 * the caller reloads the authoritative order), when the payment completes.
 * Returns the display state for the banner. Back-compatible with the
 * original completion-PR wiring (`onSettled(order | null)`).
 */
export function usePaynowReturn(
  orderId: number,
  orderStatus: string,
  onSettled?: (order: Order | null) => void,
): PaynowReturnState {
  const [polled, setPolled] = useState<PaynowReturnState>("idle");
  const settledRef = useRef(onSettled);
  const firedRef = useRef(false);
  const firstRef = useRef(true);
  const errorsRef = useRef(0);
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const apply = useCallback((next: PaynowReturnState) => {
    if (aliveRef.current) setPolled(next);
  }, []);

  const check = useCallback(async () => {
    if (!aliveRef.current || firedRef.current) return;
    if (firstRef.current) {
      firstRef.current = false;
      apply("checking");
    }
    const outcome = await postPaynowPoll({ orderId });
    if (!aliveRef.current || firedRef.current) return;

    const decision = decidePoll({ http: outcome.http, body: outcome.body });
    switch (decision.kind) {
      case "paid": {
        firedRef.current = true;
        setPolled("paid");
        toast({
          title: "Payment confirmed",
          description: `Order #${orderId} · ${formatUSD(decision.amount)} — the seller has been notified and dispatches within 3 days.`,
        });
        settledRef.current?.(null); // caller reloads the authoritative row
        return;
      }
      case "terminal":
        firedRef.current = true;
        apply(decision.state);
        return;
      case "signin":
        firedRef.current = true;
        apply("signin");
        return;
      case "retry":
        errorsRef.current += 1;
        if (errorsRef.current > MAX_TRANSIENT_ERRORS) {
          // Transient failures exhausted — stop the loop, keep the
          // recovery experience (manual re-check) alive.
          firedRef.current = true;
          apply("unreachable");
        } else {
          apply("pending");
        }
        return;
      case "pending":
      default:
        errorsRef.current = 0;
        apply("pending");
        return;
    }
  }, [apply, orderId]);

  useEffect(() => {
    // Nothing to watch unless the order is awaiting payment.
    if (orderStatus !== "pending_payment") return;

    aliveRef.current = true;
    firedRef.current = false;
    firstRef.current = true;
    errorsRef.current = 0;

    const initial = setTimeout(() => void check(), 0);
    timerRef.current = setInterval(() => void check(), 4000);
    return () => {
      aliveRef.current = false;
      clearTimeout(initial);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [check, orderStatus]);

  // Derived: once the order leaves pending_payment nothing is watchable.
  return orderStatus !== "pending_payment" ? "idle" : polled;
}

// ── the banner ─────────────────────────────────────────────────────────

/**
 * Inline status banner for the order detail page: "payment in progress"
 * while polling, a retry note after a cancelled/failed attempt, a
 * recovery note with a manual re-check after connectivity problems, and a
 * sign-in prompt when the session expired. Returns null when there is
 * nothing to say.
 */
export function PaynowReturnBanner({
  state,
  onRecheck,
}: {
  state: PaynowReturnState;
  onRecheck?: () => void;
}) {
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

  if (state === "unreachable") {
    return (
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-card border border-border bg-muted/50 p-3.5 sm:p-4"
      >
        <WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-caption font-medium text-foreground">
            Couldn&apos;t reach the payment status check. Your payment may
            still have completed — no money state is changed by this page.
          </p>
          {onRecheck ? (
            <button
              type="button"
              onClick={onRecheck}
              className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-control text-caption font-semibold text-teal hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Check the payment status again
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (state === "signin") {
    return (
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-card border border-border bg-muted/50 p-3.5 sm:p-4"
      >
        <WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-caption font-medium text-foreground">
          Your session expired while watching this payment — sign in again
          to see its status. The payment itself is unaffected.
        </p>
      </div>
    );
  }

  return null;
}
