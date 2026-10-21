"use client"
// ── Mock checkout dialog: payment method + shipping address + fee summary (incl VAT note) ──
// Used for (1) Buy-Now on the item page (POST /buy → PATCH pay, one UX step) and (2) paying an existing PENDING_PAYMENT order.
import { useState } from "react"
import { CreditCard, Lock, Smartphone, Wallet } from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Price } from "../../ui"
import { useApp, tr } from "@/lib/tengasell/store"

export type ShippingInfo = { name: string; phone: string; city: string; street: string; notes?: string }

const METHODS = [
  { key: "MOCK_CARD", en: "Card", ja: "カード", icon: CreditCard },
  { key: "MOCK_WALLET", en: "Wallet", ja: "ウォレット", icon: Wallet },
  { key: "MOCK_ECOCASH", en: "EcoCash", ja: "EcoCash", icon: Smartphone },
] as const

export function CheckoutDialog({
  open, onOpenChange, itemTitle, amount, submitLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  itemTitle: string
  amount: number
  submitLabel?: string
  onConfirm: (info: { method: string; shippingAddress: ShippingInfo }) => Promise<string | null> // returns error message or null on success
}) {
  const { locale } = useApp()
  const [method, setMethod] = useState<string>("MOCK_CARD")
  const [addr, setAddr] = useState<ShippingInfo>({ name: "", phone: "", city: "", street: "" })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const vatIncluded = Math.round(((amount * 15) / 100) * 100) / 100
  const valid = addr.name.trim().length >= 2 && addr.phone.trim().length >= 5 && addr.city.trim().length >= 2 && addr.street.trim().length >= 2

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    setErr(null)
    const error = await onConfirm({ method, shippingAddress: addr })
    setBusy(false)
    if (error) {
      setErr(error)
    } else {
      onOpenChange(false)
      setAddr({ name: "", phone: "", city: "", street: "" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto tgs-scroll">
        <DialogHeader>
          <DialogTitle>{tr(locale, "Checkout", "お支払い")}</DialogTitle>
          <DialogDescription className="line-clamp-1">{itemTitle}</DialogDescription>
        </DialogHeader>

        <fieldset>
          <legend className="text-sm font-semibold mb-2">{tr(locale, "Payment method (mock)", "支払い方法（モック）")}</legend>
          <RadioGroup value={method} onValueChange={setMethod} className="grid grid-cols-3 gap-2">
            {METHODS.map(m => {
              const Icon = m.icon
              return (
                <Label
                  key={m.key}
                  htmlFor={`pm-${m.key}`}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-3 cursor-pointer transition-colors h-auto ${method === m.key ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
                >
                  <RadioGroupItem id={`pm-${m.key}`} value={m.key} className="sr-only" />
                  <Icon className="w-5 h-5 text-primary" aria-hidden />
                  <span className="text-xs font-semibold">{tr(locale, m.en, m.ja)}</span>
                </Label>
              )
            })}
          </RadioGroup>
        </fieldset>

        <fieldset className="space-y-2.5">
          <legend className="text-sm font-semibold mb-1">{tr(locale, "Shipping address", "配送先")}</legend>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="co-name">{tr(locale, "Full name", "氏名")}</Label>
              <Input id="co-name" autoComplete="name" value={addr.name} onChange={e => setAddr({ ...addr, name: e.target.value })} className="mt-1" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="co-phone">{tr(locale, "Phone", "電話番号")}</Label>
              <Input id="co-phone" inputMode="tel" autoComplete="tel" placeholder="+263 77 …" value={addr.phone} onChange={e => setAddr({ ...addr, phone: e.target.value })} className="mt-1" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="co-city">{tr(locale, "City", "都市")}</Label>
              <Input id="co-city" autoComplete="address-level2" value={addr.city} onChange={e => setAddr({ ...addr, city: e.target.value })} className="mt-1" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="co-street">{tr(locale, "Street address", "番地・通り")}</Label>
              <Input id="co-street" autoComplete="street-address" value={addr.street} onChange={e => setAddr({ ...addr, street: e.target.value })} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="co-notes">{tr(locale, "Delivery notes (optional)", "配達メモ（任意）")}</Label>
            <Textarea id="co-notes" rows={2} value={addr.notes || ""} onChange={e => setAddr({ ...addr, notes: e.target.value })} className="mt-1" />
          </div>
        </fieldset>

        <div className="rounded-lg border bg-secondary/50 p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{tr(locale, "Item price", "商品価格")}</span><Price value={amount} size="sm" /></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{tr(locale, "Buyer fee", "バイヤー手数料")}</span><span className="font-semibold">$0.00</span></div>
          <div className="flex justify-between border-t pt-1"><span className="font-bold">{tr(locale, "Total", "合計")}</span><Price value={amount} /></div>
          <p className="text-[11px] text-muted-foreground pt-1">
            {tr(locale, `VAT (15%) is remitted by the seller from proceeds — no extra charge to you. Buyer protection included.`, `VAT（15%）は出品者負担のため追加請求なし。バイヤー保護付き。`)}
          </p>
        </div>

        {err && (
          <p role="alert" className="text-sm text-destructive font-medium rounded-md bg-destructive/10 px-3 py-2">
            {err}
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={submit} disabled={!valid || busy} className="w-full h-11">
            <Lock className="w-4 h-4 mr-1.5" aria-hidden />
            {busy ? tr(locale, "Processing…", "処理中…") : submitLabel || tr(locale, "Pay now", "支払う")}
          </Button>
          {!valid && (
            <p className="text-[11px] text-muted-foreground text-center">{tr(locale, "Fill in the shipping address to continue.", "配送先を入力すると支払えます。")}</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
