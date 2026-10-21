import { NextRequest, NextResponse } from "next/server";
import { isMockMode, mockSetStatus } from "@/lib/server/paynow";
import {
  isValidReference,
  loadSessionByReference,
  patchSession,
  settlePaidOrder,
} from "@/lib/server/paynow-order";

// POST /api/paynow/sandbox — simulate the buyer approving / declining a
// payment inside the sandbox (mock) gateway page.
//
// Request JSON:  { reference: string, action: "approve" | "decline" }
// Response JSON: { ok, status, order? }
//
// MOCK MODE ONLY — returns 403 when real Paynow credentials are configured
// (in production only Paynow's resulturl webhook and poll can settle).
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
    if (!isMockMode()) {
      return json({ ok: false, error: "Sandbox disabled" }, 403);
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
    if (session.status !== "pending") {
      // already decided — respond with the settled state
      const order =
        session.status === "paid" ? await settlePaidOrder(session) : null;
      return json({ ok: true, status: session.status, order });
    }

    if (action === "decline") {
      const next = await patchSession(session, { status: "cancelled" });
      mockSetStatus(reference, "cancelled");
      return json({ ok: true, status: next.status });
    }

    // approve → mark paid, then settle order + payments + notify + audit
    const paid = await patchSession(session, { status: "paid" });
    mockSetStatus(reference, "paid");
    const order = await settlePaidOrder(paid);
    if (!order) {
      return json({ ok: false, error: "Order not found." }, 404);
    }
    return json({ ok: true, status: "paid", order });
  } catch (err) {
    console.error("[paynow/sandbox]", err);
    return json({ ok: false, error: "Unexpected error — please retry." }, 500);
  }
}
