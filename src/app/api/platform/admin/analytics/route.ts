// GET /api/platform/admin/analytics — the Analytics console's data bundle
// (BI-001..013, DAT-020). Admin-only.
//
// Server-side aggregation (read-only):
//   · TrailBase aggregates via direct read-only SQL on main.db (WAL reader,
//     busy_timeout-guarded — the documented pattern for anything the records
//     API cannot express: SUM/GROUP BY/DISTINCT)
//   · finance stats via the finance-service admin API (graceful null + note
//     when finance is down — never blocks the console)
//   · trust/comms/govern health counters for the Operational section
//   · funnel registered → placed bid → won → paid, and monthly registration
//     cohorts (6 months), computed server-side
// Every metric row carries an English `hint` (the metric dictionary the
// console renders as an ⓘ tooltip — definitions are data, chrome is i18n'd).
// ?format=csv&section=<key> returns that section as CSV (CTL-025).

import { NextRequest, NextResponse } from "next/server";
import {
  csvOf,
  csvResponse,
  isResponse,
  mainDbQuery,
  PORTS,
  requireAdmin,
  svcFetch,
  userB64For,
  writeAudit,
} from "@/lib/server/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface MetricRow {
  key: string;
  label: string;
  value: number | string;
  hint: string;
}

export interface Section {
  title: string;
  note?: string;
  rows: MetricRow[];
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

async function build(): Promise<{ sections: Record<string, Section>; finance: Record<string, unknown> | null; finance_note: string | null; generated_at: string; cohorts: { month: string; registered: number; placed_bid: number; won: number; paid: number; bid_rate: string }[]; totals: { auctions: number; orders: number } }> {
  const THIRTY_D = Math.floor((Date.now() - 30 * 24 * 3600_000) / 1000);

  // ── TrailBase aggregates (read-only SQL against main.db) ───────────────
  const users = mainDbQuery<{ n: number; new30: number }>(
    "SELECT COUNT(*) AS n, SUM(CASE WHEN created >= ? THEN 1 ELSE 0 END) AS new30 FROM _user",
    [THIRTY_D],
  )[0] ?? { n: 0, new30: 0 };
  const auctions = mainDbQuery<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM auctions GROUP BY status",
  );
  const auctionTotal = auctions.reduce((a, r) => a + n(r.n), 0);
  const byStatus = new Map(auctions.map((r) => [r.status, n(r.n)]));
  const featured = mainDbQuery<{ n: number }>("SELECT COUNT(*) AS n FROM auctions WHERE featured = 1 AND status = 'live'")[0];
  const bids = mainDbQuery<{ n: number; bidders: number }>(
    "SELECT COUNT(*) AS n, COUNT(DISTINCT user) AS bidders FROM bids",
  )[0] ?? { n: 0, bidders: 0 };
  const orders = mainDbQuery<{ status: string; n: number }>(
    "SELECT status, COUNT(*) AS n FROM orders GROUP BY status",
  );
  const ordersBy = new Map(orders.map((r) => [r.status, n(r.n)]));
  const paidAgg =
    mainDbQuery<{ n: number; gmv: number; buyers: number }>(
      "SELECT COUNT(*) AS n, SUM(final_price) AS gmv, COUNT(DISTINCT buyer_user) AS buyers FROM orders WHERE paid_at IS NOT NULL",
    )[0] ?? { n: 0, gmv: 0, buyers: 0 };
  const wonBuyers = mainDbQuery<{ n: number }>(
    "SELECT COUNT(DISTINCT buyer_user) AS n FROM orders",
  )[0];
  const sellers = mainDbQuery<{ n: number }>(
    "SELECT COUNT(DISTINCT seller_username) AS n FROM auctions",
  )[0];
  const watchers = mainDbQuery<{ n: number; users: number }>(
    "SELECT COUNT(*) AS n, COUNT(DISTINCT user) AS users FROM watchlist",
  )[0] ?? { n: 0, users: 0 };
  const questions = mainDbQuery<{ n: number }>("SELECT COUNT(*) AS n FROM questions")[0];
  const messages = mainDbQuery<{ n: number }>("SELECT COUNT(*) AS n FROM messages")[0];
  const ratings = mainDbQuery<{ n: number; avg: number }>(
    "SELECT COUNT(*) AS n, AVG(score) AS avg FROM ratings",
  )[0] ?? { n: 0, avg: 0 };
  const categories = mainDbQuery<{ n: number }>("SELECT COUNT(*) AS n FROM categories")[0];
  const ticketsTrail = mainDbQuery<{ n: number }>("SELECT COUNT(*) AS n FROM threads")[0];

