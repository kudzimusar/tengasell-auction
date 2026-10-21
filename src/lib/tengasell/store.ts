"use client"
// ── Tengasell client store: view router, session, locale, toasts ──
import { create } from "zustand"

export type View =
  | { name: "home" }
  | { name: "category"; slug: string }
  | { name: "search"; q: string }
  | { name: "item"; id: string }
  | { name: "seller"; slug: string }
  | { name: "sell" }
  | { name: "orders" }
  | { name: "watchlist" }
  | { name: "messages" }
  | { name: "account" }
  | { name: "comms" }
  | { name: "help" }
  | { name: "helpArticle"; slug: string }
  | { name: "policy"; key: string }
  | { name: "status" }
  | { name: "privacy" }
  | { name: "developer" }
  | { name: "admin"; section: string }
  | { name: "auth" }

export type SessionUser = { id: string; email: string; name: string; role: string; handle: string; stepUp?: boolean } | null

interface AppState {
  view: View
  session: SessionUser
  sessionLoaded: boolean
  locale: "en" | "ja"
  unreadCount: number
  setView: (v: View) => void
  setSession: (u: SessionUser) => void
  refreshSession: () => Promise<void>
  setLocale: (l: "en" | "ja") => void
  setUnread: (n: number) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
}

export const useApp = create<AppState>((set, get) => ({
  view: { name: "home" },
  session: null,
  sessionLoaded: false,
  locale: "en",
  unreadCount: 0,
  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
  setView: (v) => {
    set({ view: v })
    if (typeof window !== "undefined") window.scrollTo({ top: 0 })
  },
  setSession: (u) => set({ session: u, sessionLoaded: true }),
  refreshSession: async () => {
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store" })
      const j = await r.json()
      const u = j?.user?.id ? { ...j.user } : null
      if (u && typeof window !== "undefined") {
        try { window.localStorage.setItem("tgs_locale", u.locale || "en") } catch {}
      }
      set({ session: u, sessionLoaded: true, locale: (u?.locale === "ja" ? "ja" : (typeof window !== "undefined" ? (window.localStorage.getItem("tgs_locale") as "en" | "ja") || "en" : "en")) })
      if (u) {
        fetch("/api/notifications?unread=1").then(r => r.json()).then(j => set({ unreadCount: j?.count ?? 0 })).catch(() => undefined)
      }
    } catch {
      set({ sessionLoaded: true })
    }
  },
  setLocale: (l) => {
    set({ locale: l })
    if (typeof window !== "undefined") {
      window.localStorage.setItem("tgs_locale", l)
      document.documentElement.lang = l
    }
  },
  setUnread: (n) => set({ unreadCount: n }),
}))

// Inline bilingual translation helper — each component owns its strings.
export function tr(locale: "en" | "ja", en: string, ja: string): string {
  return locale === "ja" ? ja : en
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: { message: string; code: number }; requestId?: string }> {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  })
  try {
    return (await r.json()) as any
  } catch {
    return { ok: r.ok, error: { message: `HTTP ${r.status}`, code: r.status } }
  }
}
