"use client";

// Tengasell orders module — shared payment surface for the transaction
// lifecycle: method radio cards (Paynow gateway / EcoCash / ZIPIT / Visa /
// Mastercard / PayPal / COD), method-specific mini forms with validation,
// and the buyer-protection SLA panel. Used by the buy-now checkout page
// and the pay-order dialog on the orders pages.

import {
  Banknote,
  CreditCard,
  Info,
  Landmark,
  Phone,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/tengasell/i18n";

export type PaymentMethodId =
  | "ecocash"
  | "zipit"
  | "visa"
  | "mastercard"
  | "paypal"
  | "cod"
  | "paynow";

/** Paynow sub-channel — how the money moves through the gateway. */
export type PaynowChannel = "ecocash" | "innbucks" | "card";

export interface PaymentMethodDef {
  id: PaymentMethodId;
  label: string;
  sub: string;
  icon: LucideIcon;
}

export const PAYMENT_METHODS: PaymentMethodDef[] = [
  {
    id: "paynow",
    label: "Paynow — EcoCash · InnBucks · Visa",
    sub: "Zimbabwe's secure payment gateway",
    icon: ShieldCheck,
  },
  { id: "ecocash", label: "EcoCash", sub: "You'll confirm on your phone", icon: Phone },
  { id: "zipit", label: "ZIPIT bank transfer", sub: "Instant interbank transfer", icon: Landmark },
  { id: "visa", label: "Visa", sub: "Credit or debit card", icon: CreditCard },
  { id: "mastercard", label: "Mastercard", sub: "Credit or debit card", icon: CreditCard },
  { id: "paypal", label: "PayPal", sub: "Pay from your PayPal balance", icon: Wallet },
  { id: "cod", label: "Cash on delivery", sub: "Pay the courier on arrival", icon: Banknote },
];

export const ZIMBANKS = [
  "CBZ Bank",
  "Stanbic Bank Zimbabwe",
  "FBC Bank",
  "ZB Bank",
  "Ecobank Zimbabwe",
  "CABS",
] as const;

export interface PaymentFields {
  phone: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
  bank: string;
  /** Paynow sub-channel ("" until chosen). */
  paynowChannel: PaynowChannel | "";
}

export function emptyPaymentFields(): PaymentFields {
  return {
    phone: "",
    cardNumber: "",
    expiry: "",
    cvc: "",
    bank: "",
    paynowChannel: "",
  };
}

export function isCardMethod(method: PaymentMethodId): boolean {
  return method === "visa" || method === "mastercard";
}

export function isPaynowMethod(method: PaymentMethodId): boolean {
  return method === "paynow";
}

/** Validate the method-specific mini form → human error or null when OK. */
export function validatePaymentFields(
  method: PaymentMethodId,
  f: PaymentFields,
): string | null {
  switch (method) {
    case "paynow": {
      if (!f.paynowChannel) return "Choose how to pay with Paynow — EcoCash, InnBucks or card";
      if (f.paynowChannel === "ecocash" || f.paynowChannel === "innbucks") {
        const raw = f.phone.replace(/[\s-]/g, "");
        if (!/^(?:0|\+263)7\d{8}$/.test(raw)) {
          return "Enter a valid mobile money number — e.g. 0771234567 or +263771234567";
        }
      }
      return null;
    }
    case "ecocash": {
      const raw = f.phone.replace(/[\s-]/g, "");
      if (!/^(?:\+?263|0)?7\d{8}$/.test(raw)) {
        return "Enter a valid EcoCash number — e.g. +263 77 123 4567";
      }
      return null;
    }
    case "visa":
    case "mastercard": {
      const digits = f.cardNumber.replace(/\s/g, "");
      if (!/^\d{16}$/.test(digits)) return "Enter the 16-digit card number";
      const m = /^(0?[1-9]|1[0-2])\s*\/\s*(\d{2})$/.exec(f.expiry.trim());
      if (!m) return "Expiry must be MM/YY";
      const month = Number(m[1]);
      const year = 2000 + Number(m[2]);
      if (new Date(year, month, 1).getTime() <= Date.now()) return "That card is expired";
      if (!/^\d{3,4}$/.test(f.cvc.trim())) return "CVC must be 3 digits";
      return null;
    }
    case "zipit": {
      if (!f.bank) return "Choose your bank for the ZIPIT transfer";
      return null;
    }
    default:
      return null;
  }
}

/** Optional payment reference passed to api.payOrder (phone / card last-4). */
export function paymentReference(method: PaymentMethodId, f: PaymentFields): string | undefined {
  if (method === "paynow") {
    if (f.paynowChannel === "ecocash" || f.paynowChannel === "innbucks") {
      return f.phone.replace(/[\s-]/g, "") || undefined;
    }
    return f.paynowChannel || undefined;
  }
  if (method === "ecocash") return f.phone.replace(/[\s-]/g, "");
  if (isCardMethod(method)) {
    const digits = f.cardNumber.replace(/\s/g, "");
    return digits.length >= 4 ? `**** ${digits.slice(-4)}` : undefined;
  }
  return undefined;
}

// ── Paynow session launcher (checkout + pay dialog share this) ───────

export interface PaynowStartResult {
  ok: boolean;
  reference?: string;
  redirectUrl?: string;
  mode?: "sandbox" | "live";
  orderId?: number;
  error?: string;
}

function readTrailbaseToken(): string | null {
  try {
    const raw = localStorage.getItem("ts_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/paynow/initiate { orderId, method, phone } with the signed-in
 * TrailBase token → { ok, reference, redirectUrl }. The redirect is our
 * sandbox page (#/pay/{ref}) in mock mode or Paynow's hosted checkout in
 * production.
 */
export async function startPaynowPayment(input: {
  orderId: number;
  channel: PaynowChannel | "";
  phone?: string;
}): Promise<PaynowStartResult> {
  const token = readTrailbaseToken();
  if (!token) {
    return { ok: false, error: "Sign in again to start a Paynow payment." };
  }
  if (!input.channel) {
    return { ok: false, error: "Choose how to pay with Paynow — EcoCash, InnBucks or card" };
  }
  try {
    const res = await fetch("/api/paynow/initiate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orderId: input.orderId,
        method: input.channel,
        phone: input.phone?.replace(/[\s-]/g, "") || undefined,
      }),
    });
    const data = (await res.json().catch(() => null)) as PaynowStartResult | null;
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error ?? "Could not start the Paynow payment." };
    }
    return data;
  } catch {
    return { ok: false, error: "Could not reach the payment gateway — please retry." };
  }
}

