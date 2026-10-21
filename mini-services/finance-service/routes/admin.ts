// Admin endpoints — the finance console backend (MSCS 12-b §B).
// All require x-tgs-admin: 1 (the Next BFF verifies the TrailBase admin
// claim). Covers: config, ledger (+verify), balances, payouts (dual
// approval + sanctions confirm), refunds (+chargebacks), invoices,
// reconciliation (+bank lines), tax packs, stats and the demo seeder.

import { HttpError, bodyArr, bodyOptStr, bodyStr, type AddRoute, type Ctx, type RouteHandler } from "../http";
import { all, get, insert, run, scalar } from "../db";
import { ALLOWED_CONFIG_KEYS } from "../config";
import { nowIso, toIsoOut, centsToUsd, parseAmountCents, monthRange, escapeCsv, safeJsonParse } from "../util";
import {
  getConfig,
  setConfigKey,
  accountBalance,
  sellerAccount,
  orderFinanceById,
  orderFinanceOut,
  postTransaction,
  txExists,
  processRefund,
  refundById,
  isReasonCode,
  verifyLedger,
  financeStats,
  refreshSellerBalance,
  nextDocNumber,
} from "../money";
import { payoutOut, invoiceOut } from "./me";
import { tbListOrders, tbListPayments, tbGetAuction, tbResetToken } from "../trailbase";
import { seedDemo } from "../seed";

const admin = (handler: RouteHandler): RouteHandler => (ctx) => {
  ctx.requireAdmin();
  return handler(ctx);
};

function payoutById(id: number): Record<string, unknown> {
  const row = get<Record<string, unknown>>(`SELECT * FROM payouts WHERE id = ?`, [id]);
  if (!row) throw new HttpError(404, "payout not found", "not_found");
  return row;
}

function ledgerOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id as number,
    ts: toIsoOut(r.ts as string),
    orderRef: (r.order_ref as string | null) ?? null,
    payoutRef: (r.payout_ref as string | null) ?? null,
    txType: r.tx_type as string,
    account: r.account as string,
    direction: r.direction as "debit" | "credit",
    amountCents: r.amount_cents as number,
    amount: centsToUsd(r.amount_cents as number),
    counterAccount: (r.counter_account as string | null) ?? null,
    memo: (r.memo as string | null) ?? null,
    actor: (r.actor as string | null) ?? null,
    balancedTx: r.balanced_tx as string,
  };
}

function refundOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id as number,
    orderId: r.order_id as number,
    amountCents: r.amount_cents as number,
    amount: centsToUsd(r.amount_cents as number),
    kind: r.kind as string,
    reasonCode: r.reason_code as string,
    reasonNote: (r.reason_note as string | null) ?? null,
    status: r.status as string,
    requestedBy: (r.requested_by as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: toIsoOut(r.approved_at as string | null),
    dualApproval: r.dual_approval === 1,
    creditNoteId: (r.credit_note_id as number | null) ?? null,
    createdAt: toIsoOut(r.created_at as string),
  };
}

function creditNoteOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id as number,
    number: r.number as string,
    refundRef: (r.refund_ref as string | null) ?? null,
    orderId: (r.order_id as number | null) ?? null,
    amountCents: r.amount_cents as number,
    vatCents: r.vat_cents as number,
    createdAt: toIsoOut(r.created_at as string),
  };
}

