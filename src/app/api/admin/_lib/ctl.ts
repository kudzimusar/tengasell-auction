// ── Admin control-plane shared helpers (Agent C) ──────────────────
// Private folder (_lib): not routable. Shared by /api/admin/** routes.
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser, Role } from "@/lib/server/auth-core"
import { fail, json } from "@/lib/server/api"

// Role bundles (CTL-001/002/005/006/011)
export const STAFF_PLUS: Role[] = ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"]
export const MOD_PLUS: Role[] = ["MODERATOR", "COMPLIANCE", "ADMIN"]
export const FINANCE_ROLES: Role[] = ["FINANCE", "ADMIN"]
export const ORDER_ROLES: Role[] = ["SUPPORT", "FINANCE", "ADMIN"]
export const DISPUTE_ROLES: Role[] = ["SUPPORT", "MODERATOR", "ADMIN"]
export const CMS_ROLES: Role[] = ["COMPLIANCE", "ADMIN"]
export const OPS_ROLES: Role[] = ["ADMIN", "COMPLIANCE"]
export const AUDIT_ROLES: Role[] = ["ADMIN", "COMPLIANCE"]
export const PRIVACY_ROLES: Role[] = ["COMPLIANCE", "ADMIN"]
export const ADMIN_ONLY: Role[] = ["ADMIN"]

export type Guard = { user: Awaited<ReturnType<typeof requireUser>>["user"]; res: null } | { user: null; res: NextResponse }

// Auth gate for every admin route: 401 when signed out, 403 when role-insufficient.
export async function guard(roles: Role[] | undefined, requestId: string): Promise<Guard> {
  const { user, error } = await requireUser(roles)
  if (error === 401) return { user: null, res: fail("Staff sign-in required", 401, requestId) }
  if (error === 403) return { user: null, res: fail("Insufficient permissions for this console area", 403, requestId) }
  if (!user) return { user: null, res: fail("Account unavailable", 403, requestId) }
  return { user, res: null }
}

// ── Money ────────────────────────────────────────────────────────
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ── Notifications (in-app) — non-fatal ──────────────────────────
export async function notify(userId: string, type: string, params: Record<string, unknown>) {
  try {
    await db.notification.create({ data: { userId, type, params: JSON.stringify(params) } })
  } catch { /* non-fatal */ }
}

// ── Manual joins (schema has no relations) ──────────────────────
export async function userMap(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map<string, { id: string; name: string; email: string; role: string }>()
  const rows = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true, role: true } })
  return new Map(rows.map((r) => [r.id, r]))
}

// Seller payable balance = Σ CREDIT − Σ DEBIT on SELLER_PAYABLE entries whose refs.sellerId matches.
export async function sellerPayableBalance(sellerId: string): Promise<number> {
  const entries = await db.ledgerEntry.findMany({ where: { account: "SELLER_PAYABLE" } })
  let bal = 0
  for (const e of entries) {
    const refs = json(e.refs, {} as Record<string, string>)
    if (refs.sellerId !== sellerId) continue
    bal += e.direction === "CREDIT" ? e.amount : -e.amount
  }
  return round2(bal)
}

// Direction-aware account balances for the ledger console.
export async function accountBalances(): Promise<Record<string, number>> {
  const entries = await db.ledgerEntry.findMany({ select: { account: true, direction: true, amount: true } })
  const balances: Record<string, number> = {}
  for (const e of entries) {
    balances[e.account] = round2((balances[e.account] || 0) + (e.direction === "DEBIT" ? e.amount : -e.amount))
  }
  return balances
}

// ── Sequential refs ─────────────────────────────────────────────
export async function nextIncidentRef(): Promise<string> {
  const count = await db.incident.count()
  return `INC-${String(count + 1).padStart(3, "0")}`
}

// ── Listing version snapshot helper ─────────────────────────────
export function listingSnapshot(l: {
  title: string; titleJa: string | null; description: string; condition: string; type: string
  startingPrice: number; buyNowPrice: number | null; currentPrice: number; stock: number; images: string
  status: string; rejectReason: string | null
}) {
  return JSON.stringify({
    title: l.title, titleJa: l.titleJa, description: l.description, condition: l.condition,
    type: l.type, startingPrice: l.startingPrice, buyNowPrice: l.buyNowPrice, currentPrice: l.currentPrice,
    stock: l.stock, images: json(l.images, [] as string[]), status: l.status, rejectReason: l.rejectReason,
  })
}

// Approval payload diff preview for the console queue
export function payloadPreview(payloadStr: string): string {
  const obj = json(payloadStr, {} as Record<string, unknown>)
  return Object.entries(obj).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ").slice(0, 220)
}
