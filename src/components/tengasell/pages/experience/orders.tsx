"use client"
// ── OrdersPage: Buying/Selling tabs, action buttons per lifecycle state, tracking,
// expandable event timeline, checkout / review / dispute / ship dialogs ──
import { useCallback, useEffect, useState } from "react"
import {
  CheckCircle2, ChevronDown, Clock, CreditCard, Flag, History, PackageCheck, Scale, Star, Truck, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, Price, SectionTitle, StatusBadge, fmtDate } from "../../ui"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { toast } from "@/hooks/use-toast"
import { ImageTile, TrackingLine } from "./bits"
import { CheckoutDialog, type ShippingInfo } from "./checkout"
import { DisputeDialog, ReviewDialog, ShipDialog } from "./dialogs"
import type { OrderCardData, OrderDetailData } from "./types"

const EVENT_LABELS: Record<string, [string, string]> = {
  PLACED: ["Order placed", "注文完了"],
  PAID: ["Payment captured", "支払い確定"],
  SHIPPED: ["Shipped", "発送済み"],
  DELIVERED: ["Delivered", "配達完了"],
  COMPLETED: ["Completed", "取引完了"],
  CANCELLED: ["Cancelled", "キャンセル"],
  DISPUTE_OPENED: ["Dispute opened", "紛争開始"],
  AUCTION_WON: ["Auction won", "落札"],
  REFUNDED: ["Refunded", "返金"],
}

