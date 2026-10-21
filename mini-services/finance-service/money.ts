// money.ts — the finance core (MSCS 12-b): config, the fee engine (§G),
// the double-entry ledger writer, escrow lifecycle (hold → release →
// refund/cancel), seller balances and the integrity verifier.
//
// DESIGN LAWS
//   · All amounts are integer cents.
//   · Every movement = ONE balanced transaction (balanced_tx key) written as
//     ≥2 rows; debits == credits per balanced_tx. /admin/ledger?verify=1
//     proves it over the whole book (FIN-009).
//   · Idempotency: balanced_tx keys are deterministic per action
//     (ESC-<orderId>, REL-<orderId>, RFD-<refundId>, PYE/PYP/PYU/PYR-<payoutId>,
//     CNL-<orderId>, CBK-<chargebackId>, FEA-<n>) — replays are no-ops.
//   · Revenue recognition: FVF + VAT on fee are booked at ESCROW RELEASE,
//     not at payment (FIN-013 policy).

import { all, get, insert, run, scalar, inTransaction } from "./db";
import { HttpError } from "./http";
import { nowIso, toIsoOut } from "./util";

// ── Config ─────────────────────────────────────────────────────────────

export interface MoneyConfig {
  fee_pct: number;
  fee_cap: number; // USD
  featured_fee: number; // USD
  vat_pct: number;
  payout_min: number; // USD
  dual_approval_threshold: number; // USD
  escrow_days: number;
  currency: string;
  refund_auto_max: number; // USD
}

export function getConfig(): MoneyConfig {
  const rows = all<{ key: string; value: string }>(`SELECT key, value FROM config`);
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* skip junk */
    }
  }
  return out as unknown as MoneyConfig;
}

export function setConfigKey(key: string, value: number | string): void {
  const encoded = JSON.stringify(value);
  run(
    `INSERT INTO config(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, encoded],
  );
}

// ── Fee engine (COM-013/COM-014) ───────────────────────────────────────

export function sellerAccount(username: string): string {
  return `seller_balance:${username.toLowerCase()}`;
}

export interface FeeBreakdown {
  feeCents: number;
  vatCents: number;
}

/** Final-value fee: fee_pct × item price, capped at fee_cap USD; VAT on fee. */
export function computeFees(itemPriceCents: number, cfg: MoneyConfig): FeeBreakdown {
  const capCents = toCents(cfg.fee_cap);
  const fee = Math.min(capCents, Math.round(itemPriceCents * cfg.fee_pct));
  return { feeCents: fee, vatCents: Math.round(fee * cfg.vat_pct) };
}

/** Featured listing fee (USD → cents) + VAT on it. */
export function computeFeaturedFees(cfg: MoneyConfig): FeeBreakdown {
  const fee = toCents(cfg.featured_fee);
  return { feeCents: fee, vatCents: Math.round(fee * cfg.vat_pct) };
}

function toCents(usd: number): number {
  return Math.round(usd * 100);
}

// ── Double-entry ledger writer ─────────────────────────────────────────

export interface LedgerLeg {
  account: string;
  direction: "debit" | "credit";
  amountCents: number;
  counterAccount?: string;
  memo?: string;
}

export interface LedgerTx {
  balancedTx: string;
  txType: string; // escrow.hold | escrow.release | escrow.refund | order.cancel | payout.earmark | payout.pay | payout.unearmark | payout.return | refund.clawback | chargeback.resolve | featured.fee
  orderRef?: string | null;
  payoutRef?: string | null;
  actor?: string | null;
  legs: LedgerLeg[];
}

/** True when a balanced transaction has already been posted. */
export function txExists(balancedTx: string): boolean {
  return !!get(`SELECT id FROM ledger_entries WHERE balanced_tx = ? LIMIT 1`, [balancedTx]);
}

/** Post one balanced transaction atomically. Fails when unbalanced. */
export function postTransaction(tx: LedgerTx): void {
  if (tx.legs.length < 2) {
    throw new HttpError(500, `ledger tx ${tx.balancedTx} needs ≥2 legs`, "unbalanced");
  }
  let debits = 0;
  let credits = 0;
  for (const leg of tx.legs) {
    if (!Number.isInteger(leg.amountCents) || leg.amountCents <= 0) {
      throw new HttpError(500, `ledger tx ${tx.balancedTx} has an invalid leg amount`, "unbalanced");
    }
    if (leg.direction === "debit") debits += leg.amountCents;
    else credits += leg.amountCents;
  }
  if (debits !== credits) {
    throw new HttpError(
      500,
      `ledger tx ${tx.balancedTx} unbalanced (debits ${debits} ≠ credits ${credits})`,
      "unbalanced",
    );
  }
  inTransaction(() => {
    for (const leg of tx.legs) {
      insert(
        `INSERT INTO ledger_entries(ts, order_ref, payout_ref, tx_type, account, direction, amount_cents, counter_account, memo, actor, balanced_tx)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nowIso(),
          tx.orderRef ?? null,
          tx.payoutRef ?? null,
          tx.txType,
          leg.account,
          leg.direction,
          leg.amountCents,
          leg.counterAccount ?? null,
          leg.memo ?? null,
          tx.actor ?? null,
          tx.balancedTx,
        ],
      );
    }
  });
}

