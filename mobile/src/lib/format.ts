// Tengasell — formatting, currency, countdown and bidding rules.

import type { NxsTranslator } from "../nxs/localization/catalog";

/** Yahoo Auctions-style tiered bid increments (USD). */
export function bidIncrement(price: number): number {
  if (price < 50) return 1;
  if (price < 500) return 2;
  if (price < 1000) return 5;
  if (price < 5000) return 10;
  return 25;
}

export function minNextBid(currentPrice: number, bidCount: number): number {
  if (bidCount === 0) return currentPrice;
  return round2(currentPrice + bidIncrement(currentPrice));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatUSD(
  n: number,
  opts?: { compact?: boolean; t?: NxsTranslator },
): string {
  const numeric =
    opts?.compact && n >= 1000
      ? compactNumber(n)
      : n.toLocaleString("en-US", {
          minimumFractionDigits: n % 1 === 0 ? 0 : 2,
          maximumFractionDigits: 2,
        });
  return opts?.t ? opts.t("currency.usdAmount", { amount: numeric }) : `US$${numeric}`;
}

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `${n}`;
}

export function formatJPYLikeCompact(n: number): string {
  return compactNumber(n);
}

/** Remaining-time string, Yahoo style: "3d 2h", "1h 12m", "12m 30s", "5s". */
export function formatRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "0s";
  const s = Math.floor(remainingMs / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function remainingSeverity(remainingMs: number): "urgent" | "soon" | "normal" {
  if (remainingMs <= 600_000) return "urgent"; // < 10 min
  if (remainingMs <= 3600_000) return "soon"; // < 1h
  return "normal";
}

export function formatDateTime(iso: string, opts?: { withTime?: boolean }): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(opts?.withTime === false
      ? {}
      : { hour: "2-digit", minute: "2-digit" }),
  });
}

export function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const mins = Math.floor(Math.abs(diff) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateTime(iso, { withTime: false });
}

export function conditionLabel(condition: string): string {
  switch (condition.trim().toLowerCase().replace(/_/g, "-")) {
    case "new":
      return "Brand new";
    case "like-new":
      return "Like new";
    case "used":
      return "Used — good";
    case "fair":
      return "Used — fair";
    case "refurbished":
      return "Refurbished";
    case "for-parts":
      return "For parts / not working";
    default:
      return condition;
  }
}

export function localizedConditionLabel(t: NxsTranslator, condition: string): string {
  switch (condition.trim().toLowerCase().replace(/_/g, "-")) {
    case "new":
      return t("condition.new");
    case "like-new":
      return t("condition.likeNew");
    case "mint":
      return t("condition.mint");
    case "used":
      return t("condition.used");
    case "good":
      return t("condition.good");
    case "fair":
      return t("condition.fair");
    case "refurbished":
      return t("condition.refurbished");
    case "for-parts":
      return t("condition.forParts");
    default:
      return t("condition.unknown", { value: condition || "—" });
  }
}

export function localizedShippingLabel(
  t: NxsTranslator,
  shipping: string,
  fee?: number,
): string {
  const norm = shipping.trim().toLowerCase();
  if (norm === "pickup") {
    return typeof fee === "number" && fee > 0
      ? t("shipping.pickupPaid", { fee: formatUSD(fee, { t }) })
      : t("shipping.pickup");
  }
  if (norm === "courier") {
    return typeof fee === "number" && fee === 0
      ? t("shipping.courierFree")
      : t("shipping.courierPaid", { fee: formatUSD(fee ?? 0, { t }) });
  }
  if (norm === "national") {
    return typeof fee === "number" && fee === 0
      ? t("shipping.nationalFree")
      : t("shipping.nationalPaid", { fee: formatUSD(fee ?? 0, { t }) });
  }
  if (norm === "both") return t("shipping.both");
  return t("shipping.custom", { value: shipping || "—" });
}

