"use client"
// ── Comms/Account track shared helpers (Agent B) ──────────────────
import { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Toaster } from "@/components/ui/sonner"
import { Badge } from "@/components/ui/badge"

// Sonner toaster mounted per-view (layout mounts the radix toaster instead).
export function FeedbackToaster() {
  return <Toaster position="top-center" closeButton />
}

// Demo accounts for the sandbox (all passwords: Tengasell#2025)
export const DEMO_PASSWORD = "Tengasell#2025"
export const DEMO_ACCOUNTS: { email: string; label: string; kind: "staff" | "seller" | "buyer" }[] = [
  { email: "admin@tengasell.co.zw", label: "Admin", kind: "staff" },
  { email: "compliance@tengasell.co.zw", label: "Compliance", kind: "staff" },
  { email: "support@tengasell.co.zw", label: "Support", kind: "staff" },
  { email: "moderation@tengasell.co.zw", label: "Moderator", kind: "staff" },
  { email: "simba@tengasell.co.zw", label: "Simba — electronics seller", kind: "seller" },
  { email: "rufaro@tengasell.co.zw", label: "Rufaro — cameras & music", kind: "seller" },
  { email: "chipo@tengasell.co.zw", label: "Chipo — handmade crafts", kind: "seller" },
  { email: "tariro@example.com", label: "Tariro — buyer", kind: "buyer" },
  { email: "nyasha@example.com", label: "Nyasha — buyer (dispute)", kind: "buyer" },
]

// Avatar emoji presets for the profile editor
export const AVATAR_PRESETS = [
  "🙂", "🛒", "🦁", "🌺", "🎨", "🧑‍💻", "🎧", "🚨", "⚖️", "🛡️",
  "🦅", "🌟", "🎵", "📷", "🛠️", "📚", "⚽", "☕", "🦓", "🇿🇼",
]

export function passwordStrength(pw: string): { label: string; labelJa: string; pct: number; cls: string } {
  if (!pw) return { label: "", labelJa: "", pct: 0, cls: "" }
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 2) return { label: "Weak", labelJa: "弱い", pct: 33, cls: "bg-destructive" }
  if (score <= 3) return { label: "Okay", labelJa: "普通", pct: 66, cls: "bg-[#e5b93b]" }
  return { label: "Strong", labelJa: "強い", pct: 100, cls: "bg-primary" }
}

// Section wrapper used by comms/account pages
export function SectionCard({
  title, subtitle, icon, action, children, className,
}: {
  title: string; subtitle?: string; icon?: ReactNode; action?: ReactNode
  children: ReactNode; className?: string
}) {
  return (
    <Card className={cn("shadow-sm", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="text-primary shrink-0" aria-hidden>{icon}</span>}
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight">{title}</CardTitle>
              {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// Sandbox evidence badge (MSG-009)
export function SandboxBadge() {
  return <Badge variant="outline" className="border-[#b8860b] text-[#b8860b] gap-1 text-[10px]">🧪 Sandbox</Badge>
}

// Shared client types for my API payloads
export type ThreadListItem = {
  id: string; subject: string; status: string; lastMessageAt: string
  youAre: "BUYER" | "SELLER" | "STAFF"
  listing: { id: string; title: string; image: string | null } | null
  buyer: { id: string; name: string; handle: string; avatarEmoji: string; shopName?: string | null }
  seller: { id: string; name: string; handle: string; avatarEmoji: string; shopName?: string | null }
  preview: string; previewRedacted: boolean
}

export type ThreadMessage = {
  id: string; senderRole: string
  sender: { id: string; name: string; avatarEmoji: string; handle: string } | null
  body: string; redacted: boolean; moderationNote?: string | null; createdAt: string
}

export type ThreadDetail = {
  thread: {
    id: string; subject: string; status: string; lastMessageAt: string; createdAt: string
    listingId: string | null; youAre: "BUYER" | "SELLER" | "STAFF"
    listing: { id: string; title: string; image: string | null } | null
    buyer: { id: string; name: string; handle: string; avatarEmoji: string } | null
    seller: { id: string; name: string; handle: string; avatarEmoji: string; shopName: string | null } | null
  }
  messages: ThreadMessage[]
  unreadAfter: number
}

export type PrefsMatrix = Record<string, Record<string, boolean>>

export type ConsentItem = {
  id: string; purpose: string; granted: boolean
  grantedAt: string | null; withdrawnAt: string | null; source: string | null
}

export type DsarItem = {
  id: string; type: string; details: string | null; status: string
  dueAt: string; createdAt: string; completedAt: string | null; identityVerified: boolean
}

export type AccountData = {
  profile: {
    id: string; email: string; handle: string; name: string; phone: string | null
    locale: string; role: string; status: string; avatarEmoji: string; bio: string | null
    city: string | null; country: string; isSeller: boolean; mfaEnabled: boolean
    emailVerifiedAt: string | null; lastLoginAt: string | null; createdAt: string
  }
  sellerProfile: {
    shopName: string; slug: string; status: string; bio: string | null
    identityVerified: boolean; payoutVerified: boolean; ratingAvg: number
    ratingCount: number; healthScore: number
    payoutMethod: { type?: string; bankName?: string; acctMask?: string } | null
    joinedAt: string
  } | null
  activeSessions: number
  consents: ConsentItem[]
}

export type OutboxItem = {
  id: string; status: string; kind: string; subject: string; toEmail: string
  templateKey: string | null; campaignId: string | null
  sentAt: string | null; openedAt: string | null; clickedAt: string | null
  unsubToken: string | null; createdAt: string
}