  // freshness: newest row per key table
  const lastBid = mainDbQuery<{ at: string }>("SELECT MAX(created_at) AS at FROM bids")[0]?.at ?? "";
  const lastOrder = mainDbQuery<{ at: string }>("SELECT MAX(created_at) AS at FROM orders")[0]?.at ?? "";
  const lastAudit = mainDbQuery<{ at: string }>("SELECT MAX(created_at) AS at FROM audit_events")[0]?.at ?? "";
  const lastUser = mainDbQuery<{ at: string }>(
    "SELECT MAX(datetime(created, 'unixepoch')) AS at FROM _user",
  )[0]?.at ?? "";

  // funnel + cohorts (server-side)
  const bidUsers = new Set(mainDbQuery<{ user: string }>("SELECT DISTINCT user FROM bids").map((r) => r.user));
  const orderBuyers = new Set(mainDbQuery<{ user: string }>("SELECT DISTINCT buyer_user AS user FROM orders").map((r) => r.user));
  const paidBuyers = new Set(
    mainDbQuery<{ user: string }>("SELECT DISTINCT buyer_user AS user FROM orders WHERE paid_at IS NOT NULL").map((r) => r.user),
  );
  const cohorts = mainDbQuery<{ month: string; registered: number }>(
    "SELECT strftime('%Y-%m', datetime(created, 'unixepoch')) AS month, COUNT(*) AS registered FROM _user GROUP BY month ORDER BY month DESC LIMIT 6",
  );
  const cohortRows = cohorts.map((c) => {
    const members = mainDbQuery<{ user: string; created: number }>(
      "SELECT hex(id) AS user, created FROM _user WHERE strftime('%Y-%m', datetime(created, 'unixepoch')) = ?",
      [c.month],
    );
    const b64 = (hex: string) => Buffer.from(hex.toLowerCase(), "hex").toString("base64");
    const set = new Set(members.map((m) => b64(m.user)));
    let bid = 0;
    let won = 0;
    let paid = 0;
    for (const u of set) {
      if (bidUsers.has(u)) bid++;
      if (orderBuyers.has(u)) won++;
      if (paidBuyers.has(u)) paid++;
    }
    return {
      month: c.month,
      registered: n(c.registered),
      placed_bid: bid,
      won,
      paid,
      bid_rate: pct(bid, n(c.registered)),
    };
  });

  // ── finance stats (graceful) ───────────────────────────────────────────
  let finance: Record<string, unknown> | null = null;
  let financeNote: string | null = null;
  const fin = await svcFetch(PORTS.finance, "/admin/stats", {
    timeoutMs: 2000,
    headers: { "x-tgs-user": "platform-analytics", "x-tgs-admin": "1" },
  });
  if (fin.ok && fin.data) finance = fin.data;
  else financeNote = fin.status === 0 ? "Finance service unreachable — revenue figures from finance are hidden, not faked." : `Finance service returned ${fin.status}.`;

  // ── sibling-service operational counters (graceful) ────────────────────
  const [trust, comms, govern] = await Promise.all([
    svcFetch(PORTS.trust, "/health", { timeoutMs: 1500 }),
    svcFetch(PORTS.comms, "/health", { timeoutMs: 1500 }),
    svcFetch(PORTS.govern, "/health", { timeoutMs: 1500 }),
  ]);
  const queue = (comms.data?.queue ?? {}) as Record<string, unknown>;

  const gmv = n(paidAgg.gmv);
  const paidOrders = n(paidAgg.n);

