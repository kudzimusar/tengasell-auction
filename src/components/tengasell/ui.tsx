"use client"
// ── Shared Tengasell UI primitives (orchestrator-owned; agents import only) ──
// Merged set: rebuild primitives (Price/SectionTitle/Empty/StatusBadge/…) +
// original NXS primitives reconstructed from usage surface + screenshots:
// TengaLogo, Avatar, PriceTag, Countdown, RatingStars, StatusPill, EmptyState,
// ErrorState, SectionHeader, LoadingGrid, AuctionCard, BidRules, useNow.
import { ReactNode, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RotateCw, Star } from "lucide-react"
import {
  bidIncrement, formatRemaining, formatUSD, minNextBid, parseImages, remainingSeverity,
} from "@/lib/tengasell/format"
import { toAuctionView, type Auction } from "@/lib/tengasell/types"
import { useLinkProps } from "@/lib/tengasell/router"

export function Price({ value, className, size = "md" }: { value: number; className?: string; size?: "sm" | "md" | "lg" }) {
  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value % 1 === 0 ? 0 : 2 })
  const cls = size === "lg" ? "text-2xl font-bold" : size === "sm" ? "text-sm font-semibold" : "text-lg font-bold"
  return <span className={cn(cls, "text-primary tabular-nums", className)}>{fmt.format(value)}</span>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <h2 className="text-base font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  )
}

export function Empty({ icon = "📭", title, hint, children }: { icon?: string; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div aria-hidden className="text-5xl mb-3">{icon}</div>
      <p className="font-semibold mb-1">{title}</p>
      {hint && <p className="text-sm text-muted-foreground max-w-sm">{hint}</p>}
      {children}
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    ACTIVE: { label: "Active", variant: "default" },
    PENDING_REVIEW: { label: "In review", variant: "outline" },
    PENDING: { label: "Pending", variant: "outline" },
    PENDING_PAYMENT: { label: "Awaiting payment", variant: "outline" },
    PAID: { label: "Paid", variant: "secondary" },
    SHIPPED: { label: "Shipped", variant: "secondary" },
    DELIVERED: { label: "Delivered", variant: "secondary" },
    COMPLETED: { label: "Completed", variant: "default" },
    CANCELLED: { label: "Cancelled", variant: "destructive" },
    REFUND_PENDING: { label: "Refund pending", variant: "outline" },
    REFUNDED: { label: "Refunded", variant: "destructive" },
    DISPUTED: { label: "Disputed", variant: "destructive" },
    SUSPENDED: { label: "Suspended", variant: "destructive" },
    BANNED: { label: "Banned", variant: "destructive" },
    REJECTED: { label: "Rejected", variant: "destructive" },
    SOLD: { label: "Sold", variant: "default" },
    ENDED: { label: "Ended", variant: "secondary" },
    DRAFT: { label: "Draft", variant: "outline" },
    OPEN: { label: "Open", variant: "outline" },
    VERIFIED: { label: "Verified", variant: "default" },
    QUEUED: { label: "Queued", variant: "outline" },
    SENT: { label: "Sent", variant: "default" },
    FAILED: { label: "Failed", variant: "destructive" },
  }
  const s = map[status] || { label: status, variant: "secondary" as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function CardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border rounded-lg overflow-hidden">
          <Skeleton className="aspect-square rounded-none" />
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function timeLeft(endsAt: string | Date | null | undefined, locale: "en" | "ja" = "en") {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  if (ms <= 0) return locale === "ja" ? "終了" : "Ended"
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const d = Math.floor(h / 24)
  if (d > 0) return locale === "ja" ? `あと${d}日` : `${d}d ${h % 24}h left`
  if (h > 0) return locale === "ja" ? `あと${h}時間${m}分` : `${h}h ${m}m left`
  return locale === "ja" ? `あと${m}分` : `${m}m left`
}

export function fmtDate(d: string | Date | null | undefined, withTime = false) {
  if (!d) return "—"
  const date = new Date(d)
  const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })
  return withTime ? `${dateFmt.format(date)} ${timeFmt.format(date)}` : dateFmt.format(date)
}

