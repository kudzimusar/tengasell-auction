// Tengasell — formatting, currency, countdown and bidding rules.

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

export function formatUSD(n: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && n >= 1000) {
    return `US$${compactNumber(n)}`;
  }
  const s = n.toLocaleString("en-US", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `US$${s}`;
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
  if (remainingMs <= 0) return "0s";
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
  switch (condition) {
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
