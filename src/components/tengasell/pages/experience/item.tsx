"use client"
// ── ItemPage: gallery, bid box (auth-gated + confirm), buy-now checkout, seller card, Q&A handoff,
// report, share, bid history, similar listings, policy footnotes ──
import { useCallback, useEffect, useState } from "react"
import {
  BadgeCheck, ChevronRight, Eye, Flag, Gavel, History, Link2, Lock, MessageSquare,
  Minus, Plus, Share2, ShieldCheck, ShoppingCart, Timer, Heart,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CardSkeletonGrid, Empty, Price, SectionTitle, StatusBadge, fmtDate, timeLeft } from "../../ui"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { toast } from "@/hooks/use-toast"
import { ConditionBadge, ImageTile, ListingCard, Stars, TypeChip, useTick } from "./bits"
import { CheckoutDialog, type ShippingInfo } from "./checkout"
import { BidConfirmDialog, ReportDialog } from "./dialogs"
import type { ListingDetail } from "./types"

type Res = { id: string; data?: ListingDetail; error?: string }

export function ItemPage({ id }: { id: string }) {
  const { locale } = useApp()
  const [res, setRes] = useState<Res | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  useEffect(() => {
    let alive = true
    api<ListingDetail>(`/api/listings/${id}`)
      .then(r => { if (alive) setRes({ id, data: r.ok ? r.data : undefined, error: r.ok ? undefined : r.error?.message || "Not found" }) })
      .catch(() => { if (alive) setRes({ id, error: "Network error" }) })
    return () => { alive = false }
  }, [id, reloadKey])

  if (!res || res.id !== id) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-5 w-52 bg-muted rounded animate-pulse" />
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="aspect-square rounded-lg bg-muted animate-pulse" />
          <div className="space-y-3">
            <div className="h-7 w-3/4 bg-muted rounded animate-pulse" />
            <div className="h-5 w-1/3 bg-muted rounded animate-pulse" />
            <div className="h-24 bg-muted rounded-lg animate-pulse" />
          </div>
        </div>
        <CardSkeletonGrid count={4} />
      </div>
    )
  }
  if (res.error) {
    return <Empty icon="🔍" title={tr(locale, "Listing not available", "この出品は利用できません")} hint={res.error} />
  }
  return <ItemView key={id} l={res.data!} reload={reload} />
}