// ════════════════════════ Original NXS primitives ════════════════════════

/** Ticking "now" hook — reruns every intervalMs (default 1s). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/** Brand logo: monogram mark + "Tenga"(teal)+"Sell"(gold) wordmark, optional tagline. */
export function TengaLogo({
  size = 34, withWordmark = true, tagline = false, wordmarkClassName,
}: { size?: number; withWordmark?: boolean; tagline?: boolean | string; wordmarkClassName?: string }) {
  return (
    <span className="inline-flex flex-col items-start leading-none select-none">
      <span className="inline-flex items-center gap-2" aria-label="Tengasell">
        <span
          aria-hidden
          className="relative inline-flex shrink-0 items-center justify-center rounded-md font-extrabold text-white"
          style={{ width: size, height: size, fontSize: Math.max(13, size * 0.52) }}
        >
          <span className="absolute inset-0 rounded-md bg-gradient-to-br from-teal to-[color:var(--primary)]" />
          <span className="relative">T</span>
        </span>
        {withWordmark && (
          <span className={cn("inline-flex items-baseline", wordmarkClassName)} style={{ fontSize: Math.max(16, size * 0.82) }}>
            <span className="font-extrabold tracking-tight text-teal">Tenga</span>
            <span className="font-extrabold tracking-tight text-gold">Sell</span>
          </span>
        )}
      </span>
      {tagline !== false && (
        <span className="mt-1 text-caption text-muted-foreground">
          {typeof tagline === "string" ? tagline : "Zimbabwe's Online Auction Marketplace"}
        </span>
      )}
    </span>
  )
}

/** Deterministic initials avatar (44px-safe, teal/gold tint family). */
export function Avatar({ username, size = 34, className }: { username: string; size?: number; className?: string }) {
  const [initials, tint] = useMemo(() => {
    let h = 0
    for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0
    const tints = [
      "bg-teal/15 text-teal", "bg-gold/20 text-ochre", "bg-primary/10 text-primary",
      "bg-accent text-accent-foreground", "bg-secondary text-secondary-foreground",
    ] as const
    return [username.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "TZ", tints[h % tints.length]] as const
  }, [username])
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", tint, className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
    >
      {initials}
    </span>
  )
}

/** Yahoo-style price tag. tone teal (default) or gold (buy-now/ochre contexts). */
export function PriceTag({ amount, size = "md", tone = "teal", className }: {
  amount: number; size?: "sm" | "md" | "lg" | "xl"; tone?: "teal" | "gold"; className?: string
}) {
  const cls = { sm: "text-sm font-semibold", md: "text-lg font-bold", lg: "text-2xl font-bold", xl: "text-3xl font-extrabold" }[size]
  return (
    <span className={cn("ts-numeric", cls, tone === "gold" ? "text-gold" : "text-teal", className)}>
      {formatUSD(amount)}
    </span>
  )
}

/** Live remaining-time countdown with severity coloring. */
export function Countdown({ endsAt, ended, className }: { endsAt: string; ended?: boolean; className?: string }) {
  const now = useNow(1000)
  const remainingMs = Date.parse(endsAt) - now
  if (ended || remainingMs <= 0) {
    return <span className={cn("ts-numeric text-caption font-semibold text-danger", className)}>Ended</span>
  }
  const sev = remainingSeverity(remainingMs)
  return (
    <span className={cn("ts-numeric text-caption font-bold", sev === "urgent" ? "text-danger" : sev === "soon" ? "text-warn" : "text-muted-foreground", className)}>
      {formatRemaining(remainingMs)}
    </span>
  )
}

