"use client"
// ── WatchlistPage: watched listings with live countdowns, remove + bid CTAs ──
import { useEffect, useState } from "react"
import { Gavel } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Empty, Price, SectionTitle, timeLeft } from "../../ui"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { toast } from "@/hooks/use-toast"
import { ImageTile, useTick } from "./bits"
import type { ListingCardData, WatchListData } from "./types"

export function WatchlistPage() {
  const { locale, session, setView } = useApp()
  const [res, setRes] = useState<{ uid: string; items: ListingCardData[] } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const uid = session?.id || "anon"
  useTick(30_000)

  useEffect(() => {
    if (!session) return
    let alive = true
    api<WatchListData>("/api/watch")
      .then(r => { if (alive && r.ok) setRes({ uid, items: r.data!.items }) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [uid, session])

  const items = res && res.uid === uid ? res.items : null

  const remove = async (id: string) => {
    setRemoving(id)
    const r = await api(`/api/listings/${id}/watch`, { method: "POST" })
    setRemoving(null)
    if (r.ok) {
      toast({ title: tr(locale, "Removed from watchlist", "ウォッチリストから削除しました") })
      setRes(prev => (prev && prev.uid === uid ? { uid, items: prev.items.filter(i => i.id !== id) } : prev))
    }
  }

  if (!session) {
    return (
      <Empty icon="💙" title={tr(locale, "Sign in to use your watchlist", "ウォッチにはログインが必要です")} hint={tr(locale, "Track auctions and get outbid alerts.", "オークションを追跡し、入札通知を受け取れます。")}>
        <Button className="mt-4 h-11" onClick={() => setView({ name: "auth" })}>{tr(locale, "Sign in", "ログイン")}</Button>
      </Empty>
    )
  }

  return (
    <div className="space-y-4">
      <SectionTitle><h1 className="text-lg inline-flex items-center gap-2">💙 {tr(locale, "Watchlist", "ウォッチリスト")}</h1></SectionTitle>

      {items === null ? (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-lg bg-muted animate-pulse border" />)}
        </div>
      ) : items.length === 0 ? (
        <Empty
          icon="👀"
          title={tr(locale, "Nothing on your watchlist yet", "ウォッチリストは空です")}
          hint={tr(locale, "Tap “Watch” on any listing to track its price and countdown here.", "出品の「ウォッチ」をタップすると価格と終了時間をここで追跡できます。")}
        >
          <Button className="mt-4 h-11" onClick={() => setView({ name: "search", q: "" })}>{tr(locale, "Find something to watch", "ウォッチする出品を探す")}</Button>
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {items.map(l => {
            const left = l.endsAt ? timeLeft(l.endsAt, locale) : null
            const ended = l.status !== "ACTIVE"
            return (
              <li key={l.id} className="border rounded-xl bg-card p-3 flex items-center gap-3 hover:shadow-sm transition-shadow">
                <button className="w-20 h-20 rounded-lg overflow-hidden shrink-0 border" onClick={() => setView({ name: "item", id: l.id })} aria-label={l.title}>
                  <ImageTile listing={l} />
                </button>
                <div className="min-w-0 flex-1">
                  <button className="text-left w-full" onClick={() => setView({ name: "item", id: l.id })}>
                    <p className="font-semibold text-sm truncate hover:text-primary">{l.title}</p>
                  </button>
                  <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                    <Price value={l.type === "BUY_NOW" ? (l.buyNowPrice ?? l.startingPrice) : l.currentPrice} size="sm" />
                    {l.type === "AUCTION" && left && (
                      <span className={`text-xs font-semibold ${ended ? "text-muted-foreground" : "text-[#b8860b]"}`}>⏳ {left}</span>
                    )}
                    {l.type === "AUCTION" && (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Gavel className="w-3 h-3" aria-hidden />{l.bidCount ?? 0}</span>
                    )}
                    {ended && <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{l.status}</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">{l.seller.avatarEmoji} {l.seller.shopName}</p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button size="sm" className="h-10 font-semibold" onClick={() => setView({ name: "item", id: l.id })}>
                    {l.type === "AUCTION" ? tr(locale, "Bid", "入札") : tr(locale, "View", "見る")}
                  </Button>
                  <Button size="sm" variant="outline" className="h-10" disabled={removing === l.id} onClick={() => remove(l.id)}>
                    {removing === l.id ? tr(locale, "…", "…") : tr(locale, "Remove", "削除")}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
