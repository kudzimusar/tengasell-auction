"use client"
// ── CategoryPage + SearchPage: grids, filters, sort tabs, load-more pagination ──
import { useEffect, useState } from "react"
import { Search, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CardSkeletonGrid, Empty, SectionTitle } from "../../ui"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { ListingCard, SortChips } from "./bits"
import type { CategoryList, ListingCardData, ListingSearchResult } from "./types"

// ── shared paginated feed ──
function useListingFeed(params: { q?: string; category?: string; type?: string; sort: string; pageSize?: number }) {
  const key = JSON.stringify(params)
  // Reset pagination when filters change (render-phase adjust — avoids setState-in-effect)
  const [pageState, setPageState] = useState({ key, page: 1 })
  if (pageState.key !== key) setPageState({ key, page: 1 })
  const page = pageState.key === key ? pageState.page : 1
  const [result, setResult] = useState<{ key: string; items: ListingCardData[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      setError(null)
      const sp = new URLSearchParams({ limit: String(params.pageSize || 12), page: "1", sort: params.sort })
      if (params.q) sp.set("q", params.q)
      if (params.category) sp.set("category", params.category)
      if (params.type) sp.set("type", params.type)
      const r = await api<ListingSearchResult>(`/api/listings?${sp}`)
      if (!alive) return
      if (r.ok) setResult({ key, items: r.data!.items, total: r.data!.total })
      else setError(r.error?.message || "error")
      setLoading(false)
    }
    run()
    return () => { alive = false }
  }, [key])

  const items = result && result.key === key ? result.items : null
  const total = result && result.key === key ? result.total : 0

  const loadMore = async () => {
    if (!items) return
    setLoading(true)
    const next = page + 1
    const sp = new URLSearchParams({ limit: String(params.pageSize || 12), page: String(next), sort: params.sort })
    if (params.q) sp.set("q", params.q)
    if (params.category) sp.set("category", params.category)
    if (params.type) sp.set("type", params.type)
    const r = await api<ListingSearchResult>(`/api/listings?${sp}`)
    if (r.ok) {
      setResult({ key, items: [...items, ...r.data!.items], total: r.data!.total })
      setPageState({ key, page: next })
    }
    setLoading(false)
  }

  const hasMore = items ? items.length < total : false
  return { items, total, loading, error, hasMore, loadMore }
}

function FeedGrid({ items, total, loading, error, hasMore, loadMore, emptyTitle, emptyHint }: {
  items: ListingCardData[] | null
  total: number
  loading: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  emptyTitle: string
  emptyHint?: string
}) {
  const { locale } = useApp()
  if (items === null && loading) return <CardSkeletonGrid count={12} />
  if (error) {
    return <Empty icon="⚠️" title={tr(locale, "Something went wrong", "エラーが発生しました")} hint={error}>
      <Button className="mt-4 h-11" onClick={() => window.location.reload()}>{tr(locale, "Retry", "再試行")}</Button>
    </Empty>
  }
  if (!items || items.length === 0) {
    return <Empty icon="🔍" title={emptyTitle} hint={emptyHint} />
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total} {tr(locale, total === 1 ? "listing" : "listings", "件の出品")}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(l => <ListingCard key={l.id} l={l} />)}
      </div>
      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" className="h-11 px-8 font-semibold" onClick={loadMore} disabled={loading}>
            {loading ? tr(locale, "Loading…", "読み込み中…") : tr(locale, "Load more", "もっと見る")}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── CategoryPage ──
