"use client"
// ── HomePage: hero, category chips, ending-soon strip (live 30s), recommended grid, trust row ──
import { useEffect, useState } from "react"
import { BadgeCheck, Gavel, Scale, Search, ShieldCheck, Store, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CardSkeletonGrid, Empty, Price, SectionTitle, timeLeft } from "../../ui"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { CategoryChip, ListingCard, ImageTile, useTick } from "./bits"
import type { CategoryList, ListingCardData, ListingSearchResult } from "./types"

export function HomePage() {
  const { locale, setView, setSearchQuery } = useApp()
  const [cats, setCats] = useState<CategoryList["items"] | null>(null)
  const [ending, setEnding] = useState<ListingCardData[] | null>(null)
  const [recs, setRecs] = useState<ListingCardData[] | null>(null)
  const [heroQ, setHeroQ] = useState("")
  useTick(30_000)

  useEffect(() => {
    let alive = true
    api<CategoryList>("/api/categories").then(r => { if (alive && r.ok) setCats(r.data!.items) }).catch(() => undefined)
    api<ListingSearchResult>("/api/listings?sort=ending&type=AUCTION&limit=6").then(r => { if (alive && r.ok) setEnding(r.data!.items) }).catch(() => undefined)
    api<ListingSearchResult>("/api/listings?sort=newest&limit=8").then(r => { if (alive && r.ok) setRecs(r.data!.items) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  const search = (e?: React.FormEvent) => {
    e?.preventDefault()
    const q = heroQ.trim()
    if (q) {
      setSearchQuery(q)
      setView({ name: "search", q })
    } else {
      setView({ name: "search", q: "" })
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Hero ── */}
      <section className="rounded-2xl tgs-gradient-teal text-white p-5 sm:p-8 relative overflow-hidden" aria-labelledby="hero-title">
        <div className="max-w-2xl space-y-4">
          <p className="text-[11px] font-bold tracking-widest uppercase text-white/70 inline-flex items-center gap-1.5">
            <Gavel className="w-3.5 h-3.5" aria-hidden />{tr(locale, "Tengasell Marketplace", "Tengasell マーケットプレイス")}
          </p>
          <h1 id="hero-title" className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">
            {tr(locale, "Zimbabwe's auctions, trusted.", "ジンバブエのオークション、信頼の市場へ。")}
          </h1>
          <p className="text-sm sm:text-base text-white/85 max-w-lg">
            {tr(
              locale,
              "Bid on electronics, art, instruments and more — every payment covered by buyer protection, every seller held to MSCS-grade controls.",
              "家電・アート・楽器などを入札。すべての取引にバイヤー保護とMSCS準拠の管理を。",
            )}
          </p>
          <form onSubmit={search} role="search" className="flex max-w-md pt-1">
            <label htmlFor="hero-search" className="sr-only">{tr(locale, "Search listings", "出品を検索")}</label>
            <Input
              id="hero-search"
              value={heroQ}
              onChange={e => setHeroQ(e.target.value)}
              placeholder={tr(locale, "Search auctions… e.g. camera, guitar", "オークションを検索… 例：カメラ、ギター")}
              className="h-11 rounded-r-none border-r-0 bg-white text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
            />
            <Button type="submit" size="lg" className="h-11 rounded-l-none px-4 bg-[#e5b93b] text-[#1c2b2f] hover:bg-[#d1a03a] border-0">
              <Search className="w-4 h-4" aria-hidden />
              <span className="sr-only">{tr(locale, "Search", "検索")}</span>
            </Button>
          </form>
          <div className="flex flex-wrap gap-2.5 pt-1">
            <Button size="lg" variant="secondary" className="h-11 font-bold" onClick={() => setView({ name: "sell" })}>
              <Store className="w-4 h-4 mr-1.5" aria-hidden />{tr(locale, "Start selling", "出品する")}
            </Button>
            <Button size="lg" variant="outline" className="h-11 font-bold border-white/40 text-white hover:bg-white/10 hover:text-white" onClick={() => setView({ name: "search", q: "" })}>
              <TrendingUp className="w-4 h-4 mr-1.5" aria-hidden />{tr(locale, "Browse auctions", "オークションを見る")}
            </Button>
          </div>
        </div>
        <div aria-hidden className="hidden sm:block absolute -right-6 -bottom-8 text-[9rem] leading-none opacity-20 select-none">🦁</div>
      </section>

      {/* ── Category chips ── */}
      <section aria-labelledby="cats-title">
        <SectionTitle>
          <span id="cats-title" className="text-base font-bold tracking-tight">{tr(locale, "Shop by category", "カテゴリーから探す")}</span>
        </SectionTitle>
        {cats === null ? (
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-11 rounded-full bg-muted animate-pulse w-28 shrink-0" />)}
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto tgs-scroll pb-1 -mx-1 px-1" role="list">
            {cats.map(c => <CategoryChip key={c.slug} c={c} />)}
          </div>
        )}
      </section>

      {/* ── Ending soon strip ── */}
      <section aria-labelledby="ending-title">
        <SectionTitle action={
          <Button variant="ghost" size="sm" className="h-9 text-primary font-semibold" onClick={() => setView({ name: "search", q: "" })}>
            {tr(locale, "View all", "すべて見る")}
          </Button>
        }>
          <h2 id="ending-title" className="inline-flex items-center gap-1.5">
            ⏳ {tr(locale, "Ending soon", "まもなく終了")}
          </h2>
        </SectionTitle>
        {ending === null ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="w-44 shrink-0 border rounded-lg overflow-hidden"><div className="aspect-[4/3] bg-muted animate-pulse" /><div className="p-2.5 space-y-2"><div className="h-3 bg-muted rounded animate-pulse" /><div className="h-4 w-16 bg-muted rounded animate-pulse" /></div></div>)}
          </div>
        ) : ending.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr(locale, "No auctions are ending right now.", "まもなく終了するオークションはありません。")}</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto tgs-scroll pb-2 -mx-1 px-1">
            {ending.map(l => <EndingTile key={l.id} l={l} />)}
          </div>
        )}
      </section>

      {/* ── Recommended grid ── */}
      <section aria-labelledby="recs-title">
        <SectionTitle><span className="text-base font-bold tracking-tight" id="recs-title">✨ {tr(locale, "Recommended for you", "おすすめ")}</span></SectionTitle>
        {recs === null ? (
          <CardSkeletonGrid count={8} />
        ) : recs.length === 0 ? (
          <Empty icon="🛒" title={tr(locale, "No live listings yet", "出品がまだありません")} hint={tr(locale, "Sellers are stocking the shelves — check back soon.", "出品準備中です。しばらくお待ちください。")} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {recs.map(l => <ListingCard key={l.id} l={l} />)}
          </div>
        )}
      </section>

      {/* ── Trust row ── */}
      <section aria-labelledby="trust-title" className="pt-1">
        <SectionTitle><span className="text-base font-bold tracking-tight" id="trust-title">🛡️ {tr(locale, "Why trade on Tengasell", "Tengasellが選ばれる理由")}</span></SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TrustCard
            icon={<ShieldCheck className="w-5 h-5 text-primary" aria-hidden />}
            title={tr(locale, "Buyer Protection", "バイヤー保護")}
            body={tr(locale, "On-platform payments are covered. If the item never arrives or differs from the description, you're refunded.", "プラットフォーム内での支払いは保護対象。未着・相違時は返金されます。")}
          />
          <TrustCard
            icon={<Scale className="w-5 h-5 text-primary" aria-hidden />}
            title={tr(locale, "Mediated disputes", "仲介による紛争解決")}
            body={tr(locale, "Our Trust & Safety team mediates every dispute within 24 hours — evidence-based, transparent outcomes.", "信頼・安全チームが24時間以内に仲介。証拠に基づき公平に判断します。")}
          />
          <TrustCard
            icon={<BadgeCheck className="w-5 h-5 text-primary" aria-hidden />}
            title={tr(locale, "Verified sellers", "認証出品者")}
            body={tr(locale, "Identity, business and payout checks before a shop can sell. Health scores keep quality high.", "本人・事業者・振込確認済みのみ出品可能。ヘルススコアで品質を担保。")}
          />
        </div>
      </section>
    </div>
  )
}

function EndingTile({ l }: { l: ListingCardData }) {
  const { locale, setView } = useApp()
  const left = l.endsAt ? timeLeft(l.endsAt, locale) : null
  const hot = left && !left.includes("d") // under a day
  return (
    <button
      onClick={() => setView({ name: "item", id: l.id })}
      className="w-44 shrink-0 text-left border rounded-lg overflow-hidden bg-card hover:shadow-md hover:border-primary/40 transition-all"
      aria-label={l.title}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <ImageTile listing={l} />
        <span className={`absolute top-2 left-2 text-[11px] font-bold px-1.5 py-0.5 rounded border bg-background/95 ${hot ? "text-[#b8860b]" : ""}`}>
          {left}
        </span>
      </div>
      <div className="p-2.5 space-y-1">
        <p className="text-xs font-medium leading-snug line-clamp-2 min-h-8">{l.title}</p>
        <div className="flex items-center justify-between">
          <Price value={l.currentPrice} size="sm" />
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5"><Gavel className="w-3 h-3" aria-hidden />{l.bidCount ?? 0}</span>
        </div>
      </div>
    </button>
  )
}

function TrustCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="border rounded-lg p-4 bg-card hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <h3 className="font-bold text-sm">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  )
}
