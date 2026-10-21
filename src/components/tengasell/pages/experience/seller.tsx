"use client"
// ── SellerPage: shop header (badges, rating, health), live listings, public reviews ──
import { useEffect, useState } from "react"
import { BadgeCheck, Clock, MapPin } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { CardSkeletonGrid, Empty, SectionTitle, StatusBadge, fmtDate } from "../../ui"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { ListingCard, Stars } from "./bits"
import type { SellerPageData } from "./types"

export function SellerPage({ slug }: { slug: string }) {
  const { locale } = useApp()
  const [res, setRes] = useState<{ slug: string; data?: SellerPageData; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    api<SellerPageData>(`/api/sellers/${slug}`)
      .then(r => { if (alive) setRes({ slug, data: r.ok ? r.data : undefined, error: r.ok ? undefined : r.error?.message || "error" }) })
      .catch(() => { if (alive) setRes({ slug, error: "Network error" }) })
    return () => { alive = false }
  }, [slug])

  if (res?.slug === slug && res.error) {
    return <Empty icon="🏪" title={tr(locale, "Shop not found", "ショップが見つかりません")} hint={res.error} />
  }
  const data = res?.slug === slug ? res.data : undefined
  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-xl bg-muted animate-pulse border" />
        <CardSkeletonGrid count={4} />
      </div>
    )
  }

  const s = data.seller
  return (
    <div className="space-y-6">
      {/* shop header */}
      <header className="border rounded-xl p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 bg-card">
        <span aria-hidden className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center text-5xl shrink-0 mx-auto sm:mx-0">{s.avatarEmoji}</span>
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <div className="flex items-center gap-2 justify-center sm:justify-start flex-wrap">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">{s.shopName}</h1>
            {s.status === "VERIFIED" ? (
              <Badge className="gap-1 font-bold"><BadgeCheck className="w-3.5 h-3.5" aria-hidden />{tr(locale, "Verified", "認証済")}</Badge>
            ) : s.status === "PENDING" ? (
              <Badge variant="outline" className="gap-1"><Clock className="w-3.5 h-3.5" aria-hidden />{tr(locale, "Verification pending", "認証待ち")}</Badge>
            ) : (
              <StatusBadge status={s.status} />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5 justify-center sm:justify-start flex-wrap">
            <Stars value={s.ratingAvg} size="md" />
            <span className="text-sm font-semibold">{s.ratingAvg.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">({s.ratingCount} {tr(locale, "reviews", "件の評価")})</span>
          </div>
          {s.bio && <p className="text-sm text-muted-foreground mt-2 max-w-xl">{s.bio}</p>}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground justify-center sm:justify-start flex-wrap">
            {s.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" aria-hidden />{s.city}</span>}
            <span>{tr(locale, "Member since", "登録")}: {fmtDate(s.joinedAt)}</span>
            <span className={`font-bold rounded px-1.5 py-0.5 border ${s.healthScore >= 90 ? "text-primary border-primary/40" : "text-[#b8860b] border-[#b8860b]/40"}`}>
              {tr(locale, `Health ${s.healthScore}`, `健全性 ${s.healthScore}`)}
            </span>
          </div>
        </div>
      </header>

      {/* listings */}
      <section aria-labelledby="sl-title">
        <SectionTitle><span className="text-base font-bold tracking-tight" id="sl-title">🛍️ {tr(locale, "Live listings", "出品中の商品")}</span></SectionTitle>
        {data.listings.length === 0 ? (
          <Empty icon="📦" title={tr(locale, "No live listings right now", "現在出品中の商品はありません")} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {data.listings.map(l => <ListingCard key={l.id} l={l} />)}
          </div>
        )}
      </section>

      {/* reviews */}
      <section aria-labelledby="sr-title">
        <SectionTitle><span className="text-base font-bold tracking-tight" id="sr-title">⭐ {tr(locale, "Buyer reviews", "バイヤーの評価")}</span></SectionTitle>
        {data.reviews.length === 0 ? (
          <Empty icon="✍️" title={tr(locale, "No reviews yet", "評価はまだありません")} hint={tr(locale, "Reviews appear after completed orders.", "取引完了後に評価が表示されます。")} />
        ) : (
          <ul className="space-y-2.5">
            {data.reviews.map(r => (
              <li key={r.id} className="border rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-xl">{r.authorEmoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{r.authorName}</p>
                    <div className="flex items-center gap-2">
                      <Stars value={r.rating} />
                      <span className="text-[11px] text-muted-foreground">{fmtDate(r.createdAt)}</span>
                    </div>
                  </div>
                </div>
                {r.title && <p className="text-sm font-semibold mt-2">{r.title}</p>}
                {r.body && <p className="text-sm text-muted-foreground mt-1">{r.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