/** 1–5 stars with optional count. */
export function RatingStars({ value, count, showCount = true, size }: { value: number; count?: number | null; showCount?: boolean; size?: number }) {
  const rounded = Math.round(value)
  const starSize = size ?? 14
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Rating ${value.toFixed(1)} of 5`}>
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} style={{ width: starSize, height: starSize }} className={cn(i <= rounded ? "fill-gold text-gold" : "text-muted-foreground/40")} />
        ))}
      </span>
      {showCount && typeof count === "number" && (
        <span className="ts-numeric text-caption text-muted-foreground">({count})</span>
      )}
    </span>
  )
}

/** Verified-seller badge (gold check). */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-pill bg-gold/15 px-1.5 py-0.5 text-[11px] font-bold text-ochre", className)}>
      <svg viewBox="0 0 16 16" className="size-3 fill-current" aria-hidden>
        <path d="M8 0l1.7 1.2 2-.3 1 1.9 1.7 1.2-.3 2L15.4 8l-1.3 1.7.3 2-1.7 1.2-1 1.9-2-.3L8 16l-1.7-1.2-2 .3-1-1.9L1.6 12l.3-2L.6 8l1.3-1.7-.3-2 1.7-1.2 1-1.9 2 .3z" fillOpacity="0.9" />
        <path d="M11.1 5.5l-4 4-2.2-2.2-1 1 3.2 3.2 5-5z" fill="white" />
      </svg>
      Verified
    </span>
  )
}

/** Small status pill (consoles/lists). tone overrides status mapping. */
export function StatusPill({ status, size = "sm", tone, children, mode, engineConnected }: {
  status?: string; size?: "xs" | "sm"; tone?: "good" | "gold" | "danger" | "warn" | "info" | "muted"; children?: ReactNode
  mode?: "live" | "demo" | "degraded"; engineConnected?: boolean
}) {
  // Header engine-status variant: canonical live / explicit demo / degraded.
  if (mode) {
    const live = mode === "live" && !!engineConnected
    const degraded = mode === "degraded"
    const reconnecting = mode === "live" && !engineConnected
    const tone = live
      ? "border-teal/25 bg-teal/10 text-teal"
      : degraded
        ? "border-danger/30 bg-danger/10 text-danger"
        : reconnecting
          ? "border-warn/30 bg-warn/10 text-warn"
          : "border-gold/30 bg-gold/15 text-ochre"
    const dot = live ? "bg-teal" : degraded ? "bg-danger" : reconnecting ? "bg-warn" : "bg-gold"
    const label = live ? "Live engine" : degraded ? "Auction service unavailable" : reconnecting ? "Engine reconnecting" : "Demo mode"
    return (
      <span className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-bold",
        tone,
      )}>
        <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
        {label}
      </span>
    )
  }
  const map: Record<string, "good" | "gold" | "danger" | "warn" | "info" | "muted"> = {
    ACTIVE: "good", LIVE: "good", APPROVED: "good", PAID: "good", COMPLETED: "good", SENT: "good", DELIVERED: "good", SUCCESS: "good", CLEAR: "good",
    PENDING: "warn", QUEUED: "warn", OPEN: "warn", REVIEW: "warn", HOLD: "warn", PARTIAL: "warn", SCHEDULED: "warn", PENDING_REVIEW: "warn",
    REJECTED: "danger", FAILED: "danger", BANNED: "danger", SUSPENDED: "danger", DISPUTED: "danger", CANCELLED: "danger", BLOCKED: "danger",
    info: "info", INFO: "info",
  }
  const t = tone ?? map[status ?? ""] ?? "muted"
  const styles: Record<string, string> = {
    good: "bg-teal/10 text-teal border-teal/20",
    gold: "bg-gold/15 text-ochre border-gold/30",
    warn: "bg-warn/10 text-warn border-warn/25",
    danger: "bg-danger/10 text-danger border-danger/25",
    info: "bg-secondary text-secondary-foreground border-border",
    muted: "bg-muted text-muted-foreground border-border",
  }
  return (
    <span className={cn(
      "inline-flex items-center justify-center gap-1 rounded-pill border font-semibold whitespace-nowrap",
      size === "xs" ? "px-2 py-0 text-[11px]" : "px-2.5 py-0.5 text-xs",
      styles[t],
    )}>
      {children ?? status}
    </span>
  )
}

/** Centered empty-state block. */
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      {icon && <div className="mb-3 text-muted-foreground/80" aria-hidden>{icon}</div>}
      <p className="text-title text-foreground">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-caption text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Inline error state with retry (44px target). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-danger/25 bg-danger/5 px-4 py-10 text-center" role="alert">
      <AlertTriangle className="size-8 text-danger" aria-hidden />
      <p className="text-caption text-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="min-h-11">
          <RotateCw className="size-4" aria-hidden /> Retry
        </Button>
      )}
    </div>
  )
}

/** Console/page section header. */
export function SectionHeader({ icon, title, subtitle, action }: {
  icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon}
        <div className="min-w-0">
          <h2 className="text-title text-foreground truncate">{title}</h2>
          {subtitle && <p className="text-caption text-muted-foreground truncate">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  )
}

/** Skeleton card grid for lazy route fallbacks. */
export function LoadingGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-border bg-raised">
          <Skeleton className="aspect-square rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Marketplace listing card (grid). */
export function AuctionCard({ auction, showSeller = true }: { auction: Auction; showSeller?: boolean }) {
  const v = toAuctionView(auction)
  const link = useLinkProps(`#/item/${auction.id}`)
  const now = useNow(5000)
  const remainingMs = Date.parse(auction.ends_at) - now
  const sev = remainingMs <= 0 ? "ended" : remainingSeverity(remainingMs)
  const img = v.imageList[0]
  return (
    <a
      {...link}
      className="group block overflow-hidden rounded-card border border-border bg-card transition hover:border-teal/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={auction.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-teal/10 to-gold/20 text-3xl" aria-hidden>🧭</div>
        )}
        {auction.status !== "live" && (
          <span className="absolute left-2 top-2 rounded-pill bg-foreground/80 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-background">
            {auction.status === "sold" ? "Sold" : "Ended"}
          </span>
        )}
        {v.endingSoon && auction.status === "live" && (
          <span className="absolute right-2 top-2 rounded-pill bg-danger px-2 py-0.5 text-[11px] font-bold text-white">Ends soon</span>
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <p className="line-clamp-2 min-h-9 text-label text-foreground">{auction.title}</p>
        <div className="flex items-baseline justify-between gap-2">
          <PriceTag amount={auction.current_price} size="md" />
          {auction.buy_now_price != null && (
            <PriceTag amount={auction.buy_now_price} size="sm" tone="gold" className="shrink-0" />
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={cn("ts-numeric text-caption font-semibold", sev === "urgent" ? "text-danger" : sev === "soon" ? "text-warn" : "text-muted-foreground")}>
            {remainingMs <= 0 ? "Ended" : formatRemaining(remainingMs)}
          </span>
          <span className="ts-numeric text-caption text-muted-foreground">{auction.bid_count} bids</span>
        </div>
        {showSeller && (
          <div className="flex items-center gap-1.5 border-t border-border pt-2">
            <Avatar username={auction.seller_username} size={18} />
            <span className="truncate text-caption text-muted-foreground">{auction.seller_username}</span>
          </div>
        )}
      </div>
    </a>
  )
}

/** Yahoo Auctions-style bid rules box (increments + auto-bid note). */
export function BidRules({ auction }: { auction: Auction }) {
  const inc = bidIncrement(auction.current_price)
  const minNext = minNextBid(auction.current_price, auction.bid_count)
  return (
    <div className="space-y-2 rounded-card border border-border bg-raised p-4 text-caption">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Current price</span>
        <PriceTag amount={auction.current_price} size="sm" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Minimum next bid</span>
        <PriceTag amount={minNext} size="sm" tone="gold" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Bid increment</span>
        <span className="ts-numeric font-semibold text-foreground">{formatUSD(inc)}</span>
      </div>
      <p className="border-t border-border pt-2 text-muted-foreground">
        Enter your maximum — Tengasell bids automatically in {formatUSD(inc)} steps, never more than needed. Anti-sniping: bids inside the last 5 minutes extend the auction.
      </p>
    </div>
  )
}
