"use client"
// ── Shared experience-plane UI primitives: cards, stars, chips, ticks ──
import { useEffect, useState } from "react"
import { Eye, Gavel, Package, Star, Tag, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useApp, tr } from "@/lib/tengasell/store"
import { Price, timeLeft } from "../../ui"
import type { ListingCardData } from "./types"

/** Re-render on an interval so countdowns stay live (30s per contract). */
export function useTick(intervalMs = 30_000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
}

export function Stars({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const cls = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5"
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} className={`${cls} ${n <= Math.round(value) ? "fill-[#e5b93b] text-[#e5b93b]" : "fill-muted text-muted-foreground/30"}`} aria-hidden />
      ))}
    </span>
  )
}

export function ConditionBadge({ condition }: { condition: string }) {
  const { locale } = useApp()
  const map: Record<string, [string, string]> = {
    NEW: ["New", "新品"],
    USED: ["Used", "中古"],
    REFURB: ["Refurbished", "整備済"],
  }
  const [en, ja] = map[condition] || [condition, condition]
  return <Badge variant={condition === "NEW" ? "default" : "outline"} className="text-[11px] font-medium">{tr(locale, en, ja)}</Badge>
}

export function TypeChip({ type }: { type: string }) {
  const { locale } = useApp()
  return type === "AUCTION" ? (
    <Badge variant="outline" className="text-[11px] font-medium border-[#b8860b]/40 text-[#b8860b]">
      <Gavel className="w-3 h-3 mr-0.5" aria-hidden />{tr(locale, "Auction", "オークション")}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[11px] font-medium">
      <Tag className="w-3 h-3 mr-0.5" aria-hidden />{tr(locale, "Buy-Now", "即決")}
    </Badge>
  )
}

/** Fallback tile when a listing has no photo: gradient + category emoji. */
export function ImageTile({ listing, className = "" }: { listing: { images: string[]; title: string; category?: { icon: string } | null }; className?: string }) {
  const img = listing.images?.[0]
  if (img) {
    return (
      <img src={img} alt={listing.title} className={`w-full h-full object-cover ${className}`} loading="lazy" />
    )
  }
  return (
    <div className={`w-full h-full tgs-gradient-teal flex items-center justify-center ${className}`} role="img" aria-label={listing.title}>
      <span className="text-4xl" aria-hidden>{listing.category?.icon || "📦"}</span>
    </div>
  )
}

