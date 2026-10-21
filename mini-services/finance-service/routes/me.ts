// User endpoints — /me/* (the user is identified by the x-tgs-user header
// set by the Next BFF; query usernames are NEVER trusted for scoping).

import { HttpError, bodyOptStr, bodyStr, type AddRoute, type Ctx } from "../http";
import { all, get, insert } from "../db";
import { nowIso, toIsoOut, centsToUsd, parseAmountCents } from "../util";
import {
  getConfig,
  accountBalance,
  sellerAccount,
  escrowPendingFor,
  withheldFor,
  orderFinanceById,
  orderFinanceOut,
} from "../money";

function requireUser(ctx: Ctx): string {
  return ctx.requireUser();
}

export function payoutOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id as number,
    username: r.username as string,
    amountCents: r.amount_cents as number,
    amount: centsToUsd(r.amount_cents as number),
    method: r.method as string,
    destination: r.destination as string,
    idNumber: r.id_number as string,
    taxNumber: (r.tax_number as string | null) ?? null,
    status: r.status as string,
    requestedAt: toIsoOut(r.requested_at as string),
    approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: toIsoOut(r.approved_at as string | null),
    sanctionsConfirmed: r.sanctions_confirmed === 1,
    paidBy: (r.paid_by as string | null) ?? null,
    paidAt: toIsoOut(r.paid_at as string | null),
    reference: (r.reference as string | null) ?? null,
    reversalReason: (r.reversal_reason as string | null) ?? null,
  };
}

export function invoiceOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id as number,
    number: r.number as string,
    username: r.username as string,
    periodStart: r.period_start as string,
    periodEnd: r.period_end as string,
    feeCents: r.fee_cents as number,
    vatCents: r.vat_cents as number,
    totalCents: r.total_cents as number,
    status: r.status as string,
    issuedAt: toIsoOut(r.issued_at as string | null),
    createdAt: toIsoOut(r.created_at as string | null),
  };
}

