import { NextRequest, NextResponse } from "next/server";
import { validateCallback } from "@/lib/server/paynow";
import {
  isValidReference,
  loadSessionByReference,
  patchSession,
  settlePaidOrder,
} from "@/lib/server/paynow-order";

// POST /api/paynow/callback — Paynow resulturl webhook (PRODUCTION).
//
// Paynow POSTs an application/x-www-form-urlencoded body (reference,
// paynowreference, amount, status, pollurl, url, hash) once the buyer
// completes (or abandons) the payment. We:
//   1. validate the hash (all values except "hash", in order, urlencode,
//      + integration key, MD5, uppercase),
//   2. find the session by merchant reference,
//   3. map the Paynow status and settle the order exactly like the trade
//      engine's order:pay handler when paid,
//   4. answer with the plain text body "OK" (Paynow retries otherwise).
//
// The body must be read as text and parsed in order — JSON helpers would
// scramble the field order the hash depends on.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAID = new Set(["paid", "awaiting delivery", "delivered", "sent"]);
const CANCELLED = new Set(["cancelled", "cancelled by user", "failed"]);

export async function POST(req: NextRequest) {
  try {
    const integrationKey = process.env.PAYNOW_INTEGRATION_KEY;
    if (!integrationKey) {
      // sandbox build — no webhook configured
      return new NextResponse("Sandbox mode — resulturl is not configured.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const text = await req.text().catch(() => "");
    const fields: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(text)) {
      if (k in fields) continue;
      fields[k] = v;
    }

    if (!validateCallback(fields, integrationKey)) {
      return new NextResponse("Invalid hash.", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const reference = String(fields.reference ?? "");
    if (!isValidReference(reference)) {
      return new NextResponse("Unknown reference.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const session = await loadSessionByReference(reference);
    if (!session) {
      return new NextResponse("Unknown reference.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const status = String(fields.status ?? "").trim().toLowerCase();
    let next = session.status;
    if (PAID.has(status)) next = "paid";
    else if (CANCELLED.has(status)) next = "cancelled";
    // disputed/refunded/created → keep the current status

    if (next !== session.status) {
      await patchSession(session, { status: next });
    }
    if (next === "paid") {
      await settlePaidOrder({ ...session, status: next });
    }

    // Paynow expects exactly "OK" (with 200) to stop retrying.
    return new NextResponse("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    console.error("[paynow/callback]", err);
    return new NextResponse("Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
