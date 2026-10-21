"use client"
// ── Admin › Overview — KPIs, 14-day charts, quick queues ─────────
import { Users, Package, DollarSign, Landmark, AlertTriangle, LifeBuoy, ShieldCheck, DatabaseBackup, Activity, Gavel, BadgeCheck } from "lucide-react"
import { useApp, tr } from "@/lib/tengasell/store"
import { AdminPage, KPICard, ChartCard, MiniLineChart, MiniBarChart, StatusPill, useOne, usd, fmtDT } from "../kit"
import { Button } from "@/components/ui/button"

type Overview = {
  users: { total: number; active: number }
  listingsByStatus: Record<string, number>
  ordersByStatus: Record<string, number>
  gmv30d: number
  revenue: number
  openDisputes: number
  openTickets: number
  openReports: number
  pendingApprovals: number
  lastBackup: { createdAt: string; status: string; kind: string } | null
  lastReconciliation: { status: string; ranAt: string } | null
  activeIncidents: number
  series: Record<string, any>[]
  staff: { id: string; name: string; role: string }[]
}

export function OverviewSection() {
  const { locale, setView } = useApp()
  const { data } = useOne<Overview>("/api/admin/overview")
  const o = data

  const goto = (section: string) => () => setView({ name: "admin", section })

  return (
    <AdminPage
      title={tr(locale, "Overview", "概要")}
      desc={tr(locale, "Marketplace health, finance at a glance and operational queues.", "マーケットプレイスの健全性・財務・運用キューの概要。")}
    >
      {!o ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-4 h-24 animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard label={tr(locale, "Users", "ユーザー")} value={o.users.total} sub={`${o.users.active} active`} icon={<Users className="w-4 h-4" />} onClick={goto("users")} />
            <KPICard label={tr(locale, "Active listings", "出品中")} value={o.listingsByStatus.ACTIVE ?? 0} sub={`${o.listingsByStatus.PENDING_REVIEW ?? 0} in review`} icon={<Package className="w-4 h-4" />} onClick={goto("listings")} />
            <KPICard label={tr(locale, "GMV · last 30d", "流通総額・30日")} value={usd(o.gmv30d)} icon={<DollarSign className="w-4 h-4" />} tone="gold" />
            <KPICard label={tr(locale, "Platform revenue", "プラットフォーム収益")} value={usd(o.revenue)} icon={<Landmark className="w-4 h-4" />} tone="good" />
            <KPICard label={tr(locale, "Open disputes", "進行中の紛争")} value={o.openDisputes} icon={<Gavel className="w-4 h-4" />} tone={o.openDisputes > 0 ? "bad" : "neutral"} onClick={goto("disputes")} />
            <KPICard label={tr(locale, "Open tickets", "対応中チケット")} value={o.openTickets} icon={<LifeBuoy className="w-4 h-4" />} tone={o.openTickets > 0 ? "warn" : "neutral"} onClick={goto("tickets")} />
            <KPICard label={tr(locale, "Pending approvals", "承認待ち")} value={o.pendingApprovals} icon={<ShieldCheck className="w-4 h-4" />} tone={o.pendingApprovals > 0 ? "warn" : "neutral"} onClick={goto("approvals")} />
            <KPICard
              label={tr(locale, "Last backup", "最終バックアップ")}
              value={<StatusPill status={o.lastBackup?.status || "—"} />}
              sub={o.lastBackup ? fmtDT(o.lastBackup.createdAt) : "none yet"}
              icon={<DatabaseBackup className="w-4 h-4" />}
              onClick={goto("backups")}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title={tr(locale, "GMV — last 14 days (USD)", "流通総額・14日")}>
              <MiniLineChart data={o.series} xKey="date" series={[{ key: "gmv", name: "GMV" }]} />
            </ChartCard>
            <ChartCard title={tr(locale, "Orders — last 14 days", "注文数・14日")}>
              <MiniBarChart data={o.series} xKey="date" series={[{ key: "orders", name: "Orders", color: "#e5b93b" }]} />
            </ChartCard>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">{tr(locale, "Quick queues", "優先キュー")}</p>
              <Button variant="secondary" className="w-full justify-between h-11" onClick={goto("listings")}>
                <span>{tr(locale, "Listings awaiting review", "審査待ち出品")}</span>
                <span className="font-bold tabular-nums">{o.listingsByStatus.PENDING_REVIEW ?? 0}</span>
              </Button>
              <Button variant="secondary" className="w-full justify-between h-11" onClick={goto("approvals")}>
                <span>{tr(locale, "Approval requests", "承認リクエスト")}</span>
                <span className="font-bold tabular-nums">{o.pendingApprovals}</span>
              </Button>
              <Button variant="secondary" className="w-full justify-between h-11" onClick={goto("reports")}>
                <span>{tr(locale, "Abuse reports", "違反報告")}</span>
                <span className="font-bold tabular-nums">{o.openReports}</span>
              </Button>
              <Button variant="secondary" className="w-full justify-between h-11" onClick={goto("disputes")}>
                <span>{tr(locale, "Disputes", "紛争")}</span>
                <span className="font-bold tabular-nums">{o.openDisputes}</span>
              </Button>
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-1">
              <p className="text-xs font-semibold text-muted-foreground mb-2">{tr(locale, "Orders by status", "注文ステータス別")}</p>
              {Object.entries(o.ordersByStatus).slice(0, 8).map(([s, n]) => (
                <div key={s} className="flex items-center justify-between py-1 border-b border-dashed last:border-0">
                  <StatusPill status={s} size="xs" />
                  <span className="text-sm font-semibold tabular-nums">{n}</span>
                </div>
              ))}
            </div>

            <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">{tr(locale, "Operations", "運用状況")}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-1.5"><Activity className="w-4 h-4 text-muted-foreground" />{tr(locale, "Active incidents", "アクティブ障害")}</span>
                <span className={`text-sm font-bold ${o.activeIncidents > 0 ? "text-red-600" : ""}`}>{o.activeIncidents}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-1.5"><BadgeCheck className="w-4 h-4 text-muted-foreground" />{tr(locale, "Reconciliation", "照合")}</span>
                {o.lastReconciliation ? <StatusPill status={o.lastReconciliation.status} size="xs" /> : <span className="text-sm text-muted-foreground">—</span>}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-muted-foreground" />{tr(locale, "Abuse queue", "違反キュー")}</span>
                <span className="text-sm font-bold">{o.openReports}</span>
              </div>
              <Button variant="outline" size="sm" className="w-full h-9" onClick={goto("incidents")}>
                {tr(locale, "Incidents & status →", "障害・ステータス →")}
              </Button>
            </div>
          </div>
        </>
      )}
    </AdminPage>
  )
}
