"use client"
// ── Admin › Finance — refunds, ledger, payouts, reconciliation, invoices/tax, close ──
import { useState } from "react"
import { Plus, RefreshCw, Lock } from "lucide-react"
import {
  AdminPage, AdminTable, Col, StatusPill, SearchBox, AdminTabs, useList, useOne,
  useMutate, useReasonCodes, usd, fmtDT, LoadBox, Labeled, DialogShell, useTT, Check,
} from "../kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Row = Record<string, any>

// ── Refunds (queue + new request) ───────────────────────────────
export function RefundsSection() {
  const tt = useTT()
  const [status, setStatus] = useState("ALL")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/refunds", { status })
  const codes = useReasonCodes()
  const { run, busy } = useMutate()
  const [creating, setCreating] = useState(false)
  const [orderId, setOrderId] = useState("")
  const [amount, setAmount] = useState("")
  const [type, setType] = useState("FULL")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")

  const createRefund = async () => {
    const ok = await run("/api/admin/refunds", {
      orderId: orderId.trim(), amount: Number(amount), type, reasonCode: reason || "buyer_rematch", note,
    }, tt("Refund requested — awaiting second approver", "返金を申請しました。承認待ち"))
    if (ok) { setCreating(false); setOrderId(""); setAmount(""); setReason(""); setNote(""); reload() }
  }

  const columns: Col<Row>[] = [
    { key: "order", header: tt("Order", "注文"), cell: (r) => (
      <div>
        <p className="font-medium">…{(r.orderId || "").slice(-8)}</p>
        <p className="text-xs text-muted-foreground">{r.listingTitle || ""} · {timeAgoFmt(r.createdAt)}</p>
      </div>
    ) },
    { key: "amount", header: tt("Amount", "金額"), cell: (r) => <span className="tabular-nums font-semibold">{usd(r.amount)}</span> },
    { key: "type", header: tt("Type", "種別"), cell: (r) => <StatusPill status="info" size="xs">{r.type}</StatusPill> },
    { key: "reason", header: tt("Reason", "理由"), cell: (r) => <p className="text-xs max-w-40 truncate">{r.reason}</p> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "approval", header: tt("Approval", "承認"), cell: (r) => r.approvalStatus
      ? <StatusPill status={r.approvalStatus === "PENDING" ? "PENDING" : r.approvalStatus === "APPROVED" ? "APPROVED" : "REJECTED"} size="xs" />
      : <span className="text-xs text-muted-foreground">—</span> },
  ]

  return (
    <AdminPage
      title={tt("Refunds", "返金")}
      desc={tt("Requests queue for dual approval (CTL-021): a second finance/admin approves before money moves and ledger reverses.", "二重承認キュー（CTL-021）：別の財務/管理者が承認してはじめて返金・帳簿逆仕訳が実行されます。")}
      action={<Button size="sm" className="h-10" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{tt("New refund request", "返金申請")}</Button>}
    >
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No refunds", "返金なし")}
        toolbar={<AdminTabs value={status} onChange={setStatus} tabs={[
          { key: "ALL", label: tt("All", "すべて") },
          { key: "REQUESTED", label: tt("Requested", "申請中") },
          { key: "APPROVED", label: tt("Approved", "承認済") },
          { key: "PROCESSED", label: tt("Processed", "処理済") },
          { key: "REJECTED", label: tt("Rejected", "却下") },
        ]} />}
      />
      <DialogShell
        open={creating} onOpenChange={setCreating}
        title={tt("New refund request", "返金申請")}
        description={tt("Creates Refund REQUESTED + approval request. A different staff member must approve.", "REQUESTEDの返金と承認リクエストを作成。別の担当者が承認する必要があります。")}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setCreating(false)}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={!orderId.trim() || !amount || busy} onClick={createRefund}>{tt("Submit request", "申請する")}</Button>
          </>
        }
      >
        <div className="space-y-3 py-1">
          <Labeled label={tt("Order ID", "注文ID")} hint={tt("Full order id from the orders table", "注文テーブルの完全なID")}>
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="order id…" className="h-10 font-mono text-xs" />
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label={tt("Amount (USD)", "金額")}>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0.01" step="0.01" className="h-10" />
            </Labeled>
            <Labeled label={tt("Type", "種別")}>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-10" aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL">FULL</SelectItem>
                  <SelectItem value="PARTIAL">PARTIAL</SelectItem>
                </SelectContent>
              </Select>
            </Labeled>
          </div>
          <Labeled label={tt("Reason code", "理由コード")}>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-10" aria-label="Reason"><SelectValue placeholder={tt("Select…", "選択…")} /></SelectTrigger>
              <SelectContent>
                {codes.map((c) => <SelectItem key={c.key} value={c.key}>{tt(c.label, c.labelJa || c.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label={tt("Note", "メモ")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={tt("Context for the approver…", "承認者への補足…")} />
          </Labeled>
        </div>
      </DialogShell>
    </AdminPage>
  )
}

function timeAgoFmt(d: string) {
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 86_400_000) return `${Math.max(1, Math.floor(ms / 3_600_000))}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

// ── Ledger ─────────────────────────────────────────────────────
const ACCOUNTS = ["ALL", "BUYER_PAYMENTS", "SELLER_PAYABLE", "PLATFORM_REVENUE", "VAT_PAYABLE", "BUYER_REFUNDS", "PAYOUT_CLEARING", "PETTY_CASH"]

export function LedgerSection() {
  const tt = useTT()
  const [account, setAccount] = useState("ALL")
  const [orderRef, setOrderRef] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/finance/ledger", { account, orderRef })
  const { data, loading: loadingB } = useOne<{ balances: Record<string, number> }>("/api/admin/finance/ledger?limit=1")
  const balances = data?.balances || {}
  const accounts = Object.entries(balances).filter(([, v]) => Math.abs(v) > 0.001)

  const columns: Col<Row>[] = [
    { key: "createdAt", header: tt("Posted", "記帳日"), cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDT(r.createdAt)}</span> },
    { key: "account", header: tt("Account", "勘定"), cell: (r) => <span className="text-xs font-semibold">{r.account}</span> },
    { key: "direction", header: tt("Dr/Cr", "借/貸"), cell: (r) => (
      <StatusPill status="info" size="xs" tone={r.direction === "DEBIT" ? "gold" : "good"}>{r.direction === "DEBIT" ? "DR" : "CR"}</StatusPill>
    ) },
    { key: "amount", header: tt("Amount", "金額"), cell: (r) => <span className="tabular-nums font-semibold">{usd(r.amount)}</span> },
    { key: "memo", header: tt("Memo", "摘要"), cell: (r) => <p className="text-xs max-w-56 truncate">{r.memo}</p> },
    { key: "orderRef", header: tt("Ref", "参照"), cell: (r) => r.orderRef ? <span className="text-[10px] font-mono text-muted-foreground">…{r.orderRef.slice(-8)}</span> : "—" },
  ]

  return (
    <AdminPage title={tt("General ledger", "総勘定元帳")} desc={tt("Double-entry postings. Balance per account = Σ debits − Σ credits.", "複式記帳。勘定残高＝借方合計−貸方合計。")}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {loadingB ? (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-lg border animate-pulse bg-muted/40" />)
        ) : (
          accounts.length === 0 ? <p className="text-sm text-muted-foreground col-span-6">{tt("No postings yet", "記帳なし")}</p> :
          accounts.map(([a, v]) => (
            <div key={a} className="rounded-lg border bg-card p-3 shadow-sm">
              <p className="text-[10px] text-muted-foreground font-semibold truncate">{a}</p>
              <p className={`text-sm font-bold tabular-nums ${v < 0 ? "text-red-600" : ""}`}>{usd(v)}</p>
            </div>
          ))
        )}
      </div>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No entries", "記帳なし")}
        toolbar={<>
          <SearchBox value={orderRef} onChange={setOrderRef} placeholder={tt("Search order ref…", "注文参照検索…")} />
          <AdminTabs value={account} onChange={setAccount} tabs={ACCOUNTS.map((a) => ({ key: a, label: a === "ALL" ? tt("All accounts", "全勘定") : a }))} />
          <Button variant="outline" size="sm" className="h-9" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </>}
      />
    </AdminPage>
  )
}

// ── Payouts ─────────────────────────────────────────────────────
export function PayoutsSection() {
  const tt = useTT()
  const [status, setStatus] = useState("ALL")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/finance/payouts", { status })
  const { rows: sellers } = useList("/api/admin/sellers", { status: "VERIFIED" })
  const { run, busy } = useMutate()
  const [creating, setCreating] = useState(false)
  const [sellerId, setSellerId] = useState("")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [reversing, setReversing] = useState<Row | null>(null)
  const [revNote, setRevNote] = useState("")

  const createPayout = async () => {
    const ok = await run("/api/admin/finance/payouts", {
      sellerId, amount: Number(amount), note,
    }, tt("Payout requested — awaiting approval", "送金を申請しました。承認待ち"))
    if (ok) { setCreating(false); setSellerId(""); setAmount(""); setNote(""); reload() }
  }

  const columns: Col<Row>[] = [
    { key: "seller", header: tt("Seller", "出品者"), cell: (r) => (
      <div>
        <p className="font-medium">{r.sellerShop || r.sellerName}</p>
        <p className="text-xs text-muted-foreground">{r.sellerEmail}</p>
      </div>
    ) },
    { key: "amount", header: tt("Amount", "金額"), cell: (r) => <span className="tabular-nums font-semibold">{usd(r.amount)}</span> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "batchRef", header: tt("Batch", "バッチ"), cell: (r) => <span className="text-xs font-mono">{r.batchRef || "—"}</span> },
    { key: "createdAt", header: tt("Requested", "申請日"), cell: (r) => <span className="text-xs">{fmtDT(r.createdAt)}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => r.status === "PAID" && (
      <Button size="sm" variant="outline" className="h-9 text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
        onClick={() => { setReversing(r); setRevNote("") }}>
        {tt("Reverse…", "取消…")}
      </Button>
    ) },
  ]

  return (
    <AdminPage
      title={tt("Seller payouts", "出品者送金")}
      desc={tt("Payout creation is dual-approved (CTL-021). Balance check: seller payable credits − debits.", "送金作成は二重承認（CTL-021）。残高＝売掛貸方−借方。")}
      action={<Button size="sm" className="h-10" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{tt("New payout", "送金作成")}</Button>}
    >
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No payouts", "送金なし")}
        toolbar={<AdminTabs value={status} onChange={setStatus} tabs={[
          { key: "ALL", label: tt("All", "すべて") },
          { key: "PENDING", label: tt("Pending", "承認待ち") },
          { key: "PAID", label: tt("Paid", "送金済") },
          { key: "FAILED", label: tt("Failed", "失敗") },
          { key: "REVERSED", label: tt("Reversed", "取消") },
        ]} />}
      />
      <DialogShell
        open={creating} onOpenChange={setCreating}
        title={tt("New payout", "送金作成")}
        description={tt("Creates Payout PENDING + approval request; a second finance/admin approves to pay.", "PENDING送金と承認リクエストを作成。別の財務/管理者の承認で送金されます。")}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setCreating(false)}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={!sellerId || !amount || busy} onClick={createPayout}>{tt("Submit request", "申請する")}</Button>
          </>
        }
      >
        <div className="space-y-3 py-1">
          <Labeled label={tt("Seller", "出品者")}>
            <Select value={sellerId} onValueChange={setSellerId}>
              <SelectTrigger className="h-10" aria-label="Seller"><SelectValue placeholder={tt("Select verified seller…", "承認済み出品者を選択…")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {sellers.map((s) => <SelectItem key={s.userId} value={s.userId}>{s.shopName} — {s.user?.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label={tt("Amount (USD)", "金額")} hint={tt("Must not exceed the seller's payable balance.", "売掛残高を超えないこと。")}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0.01" step="0.01" className="h-10" />
          </Labeled>
          <Labeled label={tt("Note", "メモ")}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Labeled>
        </div>
      </DialogShell>
      <DialogShell
        open={!!reversing} onOpenChange={(o) => !o && setReversing(null)}
        title={tt("Reverse payout", "送金取消")}
        description={reversing ? `${usd(reversing.amount)} → ${reversing.sellerShop || "seller"}. Ledger reversal is posted; audited.` : ""}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setReversing(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button variant="destructive" className="h-10" disabled={!revNote.trim() || busy}
              onClick={async () => {
                if (!reversing) return
                const ok = await run(`/api/admin/finance/payouts/${reversing.id}/reverse`, { note: revNote }, tt("Payout reversed", "送金を取消しました"))
                if (ok) { setReversing(null); reload() }
              }}>{tt("Reverse payout", "送金取消")}</Button>
          </>
        }
      >
        <Labeled label={tt("Note (required)", "メモ（必須）")}>
          <Textarea value={revNote} onChange={(e) => setRevNote(e.target.value)} rows={3} placeholder={tt("Why is this payout being reversed?", "取消の理由は？")} />
        </Labeled>
      </DialogShell>
    </AdminPage>
  )
}

// ── Reconciliation ──────────────────────────────────────────────
export function ReconciliationSection() {
  const tt = useTT()
  const { data, loading, reload } = useOne<{ items: Row[] }>("/api/admin/finance/reconciliation")
  const { run, busy } = useMutate()
  const runs = data?.items || []
  const last = runs[0]

  return (
    <AdminPage
      title={tt("Reconciliation", "照合")}
      desc={tt("Payments captured vs ledger postings. Variance over $0.01 is flagged.", "消込み済み支払と帳簿記帳の照合。$0.01超の差異はフラグ。")}
      action={
        <Button size="sm" className="h-10" disabled={busy} onClick={async () => {
          const ok = await run("/api/admin/finance/reconciliation", {}, tt("Reconciliation run completed", "照合を実行しました"))
          if (ok) reload()
        }}><RefreshCw className="w-4 h-4" />{tt("Run now", "今すぐ実行")}</Button>
      }
    >
      {last && (
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-semibold">{tt("Latest run", "最新実行")} · {fmtDT(last.ranAt)} · {last.runByName || "—"}</p>
            <StatusPill status={last.status} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground font-semibold">{tt("Expected (payments)", "想定（支払）")}</p>
              <p className="font-bold tabular-nums">{usd(num(last.expected, "total"))}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground font-semibold">{tt("Actual (ledger)", "実績（帳簿）")}</p>
              <p className="font-bold tabular-nums">{usd(num(last.actual, "total"))}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground font-semibold">{tt("Variance", "差異")}</p>
              <p className={`font-bold tabular-nums ${Math.abs(num(last.variance, "amount")) > 0.01 ? "text-red-600" : "text-emerald-600"}`}>{usd(num(last.variance, "amount"))}</p>
            </div>
            <div className="rounded-lg bg-secondary/50 p-3">
              <p className="text-[10px] text-muted-foreground font-semibold">{tt("Orders PAID sum", "PAID注文合計")}</p>
              <p className="font-bold tabular-nums">{usd(num(last.expected, "ordersPaid"))}</p>
            </div>
          </div>
        </div>
      )}
      <AdminTable
        columns={[
          { key: "ranAt", header: tt("Ran", "実行日"), cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDT(r.ranAt)}</span> },
          { key: "period", header: tt("Period", "期間"), cell: (r) => <span className="text-xs">{fmtDT(r.periodStart)} → {fmtDT(r.periodEnd)}</span> },
          { key: "expected", header: tt("Expected", "想定"), cell: (r) => <span className="tabular-nums">{usd(num(r.expected, "total"))}</span> },
          { key: "actual", header: tt("Actual", "実績"), cell: (r) => <span className="tabular-nums">{usd(num(r.actual, "total"))}</span> },
          { key: "variance", header: tt("Variance", "差異"), cell: (r) => <span className={`tabular-nums font-semibold ${Math.abs(num(r.variance, "amount")) > 0.01 ? "text-red-600" : "text-emerald-600"}`}>{usd(num(r.variance, "amount"))}</span> },
          { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
          { key: "runBy", header: tt("By", "実行者"), cell: (r) => <span className="text-xs">{r.runByName || "—"}</span> },
        ]}
        rows={runs} loading={loading} empty={tt("No runs yet — run one", "実行なし。今すぐ実行を")}
      />
    </AdminPage>
  )
}

function num(obj: unknown, key: string): number {
  if (!obj || typeof obj !== "object") return 0
  const v = (obj as Record<string, unknown>)[key]
  return typeof v === "number" ? v : 0
}

// ── Invoices & Tax ──────────────────────────────────────────────
export function InvoicesSection() {
  const tt = useTT()
  const [tab, setTab] = useState("invoices")
  return (
    <AdminPage title={tt("Invoices & Tax", "請求書・税務")} desc={tt("Sequential invoices and VAT lines with remittance tracking.", "連番請求書と付加価値税の納付管理。")}>
      <AdminTabs value={tab} onChange={setTab} tabs={[
        { key: "invoices", label: tt("Invoices", "請求書") },
        { key: "tax", label: tt("Tax lines", "税行") },
      ]} />
      {tab === "invoices" && <InvoicesTab />}
      {tab === "tax" && <TaxTab />}
    </AdminPage>
  )
}

function InvoicesTab() {
  const tt = useTT()
  const { rows, total, page, setPage, loading } = useList("/api/admin/finance/invoices", {})
  return (
    <AdminTable
      columns={[
        { key: "number", header: tt("Number", "番号"), cell: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
        { key: "kind", header: tt("Kind", "種類"), cell: (r) => <StatusPill status="info" size="xs">{r.kind}</StatusPill> },
        { key: "to", header: tt("Issued to", "宛先"), cell: (r) => <span className="text-sm">{r.toUserName || "…" + (r.toUserId || "").slice(-6)}</span> },
        { key: "total", header: tt("Total", "合計"), cell: (r) => <span className="tabular-nums font-semibold">{usd(r.total)}</span> },
        { key: "vat", header: tt("VAT", "付加価値税"), cell: (r) => <span className="tabular-nums">{usd(r.vatAmount)}</span> },
        { key: "issuedAt", header: tt("Issued", "発行日"), cell: (r) => <span className="text-xs">{fmtDT(r.issuedAt)}</span> },
      ]}
      rows={rows} loading={loading} total={total} page={page} onPage={setPage}
      empty={tt("No invoices", "請求書なし")}
    />
  )
}

function TaxTab() {
  const tt = useTT()
  const { data, loading, reload } = useOne<{ items: Row[]; summary: { total: number; remitted: number; unremitted: number } }>("/api/admin/finance/tax")
  const { run, busy } = useMutate()
  const items = data?.items || []
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 max-w-md">
        <div className="rounded-lg border bg-card p-3"><p className="text-[10px] text-muted-foreground font-semibold">{tt("VAT total", "付加価値税合計")}</p><p className="font-bold tabular-nums">{usd(data?.summary?.total || 0)}</p></div>
        <div className="rounded-lg border bg-card p-3"><p className="text-[10px] text-muted-foreground font-semibold">{tt("Remitted", "納付済")}</p><p className="font-bold tabular-nums text-emerald-600">{usd(data?.summary?.remitted || 0)}</p></div>
        <div className="rounded-lg border bg-card p-3"><p className="text-[10px] text-muted-foreground font-semibold">{tt("Outstanding", "未納")}</p><p className="font-bold tabular-nums text-amber-600">{usd(data?.summary?.unremitted || 0)}</p></div>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">{picked.length} selected</p>
        <Button size="sm" className="h-9" disabled={picked.length === 0 || busy}
          onClick={async () => {
            const ok = await run("/api/admin/finance/tax", { taxLineIds: picked }, tt("Marked remitted", "納付済にしました"))
            if (ok) { setPicked([]); reload() }
          }}>
          <Check ok />{tt("Mark remitted", "納付済にする")}
        </Button>
      </div>
      <AdminTable
        columns={[
          { key: "pick", header: "", cell: (r) => !r.remitted && (
            <input type="checkbox" className="w-4 h-4 accent-[#1a7a8a]" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Pick ${r.id}`} />
          ) },
          { key: "order", header: tt("Order", "注文"), cell: (r) => <span className="font-mono text-[10px]">…{(r.orderId || "").slice(-8)}</span> },
          { key: "kind", header: tt("Kind", "種類"), cell: (r) => <span className="text-xs">{r.kind}</span> },
          { key: "rate", header: tt("Rate", "税率"), cell: (r) => <span className="tabular-nums text-xs">{r.rate}%</span> },
          { key: "amount", header: tt("Amount", "金額"), cell: (r) => <span className="tabular-nums font-semibold">{usd(r.amount)}</span> },
          { key: "remitted", header: tt("Remitted", "納付"), cell: (r) => <Check ok={r.remitted} /> },
        ]}
        rows={items} loading={loading} empty={tt("No tax lines", "税行なし")}
      />
    </div>
  )
}