// ── Account balances (derived from the ledger) ─────────────────────────

/** Net signed balance (credits − debits) of one account, in cents. */
export function accountBalance(account: string): number {
  const row = get<{ net: number | null }>(
    `SELECT SUM(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END) AS net
     FROM ledger_entries WHERE account = ?`,
    [account],
  );
  return Math.round(Number(row?.net ?? 0));
}

/** Escrow currently held on behalf of one seller (order_finance holding rows). */
export function escrowPendingFor(username: string): number {
  const row = get<{ n: number | null }>(
    `SELECT SUM(escrow_cents) AS n FROM order_finance WHERE seller = ? AND status IN('holding','partial')`,
    [username],
  );
  return Math.round(Number(row?.n ?? 0));
}

/** Amounts earmarked in approved-but-unpaid payouts for one seller. */
export function withheldFor(username: string): number {
  const row = get<{ n: number | null }>(
    `SELECT SUM(amount_cents) AS n FROM payouts WHERE username = ? AND status = 'approved'`,
    [username],
  );
  return Math.round(Number(row?.n ?? 0));
}

/** Recompute the cached seller_balances row from the ledger. */
export function refreshSellerBalance(username: string): void {
  const u = username.toLowerCase();
  run(
    `INSERT INTO seller_balances(username, available_cents, pending_cents, withheld_cents, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       available_cents = excluded.available_cents,
       pending_cents = excluded.pending_cents,
       withheld_cents = excluded.withheld_cents,
       updated_at = excluded.updated_at`,
    [u, accountBalance(sellerAccount(u)), escrowPendingFor(u), withheldFor(u), nowIso()],
  );
}

function refreshAllSellerBalances(): void {
  const rows = all<{ username: string }>(`SELECT DISTINCT username FROM (
    SELECT seller AS username FROM order_finance
    UNION SELECT username FROM payouts
    UNION SELECT LOWER(actor) AS username FROM ledger_entries WHERE account LIKE 'seller_balance:%'
  )`);
  for (const r of rows) refreshSellerBalance(r.username);
}

// ── Escrow lifecycle ───────────────────────────────────────────────────