  const sections: Record<string, Section> = {
    marketplace: {
      title: "Marketplace",
      rows: [
        { key: "live", label: "Live listings", value: byStatus.get("live") ?? 0, hint: "Auctions with status=live right now (biddable)." },
        { key: "ended", label: "Ended (unsold)", value: byStatus.get("ended") ?? 0, hint: "Auctions that closed or were taken down without a sale." },
        { key: "sold", label: "Sold", value: byStatus.get("sold") ?? 0, hint: "Auctions that closed with a winner." },
        { key: "featured", label: "Featured live", value: n(featured?.n), hint: "Live listings carrying the US$2 featured flag." },
        { key: "bids", label: "Bids placed (all time)", value: n(bids.n), hint: "Total bid rows — includes proxy-bid increments written by the trade engine." },
        { key: "watchers", label: "Watchlist entries", value: n(watchers.n), hint: "Sum of all watchlist rows across users." },
        { key: "questions", label: "Q&A questions", value: n(questions?.n), hint: "Buyer questions on listings answered through the trade engine." },
        { key: "categories", label: "Categories", value: n(categories?.n), hint: "Category taxonomy rows driving the browse tree." },
      ],
    },
    revenue: {
      title: "Revenue",
      note: financeNote ?? undefined,
      rows: [
        { key: "gmv", label: "GMV (paid orders)", value: gmv, hint: "Sum of final_price over orders that reached paid status — gross merchandise value actually collected. Escrow-held until release." },
        { key: "paid_orders", label: "Paid orders", value: paidOrders, hint: "Orders with a recorded payment (Paynow or manual)." },
        { key: "aov", label: "Average order value", value: paidOrders ? Math.round((gmv / paidOrders) * 100) / 100 : 0, hint: "GMV ÷ paid orders." },
        ...(finance
          ? [
              { key: "escrow", label: "Escrow holding", value: n(finance.escrowHoldingCents) / 100, hint: "Buyer funds currently held in escrow (finance-service authority)." },
              { key: "rev30", label: "Platform revenue (30d)", value: n(finance.revenue30dCents) / 100, hint: "Final-value fees + featured fees recognised in the last 30 days (8% capped $50)." },
              { key: "vat", label: "VAT due", value: n(finance.vatDueCents) / 100, hint: "15% output VAT booked on platform-fee revenue (ZW VAT on commission services)." },
              { key: "payouts", label: "Payouts pending", value: n(finance.payoutsPendingCents) / 100, hint: "Approved-but-unpaid or requested seller payouts (US$)." },
              { key: "refunds30", label: "Refunds (30d)", value: n(finance.refunds30dCents) / 100, hint: "Refunded amounts in the last 30 days, escrow or clawback." },
            ]
          : []),
      ],
    },
    product: {
      title: "Product",
      rows: [
        { key: "users", label: "Registered users", value: n(users.n), hint: "All TrailBase accounts." },
        { key: "new30", label: "New users (30d)", value: n(users.new30), hint: "Accounts created in the last 30 days." },
        { key: "sellers", label: "Sellers (listed ≥1)", value: n(sellers?.n), hint: "Distinct usernames that created at least one listing." },
        { key: "bidders", label: "Bidders (bid ≥1)", value: n(bids.bidders), hint: "Distinct accounts that placed at least one bid." },
        { key: "ratings", label: "Ratings", value: n(ratings.n), hint: "Order ratings submitted after delivery." },
        { key: "rating_avg", label: "Average rating", value: n(ratings.avg) ? Math.round(n(ratings.avg) * 10) / 10 : "—", hint: "Mean score across all ratings (1–5)." },
        { key: "messages", label: "Messages", value: n(messages?.n), hint: "Mediated buyer↔seller messages (moderation pipeline applied)." },
        { key: "threads", label: "Conversation threads", value: n(ticketsTrail?.n), hint: "Message threads opened between users." },
      ],
    },
    operational: {
      title: "Operational",
      rows: [
        { key: "orders_pending", label: "Orders awaiting payment", value: ordersBy.get("pending_payment") ?? 0, hint: "Orders inside the 48h pay window (or past it — engine cancels)." },
        { key: "orders_paid", label: "Orders paid", value: ordersBy.get("paid") ?? 0, hint: "Paid, waiting on the 3-day dispatch SLA." },
        { key: "orders_shipped", label: "Orders shipped", value: ordersBy.get("shipped") ?? 0, hint: "In transit, inside the 7-day dispute window." },
        { key: "orders_completed", label: "Orders completed", value: ordersBy.get("completed") ?? 0, hint: "Delivered, rated or dispute-window elapsed; escrow released." },
        { key: "trust_tickets", label: "Support tickets (trust)", value: trust.ok ? String((trust.data as Record<string, unknown>).tickets ?? "?") : "unreachable", hint: "Open+recent tickets held by the trust-service." },
        { key: "comms_queue", label: "Comms queue depth", value: comms.ok ? String(queue.depth ?? "?") : "unreachable", hint: "Outbound notification queue depth (comms-service)." },
        { key: "comms_failed", label: "Comms failed (24h)", value: comms.ok ? String(queue.failed ?? "?") : "unreachable", hint: "Delivery failures in the last 24 hours — should be 0." },
        { key: "govern_controls", label: "Compliance controls loaded", value: govern.ok ? String((govern.data as Record<string, unknown>).controls ?? "?") : "unreachable", hint: "MSCS control rows loaded in the governance register." },
      ],
    },
    funnel: {
      title: "Funnel",
      note: "Conversion from registration to first paid order.",
      rows: [
        { key: "registered", label: "Registered", value: n(users.n), hint: "All accounts (top of funnel)." },
        { key: "placed_bid", label: "Placed a bid", value: bidUsers.size, hint: `Distinct accounts with ≥1 bid — ${pct(bidUsers.size, n(users.n))} of registered.` },
        { key: "won", label: "Won an order", value: orderBuyers.size, hint: `Distinct buyers with ≥1 order — ${pct(orderBuyers.size, n(users.n))} of registered.` },
        { key: "paid", label: "Paid an order", value: paidBuyers.size, hint: `Distinct buyers who completed payment — ${pct(paidBuyers.size, n(users.n))} of registered.` },
      ],
    },
    freshness: {
      title: "Freshness",
      note: "Newest row per table — the data recency certificate (BI-008).",
      rows: [
        { key: "last_bid", label: "Last bid at", value: lastBid || "—", hint: "MAX(created_at) on bids." },
        { key: "last_order", label: "Last order at", value: lastOrder || "—", hint: "MAX(created_at) on orders." },
        { key: "last_audit", label: "Last audit event at", value: lastAudit || "—", hint: "MAX(created_at) on audit_events — platform-wide activity pulse." },
        { key: "last_user", label: "Last registration at", value: lastUser || "—", hint: "Newest _user row (unixepoch)." },
        { key: "generated_at", label: "Report generated at", value: new Date().toISOString().replace(/\.\d+Z$/, "Z"), hint: "When this aggregation ran (server clock)." },
      ],
    },
  };

