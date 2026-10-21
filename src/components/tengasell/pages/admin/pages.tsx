"use client"
/* eslint-disable react-hooks/static-components -- in-module sidebar/section map pattern */
// ── ADMIN CONTROL PLANE (Agent C) — internal operations console ──
// Contract: export AdminApp receiving { section: string }.
// Owns the sidebar/topbar shell and renders the matching section.
import { useState, type ComponentType } from "react"
import { Menu, X, LayoutDashboard, ArrowLeft, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp, tr } from "@/lib/tengasell/store"
import { Empty } from "../../ui"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import {
  LayoutGrid, Users, Store, Package, ShoppingCart, RotateCcw, Scale, Flag, LifeBuoy,
  Landmark, CreditCard, RefreshCw, FileText, Calendar, Newspaper, Settings,
  AlertTriangle, DatabaseBackup, Webhook, ScrollText, Terminal, LineChart, Layers,
} from "lucide-react"

import { MscsAdminSection } from "../gov/pages"
import { OverviewSection } from "./sections/overview"
import { UsersSection, SellersSection } from "./sections/users"
import { ListingsSection, OrdersSection } from "./sections/marketplace"
import { ReportsSection, DisputesSection, TicketsSection } from "./sections/trust"
import { RefundsSection, LedgerSection, PayoutsSection, ReconciliationSection, InvoicesSection, CloseSection } from "./sections/finance"
import { ArticlesSection } from "./sections/cms"
import { ConfigSection, ApprovalsSection } from "./sections/config"
import { IncidentsSection, BackupsSection, WebhooksSection, AuditSection, LogsSection, MetricsSection } from "./sections/ops"

type Icon = typeof Users
type NavItem = { key: string; en: string; ja: string; icon: Icon; roles?: string[] }
type NavGroup = { en: string; ja: string; items: NavItem[] }

const ALL_STAFF = ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"]
const NAV: NavGroup[] = [
  { en: "Overview", ja: "概要", items: [
    { key: "overview", en: "Overview", ja: "概要", icon: LayoutGrid },
  ] },
  { en: "Marketplace", ja: "マーケットプレイス", items: [
    { key: "users", en: "Users", ja: "ユーザー", icon: Users, roles: ALL_STAFF },
    { key: "sellers", en: "Sellers", ja: "出品者", icon: Store, roles: ALL_STAFF },
    { key: "listings", en: "Listings", ja: "出品管理", icon: Package, roles: ["MODERATOR", "COMPLIANCE", "ADMIN"] },
    { key: "orders", en: "Orders", ja: "注文", icon: ShoppingCart, roles: ["SUPPORT", "FINANCE", "ADMIN"] },
    { key: "refunds", en: "Refunds", ja: "返金", icon: RotateCcw, roles: ["SUPPORT", "FINANCE", "ADMIN"] },
    { key: "disputes", en: "Disputes", ja: "紛争", icon: Scale, roles: ["SUPPORT", "MODERATOR", "ADMIN"] },
  ] },
  { en: "Trust & Support", ja: "信頼・サポート", items: [
    { key: "reports", en: "Reports & Safety", ja: "違反報告・安全", icon: Flag, roles: ["MODERATOR", "COMPLIANCE", "ADMIN"] },
    { key: "tickets", en: "Tickets", ja: "チケット", icon: LifeBuoy, roles: ALL_STAFF },
  ] },
  { en: "Finance", ja: "財務", items: [
    { key: "ledger", en: "Ledger", ja: "元帳", icon: Landmark, roles: ["FINANCE", "ADMIN"] },
    { key: "payouts", en: "Payouts", ja: "送金", icon: CreditCard, roles: ["FINANCE", "ADMIN"] },
    { key: "reconciliation", en: "Reconciliation", ja: "照合", icon: RefreshCw, roles: ["FINANCE", "ADMIN"] },
    { key: "invoices", en: "Invoices & Tax", ja: "請求・税務", icon: FileText, roles: ["FINANCE", "ADMIN"] },
    { key: "close", en: "Month Close", ja: "月次決算", icon: Calendar, roles: ["FINANCE", "ADMIN"] },
  ] },
  { en: "CMS", ja: "コンテンツ", items: [
    { key: "articles", en: "Articles", ja: "記事", icon: Newspaper, roles: ["COMPLIANCE", "ADMIN"] },
  ] },
  { en: "Config", ja: "設定", items: [
    { key: "config", en: "Flags & Settings", ja: "フラグ・設定", icon: Settings, roles: ["ADMIN"] },
    { key: "approvals", en: "Approvals", ja: "承認", icon: ShieldCheck, roles: ALL_STAFF },
  ] },
  { en: "Governance", ja: "ガバナンス", items: [
    { key: "mscs", en: "MSCS Registry", ja: "MSCSレジストリ", icon: Layers, roles: ["COMPLIANCE", "ADMIN"] },
  ] },
  { en: "Ops", ja: "運用", items: [
    { key: "incidents", en: "Incidents & Status", ja: "障害・ステータス", icon: AlertTriangle, roles: ["ADMIN", "COMPLIANCE"] },
    { key: "backups", en: "Backups & DR", ja: "バックアップ", icon: DatabaseBackup, roles: ["ADMIN", "COMPLIANCE"] },
    { key: "webhooks", en: "Webhooks", ja: "Webhook", icon: Webhook, roles: ["ADMIN", "COMPLIANCE"] },
    { key: "audit", en: "Audit Log", ja: "監査ログ", icon: ScrollText, roles: ["ADMIN", "COMPLIANCE"] },
    { key: "logs", en: "App Logs", ja: "アプリログ", icon: Terminal, roles: ALL_STAFF },
    { key: "metrics", en: "Metrics", ja: "メトリクス", icon: LineChart, roles: ["ADMIN", "COMPLIANCE"] },
  ] },
]