// ── Month close ─────────────────────────────────────────────────
export function CloseSection() {
  const tt = useTT()
  const [period, setPeriod] = useState("")
  const { data, loading, reload } = useOne<{ current: Row | null; past: Row[] }>(period ? `/api/admin/finance/close?period=${encodeURIComponent(period)}` : "/api/admin/finance/close")
  const { run, busy } = useMutate()
  const current = data?.current
  const totals = (current?.totals || {}) as Record<string, number>
  const closing = period || current?.period || ""

  return (
    <AdminPage
      title={tt("Month close", "月次決算")}
      desc={tt("Close the books for a period. Closed periods are immutable.", "期間の帳簿を締めます。確定後の期間は変更不可。")}
      action={
        <div className="flex gap-2">
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="YYYY-MM" className="h-10 w-32 font-mono" aria-label="Period" />
          <Button size="sm" variant="outline" className="h-10" onClick={reload}>{tt("Load", "読込")}</Button>
          <Button size="sm" variant="destructive" className="h-10" disabled={!closing || busy || current?.status === "CLOSED"}
            onClick={async () => {
              const ok = await run("/api/admin/finance/close", { period: closing }, tt("Period closed", "期間を締めました"))
              if (ok) reload()
            }}>
            <Lock className="w-4 h-4" />{current?.status === "CLOSED" ? tt("Closed", "確定済") : tt("Close period", "期間締め")}
          </Button>
        </div>
      }
    >
      <LoadBox loading={loading}>
        {current ? (
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{tt("Period", "期間")}: <span className="font-mono">{current.period}</span></p>
              <StatusPill status={current.status} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="rounded-lg bg-secondary/50 p-3"><p className="text-[10px] text-muted-foreground font-semibold">GMV</p><p className="font-bold tabular-nums">{usd(totals.gmv)}</p></div>
              <div className="rounded-lg bg-secondary/50 p-3"><p className="text-[10px] text-muted-foreground font-semibold">{tt("Revenue", "収益")}</p><p className="font-bold tabular-nums">{usd(totals.revenue)}</p></div>
              <div className="rounded-lg bg-secondary/50 p-3"><p className="text-[10px] text-muted-foreground font-semibold">VAT</p><p className="font-bold tabular-nums">{usd(totals.vat)}</p></div>
              <div className="rounded-lg bg-secondary/50 p-3"><p className="text-[10px] text-muted-foreground font-semibold">{tt("Payouts", "送金")}</p><p className="font-bold tabular-nums">{usd(totals.payouts)}</p></div>
              <div className="rounded-lg bg-secondary/50 p-3"><p className="text-[10px] text-muted-foreground font-semibold">{tt("Refunds", "返金")}</p><p className="font-bold tabular-nums">{usd(totals.refunds)}</p></div>
            </div>
            {current.status === "CLOSED" && (
              <p className="text-xs text-muted-foreground">{tt("Closed by", "締め担当")}: {current.closedByName || "—"} · {fmtDT(current.closedAt)}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{tt("No period loaded", "期間未読込")}</p>
        )}
        <AdminTable
          columns={[
            { key: "period", header: tt("Period", "期間"), cell: (r) => <span className="font-mono font-semibold">{r.period}</span> },
            { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
            { key: "totals", header: tt("GMV / Rev / VAT", "GMV・収益・税") , cell: (r) => {
              const t = (r.totals || {}) as Record<string, number>
              return <span className="text-xs tabular-nums">{usd(t.gmv)} / {usd(t.revenue)} / {usd(t.vat)}</span>
            } },
            { key: "closedBy", header: tt("Closed", "締め日"), cell: (r) => <span className="text-xs">{r.closedAt ? `${r.closedByName || "—"} · ${fmtDT(r.closedAt)}` : "—"}</span> },
          ]}
          rows={data?.past || []} empty={tt("No closed periods yet", "確定済み期間なし")}
        />
      </LoadBox>
    </AdminPage>
  )
}