export function OrdersPage() {
  const { locale, session, setView } = useApp()
  const [side, setSide] = useState<"buying" | "selling">("buying")
  const [result, setResult] = useState<{ key: string; items: OrderCardData[] } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])
  const key = `${session?.id || "anon"}:${side}:${reloadKey}`

  useEffect(() => {
    if (!session) return
    let alive = true
    api<{ items: OrderCardData[] }>(`/api/orders?side=${side}`)
      .then(r => { if (alive && r.ok) setResult({ key, items: r.data!.items }) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [key])

  const orders = result && result.key === key ? result.items : null

  if (!session) {
    return (
      <Empty icon="🧾" title={tr(locale, "Sign in to see your orders", "注文を見るにはログイン")} hint={tr(locale, "Track purchases, pay auctions won, and manage sales.", "購入・落札・販売を管理できます。")}>
        <Button className="mt-4 h-11" onClick={() => setView({ name: "auth" })}>{tr(locale, "Sign in", "ログイン")}</Button>
      </Empty>
    )
  }

  return (
    <div className="space-y-4">
      <SectionTitle><h1 className="text-lg inline-flex items-center gap-2">🧾 {tr(locale, "Orders", "注文")}</h1></SectionTitle>
      <Tabs value={side} onValueChange={v => setSide(v as "buying" | "selling")}>
        <TabsList className="grid grid-cols-2 h-11 w-full max-w-xs">
          <TabsTrigger value="buying" className="text-sm font-semibold">{tr(locale, "Buying", "購入")}</TabsTrigger>
          <TabsTrigger value="selling" className="text-sm font-semibold">{tr(locale, "Selling", "販売")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {orders === null ? (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 rounded-lg bg-muted animate-pulse border" />)}
        </div>
      ) : orders.length === 0 ? (
        <Empty
          icon={side === "buying" ? "🛍️" : "📦"}
          title={side === "buying" ? tr(locale, "No purchases yet", "購入履歴はまだありません") : tr(locale, "No sales yet", "販売履歴はまだありません")}
          hint={side === "buying" ? tr(locale, "Won auctions and buy-now orders appear here.", "落札・即決購入がここに表示されます。") : tr(locale, "When buyers pay, orders land here.", "バイヤーの支払い後にここに表示されます。")}
        >
          <Button variant="outline" className="mt-4 h-11" onClick={() => setView({ name: "home" })}>{tr(locale, "Browse the marketplace", "マーケットを見る")}</Button>
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {orders.map(o => <OrderRow key={o.id} o={o} onChanged={reload} />)}
        </ul>
      )}
    </div>
  )
}

function OrderRow({ o, onChanged }: { o: OrderCardData; onChanged: () => void }) {
  const { locale, setView, refreshSession } = useApp()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<OrderDetailData | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [shipOpen, setShipOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadDetail = async () => {
    const r = await api<OrderDetailData>(`/api/orders/${o.id}`)
    if (r.ok) setDetail(r.data!)
  }

  const toggleOpen = async (next: boolean) => {
    setOpen(next)
    if (next && !detail) await loadDetail()
  }

  const act = async (body: Record<string, unknown>, successTitle: string) => {
    setBusy(true)
    const r = await api(`/api/orders/${o.id}`, { method: "PATCH", body: JSON.stringify(body) })
    setBusy(false)
    if (!r.ok) {
      toast({ title: tr(locale, "Action failed", "処理に失敗しました"), description: r.error?.message, variant: "destructive" })
      return false
    }
    toast({ title: successTitle })
    onChanged()
    return true
  }

  const payOrder = async ({ method, shippingAddress }: { method: string; shippingAddress: ShippingInfo }) => {
    const r = await api(`/api/orders/${o.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "pay", method, shippingAddress }),
    })
    if (!r.ok) return r.error?.message || "Payment failed"
    toast({ title: tr(locale, "Order paid 🎉", "支払いが完了しました 🎉"), description: tr(locale, "The seller has been notified to ship.", "出品者に発送通知が届きました。") })
    refreshSession()
    onChanged()
    return null
  }

  const isBuyer = o.role === "buyer"
  const canDispute = isBuyer && ["PAID", "SHIPPED", "DELIVERED"].includes(o.status) && !o.dispute

  return (
    <li className="border rounded-xl bg-card overflow-hidden">
      <div className="p-3 sm:p-4 flex gap-3">
        <button className="w-20 h-20 rounded-lg overflow-hidden shrink-0 border" onClick={() => setView({ name: "item", id: o.listingId })} aria-label={o.listingTitle}>
          <ImageTile listing={{ images: o.listingImages, title: o.listingTitle, category: null }} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <button className="text-left min-w-0" onClick={() => setView({ name: "item", id: o.listingId })}>
              <p className="font-semibold text-sm hover:text-primary truncate">{o.listingTitle}</p>
            </button>
            <StatusBadge status={o.status} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
            #{o.id.slice(-6).toUpperCase()} · {fmtDate(o.placedAt, true)} · {o.type === "AUCTION" ? tr(locale, "Auction", "オークション") : tr(locale, "Buy-Now", "即決")}
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Price value={o.totalCharged} size="sm" />
            <span className="text-[11px] text-muted-foreground">
              {tr(locale, o.role === "buyer" ? `You pay` : `You receive`, o.role === "buyer" ? "支払額" : "受取額")}
              {" · "}{tr(locale, `incl. fees${o.vatAmount ? ` (VAT ${o.vatAmount.toFixed(2)} by seller)` : ""}`, `手数料込${o.vatAmount ? `（VAT ${o.vatAmount.toFixed(2)}は出品者負担）` : ""}`)}
            </span>
          </div>
          {(o.role === "seller" || detail?.viewer.isStaff) && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {tr(locale, "Ship to", "配送先")}: {o.shippingAddress?.name || "—"}{o.shippingAddress?.city ? `, ${o.shippingAddress.city}` : ""}{o.shippingAddress?.street ? ` · ${o.shippingAddress.street}` : ""}
            </p>
          )}
          <div className="mt-1.5">{o.trackingCode && <TrackingLine carrier={o.carrier} code={o.trackingCode} />}</div>
          {o.dispute && (
            <p className="text-[11px] text-destructive mt-1.5 inline-flex items-center gap-1 font-medium">
              <Scale className="w-3.5 h-3.5" aria-hidden />
              {tr(locale, `Dispute open: ${o.dispute.reason.replace(/_/g, " ").toLowerCase()}`, `紛争対応中: ${o.dispute.reason}`)}
            </p>
          )}

          {/* action row */}
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            {isBuyer && o.status === "PENDING_PAYMENT" && (
              <>
                <Button size="sm" className="h-10 font-semibold" disabled={busy} onClick={() => setPayOpen(true)}>
                  <CreditCard className="w-3.5 h-3.5 mr-1" aria-hidden />{tr(locale, "Pay now", "支払う")}
                </Button>
                <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={() => setCancelOpen(true)}>
                  <XCircle className="w-3.5 h-3.5 mr-1" aria-hidden />{tr(locale, "Cancel", "キャンセル")}
                </Button>
              </>
            )}
            {o.role === "seller" && o.status === "PAID" && (
              <Button size="sm" className="h-10 font-semibold" disabled={busy} onClick={() => setShipOpen(true)}>
                <Truck className="w-3.5 h-3.5 mr-1" aria-hidden />{tr(locale, "Mark shipped", "発送済みにする")}
              </Button>
            )}
            {isBuyer && o.status === "SHIPPED" && (
              <Button size="sm" className="h-10 font-semibold" disabled={busy} onClick={() => act({ action: "confirm" }, tr(locale, "Delivery confirmed", "受け取りを確認しました"))}>
                <PackageCheck className="w-3.5 h-3.5 mr-1" aria-hidden />{tr(locale, "Confirm delivery", "受け取り確認")}
              </Button>
            )}
            {isBuyer && o.status === "DELIVERED" && (
              <Button size="sm" className="h-10 font-semibold" disabled={busy} onClick={() => setCompleteOpen(true)}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" aria-hidden />{tr(locale, "Complete order", "取引を完了")}
              </Button>
            )}
            {isBuyer && o.status === "COMPLETED" && !o.hasReview && (
              <Button size="sm" variant="secondary" className="h-10 font-semibold" onClick={() => setReviewOpen(true)}>
                <Star className="w-3.5 h-3.5 mr-1 fill-[#e5b93b] text-[#e5b93b]" aria-hidden />{tr(locale, "Leave review", "評価する")}
              </Button>
            )}
            {canDispute && (
              <Button size="sm" variant="outline" className="h-10 text-destructive hover:text-destructive" onClick={() => setDisputeOpen(true)}>
                <Flag className="w-3.5 h-3.5 mr-1" aria-hidden />{tr(locale, "Open dispute", "紛争を開く")}
              </Button>
            )}
            {/* timeline toggle */}
            <Collapsible open={open} onOpenChange={toggleOpen} className="ml-auto">
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground h-10 px-2 rounded-md">
                <History className="w-3.5 h-3.5" aria-hidden />
                {tr(locale, `History (${o.eventCount})`, `履歴 (${o.eventCount})`)}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
              </CollapsibleTrigger>
            </Collapsible>
          </div>
        </div>
      </div>

      <Collapsible open={open} onOpenChange={toggleOpen}>
        <CollapsibleContent className="border-t px-3 sm:px-4 py-3 bg-secondary/30">
          {detail === null ? (
            <p className="text-xs text-muted-foreground">{tr(locale, "Loading history…", "履歴を読み込み中…")}</p>
          ) : (
            <ol className="space-y-2">
              {detail.events.map(e => {
                const [en, ja] = EVENT_LABELS[e.type] || [e.type, e.type]
                const data = e.data as { trackingCode?: string; carrier?: string; method?: string; amount?: number; reason?: string }
                return (
                  <li key={e.id} className="text-xs flex items-start gap-2">
                    <Clock className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
                    <div>
                      <p className="font-semibold">{tr(locale, en, ja)}</p>
                      <p className="text-muted-foreground">{fmtDate(e.createdAt, true)}</p>
                      {data?.trackingCode && <p className="font-mono text-[11px]">{data.carrier} · {data.trackingCode}</p>}
                      {data?.method && <p className="text-[11px] text-muted-foreground">{data.method.replace("MOCK_", "")}</p>}
                      {data?.reason && <p className="text-[11px] text-muted-foreground">{data.reason}</p>}
                    </div>
                  </li>
                )
              })}
              {detail.invoice && (
                <li className="text-xs text-muted-foreground pt-1 border-t mt-1">
                  {tr(locale, `Invoice ${detail.invoice.number} · total $${detail.invoice.total.toFixed(2)} (VAT $${detail.invoice.vatAmount.toFixed(2)})`, `請求書 ${detail.invoice.number}・合計 $${detail.invoice.total.toFixed(2)}（VAT $${detail.invoice.vatAmount.toFixed(2)}）`)}
                </li>
              )}
              {detail.review && (
                <li className="text-xs pt-1 border-t mt-1">
                  <span className="font-semibold">{tr(locale, "Your review", "あなたの評価")}:</span>{" "}
                  <span className="text-[#b8860b] font-bold">{"★".repeat(detail.review.rating)}</span>
                  {detail.review.title ? ` — ${detail.review.title}` : ""}
                </li>
              )}
            </ol>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* dialogs */}
      <CheckoutDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        itemTitle={o.listingTitle}
        amount={o.totalCharged}
        submitLabel={tr(locale, `Pay $${o.totalCharged.toFixed(2)}`, `$${o.totalCharged.toFixed(2)}を支払う`)}
        onConfirm={payOrder}
      />
      <ShipDialog open={shipOpen} onOpenChange={setShipOpen} orderId={o.id} onDone={onChanged} />
      <ReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} orderId={o.id} onDone={onChanged} />
      <DisputeDialog open={disputeOpen} onOpenChange={setDisputeOpen} orderId={o.id} onDone={onChanged} />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr(locale, "Cancel this order?", "この注文をキャンセルしますか？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr(locale, "Unpaid orders can be cancelled freely — the item's stock is restored.", "未払いの注文は自由にキャンセルできます。在庫は復元されます。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{tr(locale, "Keep order", "注文を続ける")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={e => { e.preventDefault(); setCancelOpen(false); act({ action: "cancel" }, tr(locale, "Order cancelled", "注文をキャンセルしました")) }}
            >
              {tr(locale, "Cancel order", "キャンセルする")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr(locale, "Complete this order?", "取引を完了しますか？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr(locale, "This confirms the transaction went well and lets you leave a public review.", "取引が問題なく完了したことを確定し、公開評価ができるようになります。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{tr(locale, "Not yet", "まだ")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={e => { e.preventDefault(); setCompleteOpen(false); act({ action: "complete" }, tr(locale, "Order completed — thanks!", "取引完了 — ありがとうございます！")) }}
            >
              {tr(locale, "Complete", "完了する")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
