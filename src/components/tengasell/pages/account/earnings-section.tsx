"use client";

// Tengasell — Earnings section (My Tengasell → Earnings). Task 12-b.
// The seller money surface backed by /api/finance/me/* (finance-service
// :3006 through the BFF): balance cards (available / escrow / withheld),
// payout request dialog with payout KYC (ID number REQUIRED — the service
// enforces it), payout history with status chips, the order-by-order
// earnings breakdown (price · fee · VAT · net) and monthly fee invoices.
//
// MONEY LAW: every value is integer cents server-side; display is USD via
// formatUSD(cents / 100). Long lists scroll inside max-h-96 ts-scrollbar.

import { useState } from "react";
import {
  BadgeCheck,
  CircleDollarSign,
  Clock3,
  FileText,
  Lock,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatDateTime, formatUSD } from "@/lib/tengasell/format";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { CurrentUser } from "@/lib/tengasell/types";

// ── contract types (finance-service routes/me.ts serializers) ──────────

export interface FinancePayout {
  id: number;
  username: string;
  amountCents: number;
  method: string;
  destination: string;
  status: string;
  requestedAt: string;
  approvedBy?: string | null;
  paidAt?: string | null;
  reference?: string | null;
  reversalReason?: string | null;
}

interface Overview {
  currency: string;
  availableCents: number;
  pendingCents: number;
  withheldCents: number;
  escrowCount: number;
  lifetimePaidOutCents: number;
  nextPayout: FinancePayout | null;
  payoutMinCents: number;
  feePct: number;
  vatPct: number;
}

export interface OrderFinance {
  orderId: number;
  buyer: string;
  seller: string;
  itemPriceCents: number;
  shippingCents: number;
  escrowCents: number;
  feeCents: number;
  vatCents: number;
  netToSellerCents: number;
  refundedCents: number;
  status: string;
  disputeWindowEnds: string | null;
  releasedAt: string | null;
  createdAt: string;
}

interface EarningsPayload {
  items: OrderFinance[];
  totals: {
    orders: number;
    grossCents: number;
    feesCents: number;
    vatCents: number;
    netCents: number;
    releasedCents: number;
    holdingCents: number;
    refundedCents: number;
  };
  featuredFeesCents: number;
}

export interface FinanceInvoice {
  id: number;
  number: string;
  username: string;
  periodStart: string;
  periodEnd: string;
  feeCents: number;
  vatCents: number;
  totalCents: number;
  status: string;
  issuedAt: string | null;
}

// ── client helper — RELATIVE fetches with the TrailBase token ────────

export async function financeFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/finance${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) {
    throw new Error(data?.error ?? `Request failed (${res.status}).`);
  }
  return data;
}

// ── status chips (shared money-state vocabulary, teal/gold law) ────────

export type MoneyTone = "ok" | "warn" | "muted" | "danger" | "teal" | "gold";

const MONEY_TONES: Record<MoneyTone, string> = {
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  muted: "bg-muted text-muted-foreground border-border",
  danger: "bg-danger/10 text-danger border-danger/30",
  teal: "bg-teal-tint text-teal-deep border-teal/30",
  gold: "bg-gold-soft text-gold-on border-gold/40",
};