  return {
    sections,
    finance,
    finance_note: financeNote,
    generated_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    cohorts: cohortRows,
    totals: { auctions: auctionTotal, orders: orders.reduce((a, r) => a + n(r.n), 0) },
  };
}

export type AnalyticsBuild = Awaited<ReturnType<typeof build>>;

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const data = await build();

  // CSV export per section (CTL-025) — audited as a data-access event
  const sp = req.nextUrl.searchParams;
  const section = sp.get("section");
  if (sp.get("format") === "csv" && section && data.sections[section]) {
    const s = data.sections[section];
    const rows: (string | number | null)[][] = [["metric_key", "label", "value", "definition"]];
    for (const r of s.rows) rows.push([r.key, r.label, String(r.value), r.hint]);
    if (section === "funnel") {
      rows.push([], ["month", "registered", "placed_bid", "won", "paid", "bid_rate"]);
      for (const c of data.cohorts) rows.push([c.month, c.registered, c.placed_bid, c.won, c.paid, c.bid_rate]);
    }
    await writeAudit({
      user: userB64For(gate.username),
      action: "platform:analytics_export",
      entity: "analytics",
      source: "admin",
      payload: { section, actor: gate.username },
    });
    return csvResponse(csvOf(rows), `tengasell-analytics-${section}-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return NextResponse.json({ ok: true, ...data });
}
