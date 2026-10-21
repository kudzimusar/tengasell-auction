import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
// 12-e platform flag gate (CTL-015): the assistant_enabled switch in the
// Configuration console is enforced HERE — the single honest v1 gate point.
import { flagValue } from "@/lib/server/platform";

// Tengasell AI assistant — server-side only (z-ai-web-dev-sdk).
// POST { messages: [{role, content}], context?: { route?, itemId? } }
// Injects live marketplace context (item details) from the TrailBase backend
// so the assistant can help with real trading decisions.

export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface AssistantRequest {
  messages: ChatMessage[];
  context?: {
    route?: string;
    itemId?: number;
  };
}

const SYSTEM_PROMPT = `You are Tenga AI, the friendly trading assistant inside Tengasell — Zimbabwe's auction marketplace (tagline: "a snap to your happy deal").

Your job: help users trade confidently. You know:

MARKETPLACE RULES:
- Bidding: Yahoo Auctions-style automatic (proxy) bidding — a bidder sets a maximum and the system bids only the minimum needed to win. One increment over the rival's max.
- Bid increments by price: <$50 → $1, $50–499 → $2, $500–999 → $5, $1000–4999 → $10, ≥$5000 → $25.
- Anti-snipe: a bid in the final 5 minutes extends the auction by 5 minutes (up to 15 times).
- Buy-now disappears after the first bid.
- Optional reserve price: item sells only if the reserve is met ("Reserve not met" shows on the listing).
- Currency: US dollars (USD). Zimbabwe context: load shedding makes solar/power gear very popular; EcoCash, ZIPIT bank transfer, Visa/Mastercard, PayPal and cash-on-delivery are accepted.

SLA (service level agreements):
- Winner must complete payment within 48 hours or the order is cancelled and the item may be relisted.
- Sellers dispatch within 3 business days of payment.
- 7-day dispute window after delivery; refunds processed within 5 business days.
- Buyer protection: funds are held until the buyer confirms delivery.

FEES: Free listings (50/month), featured listing option, final value fee ~8% capped at US$50.

TONE: calm, warm, concise. Zimbabwe-aware (mention Harare/Bulawayo where relevant, ZESA/load shedding when solar items come up). Use plain English. Keep answers short and scannable — a few sentences or a short list. If asked to draft a message to a seller/buyer, write it ready to copy. If the user asks about a specific item and item context is provided, reason about its price, condition, bid history and time remaining. Never invent listings that are not in the provided context; if unsure, say what you'd need to check.`;

async function fetchItemContext(itemId: number): Promise<string> {
  try {
    const res = await fetch(
      `http://localhost:3001/api/records/v1/auctions/${itemId}`,
      { signal: AbortSignal.timeout(2500) },
    );
    if (!res.ok) return "";
    const a = await res.json();
    const bidsRes = await fetch(
      `http://localhost:3001/api/records/v1/bids?filter[auction_id][$eq]=${itemId}&order=-id&limit=10`,
      { signal: AbortSignal.timeout(2500) },
    );
    let bidInfo = "";
    if (bidsRes.ok) {
      const data = await bidsRes.json();
      const bids = data.records ?? [];
      bidInfo = `\nRecent bids: ${bids
        .map((b: { bidder_username: string; amount: number }) => `${b.bidder_username} → $${b.amount}`)
        .join(", ")}`;
    }
    return `CURRENT ITEM CONTEXT (live from the marketplace database):
- Title: ${a.title}
- Category: ${a.category} · Condition: ${a.condition} · Location: ${a.city}
- Current price: $${a.current_price} · Start price: $${a.start_price} · Bids: ${a.bid_count}
- Buy now: ${a.buy_now_price != null ? `$${a.buy_now_price}` : "n/a"} · Reserve: ${a.reserve_price != null ? (a.current_price >= a.reserve_price ? "met" : "NOT met") : "none"}
- Ends at: ${a.ends_at} · Status: ${a.status}
- Shipping: ${a.shipping} ($${a.shipping_fee}) · Seller: @${a.seller_username}${bidInfo}
- Description: ${(a.description ?? "").slice(0, 700)}`;
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  // 12-e: assistant_enabled=false → 503 with an honest message (audited flag).
  if (!flagValue("assistant_enabled")) {
    return NextResponse.json(
      { error: "The Tenga AI assistant is temporarily switched off by the platform team (assistant_enabled flag). Try again later.", disabled: true },
      { status: 503 },
    );
  }
  try {
    const body = (await req.json()) as AssistantRequest;
    const messages = Array.isArray(body?.messages) ? body.messages.slice(-14) : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    let contextBlock = "";
    if (body?.context?.route) contextBlock += `User is viewing: ${body.context.route}\n`;
    if (body?.context?.itemId) {
      contextBlock += (await fetchItemContext(body.context.itemId)) + "\n";
    }

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      model: "glm-4.5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...(contextBlock ? [{ role: "system" as const, content: contextBlock }] : []),
        ...messages,
      ],
      thinking: { type: "disabled" },
    });

    const reply = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[assistant] error", err);
    return NextResponse.json(
      { error: "The assistant is unavailable right now. Please retry." },
      { status: 500 },
    );
  }
}
