import { NextRequest, NextResponse } from "next/server";
import { isMockMode, pollStatus, type PollStatusResult } from "@/lib/server/paynow";
import {
  isValidReference,
  loadLatestSessionForOrder,
  loadSessionByReference,
  patchSession,
  settlePaidOrder,
  toOrderRow,
  type PaynowSessionRow,
} from "@/lib/server/paynow-order";
import { tbGet } from "@/lib/server/trailbase-admin";

// POST /api/paynow/poll — current status of a Paynow payment session.
//
// Request JSON (either key — reference wins when both are present):
//   { reference: string }  — the TS-ORDR… merchant reference (sandbox page,
//                            receipts, deep links)
//   { orderId: number }    — the LATEST session for an order; the key used
//                            by the return-page poll loop after the buyer
//                            comes back from paynow.co.zw (their browser
//                            only knows the orderId from the return URL)
//
// Response JSON: { ok, status, reference, amount, method, phone, orderId,
//                  title, payBy, order?, error? }
//
// · status: "pending" | "paid" | "cancelled" | "failed" | "disputed"
//           | "none" ("none" = no session for the order — the client stops
//           polling; on the reference path an unknown reference is a 404).
// · `phone` is ALWAYS redacted (null): the raw mobile number is private
//   buyer data — the sandbox page shows a masked hint from its redirect
//   URL instead, so nothing user-visible changes.
// · Mock mode reads the paynow_sessions row directly (the sandbox route
//   drives state). Production polls Paynow's pollurl while the session is
//   open, updates the row and — once paid — settles the order exactly
//   like the trade engine's order:pay handler (payments row, seller
//   notification, audit event, finance escrow funding).
// · `order` is returned whenever the session is paid (fresh admin row).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

/** Normalize a Paynow pollStatus() result to a session status value. */
function sessionStatusFromPoll(result: PollStatusResult): string {
  if (result.paid) return "paid";
  if (result.failed) return "failed";
  if (result.cancelled) return "cancelled";
  if (result.disputed) return "disputed";
  return "pending";
}

/** Live mode: refresh the row from Paynow while the session is still open. */
async function refreshFromGateway(
  session: PaynowSessionRow,
): Promise<PaynowSessionRow> {
  if (!isMockMode() && session.status === "pending" && session.poll_url) {
    const result = await pollStatus(session.poll_url);
    const next = sessionStatusFromPoll(result);
    if (next !== session.status) {
      return patchSession(session, { status: next });
    }
  }
  return session;
}

/** Shared tail: settle when paid, then render the response shape. */
async function respondFor(session: PaynowSessionRow) {
  let order: ReturnType<typeof toOrderRow> = null;
  if (session.status === "paid") {
    order = await settlePaidOrder(session);
  }

  const orderRow = toOrderRow(await tbGet("orders", session.order_id));

  return json({
    ok: true,
    status: session.status,
    reference: session.reference,
    amount: session.amount,
    method: session.method,
    phone: null, // redacted — display-only buyer data
    orderId: session.order_id,
    title: orderRow?.auction_title ?? "",
    payBy: orderRow?.pay_by ?? null,
    order,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { reference?: unknown; orderId?: unknown }
      | null;

    // ── by merchant reference (sandbox page / receipts) ───────────────
    const reference =
      typeof body?.reference === "string" ? body.reference.trim() : "";
    if (reference) {
      if (!isValidReference(reference)) {
        return json({ ok: false, error: "Invalid reference." }, 400);
      }
      const session = await loadSessionByReference(reference);
      if (!session) {
        return json({ ok: false, error: "Payment session not found." }, 404);
      }
      return respondFor(await refreshFromGateway(session));
    }

    // ── by order id (return-page poll loop, reconciliation callers) ────
    const orderId = Number(body?.orderId);
    if (Number.isInteger(orderId) && orderId > 0) {
      const session = await loadLatestSessionForOrder(orderId);
      if (!session) {
        // No session for this order yet — not an error for a polling client
        // (the buyer may simply not have started a gateway session).
        return json({ ok: true, status: "none", orderId });
      }
      return respondFor(await refreshFromGateway(session));
    }

    return json({ ok: false, error: "Provide a reference or an orderId." }, 400);
  } catch (err) {
    console.error("[paynow/poll]", err);
    return json({ ok: false, error: "Unexpected error — please retry." }, 500);
  }
}
