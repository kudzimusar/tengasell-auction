"use client"
// ── Admin › Listings & Orders — moderation queue + order inspection ──
import { useState } from "react"
import { CheckCircle2, XCircle, PauseCircle, PlayCircle, StopCircle, Eye } from "lucide-react"
import { useApp, tr } from "@/lib/tengasell/store"
import {
  AdminPage, AdminTable, Col, StatusPill, SearchBox, AdminTabs, ActionDialog, useList, useOne,
  useMutate, useReasonCodes, usd, fmtDT, KV, LoadBox, timeAgo,
} from "../kit"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"

type Row = Record<string, any>

const LISTING_TABS = ["PENDING_REVIEW", "ACTIVE", "SUSPENDED", "REJECTED", "ENDED", "SOLD", "DRAFT", "ALL"]

export function ListingsSection() {
  const { locale } = useApp()
  const tt = (en: string, ja: string) => tr(locale, en, ja)
  const [tab, setTab] = useState("PENDING_REVIEW")
  const [q, setQ] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/listings", { status: tab, q })
  const codes = useReasonCodes()
  const { run, busy } = useMutate()
  const [dialog, setDialog] = useState<{ act: string; row: Row } | null>(null)

  const doAction = async (reason: string, note: string) => {
    if (!dialog) return false
    const ok = await run(`/api/admin/listings/${dialog.row.id}/action`, {
      action: dialog.act, reasonCode: reason || "seller.education", note,
    }, tt("Listing updated", "出品を更新しました"))
    if (ok) reload()
    return ok
  }

  const columns: Col<Row>[] = [
    { key: "title", header: tt("Listing", "出品"), cell: (r) => (
      <div className="min-w-44">
        <p className="font-medium truncate max-w-56">{r.title}</p>
        <p className="text-xs text-muted-foreground">
          {r.seller?.shopName || r.seller?.name} · {r.type === "AUCTION" ? tt("Auction", "オークション") : "Buy-now"} · {r.category}
        </p>
      </div>
    ) },
    { key: "currentPrice", header: tt("Price", "価格"), cell: (r) => <span className="tabular-nums font-semibold">{usd(r.currentPrice)}</span> },
    { key: "stats", header: tt("Bids / Views", "入札・閲覧"), cell: (r) => (
      <span className="text-xs text-muted-foreground tabular-nums">{r.bidCount} / {r.viewCount}</span>
    ) },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "createdAt", header: tt("Created", "作成"), cell: (r) => <span className="text-xs">{fmtDT(r.createdAt)}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => (
      <div className="flex justify-end gap-1.5 flex-wrap">
        {["PENDING_REVIEW", "REJECTED"].includes(r.status) && (
          <Button size="sm" className="h-9 bg-emerald-700 hover:bg-emerald-800" onClick={() => setDialog({ act: "APPROVE", row: r })}>
            <CheckCircle2 className="w-3.5 h-3.5" />{tt("Approve", "承認")}
          </Button>
        )}
        {r.status === "PENDING_REVIEW" && (
          <Button size="sm" variant="outline" className="h-9 text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950" onClick={() => setDialog({ act: "REJECT", row: r })}>
            <XCircle className="w-3.5 h-3.5" />{tt("Reject", "却下")}
          </Button>
        )}
        {r.status === "ACTIVE" && (
          <>
            <Button size="sm" variant="outline" className="h-9 text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950" onClick={() => setDialog({ act: "SUSPEND", row: r })}>
              <PauseCircle className="w-3.5 h-3.5" />{tt("Suspend", "停止")}
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => setDialog({ act: "END", row: r })}>
              <StopCircle className="w-3.5 h-3.5" />{tt("End", "終了")}
            </Button>
          </>
        )}
        {["SUSPENDED", "REJECTED"].includes(r.status) && (
          <Button size="sm" variant="outline" className="h-9 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950" onClick={() => setDialog({ act: "REINSTATE", row: r })}>
            <PlayCircle className="w-3.5 h-3.5" />{tt("Reinstate", "再開")}
          </Button>
        )}
      </div>
    ) },
  ]

  return (
    <AdminPage title={tt("Listings", "出品管理")} desc={tt("Moderation queue — approve, reject, suspend or end listings. Every decision notifies the seller and is audited with a version snapshot.", "審査キュー。承認・却下・停止・終了。すべて出品者へ通知され、監査＋バージョンスナップショットが記録されます。")}>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No listings in this state", "この状態の出品なし")}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={tt("Search title…", "タイトル検索…")} />
          <AdminTabs value={tab} onChange={setTab} tabs={LISTING_TABS.map((t) => ({ key: t, label: t === "ALL" ? tt("All", "すべて") : t === "PENDING_REVIEW" ? tt("In review", "審査待ち") : t }))} />
        </>}
      />
      <ActionDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog ? `${dialog.act} — ${dialog.row.title?.slice(0, 40)}` : ""}
        description={
          dialog?.act === "REJECT" || dialog?.act === "SUSPEND"
            ? tt("The seller is notified with the reason code and your note.", "理由コードとメモが出品者へ通知されます。")
            : tt("A ListingVersion snapshot is recorded with your decision.", "判断と共にバージョンスナップショットを記録します。")
        }
        reasonCodes={codes}
        requireReason={dialog?.act === "REJECT" || dialog?.act === "SUSPEND"}
        submitLabel={tt("Confirm", "確定")}
        danger={dialog?.act === "REJECT" || dialog?.act === "SUSPEND"}
        busy={busy}
        onSubmit={doAction}
      />
    </AdminPage>
  )
}

