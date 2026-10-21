"use client"
// ── Tengasell application shell: header, router, tab bar, sticky footer ──
import { useEffect } from "react"
import { SessionProvider, useSession } from "next-auth/react"
import { useApp, View, tr } from "@/lib/tengasell/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Home, Search, Plus, MessageSquare, User, ShoppingCart, Globe, ShieldCheck,
  Menu, X, LayoutDashboard,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

import { HomePage, CategoryPage, SearchPage, ItemPage, SellerPage, SellPage, OrdersPage, WatchlistPage } from "./pages/experience/pages"
import { MessagesPage, CommsPage, AuthPage, AccountPage } from "./pages/comms/pages"
import { AdminApp } from "./pages/admin/pages"
import { HelpPage, HelpArticlePage, PolicyPage, StatusPage, PrivacyPage, DeveloperPage } from "./pages/gov/pages"

function Router({ view }: { view: View }) {
  switch (view.name) {
    case "home": return <HomePage />
    case "category": return <CategoryPage slug={view.slug} />
    case "search": return <SearchPage q={view.q} />
    case "item": return <ItemPage id={view.id} />
    case "seller": return <SellerPage slug={view.slug} />
    case "sell": return <SellPage />
    case "orders": return <OrdersPage />
    case "watchlist": return <WatchlistPage />
    case "messages": return <MessagesPage />
    case "comms": return <CommsPage />
    case "account": return <AccountPage />
    case "auth": return <AuthPage />
    case "help": return <HelpPage />
    case "helpArticle": return <HelpArticlePage slug={view.slug} />
    case "policy": return <PolicyPage keyName={view.key} />
    case "status": return <StatusPage />
    case "privacy": return <PrivacyPage />
    case "developer": return <DeveloperPage />
    case "admin": return <AdminApp section={view.section} />
    default: return <HomePage />
  }
}

function Header() {
  const { locale, setLocale, session, setView, searchQuery, setSearchQuery } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const staff = session && ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"].includes(session.role)
  return (
    <header className="sticky top-0 z-50 bg-white/95 dark:bg-[#0e1a1d]/95 backdrop-blur border-b">
      <div className="max-w-7xl mx-auto px-3 sm:px-4">
        <div className="flex items-center gap-2 h-14">
          <button onClick={() => setView({ name: "home" })} className="flex items-center gap-1.5 shrink-0" aria-label="Tengasell home">
            <span className="w-8 h-8 rounded-lg tgs-gradient-teal flex items-center justify-center" aria-hidden>
              <ShoppingCart className="w-4 h-4 text-[#e5b93b]" />
            </span>
            <span className="font-extrabold text-lg tracking-tight">
              <span className="text-primary">Tenga</span><span className="text-[#b8860b]">Sell</span>
            </span>
          </button>
          <form
            className="flex-1 flex max-w-xl"
            role="search"
            onSubmit={(e) => { e.preventDefault(); if (searchQuery.trim()) setView({ name: "search", q: searchQuery.trim() }) }}
          >
            <label htmlFor="tgs-search" className="sr-only">Search listings</label>
            <Input
              id="tgs-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr(locale, "Search auctions…", "オークションを検索…")}
              className="rounded-r-none border-r-0 focus-visible:ring-0 h-10"
            />
            <Button type="submit" className="h-10 rounded-l-none px-3" aria-label="Search">
              <Search className="w-4 h-4" />
            </Button>
          </form>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setLocale(locale === "en" ? "ja" : "en")}
              className="h-10 px-2.5 rounded-md text-sm font-semibold text-muted-foreground hover:bg-secondary"
              aria-label="Switch language"
            >
              <Globe className="w-4 h-4 inline mr-1" />{locale === "en" ? "JA" : "EN"}
            </button>
            {session ? (
              <Button variant="secondary" size="sm" className="h-10" onClick={() => setView({ name: "account" })}>
                <User className="w-4 h-4 mr-1" />
                <span className="hidden sm:inline max-w-24 truncate">{session.name.split(" ")[0]}</span>
              </Button>
            ) : (
              <Button size="sm" className="h-10" onClick={() => setView({ name: "auth" })}>
                {tr(locale, "Sign in", "ログイン")}
              </Button>
            )}
            {staff && (
              <Button size="sm" variant="outline" className="h-10 hidden md:inline-flex" onClick={() => setView({ name: "admin", section: "overview" })}>
                <LayoutDashboard className="w-4 h-4 mr-1" />Admin
              </Button>
            )}
            <button className="h-10 w-10 md:hidden rounded-md hover:bg-secondary" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menu" aria-expanded={menuOpen}>
              {menuOpen ? <X className="w-5 h-5 mx-auto" /> : <Menu className="w-5 h-5 mx-auto" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="md:hidden py-2 border-t flex flex-col gap-1" aria-label="Quick links">
            {staff && (
              <button className="text-left px-2 py-2.5 rounded-md hover:bg-secondary font-medium" onClick={() => { setView({ name: "admin", section: "overview" }); setMenuOpen(false) }}>
                <LayoutDashboard className="w-4 h-4 inline mr-2" />Admin console
              </button>
            )}
            <button className="text-left px-2 py-2.5 rounded-md hover:bg-secondary font-medium" onClick={() => { setView({ name: "help" }); setMenuOpen(false) }}>
              {tr(locale, "Help centre", "ヘルプ")}
            </button>
            <button className="text-left px-2 py-2.5 rounded-md hover:bg-secondary font-medium" onClick={() => { setView({ name: "status" }); setMenuOpen(false) }}>
              {tr(locale, "System status", "システム状態")}
            </button>
            <button className="text-left px-2 py-2.5 rounded-md hover:bg-secondary font-medium" onClick={() => { setView({ name: "developer" }); setMenuOpen(false) }}>
              {tr(locale, "Developers", "開発者")}
            </button>
          </nav>
        )}
      </div>
    </header>
  )
}

