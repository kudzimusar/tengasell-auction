import { NextRequest, NextResponse } from "next/server";
import { isMockMode, pollStatus } from "@/lib/server/paynow";
import {
  isValidReference,
  loadSessionByReference,
  patchSession,
  settlePaidOrder,
  toOrderRow,
} from "@/lib/server/paynow-order";
import { tbGet } from "@/lib/server/trailbase-admin";

// POST /api/paynow/poll — current status of a Paynow session.
//
// Request JSON:  { reference: string }
// Response JSON: { ok, status, reference, amount, method, phone, orderId,
//                  title, payBy, order? }
//
// · Mock mode reads the paynow_sessions row directly.
// · Production polls Paynow's pollurl (pollStatus), updates the row and —
//   once paid — settles the order exactly like the trade engine's
//   order:pay handler.
// · `order` is returned whenever the session is paid (fresh admin row).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { reference?: unknown } | null;
    const reference = String(body?.reference ?? "").trim();

    if (!isValidReference(reference)) {
      return json({ ok: false, error: "Invalid reference." }, 400);
    }

    let session = await loadSessionByReference(reference);
    if (!session) {
      return json({ ok: false, error: "Payment session not found." }, 404);
    }

    // ── live mode: refresh from Paynow while the session is open ──────
    if (!isMockMode() && session.status === "pending" && session.poll_url) {
      const result = await pollStatus(session.poll_url);
      const next = result.paid
        ? "paid"
        : result.failed
          ? "failed"
          : result.cancelled
            ? "cancelled"
            : "pending";
      if (next !== session.status) {
        session = await patchSession(session, { status: next });
      }
    }

    // ── settle (idempotent) once paid ────────────────────────────────
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
      phone: session.phone,
      orderId: session.order_id,
      title: orderRow?.auction_title ?? "",
      payBy: orderRow?.pay_by ?? null,
      order,
    });
  } catch (err) {
    console.error("[paynow/poll]", err);
    return json({ ok: false, error: "Unexpected error — please retry." }, 500);
  }
}