export function localizedCategoryLabel(
  t: NxsTranslator,
  category: string,
  fallbackName?: string,
): string {
  switch (category.trim().toLowerCase().replace(/_/g, "-")) {
    case "electronics":
      return t("category.electronics");
    case "phones":
    case "phones & tablets":
      return t("category.phones");
    case "computers":
      return t("category.computers");
    case "solar":
    case "solar-power":
    case "solar & power":
      return t("category.solar");
    case "vehicles":
    case "vehicles & parts":
      return t("category.vehicles");
    case "home":
    case "home & garden":
    case "home & appliances":
      return t("category.home");
    case "fashion":
    case "fashion & beauty":
      return t("category.fashion");
    case "sports":
    case "sports & hobbies":
      return t("category.sports");
    case "tools":
      return t("category.tools");
    case "collectibles":
    case "art & collectibles":
      return t("category.collectibles");
    case "farm-industrial":
    case "farm & industrial":
      return t("category.farmIndustrial");
    case "books-media":
    case "books & media":
      return t("category.booksMedia");
    case "other":
      return t("category.other");
    default:
      return t("category.custom", { value: fallbackName || category || "—" });
  }
}

export type ListingAvailability = "live" | "sold" | "ended" | "not_live";

export interface ListingState {
  availability: ListingAvailability;
  biddable: boolean;
  endedOrSold: boolean;
  remainingMs: number;
}

/** Fail closed unless the listing is live, within its active window, and uncancelled. */
export function deriveListingState(
  listing: { status: string; ends_at: string; started_at?: string | null },
  now: number,
): ListingState {
  const endsMs = Date.parse(listing.ends_at);
  const remainingMs = Number.isFinite(endsMs) ? endsMs - now : 0;
  const startsMs = listing.started_at ? Date.parse(listing.started_at) : Number.NaN;
  const notStarted = Number.isFinite(startsMs) && startsMs > now;

  if (listing.status === "sold") {
    return { availability: "sold", biddable: false, endedOrSold: true, remainingMs };
  }
  if (listing.status === "ended" || listing.status === "cancelled") {
    return { availability: "ended", biddable: false, endedOrSold: true, remainingMs };
  }
  if (listing.status !== "live") {
    return { availability: "not_live", biddable: false, endedOrSold: false, remainingMs };
  }
  if (!Number.isFinite(endsMs) || remainingMs <= 0) {
    return { availability: "ended", biddable: false, endedOrSold: true, remainingMs };
  }
  if (notStarted) {
    return { availability: "not_live", biddable: false, endedOrSold: false, remainingMs };
  }
  return { availability: "live", biddable: true, endedOrSold: false, remainingMs };
}

export function shippingLabel(shipping: string, fee: number): string {
  switch (shipping) {
    case "pickup":
      return fee > 0 ? `Pickup + delivery — ${formatUSD(fee)}` : "Local pickup only";
    case "courier":
      return fee === 0 ? "Free courier nationwide" : `Courier — ${formatUSD(fee)}`;
    case "national":
      return fee === 0 ? "Free nationwide shipping" : `Nationwide — ${formatUSD(fee)}`;
    default:
      return `Shipping ${formatUSD(fee)}`;
  }
}

export function orderStatusLabel(status: string): string {
  switch (status) {
    case "pending_payment":
      return "Awaiting payment";
    case "paid":
      return "Paid — awaiting dispatch";
    case "shipped":
      return "Shipped";
    case "delivered":
      return "Delivered";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "disputed":
      return "Under dispute";
    default:
      return status;
  }
}

export function paymentMethodLabel(method: string): string {
  switch (method) {
    case "ecocash":
      return "EcoCash";
    case "visa":
      return "Visa card";
    case "mastercard":
      return "Mastercard";
    case "paypal":
      return "PayPal";
    case "zipit":
      return "ZIPIT bank transfer";
    case "cod":
      return "Cash on delivery";
    default:
      return method;
  }
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

/** SLA deadlines (see #/help) */
export const SLA = {
  payWithinHours: 48,
  shipWithinDays: 3,
  disputeWindowDays: 7,
  refundDays: 5,
} as const;

export function parseImages(json: string): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
