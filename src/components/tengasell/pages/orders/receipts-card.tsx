"use client";

// Tengasell — Receipts card (order detail). Task 12-b.
// Buyer view: the official payment receipt (amount · method · reference ·
// paid-at, COM-020) + "Print receipt" (print-only block via a scoped
// visibility rule — no screenshots). Seller view: the fee/net breakdown
// (gross − FVF − VAT = net) + escrow/release state. When the order has no
// finance record yet (unpaid), the card composes what it can from the
// order + payments props and says so — no invented numbers.

import { ReceiptText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatDateTime, formatUSD, paymentMethodLabel } from "@/lib/tengasell/format";
import {
  financeFetch,
  MoneyChip,
  moneyStatusTone,
  useMoneyStatus,
  type OrderFinance,
} from "../account/earnings-section";
import type { Order, Payment } from "@/lib/tengasell/types";

interface ReceiptPayload {
  receipt: {
    orderId: number;
    buyer: string;
    amountCents: number;
    method: string | null;
    paidAt: string | null;
    payload: {
      reference?: string | null;
      seller?: string;
      itemPriceCents?: number;
      shippingCents?: number;
      grossCents?: number;
    };
  } | null;
  finance: OrderFinance | null;
}

export function ReceiptsCard({
  order,
  payments,
}: {
  order: Order;
  payments: Payment[];
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const statusLabel = useMoneyStatus();
  const isBuyer =
    !!user && (order.buyer_user === user.id || order.buyer_username === user.username);
  const isSeller =
    !!user && (order.seller_user === user.id || order.seller_username === user.username);

  const res = useResource<ReceiptPayload | null>(
    async () => {
      try {
        return await financeFetch<ReceiptPayload>(
          user?.token ?? "",
          `/me/receipt/${order.id}`,
        );
      } catch (err) {
        // 404 "no finance record" is a normal state for unpaid/other orders
        const msg = err instanceof Error ? err.message : "";
        if (/no finance record|not found/i.test(msg)) return null;
        throw err;
      }
    },
    [user?.token, order.id],
  );

  const receipt = res.data?.receipt ?? null;
  const finance = res.data?.finance ?? null;
  const settled = payments.find((p) => p.status === "settled") ?? payments[0] ?? null;

  // composed fallback (order not yet in the finance system)
  const composedAmountCents = receipt
    ? receipt.amountCents
    : settled
      ? Math.round((settled.amount ?? order.final_price) * 100)
      : Math.round(order.final_price * 100);
  const composedMethod = receipt?.method ?? settled?.method ?? null;
  const composedRef =
    receipt?.payload?.reference ?? settled?.reference ?? null;
  const composedPaidAt = receipt?.paidAt ?? order.paid_at ?? settled?.created_at ?? null;

  const itemPriceCents = finance
    ? finance.itemPriceCents
    : Math.round(order.final_price * 100);
  const shippingCents = finance ? finance.shippingCents : 0;
  const grossCents = finance
    ? finance.itemPriceCents + finance.shippingCents
    : composedAmountCents;

  const print = () => {
    window.print();
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        {/* print-only receipt block (visible ONLY when printing) */}
        <style
          // Scoped print rule: hide the page, show just the receipt block.
          dangerouslySetInnerHTML={{
            __html: `@media print { body * { visibility: hidden !important; } #ts-receipt-print, #ts-receipt-print * { visibility: visible !important; } #ts-receipt-print { position: absolute; left: 0; top: 0; width: 100%; } }`,
          }}
        />
        <div id="ts-receipt-print" className="hidden print:block" aria-hidden="true">
          <p className="text-headline font-bold">Tengasell — {t("finance.receipts.title")}</p>
          <p className="ts-numeric text-caption">
            {t("finance.col.order")} #{order.id} · {order.auction_title}
          </p>
          <p className="ts-numeric text-caption">
            {order.buyer_username} → {order.seller_username}
          </p>
          <table className="mt-2 w-full text-caption">
            <tbody>
              <tr>
                <td className="py-1">{t("finance.receipt.itemPrice")}</td>
                <td className="ts-numeric py-1 text-right">{formatUSD(itemPriceCents / 100)}</td>
              </tr>
              <tr>
                <td className="py-1">{t("finance.col.shipping")}</td>
                <td className="ts-numeric py-1 text-right">{formatUSD(shippingCents / 100)}</td>
              </tr>
              <tr>
                <td className="py-1 font-bold">{t("finance.receipt.totalPaid")}</td>
                <td className="ts-numeric py-1 text-right font-bold">
                  {formatUSD(grossCents / 100)}
                </td>
              </tr>
              <tr>
                <td className="py-1">{t("finance.payoutMethod")}</td>
                <td className="py-1 text-right">
                  {composedMethod ? paymentMethodLabel(composedMethod) : "—"}
                </td>
              </tr>
              <tr>
                <td className="py-1">{t("finance.payouts.reference")}</td>
                <td className="ts-numeric py-1 text-right">{composedRef ?? "—"}</td>
              </tr>
              <tr>
                <td className="py-1">{t("finance.receipt.paidAt")}</td>
                <td className="ts-numeric py-1 text-right">
                  {composedPaidAt ? formatDateTime(composedPaidAt) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-caption text-muted-foreground">
            tengamail.co.zw · {t("finance.receipt.thanks")}
          </p>
        </div>

        <p className="flex items-center gap-2 text-label font-bold text-foreground">
          <ReceiptText className="size-4 text-teal" aria-hidden="true" />
          {t("finance.receipts.title")}
        </p>

        {res.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : res.error ? (
          <p role="alert" className="text-caption text-danger">
            {res.error}
          </p>
        ) : (
          <div className="space-y-2.5">
            {/* buyer-facing receipt */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="ts-numeric text-label font-bold text-foreground">
                {t("finance.receipt.totalPaid")}: {formatUSD(grossCents / 100)}
              </span>
              <span className="text-caption text-muted-foreground">
                {composedMethod ? paymentMethodLabel(composedMethod) : t("finance.receipt.notPaid")}
              </span>
              {composedRef ? (
                <span className="ts-numeric text-caption text-muted-foreground">
                  {t("finance.payouts.reference")}: {composedRef}
                </span>
              ) : null}
              {composedPaidAt ? (
                <span className="ts-numeric text-caption text-muted-foreground">
                  {formatDateTime(composedPaidAt)}
                </span>
              ) : null}
            </div>

            {/* seller fee/net breakdown (fee data only exists in finance) */}
            {isSeller && finance ? (
              <div className="rounded-control border border-border bg-section p-3 text-caption">
                <p className="font-bold text-foreground mb-1.5">
                  {t("finance.receipt.sellerBreakdown")}
                </p>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  <span className="ts-numeric flex justify-between">
                    <span className="text-muted-foreground">{t("finance.receipt.itemPrice")}</span>
                    <span>{formatUSD(finance.itemPriceCents / 100)}</span>
                  </span>
                  <span className="ts-numeric flex justify-between">
                    <span className="text-muted-foreground">{t("finance.col.shipping")}</span>
                    <span>{formatUSD(finance.shippingCents / 100)}</span>
                  </span>
                  <span className="ts-numeric flex justify-between">
                    <span className="text-muted-foreground">
                      {t("finance.col.fee")} ({Math.round(0.08 * 100)}%)
                    </span>
                    <span>−{formatUSD(finance.feeCents / 100)}</span>
                  </span>
                  <span className="ts-numeric flex justify-between">
                    <span className="text-muted-foreground">{t("finance.col.vat")}</span>
                    <span>−{formatUSD(finance.vatCents / 100)}</span>
                  </span>
                </div>
                <span className="ts-numeric mt-1.5 flex justify-between border-t border-border/70 pt-1.5 text-label font-bold text-foreground">
                  <span>{t("finance.receipt.netToYou")}</span>
                  <span>{formatUSD(finance.netToSellerCents / 100)}</span>
                </span>
              </div>
            ) : null}

            {/* escrow / release state */}
            {finance ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <MoneyChip tone={moneyStatusTone(finance.status)}>
                  {statusLabel(finance.status)}
                </MoneyChip>
                <span className="text-caption text-muted-foreground">
                  {finance.status === "holding" || finance.status === "partial"
                    ? t("finance.receipt.escrowHeld")
                    : finance.status === "released"
                      ? t("finance.receipt.releasedNote")
                      : t("finance.receipt.refundedNote")}
                </span>
                {finance.disputeWindowEnds ? (
                  <span className="ts-numeric text-caption text-muted-foreground">
                    {t("finance.receipt.window")}: {formatDateTime(finance.disputeWindowEnds)}
                  </span>
                ) : null}
              </div>
            ) : !order.paid_at ? (
              <p className="text-caption text-muted-foreground">{t("finance.receipt.pendingNote")}</p>
            ) : (
              <p className="text-caption text-muted-foreground">
                {t("finance.receipt.noFinanceRecord")}
              </p>
            )}

            {order.paid_at ? (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={print}
                aria-label={t("finance.receipt.print")}
              >
                <Printer className="size-4" aria-hidden="true" />
                {t("finance.receipt.print")}
              </Button>
            ) : null}

            {!isBuyer && !isSeller ? (
              <p className="text-caption text-muted-foreground">
                {t("finance.receipt.guestNote")}
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
