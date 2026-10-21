"use client"
// ── SellPage: listing form (auction/buy-now) with image picker + preview, and "My listings" tab.
// BUYERS get a "Become a seller" gate (support-assisted application). ──
import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, ClipboardCheck, Eye, Gavel, ImagePlus, Send, Sparkles, Store, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CardSkeletonGrid, Empty, Price, SectionTitle, StatusBadge, fmtDate } from "../../ui"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { toast } from "@/hooks/use-toast"
import { ConditionBadge, ImageTile, ListingCard } from "./bits"
import { PRESET_IMAGES, type CategoryList, type ListingCardData, type ListingSearchResult } from "./types"

const DURATIONS = [
  { h: 1, en: "1 hour", ja: "1時間" }, { h: 3, en: "3 hours", ja: "3時間" },
  { h: 6, en: "6 hours", ja: "6時間" }, { h: 12, en: "12 hours", ja: "12時間" },
  { h: 24, en: "1 day", ja: "1日" }, { h: 48, en: "2 days", ja: "2日" },
  { h: 72, en: "3 days", ja: "3日" }, { h: 120, en: "5 days", ja: "5日" },
]

const FORM_DEFAULTS = {
  title: "", description: "", categoryId: "", condition: "USED",
  type: "AUCTION" as "AUCTION" | "BUY_NOW",
  startPrice: "", buyNowPrice: "", price: "", stock: "5",
  duration: "48", images: [] as string[],
}

