import { NextRequest, NextResponse } from "next/server";
import { isMockMode, isSafeGatewayUrl, pollStatus, type PollStatusResult } from "@/lib/server/paynow";
import {
  fetchOrderWithUserToken,
  isValidReference,
  loadLatestSessionForOrder,
  loadSessionByReference,
  maskPhone,
  patchSession,
  resolveUserFromToken,
  settlePaidOrder,
  type PaynowSessionRow,
} from "@/lib/server/paynow-order";
import { tbCreate, nowIso } from "@/lib/server/trailbase-admin";

// POST /api/paynow/poll — AUTHENTICATED status of a Paynow payment session.
//
// Request JSON (either key — reference wins when both are present):
//   { reference: string }  — the TS-ORDR… merchant reference (sandbox page)
//   { orderId: number }    — the LATEST session for an order; the key used
//                            by the return-page poll loop after the buyer
//                            comes back from paynow.co.zw
// Authorization: `Authorization: Bearer <trailbase auth_token>` — the
// caller must be a PARTY to the order (buyer, seller or admin). The check
// is the canonical order-access policy: the order row is fetched WITH the
// caller's own token, so a TrailBase ACL hit proves party access. Anything
// else — unauthenticated, cross-buyer, guessed sequential order id, or an
// enumerated reference that exists but belongs to someone else — gets the
// same 404 "Payment session not found." (no existence signal).
//
// Response JSON — minimal, customer-safe DTO (R1/R7):
//   { ok, status, orderId, amount, method, reference, title, payBy,
//     phoneMask, error? }
//   · status: "pending" | "paid" | "cancelled" | "failed" | "disputed"
//     | "none" ("none" = no session for the order — the client stops
//     polling; unknown references are a 404).
//   · phoneMask — masked display hint; the raw number is never returned.
//   · NO order row, NO raw phone, NO poll_url, NO gateway hash.
//
// · Mock mode reads the paynow_sessions row directly (the sandbox route
//   drives state). Production polls Paynow's pollurl while the session is
//   open — the pollurl is host-allowlisted and the gateway-reported amount
//   must match the session before a paid status is applied — then settles
//   the order through the journal-guarded idempotent settlement exactly
//   like the trade engine's order:pay handler.

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

/** Gateway-reported amount vs session amount (cents compare, null = absent). */
function gatewayAmountMismatch(
  sessionAmount: number,
  gatewayAmount: string | undefined,
): string | null {
  if (gatewayAmount == null || gatewayAmount === "") return null;
  const n = Number(gatewayAmount);
  if (!Number.isFinite(n)) return gatewayAmount;
  return Math.round(n * 100) === Math.round(sessionAmount * 100)
    ? null
    : gatewayAmount;
}

/** Live mode: refresh the row from Paynow while the session is still open.
 *  Gateway evidence (amount) is validated before any status is applied. */
async function refreshFromGateway(
  session: PaynowSessionRow,
): Promise<PaynowSessionRow> {
  if (
    !isMockMode() &&
    session.status === "pending" &&
    session.poll_url &&
    isSafeGatewayUrl(session.poll_url)
  ) {
    const result = await pollStatus(session.poll_url);
    const mismatch = gatewayAmountMismatch(session.amount, result.amount);
    if (mismatch != null) {
      // Verified gateway evidence contradicts the session record — fail
      // closed: mark disputed (support path), never settle.
      const next = await patchSession(session, {
        status: "disputed",
        error: `amount-mismatch: gateway ${mismatch} vs session ${session.amount}`,
      });
      await tbCreate("audit_events", {
        user: null,
        action: "paynow:poll",
        entity: "paynow_sessions",
        entity_id: session.id,
        source: "poll",
        payload: JSON.stringify({
          reference: session.reference,
          to: "disputed",
          reason: "amount-mismatch",
          gatewayAmount: mismatch,
        }),
        created_at: nowIso(),
      });
      return next;
    }
    const next = sessionStatusFromPoll(result);
    if (next !== session.status) {
      return patchSession(session, { status: next });
    }
  }
  return session;
}

/** Shared tail: settle (idempotent, journal-guarded) when paid, then render
 *  the minimal customer-safe DTO. */
async function respondFor(session: PaynowSessionRow, title: string, payBy: string | null) {
  if (session.status === "paid") {
    await settlePaidOrder(session);
  }

  return json({
    ok: true,
    status: session.status,
    reference: session.reference,
    amount: session.amount,
    method: session.method,
    phoneMask: maskPhone(session.phone), // masked display hint only
    orderId: session.order_id,
    title,
    payBy,
  });
}

export async function POST(req: NextRequest) {
  try {
    // ── R1: authenticate the caller first — no payment info without it ─
    const user = await resolveUserFromToken(req.headers.get("authorization"));
    if (!user) {
      return json({ ok: false, error: "Sign in to check this payment." }, 401);
    }

    const body = (await req.json().catch(() => null)) as
      | { reference?: unknown; orderId?: unknown }
      | null;

    // ── by merchant reference (sandbox page / receipts) ───────────────
    const reference =
      typeof body?.reference === "string" ? body.reference.trim() : "";
    let session: PaynowSessionRow | null = null;
    let orderIdForAuth = 0;

    if (reference) {
      if (!isValidReference(reference)) {
        return json({ ok: false, error: "Payment session not found." }, 404);
      }
      session = await loadSessionByReference(reference);
      if (!session) {
        return json({ ok: false, error: "Payment session not found." }, 404);
      }
      orderIdForAuth = session.order_id;
    } else {
      // ── by order id (return-page poll loop) ─────────────────────────
      const orderId = Number(body?.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return json({ ok: false, error: "Provide a reference or an orderId." }, 400);
      }
      orderIdForAuth = orderId;
      session = await loadLatestSessionForOrder(orderId);
    }

    // ── R1: authorize against the canonical order-access policy — the
    // caller's own token must be able to read the order row (buyer,
    // seller or admin). A miss is indistinguishable from "not found".
    const orderRow = await fetchOrderWithUserToken(user.token, orderIdForAuth);
    if (!orderRow) {
      return json({ ok: false, error: "Payment session not found." }, 404);
    }

    // No session for this order yet — not an error for a polling client
    // (the buyer may simply not have started a gateway session).
    if (!session) {
      return json({ ok: true, status: "none", orderId: orderIdForAuth });
    }

    return await respondFor(
      await refreshFromGateway(session),
      orderRow.auction_title ?? "",
      orderRow.pay_by ?? null,
    );
  } catch (err) {
    console.error("[paynow/poll]", err);
    return json({ ok: false, error: "Unexpected error — please retry." }, 500);
  }
}