export function registerMeRoutes(on: AddRoute): void {
  // GET /me/overview → balance cards + escrow in flight + next payout
  on("GET", "/me/overview", (ctx) => {
    const user = requireUser(ctx);
    const cfg = getConfig();
    const available = accountBalance(sellerAccount(user));
    const pending = escrowPendingFor(user);
    const withheld = withheldFor(user);
    const escrowCount = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM order_finance WHERE seller = ? AND status IN('holding','partial')`,
      [user],
    );
    const nextPayout = get<Record<string, unknown>>(
      `SELECT * FROM payouts WHERE username = ? AND status IN('requested','approved') ORDER BY id DESC LIMIT 1`,
      [user],
    );
    const paidOut = get<{ n: number | null }>(
      `SELECT SUM(amount_cents) AS n FROM payouts WHERE username = ? AND status = 'paid'`,
      [user],
    );
    return {
      currency: cfg.currency,
      availableCents: available,
      pendingCents: pending,
      withheldCents: withheld,
      escrowCount: escrowCount?.n ?? 0,
      lifetimePaidOutCents: Math.round(Number(paidOut?.n ?? 0)),
      nextPayout: nextPayout ? payoutOut(nextPayout) : null,
      payoutMinCents: Math.round(cfg.payout_min * 100),
      feePct: cfg.fee_pct,
      vatPct: cfg.vat_pct,
    };
  });

  // GET /me/payouts → my payout history
  on("GET", "/me/payouts", (ctx) => {
    const user = requireUser(ctx);
    const rows = all(`SELECT * FROM payouts WHERE username = ? ORDER BY id DESC LIMIT 100`, [user]);
    return { payouts: rows.map(payoutOut) };
  });

  // POST /me/payouts {amountCents|amount, method:"ecocash"|"bank", destination,
  //                   idNumber (REQUIRED — MKT-002/GOV-005 payout KYC), taxNumber?}
  on("POST", "/me/payouts", (ctx) => {
    const user = requireUser(ctx);
    const cfg = getConfig();
    const amountCents =
      Number(ctx.body?.amountCents) > 0
        ? Math.round(Number(ctx.body?.amountCents))
        : parseAmountCents(ctx.body?.amount);
    if (!amountCents || amountCents <= 0) throw new HttpError(400, "Enter a payout amount.", "bad_amount");
    const minCents = Math.round(cfg.payout_min * 100);
    if (amountCents < minCents) {
      throw new HttpError(400, `Minimum payout is US$${cfg.payout_min}.`, "below_min");
    }
    const method = bodyStr(ctx, "method", { required: true, max: 20 });
    if (method !== "ecocash" && method !== "bank") {
      throw new HttpError(400, "method must be ecocash or bank", "bad_method");
    }
    const destination = bodyStr(ctx, "destination", { required: true, max: 120 });
    const idNumber = bodyStr(ctx, "idNumber", { required: true, max: 40 });
    const taxNumber = bodyOptStr(ctx, "taxNumber", 40);
    const requestNote = bodyOptStr(ctx, "note", 200);

    const available = accountBalance(sellerAccount(user));
    if (amountCents > available) {
      throw new HttpError(400, "Amount exceeds your available balance.", "insufficient");
    }
    const id = insert(
      `INSERT INTO payouts(username, amount_cents, method, destination, id_number, tax_number, status, request_note, requested_at)
       VALUES(?, ?, ?, ?, ?, ?, 'requested', ?, ?)`,
      [user.toLowerCase(), amountCents, method, destination, idNumber, taxNumber, requestNote, nowIso()],
    );
    const row = get(`SELECT * FROM payouts WHERE id = ?`, [id]);
    return { payout: payoutOut(row!) };
  });

  // GET /me/invoices → my monthly fee invoices
  on("GET", "/me/invoices", (ctx) => {
    const user = requireUser(ctx);
    const rows = all(`SELECT * FROM invoices WHERE username = ? ORDER BY id DESC LIMIT 60`, [user.toLowerCase()]);
    return { invoices: rows.map(invoiceOut) };
  });

  // GET /me/earnings → order-by-order fee/earnings breakdown (MKT-025/GOV-004)
  on("GET", "/me/earnings", (ctx) => {
    const user = requireUser(ctx);
    const rows = all(`SELECT * FROM order_finance WHERE seller = ? ORDER BY order_id DESC LIMIT 200`, [user]);
    const items = rows.map((r) => {
      const out = orderFinanceOut(r) as Record<string, unknown>;
      out["amount"] = centsToUsd(r.net_to_seller_cents);
      return out;
    });
    const totals = {
      orders: rows.length,
      grossCents: rows.reduce((n, r) => n + r.item_price_cents + r.shipping_cents, 0),
      feesCents: rows.reduce((n, r) => n + r.fee_cents, 0),
      vatCents: rows.reduce((n, r) => n + r.vat_cents, 0),
      netCents: rows.reduce((n, r) => n + r.net_to_seller_cents, 0),
      releasedCents: rows.filter((r) => r.status === "released").reduce((n, r) => n + r.net_to_seller_cents, 0),
      holdingCents: rows.filter((r) => r.status === "holding" || r.status === "partial").reduce((n, r) => n + r.escrow_cents, 0),
      refundedCents: rows.reduce((n, r) => n + r.refunded_cents, 0),
    };
    const featuredFees = get<{ n: number | null }>(
      `SELECT SUM(amount_cents) AS n FROM ledger_entries
       WHERE account = ? AND direction = 'debit' AND tx_type = 'featured.fee'`,
      [sellerAccount(user)],
    );
    return {
      items,
      totals,
      featuredFeesCents: Math.round(Number(featuredFees?.n ?? 0)),
    };
  });

  // GET /me/receipt/:orderId → buyer receipt (COM-020) + finance breakdown.
  // Scoped: the caller must be the buyer or the seller (admins allowed).
  on("GET", "/me/receipt/:orderId", (ctx) => {
    const user = requireUser(ctx);
    const orderId = Number(ctx.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "bad order id", "bad_field");
    const fin = orderFinanceById(orderId);
    if (!fin) throw new HttpError(404, "no finance record for this order", "not_found");
    const isParty = fin.buyer === user || fin.seller === user || ctx.admin;
    if (!isParty) throw new HttpError(403, "not your order", "forbidden");
    const receipt = get<Record<string, unknown>>(`SELECT * FROM receipts WHERE order_id = ?`, [orderId]);
    return {
      receipt: receipt
        ? {
            orderId,
            buyer: receipt.buyer as string,
            amountCents: receipt.amount_cents as number,
            method: (receipt.method as string | null) ?? null,
            paidAt: toIsoOut(receipt.paid_at as string | null),
            payload: JSON.parse(String(receipt.payload ?? "{}")),
          }
        : null,
      finance: orderFinanceOut(fin),
    };
  });
}
