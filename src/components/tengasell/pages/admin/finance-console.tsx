"use client";

// Tengasell — Finance console (admin, #/admin/{ledger|payouts|refunds|
// invoices|reconciliation|tax}). Task 12-b — the money control plane over
// the finance-service :3006 (double-entry ledger · escrow · payouts with
// dual approval + sanctions confirm · refunds + credit notes + chargebacks
// · invoices · bank reconciliation · VAT tax packs).
//
// Conventions (mirror comms-console): internal pill sub-nav (44px), tables
// inside overflow-x-auto + max-h-96 ts-scrollbar lists, skeletons/empty/
// error states everywhere, teal/gold law, RELATIVE BFF fetches only.

import { useState } from "react";
import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  ChevronDown,
  Database,
  Download,
  FileText,
  Landmark,
  ListChecks,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { useLinkProps } from "@/lib/tengasell/router";
import { formatDateTime, formatUSD } from "@/lib/tengasell/format";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { CurrentUser } from "@/lib/tengasell/types";
import {
  financeFetch,
  MoneyChip,
  moneyStatusTone,
  useMoneyStatus,
  type FinanceInvoice,
  type FinancePayout,
} from "../account/earnings-section";

export type FinanceSection =
  | "ledger"
  | "payouts"
  | "refunds"
  | "invoices"
  | "reconciliation"
  | "tax";

export const FINANCE_SECTIONS: FinanceSection[] = [
  "ledger",
  "payouts",
  "refunds",
  "invoices",
  "reconciliation",
  "tax",
];

// ── shared admin fetch (relative BFF path, admin-gated server-side) ────

async function adminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return financeFetch<T>(token, `/admin${path}`, init);
}

// ── contract types (finance-service routes/admin.ts) ───────────────────

interface LedgerEntry {
  id: number;
  ts: string;
  orderRef: string | null;
  payoutRef: string | null;
  txType: string;
  account: string;
  direction: "debit" | "credit";
  amountCents: number;
  counterAccount: string | null;
  memo: string | null;
  actor: string | null;
  balancedTx: string;
}

interface AdminPayout extends FinancePayout {
  idNumber: string;
  taxNumber?: string | null;
  sanctionsConfirmed?: boolean;
  paidBy?: string | null;
}

interface Refund {
  id: number;
  orderId: number;
  amountCents: number;
  kind: string;
  reasonCode: string;
  reasonNote: string | null;
  status: string;
  requestedBy: string | null;
  approvedBy: string | null;
  dualApproval: boolean;
  creditNoteId: number | null;
  createdAt: string;
}

interface CreditNote {
  id: number;
  number: string;
  refundRef: string | null;
  orderId: number | null;
  amountCents: number;
  vatCents: number;
  createdAt: string;
}

interface Chargeback {
  id: number;
  orderId: number;
  providerRef: string | null;
  amountCents: number;
  status: string;
  resolution: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

interface BankLine {
  id: number;
  statementDate: string | null;
  amountCents: number;
  direction: string;
  memo: string | null;
  matchedRef: string | null;
  matchedType: string | null;
}

const REFUND_REASONS = [
  "item_not_received",
  "not_as_described",
  "damaged",
  "seller_cancelled",
  "goodwill",
] as const;

// ── the console ────────────────────────────────────────────────────────

export function FinanceConsole({
  user,
  section,
}: {
  user: CurrentUser;
  section: FinanceSection;
}) {
  const { t } = useI18n();
  const active = FINANCE_SECTIONS.includes(section) ? section : "ledger";
  const token = user.token;

  const nav: { key: FinanceSection; label: string; icon: LucideIcon }[] = [
    { key: "ledger", label: t("admin.nav.ledger"), icon: Database },
    { key: "payouts", label: t("admin.nav.payouts"), icon: Wallet },
    { key: "refunds", label: t("admin.nav.refunds"), icon: RefreshCw },
    { key: "invoices", label: t("admin.nav.invoices"), icon: FileText },
    { key: "reconciliation", label: t("admin.nav.reconciliation"), icon: ListChecks },
    { key: "tax", label: t("admin.nav.tax"), icon: Landmark },
  ];

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-sectionTitle text-foreground">{t("admin.finance.title")}</h2>
        <p className="text-caption text-muted-foreground mt-0.5">{t("admin.finance.sub")}</p>
      </header>

      {/* internal pill sub-nav — plane-level quick nav (44px targets) */}
      <nav aria-label="Finance console sections" className="overflow-x-auto ts-scrollbar">
        <ul className="flex w-max gap-1.5 pb-1">
          {nav.map((item) => (
            <PillItem key={item.key} item={item} active={active === item.key} />
          ))}
        </ul>
      </nav>

      {active === "ledger" && <LedgerSection token={token} />}
      {active === "payouts" && <PayoutsSection token={token} />}
      {active === "refunds" && <RefundsSection token={token} />}
      {active === "invoices" && <InvoicesSection token={token} />}
      {active === "reconciliation" && <ReconciliationSection token={token} />}
      {active === "tax" && <TaxSection token={token} />}
    </div>
  );
}

function PillItem({
  item,
  active,
}: {
  item: { key: FinanceSection; label: string; icon: LucideIcon };
  active: boolean;
}) {
  const link = useLinkProps(`/admin/${item.key}`);
  const Icon = item.icon;
  return (
    <li>
      <a
        {...link}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-label font-semibold transition-colors",
          active
            ? "bg-primary text-primary-foreground border-transparent font-bold"
            : "border-border bg-raised text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {item.label}
      </a>
    </li>
  );
}

// ── section: ledger ────────────────────────────────────────────────────