export function MoneyChip({
  tone,
  children,
  label,
}: {
  tone: MoneyTone;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <span
      aria-label={label}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-bold whitespace-nowrap ${MONEY_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function moneyStatusTone(status: string): MoneyTone {
  switch (status) {
    case "paid":
    case "processed":
    case "released":
    case "ok":
      return "ok";
    case "requested":
    case "pending_approval":
    case "holding":
      return "warn";
    case "approved":
    case "issued":
      return "teal";
    case "partial":
      return "gold";
    case "rejected":
      return "danger";
    default:
      return "muted";
  }
}

export function useMoneyStatus() {
  const { t } = useI18n();
  return (status: string) => t(`finance.status.${status}`);
}

// ── the section ───────────────────────────────────────────────────────

export function EarningsSection({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const token = user.token;
  const statusLabel = useMoneyStatus();

  const overview = useResource<Overview>(
    async () => financeFetch<Overview>(token, "/me/overview"),
    [token],
  );
  const payouts = useResource<FinancePayout[]>(
    async () => {
      const data = await financeFetch<{ payouts?: FinancePayout[] }>(token, "/me/payouts");
      return data.payouts ?? [];
    },
    [token],
  );
  const earnings = useResource<EarningsPayload>(
    async () => financeFetch<EarningsPayload>(token, "/me/earnings"),
    [token],
  );
  const invoices = useResource<FinanceInvoice[]>(
    async () => {
      const data = await financeFetch<{ invoices?: FinanceInvoice[] }>(token, "/me/invoices");
      return data.invoices ?? [];
    },
    [token],
  );

  const [requestOpen, setRequestOpen] = useState(false);
  const ov = overview.data;
  const reloadAll = () => {
    overview.reload();
    payouts.reload();
  };

  return (
    <section aria-labelledby="earnings-heading" className="space-y-6">
      <header className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="earnings-heading" className="text-sectionTitle text-foreground">
            {t("my.earnings.title")}
          </h2>
          <p className="text-caption text-muted-foreground mt-0.5">
            {t("my.earnings.sub")}
          </p>
        </div>
        <Button
          onClick={() => setRequestOpen(true)}
          disabled={!ov || ov.availableCents <= 0}
          className="min-h-11"
        >
          <Wallet className="size-4" aria-hidden="true" />
          {t("finance.requestPayout")}
        </Button>
      </header>

      {/* balance cards */}
      {overview.loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-raised p-4 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : overview.error ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : ov ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <BalanceCard
              icon={<CircleDollarSign className="size-5 text-teal" aria-hidden="true" />}
              label={t("finance.available")}
              cents={ov.availableCents}
              note={t("finance.payoutMin").replace("{n}", formatUSD(ov.payoutMinCents / 100))}
            />
            <BalanceCard
              icon={<Clock3 className="size-5 text-gold-deep" aria-hidden="true" />}
              label={t("finance.pendingEscrow")}
              cents={ov.pendingCents}
              note={t("finance.escrowNote").replace("{n}", String(ov.escrowCount))}
              gold
            />
            <BalanceCard
              icon={<Lock className="size-5 text-muted-foreground" aria-hidden="true" />}
              label={t("finance.withheld")}
              cents={ov.withheldCents}
              note={`${t("finance.lifetimePaid")}: ${formatUSD(ov.lifetimePaidOutCents / 100)}`}
            />
          </div>

          <p className="text-caption text-muted-foreground">
            {t("finance.feeNote")
              .replace("{fee}", String(Math.round(ov.feePct * 100)))
              .replace("{vat}", String(Math.round(ov.vatPct * 100)))}
          </p>
        </>
      ) : null}

      {/* payout history */}
      <div className="rounded-card border border-border bg-raised">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.payoutsHistory")}</h3>
          {ov?.nextPayout ? (
            <MoneyChip tone="warn" label={t("finance.nextPayout")}>
              {t("finance.nextPayout")}: {formatUSD(ov.nextPayout.amountCents / 100)}
            </MoneyChip>
          ) : null}
        </div>
        {payouts.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : payouts.error ? (
          <div className="p-4">
            <ErrorState message={payouts.error} onRetry={payouts.reload} />
          </div>
        ) : (payouts.data ?? []).length === 0 ? (
          <div className="p-4">
            <p className="text-caption text-muted-foreground">{t("finance.noPayouts")}</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto ts-scrollbar divide-y divide-border/60">
            {(payouts.data ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                <span className="ts-numeric text-label font-bold text-foreground">
                  {formatUSD(p.amountCents / 100)}
                </span>
                <span className="text-caption text-muted-foreground">
                  {p.method === "ecocash" ? t("finance.method.ecocash") : t("finance.method.bank")}{" "}
                  · {p.destination}
                </span>
                <span className="ts-numeric text-caption text-muted-foreground">
                  {formatDateTime(p.requestedAt)}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {p.reference ? (
                    <span className="ts-numeric text-caption text-muted-foreground">
                      {t("finance.payouts.reference")}: {p.reference}
                    </span>
                  ) : null}
                  <MoneyChip tone={moneyStatusTone(p.status)}>
                    {statusLabel(p.status)}
                  </MoneyChip>
                </span>
                {p.reversalReason ? (
                  <p className="w-full text-caption text-muted-foreground">
                    {t("finance.payouts.reason")}: {p.reversalReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* earnings breakdown */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.earningsTitle")}</h3>
        </div>
        {earnings.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : earnings.error ? (
          <div className="p-4">
            <ErrorState message={earnings.error} onRetry={earnings.reload} />
          </div>
        ) : (earnings.data?.items ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<CircleDollarSign className="size-8" />}
              title={t("finance.earningsEmpty")}
              body={t("finance.earningsEmptyBody")}
            />
          </div>
        ) : earnings.data ? (
          <>
            <div className="max-h-96 overflow-y-auto ts-scrollbar">
              <table className="w-full text-caption">
                <thead className="sticky top-0 bg-raised">
                  <tr className="border-b border-border/70 text-left text-muted-foreground">
                    <th scope="col" className="px-4 py-2.5 font-bold">{t("finance.col.order")}</th>
                    <th scope="col" className="px-2 py-2.5 font-bold text-right">{t("finance.col.price")}</th>
                    <th scope="col" className="px-2 py-2.5 font-bold text-right">{t("finance.col.fee")}</th>
                    <th scope="col" className="px-2 py-2.5 font-bold text-right">{t("finance.col.vat")}</th>
                    <th scope="col" className="px-2 py-2.5 font-bold text-right">{t("finance.col.net")}</th>
                    <th scope="col" className="px-4 py-2.5 font-bold text-right">{t("finance.col.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.data.items.map((it) => (
                    <tr key={it.orderId} className="border-b border-border/40">
                      <td className="px-4 py-2.5">
                        <a
                          href={`#/orders/${it.orderId}`}
                          className="ts-numeric font-bold text-teal hover:underline"
                        >
                          #{it.orderId}
                        </a>
                        <span className="block text-muted-foreground">@{it.buyer}</span>
                      </td>
                      <td className="ts-numeric px-2 py-2.5 text-right">
                        {formatUSD((it.itemPriceCents + it.shippingCents) / 100)}
                        {it.refundedCents > 0 ? (
                          <span className="block text-muted-foreground">
                            −{formatUSD(it.refundedCents / 100)}
                          </span>
                        ) : null}
                      </td>
                      <td className="ts-numeric px-2 py-2.5 text-right text-muted-foreground">
                        {formatUSD(it.feeCents / 100)}
                      </td>
                      <td className="ts-numeric px-2 py-2.5 text-right text-muted-foreground">
                        {formatUSD(it.vatCents / 100)}
                      </td>
                      <td className="ts-numeric px-2 py-2.5 text-right font-bold text-foreground">
                        {formatUSD(it.netToSellerCents / 100)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <MoneyChip tone={moneyStatusTone(it.status)}>
                          {statusLabel(it.status)}
                        </MoneyChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border/70 px-4 py-3 text-caption text-muted-foreground">
              <span className="ts-numeric">{t("finance.totals")} ({earnings.data.totals.orders}): {formatUSD(earnings.data.totals.grossCents / 100)}</span>
              <span className="ts-numeric">{t("finance.col.fee")}: {formatUSD(earnings.data.totals.feesCents / 100)}</span>
              <span className="ts-numeric">{t("finance.col.vat")}: {formatUSD(earnings.data.totals.vatCents / 100)}</span>
              <span className="ts-numeric font-bold text-foreground">{t("finance.col.net")}: {formatUSD(earnings.data.totals.netCents / 100)}</span>
              {earnings.data.featuredFeesCents > 0 ? (
                <span className="ts-numeric">{t("finance.featuredFees")}: {formatUSD(earnings.data.featuredFeesCents / 100)}</span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {/* fee invoices */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.invoicesTitle")}</h3>
        </div>
        {invoices.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : invoices.error ? (
          <div className="p-4">
            <ErrorState message={invoices.error} onRetry={invoices.reload} />
          </div>
        ) : (invoices.data ?? []).length === 0 ? (
          <div className="p-4">
            <p className="text-caption text-muted-foreground">{t("finance.invoiceEmpty")}</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto ts-scrollbar divide-y divide-border/60">
            {(invoices.data ?? []).map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3"
              >
                <FileText className="size-4 text-teal shrink-0" aria-hidden="true" />
                <span className="ts-numeric text-label font-bold text-foreground">{inv.number}</span>
                <span className="ts-numeric text-caption text-muted-foreground">
                  {String(inv.periodStart).slice(0, 10)} → {String(inv.periodEnd).slice(0, 10)}
                </span>
                <span className="ts-numeric text-caption text-muted-foreground ml-auto">
                  {t("finance.col.fee")} {formatUSD(inv.feeCents / 100)} + {t("finance.col.vat")}{" "}
                  {formatUSD(inv.vatCents / 100)} ={" "}
                  <span className="font-bold text-foreground">{formatUSD(inv.totalCents / 100)}</span>
                </span>
                <MoneyChip tone={moneyStatusTone(inv.status)}>{statusLabel(inv.status)}</MoneyChip>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PayoutRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        token={token}
        overview={ov ?? null}
        onDone={reloadAll}
      />
    </section>
  );
}

// ── balance card ──────────────────────────────────────────────────────

function BalanceCard({
  icon,
  label,
  cents,
  note,
  gold,
}: {
  icon: React.ReactNode;
  label: string;
  cents: number;
  note?: string;
  gold?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-raised p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-caption font-bold text-muted-foreground">{label}</p>
      </div>
      <p
        className={cn(
          "ts-numeric mt-2 text-headline font-bold",
          gold ? "text-gold-deep" : "text-foreground",
        )}
      >
        {formatUSD(cents / 100)}
      </p>
      {note ? <p className="mt-1 text-caption text-muted-foreground">{note}</p> : null}
    </div>
  );
}

// ── payout request dialog ─────────────────────────────────────────────

function PayoutRequestDialog({
  open,
  onOpenChange,
  token,
  overview,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  overview: Overview | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("ecocash");
  const [destination, setDestination] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minUsd = (overview?.payoutMinCents ?? 1000) / 100;
  const maxUsd = (overview?.availableCents ?? 0) / 100;

  const reset = () => {
    setAmount("");
    setMethod("ecocash");
    setDestination("");
    setIdNumber("");
    setTaxNumber("");
    setNote("");
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      setError(t("finance.payoutErrors.amount"));
      return;
    }
    if (usd < minUsd) {
      setError(t("finance.payoutMin").replace("{n}", formatUSD(minUsd)));
      return;
    }
    if (usd > maxUsd) {
      setError(t("finance.payoutErrors.exceeds"));
      return;
    }
    if (!destination.trim()) {
      setError(t("finance.payoutErrors.destination"));
      return;
    }
    if (!idNumber.trim()) {
      setError(t("finance.payoutErrors.idNumber"));
      return;
    }
    setBusy(true);
    try {
      const data = await financeFetch<{ payout?: { id: number } }>(token, "/me/payouts", {
        method: "POST",
        body: JSON.stringify({
          amountCents: Math.round(usd * 100),
          method,
          destination: destination.trim(),
          idNumber: idNumber.trim(),
          ...(taxNumber.trim() ? { taxNumber: taxNumber.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      toast({
        title: t("finance.payoutRequested"),
        description: `#${data.payout?.id ?? ""} · ${formatUSD(usd)}`,
      });
      reset();
      onOpenChange(false);
      onDone();
    } catch (err) {
      // surface the SERVICE validation messages (below_min, insufficient…)
      setError(err instanceof Error ? err.message : t("finance.payoutErrors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.requestPayout")}</DialogTitle>
          <DialogDescription>
            {t("finance.payoutDialogSub")
              .replace("{max}", formatUSD(maxUsd))
              .replace("{min}", formatUSD(minUsd))}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="payout-amount">{t("finance.payoutAmount")}</Label>
            <Input
              id="payout-amount"
              inputMode="decimal"
              className="ts-numeric min-h-11"
              placeholder={formatUSD(maxUsd)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="payout-amount-note"
            />
            <p id="payout-amount-note" className="text-caption text-muted-foreground">
              {t("finance.payoutRange")
                .replace("{min}", formatUSD(minUsd))
                .replace("{max}", formatUSD(maxUsd))}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payout-method">{t("finance.payoutMethod")}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="payout-method" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ecocash">{t("finance.method.ecocash")}</SelectItem>
                <SelectItem value="bank">{t("finance.method.bank")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payout-destination">{t("finance.payoutDestination")}</Label>
            <Input
              id="payout-destination"
              className="min-h-11"
              placeholder={method === "ecocash" ? "+263 77 000 0000" : "CBZ ••••1234"}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payout-id">
              {t("finance.payoutIdNumber")} <span className="text-danger">*</span>
            </Label>
            <Input
              id="payout-id"
              className="min-h-11"
              placeholder="63-1234567X12"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              aria-describedby="payout-id-note"
            />
            <p id="payout-id-note" className="text-caption text-muted-foreground">
              {t("finance.payoutIdHint")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payout-tax">{t("finance.payoutTaxNumber")}</Label>
              <Input
                id="payout-tax"
                className="min-h-11"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-note">{t("finance.payoutNote")}</Label>
              <Input
                id="payout-note"
                className="min-h-11"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-caption font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="min-h-11" onClick={() => onOpenChange(false)}>
            {t("finance.cancel")}
          </Button>
          <Button className="min-h-11" onClick={submit} disabled={busy}>
            {busy ? t("finance.sending") : t("finance.payoutSubmit")}
            {!busy ? <BadgeCheck className="size-4" aria-hidden="true" /> : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
