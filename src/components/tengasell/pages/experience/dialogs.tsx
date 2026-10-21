"use client"
// ── Order & trust dialogs: review (stars), dispute, ship tracking, report listing, bid confirm ──
import { useState } from "react"
import { PackageCheck, Scale, Star } from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { toast } from "@/hooks/use-toast"

// ── Review: stars + title + comment → POST /api/orders/[id]/review ──
export function ReviewDialog({ open, onOpenChange, orderId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; orderId: string; onDone: () => void
}) {
  const { locale } = useApp()
  const [rating, setRating] = useState(5)
  const [hover, setHover] = useState(0)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await api(`/api/orders/${orderId}/review`, {
      method: "POST",
      body: JSON.stringify({ rating, title: title.trim() || undefined, body: body.trim() || undefined }),
    })
    setBusy(false)
    if (!r.ok) {
      toast({ title: tr(locale, "Could not save review", "評価を保存できません"), description: r.error?.message, variant: "destructive" })
      return
    }
    toast({ title: tr(locale, "Thanks for the review! ⭐", "ご評価ありがとうございます！⭐") })
    onOpenChange(false)
    setTitle(""); setBody(""); setRating(5)
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr(locale, "Rate this purchase", "取引を評価")}</DialogTitle>
          <DialogDescription>{tr(locale, "Reviews are public and help other buyers.", "評価は公開され、他のバイヤーの参考になります。")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-1.5 py-1" role="radiogroup" aria-label={tr(locale, "Rating", "評価")}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} ${tr(locale, "star", "つ星")}`}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
                className="p-1 rounded hover:bg-secondary transition-transform hover:scale-110"
              >
                <Star className={`w-8 h-8 ${(hover || rating) >= n ? "fill-[#e5b93b] text-[#e5b93b]" : "fill-muted text-muted-foreground/40"}`} aria-hidden />
              </button>
            ))}
          </div>
          <div>
            <Label htmlFor="rv-title">{tr(locale, "Headline (optional)", "見出し（任意）")}</Label>
            <Input id="rv-title" maxLength={120} value={title} onChange={e => setTitle(e.target.value)} className="mt-1" placeholder={tr(locale, "Exactly as described, fast shipping…", "説明通り、発送も早い…")} />
          </div>
          <div>
            <Label htmlFor="rv-body">{tr(locale, "Your experience", "感想")}</Label>
            <Textarea id="rv-body" rows={3} maxLength={2000} value={body} onChange={e => setBody(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || rating < 1} className="w-full h-11">
            {busy ? tr(locale, "Saving…", "保存中…") : tr(locale, "Publish review", "評価を投稿")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Dispute: reason select + details → POST /api/orders/[id]/dispute ──
export function DisputeDialog({ open, onOpenChange, orderId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; orderId: string; onDone: () => void
}) {
  const { locale } = useApp()
  const [reason, setReason] = useState("ITEM_NOT_AS_DESCRIBED")
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await api(`/api/orders/${orderId}/dispute`, { method: "POST", body: JSON.stringify({ reason, details }) })
    setBusy(false)
    if (!r.ok) {
      toast({ title: tr(locale, "Could not open dispute", "紛争を開けません"), description: r.error?.message, variant: "destructive" })
      return
    }
    toast({ title: tr(locale, "Dispute opened — our team mediates within 24h", "紛争を開始しました。24時間以内に対応します"), variant: "default" })
    onOpenChange(false)
    setDetails("")
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Scale className="w-5 h-5 text-primary" aria-hidden />{tr(locale, "Open a dispute", "紛争を開く")}</DialogTitle>
          <DialogDescription>
            {tr(locale, "Only for paid orders where something went wrong. Tengasell mediates.", "支払い済み注文の問題解決用。Tengasellが仲介します。")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="dp-reason">{tr(locale, "Reason", "理由")}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="dp-reason" className="mt-1 h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ITEM_NOT_AS_DESCRIBED">{tr(locale, "Item not as described", "説明と違う")}</SelectItem>
                <SelectItem value="NOT_RECEIVED">{tr(locale, "Item not received", "商品が届かない")}</SelectItem>
                <SelectItem value="OTHER">{tr(locale, "Other", "その他")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="dp-details">{tr(locale, "What happened?", "詳細")}</Label>
            <Textarea id="dp-details" rows={3} maxLength={2000} value={details} onChange={e => setDetails(e.target.value)} className="mt-1" placeholder={tr(locale, "Describe the problem (min 10 characters)…", "問題を記入してください（10文字以上）…")} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || details.trim().length < 10} variant="destructive" className="w-full h-11">
            {busy ? tr(locale, "Opening…", "開始中…") : tr(locale, "Open dispute", "紛争を開く")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Ship: carrier + tracking → PATCH /api/orders/[id] action ship ──
export function ShipDialog({ open, onOpenChange, orderId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; orderId: string; onDone: () => void
}) {
  const { locale } = useApp()
  const [carrier, setCarrier] = useState("ZIMPOST")
  const [tracking, setTracking] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await api(`/api/orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "ship", carrier, trackingCode: tracking.trim() }),
    })
    setBusy(false)
    if (!r.ok) {
      toast({ title: tr(locale, "Could not mark shipped", "発送済みにできません"), description: r.error?.message, variant: "destructive" })
      return
    }
    toast({ title: tr(locale, "Marked as shipped 📦", "発送済みにしました 📦") })
    onOpenChange(false)
    setTracking("")
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PackageCheck className="w-5 h-5 text-primary" aria-hidden />{tr(locale, "Mark as shipped", "発送済みにする")}</DialogTitle>
          <DialogDescription>{tr(locale, "The buyer gets an email with your tracking code.", "バイヤーに追跡番号のメールが送られます。")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="sh-carrier">{tr(locale, "Carrier", "配送業者")}</Label>
            <Select value={carrier} onValueChange={setCarrier}>
              <SelectTrigger id="sh-carrier" className="mt-1 h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ZIMPOST">ZIMPOST</SelectItem>
                <SelectItem value="DHL">DHL Express</SelectItem>
                <SelectItem value="SWIFT">Swift Couriers</SelectItem>
                <SelectItem value="LOCAL">Local hand-delivery</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="sh-code">{tr(locale, "Tracking code", "追跡番号")}</Label>
            <Input id="sh-code" value={tracking} onChange={e => setTracking(e.target.value)} className="mt-1" placeholder="ZP123456789" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy || tracking.trim().length < 3} className="w-full h-11">
            {busy ? tr(locale, "Saving…", "保存中…") : tr(locale, "Confirm shipment", "発送を確定")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Report listing → POST /api/abuse-reports ──
export function ReportDialog({ open, onOpenChange, listingId, listingTitle }: {
  open: boolean; onOpenChange: (o: boolean) => void; listingId: string; listingTitle: string
}) {
  const { locale } = useApp()
  const [reason, setReason] = useState("PROHIBITED")
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const r = await api("/api/abuse-reports", {
      method: "POST",
      body: JSON.stringify({ targetType: "LISTING", targetId: listingId, reason, details: details.trim() || undefined }),
    })
    setBusy(false)
    if (!r.ok) {
      toast({ title: tr(locale, "Could not submit report", "報告できません"), description: r.error?.message, variant: "destructive" })
      return
    }
    toast({ title: tr(locale, "Report sent to Trust & Safety", "信頼・安全チームに報告しました"), description: tr(locale, "Our moderators review reports within 24h.", "24時間以内に審査します。") })
    onOpenChange(false)
    setDetails("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr(locale, "Report this listing", "この出品を報告")}</DialogTitle>
          <DialogDescription className="line-clamp-1">“{listingTitle}”</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="rp-reason">{tr(locale, "Reason", "理由")}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="rp-reason" className="mt-1 h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PROHIBITED">{tr(locale, "Prohibited goods", "禁止商品")}</SelectItem>
                <SelectItem value="COUNTERFEIT">{tr(locale, "Counterfeit", "偽造品")}</SelectItem>
                <SelectItem value="SCAM">{tr(locale, "Scam / fraud", "詐欺")}</SelectItem>
                <SelectItem value="ABUSE">{tr(locale, "Abusive content", "不適切な内容")}</SelectItem>
                <SelectItem value="SPAM">{tr(locale, "Spam", "スパム")}</SelectItem>
                <SelectItem value="OTHER">{tr(locale, "Other", "その他")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rp-details">{tr(locale, "Details (optional)", "詳細（任意）")}</Label>
            <Textarea id="rp-details" rows={3} maxLength={2000} value={details} onChange={e => setDetails(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy} variant="destructive" className="w-full h-11">
            {busy ? tr(locale, "Sending…", "送信中…") : tr(locale, "Submit report", "報告する")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Bid confirm (alert) ──
export function BidConfirmDialog({ open, onOpenChange, amount, minNext, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; amount: number | null; minNext: number; onConfirm: () => void
}) {
  const { locale } = useApp()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr(locale, "Confirm your bid", "入札を確認")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <span>
              {tr(locale, `You're bidding ${amount !== null ? `$${amount.toFixed(2)}` : ""} — if you're outbid we'll notify you. Bids are binding.`, `入札額 ${amount !== null ? `$${amount.toFixed(2)}` : ""}。落札時は支払い義務が生じます。`)}
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">{tr(locale, "Cancel", "キャンセル")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="h-11">{tr(locale, "Place bid", "入札する")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