export function registerAdminRoutes(on: AddRoute): void {
  // ── config ───────────────────────────────────────────────────────
  on("GET", "/admin/config", admin(() => ({ config: getConfig() })));

  on("POST", "/admin/config", admin((ctx) => {
    const updates = ctx.body ?? {};
    const applied: Record<string, unknown> = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (!(key in updates)) continue;
      const v = updates[key];
      if (key === "currency") {
        if (typeof v === "string" && v.trim()) {
          setConfigKey(key, v.trim().slice(0, 8).toUpperCase());
          applied[key] = v.trim().slice(0, 8).toUpperCase();
        }
        continue;
      }
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
        throw new HttpError(400, `${key} must be a number ≥ 0`, "bad_field");
      }
      setConfigKey(key, n);
      applied[key] = n;
    }
    return { ok: true, applied, config: getConfig() };
  }));

  // ── ledger (+ FIN-009 integrity verify) ──────────────────────────
  on("GET", "/admin/ledger", admin((ctx) => {
    if (ctx.url.searchParams.get("verify") === "1") {
      const result = verifyLedger();
      return { verify: result.ok ? "ok" : "fail", transactions: result.transactions, failures: result.failures };
    }
    const account = ctx.url.searchParams.get("account") ?? "";
    const limitRaw = ctx.url.searchParams.get("limit");
    const limit = Math.min(Math.max(Number.parseInt(limitRaw || "100", 10) || 100, 1), 1000);
    const rows = account
      ? all(`SELECT * FROM ledger_entries WHERE account = ? ORDER BY id DESC LIMIT ?`, [account, limit])
      : all(`SELECT * FROM ledger_entries ORDER BY id DESC LIMIT ?`, [limit]);
    const accounts = all<{ account: string }>(
      `SELECT DISTINCT account FROM ledger_entries ORDER BY account ASC`,
    ).map((r) => r.account);
    return { entries: rows.map(ledgerOut), accounts };
  }));

  // ── balances ─────────────────────────────────────────────────────
  on("GET", "/admin/balances", admin(() => {
    const rows = all<Record<string, unknown>>(`SELECT * FROM seller_balances ORDER BY available_cents DESC`);
    return {
      balances: rows.map((r) => ({
        username: r.username as string,
        availableCents: r.available_cents as number,
        pendingCents: r.pending_cents as number,
        withheldCents: r.withheld_cents as number,
        updatedAt: toIsoOut(r.updated_at as string | null),
      })),
      accounts: {
        bankCents: accountBalance("bank"),
        escrowLiabilityCents: accountBalance("escrow_liability"),
        platformRevenueCents: accountBalance("platform_revenue"),
        vatLiabilityCents: accountBalance("vat_liability"),
        payoutPayableCents: accountBalance("payout_payable"),
        refundExpenseCents: -accountBalance("refund_expense"),
      },
    };
  }));

  // ── payouts ──────────────────────────────────────────────────────
  on("GET", "/admin/payouts", admin((ctx) => {
    const status = ctx.url.searchParams.get("status");
    const rows = status
      ? all(`SELECT * FROM payouts WHERE status = ? ORDER BY id DESC LIMIT 200`, [status])
      : all(`SELECT * FROM payouts ORDER BY id DESC LIMIT 200`);
    const cfg = getConfig();
    return {
      payouts: rows.map(payoutOut),
      thresholdCents: Math.round(cfg.dual_approval_threshold * 100),
      sanctionsNote: "Approver must confirm sanctions screening before approval (GOV-009).",
    };
  }));

  // admin-created payout on behalf of a seller (testing/ops path)
  on("POST", "/admin/payouts", admin((ctx) => {
    const username = bodyStr(ctx, "username", { required: true, max: 60 }).toLowerCase();
    const amountCents = Number(ctx.body?.amountCents) > 0
      ? Math.round(Number(ctx.body?.amountCents))
      : parseAmountCents(ctx.body?.amount);
    if (!amountCents) throw new HttpError(400, "Enter a payout amount.", "bad_amount");
    const method = bodyStr(ctx, "method", { max: 20 }) || "bank";
    if (method !== "ecocash" && method !== "bank") throw new HttpError(400, "bad method", "bad_method");
    const destination = bodyStr(ctx, "destination", { required: true, max: 120 });
    const idNumber = bodyStr(ctx, "idNumber", { required: true, max: 40 });
    const available = accountBalance(sellerAccount(username));
    if (amountCents > available) throw new HttpError(400, "Amount exceeds the seller balance.", "insufficient");
    const id = insert(
      `INSERT INTO payouts(username, amount_cents, method, destination, id_number, status, requested_at)
       VALUES(?, ?, ?, ?, ?, 'requested', ?)`,
      [username, amountCents, method, destination, idNumber, nowIso()],
    );
    return { payout: payoutOut(payoutById(id)) };
  }));

  // approve — reason REQUIRED (CTL-019) + sanctions confirm REQUIRED (GOV-009)
  on("POST", "/admin/payouts/:id/approve", admin((ctx) => {
    const row = payoutById(Number(ctx.params.id));
    if (row.status !== "requested") throw new HttpError(409, `payout is ${row.status}`, "bad_state");
    const reason = bodyStr(ctx, "reason", { required: true, max: 300 });
    const sanctions = ctx.body?.sanctionsConfirmed;
    if (sanctions !== true && sanctions !== 1 && sanctions !== "1") {
      throw new HttpError(400, "Sanctions screening must be confirmed before approving.", "sanctions_required");
    }
    const actor = ctx.user ?? "admin";
    const amount = row.amount_cents as number;
    const cfg = getConfig();
    const dual = amount > Math.round(cfg.dual_approval_threshold * 100);
    postTransaction({
      balancedTx: `PYE-${row.id}`,
      txType: "payout.earmark",
      payoutRef: String(row.id),
      actor: `admin:${actor}`,
      legs: [
        {
          account: sellerAccount(row.username as string),
          direction: "debit",
          amountCents: amount,
          counterAccount: "payout_payable",
          memo: `Payout #${row.id} approved by ${actor}: ${reason}`,
        },
        {
          account: "payout_payable",
          direction: "credit",
          amountCents: amount,
          counterAccount: sellerAccount(row.username as string),
          memo: `Payout #${row.id} earmarked for ${row.method} → ${row.destination}`,
        },
      ],
    });
    run(
      `UPDATE payouts SET status='approved', approved_by=?, approved_at=?, approve_reason=?, sanctions_confirmed=1 WHERE id=?`,
      [actor, nowIso(), reason, row.id],
    );
    refreshSellerBalance(row.username as string);
    return { payout: payoutOut(payoutById(row.id as number)), dualApprovalRequired: dual };
  }));

  // pay — reference REQUIRED; when amount > threshold the payer must be a
  // DIFFERENT admin than the approver (COM-017 dual control).
  on("POST", "/admin/payouts/:id/pay", admin((ctx) => {
    const row = payoutById(Number(ctx.params.id));
    if (row.status !== "approved") throw new HttpError(409, `payout is ${row.status}`, "bad_state");
    const reference = bodyStr(ctx, "reference", { required: true, max: 60 });
    const actor = ctx.user ?? "admin";
    const cfg = getConfig();
    const amount = row.amount_cents as number;
    if (amount > Math.round(cfg.dual_approval_threshold * 100) && actor === row.approved_by) {
      throw new HttpError(
        403,
        "Dual approval: a second administrator must complete this payout.",
        "different_admin_required",
      );
    }
    postTransaction({
      balancedTx: `PYP-${row.id}`,
      txType: "payout.pay",
      payoutRef: String(row.id),
      actor: `admin:${actor}`,
      legs: [
        {
          account: "payout_payable",
          direction: "debit",
          amountCents: amount,
          counterAccount: "bank",
          memo: `Payout #${row.id} paid via ${row.method} (ref ${reference})`,
        },
        {
          account: "bank",
          direction: "credit",
          amountCents: amount,
          counterAccount: "payout_payable",
          memo: `Payout #${row.id} to ${row.username} — ${row.destination}, ref ${reference}`,
        },
      ],
    });
    run(`UPDATE payouts SET status='paid', paid_by=?, paid_at=?, reference=? WHERE id=?`, [
      actor,
      nowIso(),
      reference,
      row.id,
    ]);
    refreshSellerBalance(row.username as string);
    return { payout: payoutOut(payoutById(row.id as number)) };
  }));

  // reverse — reason REQUIRED; rejected (from requested), un-earmark (from
  // approved) or funds returned (from paid — COM-018 failed transfer).
  on("POST", "/admin/payouts/:id/reverse", admin((ctx) => {
    const row = payoutById(Number(ctx.params.id));
    const status = row.status as string;
    if (status === "rejected" || status === "reversed") return { payout: payoutOut(row) };
    if (!["requested", "approved", "paid"].includes(status)) {
      throw new HttpError(409, `payout is ${status}`, "bad_state");
    }
    const reason = bodyStr(ctx, "reason", { required: true, max: 300 });
    const actor = ctx.user ?? "admin";
    const amount = row.amount_cents as number;

    if (status === "requested") {
      run(`UPDATE payouts SET status='rejected', reversal_reason=? WHERE id=?`, [reason, row.id]);
    } else if (status === "approved") {
      postTransaction({
        balancedTx: `PYU-${row.id}`,
        txType: "payout.unearmark",
        payoutRef: String(row.id),
        actor: `admin:${actor}`,
        legs: [
          {
            account: "payout_payable",
            direction: "debit",
            amountCents: amount,
            counterAccount: sellerAccount(row.username as string),
            memo: `Payout #${row.id} reversed before payment: ${reason}`,
          },
          {
            account: sellerAccount(row.username as string),
            direction: "credit",
            amountCents: amount,
            counterAccount: "payout_payable",
            memo: `Payout #${row.id} cancelled — funds returned to balance`,
          },
        ],
      });
      run(`UPDATE payouts SET status='rejected', reversal_reason=? WHERE id=?`, [reason, row.id]);
      refreshSellerBalance(row.username as string);
    } else {
      // paid → transfer failed / recalled: funds return to the seller balance
      postTransaction({
        balancedTx: `PYR-${row.id}`,
        txType: "payout.return",
        payoutRef: String(row.id),
        actor: `admin:${actor}`,
        legs: [
          {
            account: "bank",
            direction: "debit",
            amountCents: amount,
            counterAccount: sellerAccount(row.username as string),
            memo: `Payout #${row.id} transfer failed — funds recalled: ${reason}`,
          },
          {
            account: sellerAccount(row.username as string),
            direction: "credit",
            amountCents: amount,
            counterAccount: "bank",
            memo: `Payout #${row.id} reversed back to seller balance`,
          },
        ],
      });
      run(`UPDATE payouts SET status='reversed', reversal_reason=? WHERE id=?`, [reason, row.id]);
      refreshSellerBalance(row.username as string);
    }
    return { payout: payoutOut(payoutById(row.id as number)) };
  }));

  // ── refunds ──────────────────────────────────────────────────────
  on("GET", "/admin/refunds", admin(() => {
    const rows = all(`SELECT * FROM refunds ORDER BY id DESC LIMIT 200`);
    const notes = all(`SELECT * FROM credit_notes ORDER BY id DESC LIMIT 100`);
    return { refunds: rows.map(refundOut), creditNotes: notes.map(creditNoteOut) };
  }));

  on("POST", "/admin/refunds", admin((ctx) => {
    const orderId = Number(ctx.body?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "orderId required", "bad_field");
    const fin = orderFinanceById(orderId);
    if (!fin) throw new HttpError(400, "order is not in the finance system", "no_order_finance");
    const kind = bodyStr(ctx, "kind", { max: 10 }) || "full";
    if (kind !== "full" && kind !== "partial") throw new HttpError(400, "kind must be full or partial", "bad_kind");
    const reasonCode = bodyStr(ctx, "reasonCode", { required: true, max: 40 });
    if (!isReasonCode(reasonCode)) throw new HttpError(400, "unknown reasonCode", "bad_reason");
    const reasonNote = bodyOptStr(ctx, "reasonNote", 400);
    const cfg = getConfig();
    const gross = fin.item_price_cents + fin.shipping_cents;
    const maxAmount =
      fin.status === "holding" || fin.status === "partial" ? fin.escrow_cents : gross - fin.refunded_cents;
    if (maxAmount <= 0) throw new HttpError(400, "nothing left to refund on this order", "already_refunded");
    let amountCents: number;
    if (kind === "full") {
      amountCents = maxAmount;
    } else {
      amountCents = Number(ctx.body?.amountCents) > 0
        ? Math.round(Number(ctx.body?.amountCents))
        : (parseAmountCents(ctx.body?.amount) ?? 0);
      if (!amountCents) throw new HttpError(400, "Enter a refund amount.", "bad_amount");
      if (amountCents > maxAmount) {
        throw new HttpError(400, `Refund exceeds the refundable US$${centsToUsd(maxAmount)}.`, "over_refund");
      }
    }
    const requestedBy = ctx.user ?? "admin";
    const dual = amountCents > Math.round(cfg.dual_approval_threshold * 100);
    const autoMax = Math.round(cfg.refund_auto_max * 100);
    const autoProcess = amountCents <= autoMax && !dual;

    const id = insert(
      `INSERT INTO refunds(order_id, amount_cents, kind, reason_code, reason_note, status, requested_by, dual_approval)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, amountCents, kind, reasonCode, reasonNote, autoProcess ? "approved" : "pending_approval", requestedBy, dual ? 1 : 0],
    );
    if (autoProcess) processRefund(refundById(id), requestedBy);
    return { refund: refundOut(get(`SELECT * FROM refunds WHERE id = ?`, [id])!), autoProcessed: autoProcess };
  }));

  on("POST", "/admin/refunds/:id/approve", admin((ctx) => {
    const refund = refundById(Number(ctx.params.id));
    const decision = bodyStr(ctx, "decision", { required: true, max: 10 });
    if (decision !== "approve" && decision !== "reject") {
      throw new HttpError(400, 'decision must be "approve" or "reject"', "bad_decision");
    }
    if (refund.status !== "pending_approval") throw new HttpError(409, `refund is ${refund.status}`, "bad_state");
    const actor = ctx.user ?? "admin";
    if (refund.dual_approval === 1 && actor === refund.requested_by) {
      throw new HttpError(403, "Dual approval: a second administrator must approve this refund.", "different_admin_required");
    }
    if (decision === "reject") {
      const reason = bodyOptStr(ctx, "reason", 300) ?? "rejected by admin";
      run(`UPDATE refunds SET status='rejected', approved_by=?, approved_at=? WHERE id=?`, [actor, nowIso(), refund.id]);
      return { refund: refundOut(get(`SELECT * FROM refunds WHERE id = ?`, [refund.id])!) };
    }
    processRefund(refundById(refund.id), actor);
    return { refund: refundOut(get(`SELECT * FROM refunds WHERE id = ?`, [refund.id])!) };
  }));

  // ── chargebacks (COM-023) ─────────────────────────────────────────
  on("GET", "/admin/chargebacks", admin(() => {
    const rows = all(`SELECT * FROM chargebacks ORDER BY id DESC LIMIT 100`);
    return {
      chargebacks: rows.map((r) => ({
        id: r.id as number,
        orderId: r.order_id as number,
        providerRef: (r.provider_ref as string | null) ?? null,
        amountCents: r.amount_cents as number,
        amount: centsToUsd(r.amount_cents as number),
        status: r.status as string,
        evidence: safeJsonParse(r.evidence as string | null, {}),
        resolution: (r.resolution as string | null) ?? null,
        resolutionNote: (r.resolution_note as string | null) ?? null,
        resolvedBy: (r.resolved_by as string | null) ?? null,
        createdAt: toIsoOut(r.created_at as string),
      })),
    };
  }));

  on("POST", "/admin/chargebacks", admin((ctx) => {
    const orderId = Number(ctx.body?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "orderId required", "bad_field");
    if (!orderFinanceById(orderId)) throw new HttpError(400, "order is not in the finance system", "no_order_finance");
    const amountCents = Number(ctx.body?.amountCents) > 0
      ? Math.round(Number(ctx.body?.amountCents))
      : (parseAmountCents(ctx.body?.amount) ?? 0);
    if (!amountCents) throw new HttpError(400, "Enter a chargeback amount.", "bad_amount");
    const providerRef = bodyOptStr(ctx, "providerRef", 80);
    const evidence = ctx.body?.evidence ?? {};
    const id = insert(
      `INSERT INTO chargebacks(order_id, provider_ref, amount_cents, evidence) VALUES(?, ?, ?, ?)`,
      [orderId, providerRef, amountCents, JSON.stringify(evidence)],
    );
    return { ok: true, chargebackId: id };
  }));

  on("POST", "/admin/chargebacks/:id/resolve", admin((ctx) => {
    const row = get<Record<string, unknown>>(`SELECT * FROM chargebacks WHERE id = ?`, [Number(ctx.params.id)]);
    if (!row) throw new HttpError(404, "chargeback not found", "not_found");
    if (row.status !== "open") throw new HttpError(409, "chargeback already resolved", "bad_state");
    const resolution = bodyStr(ctx, "resolution", { required: true, max: 30 });
    const note = bodyOptStr(ctx, "note", 300);
    const actor = ctx.user ?? "admin";
    const orderId = row.order_id as number;
    const amount = row.amount_cents as number;
    const fin = orderFinanceById(orderId);
    if (!fin) throw new HttpError(400, "order is not in the finance system", "no_order_finance");
    if (resolution !== "seller_liability" && resolution !== "platform_absorbed") {
      throw new HttpError(400, "resolution must be seller_liability or platform_absorbed", "bad_resolution");
    }
    const balancedTx = `CBK-${row.id}`;
    if (!txExists(balancedTx)) {
      const preRelease = fin.status === "holding" || fin.status === "partial";
      if (resolution === "seller_liability" && !preRelease) {
        // like a post-release refund clawback: seller share + fee/VAT reversal
        const gross = fin.item_price_cents + fin.shipping_cents;
        const feeReversal = Math.round((fin.fee_cents * amount) / gross);
        const vatReversal = Math.round((fin.vat_cents * amount) / gross);
        const sellerShare = Math.max(0, amount - feeReversal - vatReversal);
        const available = accountBalance(sellerAccount(fin.seller));
        const clamped = Math.min(sellerShare, available);
        const shortfall = sellerShare - clamped;
        const legs = [
          { account: sellerAccount(fin.seller), direction: "debit" as const, amountCents: clamped, counterAccount: "bank", memo: `Chargeback clawback — order #${orderId}` },
          { account: "platform_revenue", direction: "debit" as const, amountCents: feeReversal, counterAccount: "bank", memo: `Fee reversal on chargeback — order #${orderId}` },
          { account: "vat_liability", direction: "debit" as const, amountCents: vatReversal, counterAccount: "platform_revenue", memo: `VAT reversal on chargeback — order #${orderId}` },
        ];
        if (shortfall > 0) {
          legs.push({ account: "refund_expense", direction: "debit" as const, amountCents: shortfall, counterAccount: "bank", memo: `Chargeback shortfall absorbed — order #${orderId}` });
        }
        legs.push({ account: "bank", direction: "credit" as const, amountCents: amount, counterAccount: sellerAccount(fin.seller), memo: `Chargeback repaid to provider — order #${orderId}` });
        postTransaction({ balancedTx, txType: "chargeback.resolve", orderRef: String(orderId), actor: `admin:${actor}`, legs });
      } else {
        // platform_absorbed — or a pre-release seller-liability chargeback where
        // the money is still in escrow: both pay the provider, either from
        // escrow (pre-release) or from the platform's refund_expense account.
        const escrowSource = preRelease && resolution === "seller_liability";
        postTransaction({
          balancedTx,
          txType: "chargeback.resolve",
          orderRef: String(orderId),
          actor: `admin:${actor}`,
          legs: [
            {
              account: escrowSource ? "escrow_liability" : "refund_expense",
              direction: "debit",
              amountCents: amount,
              counterAccount: "bank",
              memo: `Chargeback ${escrowSource ? "paid from escrow" : "absorbed by platform"} — order #${orderId}`,
            },
            {
              account: "bank",
              direction: "credit",
              amountCents: amount,
              counterAccount: escrowSource ? "escrow_liability" : "refund_expense",
              memo: `Chargeback repaid to provider — order #${orderId}`,
            },
          ],
        });
      }
    }
    run(
      `UPDATE chargebacks SET status='resolved', resolution=?, resolution_note=?, resolved_by=?, resolved_at=? WHERE id=?`,
      [resolution, note, actor, nowIso(), row.id],
    );
    if (fin.status === "holding" || fin.status === "partial") {
      // pre-release chargeback also drains the remaining escrow to refunded
      const remaining = Math.max(0, fin.escrow_cents - amount);
      run(`UPDATE order_finance SET refunded_cents = refunded_cents + ?, escrow_cents = ?, status = ?, updated_at = ? WHERE order_id = ?`, [
        amount,
        remaining,
        remaining === 0 ? "refunded" : "partial",
        nowIso(),
        orderId,
      ]);
    }
    refreshSellerBalance(fin.seller);
    return { ok: true };
  }));

  // ── invoices (COM-019/FIN-002/FIN-004) ────────────────────────────
  on("GET", "/admin/invoices", admin(() => {
    const rows = all(`SELECT * FROM invoices ORDER BY id DESC LIMIT 200`);
    return { invoices: rows.map(invoiceOut) };
  }));

  on("POST", "/admin/invoices", admin((ctx) => {
    const username = bodyStr(ctx, "username", { required: true, max: 60 }).toLowerCase();
    const period = bodyStr(ctx, "period", { required: true, max: 10 }); // YYYY-MM
    const range = monthRange(period);
    if (!range) throw new HttpError(400, "period must be YYYY-MM", "bad_period");
    const existing = get(`SELECT id FROM invoices WHERE username = ? AND period_start = ?`, [username, range.start]);
    if (existing) throw new HttpError(409, "invoice already exists for this period", "duplicate_invoice");
    const totals = invoiceTotalsFor(username, range.start, range.end);
    const number = nextDocNumber("TGS-FEE-", "invoices");
    const id = insert(
      `INSERT INTO invoices(number, username, period_start, period_end, fee_cents, vat_cents, total_cents, status)
       VALUES(?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [number, username, range.start, range.end, totals.feeCents, totals.vatCents, totals.feeCents + totals.vatCents],
    );
    return { invoice: invoiceOut(get(`SELECT * FROM invoices WHERE id = ?`, [id])!) };
  }));

  on("POST", "/admin/invoices/:id/issue", admin((ctx) => {
    const row = get<Record<string, unknown>>(`SELECT * FROM invoices WHERE id = ?`, [Number(ctx.params.id)]);
    if (!row) throw new HttpError(404, "invoice not found", "not_found");
    if (row.status !== "draft") throw new HttpError(409, `invoice is ${row.status}`, "bad_state");
    run(`UPDATE invoices SET status='issued', issued_at=? WHERE id=?`, [nowIso(), row.id]);
    return { invoice: invoiceOut(get(`SELECT * FROM invoices WHERE id = ?`, [row.id])!) };
  }));

  // ── reconciliation (COM-024/FIN-009/FIN-010) ──────────────────────
  on("GET", "/admin/reconciliation", admin(async (ctx) => {
    const last = get<Record<string, unknown>>(`SELECT * FROM recon_runs ORDER BY id DESC LIMIT 1`);
    const bankLines = all(`SELECT * FROM bank_lines ORDER BY id DESC LIMIT 100`);
    return {
      lastRun: last
        ? {
            id: last.id as number,
            ranAt: toIsoOut(last.ran_at as string),
            paymentsChecked: last.payments_checked as number,
            matched: last.matched as number,
            exceptions: safeJsonParse(last.exceptions as string, []),
          }
        : null,
      bankLines: bankLines.map((r) => ({
        id: r.id as number,
        statementDate: (r.statement_date as string | null) ?? null,
        amountCents: r.amount_cents as number,
        direction: r.direction as string,
        memo: (r.memo as string | null) ?? null,
        matchedRef: (r.matched_ref as string | null) ?? null,
        matchedType: (r.matched_type as string | null) ?? null,
      })),
    };
  }));

  on("POST", "/admin/reconciliation/run", admin(async () => runReconciliation()));

  // ── bank lines (FIN-010 bank reconciliation lite) ─────────────────
  // 12-b additive: standalone GET so the BFF /admin/bank-lines route can
  // proxy a plain list (the reconciliation payload keeps its own copy).
  on("GET", "/admin/bank-lines", admin(() => {
    const rows = all(`SELECT * FROM bank_lines ORDER BY id DESC LIMIT 200`);
    return {
      bankLines: rows.map((r) => ({
        id: r.id as number,
        statementDate: (r.statement_date as string | null) ?? null,
        amountCents: r.amount_cents as number,
        direction: r.direction as string,
        memo: (r.memo as string | null) ?? null,
        matchedRef: (r.matched_ref as string | null) ?? null,
        matchedType: (r.matched_type as string | null) ?? null,
      })),
    };
  }));

  on("POST", "/admin/bank-lines", admin((ctx) => {
    const lines = bodyArr(ctx, "lines");
    let imported = 0;
    let autoMatched = 0;
    for (const raw of lines) {
      if (typeof raw !== "object" || raw == null) continue;
      const l = raw as Record<string, unknown>;
      const amountCents = Number(l.amountCents) > 0 ? Math.round(Number(l.amountCents)) : (parseAmountCents(l.amount) ?? 0);
      if (!amountCents) continue;
      const direction = String(l.direction ?? "in") === "out" ? "out" : "in";
      const memo = String(l.memo ?? "").slice(0, 200);
      const statementDate = String(l.statementDate ?? "").slice(0, 20) || null;
      // auto-match: unique payment or payout reference inside the memo
      let matchedRef: string | null = null;
      let matchedType: string | null = null;
      const refGuess = memo.match(/(TS-ORDR\d+-\d+|[A-Z]{2}-[\d-]+[A-Z0-9]*)/);
      if (refGuess) {
        const ref = refGuess[1];
        const payment = scalar(`SELECT COUNT(*) AS n FROM receipts WHERE payload LIKE ?`, [`%"${ref}"%`]);
        const payout = scalar(`SELECT COUNT(*) AS n FROM payouts WHERE reference = ?`, [ref]);
        if (payment === 1 && payout === 0) {
          matchedRef = ref;
          matchedType = "payment";
        } else if (payout === 1) {
          matchedRef = ref;
          matchedType = "payout";
        }
      }
      insert(
        `INSERT INTO bank_lines(statement_date, amount_cents, direction, memo, matched_ref, matched_type)
         VALUES(?, ?, ?, ?, ?, ?)`,
        [statementDate, amountCents, direction, memo, matchedRef, matchedType],
      );
      imported += 1;
      if (matchedRef) autoMatched += 1;
    }
    return { ok: true, imported, autoMatched };
  }));

  on("POST", "/admin/bank-lines/:id/match", admin((ctx) => {
    const id = Number(ctx.params.id);
    const line = get(`SELECT * FROM bank_lines WHERE id = ?`, [id]);
    if (!line) throw new HttpError(404, "bank line not found", "not_found");
    const ref = bodyStr(ctx, "ref", { required: true, max: 60 });
    const refType = bodyStr(ctx, "refType", { max: 20 }) || "payment";
    const payment = scalar(`SELECT COUNT(*) AS n FROM receipts WHERE payload LIKE ?`, [`%"${ref}"%`]);
    const payout = scalar(`SELECT COUNT(*) AS n FROM payouts WHERE reference = ?`, [ref]);
    if (refType === "payment" && payment < 1) throw new HttpError(400, "no payment found for that reference", "no_match");
    if (refType === "payout" && payout < 1) throw new HttpError(400, "no payout found for that reference", "no_match");
    run(`UPDATE bank_lines SET matched_ref=?, matched_type=? WHERE id=?`, [ref, refType, id]);
    return { ok: true };
  }));

  // ── tax packs (COM-002/FIN-012/GOV-003) ───────────────────────────
  on("GET", "/admin/tax", admin((ctx) => {
    const period = ctx.url.searchParams.get("period") ?? new Date().toISOString().slice(0, 7);
    const format = ctx.url.searchParams.get("format");
    const range = monthRange(period);
    if (!range) throw new HttpError(400, "period must be YYYY-MM", "bad_period");
    const entries = all(
      `SELECT * FROM ledger_entries
       WHERE account = 'vat_liability' AND ts >= ? AND ts <= datetime(?, '+1 day')
       ORDER BY id DESC LIMIT 500`,
      [range.start, range.end],
    );
    const out = entries.map(ledgerOut);
    const vatOutput = out.filter((e) => e.direction === "credit").reduce((n, e) => n + (e.amountCents as number), 0);
    const vatReversals = out.filter((e) => e.direction === "debit").reduce((n, e) => n + (e.amountCents as number), 0);
    const revenueRows = all(
      `SELECT * FROM ledger_entries
       WHERE account = 'platform_revenue' AND ts >= ? AND ts <= datetime(?, '+1 day')`,
      [range.start, range.end],
    );
    const feeRevenue =
      revenueRows.filter((r) => r.direction === "credit").reduce((n, r) => n + (r.amount_cents as number), 0) -
      revenueRows.filter((r) => r.direction === "debit").reduce((n, r) => n + (r.amount_cents as number), 0);

    if (format === "csv") {
      const header = "date,tx_type,order_ref,direction,amount_cents,amount_usd,memo";
      const lines = out.map((e) =>
        [
          String(e.ts),
          String(e.txType),
          String(e.orderRef ?? ""),
          String(e.direction),
          String(e.amountCents),
          String(e.amount),
          escapeCsv(e.memo),
        ].join(","),
      );
      const csv = [
        `# Tengasell VAT output ledger — period ${period}`,
        `# fee_revenue_cents,${feeRevenue}`,
        `# vat_output_cents,${vatOutput - vatReversals}`,
        header,
        ...lines,
      ].join("\n");
      // 12-b fix: return the RAW CSV string — jsonOut() passes text/csv
      // bodies through String(), so the previous {csv,...} object rendered
      // as "[object Object]". The BFF attaches Content-Disposition.
      return csv;
    }
    return {
      period,
      feeRevenueCents: feeRevenue,
      vatOutputCents: vatOutput,
      vatReversalsCents: vatReversals,
      vatDueCents: vatOutput - vatReversals,
      entries: out,
    };
  }));

  // ── stats + seed ──────────────────────────────────────────────────
  on("GET", "/admin/stats", admin(() => financeStats()));
  on("POST", "/admin/seed-demo", admin(async () => ({ ok: true, summary: await seedDemo() })));
}

