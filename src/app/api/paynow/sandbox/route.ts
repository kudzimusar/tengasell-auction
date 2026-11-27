import { NextRequest, NextResponse } from "next/server";
import { isMockMode, mockSetStatus, mockPaymentsAllowed } from "@/lib/server/paynow";
import {
  fetchOrderWithUserToken,
  isValidReference,
  loadSessionByReference,
  patchSession,
  resolveUserFromToken,
  settlePaidOrder,
} from "@/lib/server/paynow-order";

// POST /api/paynow/sandbox — simulate the buyer approving / declining a
// payment inside the sandbox (mock) gateway page.
//
// Request JSON:  { reference: string, action: "approve" | "decline" }
// Auth:          Authorization: Bearer <trailbase auth_token> — the caller
//                must be a party to the order (R1: the mock gateway is not
//                an anonymous settlement oracle).
// Response JSON: { ok, status, orderId, amount, error? } — minimal,
//                customer-safe DTO (no order row).
//
// MOCK PAYMENTS ONLY (R6): available when mock payments are allowed on
// this deployment — development/CI by default, production ONLY with an
// explicit PAYNOW_ALLOW_MOCK=1 opt-in. In a production deployment without
// credentials the route fails closed (403) — a missing Fly secret can
// never silently turn the sandbox into a free "approve payment" button.
//
// "approve" mirrors the trade engine's order:pay settlement exactly:
// orders → paid, payments row insert, seller notification, audit event.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    // R6 — mock/live safety: fail closed unless mock payments are allowed.
    if (!mockPaymentsAllowed()) {
      return json({ ok: false, error: "Sandbox disabled" }, 403);
    }

    // R1 — authenticate; the sandbox acts on the buyer's payment.
    const user = await resolveUserFromToken(req.headers.get("authorization"));
    if (!user) {
      return json({ ok: false, error: "Sign in to use the sandbox checkout." }, 401);
    }

    const body = (await req.json().catch(() => null)) as
      | { reference?: unknown; action?: unknown }
      | null;
    const reference = String(body?.reference ?? "").trim();
    const action = String(body?.action ?? "");

    if (!isValidReference(reference)) {
      return json({ ok: false, error: "Invalid reference." }, 400);
    }
    if (action !== "approve" && action !== "decline") {
      return json({ ok: false, error: "Unknown action." }, 400);
    }

    const session = await loadSessionByReference(reference);
    if (!session) {
      return json({ ok: false, error: "Payment session not found." }, 404);
    }

    // R1 — authorize against the canonical order-access policy (the
    // caller's own token must be able to read the order row).
    const order = await fetchOrderWithUserToken(user.token, session.order_id);
    if (!order) {
      return json({ ok: false, error: "Payment session not found." }, 404);
    }

    if (session.status !== "pending") {
      // already decided — respond with the settled state (minimal DTO)
      return json({
        ok: true,
        status: session.status,
        orderId: session.order_id,
        amount: session.amount,
      });
    }

    if (action === "decline") {
      const next = await patchSession(session, { status: "cancelled" });
      mockSetStatus(reference, "cancelled");
      return json({ ok: true, status: next.status, orderId: next.order_id, amount: next.amount });
    }

    // approve → mark paid, then settle order + payments + notify + audit
    // (journal-guarded idempotent settlement — repeats converge)
    const paid = await patchSession(session, { status: "paid" });
    mockSetStatus(reference, "paid");
    const orderRow = await settlePaidOrder(paid);
    if (!orderRow) {
      return json({ ok: false, error: "Order not found." }, 404);
    }
    return json({
      ok: true,
      status: "paid",
      orderId: session.order_id,
      amount: session.amount,
    });
  } catch (err) {
    console.error("[paynow/sandbox]", err);
    return json({ ok: false, error: "Unexpected error — please retry." }, 500);
  }
}