// ── method picker (radio cards, 44px targets, keyboard accessible) ───

export function PaymentMethodPicker({
  method,
  onMethodChange,
  disabled = false,
  name = "ts-payment-method",
}: {
  method: PaymentMethodId | null;
  onMethodChange: (m: PaymentMethodId) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Payment method</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
        {PAYMENT_METHODS.map((m) => {
          const selected = method === m.id;
          const Icon = m.icon;
          return (
            <label
              key={m.id}
              className={cn(
                "relative flex items-center gap-3 rounded-control border p-3 cursor-pointer",
                "transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                selected
                  ? "border-teal bg-teal-tint/70 dark:bg-teal-tint/40"
                  : "border-border bg-raised hover:border-teal-soft/60",
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={selected}
                onChange={() => onMethodChange(m.id)}
                disabled={disabled}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border-2",
                  selected ? "border-teal" : "border-border",
                )}
              >
                {selected && <span className="size-2 rounded-full bg-teal" />}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-control",
                  selected ? "bg-teal/10 text-teal-deep dark:text-teal-soft" : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-label font-semibold",
                    selected ? "text-foreground" : "text-foreground",
                  )}
                >
                  {m.label}
                </span>
                <span className="block truncate text-caption text-muted-foreground">{m.sub}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ── method-specific mini form ─────────────────────────────────────────

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 16);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function PaymentMethodFieldsForm({
  method,
  fields,
  onFieldsChange,
  disabled = false,
  idPrefix = "ts-pay",
}: {
  method: PaymentMethodId | null;
  fields: PaymentFields;
  onFieldsChange: (next: PaymentFields) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const { t } = useI18n();
  const patch = (part: Partial<PaymentFields>) => onFieldsChange({ ...fields, ...part });

  if (method === "paynow") {
    const channels: { id: PaynowChannel; label: string; sub: string; icon: LucideIcon }[] = [
      { id: "ecocash", label: t("paynow.ecocash"), sub: "Mobile money push", icon: Phone },
      { id: "innbucks", label: t("paynow.innbucks"), sub: "Mobile money push", icon: Landmark },
      { id: "card", label: t("paynow.card"), sub: t("paynow.cardSub"), icon: CreditCard },
    ];
    const mobile = fields.paynowChannel === "ecocash" || fields.paynowChannel === "innbucks";
    return (
      <div className="space-y-3">
        <p className="text-label font-semibold text-foreground">{t("paynow.channel")}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("paynow.channel")}>
          {channels.map((c) => {
            const selected = fields.paynowChannel === c.id;
            const Icon = c.icon;
            return (
              <label
                key={c.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-control border p-3 cursor-pointer",
                  "transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  selected
                    ? "border-teal bg-teal-tint/70 dark:bg-teal-tint/40"
                    : "border-border bg-raised hover:border-teal-soft/60",
                )}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-paynow-channel`}
                  className="sr-only"
                  checked={selected}
                  onChange={() => patch({ paynowChannel: c.id })}
                  disabled={disabled}
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-control",
                    selected
                      ? "bg-teal/10 text-teal-deep dark:text-teal-soft"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-label font-semibold text-foreground">{c.label}</span>
                  <span className="block truncate text-caption text-muted-foreground">{c.sub}</span>
                </span>
              </label>
            );
          })}
        </div>

        {mobile && (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-paynow-phone`}>{t("paynow.phone")}</Label>
            <Input
              id={`${idPrefix}-paynow-phone`}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+263 77 123 4567"
              value={fields.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              disabled={disabled}
              className="h-12 rounded-input"
            />
            <p className="text-caption text-muted-foreground">{t("paynow.phoneHint")}</p>
          </div>
        )}

        {fields.paynowChannel === "card" && (
          <div
            role="note"
            className="flex items-start gap-2 rounded-control bg-muted/60 p-3 text-caption text-muted-foreground"
          >
            <ShieldCheck className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
            <span>{t("paynow.cardNote")}</span>
          </div>
        )}
      </div>
    );
  }

  if (method === "ecocash") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-phone`}>EcoCash mobile number</Label>
        <Input
          id={`${idPrefix}-phone`}
          inputMode="tel"
          autoComplete="tel"
          placeholder="+263 77 123 4567"
          value={fields.phone}
          onChange={(e) => patch({ phone: e.target.value })}
          disabled={disabled}
          className="h-12 rounded-input"
        />
        <p className="text-caption text-muted-foreground">
          You&apos;ll confirm the payment prompt on your phone.
        </p>
      </div>
    );
  }

  if (method != null && isCardMethod(method)) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-label font-semibold text-foreground">Card details</p>
          <Badge className="border-gold/50 bg-gold-soft text-gold-deep" variant="outline">
            Test mode
          </Badge>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-card`}>Card number</Label>
          <Input
            id={`${idPrefix}-card`}
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            value={fields.cardNumber}
            onChange={(e) => patch({ cardNumber: formatCardNumber(e.target.value) })}
            disabled={disabled}
            className="h-12 rounded-input ts-numeric"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-expiry`}>Expiry (MM/YY)</Label>
            <Input
              id={`${idPrefix}-expiry`}
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="09/27"
              value={fields.expiry}
              onChange={(e) => patch({ expiry: formatExpiry(e.target.value) })}
              disabled={disabled}
              className="h-12 rounded-input ts-numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-cvc`}>CVC</Label>
            <Input
              id={`${idPrefix}-cvc`}
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              value={fields.cvc}
              onChange={(e) => patch({ cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              disabled={disabled}
              className="h-12 rounded-input ts-numeric"
            />
          </div>
        </div>
        <p className="text-caption text-muted-foreground">
          Demo checkout — no real card is ever charged.
        </p>
      </div>
    );
  }

  if (method === "zipit") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-bank`}>Your bank</Label>
          <Select
            value={fields.bank || undefined}
            onValueChange={(v) => patch({ bank: v })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-bank`} className="w-full min-h-12 rounded-input">
              <SelectValue placeholder="Choose bank" />
            </SelectTrigger>
            <SelectContent>
              {ZIMBANKS.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          role="note"
          className="flex items-start gap-2 rounded-control bg-muted/60 p-3 text-caption text-muted-foreground"
        >
          <Info className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
          <span>
            A ZIPIT transfer reference will be generated for you when you confirm — use it when
            approving the transfer in your banking app.
          </span>
        </div>
      </div>
    );
  }

  if (method === "cod") {
    return (
      <div
        role="note"
        className="flex items-start gap-2 rounded-control bg-muted/60 p-3 text-caption text-muted-foreground"
      >
        <Banknote className="size-4 shrink-0 text-gold-deep" aria-hidden="true" />
        <span>Pay the courier on arrival — have the exact amount ready if possible.</span>
      </div>
    );
  }

  if (method === "paypal") {
    return (
      <div
        role="note"
        className="flex items-start gap-2 rounded-control bg-muted/60 p-3 text-caption text-muted-foreground"
      >
        <Wallet className="size-4 shrink-0 text-teal-soft" aria-hidden="true" />
        <span>You&apos;ll approve this payment from your PayPal account.</span>
      </div>
    );
  }

  return null;
}

// ── buyer-protection SLA panel ───────────────────────────────────────

export function SlaPanel({ className }: { className?: string }) {
  const items = [
    "Complete payment within 48 hours",
    "Seller dispatches within 3 days",
    "Funds held until you confirm delivery",
    "7-day dispute window",
  ];
  return (
    <div
      role="note"
      className={cn(
        "rounded-control border border-teal/30 bg-teal-tint/70 dark:bg-teal-tint/40 p-3 sm:p-4",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-label font-bold text-teal-deep dark:text-teal-soft">
        <ShieldCheck className="size-4" aria-hidden="true" />
        Tengasell buyer protection
      </p>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {items.map((text) => (
          <li key={text} className="flex items-start gap-2 text-caption text-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-teal-soft" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