export function SellPage() {
  const { locale, session, setView } = useApp()
  const [tab, setTab] = useState("new")

  if (!session) {
    return (
      <Empty icon="🔐" title={tr(locale, "Sign in to sell", "出品するにはログイン")} hint={tr(locale, "Sellers must be identity-verified — apply from your account.", "出品には本人確認が必要です。")}>
        <Button className="mt-4 h-11" onClick={() => setView({ name: "auth" })}>{tr(locale, "Sign in", "ログイン")}</Button>
      </Empty>
    )
  }

  const isSeller = session.role === "SELLER" || session.role === "ADMIN" || session.role === "MODERATOR"
  if (!isSeller) {
    return <BecomeSellerGate />
  }

  return (
    <div className="space-y-4">
      <SectionTitle>
        <h1 className="text-lg inline-flex items-center gap-2"><Store className="w-5 h-5 text-primary" aria-hidden />{tr(locale, "Seller Hub", "セラーハブ")}</h1>
      </SectionTitle>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-2 h-11 w-full max-w-sm">
          <TabsTrigger value="new" className="text-sm font-semibold">{tr(locale, "New listing", "新規出品")}</TabsTrigger>
          <TabsTrigger value="mine" className="text-sm font-semibold">{tr(locale, "My listings", "私の出品")}</TabsTrigger>
        </TabsList>
        <TabsContent value="new" className="mt-4">
          <NewListingForm onSubmitted={() => setTab("mine")} />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <MyListings />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function BecomeSellerGate() {
  const { locale, setView } = useApp()
  const requirements = [
    { icon: ClipboardCheck, en: "National ID or passport verification", ja: "身分証（ID・パスポート）確認" },
    { icon: Tag, en: "Business registration (or sole-trader declaration)", ja: "事業者登録（または個人事業主の申告）" },
    { icon: Store, en: "Bank / mobile-money payout details", ja: "銀行・モバイルマネーの振込先情報" },
    { icon: Sparkles, en: "Two quality listings to start", ja: "まずは2件の出品から" },
  ]
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <header className="text-center py-6">
        <span aria-hidden className="text-5xl block mb-3">🦁</span>
        <h1 className="text-2xl font-extrabold tracking-tight">{tr(locale, "Become a Tengasell seller", "Tengasell出品者になる")}</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          {tr(locale, "Reach buyers across Zimbabwe with verified, protected auctions. Commission is just 5% per sale.", "ジンバブエ中のバイヤーへ。落札手数料は5%のみ。")}
        </p>
      </header>
      <div className="border rounded-xl p-5 space-y-3 bg-card">
        <h2 className="font-bold">{tr(locale, "Seller requirements", "出品者の要件")}</h2>
        <ul className="space-y-2.5">
          {requirements.map(r => {
            const Icon = r.icon
            return (
              <li key={r.en} className="flex items-start gap-3 text-sm">
                <Icon className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
                <span>{tr(locale, r.en, r.ja)}</span>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground border-t pt-3">
          {tr(
            locale,
            "Applications are currently reviewed by our support team (MSCS identity controls). Contact support to start verification.",
            "現在、申請はサポートチームによる審査です（MSCS本人確認管理）。認証を開始するにはサポートへご連絡ください。",
          )}
        </p>
        <Button className="h-11 font-semibold" onClick={() => setView({ name: "help" })}>
          {tr(locale, "Contact support", "サポートに連絡")}
        </Button>
      </div>
    </div>
  )
}

function NewListingForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { locale, session } = useApp()
  const [cats, setCats] = useState<CategoryList["items"] | null>(null)
  const [form, setForm] = useState({ ...FORM_DEFAULTS })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<CategoryList>("/api/categories").then(r => { if (alive && r.ok) setCats(r.data!.items) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }))

  const toggleImage = (img: string) => {
    setForm(f => {
      const has = f.images.includes(img)
      if (has) return { ...f, images: f.images.filter(i => i !== img) }
      if (f.images.length >= 4) return f
      return { ...f, images: [...f.images, img] }
    })
  }

  const preview = useMemo<ListingCardData>(() => ({
    id: "preview",
    title: form.title || tr(locale, "Your listing title appears here", "出品タイトルがここに表示されます"),
    condition: form.condition as "NEW" | "USED" | "REFURB",
    type: form.type,
    startingPrice: Number(form.type === "BUY_NOW" ? form.price : form.startPrice) || 0,
    buyNowPrice: form.type === "BUY_NOW" ? (Number(form.price) || 0) : (Number(form.buyNowPrice) || null),
    currentPrice: Number(form.type === "BUY_NOW" ? form.price : form.startPrice) || 0,
    images: form.images,
    status: "PENDING_REVIEW",
    endsAt: null,
    bidCount: 0,
    watchCount: 0,
    viewCount: 0,
    createdAt: new Date().toISOString(),
    seller: { id: session?.id || "", shopName: session?.name || tr(locale, "You", "あなた"), slug: null, avatarEmoji: "🙂" },
    category: cats?.find(c => c.id === form.categoryId) || null,
  }), [form, cats, locale, session])

  const titleOk = form.title.trim().length >= 5 && form.title.length <= 120
  const descOk = form.description.trim().length >= 10
  const priceOk = form.type === "BUY_NOW" ? Number(form.price) > 0 : Number(form.startPrice) > 0
  const durOk = form.type === "BUY_NOW" || (Number(form.duration) >= 1 && Number(form.duration) <= 120)
  const valid = titleOk && descOk && !!form.categoryId && priceOk && durOk

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim(),
      categoryId: form.categoryId,
      condition: form.condition,
      type: form.type,
      images: form.images,
    }
    if (form.type === "AUCTION") {
      payload.startingPrice = Number(form.startPrice)
      if (form.buyNowPrice) payload.buyNowPrice = Number(form.buyNowPrice)
      payload.endsAtHours = Number(form.duration)
    } else {
      payload.startingPrice = Number(form.price)
      payload.buyNowPrice = Number(form.price)
      payload.stock = Math.max(1, Number(form.stock) || 1)
    }
    const r = await api<{ id: string }>("/api/listings", { method: "POST", body: JSON.stringify(payload) })
    setBusy(false)
    if (!r.ok) {
      toast({ title: tr(locale, "Could not submit listing", "出品できませんでした"), description: r.error?.message, variant: "destructive" })
      return
    }
    toast({
      title: tr(locale, "Sent for review 🎉", "審査に送信しました 🎉"),
      description: tr(locale, "Moderators check listings within 24h — you'll be notified when it goes live.", "24時間以内に審査します。公開時に通知します。"),
    })
    setForm({ ...FORM_DEFAULTS })
    onSubmitted()
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); submit() }} aria-label={tr(locale, "New listing", "新規出品")}>
        {/* title */}
        <div>
          <Label htmlFor="sl-title-input">{tr(locale, "Title", "タイトル")} <span className="text-destructive">*</span></Label>
          <Input id="sl-title-input" maxLength={120} value={form.title} onChange={e => set("title", e.target.value)} className="mt-1 h-11" placeholder={tr(locale, "e.g. Samsung Galaxy S23 (Used, Excellent)", "例：Samsung Galaxy S23（中古・美品）")} aria-describedby="sl-title-hint" />
          <p id="sl-title-hint" className={`text-[11px] mt-1 ${form.title && !titleOk ? "text-destructive" : "text-muted-foreground"}`}>
            {tr(locale, "5–120 characters.", "5〜120文字。")} ({form.title.length}/120)
          </p>
        </div>

        {/* description */}
        <div>
          <Label htmlFor="sl-desc">{tr(locale, "Description", "説明")} <span className="text-destructive">*</span></Label>
          <Textarea id="sl-desc" rows={5} maxLength={5000} value={form.description} onChange={e => set("description", e.target.value)} className="mt-1" placeholder={tr(locale, "Honest descriptions sell faster: condition, accessories, flaws, reason for selling…", "正直な説明が売れ行きを左右します：状態・付属品・欠点・出品理由…")} aria-describedby="sl-desc-hint" />
          <p id="sl-desc-hint" className={`text-[11px] mt-1 ${form.description && !descOk ? "text-destructive" : "text-muted-foreground"}`}>
            {tr(locale, "Minimum 10 characters.", "10文字以上。")}
          </p>
        </div>

        {/* category + condition */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sl-cat">{tr(locale, "Category", "カテゴリー")} <span className="text-destructive">*</span></Label>
            <Select value={form.categoryId} onValueChange={v => set("categoryId", v)}>
              <SelectTrigger id="sl-cat" className="mt-1 h-11"><SelectValue placeholder={tr(locale, "Choose…", "選択…")} /></SelectTrigger>
              <SelectContent>
                {(cats || []).map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {tr(locale, c.name, c.nameJa)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="sl-cond">{tr(locale, "Condition", "状態")} <span className="text-destructive">*</span></Label>
            <Select value={form.condition} onValueChange={v => set("condition", v)}>
              <SelectTrigger id="sl-cond" className="mt-1 h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NEW">{tr(locale, "New", "新品")}</SelectItem>
                <SelectItem value="USED">{tr(locale, "Used", "中古")}</SelectItem>
                <SelectItem value="REFURB">{tr(locale, "Refurbished", "整備済")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* type toggle */}
        <div>
          <Label>{tr(locale, "Selling format", "販売形式")}</Label>
          <div className="grid grid-cols-2 gap-2 mt-1" role="group">
            <button
              type="button" onClick={() => set("type", "AUCTION")} aria-pressed={form.type === "AUCTION"}
              className={`h-14 rounded-lg border font-semibold flex flex-col items-center justify-center gap-0.5 transition-colors ${form.type === "AUCTION" ? "border-primary bg-primary/5 text-primary" : "hover:border-primary/40"}`}
            >
              <Gavel className="w-4 h-4" aria-hidden />{tr(locale, "Auction", "オークション")}
            </button>
            <button
              type="button" onClick={() => set("type", "BUY_NOW")} aria-pressed={form.type === "BUY_NOW"}
              className={`h-14 rounded-lg border font-semibold flex flex-col items-center justify-center gap-0.5 transition-colors ${form.type === "BUY_NOW" ? "border-primary bg-primary/5 text-primary" : "hover:border-primary/40"}`}
            >
              <Tag className="w-4 h-4" aria-hidden />{tr(locale, "Buy-Now", "即決")}
            </button>
          </div>
        </div>

        {/* price block */}
        {form.type === "AUCTION" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sl-start">{tr(locale, "Starting price (USD)", "開始価格 (USD)")} <span className="text-destructive">*</span></Label>
              <Input id="sl-start" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.startPrice} onChange={e => set("startPrice", e.target.value)} className="mt-1 h-11" placeholder="45" />
            </div>
            <div>
              <Label htmlFor="sl-buynow">{tr(locale, "Buy-Now price (optional)", "即決価格（任意）")}</Label>
              <Input id="sl-buynow" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.buyNowPrice} onChange={e => set("buyNowPrice", e.target.value)} className="mt-1 h-11" placeholder="95" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="sl-dur">{tr(locale, "Duration", "期間")}</Label>
              <Select value={form.duration} onValueChange={v => set("duration", v)}>
                <SelectTrigger id="sl-dur" className="mt-1 h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map(d => <SelectItem key={d.h} value={String(d.h)}>{tr(locale, d.en, d.ja)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">{tr(locale, "1–120 hours.", "1〜120時間。")}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sl-price">{tr(locale, "Price (USD)", "価格 (USD)")} <span className="text-destructive">*</span></Label>
              <Input id="sl-price" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.price} onChange={e => set("price", e.target.value)} className="mt-1 h-11" placeholder="89" />
            </div>
            <div>
              <Label htmlFor="sl-stock">{tr(locale, "Stock", "在庫")}</Label>
              <Input id="sl-stock" type="number" min="1" max="999" value={form.stock} onChange={e => set("stock", e.target.value)} className="mt-1 h-11" />
            </div>
          </div>
        )}

        {/* image picker */}
        <fieldset>
          <legend className="text-sm font-semibold mb-1.5">{tr(locale, "Photos (up to 4)", "写真（最大4枚）")}</legend>
          <p className="text-[11px] text-muted-foreground mb-2">
            <ImagePlus className="w-3.5 h-3.5 inline mb-0.5" aria-hidden />{" "}
            {tr(locale, "Tap to select from the media library. No photo? We'll show a branded tile.", "タップしてメディアライブラリから選択。未選択の場合はブランドタイルを表示します。")}
          </p>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2" role="group">
            {PRESET_IMAGES.map(img => {
              const idx = form.images.indexOf(img)
              const selected = idx >= 0
              return (
                <button
                  key={img}
                  type="button"
                  onClick={() => toggleImage(img)}
                  aria-pressed={selected}
                  aria-label={`${tr(locale, "Photo", "写真")} ${img} ${selected ? tr(locale, "selected", "選択中") : ""}`}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${selected ? "border-primary ring-2 ring-primary/30" : "border-transparent opacity-80 hover:opacity-100"}`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                  {selected && (
                    <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold grid place-items-center" aria-hidden>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </fieldset>

        <Button type="submit" className="w-full h-12 text-base font-bold" disabled={!valid || busy}>
          <Send className="w-4 h-4 mr-1.5" aria-hidden />
          {busy ? tr(locale, "Submitting…", "送信中…") : tr(locale, "Submit for review", "審査に送る")}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          {tr(locale, "Listings enter the moderation queue (max 10/hour). Listing is free — 5% commission on sale.", "出品は審査キューに入ります（1時間10件まで）。出品無料・落札手数料5%。")}
        </p>
      </form>

      {/* preview card */}
      <aside className="lg:sticky lg:top-20 space-y-2" aria-label={tr(locale, "Live preview", "プレビュー")}>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{tr(locale, "Preview", "プレビュー")}</p>
        <div className="w-full max-w-56 pointer-events-none">
          <ListingCard l={preview} />
        </div>
        <p className="text-[11px] text-muted-foreground">{tr(locale, "Shown with “In review” status until a moderator approves it.", "モデレーターが承認するまで「審査中」ステータスで表示されます。")}</p>
      </aside>
    </div>
  )
}

function MyListings() {
  const { locale, setView } = useApp()
  const [items, setItems] = useState<ListingCardData[] | null>(null)

  useEffect(() => {
    let alive = true
    api<ListingSearchResult>("/api/listings?mine=1&limit=50")
      .then(r => { if (alive && r.ok) setItems(r.data!.items) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  if (items === null) return <CardSkeletonGrid count={4} />
  if (items.length === 0) {
    return <Empty icon="📦" title={tr(locale, "No listings yet", "まだ出品はありません")} hint={tr(locale, "Your first listing is one form away.", "最初の出品はフォーム一つで始められます。")} />
  }
  return (
    <ul className="space-y-2.5">
      {items.map(l => (
        <li key={l.id} className="border rounded-lg p-3 flex items-center gap-3 hover:shadow-sm transition-shadow bg-card">
          <button className="w-16 h-16 rounded-lg overflow-hidden shrink-0 border" onClick={() => setView({ name: "item", id: l.id })} aria-label={l.title}>
            <ImageTile listing={l} />
          </button>
          <div className="min-w-0 flex-1">
            <button className="text-left w-full" onClick={() => setView({ name: "item", id: l.id })}>
              <p className="font-semibold text-sm truncate hover:text-primary">{l.title}</p>
            </button>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={l.status} />
              <ConditionBadge condition={l.condition} />
              {l.type === "AUCTION" ? (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Gavel className="w-3 h-3" aria-hidden />{l.bidCount ?? 0}</span>
              ) : null}
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Eye className="w-3 h-3" aria-hidden />{l.viewCount ?? 0}</span>
            </div>
            {l.rejectReason && <p className="text-[11px] text-destructive mt-1 truncate">{tr(locale, "Rejected", "却下")}: {l.rejectReason}</p>}
            {l.status === "PENDING_REVIEW" && <p className="text-[11px] text-[#b8860b] mt-1">{tr(locale, "Awaiting moderation (usually < 24h)", "審査待ち（通常24時間以内）")}</p>}
          </div>
          <div className="text-right shrink-0">
            <Price value={l.type === "BUY_NOW" ? (l.buyNowPrice ?? l.startingPrice) : l.currentPrice} size="sm" />
            <p className="text-[11px] text-muted-foreground mt-0.5">{fmtDate(l.createdAt)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