export interface OrderFinanceRow {
  order_id: number;
  buyer: string;
  seller: string;
  item_price_cents: number;
  shipping_cents: number;
  escrow_cents: number;
  fee_cents: number;
  vat_cents: number;
  net_to_seller_cents: number;
  refunded_cents: number;
  status: "holding" | "released" | "refunded" | "partial";
  dispute_window_ends: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export function orderFinanceById(orderId: number): OrderFinanceRow | null {
  return get<OrderFinanceRow>(`SELECT * FROM order_finance WHERE order_id = ?`, [orderId]);
}

export function orderFinanceOut(r: OrderFinanceRow): Record<string, unknown> {
  return {
    orderId: r.order_id,
    buyer: r.buyer,
    seller: r.seller,
    itemPriceCents: r.item_price_cents,
    shippingCents: r.shipping_cents,
    escrowCents: r.escrow_cents,
    feeCents: r.fee_cents,
    vatCents: r.vat_cents,
    netToSellerCents: r.net_to_seller_cents,
    refundedCents: r.refunded_cents,
    status: r.status,
    disputeWindowEnds: toIsoOut(r.dispute_window_ends),
    releasedAt: toIsoOut(r.released_at),
    createdAt: toIsoOut(r.created_at),
  };
}

/**
 * order.paid — buyer paid item + shipping into escrow (COM-015/COM-016/FIN-008).
 * Posts: debit bank / credit escrow_liability. Idempotent per order.
 */
export function fundEscrow(input: {
  orderId: number;
  buyer: string;
  seller: string;
  itemPriceCents: number;
  shippingCents: number;
  method?: string;
  reference?: string;
  paidAt?: string | null;
  actor?: string;
}): { created: boolean } {
  const balancedTx = `ESC-${input.orderId}`;
  if (txExists(balancedTx) || orderFinanceById(input.orderId)) return { created: false };
  const cfg = getConfig();
  const gross = input.itemPriceCents + input.shippingCents;
  if (gross <= 0) throw new HttpError(400, "order amount must be > 0", "bad_amount");
  const fees = computeFees(input.itemPriceCents, cfg);
  const net = gross - fees.feeCents - fees.vatCents;
  const paidAt = input.paidAt ?? nowIso();

  postTransaction({
    balancedTx,
    txType: "escrow.hold",
    orderRef: String(input.orderId),
    actor: input.actor ?? `buyer:${input.buyer}`,
    legs: [
      {
        account: "bank",
        direction: "debit",
        amountCents: gross,
        counterAccount: "escrow_liability",
        memo: `Buyer payment for order #${input.orderId} (item ${input.itemPriceCents}c + shipping ${input.shippingCents}c)`,
      },
      {
        account: "escrow_liability",
        direction: "credit",
        amountCents: gross,
        counterAccount: "bank",
        memo: `Escrow held for order #${input.orderId} — seller ${input.seller}`,
      },
    ],
  });

  insert(
    `INSERT INTO receipts(order_id, buyer, amount_cents, method, paid_at, payload)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_id) DO NOTHING`,
    [
      input.orderId,
      input.buyer,
      gross,
      input.method ?? null,
      paidAt,
      JSON.stringify({
        reference: input.reference ?? null,
        seller: input.seller,
        itemPriceCents: input.itemPriceCents,
        shippingCents: input.shippingCents,
        grossCents: gross,
      }),
    ],
  );

  insert(
    `INSERT INTO order_finance(order_id, buyer, seller, item_price_cents, shipping_cents, escrow_cents, fee_cents, vat_cents, net_to_seller_cents, status, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'holding', ?)`,
    [
      input.orderId,
      input.buyer,
      input.seller,
      input.itemPriceCents,
      input.shippingCents,
      gross,
      fees.feeCents,
      fees.vatCents,
      net,
      nowIso(),
    ],
  );
  refreshSellerBalance(input.seller);
  return { created: true };
}

/** order.delivered — open the dispute window (default escrow_days). */
export function startDisputeWindow(orderId: number, deliveredAt?: string | null): boolean {
  const row = orderFinanceById(orderId);
  if (!row || row.status !== "holding" || row.dispute_window_ends) return false;
  const cfg = getConfig();
  const base = deliveredAt ? Date.parse(deliveredAt) : Date.now();
  const ends = new Date(base + cfg.escrow_days * 86_400_000).toISOString();
  run(`UPDATE order_finance SET dispute_window_ends = ?, updated_at = ? WHERE order_id = ?`, [
    ends,
    nowIso(),
    orderId,
  ]);
  return true;
}

/**
 * Escrow release (COM-015/FIN-008/FIN-013): after delivery + the dispute
 * window elapses with no open dispute, credit the seller net of the FVF and
 * the VAT on the fee, and book platform revenue + VAT liability.
 * Posts: debit escrow_liability / credit seller_balance:<u> + platform_revenue + vat_liability.
 */
export function releaseEscrow(orderId: number, actor = "system:sweep"): boolean {
  const balancedTx = `REL-${orderId}`;
  if (txExists(balancedTx)) return false;
  const row = orderFinanceById(orderId);
  if (!row || row.status !== "holding" || row.escrow_cents <= 0) return false;

  const originalGross = row.escrow_cents + row.refunded_cents;
  // Partial pre-release refunds shrink the fee proportionally (documented policy).
  const fee =
    row.refunded_cents > 0
      ? Math.round(row.fee_cents * (row.escrow_cents / originalGross))
      : row.fee_cents;
  const vat = Math.round(fee * getConfig().vat_pct);
  const net = row.escrow_cents - fee - vat;

  postTransaction({
    balancedTx,
    txType: "escrow.release",
    orderRef: String(orderId),
    actor,
    legs: [
      {
        account: "escrow_liability",
        direction: "debit",
        amountCents: row.escrow_cents,
        counterAccount: sellerAccount(row.seller),
        memo: `Escrow released for order #${orderId}`,
      },
      {
        account: sellerAccount(row.seller),
        direction: "credit",
        amountCents: net,
        counterAccount: "escrow_liability",
        memo: `Net proceeds for order #${orderId} (after FVF ${fee}c + VAT ${vat}c)`,
      },
      {
        account: "platform_revenue",
        direction: "credit",
        amountCents: fee,
        counterAccount: "escrow_liability",
        memo: `Final-value fee revenue for order #${orderId}`,
      },
      {
        account: "vat_liability",
        direction: "credit",
        amountCents: vat,
        counterAccount: "escrow_liability",
        memo: `VAT (15%) on FVF for order #${orderId}`,
      },
    ],
  });

  run(
    `UPDATE order_finance SET status = 'released', fee_cents = ?, vat_cents = ?, net_to_seller_cents = ?, released_at = ?, updated_at = ? WHERE order_id = ?`,
    [fee, vat, net, nowIso(), nowIso(), orderId],
  );
  refreshSellerBalance(row.seller);
  return true;
}

/**
 * order.cancelled while escrow is still holding — reverse the escrow to the
 * buyer (COM-010 pre-payment-SLAs / admin cancels). Idempotent per order.
 */
export function cancelEscrow(orderId: number, actor = "system:engine", reason?: string): boolean {
  const balancedTx = `CNL-${orderId}`;
  if (txExists(balancedTx)) return false;
  const row = orderFinanceById(orderId);
  if (!row || row.status !== "holding" || row.escrow_cents <= 0) return false;
  postTransaction({
    balancedTx,
    txType: "order.cancel",
    orderRef: String(orderId),
    actor,
    legs: [
      {
        account: "escrow_liability",
        direction: "debit",
        amountCents: row.escrow_cents,
        counterAccount: "bank",
        memo: `Escrow reversed on cancel for order #${orderId}`,
      },
      {
        account: "bank",
        direction: "credit",
        amountCents: row.escrow_cents,
        counterAccount: "escrow_liability",
        memo: `Refund to buyer ${row.buyer} for cancelled order #${orderId}${reason ? ` (${reason})` : ""}`,
      },
    ],
  });
  run(`UPDATE order_finance SET status = 'refunded', updated_at = ? WHERE order_id = ?`, [
    nowIso(),
    orderId,
  ]);
  refreshSellerBalance(row.seller);
  return true;
}

// ── Refunds (COM-010/COM-011/FIN-005/FIN-011) ──────────────────────────

export interface RefundRow {
  id: number;
  order_id: number;
  amount_cents: number;
  kind: "full" | "partial";
  reason_code: string;
  reason_note: string | null;
  status: "pending_approval" | "approved" | "processed" | "rejected";
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  dual_approval: number;
  credit_note_id: number | null;
  created_at: string;
}

const REASON_CODES = new Set([
  "item_not_received",
  "not_as_described",
  "damaged",
  "seller_cancelled",
  "goodwill",
]);

export function isReasonCode(code: string): boolean {
  return REASON_CODES.has(code);
}

export function refundById(id: number): RefundRow {
  const row = get<RefundRow>(`SELECT * FROM refunds WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, "refund not found", "not_found");
  return row;
}

export function nextDocNumber(prefix: string, table: "invoices" | "credit_notes"): string {
  const year = new Date().getUTCFullYear();
  const n = scalar(`SELECT COUNT(*) AS n FROM ${table} WHERE number LIKE ?`, [`${prefix}%`]);
  return `${prefix}${year}-${String(n + 1).padStart(4, "0")}`;
}

function issueCreditNote(refundId: number, orderId: number, amountCents: number, vatCents: number): number {
  const number = nextDocNumber("TGS-CN-", "credit_notes");
  return insert(
    `INSERT INTO credit_notes(number, refund_ref, order_id, amount_cents, vat_cents) VALUES(?, ?, ?, ?, ?)`,
    [number, `RFD-${refundId}`, orderId, amountCents, vatCents],
  );
}

/**
 * Process an APPROVED refund — the money engine behind COM-010/COM-011.
 *   · Pre-release (escrow holding): reverse escrow → buyer (bank credit).
 *   · Post-release: claw back the seller share from seller_balance (floored
 *     at 0 — shortfalls hit refund_expense) and reverse the proportional
 *     fee + VAT-on-fee (revenue reversal).
 * Both paths post ONE balanced transaction RFD-<refundId> and issue a
 * credit note (FIN-005).
 */
export function processRefund(refund: RefundRow, approvedBy: string): void {
  if (refund.status === "processed") return; // idempotent
  const balancedTx = `RFD-${refund.id}`;
  if (txExists(balancedTx)) return;
  const row = orderFinanceById(refund.order_id);
  if (!row) throw new HttpError(400, "order is not in the finance system", "no_order_finance");

  const amount = refund.amount_cents;
  const gross = row.item_price_cents + row.shipping_cents;
  if (amount <= 0) throw new HttpError(400, "refund amount must be > 0", "bad_amount");

  let vatReversal = 0;
  if (row.status === "holding" || row.status === "partial") {
    if (amount > row.escrow_cents) {
      throw new HttpError(400, `refund exceeds the ${row.escrow_cents}c still in escrow`, "over_refund");
    }
    postTransaction({
      balancedTx,
      txType: "escrow.refund",
      orderRef: String(row.order_id),
      actor: `admin:${approvedBy}`,
      legs: [
        {
          account: "escrow_liability",
          direction: "debit",
          amountCents: amount,
          counterAccount: "bank",
          memo: `Refund to buyer ${row.buyer} for order #${row.order_id} (${refund.reason_code})`,
        },
        {
          account: "bank",
          direction: "credit",
          amountCents: amount,
          counterAccount: "escrow_liability",
          memo: `Refund paid out for order #${row.order_id} — refund RFD-${refund.id}`,
        },
      ],
    });
    const remaining = row.escrow_cents - amount;
    run(
      `UPDATE order_finance SET escrow_cents = ?, refunded_cents = refunded_cents + ?, status = ?, updated_at = ? WHERE order_id = ?`,
      [remaining, amount, remaining === 0 ? "refunded" : "partial", nowIso(), row.order_id],
    );
  } else if (row.status === "released") {
    if (amount > gross - row.refunded_cents) {
      throw new HttpError(400, "refund exceeds the order amount", "over_refund");
    }
    // proportional fee + VAT reversal
    const feeReversal = Math.round((row.fee_cents * amount) / gross);
    vatReversal = Math.round((row.vat_cents * amount) / gross);
    const sellerShare = amount - feeReversal - vatReversal;
    const available = accountBalance(sellerAccount(row.seller));
    const clampedShare = Math.max(0, Math.min(sellerShare, available));
    const shortfall = sellerShare - clampedShare;
    const legs: LedgerLeg[] = [
      {
        account: sellerAccount(row.seller),
        direction: "debit",
        amountCents: clampedShare,
        counterAccount: "bank",
        memo: `Refund clawback from seller ${row.seller} for order #${row.order_id}`,
      },
      {
        account: "platform_revenue",
        direction: "debit",
        amountCents: feeReversal,
        counterAccount: "escrow_liability",
        memo: `Proportional FVF reversal for order #${row.order_id}`,
      },
      {
        account: "vat_liability",
        direction: "debit",
        amountCents: vatReversal,
        counterAccount: "platform_revenue",
        memo: `VAT-on-fee reversal for order #${row.order_id}`,
      },
    ];
    if (shortfall > 0) {
      legs.push({
        account: "refund_expense",
        direction: "debit",
        amountCents: shortfall,
        counterAccount: "bank",
        memo: `Seller balance shortfall absorbed by platform for order #${row.order_id}`,
      });
    }
    legs.push({
      account: "bank",
      direction: "credit",
      amountCents: amount,
      counterAccount: sellerAccount(row.seller),
      memo: `Refund paid to buyer ${row.buyer} for order #${row.order_id} — refund RFD-${refund.id}`,
    });
    postTransaction({
      balancedTx,
      txType: "refund.clawback",
      orderRef: String(row.order_id),
      actor: `admin:${approvedBy}`,
      legs,
    });
    const remaining = gross - row.refunded_cents - amount;
    run(
      `UPDATE order_finance SET refunded_cents = refunded_cents + ?, status = ?, updated_at = ? WHERE order_id = ?`,
      [amount, remaining === 0 ? "refunded" : "partial", nowIso(), row.order_id],
    );
  } else {
    throw new HttpError(400, `order #${row.order_id} is already fully refunded`, "already_refunded");
  }

  const cnId = issueCreditNote(refund.id, row.order_id, amount, vatReversal);
  run(`UPDATE refunds SET status = 'processed', approved_by = ?, approved_at = ?, credit_note_id = ? WHERE id = ?`, [
    approvedBy,
    nowIso(),
    cnId,
    refund.id,
  ]);
  refreshSellerBalance(row.seller);
}