function LedgerSection({ token }: { token: string }) {
  const { t } = useI18n();
  const [account, setAccount] = useState("");
  const [verify, setVerify] = useState<{ ok: boolean; txs: number; failures: { balancedTx: string; delta: number }[] } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const stats = useResource<Record<string, number | string>>(
    async () => adminFetch(token, "/stats"),
    [token],
  );
  const ledger = useResource<{ entries: LedgerEntry[]; accounts: string[] }>(
    async () =>
      adminFetch(token, `/ledger?limit=200${account ? `&account=${encodeURIComponent(account)}` : ""}`),
    [token, account],
  );
  const balances = useResource<{
    balances: { username: string; availableCents: number; pendingCents: number; withheldCents: number }[];
    accounts: Record<string, number>;
  }>(async () => adminFetch(token, "/balances"), [token]);

  const runVerify = async () => {
    setVerifying(true);
    try {
      const data = await adminFetch<{ verify: string; transactions: number; failures: { balancedTx: string; delta: number }[] }>(
        token,
        "/ledger?verify=1",
      );
      setVerify({ ok: data.verify === "ok", txs: data.transactions, failures: data.failures ?? [] });
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  const seedDemo = async () => {
    setSeeding(true);
    try {
      const data = await adminFetch<{ summary?: Record<string, unknown> }>(token, "/seed-demo", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({
        title: t("finance.console.seeded"),
        description: JSON.stringify(data.summary ?? {}).slice(0, 140),
      });
      stats.reload();
      ledger.reload();
      balances.reload();
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSeeding(false);
    }
  };

  const st = stats.data;
  return (
    <div className="space-y-5">
      {/* KPI strip */}
      {stats.loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-card" />
          ))}
        </div>
      ) : stats.error ? (
        <ErrorState message={stats.error} onRetry={stats.reload} />
      ) : st ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={t("finance.stats.escrow")} cents={Number(st.escrowHoldingCents)} gold />
          <KpiCard label={t("finance.stats.revenue30d")} cents={Number(st.revenue30dCents)} />
          <KpiCard label={t("finance.stats.vatDue")} cents={Number(st.vatDueCents)} />
          <KpiCard label={t("finance.stats.owed")} cents={Number(st.sellerOwedCents)} />
        </div>
      ) : null}

      {/* entries table */}
      <div className="rounded-card border border-border bg-raised">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground mr-1">{t("finance.ledger.title")}</h3>
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            <AccountChip label={t("finance.ledger.allAccounts")} active={account === ""} onClick={() => setAccount("")} />
            {(ledger.data?.accounts ?? []).map((a) => (
              <AccountChip key={a} label={a} active={account === a} onClick={() => setAccount(a)} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {verify ? (
              <MoneyChip tone={verify.ok ? "ok" : "danger"}>
                {verify.ok
                  ? t("finance.ledger.verifyOk").replace("{n}", String(verify.txs))
                  : t("finance.ledger.verifyFail").replace("{n}", String(verify.failures.length))}
              </MoneyChip>
            ) : null}
            <Button variant="outline" className="min-h-11" onClick={runVerify} disabled={verifying}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              {verifying ? t("finance.sending") : t("finance.ledger.verify")}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={seedDemo} disabled={seeding}>
              <Sparkles className="size-4" aria-hidden="true" />
              {seeding ? t("finance.sending") : t("finance.console.seed")}
            </Button>
          </div>
        </div>
        {verify && !verify.ok ? (
          <ul className="border-b border-border/70 bg-danger/5 px-4 py-2 text-caption text-danger">
            {verify.failures.map((f) => (
              <li key={f.balancedTx} className="ts-numeric">
                {f.balancedTx}: Δ {f.delta}
              </li>
            ))}
          </ul>
        ) : null}
        {ledger.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : ledger.error ? (
          <div className="p-4">
            <ErrorState message={ledger.error} onRetry={ledger.reload} />
          </div>
        ) : (ledger.data?.entries ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Database className="size-8" />}
              title={t("finance.ledger.empty")}
              body={t("finance.ledger.emptyBody")}
            />
          </div>
        ) : (
          <div className="max-h-96 overflow-auto ts-scrollbar">
            <table className="w-full text-caption">
              <thead className="sticky top-0 bg-raised">
                <tr className="border-b border-border/70 text-left text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5 font-bold">{t("finance.ledger.tx")}</th>
                  <th scope="col" className="px-2 py-2.5 font-bold">{t("finance.ledger.account")}</th>
                  <th scope="col" className="px-2 py-2.5 font-bold text-right">{t("finance.ledger.debit")}</th>
                  <th scope="col" className="px-2 py-2.5 font-bold text-right">{t("finance.ledger.credit")}</th>
                  <th scope="col" className="px-2 py-2.5 font-bold">{t("finance.ledger.memo")}</th>
                  <th scope="col" className="px-3 py-2.5 font-bold">{t("finance.ledger.when")}</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.data?.entries ?? []).map((e, idx, arr) => {
                  const prev = arr[idx - 1];
                  const newTx = !prev || prev.balancedTx !== e.balancedTx;
                  return (
                    <tr
                      key={e.id}
                      className={cn(
                        "border-b border-border/40",
                        newTx ? "border-t border-t-border/70" : "",
                      )}
                    >
                      <td className="px-3 py-2">
                        {newTx ? (
                          <span className="ts-numeric font-bold text-teal-deep">{e.balancedTx}</span>
                        ) : (
                          <span className="sr-only">{e.balancedTx}</span>
                        )}
                        <span className="block text-muted-foreground">{e.txType}</span>
                      </td>
                      <td className="px-2 py-2 font-semibold text-foreground">{e.account}</td>
                      <td className="ts-numeric px-2 py-2 text-right text-danger">
                        {e.direction === "debit" ? formatUSD(e.amountCents / 100) : ""}
                      </td>
                      <td className="ts-numeric px-2 py-2 text-right text-ok">
                        {e.direction === "credit" ? formatUSD(e.amountCents / 100) : ""}
                      </td>
                      <td className="max-w-56 truncate px-2 py-2 text-muted-foreground" title={e.memo ?? ""}>
                        {e.memo}
                      </td>
                      <td className="ts-numeric whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {formatDateTime(e.ts)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* balances */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.balances.title")}</h3>
        </div>
        {balances.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : balances.error ? (
          <div className="p-4">
            <ErrorState message={balances.error} onRetry={balances.reload} />
          </div>
        ) : (
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-caption font-bold text-muted-foreground">
                {t("finance.balances.sellers")}
              </p>
              {(balances.data?.balances ?? []).length === 0 ? (
                <p className="text-caption text-muted-foreground">{t("finance.balances.none")}</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto ts-scrollbar">
                  {(balances.data?.balances ?? []).map((b) => (
                    <li
                      key={b.username}
                      className="ts-numeric flex flex-wrap items-center justify-between gap-2 rounded-control border border-border/60 bg-section px-3 py-2 text-caption"
                    >
                      <span className="font-bold text-foreground">@{b.username}</span>
                      <span className="flex flex-wrap gap-x-3">
                        <span className="text-ok">{t("finance.available")}: {formatUSD(b.availableCents / 100)}</span>
                        <span className="text-gold-deep">{t("finance.pendingEscrow")}: {formatUSD(b.pendingCents / 100)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-caption font-bold text-muted-foreground">
                {t("finance.balances.platform")}
              </p>
              <ul className="space-y-1">
                {Object.entries(balances.data?.accounts ?? {}).map(([key, cents]) => (
                  <li
                    key={key}
                    className="ts-numeric flex items-center justify-between rounded-control border border-border/60 bg-section px-3 py-2 text-caption"
                  >
                    <span className="text-muted-foreground">{t(`finance.account.${key}`)}</span>
                    <span className="font-bold text-foreground">{formatUSD(Number(cents) / 100)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-11 whitespace-nowrap rounded-full border px-3 text-caption font-bold transition-colors",
        active
          ? "bg-teal-tint text-teal-deep border-teal/40"
          : "border-border bg-section text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function KpiCard({ label, cents, gold }: { label: string; cents: number; gold?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-raised p-4">
      <p className="text-caption font-bold text-muted-foreground">{label}</p>
      <p className={cn("ts-numeric mt-1 text-title font-bold", gold ? "text-gold-deep" : "text-foreground")}>
        {formatUSD(cents / 100)}
      </p>
    </div>
  );
}

// ── section: payouts ───────────────────────────────────────────────────

function PayoutsSection({ token }: { token: string }) {
  const { t } = useI18n();
  const statusLabel = useMoneyStatus();
  const payouts = useResource<{ payouts: AdminPayout[]; thresholdCents: number; sanctionsNote: string }>(
    async () => adminFetch(token, "/payouts"),
    [token],
  );
  const [approveTarget, setApproveTarget] = useState<AdminPayout | null>(null);
  const [payTarget, setPayTarget] = useState<AdminPayout | null>(null);
  const [reverseTarget, setReverseTarget] = useState<AdminPayout | null>(null);
  const reload = payouts.reload;
  const threshold = (payouts.data?.thresholdCents ?? 10000) / 100;

  const rows = payouts.data?.payouts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-gold/40 bg-gold-soft/50 px-4 py-3">
        <BadgeCheck className="size-4 text-gold-deep" aria-hidden="true" />
        <p className="text-caption font-semibold text-gold-on">
          {t("finance.payouts.dualNote").replace("{n}", formatUSD(threshold))}
        </p>
      </div>

      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.payouts.title")}</h3>
        </div>
        {payouts.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : payouts.error ? (
          <div className="p-4">
            <ErrorState message={payouts.error} onRetry={reload} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Wallet className="size-8" />}
              title={t("finance.payouts.empty")}
              body={t("finance.payouts.emptyBody")}
            />
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto ts-scrollbar">
            {rows.map((p) => (
              <li key={p.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="ts-numeric text-label font-bold text-foreground">
                    {formatUSD(p.amountCents / 100)}
                  </span>
                  <a href={`#/u/${p.username}`} className="text-caption font-bold text-teal hover:underline">
                    @{p.username}
                  </a>
                  <span className="text-caption text-muted-foreground">
                    {p.method === "ecocash" ? t("finance.method.ecocash") : t("finance.method.bank")} · {p.destination}
                  </span>
                  <span className="ts-numeric text-caption text-muted-foreground">
                    {t("finance.col.requested")} {formatDateTime(p.requestedAt)}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {p.amountCents > (payouts.data?.thresholdCents ?? 10000) ? (
                      <MoneyChip tone="gold">{t("finance.payouts.dual")}</MoneyChip>
                    ) : null}
                    <MoneyChip tone={moneyStatusTone(p.status)}>{statusLabel(p.status)}</MoneyChip>
                  </span>
                </div>
                {p.idNumber ? (
                  <p className="ts-numeric text-caption text-muted-foreground">
                    {t("finance.payoutIdNumber")}: {p.idNumber}
                    {p.taxNumber ? ` · ${t("finance.payoutTaxNumber")}: ${p.taxNumber}` : ""}
                    {p.reference ? ` · ${t("finance.payouts.reference")}: ${p.reference}` : ""}
                  </p>
                ) : null}
                {p.reversalReason ? (
                  <p className="text-caption text-muted-foreground">
                    {t("finance.payouts.reason")}: {p.reversalReason}
                  </p>
                ) : null}
                {/* actions per status */}
                <div className="flex flex-wrap gap-2">
                  {p.status === "requested" ? (
                    <>
                      <Button size="sm" className="min-h-11" onClick={() => setApproveTarget(p)}>
                        <BadgeCheck className="size-4" aria-hidden="true" />
                        {t("finance.payouts.approve")}
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11 text-danger" onClick={() => setReverseTarget(p)}>
                        {t("finance.payouts.reverse")}
                      </Button>
                    </>
                  ) : null}
                  {p.status === "approved" ? (
                    <>
                      <Button size="sm" className="min-h-11" onClick={() => setPayTarget(p)}>
                        <Banknote className="size-4" aria-hidden="true" />
                        {t("finance.payouts.pay")}
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11 text-danger" onClick={() => setReverseTarget(p)}>
                        {t("finance.payouts.reverse")}
                      </Button>
                    </>
                  ) : null}
                  {p.status === "paid" ? (
                    <Button size="sm" variant="ghost" className="min-h-11 text-danger" onClick={() => setReverseTarget(p)}>
                      <RefreshCw className="size-4" aria-hidden="true" />
                      {t("finance.payouts.reverse")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ApprovePayoutDialog target={approveTarget} onClose={() => setApproveTarget(null)} token={token} onDone={reload} />
      <PayPayoutDialog target={payTarget} onClose={() => setPayTarget(null)} token={token} onDone={reload} />
      <ReversePayoutDialog target={reverseTarget} onClose={() => setReverseTarget(null)} token={token} onDone={reload} />
    </div>
  );
}

function ApprovePayoutDialog({
  target,
  onClose,
  token,
  onDone,
}: {
  target: AdminPayout | null;
  onClose: () => void;
  token: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [sanctions, setSanctions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason("");
    setSanctions(false);
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!target) return;
    setError(null);
    if (!reason.trim()) {
      setError(t("finance.payouts.reasonRequired"));
      return;
    }
    if (!sanctions) {
      setError(t("finance.payouts.sanctionsRequired"));
      return;
    }
    setBusy(true);
    try {
      await adminFetch(token, `/payouts/${target.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim(), sanctionsConfirmed: true }),
      });
      toast({ title: t("finance.payouts.approved") });
      close();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("finance.console.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => (!v ? close() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("finance.payouts.approve")} · {target ? formatUSD(target.amountCents / 100) : ""} → @{target?.username}
          </DialogTitle>
          <DialogDescription>{t("finance.payouts.approveSub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="approve-reason">
              {t("finance.payouts.reason")} <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="approve-reason"
              className="min-h-11"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="KYC verified, screening clear…"
            />
          </div>
          <label className="flex min-h-11 items-start gap-2.5 rounded-control border border-gold/40 bg-gold-soft/50 p-3">
            <Checkbox checked={sanctions} onCheckedChange={(v) => setSanctions(v === true)} className="mt-0.5" />
            <span className="text-caption font-semibold text-gold-on">
              {t("finance.payouts.sanctions")}
            </span>
          </label>
          {error ? (
            <p role="alert" className="text-caption font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="min-h-11" onClick={close}>
            {t("finance.cancel")}
          </Button>
          <Button className="min-h-11" onClick={submit} disabled={busy}>
            {busy ? t("finance.sending") : t("finance.payouts.approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayPayoutDialog({
  target,
  onClose,
  token,
  onDone,
}: {
  target: AdminPayout | null;
  onClose: () => void;
  token: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReference("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!target) return;
    setError(null);
    if (!reference.trim()) {
      setError(t("finance.payouts.referenceRequired"));
      return;
    }
    setBusy(true);
    try {
      await adminFetch(token, `/payouts/${target.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ reference: reference.trim() }),
      });
      toast({ title: t("finance.payouts.paid") });
      close();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("finance.console.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => (!v ? close() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("finance.payouts.pay")} · {target ? formatUSD(target.amountCents / 100) : ""} → @{target?.username}
          </DialogTitle>
          <DialogDescription>
            {target?.method === "ecocash" ? t("finance.method.ecocash") : t("finance.method.bank")} · {target?.destination}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-reference">
              {t("finance.payouts.reference")} <span className="text-danger">*</span>
            </Label>
            <Input
              id="pay-reference"
              className="ts-numeric min-h-11"
              placeholder="ECO-2026-000123"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <p className="text-caption text-muted-foreground">{t("finance.payouts.referenceHint")}</p>
          </div>
          {error ? (
            <p role="alert" className="text-caption font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="min-h-11" onClick={close}>
            {t("finance.cancel")}
          </Button>
          <Button className="min-h-11" onClick={submit} disabled={busy}>
            {busy ? t("finance.sending") : t("finance.payouts.pay")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReversePayoutDialog({
  target,
  onClose,
  token,
  onDone,
}: {
  target: AdminPayout | null;
  onClose: () => void;
  token: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!target) return;
    setError(null);
    if (!reason.trim()) {
      setError(t("finance.payouts.reasonRequired"));
      return;
    }
    setBusy(true);
    try {
      await adminFetch(token, `/payouts/${target.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast({ title: t("finance.payouts.reversed") });
      close();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("finance.console.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => (!v ? close() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("finance.payouts.reverse")} · #{target?.id} ({target?.status})
          </DialogTitle>
          <DialogDescription>{t("finance.payouts.reverseSub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reverse-reason">
              {t("finance.payouts.reason")} <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="reverse-reason"
              className="min-h-11"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-caption font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="min-h-11" onClick={close}>
            {t("finance.cancel")}
          </Button>
          <Button variant="destructive" className="min-h-11" onClick={submit} disabled={busy}>
            {busy ? t("finance.sending") : t("finance.payouts.reverse")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── section: refunds (+ chargebacks) ───────────────────────────────────

function RefundsSection({ token }: { token: string }) {
  const { t } = useI18n();
  const statusLabel = useMoneyStatus();
  const refunds = useResource<{ refunds: Refund[]; creditNotes: CreditNote[] }>(
    async () => adminFetch(token, "/refunds"),
    [token],
  );
  const chargebacks = useResource<{ chargebacks: Chargeback[] }>(
    async () => adminFetch(token, "/chargebacks"),
    [token],
  );

  // create form state
  const [orderId, setOrderId] = useState("");
  const [kind, setKind] = useState("full");
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] = useState<string>("item_not_received");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<Refund | null>(null);
  const [resolveTarget, setResolveTarget] = useState<Chargeback | null>(null);
  const [cbForm, setCbForm] = useState({ orderId: "", amount: "", providerRef: "" });

  const reloadAll = () => {
    refunds.reload();
    chargebacks.reload();
  };

  const createRefund = async () => {
    setFormError(null);
    const oid = Number(orderId);
    if (!Number.isInteger(oid) || oid <= 0) {
      setFormError(t("finance.refunds.orderRequired"));
      return;
    }
    if (kind === "partial" && !(Number(amount) > 0)) {
      setFormError(t("finance.refunds.amountRequired"));
      return;
    }
    setBusy(true);
    try {
      const data = await adminFetch<{ refund?: Refund; autoProcessed?: boolean }>(token, "/refunds", {
        method: "POST",
        body: JSON.stringify({
          orderId: oid,
          kind,
          ...(kind === "partial" ? { amountCents: Math.round(Number(amount) * 100) } : {}),
          reasonCode,
          ...(note.trim() ? { reasonNote: note.trim() } : {}),
        }),
      });
      toast({
        title: data.autoProcessed ? t("finance.refunds.autoToast") : t("finance.refunds.createdToast"),
        description: `#${data.refund?.id} · ${formatUSD((data.refund?.amountCents ?? 0) / 100)}`,
      });
      setOrderId("");
      setAmount("");
      setNote("");
      reloadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("finance.console.error"));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (refund: Refund, decision: "approve" | "reject", reason?: string) => {
    try {
      await adminFetch(token, `/refunds/${refund.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
      });
      toast({ title: decision === "approve" ? t("finance.refunds.approved") : t("finance.refunds.rejected") });
      reloadAll();
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const createChargeback = async () => {
    const oid = Number(cbForm.orderId);
    if (!Number.isInteger(oid) || oid <= 0 || !(Number(cbForm.amount) > 0)) {
      toast({ title: t("finance.chargebacks.formError"), variant: "destructive" });
      return;
    }
    try {
      await adminFetch(token, "/chargebacks", {
        method: "POST",
        body: JSON.stringify({
          orderId: oid,
          amountCents: Math.round(Number(cbForm.amount) * 100),
          ...(cbForm.providerRef.trim() ? { providerRef: cbForm.providerRef.trim() } : {}),
        }),
      });
      toast({ title: t("finance.chargebacks.createdToast") });
      setCbForm({ orderId: "", amount: "", providerRef: "" });
      reloadAll();
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  const refundRows = refunds.data?.refunds ?? [];
  const cbRows = chargebacks.data?.chargebacks ?? [];

  return (
    <div className="space-y-5">
      {/* create refund */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.refunds.create")}</h3>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="refund-order">{t("finance.refunds.orderId")}</Label>
            <Input
              id="refund-order"
              inputMode="numeric"
              className="ts-numeric min-h-11"
              placeholder="1"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refund-kind">{t("finance.refunds.kind")}</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger id="refund-kind" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{t("finance.refunds.kind.full")}</SelectItem>
                <SelectItem value="partial">{t("finance.refunds.kind.partial")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "partial" ? (
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">{t("finance.payoutAmount")}</Label>
              <Input
                id="refund-amount"
                inputMode="decimal"
                className="ts-numeric min-h-11"
                placeholder="5.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">{t("finance.refunds.reasonCode")}</Label>
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger id="refund-reason" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFUND_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`finance.refunds.reason.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="refund-note">{t("finance.refunds.note")}</Label>
            <Input
              id="refund-note"
              className="min-h-11"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button className="min-h-11 w-full" onClick={createRefund} disabled={busy}>
              <Scale className="size-4" aria-hidden="true" />
              {busy ? t("finance.sending") : t("finance.refunds.create")}
            </Button>
          </div>
          {formError ? (
            <p role="alert" className="text-caption font-semibold text-danger md:col-span-2 xl:col-span-3">
              {formError}
            </p>
          ) : null}
        </div>
      </div>

      {/* queue */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.refunds.queue")}</h3>
        </div>
        {refunds.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : refunds.error ? (
          <div className="p-4">
            <ErrorState message={refunds.error} onRetry={refunds.reload} />
          </div>
        ) : refundRows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<RefreshCw className="size-8" />}
              title={t("finance.refunds.empty")}
              body={t("finance.refunds.emptyBody")}
            />
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto ts-scrollbar">
            {refundRows.map((r) => (
              <li key={r.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="ts-numeric text-label font-bold text-foreground">
                    {formatUSD(r.amountCents / 100)}
                  </span>
                  <a href={`#/orders/${r.orderId}`} className="ts-numeric text-caption font-bold text-teal hover:underline">
                    {t("finance.col.order")} #{r.orderId}
                  </a>
                  <span className="text-caption text-muted-foreground">
                    {t(`finance.refunds.kind.${r.kind}`)} · {t(`finance.refunds.reason.${r.reasonCode}`)}
                  </span>
                  {r.dualApproval ? <MoneyChip tone="gold">{t("finance.payouts.dual")}</MoneyChip> : null}
                  <span className="ml-auto flex items-center gap-2">
                    <MoneyChip tone={moneyStatusTone(r.status)}>{statusLabel(r.status)}</MoneyChip>
                  </span>
                </div>
                {r.reasonNote ? (
                  <p className="text-caption text-muted-foreground">{r.reasonNote}</p>
                ) : null}
                {r.status === "pending_approval" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="min-h-11" onClick={() => decide(r, "approve")}>
                      <BadgeCheck className="size-4" aria-hidden="true" />
                      {t("finance.refunds.approve")}
                    </Button>
                    <Button size="sm" variant="ghost" className="min-h-11 text-danger" onClick={() => setRejectTarget(r)}>
                      {t("finance.refunds.reject")}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* credit notes */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.refunds.creditNotes")}</h3>
        </div>
        {(refunds.data?.creditNotes ?? []).length === 0 ? (
          <p className="px-4 py-3 text-caption text-muted-foreground">{t("finance.refunds.cnEmpty")}</p>
        ) : (
          <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto ts-scrollbar">
            {(refunds.data?.creditNotes ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-caption">
                <FileText className="size-4 text-teal" aria-hidden="true" />
                <span className="ts-numeric font-bold text-foreground">{c.number}</span>
                <span className="ts-numeric text-muted-foreground">
                  {t("finance.col.order")} #{c.orderId} · {formatUSD(c.amountCents / 100)}
                </span>
                <span className="ts-numeric ml-auto text-muted-foreground">{formatDateTime(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* chargebacks */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.chargebacks.title")}</h3>
        </div>
        <div className="grid gap-3 border-b border-border/70 p-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="cb-order">{t("finance.refunds.orderId")}</Label>
            <Input
              id="cb-order"
              inputMode="numeric"
              className="ts-numeric min-h-11"
              value={cbForm.orderId}
              onChange={(e) => setCbForm((f) => ({ ...f, orderId: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cb-amount">{t("finance.payoutAmount")}</Label>
            <Input
              id="cb-amount"
              inputMode="decimal"
              className="ts-numeric min-h-11"
              value={cbForm.amount}
              onChange={(e) => setCbForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cb-ref">{t("finance.chargebacks.providerRef")}</Label>
            <Input
              id="cb-ref"
              className="ts-numeric min-h-11"
              value={cbForm.providerRef}
              onChange={(e) => setCbForm((f) => ({ ...f, providerRef: e.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="min-h-11 w-full" onClick={createChargeback}>
              {t("finance.chargebacks.create")}
            </Button>
          </div>
        </div>
        {chargebacks.loading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : cbRows.length === 0 ? (
          <p className="px-4 py-3 text-caption text-muted-foreground">{t("finance.chargebacks.empty")}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {cbRows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-caption">
                <span className="ts-numeric text-label font-bold text-foreground">
                  {formatUSD(c.amountCents / 100)}
                </span>
                <span className="ts-numeric text-muted-foreground">
                  {t("finance.col.order")} #{c.orderId}
                  {c.providerRef ? ` · ${c.providerRef}` : ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <MoneyChip tone={c.status === "open" ? "warn" : "ok"}>
                    {c.status === "open" ? t("finance.chargebacks.open") : t("finance.chargebacks.resolved")}
                  </MoneyChip>
                  {c.status === "open" ? (
                    <Button size="sm" variant="outline" className="min-h-11" onClick={() => setResolveTarget(c)}>
                      {t("finance.chargebacks.resolve")}
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">
                      {c.resolution === "seller_liability"
                        ? t("finance.chargebacks.seller")
                        : t("finance.chargebacks.platform")}
                      {c.resolvedBy ? ` · @${c.resolvedBy}` : ""}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* reject refund dialog */}
      <ReasonDialog
        open={!!rejectTarget}
        title={`${t("finance.refunds.reject")} · #${rejectTarget?.id ?? ""}`}
        description={t("finance.refunds.rejectSub")}
        submitLabel={t("finance.refunds.reject")}
        onClose={() => setRejectTarget(null)}
        onSubmit={async (reason) => {
          if (rejectTarget) await decide(rejectTarget, "reject", reason);
          setRejectTarget(null);
        }}
      />

      {/* resolve chargeback dialog */}
      <Dialog open={!!resolveTarget} onOpenChange={(v) => (!v ? setResolveTarget(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("finance.chargebacks.resolve")} · {resolveTarget ? formatUSD(resolveTarget.amountCents / 100) : ""}
            </DialogTitle>
            <DialogDescription>{t("finance.chargebacks.resolveSub")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              onClick={async () => {
                if (!resolveTarget) return;
                try {
                  await adminFetch(token, `/chargebacks/${resolveTarget.id}/resolve`, {
                    method: "POST",
                    body: JSON.stringify({ resolution: "seller_liability" }),
                  });
                  toast({ title: t("finance.chargebacks.resolvedToast") });
                } catch (err) {
                  toast({
                    title: t("finance.console.error"),
                    description: err instanceof Error ? err.message : undefined,
                    variant: "destructive",
                  });
                }
                setResolveTarget(null);
                reloadAll();
              }}
            >
              {t("finance.chargebacks.seller")}
            </Button>
            <Button
              variant="outline"
              className="min-h-11 justify-start"
              onClick={async () => {
                if (!resolveTarget) return;
                try {
                  await adminFetch(token, `/chargebacks/${resolveTarget.id}/resolve`, {
                    method: "POST",
                    body: JSON.stringify({ resolution: "platform_absorbed" }),
                  });
                  toast({ title: t("finance.chargebacks.resolvedToast") });
                } catch (err) {
                  toast({
                    title: t("finance.console.error"),
                    description: err instanceof Error ? err.message : undefined,
                    variant: "destructive",
                  });
                }
                setResolveTarget(null);
                reloadAll();
              }}
            >
              {t("finance.chargebacks.platform")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Small one-field (optional reason) dialog used by refund reject. */
function ReasonDialog({
  open,
  title,
  description,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reason-dialog">{t("finance.payouts.reason")}</Label>
          <Textarea
            id="reason-dialog"
            className="min-h-11"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => {
              setReason("");
              onClose();
            }}
          >
            {t("finance.cancel")}
          </Button>
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSubmit(reason.trim());
              setBusy(false);
              setReason("");
            }}
          >
            {busy ? t("finance.sending") : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── section: invoices ──────────────────────────────────────────────────

function InvoicesSection({ token }: { token: string }) {
  const { t } = useI18n();
  const statusLabel = useMoneyStatus();
  const invoices = useResource<{ invoices: FinanceInvoice[] }>(
    async () => adminFetch(token, "/invoices"),
    [token],
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [genForm, setGenForm] = useState({ username: "", period: "" });

  const rows = invoices.data?.invoices ?? [];
  const periodNow = new Date().toISOString().slice(0, 7);

  const issue = async (id: number) => {
    setBusyId(id);
    try {
      await adminFetch(token, `/invoices/${id}/issue`, { method: "POST", body: JSON.stringify({}) });
      toast({ title: t("finance.invoices.issued") });
      invoices.reload();
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const generate = async () => {
    try {
      await adminFetch(token, "/invoices", {
        method: "POST",
        body: JSON.stringify({ username: genForm.username.trim(), period: genForm.period.trim() || periodNow }),
      });
      toast({ title: t("finance.invoices.generated") });
      setGenForm({ username: "", period: "" });
      invoices.reload();
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-card border border-border bg-raised p-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="inv-user">{t("finance.invoices.seller")}</Label>
          <Input
            id="inv-user"
            className="min-h-11"
            placeholder="rufaro"
            value={genForm.username}
            onChange={(e) => setGenForm((f) => ({ ...f, username: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-period">{t("finance.invoices.period")}</Label>
          <Input
            id="inv-period"
            className="ts-numeric min-h-11"
            placeholder={periodNow}
            value={genForm.period}
            onChange={(e) => setGenForm((f) => ({ ...f, period: e.target.value }))}
          />
        </div>
        <div className="flex items-end">
          <Button className="min-h-11 w-full" onClick={generate} disabled={!genForm.username.trim()}>
            <FileText className="size-4" aria-hidden="true" />
            {t("finance.invoices.generate")}
          </Button>
        </div>
      </div>

      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.invoices.title")}</h3>
        </div>
        {invoices.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : invoices.error ? (
          <div className="p-4">
            <ErrorState message={invoices.error} onRetry={invoices.reload} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<FileText className="size-8" />}
              title={t("finance.invoices.empty")}
              body={t("finance.invoices.emptyBody")}
            />
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto ts-scrollbar">
            {rows.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-accent/40"
                  aria-expanded={expanded === inv.id}
                  onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
                >
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded === inv.id && "rotate-180")}
                    aria-hidden="true"
                  />
                  <span className="ts-numeric text-label font-bold text-foreground">{inv.number}</span>
                  <span className="text-caption font-bold text-teal">@{inv.username}</span>
                  <span className="ts-numeric text-caption text-muted-foreground">
                    {String(inv.periodStart).slice(0, 7)}
                  </span>
                  <span className="ts-numeric ml-auto text-caption text-muted-foreground">
                    {formatUSD(inv.totalCents / 100)}
                  </span>
                  <MoneyChip tone={moneyStatusTone(inv.status)}>{statusLabel(inv.status)}</MoneyChip>
                </button>
                {expanded === inv.id ? (
                  <div className="border-t border-border/50 bg-section px-4 py-3">
                    <p className="mb-1.5 text-caption font-bold text-muted-foreground">
                      {t("finance.invoices.lines")}
                    </p>
                    <div className="grid gap-x-6 gap-y-1 text-caption sm:grid-cols-3">
                      <span className="ts-numeric flex justify-between">
                        <span className="text-muted-foreground">{t("finance.invoices.feeLine")}</span>
                        <span>{formatUSD(inv.feeCents / 100)}</span>
                      </span>
                      <span className="ts-numeric flex justify-between">
                        <span className="text-muted-foreground">{t("finance.invoices.vatLine")}</span>
                        <span>{formatUSD(inv.vatCents / 100)}</span>
                      </span>
                      <span className="ts-numeric flex justify-between font-bold text-foreground">
                        <span>{t("finance.invoices.totalLine")}</span>
                        <span>{formatUSD(inv.totalCents / 100)}</span>
                      </span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      {inv.status === "draft" ? (
                        <Button size="sm" className="min-h-11" onClick={() => issue(inv.id)} disabled={busyId === inv.id}>
                          <FileText className="size-4" aria-hidden="true" />
                          {busyId === inv.id ? t("finance.sending") : t("finance.invoices.issue")}
                        </Button>
                      ) : (
                        <span className="text-caption text-muted-foreground">
                          {t("finance.invoices.issuedAt")}: {inv.issuedAt ? formatDateTime(inv.issuedAt) : "—"}
                        </span>
                      )}
                      <span className="ts-numeric text-caption text-muted-foreground">
                        {String(inv.periodStart).slice(0, 10)} → {String(inv.periodEnd).slice(0, 10)}
                      </span>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── section: reconciliation ────────────────────────────────────────────

function ReconciliationSection({ token }: { token: string }) {
  const { t } = useI18n();
  const recon = useResource<{
    lastRun: { id: number; ranAt: string; paymentsChecked: number; matched: number; exceptions: { kind: string; orderId?: number; detail?: string }[] } | null;
    bankLines: BankLine[];
  }>(async () => adminFetch(token, "/reconciliation"), [token]);
  const [running, setRunning] = useState(false);
  const [matchTarget, setMatchTarget] = useState<BankLine | null>(null);
  const [lineForm, setLineForm] = useState({ date: "", amount: "", direction: "in", memo: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const data = await adminFetch<{
        ok?: boolean;
        run?: { paymentsChecked?: number; matched?: number; exceptions?: unknown[] };
      }>(token, "/reconciliation/run", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const summary = data.run;
      toast({
        title: data.ok ? t("finance.recon.cleanToast") : t("finance.recon.ranToast"),
        description: summary
          ? `${t("finance.recon.checked")}: ${summary.paymentsChecked ?? 0} · ${t(
              "finance.recon.matched",
            )}: ${summary.matched ?? 0} · ${t("finance.recon.exceptions")}: ${
              summary.exceptions?.length ?? 0
            }`
          : undefined,
      });
      recon.reload();
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  };

  const addLine = async () => {
    setFormError(null);
    const usd = Number(lineForm.amount);
    if (!(usd > 0)) {
      setFormError(t("finance.refunds.amountRequired"));
      return;
    }
    try {
      const data = await adminFetch<{ imported?: number; autoMatched?: number }>(token, "/bank-lines", {
        method: "POST",
        body: JSON.stringify({
          lines: [
            {
              amountCents: Math.round(usd * 100),
              direction: lineForm.direction,
              memo: lineForm.memo.trim(),
              ...(lineForm.date.trim() ? { statementDate: lineForm.date.trim() } : {}),
            },
          ],
        }),
      });
      toast({
        title: t("finance.recon.importedToast").replace("{n}", String(data.imported ?? 0)),
        description: t("finance.recon.autoMatched").replace("{n}", String(data.autoMatched ?? 0)),
      });
      setLineForm({ date: "", amount: "", direction: "in", memo: "" });
      recon.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("finance.console.error"));
    }
  };

  const last = recon.data?.lastRun ?? null;
  const lines = recon.data?.bankLines ?? [];

  return (
    <div className="space-y-5">
      {/* run + last run */}
      <div className="rounded-card border border-border bg-raised">
        <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.recon.title")}</h3>
          <Button className="ml-auto min-h-11" onClick={run} disabled={running}>
            <ListChecks className="size-4" aria-hidden="true" />
            {running ? t("finance.sending") : t("finance.recon.run")}
          </Button>
        </div>
        {recon.loading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : recon.error ? (
          <div className="p-4">
            <ErrorState message={recon.error} onRetry={recon.reload} />
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {last ? (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption">
                  <span className="font-bold text-foreground">{t("finance.recon.lastRun")}</span>
                  <span className="ts-numeric text-muted-foreground">{formatDateTime(last.ranAt)}</span>
                  <MoneyChip tone="teal">
                    {t("finance.recon.checked")}: {last.paymentsChecked}
                  </MoneyChip>
                  <MoneyChip tone={last.matched === last.paymentsChecked ? "ok" : "warn"}>
                    {t("finance.recon.matched")}: {last.matched}
                  </MoneyChip>
                </div>
                <div>
                  <p className="mb-1 text-caption font-bold text-muted-foreground">
                    {t("finance.recon.exceptions")}
                  </p>
                  {last.exceptions.length === 0 ? (
                    <p className="text-caption font-semibold text-ok">{t("finance.recon.none")}</p>
                  ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto ts-scrollbar">
                      {last.exceptions.map((ex, i) => (
                        <li
                          key={i}
                          className="rounded-control border border-warn/30 bg-warn/5 px-3 py-2 text-caption"
                        >
                          <span className="font-bold text-warn">{ex.kind}</span>
                          {ex.orderId ? <span className="ts-numeric"> · #{ex.orderId}</span> : null}
                          {ex.detail ? <span className="block text-muted-foreground">{ex.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="text-caption text-muted-foreground">{t("finance.recon.never")}</p>
            )}
          </div>
        )}
      </div>

      {/* bank lines matcher */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.recon.bankLines")}</h3>
        </div>
        <div className="grid gap-3 border-b border-border/70 p-4 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="bl-date">{t("finance.recon.date")}</Label>
            <Input
              id="bl-date"
              className="ts-numeric min-h-11"
              placeholder="2026-10-20"
              value={lineForm.date}
              onChange={(e) => setLineForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bl-amount">{t("finance.payoutAmount")}</Label>
            <Input
              id="bl-amount"
              inputMode="decimal"
              className="ts-numeric min-h-11"
              placeholder="22.30"
              value={lineForm.amount}
              onChange={(e) => setLineForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bl-dir">{t("finance.recon.direction")}</Label>
            <Select value={lineForm.direction} onValueChange={(v) => setLineForm((f) => ({ ...f, direction: v }))}>
              <SelectTrigger id="bl-dir" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">{t("finance.recon.direction.in")}</SelectItem>
                <SelectItem value="out">{t("finance.recon.direction.out")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <Label htmlFor="bl-memo">{t("finance.recon.memo")}</Label>
            <Input
              id="bl-memo"
              className="min-h-11"
              placeholder="PAYNOW SETTLEMENT TS-ORDR…"
              value={lineForm.memo}
              onChange={(e) => setLineForm((f) => ({ ...f, memo: e.target.value }))}
            />
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="min-h-11 w-full" onClick={addLine}>
              {t("finance.recon.addLine")}
            </Button>
          </div>
          {formError ? (
            <p role="alert" className="text-caption font-semibold text-danger md:col-span-5">
              {formError}
            </p>
          ) : null}
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-3 text-caption text-muted-foreground">{t("finance.recon.linesEmpty")}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto ts-scrollbar">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-caption">
                <span
                  className={cn(
                    "ts-numeric text-label font-bold",
                    l.direction === "in" ? "text-ok" : "text-danger",
                  )}
                >
                  {l.direction === "in" ? "+" : "−"}
                  {formatUSD(l.amountCents / 100)}
                </span>
                <span className="ts-numeric text-muted-foreground">{l.statementDate ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={l.memo ?? ""}>
                  {l.memo}
                </span>
                {l.matchedRef ? (
                  <span className="flex items-center gap-1.5">
                    <MoneyChip tone="ok">
                      {l.matchedType === "payout" ? t("admin.nav.payouts") : t("finance.recon.payment")}
                    </MoneyChip>
                    <span className="ts-numeric text-muted-foreground">{l.matchedRef}</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <MoneyChip tone="warn">{t("finance.recon.unmatched")}</MoneyChip>
                    <Button size="sm" variant="outline" className="min-h-11" onClick={() => setMatchTarget(l)}>
                      {t("finance.recon.match")}
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <MatchLineDialog
        target={matchTarget}
        onClose={() => setMatchTarget(null)}
        token={token}
        onDone={() => recon.reload()}
      />
    </div>
  );
}

function MatchLineDialog({
  target,
  onClose,
  token,
  onDone,
}: {
  target: BankLine | null;
  onClose: () => void;
  token: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [ref, setRef] = useState("");
  const [refType, setRefType] = useState("payment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setRef("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    if (!target) return;
    setError(null);
    if (!ref.trim()) {
      setError(t("finance.recon.refRequired"));
      return;
    }
    setBusy(true);
    try {
      await adminFetch(token, `/bank-lines/${target.id}/match`, {
        method: "POST",
        body: JSON.stringify({ ref: ref.trim(), refType }),
      });
      toast({ title: t("finance.recon.matchedToast") });
      close();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("finance.console.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => (!v ? close() : null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.recon.match")}</DialogTitle>
          <DialogDescription>
            {target ? `${target.direction === "in" ? "+" : "−"}${formatUSD(target.amountCents / 100)} · ${target.memo ?? ""}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="match-type">{t("finance.recon.matchType")}</Label>
            <Select value={refType} onValueChange={setRefType}>
              <SelectTrigger id="match-type" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="payment">{t("finance.recon.payment")}</SelectItem>
                <SelectItem value="payout">{t("admin.nav.payouts")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="match-ref">
              {t("finance.payouts.reference")} <span className="text-danger">*</span>
            </Label>
            <Input
              id="match-ref"
              className="ts-numeric min-h-11"
              placeholder="TS-ORDR2-8 / ECO-2026-000123"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-caption font-semibold text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="min-h-11" onClick={close}>
            {t("finance.cancel")}
          </Button>
          <Button className="min-h-11" onClick={submit} disabled={busy}>
            {busy ? t("finance.sending") : t("finance.recon.match")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── section: tax (+ money rules config) ────────────────────────────────

interface MoneyConfigPayload {
  config: {
    fee_pct: number;
    fee_cap: number;
    featured_fee: number;
    vat_pct: number;
    payout_min: number;
    dual_approval_threshold: number;
    escrow_days: number;
    currency: string;
    refund_auto_max: number;
  };
}

function TaxSection({ token }: { token: string }) {
  const { t } = useI18n();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [downloading, setDownloading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const tax = useResource<{
    period: string;
    feeRevenueCents: number;
    vatOutputCents: number;
    vatReversalsCents: number;
    vatDueCents: number;
    entries: LedgerEntry[];
  }>(async () => adminFetch(token, `/tax?period=${encodeURIComponent(period)}`), [token, period]);
  const config = useResource<MoneyConfigPayload>(async () => adminFetch(token, "/config"), [token]);

  const shiftPeriod = (months: number) => {
    const [y, m] = period.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + months, 1));
    setPeriod(d.toISOString().slice(0, 7));
  };

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/finance/admin/tax?format=csv&period=${encodeURIComponent(period)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tengasell-vat-${period}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: t("finance.tax.downloaded") });
    } catch (err) {
      toast({
        title: t("finance.console.error"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const cfg = config.data?.config;

  return (
    <div className="space-y-5">
      {/* period switcher + download */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11" onClick={() => shiftPeriod(-1)} aria-label={t("finance.tax.prev")}>
          <CalendarClock className="size-4" aria-hidden="true" />
          {t("finance.tax.prev")}
        </Button>
        <span className="ts-numeric rounded-control border border-border bg-raised px-4 py-2.5 text-label font-bold text-foreground">
          {period}
        </span>
        <Button variant="outline" className="min-h-11" onClick={() => shiftPeriod(1)} aria-label={t("finance.tax.next")}>
          {t("finance.tax.next")}
        </Button>
        <Button className="ml-auto min-h-11" onClick={downloadCsv} disabled={downloading}>
          <Download className="size-4" aria-hidden="true" />
          {downloading ? t("finance.sending") : t("finance.tax.download")}
        </Button>
      </div>

      {/* VAT summary cards */}
      {tax.loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-card" />
          ))}
        </div>
      ) : tax.error ? (
        <ErrorState message={tax.error} onRetry={tax.reload} />
      ) : tax.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={t("finance.tax.feeRevenue")} cents={tax.data.feeRevenueCents} />
          <KpiCard label={t("finance.tax.vatOutput")} cents={tax.data.vatOutputCents} gold />
          <KpiCard label={t("finance.tax.vatReversals")} cents={tax.data.vatReversalsCents} />
          <KpiCard label={t("finance.tax.vatDue")} cents={tax.data.vatDueCents} gold />
        </div>
      ) : null}

      {/* VAT ledger entries */}
      <div className="rounded-card border border-border bg-raised">
        <div className="border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.tax.entries")}</h3>
        </div>
        {tax.loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (tax.data?.entries ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Landmark className="size-8" />}
              title={t("finance.tax.empty")}
              body={t("finance.tax.emptyBody")}
            />
          </div>
        ) : (
          <div className="max-h-96 overflow-auto ts-scrollbar">
            <table className="w-full text-caption">
              <thead className="sticky top-0 bg-raised">
                <tr className="border-b border-border/70 text-left text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5 font-bold">{t("finance.ledger.when")}</th>
                  <th scope="col" className="px-2 py-2.5 font-bold">{t("finance.ledger.tx")}</th>
                  <th scope="col" className="px-2 py-2.5 font-bold">{t("finance.col.order")}</th>
                  <th scope="col" className="px-2 py-2.5 font-bold">{t("finance.recon.direction")}</th>
                  <th scope="col" className="px-3 py-2.5 font-bold text-right">{t("finance.col.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {(tax.data?.entries ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-border/40">
                    <td className="ts-numeric whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(e.ts)}
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-bold text-foreground">{e.balancedTx}</span>
                      <span className="block text-muted-foreground">{e.txType}</span>
                    </td>
                    <td className="ts-numeric px-2 py-2">{e.orderRef ? `#${e.orderRef}` : "—"}</td>
                    <td className="px-2 py-2">
                      {e.direction === "credit" ? (
                        <MoneyChip tone="ok">{t("finance.ledger.credit")}</MoneyChip>
                      ) : (
                        <MoneyChip tone="danger">{t("finance.ledger.debit")}</MoneyChip>
                      )}
                    </td>
                    <td className="ts-numeric px-3 py-2 text-right font-bold text-foreground">
                      {formatUSD(e.amountCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* money rules (config) */}
      <div className="rounded-card border border-border bg-raised">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <h3 className="text-label font-bold text-foreground">{t("finance.rules.title")}</h3>
          <Button variant="ghost" className="ml-auto min-h-11" onClick={() => setRulesOpen(true)}>
            {t("finance.rules.edit")}
          </Button>
        </div>
        {config.loading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-9 w-full" />
          </div>
        ) : config.error ? (
          <div className="p-4">
            <ErrorState message={config.error} onRetry={config.reload} />
          </div>
        ) : cfg ? (
          <div className="grid gap-x-6 gap-y-1.5 p-4 text-caption sm:grid-cols-2 lg:grid-cols-3">
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.feePct")}</span>
              <span className="font-bold text-foreground">{Math.round(cfg.fee_pct * 100)}%</span>
            </span>
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.feeCap")}</span>
              <span className="font-bold text-foreground">{formatUSD(cfg.fee_cap)}</span>
            </span>
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.vatPct")}</span>
              <span className="font-bold text-foreground">{Math.round(cfg.vat_pct * 100)}%</span>
            </span>
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.payoutMin")}</span>
              <span className="font-bold text-foreground">{formatUSD(cfg.payout_min)}</span>
            </span>
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.dualThreshold")}</span>
              <span className="font-bold text-foreground">{formatUSD(cfg.dual_approval_threshold)}</span>
            </span>
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.refundAutoMax")}</span>
              <span className="font-bold text-foreground">{formatUSD(cfg.refund_auto_max)}</span>
            </span>
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.featuredFee")}</span>
              <span className="font-bold text-foreground">{formatUSD(cfg.featured_fee)}</span>
            </span>
            <span className="ts-numeric flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.escrowDays")}</span>
              <span className="font-bold text-foreground">{cfg.escrow_days}</span>
            </span>
            <span className="flex justify-between">
              <span className="text-muted-foreground">{t("finance.rules.currency")}</span>
              <span className="font-bold text-foreground">{cfg.currency}</span>
            </span>
          </div>
        ) : null}
      </div>

      <RulesDialog
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        token={token}
        config={cfg ?? null}
        onDone={() => config.reload()}
      />
    </div>
  );
}

function RulesDialog({
  open,
  onClose,
  token,
  config,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  config: MoneyConfigPayload["config"] | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const val = (key: keyof MoneyConfigPayload["config"]) =>
    form[key] ?? (config ? String(config[key]) : "");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, number | string> = {};
      for (const key of [
        "fee_pct",
        "fee_cap",
        "featured_fee",
        "vat_pct",
        "payout_min",
        "dual_approval_threshold",
        "escrow_days",
        "refund_auto_max",
      ] as const) {
        const raw = val(key).trim();
        if (raw === "") continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          setError(t("finance.rules.badNumber"));
          setBusy(false);
          return;
        }
        body[key] = n;
      }
      await adminFetch(token, "/config", { method: "POST", body: JSON.stringify(body) });
      toast({ title: t("finance.rules.saved") });
      setForm({});
      onClose();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("finance.console.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("finance.rules.title")}</DialogTitle>
          <DialogDescription>{t("finance.rules.sub")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["fee_pct", t("finance.rules.feePct"), "0.08"],
              ["fee_cap", t("finance.rules.feeCap"), "50"],
              ["vat_pct", t("finance.rules.vatPct"), "0.15"],
              ["payout_min", t("finance.rules.payoutMin"), "10"],
              ["dual_approval_threshold", t("finance.rules.dualThreshold"), "100"],
              ["refund_auto_max", t("finance.rules.refundAutoMax"), "20"],
              ["featured_fee", t("finance.rules.featuredFee"), "2"],
              ["escrow_days", t("finance.rules.escrowDays"), "7"],
            ] as const
          ).map(([key, label, ph]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`rule-${key}`}>{label}</Label>
              <Input
                id={`rule-${key}`}
                inputMode="decimal"
                className="ts-numeric min-h-11"
                placeholder={ph}
                value={val(key)}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        {error ? (
          <p role="alert" className="text-caption font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="min-h-11" onClick={onClose}>
            {t("finance.cancel")}
          </Button>
          <Button className="min-h-11" onClick={submit} disabled={busy}>
            {busy ? t("finance.sending") : t("finance.rules.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── page-level skeleton (auth restoring) ───────────────────────────────

export function AdminPageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading Finance console">
      <Skeleton className="h-7 w-56" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-24 rounded-full shrink-0" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-card" />
    </div>
  );
}