// ── invoice totals (fee = FVF on released orders + featured, net of
// proportional fee reversals; vat = VAT on those fees) ──────────────────
export function invoiceTotalsFor(username: string, start: string, end: string): { feeCents: number; vatCents: number } {
  const releases = all<{ fee_cents: number; vat_cents: number }>(
    `SELECT fee_cents, vat_cents FROM order_finance
     WHERE seller = ? AND released_at IS NOT NULL
       AND released_at >= ? AND released_at <= datetime(?, '+1 day')`,
    [username, start, end],
  );
  let fee = releases.reduce((n, r) => n + r.fee_cents, 0);
  let vat = releases.reduce((n, r) => n + r.vat_cents, 0);
  // featured listing fees charged in the period (revenue legs only)
  const featured = all<{ amount_cents: number; account: string; direction: string }>(
    `SELECT amount_cents, account, direction FROM ledger_entries
     WHERE tx_type = 'featured.fee' AND actor = ? AND ts >= ? AND ts <= datetime(?, '+1 day')`,
    [username, start, end],
  );
  for (const row of featured) {
    if (row.account === "platform_revenue" && row.direction === "credit") fee += row.amount_cents;
    if (row.account === "vat_liability" && row.direction === "credit") vat += row.amount_cents;
  }
  // proportional fee/VAT reversals on this seller's orders in the period
  const reversals = all<{ amount_cents: number; account: string }>(
    `SELECT e.amount_cents, e.account FROM ledger_entries e
     JOIN order_finance f ON f.order_id = CAST(e.order_ref AS INTEGER)
     WHERE e.account IN('platform_revenue','vat_liability') AND e.direction = 'debit'
       AND e.tx_type IN('refund.clawback','chargeback.resolve')
       AND f.seller = ? AND e.ts >= ? AND e.ts <= datetime(?, '+1 day')`,
    [username, start, end],
  );
  for (const row of reversals) {
    if (row.account === "platform_revenue") fee -= row.amount_cents;
    if (row.account === "vat_liability") vat -= row.amount_cents;
  }
  return { feeCents: Math.max(0, fee), vatCents: Math.max(0, vat) };
}