const SECTION_TITLES: Record<string, { en: string; ja: string }> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.key, { en: i.en, ja: i.ja }]))
)

const SECTIONS: Record<string, ComponentType> = {
  overview: OverviewSection,
  users: UsersSection,
  sellers: SellersSection,
  listings: ListingsSection,
  orders: OrdersSection,
  refunds: RefundsSection,
  disputes: DisputesSection,
  reports: ReportsSection,
  tickets: TicketsSection,
  ledger: LedgerSection,
  payouts: PayoutsSection,
  reconciliation: ReconciliationSection,
  invoices: InvoicesSection,
  close: CloseSection,
  articles: ArticlesSection,
  config: ConfigSection,
  approvals: ApprovalsSection,
  mscs: MscsAdminSection,
  incidents: IncidentsSection,
  backups: BackupsSection,
  webhooks: WebhooksSection,
  audit: AuditSection,
  logs: LogsSection,
  metrics: MetricsSection,
}

export function AdminApp({ section }: { section: string }) {
  const { locale, session, sessionLoaded, setView } = useApp()
  const [navOpen, setNavOpen] = useState(false)
  const active = SECTIONS[section] ? section : "overview"
  const title = SECTION_TITLES[active] || { en: "Overview", ja: "概要" }
  const staff = session && ALL_STAFF.includes(session.role)

  const SidebarContent = () => (
    <nav aria-label="Admin sections" className="flex flex-col gap-4 py-4 px-3">
      <button onClick={() => setView({ name: "admin", section: "overview" })}
        className="flex items-center gap-2 px-2 mb-1 text-left">
        <span className="w-8 h-8 rounded-lg tgs-gradient-teal flex items-center justify-center shrink-0" aria-hidden>
          <LayoutDashboard className="w-4 h-4 text-[#e5b93b]" />
        </span>
        <span>
          <span className="block font-extrabold tracking-tight text-white leading-none">Tenga<span className="text-[#e5b93b]">Sell</span></span>
          <span className="block text-[10px] text-teal-200/80 font-medium mt-0.5">{tr(locale, "Admin console", "管理コンソール")}</span>
        </span>
      </button>
      {NAV.map((g) => {
        const items = g.items.filter((i) => !i.roles || (session && i.roles.includes(session.role)))
        if (items.length === 0) return null
        return (
          <div key={g.en}>
            <p className="px-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-teal-200/50">{tr(locale, g.en, g.ja)}</p>
            <div className="flex flex-col gap-0.5">
              {items.map((i) => {
                const Icon = i.icon
                const isActive = active === i.key
                return (
                  <button
                    key={i.key}
                    onClick={() => { setView({ name: "admin", section: i.key }); setNavOpen(false) }}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 h-11 px-2 rounded-lg text-sm font-medium transition-colors text-left",
                      isActive ? "bg-[#1a7a8a] text-white" : "text-teal-100/80 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden />
                    <span className="truncate">{tr(locale, i.en, i.ja)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      <div className="mt-auto px-2 pt-4">
        <button onClick={() => setView({ name: "home" })}
          className="flex items-center gap-2 h-10 text-xs font-semibold text-teal-200/70 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" aria-hidden />{tr(locale, "Back to marketplace", "マーケットへ戻る")}
        </button>
        <p className="mt-3 text-[10px] text-teal-200/40 leading-relaxed">
          <ShieldCheck className="w-3 h-3 inline" aria-hidden /> MSCS 1.0 control plane · CTL-018 audit · CTL-021 dual approval
        </p>
      </div>
    </nav>
  )

  if (sessionLoaded && !staff) {
    return (
      <Empty
        icon="🔐"
        title={tr(locale, "Staff access required", "スタッフ権限が必要です")}
        hint={tr(locale, "Sign in with a staff account (support/moderation/finance/compliance/admin) to open the console.", "スタッフアカウントでサインインしてください。")}
      />
    )
  }

  const Section = SECTIONS[active]

  return (
    <div className="-mx-3 sm:-mx-4 -my-4 flex min-h-[calc(100vh-3.5rem-2rem)]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-60 shrink-0 bg-[#142326] text-teal-50 sticky top-14 bottom-0 self-start max-h-[calc(100vh-3.5rem)] overflow-y-auto tgs-scroll">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-[#142326] text-teal-50 border-0 overflow-y-auto tgs-scroll">
          <button className="absolute top-3 right-3 h-9 w-9 rounded-md text-teal-200 hover:bg-white/10 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X className="w-5 h-5 mx-auto" />
          </button>
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="flex-1 min-w-0">
        {/* Top bar */}
        <div className="sticky top-14 z-30 bg-background/95 backdrop-blur border-b">
          <div className="flex items-center gap-2 px-3 sm:px-4 h-12">
            <button className="h-10 w-10 -ml-1 rounded-md hover:bg-secondary lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open admin menu" aria-expanded={navOpen}>
              <Menu className="w-5 h-5 mx-auto" />
            </button>
            <p className="text-xs text-muted-foreground font-medium hidden sm:block">{tr(locale, "Admin console", "管理コンソール")} /</p>
            <h1 className="text-sm font-bold">{tr(locale, title.en, title.ja)}</h1>
            <div className="flex-1" />
            {session && (
              <Badge variant="outline" className="hidden sm:inline-flex gap-1 text-[10px] border-[#1a7a8a]/50 text-[#1a7a8a] dark:text-teal-300">
                <ShieldCheck className="w-3 h-3" aria-hidden />{session.name} · {session.role}
              </Badge>
            )}
            <button onClick={() => setView({ name: "home" })}
              className="h-9 px-3 rounded-md text-xs font-semibold bg-secondary hover:bg-secondary/70 transition-colors">
              {tr(locale, "Marketplace", "マーケット")}
            </button>
          </div>
        </div>
        <div className="p-3 sm:p-4 lg:p-6 max-w-[1400px]">
          {staff ? <Section /> : (
            <div className="grid grid-cols-2 gap-3 max-w-lg">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 rounded-xl border animate-pulse bg-muted/30" />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