// ── Featured listing fee (COM-013: featured US$2 + VAT) ────────────────

export function chargeFeaturedFee(username: string, auctionRef: string, balancedTx: string): boolean {
  if (txExists(balancedTx)) return false;
  const cfg = getConfig();
  const { feeCents, vatCents } = computeFeaturedFees(cfg);
  postTransaction({
    balancedTx,
    txType: "featured.fee",
    actor: username.toLowerCase(),
    legs: [
      {
        account: sellerAccount(username),
        direction: "debit",
        amountCents: feeCents + vatCents,
        counterAccount: "platform_revenue",
        memo: `Featured listing fee for ${auctionRef} (fee ${feeCents}c + VAT ${vatCents}c)`,
      },
      {
        account: "platform_revenue",
        direction: "credit",
        amountCents: feeCents,
        counterAccount: sellerAccount(username),
        memo: `Featured listing fee revenue — ${auctionRef}`,
      },
      {
        account: "vat_liability",
        direction: "credit",
        amountCents: vatCents,
        counterAccount: sellerAccount(username),
        memo: `VAT on featured listing fee — ${auctionRef}`,
      },
    ],
  });
  refreshSellerBalance(username);
  return true;
}

// ── Integrity verifier (FIN-009) ───────────────────────────────────────

export function verifyLedger(): { ok: boolean; transactions: number; failures: { balancedTx: string; delta: number }[] } {
  const rows = all<{ balanced_tx: string; delta: number }>(
    `SELECT balanced_tx,
            SUM(CASE WHEN direction='debit' THEN amount_cents ELSE -amount_cents END) AS delta
     FROM ledger_entries GROUP BY balanced_tx`,
  );
  const failures = rows
    .filter((r) => Math.round(Number(r.delta)) !== 0)
    .map((r) => ({ balancedTx: r.balanced_tx, delta: Math.round(Number(r.delta)) }));
  return { ok: failures.length === 0, transactions: rows.length, failures };
}