const ORDER_TABS = ["ALL", "PENDING_PAYMENT", "PAID", "SHIPPED", "DELIVERED", "COMPLETED", "DISPUTED", "REFUND_PENDING", "REFUNDED", "CANCELLED"]

export function OrdersSection() {
  const { locale } = useApp()
  const tt = (en: string, ja: string) => tr(locale, en, ja)
  const [tab, setTab] = useState("ALL")
  const [q, setQ] = useState("")
  const { rows, total, page, setPage, loading } = useList("/api/admin/orders", { status: tab, q })
  const [detail, setDetail] = useState<Row | null>(null)

  const columns: Col<Row>[] = [
    { key: "id", header: tt("Order", "注文"), cell: (r) => (
      <div className="min-w-44">
        <p className="font-medium truncate max-w-56">{r.listingTitle}</p>
        <p className="text-xs text-muted-foreground">…{r.id.slice(-6)} · {fmtDT(r.placedAt)}</p>
      </div>
    ) },
    { key: "buyer", header: tt("Buyer", "購入者"), cell: (r) => <span className="text-sm">{r.buyerName}</span> },
    { key: "seller", header: tt("Seller", "出品者"), cell: (r) => <span className="text-sm">{r.sellerShop}</span> },
    { key: "amount", header: tt("Amount", "金額"), cell: (r) => <span className="tabular-nums font-semibold">{usd(r.totalCharged)}</span> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "act", header: "", className: "text-right", cell: (r) => (
      <Button variant="outline" size="sm" className="h-9" onClick={() => setDetail(r)}><Eye className="w-3.5 h-3.5" /></Button>
    ) },
  ]

  return (
    <AdminPage title={tt("Orders", "注文")} desc={tt("Inspect-only console: events, payments, refunds and disputes. Order state is never mutated from admin (transaction engine owns transitions).", "閲覧専用：イベント・支払・返金・紛争を確認。注文状態は取引エンジンのみが変更します。")}>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No orders match", "該当注文なし")}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={tt("Search order id…", "注文ID検索…")} />
          <AdminTabs value={tab} onChange={setTab} tabs={ORDER_TABS.map((t) => ({ key: t, label: t === "ALL" ? tt("All", "すべて") : t }))} />
        </>}
      />
      <OrderDetailSheet row={detail} onClose={() => setDetail(null)} />
    </AdminPage>
  )
}

function OrderDetailSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const { locale, setView } = useApp()
  const tt = (en: string, ja: string) => tr(locale, en, ja)
  const { data, loading } = useOne<any>(row ? `/api/admin/orders/${row.id}` : null)
  const d = data
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto tgs-scroll p-4 sm:p-6">
        <SheetHeader className="p-0">
          <SheetTitle>{d?.listing?.title || row?.listingTitle || tt("Order", "注文")}</SheetTitle>
          <SheetDescription>…{(row?.id || "").slice(-8)}</SheetDescription>
        </SheetHeader>
        <LoadBox loading={loading}>
          {d && (
            <div className="space-y-5 mt-4">
              <div className="flex flex-wrap gap-2 items-center">
                <StatusPill status={d.order.status} />
                <span className="text-xs text-muted-foreground">{d.order.type} · {fmtDT(d.order.placedAt)}</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Money", "金銭")}</p>
                <KV k={tt("Item amount", "商品額")} v={usd(d.order.amount)} />
                <KV k={tt("Buyer fee", "購入者手数料")} v={usd(d.order.buyerFee)} />
                <KV k={tt("Total charged", "請求合計")} v={<span className="text-primary font-bold">{usd(d.order.totalCharged)}</span>} />
                <KV k={tt("Seller fee", "出品者手数料")} v={usd(d.order.sellerFee)} />
                <KV k={tt("VAT", "付加価値税")} v={usd(d.order.vatAmount)} />
                <KV k={tt("Payment", "支払")} v={d.payment ? `${d.payment.method} · ${d.payment.status}` : "—"} />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Parties", "当事者")}</p>
                <KV k={tt("Buyer", "購入者")} v={d.buyer?.name} />
                <KV k={tt("Seller", "出品者")} v={d.seller?.shopName || d.seller?.name} />
                <KV k={tt("Carrier", "配送業者")} v={d.order.carrier || "—"} />
                <KV k={tt("Tracking", "追跡番号")} v={d.order.trackingCode || "—"} />
              </div>
              {d.dispute && (
                <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-red-700 dark:text-red-400">{tt("Dispute", "紛争")}</p>
                    <StatusPill status={d.dispute.status} size="xs" />
                  </div>
                  <p className="text-xs">{d.dispute.reason}</p>
                  <Button size="sm" variant="outline" className="h-9" onClick={() => { onClose(); setView({ name: "admin", section: "disputes" }) }}>
                    {tt("Go to dispute →", "紛争へ移動 →")}
                  </Button>
                </div>
              )}
              {d.refunds?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Refunds", "返金")}</p>
                  {d.refunds.map((rf: Row) => (
                    <KV key={rf.id} k={`${usd(rf.amount)} · ${rf.type} · ${rf.reason}`} v={<StatusPill status={rf.status} size="xs" />} />
                  ))}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Event timeline", "イベント履歴")}</p>
                <div className="space-y-2 max-h-72 overflow-y-auto tgs-scroll">
                  {(d.events || []).map((e: Row) => (
                    <div key={e.id} className="flex gap-2.5 text-xs">
                      <span className="mt-1 w-2 h-2 rounded-full bg-primary shrink-0" aria-hidden />
                      <div className="border-b border-dashed flex-1 pb-1.5">
                        <p className="font-semibold">{e.type}</p>
                        <p className="text-muted-foreground">{e.data ? e.data.slice(0, 120) : ""}</p>
                        <p className="text-muted-foreground/70">{fmtDT(e.createdAt)}{timeAgo(e.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                  {(!d.events || d.events.length === 0) && <p className="text-xs text-muted-foreground">{tt("No events", "イベントなし")}</p>}
                </div>
              </div>
            </div>
          )}
        </LoadBox>
      </SheetContent>
    </Sheet>
  )
}