export function CategoryPage({ slug }: { slug: string }) {
  const { locale } = useApp()
  const [cats, setCats] = useState<CategoryList["items"] | null>(null)
  const [sort, setSort] = useState("newest")
  const feed = useListingFeed({ category: slug, sort, pageSize: 12 })

  useEffect(() => {
    let alive = true
    api<CategoryList>("/api/categories").then(r => { if (alive && r.ok) setCats(r.data!.items) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  const cat = cats?.find(c => c.slug === slug)
  return (
    <div className="space-y-4">
      {cat ? (
        <header className="border rounded-lg bg-card p-4 sm:p-5 flex items-center gap-4">
          <span aria-hidden className="text-4xl sm:text-5xl">{cat.icon}</span>
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">{tr(locale, cat.name, cat.nameJa)}</h1>
            <p className="text-sm text-muted-foreground">{cat.listingCount} {tr(locale, "live listings", "件の出品")}</p>
          </div>
        </header>
      ) : (
        <div className="h-20 rounded-lg bg-muted animate-pulse border" />
      )}
      <SortChips value={sort} onChange={setSort} />
      <FeedGrid
        {...feed}
        emptyTitle={tr(locale, "Nothing live in this category yet", "このカテゴリーの出品はまだありません")}
        emptyHint={tr(locale, "Try another category, or check back soon.", "別のカテゴリーを試してください。")}
      />
    </div>
  )
}

// ── SearchPage ──
export function SearchPage({ q }: { q: string }) {
  const { locale, setView, setSearchQuery } = useApp()
  const [input, setInput] = useState(q || "")
  const [cats, setCats] = useState<CategoryList["items"] | null>(null)
  const [category, setCategory] = useState("all")
  const [type, setType] = useState("all")
  const [sort, setSort] = useState("relevance")
  // Keep the input in sync when the ?q prop changes (render-phase adjust)
  const [prevQ, setPrevQ] = useState(q)
  if (prevQ !== q) { setPrevQ(q); setInput(q || "") }
  useEffect(() => {
    let alive = true
    api<CategoryList>("/api/categories").then(r => { if (alive && r.ok) setCats(r.data!.items) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = input.trim()
    setSearchQuery(next)
    setView({ name: "search", q: next })
  }

  const feed = useListingFeed({
    q: q || undefined,
    category: category === "all" ? undefined : category,
    type: type === "all" ? undefined : type,
    sort: sort === "relevance" ? "newest" : sort,
    pageSize: 12,
  })

  const SUGGESTIONS = ["camera", "guitar", "dress", "laptop", "painting", "watch"]

  return (
    <div className="space-y-4">
      <SectionTitle>
        <h1 className="inline-flex items-center gap-2 text-lg">
          <Search className="w-5 h-5 text-primary" aria-hidden />
          {q ? tr(locale, `Results for “${q}”`, `「${q}」の検索結果`) : tr(locale, "Browse all listings", "すべての出品")}
        </h1>
      </SectionTitle>

      <form onSubmit={submit} role="search" className="flex gap-2">
        <label htmlFor="search-input" className="sr-only">{tr(locale, "Search listings", "出品を検索")}</label>
        <Input id="search-input" value={input} onChange={e => setInput(e.target.value)} className="h-11" placeholder={tr(locale, "Search listings…", "出品を検索…")} />
        <Button type="submit" className="h-11 px-5">{tr(locale, "Search", "検索")}</Button>
      </form>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1.5" role="group" aria-label={tr(locale, "Listing type", "出品タイプ")}>
          {[
            { key: "all", en: "All", ja: "すべて" },
            { key: "AUCTION", en: "Auction", ja: "オークション" },
            { key: "BUY_NOW", en: "Buy-Now", ja: "即決" },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setType(t.key)}
              aria-pressed={type === t.key}
              className={`text-xs font-semibold rounded-full px-3 h-9 border transition-colors ${type === t.key ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
            >
              {tr(locale, t.en, t.ja)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <SlidersHorizontal className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-10 w-40 sm:w-48" aria-label={tr(locale, "Category", "カテゴリー")}>
              <SelectValue placeholder={tr(locale, "All categories", "すべてのカテゴリー")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr(locale, "All categories", "すべてのカテゴリー")}</SelectItem>
              {(cats || []).map(c => <SelectItem key={c.slug} value={c.slug}>{c.icon} {tr(locale, c.name, c.nameJa)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-10 w-36" aria-label={tr(locale, "Sort", "並べ替え")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relevance">{tr(locale, "Relevance", "関連度")}</SelectItem>
              <SelectItem value="newest">{tr(locale, "Newest", "新着順")}</SelectItem>
              <SelectItem value="ending">{tr(locale, "Ending soon", "終了間際")}</SelectItem>
              <SelectItem value="price_asc">{tr(locale, "Price ↑", "価格 ↑")}</SelectItem>
              <SelectItem value="price_desc">{tr(locale, "Price ↓", "価格 ↓")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <FeedGrid
        {...feed}
        emptyTitle={tr(locale, "No listings match your search", "一致する出品がありません")}
        emptyHint={tr(locale, "Try fewer words or browse popular searches:", "語数を減らすか、人気の検索ワードを試してください:")}
      />
      {feed.items && feed.items.length === 0 && (
        <div className="flex flex-wrap justify-center gap-2 -mt-8">
          {SUGGESTIONS.map(s => (
            <Button key={s} variant="outline" size="sm" className="h-9 rounded-full" onClick={() => { setSearchQuery(s); setView({ name: "search", q: s }) }}>
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