// ── Stats (EXE-002/FIN-019) ────────────────────────────────────────────

export function financeStats(): Record<string, unknown> {
  const cfg = getConfig();
  const escrowHolding = scalar(
    `SELECT COALESCE(SUM(escrow_cents),0) AS n FROM order_finance WHERE status IN('holding','partial')`,
  );
  const revenue30d = scalar(
    `SELECT COALESCE(SUM(amount_cents),0) AS n FROM ledger_entries
     WHERE account='platform_revenue' AND direction='credit' AND ts >= datetime('now','-30 days')`,
  );
  const revenue30dDebits = scalar(
    `SELECT COALESCE(SUM(amount_cents),0) AS n FROM ledger_entries
     WHERE account='platform_revenue' AND direction='debit' AND ts >= datetime('now','-30 days')`,
  );
  const vatDue = accountBalance("vat_liability");
  const payoutsPending = scalar(
    `SELECT COALESCE(SUM(amount_cents),0) AS n FROM payouts WHERE status IN('requested','approved')`,
  );
  const payoutsPendingCount = scalar(`SELECT COUNT(*) AS n FROM payouts WHERE status IN('requested','approved')`);
  const refunds30d = scalar(
    `SELECT COALESCE(SUM(amount_cents),0) AS n FROM refunds WHERE status='processed' AND created_at >= datetime('now','-30 days')`,
  );
  const bank = accountBalance("bank");
  const escrow = accountBalance("escrow_liability");
  const payable = accountBalance("payout_payable");
  refreshAllSellerBalances();
  const owed = scalar(`SELECT COALESCE(SUM(available_cents),0) AS n FROM seller_balances`);
  return {
    currency: cfg.currency,
    escrowHoldingCents: escrowHolding,
    revenue30dCents: revenue30d - revenue30dDebits,
    vatDueCents: vatDue,
    payoutsPendingCents: payoutsPending,
    payoutsPendingCount,
    refunds30dCents: refunds30d,
    bankCents: bank,
    escrowLiabilityCents: escrow,
    payoutPayableCents: payable,
    sellerOwedCents: owed,
  };
}
