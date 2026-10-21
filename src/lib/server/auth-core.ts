// ── Tengasell server-side auth & security core ─────────────────
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto"
import { getServerSession, Session } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":")
    const h = scryptSync(password, salt, 64)
    return timingSafeEqual(h, Buffer.from(hash, "hex"))
  } catch {
    return false
  }
}

export function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex")
}

export type Role = "BUYER" | "SELLER" | "SUPPORT" | "MODERATOR" | "FINANCE" | "COMPLIANCE" | "ADMIN"

export interface TSession extends Session {
  user?: { id?: string; email?: string | null; name?: string | null; role?: string; handle?: string; stepUp?: boolean }
}

export async function getSession(): Promise<TSession | null> {
  const s = (await getServerSession(authOptions)) as TSession | null
  return s
}

export async function requireUser(roles?: Role[]) {
  const s = await getSession()
  if (!s?.user?.id) return { error: 401 as const, session: null, user: null }
  const user = await db.user.findUnique({ where: { id: s.user.id } })
  if (!user || user.status === "DELETED") return { error: 401 as const, session: s, user: null }
  if (user.status === "SUSPENDED" || user.status === "BANNED") return { error: 403 as const, session: s, user }
  if (roles && !roles.includes(user.role as Role)) return { error: 403 as const, session: s, user }
  return { error: null, session: s, user }
}

export const STAFF_ROLES: Role[] = ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"]

export function isAdminRole(role: string) {
  return ["ADMIN", "COMPLIANCE"].includes(role)
}

// In-memory rate limiter (per key). Suitable for the single-node deployment.
const buckets = new Map<string, { count: number; resetAt: number }>()
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  b.count++
  return b.count <= limit
}

// Simple PII scrubbing for user-to-user messages (keep it on Tengasell)
const PII_PATTERNS: [RegExp, string][] = [
  [/(?:\+?263|0)\s?7\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}/g, "[contact removed — keep it on Tengasell]"],
  [/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[contact removed — keep it on Tengasell]"],
  [/\b(whats\s?app|telegram|call me|phone me|off\s?platform|outside)\b/gi, "[contact removed — keep it on Tengasell]"],
]

export function scrubPII(text: string): { clean: string; redacted: boolean } {
  let redacted = false
  let clean = text
  for (const [pat, rep] of PII_PATTERNS) {
    if (pat.test(clean)) { redacted = true; clean = clean.replace(pat, rep) }
  }
  return { clean, redacted }
}
