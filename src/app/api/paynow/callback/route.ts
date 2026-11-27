import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  isMockMode,
  isSafeGatewayUrl,
  validateCallback,
} from "@/lib/server/paynow";
import {
  loadSessionByReference,
  patchSession,
  settlePaidOrder,
  isValidReference,
  type PaynowSessionRow,
} from "@/lib/server/paynow-order";
import { tbCreate, nowIso } from "@/lib/server/trailbase-admin";

// POST /api/paynow/callback — Paynow resulturl webhook (PRODUCTION).
//
// The gateway POSTs an url-encoded form the moment the buyer completes (or
// abandons) the payment. We:
//   1. validate the hash (all values except "hash", in order, urlencode,
//      + integration key, MD5, uppercase) — no valid hash, no trust;
//   2. find the session by merchant reference (refreshing the pollurl —
//      Paynow can reissue it; the URL must be an https Paynow host to be
//      stored at all — R4 trust boundary);
//   3. VALIDATE THE MONEY: the callback amount must match the session
//      amount. A hash-valid delivery with mismatched money is an
//      integrity violation → the session is disputed, never settled;
//   4. map the Paynow status (paid / cancelled / failed / disputed — a
//      session that already PAID is never downgraded by a late repeat);
//   5. settle the order (journal-guarded idempotent settlement, exactly
//      like the trade engine's order:pay) when paid;
//   6. audit STATE TRANSITIONS (action "paynow:callback" — signal, not
//      noise: repeat deliveries that change nothing write nothing);
//   7. answer with the plain text body "OK" (Paynow retries otherwise).
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

/** Parse "13.50" → cents; null when absent or unparseable. */
function amountCents(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export async function POST(req: NextRequest) {
  try {
    const integrationKey = process.env.PAYNOW_INTEGRATION_KEY;
    if (!integrationKey) {
      // No credentials → live settlement is impossible; fail closed.
      // (Mock-mode deployments configure no resulturl at all.)
      return plain("Sandbox mode — resulturl is not configured.", 503);
    }

    const text = await req.text().catch(() => "");
    const fields: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(text)) {
      if (k in fields) continue; // first wins — field order matters
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

    let current = session;

    // ── R4: validate the money before anything is trusted ────────────
    const gatewayAmount = amountCents(fields.amount);
    const sessionCents = Math.round(session.amount * 100);
    if (gatewayAmount == null || gatewayAmount !== sessionCents) {
      // Hash-valid but the amount contradicts the session record — fail
      // closed: mark the session disputed (support path), never settle.
      if (session.status !== "paid" && session.status !== "disputed") {
        await patchSession(session, {
          status: "disputed",
          error: `amount-mismatch: gateway ${String(fields.amount ?? "none")} vs session ${session.amount}`,
        });
      }
      await tbCreate("audit_events", {
        user: null,
        action: "paynow:callback",
        entity: "paynow_sessions",
        entity_id: session.id,
        source: "webhook",
        payload: JSON.stringify({
          reference,
          reason: "amount-mismatch",
          gatewayAmount: fields.amount ?? null,
          sessionAmount: session.amount,
        }),
        created_at: nowIso(),
      });
      // Acknowledge (mismatched retries will not fix themselves) — the
      // disputed session is the actionable signal for support.
      return plain("OK", 200);
    }

    // ── R4: gateway polling URLs — only https Paynow hosts are stored ─
    const pollUrl =
      typeof fields.pollurl === "string" && fields.pollurl ? fields.pollurl : null;
    let pollUrlRejected = false;
    if (pollUrl && pollUrl !== current.poll_url) {
      if (isSafeGatewayUrl(pollUrl)) {
        // safe → keep the row fresh so the poll loop and sweep hit a
        // live URL
        current = await patchSession(current, { poll_url: pollUrl });
      } else {
        // unsafe destination (http / internal host / look-alike) —
        // rejected: the stored URL stays untouched, we never call it.
        pollUrlRejected = true;
      }
    }

    const status = String(fields.status ?? "").trim().toLowerCase();
    let next = current.status;
    if (PAID.has(status)) next = "paid";
    else if (current.status !== "paid") {
      // a session that already PAID is never downgraded (money in beats a
      // late "cancelled" repeat); pre-payment disputes map:
      if (CANCELLED.has(status)) next = "cancelled";
      else if (DISPUTED.has(status)) next = "disputed";
    }

    const patch: Partial<PaynowSessionRow> = {};
    if (next !== current.status) patch.status = next;

    if (patch.status !== undefined) {
      const from = current.status;
      current = await patchSession(current, patch);
      // audit the STATE TRANSITION only (repeat deliveries write nothing)
      await tbCreate("audit_events", {
        user: null,
        action: "paynow:callback",
        entity: "paynow_sessions",
        entity_id: current.id,
        source: "webhook",
        payload: JSON.stringify({
          reference,
          paynowReference: fields.paynowreference ?? null,
          from,
          to: next,
        }),
        created_at: nowIso(),
      });
    }

    if (pollUrlRejected) {
      await tbCreate("audit_events", {
        user: null,
        action: "paynow:callback",
        entity: "paynow_sessions",
        entity_id: current.id,
        source: "webhook",
        payload: JSON.stringify({
          reference,
          reason: "pollurl-rejected",
          url: String(pollUrl).slice(0, 100),
        }),
        created_at: nowIso(),
      });
    }

    if (next === "paid") {
      // Journal-guarded idempotent settlement — repeat deliveries and
      // concurrent processes converge on a single set of writes.
      await settlePaidOrder({ ...current, status: next });
    }

    // Paynow expects exactly "OK" (with 200) to stop retrying.
    return plain("OK", 200);
  } catch (err) {
    console.error("[paynow/callback]", err);
    return plain("Error", 500);
  }
}
