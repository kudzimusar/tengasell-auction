// seed.ts — idempotent demo seeder (MSCS 12-b §G).
//
// Walks the LIVE TrailBase orders/payments with an admin token and
// reconstructs the finance history for existing demo orders (payments from
// tasks 5–11 E2E), then tops up with: a featured-fee entry, a processed
// partial refund example (with credit note + proportional fee reversal),
// one pending payout (rufaro, KYC'd), rufaro's monthly fee invoice (draft)
// and a few bank statement lines. Safe to re-run: every step checks for its
// own marker (balanced_tx keys, invoice periods, payout id_number).

import { all, get, insert, scalar } from "./db";
import { nowIso, toCents, monthRange } from "./util";
import {
  getConfig,
  fundEscrow,
  releaseEscrow,
  startDisputeWindow,
  chargeFeaturedFee,
  processRefund,
  refundById,
  nextDocNumber,
  refreshSellerBalance,
} from "./money";
import { tbListOrders, tbListPayments, tbGetAuction } from "./trailbase";

const SEED_PAYOUT_ID_NUMBER = "63-1234567X12"; // rufaro demo KYC marker
const SEED_REFUND_NOTE = "demo-seed refund example";

export async function seedDemo(): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { ordersFunded: 0, ordersReleased: 0, featuredFee: false, refund: "skipped", payout: "skipped", invoice: "skipped", bankLines: 0 };

  // ── 1. Walk TrailBase orders + payments and build the ledger history ──
  const [orders, payments] = await Promise.all([tbListOrders(200), tbListPayments(500)]);
  const settledOrders = orders.filter(
    (o: any) => o.paid_at && ["paid", "shipped", "delivered", "completed"].includes(String(o.status)),
  );
  const shippingCache = new Map<number, number>();
  for (const o of settledOrders) {
    const gross = Number(o.final_price ?? 0);
    if (!(gross > 0)) continue;
    let shipping = shippingCache.get(Number(o.auction_id));
    if (shipping == null) {
      const auction = await tbGetAuction(Number(o.auction_id)).catch(() => null);
      shipping = Number(auction?.shipping_fee ?? 0);
      shippingCache.set(Number(o.auction_id), shipping);
    }
    const payment = payments.find((p: any) => Number(p.order_id) === Number(o.id) && String(p.status) === "settled");
    const funded = fundEscrow({
      orderId: Number(o.id),
      buyer: String(o.buyer_username ?? ""),
      seller: String(o.seller_username ?? ""),
      itemPriceCents: toCents(gross),
      shippingCents: toCents(shipping),
      method: payment ? String(payment.method) : "backfill",
      reference: payment ? String(payment.reference) : null,
      paidAt: o.paid_at,
      actor: "seed:backfill",
    });
    if (funded.created) summary.ordersFunded = (summary.ordersFunded as number) + 1;

    // delivered/completed long ago → the dispute window has clearly elapsed
    if ((o.delivered_at || o.completed_at) && String(o.status) !== "paid") {
      startDisputeWindow(Number(o.id), o.delivered_at ?? o.completed_at);
      if (releaseEscrow(Number(o.id), "seed:history")) {
        summary.ordersReleased = (summary.ordersReleased as number) + 1;
      }
    }
  }

  // ── 2. Featured listing fee example (COM-013 featured US$2 + VAT) ────
  summary.featuredFee = chargeFeaturedFee("rufaro", "auction #2001 (seed demo)", "FEA-SEED-1");

  // ── 3. Processed partial refund example on a completed order ─────────
  const seedRefund = get(`SELECT id FROM refunds WHERE reason_note = ? LIMIT 1`, [SEED_REFUND_NOTE]);
  if (seedRefund) {
    summary.refund = "exists";
  } else {
    const target = all<{ order_id: number; seller: string; item_price_cents: number; shipping_cents: number; status: string }>(
      `SELECT order_id, seller, item_price_cents, shipping_cents, status FROM order_finance
       WHERE status = 'released' AND refunded_cents = 0 ORDER BY order_id ASC LIMIT 1`,
    )[0];
    if (target && target.seller === "rufaro") {
      const amountCents = Math.round((target.item_price_cents + target.shipping_cents) * 0.1);
      const id = insert(
        `INSERT INTO refunds(order_id, amount_cents, kind, reason_code, reason_note, status, requested_by, approved_by, approved_at)
         VALUES(?, ?, 'partial', 'not_as_described', ?, 'approved', 'admin', 'admin', ?)`,
        [target.order_id, amountCents, SEED_REFUND_NOTE, nowIso()],
      );
      processRefund(refundById(id), "admin");
      summary.refund = { refundId: id, orderId: target.order_id, amountCents };
    }
  }

  // ── 4. One pending payout for rufaro (KYC'd, requested) ──────────────
  const seedPayout = get(`SELECT id FROM payouts WHERE id_number = ? AND reference IS NULL AND status IN('requested','approved')`, [SEED_PAYOUT_ID_NUMBER]);
  if (seedPayout) {
    summary.payout = "exists";
  } else {
    const cfg = getConfig();
    const minCents = Math.round(cfg.payout_min * 100);
    const available = scalar(`SELECT COALESCE(SUM(amount_cents),0) AS n FROM ledger_entries WHERE account = 'seller_balance:rufaro' AND direction='credit'`) -
      scalar(`SELECT COALESCE(SUM(amount_cents),0) AS n FROM ledger_entries WHERE account = 'seller_balance:rufaro' AND direction='debit'`);
    const amountCents = Math.max(minCents, Math.min(1500, Math.floor(available / 2)));
    if (amountCents >= minCents) {
      const id = insert(
        `INSERT INTO payouts(username, amount_cents, method, destination, id_number, tax_number, status, request_note, requested_at)
         VALUES('rufaro', ?, 'ecocash', '+263 77 210 4567', ?, 'ZW-TIN-889231', 'requested', 'demo seed payout', ?)`,
        [amountCents, SEED_PAYOUT_ID_NUMBER, nowIso()],
      );
      summary.payout = { payoutId: id, amountCents };
    }
  }

  // ── 5. Monthly fee invoice for rufaro (draft → issue in the console) ─
  const release = get<{ released_at: string }>(
    `SELECT released_at FROM order_finance WHERE seller='rufaro' AND released_at IS NOT NULL ORDER BY released_at ASC LIMIT 1`,
  );
  if (release) {
    const period = String(release.released_at).slice(0, 7);
    const range = monthRange(period);
    if (!range) {
      summary.invoice = "skipped";
    } else {
    const existing = get(`SELECT id, number FROM invoices WHERE username='rufaro' AND period_start = ?`, [range.start]);
    if (existing) {
      summary.invoice = "exists";
    } else {
      const { invoiceTotalsFor } = await import("./routes/admin");
      const totals = invoiceTotalsFor("rufaro", range.start, range.end);
      const number = nextDocNumber("TGS-FEE-", "invoices");
      const id = insert(
        `INSERT INTO invoices(number, username, period_start, period_end, fee_cents, vat_cents, total_cents, status)
         VALUES(?, 'rufaro', ?, ?, ?, ?, ?, 'draft')`,
        [number, range.start, range.end, totals.feeCents, totals.vatCents, totals.feeCents + totals.vatCents],
      );
      summary.invoice = { invoiceId: id, number, feeCents: totals.feeCents, vatCents: totals.vatCents };
    }
    }
  }

  // ── 6. A few bank statement lines (matched to seeded payment refs) ───
  const existingLines = scalar(`SELECT COUNT(*) AS n FROM bank_lines`);
  if (existingLines > 0) {
    summary.bankLines = "exists";
  } else {
    const receipts = all<{ order_id: number; payload: string; amount_cents: number; paid_at: string }>(
      `SELECT order_id, payload, amount_cents, paid_at FROM receipts ORDER BY order_id ASC LIMIT 4`,
    );
    let added = 0;
    for (const r of receipts) {
      const ref = (JSON.parse(r.payload ?? "{}").reference as string | undefined) ?? `ORDR-${r.order_id}`;
      insert(
        `INSERT INTO bank_lines(statement_date, amount_cents, direction, memo, matched_ref, matched_type)
         VALUES(?, ?, 'in', ?, ?, 'payment')`,
        [String(r.paid_at ?? "").slice(0, 10), r.amount_cents, `PAYNOW SETTLEMENT ${ref} order ${r.order_id}`, ref],
      );
      added += 1;
    }
    // one unmatched outbound line (payout transfer pending the bank statement)
    insert(
      `INSERT INTO bank_lines(statement_date, amount_cents, direction, memo, matched_ref, matched_type)
       VALUES(?, 2000, 'out', 'ECOCASH BATCH TRANSFER 0912', NULL, NULL)`,
      [nowIso().slice(0, 10)],
    );
    summary.bankLines = added + 1;
  }

  refreshSellerBalance("rufaro");
  return summary;
}