const TABS: { name: View["name"]; en: string; ja: string; icon: React.ElementType }[] = [
  { name: "home", en: "Home", ja: "ホーム", icon: Home },
  { name: "watchlist", en: "Watching", ja: "ウォッチ", icon: ShoppingCart },
  { name: "sell", en: "Sell", ja: "出品", icon: Plus },
  { name: "messages", en: "Messages", ja: "メッセージ", icon: MessageSquare },
  { name: "account", en: "Account", ja: "アカウント", icon: User },
]

function TabBar() {
  const { locale, view, setView, session, unreadCount } = useApp()
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 inset-x-0 z-50 lg:hidden bg-white dark:bg-[#142326] border-t"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5 h-16" role="tablist">
        {TABS.map((t) => {
          const active = view.name === t.name
          const Icon = t.icon
          return (
            <button
              key={t.name}
              role="tab"
              aria-selected={active}
              onClick={() => setView({ name: t.name } as View)}
              className={cn("flex flex-col items-center justify-center gap-0.5 relative min-h-11", active ? "text-primary" : "text-muted-foreground")}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tr(locale, t.en, t.ja)}</span>
              {t.name === "messages" && unreadCount > 0 && (
                <span className="absolute top-2 right-1/4 bg-destructive text-white text-[10px] rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
              {t.name === "account" && !session && <span className="absolute top-2 right-1/4 w-2 h-2 rounded-full bg-[#e5b93b]" aria-label="Sign in required" />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function Footer() {
  const { locale, setView } = useApp()
  const link = (labelEn: string, labelJa: string, v: View) => (
    <button className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline text-left" onClick={() => setView(v)}>
      {tr(locale, labelEn, labelJa)}
    </button>
  )
  return (
    <footer className="mt-auto border-t bg-secondary/40">
      <div className="max-w-7xl mx-auto px-4 py-8 pb-24 lg:pb-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
          <div className="flex flex-col gap-2">
            {link("Terms of Service", "利用規約", { name: "policy", key: "terms" })}
            {link("Privacy Policy", "プライバシー", { name: "policy", key: "privacy" })}
            {link("Acceptable Use", "利用ルール", { name: "policy", key: "aup" })}
          </div>
          <div className="flex flex-col gap-2">
            {link("Refund Policy", "返金ポリシー", { name: "policy", key: "refunds" })}
            {link("Seller Terms", "出品者規約", { name: "policy", key: "seller" })}
            {link("Prohibited Goods", "禁止商品", { name: "policy", key: "prohibited" })}
          </div>
          <div className="flex flex-col gap-2">
            {link("Help centre", "ヘルプ", { name: "help" })}
            {link("System status", "システム状態", { name: "status" })}
            {link("Accessibility", "アクセシビリティ", { name: "policy", key: "accessibility" })}
          </div>
          <div className="flex flex-col gap-2">
            {link("Developer platform", "開発者向け", { name: "developer" })}
            {link("Trust & compliance", "コンプライアンス", { name: "policy", key: "compliance-overview" })}
            {link("API terms", "API利用規約", { name: "policy", key: "api-terms" })}
          </div>
        </div>
        <div className="mt-6 pt-4 border-t flex flex-col sm:flex-row items-center gap-2 justify-between">
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Tengasell (Pvt) Ltd · Harare, Zimbabwe · <ShieldCheck className="w-3 h-3 inline" /> Built to 11-11 Tech MSCS 1.0</p>
          <Badge variant="outline" className="text-[10px]">USD · ZW · EN/JA</Badge>
        </div>
      </div>
    </footer>
  )
}

function Inner() {
  const { view, refreshSession, sessionLoaded, refreshSession: refresh } = useApp()
  const { data: session } = useSession()
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (session?.user) {
      useApp.getState().setSession({
        id: (session.user as any).id,
        email: session.user.email || "",
        name: session.user.name || "",
        role: (session.user as any).role || "BUYER",
        handle: (session.user as any).handle || "",
      })
    } else if (sessionLoaded) {
      useApp.getState().setSession(null)
    }
  }, [session, sessionLoaded])
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-4 py-4 pb-20 lg:pb-4" id="main">
        <Router view={view} />
      </main>
      <Footer />
      <TabBar />
    </div>
  )
}

export default function TengasellApp() {
  return (
    <SessionProvider>
      <Inner />
    </SessionProvider>
  )
}