function ItemView({ l, reload }: { l: ListingDetail; reload: () => void }) {
  const { locale, setView, session, refreshSession } = useApp()
  const [imgIdx, setImgIdx] = useState(0)
  const [bidInput, setBidInput] = useState("")
  const [bidConfirm, setBidConfirm] = useState(false)
  const [bidBusy, setBidBusy] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [report, setReport] = useState(false)
  const [watchBusy, setWatchBusy] = useState(false)
  useTick(30_000)

  const inc = l.meta.bidIncrement
  const isAuction = l.type === "AUCTION"
  const buyPrice = l.buyNowPrice ?? l.startingPrice
  const minBid = Math.round((l.currentPrice + inc) * 100) / 100
  const auctionLive = isAuction && l.status === "ACTIVE" && l.endsAt && new Date(l.endsAt).getTime() > Date.now()
  const left = l.endsAt ? timeLeft(l.endsAt, locale) : null

  // ── actions ──
  const requireAuth = (msg: string) => {
    if (!session) {
      toast({ title: msg, description: tr(locale, "Sign in to continue.", "続けるにはログインしてください。") })
      setView({ name: "auth" })
      return false
    }
    return true
  }

  const openBid = () => {
    if (!requireAuth(tr(locale, "Sign in to bid", "入札にはログインが必要です"))) return
    const amt = Number(bidInput)
    if (!Number.isFinite(amt) || amt < minBid) {
      toast({ title: tr(locale, `Bid at least $${minBid.toFixed(2)}`, `最低入札額は$${minBid.toFixed(2)}です`), variant: "destructive" })
      return
    }
    setBidConfirm(true)
  }

  const placeBid = async () => {
    setBidConfirm(false)
    setBidBusy(true)
    const r = await api<{ currentPrice: number }>(`/api/listings/${l.id}/bid`, {
      method: "POST", body: JSON.stringify({ amount: Number(bidInput) }),
    })
    setBidBusy(false)
    if (!r.ok) {
      toast({ title: tr(locale, "Bid rejected", "入札できません"), description: r.error?.message, variant: "destructive" })
      return
    }
    toast({
      title: tr(locale, "Bid placed — you're the top bidder!", "入札しました。現在最高額です！"),
      description: tr(locale, `Current price $${r.data!.currentPrice.toFixed(2)}`, `現在価格 $${r.data!.currentPrice.toFixed(2)}`),
    })
    setBidInput("")
    reload()
  }

  const toggleWatch = async () => {
    if (!requireAuth(tr(locale, "Sign in to watch items", "ウォッチにはログインが必要です"))) return
    setWatchBusy(true)
    const r = await api<{ watching: boolean }>(`/api/listings/${l.id}/watch`, { method: "POST" })
    setWatchBusy(false)
    if (r.ok) {
      toast({
        title: r.data!.watching ? tr(locale, "Added to watchlist", "ウォッチリストに追加しました") : tr(locale, "Removed from watchlist", "ウォッチリストから削除しました"),
      })
      reload()
    }
  }

  // Buy-now checkout: POST /buy (creates PENDING_PAYMENT + AUTHORIZED payment) then PATCH pay — one UX step
  const doCheckout = async ({ method, shippingAddress }: { method: string; shippingAddress: ShippingInfo }) => {
    if (!requireAuth(tr(locale, "Sign in to buy", "購入にはログインが必要です"))) return "Sign in required"
    const buyRes = await api<{ orderId: string }>(`/api/listings/${l.id}/buy`, {
      method: "POST", body: JSON.stringify({ method, shippingAddress }),
    })
    if (!buyRes.ok) return buyRes.error?.message || "Checkout failed"
    const payRes = await api(`/api/orders/${buyRes.data!.orderId}`, {
      method: "PATCH", body: JSON.stringify({ action: "pay", method, shippingAddress }),
    })
    if (!payRes.ok) return payRes.error?.message || "Payment failed"
    toast({ title: tr(locale, "Order paid 🎉", "支払いが完了しました 🎉"), description: tr(locale, "Track it under Orders. The seller ships next.", "注文画面で追跡できます。出品者が発送します。") })
    refreshSession()
    setView({ name: "orders" })
    return null
  }

  const openQnA = () => {
    if (!l.seller) return
    try {
      sessionStorage.setItem("tgs-pending-thread", JSON.stringify({ listingId: l.id, title: l.title, sellerId: l.seller.id }))
    } catch { /* ignore */ }
    setView({ name: "messages" })
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast({ title: tr(locale, "Link copied to clipboard", "リンクをコピーしました") })
    } catch {
      toast({ title: tr(locale, "Could not copy link", "コピーできません"), variant: "destructive" })
    }
  }

  return (
    <div className="space-y-6">
      {/* breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
        <button className="hover:text-primary font-medium" onClick={() => setView({ name: "home" })}>{tr(locale, "Home", "ホーム")}</button>
        {l.category && (
          <>
            <ChevronRight className="w-3 h-3" aria-hidden />
            <button className="hover:text-primary font-medium" onClick={() => setView({ name: "category", slug: l.category!.slug })}>
              {tr(locale, l.category.name, l.category.nameJa)}
            </button>
          </>
        )}
        <ChevronRight className="w-3 h-3" aria-hidden />
        <span className="text-foreground truncate max-w-48" aria-current="page">{l.title}</span>
      </nav>

      {(l.status === "REJECTED" || l.status === "SUSPENDED") && (
        <div role="alert" className="border border-destructive/40 bg-destructive/10 rounded-lg p-3 text-sm">
          <p className="font-bold text-destructive">
            {l.status === "REJECTED" ? tr(locale, "This listing was rejected by moderation", "この出品は審査で却下されました") : tr(locale, "This listing is suspended", "この出品は停止中です")}
          </p>
          {l.rejectReason && <p className="text-muted-foreground mt-0.5">{tr(locale, "Reason", "理由")}: {l.rejectReason}</p>}
        </div>
      )}
      {l.status === "PENDING_REVIEW" && (l.viewer.isOwner || l.viewer.isStaff) && (
        <div className="border border-[#b8860b]/40 bg-[#b8860b]/10 rounded-lg p-3 text-sm">
          <p className="font-bold text-[#b8860b]">{tr(locale, "In the moderation queue — only you and staff can see this preview.", "審査中 — あなたとスタッフのみこのプレビューを閲覧できます。")}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ── gallery ── */}
        <section aria-label={tr(locale, "Images", "画像")}>
          <div className="aspect-square rounded-xl overflow-hidden border bg-muted relative">
            <ImageTile listing={{ images: [l.images[imgIdx] || l.images[0]], title: l.title, category: l.category }} />
            {isAuction && left && (
              <span className="absolute top-3 left-3 inline-flex items-center gap-1 text-xs font-bold px-2.5 h-8 rounded-full bg-background/95 border text-[#b8860b]">
                <Timer className="w-3.5 h-3.5" aria-hidden />{left}
              </span>
            )}
            {l.status !== "ACTIVE" && (
              <span className="absolute top-3 right-3"><StatusBadge status={l.status} /></span>
            )}
          </div>
          {l.images.length > 1 && (
            <div className="flex gap-2 mt-2 overflow-x-auto tgs-scroll pb-1" role="listbox" aria-label={tr(locale, "Choose image", "画像を選択")}>
              {l.images.map((img, i) => (
                <button
                  key={img + i}
                  role="option"
                  aria-selected={imgIdx === i}
                  onClick={() => setImgIdx(i)}
                  className={`w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 shrink-0 transition-colors ${imgIdx === i ? "border-primary" : "border-transparent opacity-70 hover:opacity-100"}`}
                >
                  <ImageTile listing={{ images: [img], title: `${l.title} ${i + 1}`, category: l.category }} />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── details column ── */}
        <section className="space-y-4" aria-label={tr(locale, "Item details", "商品詳細")}>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-snug">{l.title}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-2 text-xs text-muted-foreground">
              <ConditionBadge condition={l.condition} />
              <TypeChip type={l.type} />
              <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" aria-hidden />{l.watchCount} {tr(locale, "watching", "ウォッチ")}</span>
              <span>·</span>
              <span>{l.viewCount} {tr(locale, "views", "閲覧")}</span>
              <span>·</span>
              <span>{tr(locale, "Listed", "出品日")} {fmtDate(l.createdAt)}</span>
            </div>
          </div>

          {isAuction ? (
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{tr(locale, "Current bid", "現在入札額")}</p>
                  <Price value={l.currentPrice} size="lg" className="text-3xl" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground font-medium">{tr(locale, "Bids", "入札数")}</p>
                  <p className="text-xl font-bold inline-flex items-center gap-1"><Gavel className="w-4 h-4 text-primary" aria-hidden />{l.bidCount}</p>
                </div>
              </div>
              {l.buyNowPrice && (
                <p className="text-xs text-muted-foreground">
                  {tr(locale, "Buy-Now price", "即決価格")}: <span className="font-bold text-[#b8860b]">${l.buyNowPrice.toFixed(2)}</span>
                  {" "}({tr(locale, "auctions still decide the winner", "落札はオークションで決まります")})
                </p>
              )}
              {auctionLive ? (
                <>
                  <div className="flex gap-2" role="group" aria-label={tr(locale, "Your bid", "あなたの入札")}>
                    <Button
                      variant="outline" size="icon" className="h-11 w-11 shrink-0"
                      aria-label={tr(locale, `Decrease by $${inc.toFixed(2)}`, `-${inc.toFixed(2)}ドル`)}
                      onClick={() => setBidInput(Math.max(minBid, Math.round(((Number(bidInput) || minBid) - inc) * 100) / 100).toFixed(2))}
                    >
                      <Minus className="w-4 h-4" aria-hidden />
                    </Button>
                    <div className="relative flex-1">
                      <label htmlFor="bid-amount" className="sr-only">{tr(locale, "Bid amount", "入札額")}</label>
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
                      <Input
                        id="bid-amount" type="number" inputMode="decimal" step="0.01" min={minBid}
                        value={bidInput} onChange={e => setBidInput(e.target.value)}
                        placeholder={minBid.toFixed(2)} className="pl-7 h-11 text-base font-semibold tabular-nums"
                      />
                    </div>
                    <Button
                      variant="outline" size="icon" className="h-11 w-11 shrink-0"
                      aria-label={tr(locale, `Increase by $${inc.toFixed(2)}`, `+${inc.toFixed(2)}ドル`)}
                      onClick={() => setBidInput((Math.round(((Number(bidInput) || minBid - inc) + inc) * 100) / 100).toFixed(2))}
                    >
                      <Plus className="w-4 h-4" aria-hidden />
                    </Button>
                  </div>
                  <Button className="w-full h-12 text-base font-bold" onClick={openBid} disabled={bidBusy}>
                    <Gavel className="w-4 h-4 mr-1.5" aria-hidden />
                    {bidBusy ? tr(locale, "Placing…", "入札中…") : tr(locale, "Place bid", "入札する")}
                  </Button>
                  <p className="text-[11px] text-muted-foreground text-center">
                    {tr(locale, `Minimum next bid $${minBid.toFixed(2)} (increment $${inc.toFixed(2)})`, `最低入札額 $${minBid.toFixed(2)}（刻み $${inc.toFixed(2)}）`)}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{tr(locale, "This auction has ended.", "このオークションは終了しました。")}</p>
              )}
            </div>
          ) : (
            <div className="border rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground font-medium">{tr(locale, "Buy-Now price", "即決価格")}</p>
                <Price value={buyPrice} size="lg" className="text-3xl" />
              </div>
              <p className="text-xs text-muted-foreground">{l.stock} {tr(locale, "in stock", "在庫あり")}</p>
              <Button
                className="w-full h-12 text-base font-bold"
                disabled={l.status !== "ACTIVE" || l.stock <= 0}
                onClick={() => requireAuth(tr(locale, "Sign in to buy", "購入にはログインが必要です")) && setCheckout(true)}
              >
                <ShoppingCart className="w-4 h-4 mr-1.5" aria-hidden />
                {l.status === "ACTIVE" && l.stock > 0 ? tr(locale, "Buy it now", "今すぐ購入") : tr(locale, "Unavailable", "購入不可")}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center inline-flex items-center gap-1 justify-center w-full">
                <Lock className="w-3 h-3" aria-hidden />{tr(locale, "Mock checkout — card, wallet or EcoCash", "モック決済 — カード/ウォレット/EcoCash")}
              </p>
            </div>
          )}

          {/* action row: watch / Q&A / report / share */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-11 font-semibold" onClick={toggleWatch} disabled={watchBusy} aria-pressed={l.viewer.isWatched}>
              <Heart className={`w-4 h-4 mr-1.5 ${l.viewer.isWatched ? "fill-[#e5b93b] text-[#e5b93b]" : ""}`} aria-hidden />
              {l.viewer.isWatched ? tr(locale, "Watching", "ウォッチ中") : tr(locale, "Watch", "ウォッチ")}
            </Button>
            <Button variant="outline" className="h-11 font-semibold" onClick={openQnA}>
              <MessageSquare className="w-4 h-4 mr-1.5" aria-hidden />{tr(locale, "Ask seller", "質問する")}
            </Button>
            <Button variant="outline" className="h-11 font-semibold text-destructive hover:text-destructive" onClick={() => requireAuth(tr(locale, "Sign in to report", "報告にはログインが必要です")) && setReport(true)}>
              <Flag className="w-4 h-4 mr-1.5" aria-hidden />{tr(locale, "Report", "報告")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-11 font-semibold" aria-label={tr(locale, "Share", "共有")}>
                  <Share2 className="w-4 h-4 mr-1.5" aria-hidden />{tr(locale, "Share", "共有")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={copyLink} className="min-h-11">
                  <Link2 className="w-4 h-4 mr-2" aria-hidden />{tr(locale, "Copy link", "リンクをコピー")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* seller card */}
          {l.seller && (
            <div className="border rounded-xl p-4 flex gap-3">
              <span aria-hidden className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center text-3xl shrink-0">{l.seller.avatarEmoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    className="font-bold hover:text-primary truncate"
                    onClick={() => l.seller?.slug && setView({ name: "seller", slug: l.seller.slug })}
                  >
                    {l.seller.shopName}
                  </button>
                  {l.seller.shopStatus === "VERIFIED" ? (
                    <BadgeCheck className="w-4 h-4 text-primary shrink-0" aria-label={tr(locale, "Verified seller", "認証出品者")} />
                  ) : (
                    <span className="text-[10px] font-semibold text-muted-foreground border rounded px-1.5 py-0.5">{tr(locale, "PENDING", "審査中")}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Stars value={l.seller.ratingAvg} />
                  <span className="text-xs text-muted-foreground">{l.seller.ratingAvg.toFixed(1)} ({l.seller.ratingCount})</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {l.seller.city ? `${l.seller.city} · ` : ""}
                  {tr(locale, "Member since", "登録")}: {fmtDate(l.seller.memberSince)}
                </p>
                <span className={`inline-block mt-1.5 text-[10px] font-bold rounded px-1.5 py-0.5 border ${l.seller.healthScore >= 90 ? "text-primary border-primary/40" : "text-[#b8860b] border-[#b8860b]/40"}`}>
                  {tr(locale, `Health ${l.seller.healthScore}`, `健全性 ${l.seller.healthScore}`)}
                </span>
              </div>
            </div>
          )}

          {/* policy footnotes */}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <ShieldCheck className="w-3.5 h-3.5 inline mb-0.5 text-primary" aria-hidden />
            {" "}
            {tr(locale, "Payments must stay on Tengasell — off-platform deals void Buyer Protection.", "支払いは必ずTengasell内で。プラットフォーム外取引は保護対象外です。")}
            {" "}
            <button className="underline hover:text-foreground" onClick={() => setView({ name: "policy", key: "prohibited" })}>
              {tr(locale, "Prohibited goods policy", "禁止商品ポリシー")}
            </button>
            {" · "}
            <button className="underline hover:text-foreground" onClick={() => setView({ name: "policy", key: "refunds" })}>
              {tr(locale, "Refunds & disputes", "返金と紛争")}
            </button>
          </p>
        </section>
      </div>

      {/* ── description ── */}
      <section aria-labelledby="desc-title" className="border rounded-xl p-4 sm:p-5">
        <h2 id="desc-title" className="font-bold mb-2">{tr(locale, "Item description", "商品説明")}</h2>
        <p className="text-sm whitespace-pre-line leading-relaxed text-foreground/90">{l.description}</p>
        <p className="text-[11px] text-muted-foreground mt-3">
          {tr(locale, `Version history: ${l.versionCount} ${l.versionCount === 1 ? "revision" : "revisions"} on file`, `改訂履歴: ${l.versionCount}件`)}
        </p>
      </section>

      {/* ── bid history ── */}
      {isAuction && (
        <section aria-labelledby="bids-title">
          <SectionTitle><span className="text-base font-bold tracking-tight inline-flex items-center gap-1.5" id="bids-title"><History className="w-4 h-4" aria-hidden />{tr(locale, "Bid history", "入札履歴")}</span></SectionTitle>
          {l.bids.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-lg p-4">{tr(locale, "No bids yet — be the first!", "入札はまだありません。最初の一札を！")}</p>
          ) : (
            <ul className="border rounded-xl divide-y text-sm max-h-96 overflow-y-auto tgs-scroll">
              {l.bids.map((b, i) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${i === 0 ? "bg-[#e5b93b]/20 text-[#b8860b]" : "bg-secondary text-muted-foreground"}`} aria-hidden>
                      {i + 1}
                    </span>
                    <span className="font-medium truncate">{b.bidderName}{b.isMine ? tr(locale, " (you)", "（あなた）") : ""}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <Price value={b.amount} size="sm" />
                    <span className="text-[11px] text-muted-foreground hidden sm:inline">{fmtDate(b.createdAt, true)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── similar listings ── */}
      {l.similar.length > 0 && (
        <section aria-labelledby="similar-title">
          <SectionTitle><span className="text-base font-bold tracking-tight" id="similar-title">🔎 {tr(locale, "Similar items", "似ている出品")}</span></SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {l.similar.map(s => (
              <ListingCard
                key={s.id}
                l={{
                  id: s.id,
                  title: s.title,
                  condition: s.condition,
                  type: s.type,
                  startingPrice: s.currentPrice,
                  buyNowPrice: s.buyNowPrice,
                  currentPrice: s.currentPrice,
                  images: s.images,
                  status: s.status,
                  endsAt: s.endsAt,
                  bidCount: s.bidCount,
                  seller: s.seller,
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── dialogs ── */}
      <BidConfirmDialog
        open={bidConfirm}
        onOpenChange={setBidConfirm}
        amount={bidInput ? Number(bidInput) : null}
        minNext={minBid}
        onConfirm={placeBid}
      />
      <CheckoutDialog
        open={checkout}
        onOpenChange={setCheckout}
        itemTitle={l.title}
        amount={buyPrice}
        submitLabel={tr(locale, `Pay $${buyPrice.toFixed(2)}`, `$${buyPrice.toFixed(2)}を支払う`)}
        onConfirm={doCheckout}
      />
      <ReportDialog open={report} onOpenChange={setReport} listingId={l.id} listingTitle={l.title} />
    </div>
  )
}
