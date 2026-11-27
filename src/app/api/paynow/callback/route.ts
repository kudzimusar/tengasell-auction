import { NextRequest, NextResponse } from "next/server";
import { validateCallback } from "@/lib/server/paynow";
import {
  isValidReference,
  loadSessionByReference,
  patchSession,
  settlePaidOrder,
  type PaynowSessionRow,
} from "@/lib/server/paynow-order";
import { tbCreate, nowIso } from "@/lib/server/trailbase-admin";

// POST /api/paynow/callback — Paynow resulturl webhook (PRODUCTION).
//
// Paynow POSTs an application/x-www-form-urlencoded body (reference,
// paynowreference, amount, status, pollurl, url, hash) once the buyer
// completes (or abandons) the payment. We:
//   1. validate the hash (all values except "hash", in order, urlencode,
//      + integration key, MD5, uppercase),
//   2. find the session by merchant reference (refreshing the pollurl —
//      Paynow can reissue it),
//   3. map the Paynow status (paid / cancelled / failed / disputed — a
//      session that already PAID is never downgraded; a post-payment
//      "disputed" webhook marks the session so support sees it),
//   4. settle the order exactly like the trade engine's order:pay handler
//      when paid,
//   5. audit STATE TRANSITIONS (action "paynow:callback" — signal, not
//      noise: repeat deliveries that change nothing write nothing),
//   6. answer with the plain text body "OK" (Paynow retries otherwise).
//
// The body must be read as text and parsed in order — JSON helpers would
// scramble the field order the hash depends on.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAID = new Set(["paid", "awaiting delivery", "delivered", "sent"]);
const CANCELLED = new Set(["cancelled", "cancelled by user", "failed"]);
const DISPUTED = new Set(["disputed", "refunded"]);

function plain(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const integrationKey = process.env.PAYNOW_INTEGRATION_KEY;
    if (!integrationKey) {
      // sandbox build — no webhook configured
      return plain("Sandbox mode — resulturl is not configured.", 503);
    }

    const text = await req.text().catch(() => "");
    const fields: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(text)) {
      if (k in fields) continue;
      fields[k] = v;
    }

    if (!validateCallback(fields, integrationKey)) {
      return plain("Invalid hash.", 403);
    }

    const reference = String(fields.reference ?? "");
    if (!isValidReference(reference)) {
      return plain("Unknown reference.", 404);
    }

    const session = await loadSessionByReference(reference);
    if (!session) {
      return plain("Unknown reference.", 404);
    }

    // Paynow can reissue the pollurl per delivery — keep the row fresh so
    // the return-page poll loop and the sweep always hit a live URL.
    const pollUrl =
      typeof fields.pollurl === "string" && fields.pollurl ? fields.pollurl : null;

    const status = String(fields.status ?? "").trim().toLowerCase();
    let next = session.status;
    if (PAID.has(status)) next = "paid";
    else if (session.status !== "paid") {
      // a session that already PAID is never downgraded (money in beats a
      // late "cancelled" repeat); pre-payment disputes/cancellations map:
      if (CANCELLED.has(status)) next = "cancelled";
      else if (DISPUTED.has(status)) next = "disputed";
    }

    const patch: Partial<PaynowSessionRow> = {};
    if (next !== session.status) patch.status = next;
    if (pollUrl && pollUrl !== session.poll_url) patch.poll_url = pollUrl;

    if (patch.status !== undefined || patch.poll_url !== undefined) {
      await patchSession(session, patch);
    }

    // audit the STATE TRANSITION only (repeat deliveries write nothing)
    if (next !== session.status) {
      await tbCreate("audit_events", {
        user: null,
        action: "paynow:callback",
        entity: "paynow_sessions",
        entity_id: session.id,
        source: "webhook",
        payload: JSON.stringify({
          reference,
          paynowReference: fields.paynowreference ?? null,
          from: session.status,
          to: next,
        }),
        created_at: nowIso(),
      });
    }

    if (next === "paid") {
      await settlePaidOrder({ ...session, status: next });
    }

    // Paynow expects exactly "OK" (with 200) to stop retrying.
    return plain("OK", 200);
  } catch (err) {
    console.error("[paynow/callback]", err);
    return plain("Error", 500);
  }
}