// ── the reconciliation tie-out (COM-024) ────────────────────────────────
export async function runReconciliation(): Promise<Record<string, unknown>> {
  const exceptions: Record<string, unknown>[] = [];
  let paymentsChecked = 0;
  let matched = 0;
  try {
    const [orders, payments] = await Promise.all([tbListOrders(200), tbListPayments(500)]);
    const finRows = all(`SELECT order_id, buyer, status FROM order_finance`);
    const finByOrder = new Map(finRows.map((r) => [r.order_id, r]));
    const settledPayments = payments.filter((p: any) => String(p.status) === "settled");
    paymentsChecked = settledPayments.length;
    for (const p of settledPayments) {
      const orderId = Number(p.order_id);
      const fin = finByOrder.get(orderId);
      const receipt = get(`SELECT id FROM receipts WHERE order_id = ?`, [orderId]);
      if (!fin) {
        exceptions.push({ kind: "payment_without_escrow", orderId, paymentId: p.id, detail: `settled payment US$${p.amount} with no escrow record` });
        continue;
      }
      if (!receipt) {
        exceptions.push({ kind: "payment_without_receipt", orderId, paymentId: p.id });
        continue;
      }
      matched += 1;
    }
    for (const o of orders) {
      const fin = finByOrder.get(Number(o.id));
      const paid = ["paid", "shipped", "delivered", "completed"].includes(String(o.status));
      if (paid && !fin) {
        exceptions.push({ kind: "paid_order_without_escrow", orderId: o.id, detail: `TrailBase status ${o.status}` });
      }
      if (fin && !paid) {
        exceptions.push({ kind: "escrow_without_paid_order", orderId: o.id, detail: `TrailBase status ${o.status} but finance ${fin.status}` });
      }
    }
  } catch (err) {
    tbResetToken();
    exceptions.push({ kind: "trailbase_unreachable", detail: String((err as Error).message) });
  }
  const id = insert(
    `INSERT INTO recon_runs(payments_checked, matched, exceptions) VALUES(?, ?, ?)`,
    [paymentsChecked, matched, JSON.stringify(exceptions)],
  );
  const row = get(`SELECT * FROM recon_runs WHERE id = ?`, [id])!;
  return {
    run: {
      id,
      ranAt: toIsoOut(row.ran_at as string),
      paymentsChecked,
      matched,
      exceptions,
    },
    ok: exceptions.length === 0,
  };
}