/** Marketplace listing card (grid). Click-through to item page. */
export function ListingCard({ l, compact = false }: { l: ListingCardData; compact?: boolean }) {
  const { locale, setView } = useApp()
  const open = () => setView({ name: "item", id: l.id })
  const left = l.type === "AUCTION" && l.endsAt ? timeLeft(l.endsAt, locale) : null
  const price = l.type === "BUY_NOW" ? (l.buyNowPrice ?? l.startingPrice) : l.currentPrice
  const ended = l.status !== "ACTIVE"

  return (
    <button
      onClick={open}
      className="group text-left border rounded-lg overflow-hidden bg-card hover:shadow-md hover:border-primary/40 transition-all duration-200 focus-visible:outline-2 h-full flex flex-col"
      aria-label={`${l.title} — ${l.type === "AUCTION" ? tr(locale, "current bid", "現在価格") : tr(locale, "buy now", "即決価格")} $${price}`}
    >
      <div className={`relative ${compact ? "aspect-[4/3]" : "aspect-square"} overflow-hidden`}>
        <div className="w-full h-full group-hover:scale-[1.03] transition-transform duration-300">
          <ImageTile listing={l} />
        </div>
        {left && !ended && (
          <span className={`absolute top-2 left-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-background/95 border ${left.includes("Ended") || left.includes("終了") ? "" : "text-[#b8860b]"}`}>
            {left}
          </span>
        )}
        {ended && (
          <span className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-secondary border uppercase tracking-wide">{l.status}</span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <ConditionBadge condition={l.condition} />
          <TypeChip type={l.type} />
        </div>
        <p className="text-sm font-medium leading-snug line-clamp-2 min-h-10">{l.title}</p>
        <Price value={price} />
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-auto pt-1">
          {l.type === "AUCTION" ? (
            <span className="inline-flex items-center gap-0.5"><Gavel className="w-3 h-3" aria-hidden />{l.bidCount ?? 0}</span>
          ) : (
            <span className="inline-flex items-center gap-0.5"><Package className="w-3 h-3" aria-hidden />{tr(locale, "Buy-Now", "即決")}</span>
          )}
          <span className="inline-flex items-center gap-0.5"><Eye className="w-3 h-3" aria-hidden />{l.watchCount ?? 0}</span>
          {l.seller && (
            <span className="ml-auto inline-flex items-center gap-1 truncate max-w-32">
              <span aria-hidden>{l.seller.avatarEmoji}</span>
              <span className="truncate">{l.seller.shopName}</span>
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

/** Small horizontal card for strips (ending soon, watchlist). */
export function ListingStripCard({ l, onRemove }: { l: ListingCardData; onRemove?: () => void }) {
  const { locale, setView } = useApp()
  const left = l.endsAt ? timeLeft(l.endsAt, locale) : null
  const price = l.type === "BUY_NOW" ? (l.buyNowPrice ?? l.startingPrice) : l.currentPrice
  return (
    <div className="relative w-44 shrink-0">
      <button
        onClick={() => setView({ name: "item", id: l.id })}
        className="w-full text-left border rounded-lg overflow-hidden bg-card hover:shadow-md hover:border-primary/40 transition-all h-full"
        aria-label={l.title}
      >
        <div className="relative aspect-[4/3] overflow-hidden">
          <ImageTile listing={l} />
          {left && (
            <span className={`absolute top-2 left-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-background/95 border text-[#b8860b]`}>{left}</span>
          )}
        </div>
        <div className="p-2.5 space-y-1">
          <p className="text-xs font-medium leading-snug line-clamp-2 min-h-8">{l.title}</p>
          <Price value={price} size="sm" />
          {l.type === "AUCTION" && (
            <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><Gavel className="w-3 h-3" aria-hidden />{l.bidCount ?? 0} {tr(locale, "bids", "入札")}</p>
          )}
        </div>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-background/95 border shadow-sm text-muted-foreground hover:text-destructive"
          aria-label={tr(locale, "Remove from watchlist", "ウォッチ解除")}
        >
          ✕
        </button>
      )}
    </div>
  )
}

export function CategoryChip({ c, onClick }: { c: { slug: string; name: string; nameJa: string; icon: string; listingCount?: number }; onClick?: () => void }) {
  const { locale, setView } = useApp()
  return (
    <button
      onClick={onClick || (() => setView({ name: "category", slug: c.slug }))}
      className="shrink-0 inline-flex items-center gap-2 border rounded-full px-3.5 h-11 bg-card hover:border-primary/50 hover:shadow-sm transition-all"
      aria-label={tr(locale, `Browse ${c.name}`, `${c.nameJa}を見る`)}
    >
      <span className="text-lg" aria-hidden>{c.icon}</span>
      <span className="text-sm font-semibold whitespace-nowrap">{tr(locale, c.name, c.nameJa)}</span>
      {typeof c.listingCount === "number" && <span className="text-[11px] text-muted-foreground tabular-nums">{c.listingCount}</span>}
    </button>
  )
}

/** Sort option chips shared by category/search pages. */
export const SORT_OPTIONS = [
  { key: "newest", en: "Newest", ja: "新着順" },
  { key: "ending", en: "Ending soon", ja: "終了間際" },
  { key: "price_asc", en: "Price ↑", ja: "価格 ↑" },
  { key: "price_desc", en: "Price ↓", ja: "価格 ↓" },
] as const

export function SortChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { locale } = useApp()
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto tgs-scroll -mx-1 px-1 py-0.5" role="group" aria-label={tr(locale, "Sort listings", "並べ替え")}>
      {SORT_OPTIONS.map(s => (
        <button
          key={s.key}
          onClick={() => onChange(s.key)}
          aria-pressed={value === s.key}
          className={`shrink-0 text-xs font-semibold rounded-full px-3 h-9 border transition-colors ${value === s.key ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
        >
          {tr(locale, s.en, s.ja)}
        </button>
      ))}
    </div>
  )
}

export function TrackingLine({ carrier, code }: { carrier: string | null; code: string | null }) {
  const { locale } = useApp()
  if (!code) return null
  return (
    <p className="text-xs inline-flex items-center gap-1.5 font-mono text-muted-foreground bg-secondary rounded-md px-2 py-1 w-fit">
      <Truck className="w-3.5 h-3.5 shrink-0" aria-hidden />
      {carrier ? `${carrier} · ` : ""}{code}
      <span className="sr-only">{tr(locale, "Tracking code", "追跡番号")}</span>
    </p>
  )
}
