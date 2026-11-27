// POST /api/paynow/initiate — start a Paynow payment for a pending order.
//
// Request JSON:  { orderId: number, method: "ecocash"|"innbucks"|"card",
//                  phone?: string }
// Auth:          Authorization: Bearer <trailbase auth_token> (the buyer)
// Response JSON: { ok, redirectUrl, mode, orderId, error? } — minimal,
//                 customer-safe: no gateway pollUrl, no merchant reference,
//                 no hash material leaves the server (R7).
//
// The order is fetched WITH THE BUYER'S TOKEN (the TrailBase ACL lets the
// buyer and seller read the row, so a hit proves party access) and the
// buyer_username is matched against the token user resolved via
// /api/auth/v1/status. Only pending_payment orders can start a session.
//
// Mock/sandbox mode (no PAYNOW_INTEGRATION_* env): allowed in development
// or with PAYNOW_ALLOW_MOCK=1; in a production deployment without
// credentials the route FAILS CLOSED (503 — no sandbox session is ever
// created, so mock approval cannot fake a paid order on prod). Production
// with credentials: Paynow's hosted checkout URL (absolute).

import { NextRequest, NextResponse } from "next/server";
import { credentialsConfigured, initiateTransaction, isMockMode, mockPaymentsAllowed } from "@/lib/server/paynow";
import {
  fetchOrderWithUserToken,
  makeReference,
  paynowUrls,
  resolveUserFromToken,
  sandboxRedirectUrl,
} from "@/lib/server/paynow-order";
import { nowIso, tbCreate } from "@/lib/server/trailbase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Channel = "ecocash" | "innbucks" | "card";

const CHANNELS: Channel[] = ["ecocash", "innbucks", "card"];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    // ── 1. authenticate the caller (buyer) via the TrailBase token ───
    const user = await resolveUserFromToken(req.headers.get("authorization"));
    if (!user) {
      return json({ ok: false, error: "Sign in to pay this order." }, 401);
    }

    // ── 2. validate the request body ─────────────────────────────────
    const body = (await req.json().catch(() => null)) as
      | { orderId?: unknown; method?: unknown; phone?: unknown }
      | null;
    const orderId = Number(body?.orderId);
    const method = String(body?.method ?? "").toLowerCase() as Channel;
    const phone =
      typeof body?.phone === "string" && body.phone.trim()
        ? body.phone.replace(/[\s-]/g, "")
        : undefined;

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return json({ ok: false, error: "Invalid order." }, 400);
    }
    if (!CHANNELS.includes(method)) {
      return json({ ok: false, error: "Unsupported Paynow method." }, 400);
    }
    const mobile = method === "ecocash" || method === "innbucks";
    if (mobile && !phone) {
      return json(
        { ok: false, error: "A mobile number is required for mobile money." },
        400,
      );
    }
    if (mobile && !/^(?:0|\+263)7\d{8}$/.test(phone ?? "")) {
      return json(
        { ok: false, error: "Enter a valid mobile number, e.g. 0771234567." },
        400,
      );
    }

    // ── 3. load the order WITH the user's token and verify ownership ─
    const order = await fetchOrderWithUserToken(user.token, orderId);
    if (!order) {
      return json({ ok: false, error: "Order not found." }, 404);
    }
    if (order.buyer_username !== user.username) {
      return json({ ok: false, error: "Only the buyer can pay this order." }, 403);
    }
    if (order.status !== "pending_payment") {
      return json({ ok: false, error: "This order is not awaiting payment." }, 409);
    }
    if (!(order.final_price > 0)) {
      return json({ ok: false, error: "Invalid order amount." }, 400);
    }

    // ── R6 mock/live safety: credentials absent but mock payments not
    // allowed on this deployment → fail closed. No sandbox session is
    // ever created in production without the real gateway (or an
    // explicit PAYNOW_ALLOW_MOCK=1 opt-in).
    if (!credentialsConfigured() && !mockPaymentsAllowed()) {
      return json(
        {
          ok: false,
          error:
            "The payment gateway is not configured on this deployment — please try again later.",
        },
        503,
      );
    }

    // ── 4. open the gateway session (real or sandbox) ────────────────
    const reference = makeReference(orderId);
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const { returnUrl, resultUrl } = paynowUrls(origin, orderId);

    const result = await initiateTransaction({
      reference,
      amount: order.final_price,
      additionalInfo: `Tengasell order #${orderId} — ${order.auction_title}`.slice(0, 120),
      returnUrl,
      resultUrl,
      method: mobile ? method : undefined,
      phone: mobile ? phone : undefined,
    });

    if (!result.ok) {
      return json(
        { ok: false, error: result.error ?? "Paynow declined the transaction." },
        502,
      );
    }

    // sandbox redirect carries display hints as query params — the page
    // re-verifies the true state through /api/paynow/poll, so these cannot
    // spoof anything. The raw phone number is NOT carried in the URL (the
    // page gets a masked hint from the authenticated poll response).
    // Production keeps Paynow's absolute redirect URL.
    const mock = isMockMode();
    const redirectUrl = mock
      ? sandboxRedirectUrl({
          reference,
          amount: order.final_price,
          method,
          title: order.auction_title,
          orderId,
        })
      : result.redirectUrl || result.browserUrl;

    // ── 5. persist the session (admin token) ─────────────────────
    const now = nowIso();
    const sessionId = await tbCreate("paynow_sessions", {
      order_id: orderId,
      reference,
      amount: order.final_price,
      method,
      phone: phone ?? null,
      status: "pending",
      poll_url: result.pollUrl || null,
      redirect_url: redirectUrl || null,
      paynow_hash: result.hash ?? null,
      error: null,
      created_at: now,
      updated_at: now,
    });
    if (sessionId == null) {
      return json({ ok: false, error: "Could not open the payment session." }, 500);
    }

    // R7 — minimal customer-safe response: where to continue the payment,
    // nothing else (no pollUrl, no reference, no hash material).
    return json({
      ok: true,
      redirectUrl,
      mode: mock ? "sandbox" : "live",
      orderId,
    });
  } catch (err) {
    console.error("[paynow/initiate]", err);
    return json({ ok: false, error: "Unexpected error — please retry." }, 500);
  }
}
