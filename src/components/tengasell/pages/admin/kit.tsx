"use client"
// ── Admin console shared kit (Agent C) ──────────────────────────
// Compact primitives: page wrapper, KPI cards, tables, dialogs w/ reason codes,
// status pills, charts, and small data-fetch hooks. All teal/gold themed, no blue.
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Search, ChevronLeft, ChevronRight, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp, api, tr } from "@/lib/tengasell/store"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, fmtDate } from "../../ui"
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts"

// ── i18n helper bound to current locale ─────────────────────────
export function useTT() {
  const { locale } = useApp()
  return useCallback((en: string, ja: string) => tr(locale, en, ja), [locale])
}

export function usd(n: number | null | undefined, dash = false) {
  if (n === null || n === undefined || Number.isNaN(n)) return dash ? "—" : "$0"
  const v = Math.round((n + Number.EPSILON) * 100) / 100
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)
}

export function fmtDT(d: string | Date | null | undefined) { return fmtDate(d, true) }

export function timeAgo(d: string | Date | null | undefined) {
  if (!d) return ""
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

// ── Status pill ──────────────────────────────────────────────────
type Tone = "good" | "warn" | "bad" | "info" | "gold" | "neutral"
const TONE_CLS: Record<Tone, string> = {
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200/60",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-200/60",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-red-200/60",
  info: "bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300 border-teal-200/60",
  gold: "bg-[#e5b93b]/15 text-[#8a6d1a] dark:text-[#e5b93b] border-[#e5b93b]/40",
  neutral: "bg-secondary text-secondary-foreground border-border",
}
const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "good", VERIFIED: "good", COMPLETED: "good", PUBLISHED: "good", APPROVED: "good",
  DELIVERED: "good", SENT: "good", PROCESSED: "good", PAID: "good", OK: "good", PASS: "good",
  BALANCED: "good", OPERATIONAL: "good", DELIVERED_OK: "good", UPHOLD: "info", CLEAR: "good",
  LIFT: "good",
  PENDING: "warn", PENDING_REVIEW: "warn", PENDING_PAYMENT: "warn", IN_REVIEW: "warn",
  REVIEWING: "warn", WAITING: "warn", REQUESTED: "warn", REFUND_PENDING: "warn", SCHEDULED: "warn",
  IN_PROGRESS: "warn", UNDER_REVIEW: "warn", PENDING_RENEWAL: "warn", SUBMITTED: "warn",
  PARTIAL: "warn", DEGRADED: "warn", MAINTENANCE: "warn", TRIAGE: "warn", CONTAINED: "warn",
  MEDIUM: "warn", SEV3: "warn", SEV4: "neutral", LOW: "neutral", RESTRICTION: "warn",
  WARNING: "warn", ARCHIVED: "neutral", UNPUBLISHED: "neutral", DRAFT: "neutral", CLOSED: "neutral",
  RESOLVED: "good", MITIGATED: "info", ENDED: "neutral", SOLD: "gold", CANCELLED: "bad",
  SUSPENDED: "bad", BANNED: "bad", REJECTED: "bad", DISPUTED: "bad", REFUNDED: "bad",
  FAILED: "bad", DEAD: "bad", DOWN: "bad", VARIANCE: "bad", CRITICAL: "bad", HIGH: "bad",
  SEV1: "bad", SEV2: "bad", OPEN: "warn", ACTIONED: "info", DISMISSED: "neutral",
  REVERSED: "gold", UPHeld: "info", SHIPPED: "info", AUTHORIZED: "info", REVERSE: "gold",
}
const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: "In review", PENDING_PAYMENT: "Awaiting pay", IN_REVIEW: "In review",
  UNDER_REVIEW: "Under review", IN_PROGRESS: "In progress", REFUND_PENDING: "Refund pending",
  PENDING_RENEWAL: "Renewal due", OPERATIONAL: "Operational",
}
export function StatusPill({ status, size = "sm", children, tone: toneOverride }: {
  status: string | null | undefined; size?: "sm" | "xs"; children?: ReactNode; tone?: Tone
}) {
  if (!status && !children) return <span className="text-muted-foreground">—</span>
  const tone = toneOverride || (status ? STATUS_TONE[status] || "neutral" : "neutral")
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border font-medium whitespace-nowrap",
      size === "xs" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]",
      TONE_CLS[tone],
    )}>
      {children || (status ? STATUS_LABEL[status] || status.replace(/_/g, " ").toLowerCase() : "—")}
    </span>
  )
}

// ── Page wrapper ────────────────────────────────────────────────
export function AdminPage({ title, desc, action, children }: { title: string; desc?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">{title}</h1>
          {desc && <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>}
        </div>
        {action && <div className="flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
      {children}
    </div>
  )
}

// ── KPI card ─────────────────────────────────────────────────────
export function KPICard({ label, value, sub, icon, tone = "neutral", onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode
  tone?: "neutral" | "good" | "warn" | "bad" | "gold"; onClick?: () => void
}) {
  const ring: Record<string, string> = {
    neutral: "border-border", good: "border-emerald-300/70 dark:border-emerald-800",
    warn: "border-amber-300/70 dark:border-amber-800", bad: "border-red-300/70 dark:border-red-800",
    gold: "border-[#e5b93b]/60",
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn("text-left rounded-xl border bg-card p-4 shadow-sm", ring[tone], onClick && "hover:shadow-md hover:border-primary/50 transition-colors cursor-pointer")}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground font-medium leading-tight">{label}</p>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <p className="text-xl font-bold mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </button>
  )
}

// ── Section tabs ─────────────────────────────────────────────────
export function AdminTabs({ tabs, value, onChange }: {
  tabs: { key: string; label: ReactNode; count?: number }[]; value: string; onChange: (k: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "h-9 px-3 rounded-full text-xs font-semibold border transition-colors",
            value === t.key
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-secondary",
          )}
        >
          {t.label}
          {typeof t.count === "number" && <span className="ml-1.5 opacity-80 tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────
export type Col<T> = {
  key: string
  header: ReactNode
  cell?: (row: T) => ReactNode
  className?: string
}
export function AdminTable<T extends Record<string, any>>({
  columns, rows, loading, empty, total, page, limit = 20, onPage, toolbar, rowKey, maxHeight = true,
}: {
  columns: Col<T>[]; rows: T[]; loading?: boolean; empty?: string
  total?: number; page?: number; limit?: number; onPage?: (p: number) => void
  toolbar?: ReactNode; rowKey?: (r: T, i: number) => string; maxHeight?: boolean
}) {
  const pages = total !== undefined && limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1
  const cur = Math.min(page || 1, pages)
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {toolbar && <div className="p-3 border-b bg-secondary/30 flex flex-wrap items-center gap-2">{toolbar}</div>}
      {loading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <Empty icon="🗂️" title={empty || "Nothing here yet"} />
      ) : (
        <div className={cn("overflow-auto tgs-scroll", maxHeight ? "max-h-[70vh]" : "")}>
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 sticky top-0 z-10">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={cn("text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap", c.className)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} className="border-t hover:bg-secondary/30 transition-colors">
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5 align-middle", c.className)}>
                      {c.cell ? c.cell(r) : (r[c.key] as ReactNode)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total !== undefined && onPage && (
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-t bg-secondary/30">
          <p className="text-xs text-muted-foreground tabular-nums">{total} item{total === 1 ? "" : "s"}</p>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Page {cur} / {pages}</p>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={cur <= 1 || loading} onClick={() => onPage(cur - 1)} aria-label="Previous page">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={cur >= pages || loading} onClick={() => onPage(cur + 1)} aria-label="Next page">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 min-w-[180px] max-w-xs">
      <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search…"}
        className="pl-8 h-9"
        aria-label={placeholder || "Search"}
      />
    </div>
  )
}

// ── Data hooks ───────────────────────────────────────────────────
export function useList<Q extends Record<string, string | number | undefined | null>>(
  path: string | null, params?: Q,
) {
  const [rows, setRows] = useState<Record<string, any>[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const pk = JSON.stringify(params || {})
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reset page when params change
  useEffect(() => { setPage(1) }, [pk])
  useEffect(() => {
    if (!path) return
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state before fetch
    setLoading(true)
    const usp = new URLSearchParams()
    Object.entries(JSON.parse(pk) as Record<string, unknown>).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") usp.set(k, String(v))
    })
    usp.set("page", String(page))
    api<any>(`${path}?${usp.toString()}`).then((j) => {
      if (!alive) return
      if (j.ok && j.data) { setRows(j.data.items || []); setTotal(j.data.total ?? 0) }
      else if (!j.ok) toast({ title: "Load failed", description: j.error?.message || "Request error", variant: "destructive" })
    }).catch(() => { if (alive) toast({ title: "Load failed", variant: "destructive" }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [path, pk, page, nonce])
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { rows, total, page, setPage, loading, reload }
}

export function useOne<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!path) return
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state before fetch
    setLoading(true)
    api<T>(path).then((j) => { if (alive) setData(j.ok ? (j.data as T) : null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [path, nonce])
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, reload }
}

// Mutation helper with toast + busy state
export function useMutate() {
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (
    path: string, body: unknown, success: string, opts?: { method?: string; onErr?: (m: string) => void },
  ): Promise<boolean> => {
    setBusy(true)
    try {
      const j = await api<any>(path, { method: opts?.method || "POST", body: JSON.stringify(body) })
      if (j.ok) {
        toast({ title: success })
        return true
      }
      toast({ title: "Action failed", description: j.error?.message || "Request error", variant: "destructive" })
      opts?.onErr?.(j.error?.message || "")
      return false
    } catch {
      toast({ title: "Network error", variant: "destructive" })
      return false
    } finally { setBusy(false) }
  }, [])
  return { run, busy }
}

// Reason codes, fetched once and cached module-wide
let rcCache: { key: string; label: string; labelJa?: string | null; category: string }[] | null = null
export function useReasonCodes() {
  const [codes, setCodes] = useState(rcCache || [])
  useEffect(() => {
    if (rcCache) return
    api<{ reasonCodes: { key: string; label: string; labelJa?: string | null; category: string }[] }>("/api/admin/config").then((j) => {
      if (j.ok && j.data?.reasonCodes) { rcCache = j.data.reasonCodes; setCodes(j.data.reasonCodes) }
    }).catch(() => undefined)
  }, [])
  return codes
}

// ── Dialogs ──────────────────────────────────────────────────────
export function DialogShell({ open, onOpenChange, title, description, footer, children, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode
  footer?: ReactNode; children: ReactNode; wide?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[88vh] overflow-y-auto tgs-scroll", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

export function Labeled({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ReasonSelect({ codes, value, onChange, placeholder }: {
  codes: { key: string; label: string; labelJa?: string | null }[]; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  const { locale } = useApp()
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-10" aria-label="Reason code"><SelectValue placeholder={placeholder || "Reason code…"} /></SelectTrigger>
      <SelectContent className="max-h-64">
        {codes.map((c) => (
          <SelectItem key={c.key} value={c.key}>{locale === "ja" && c.labelJa ? c.labelJa : c.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Standard action dialog: reason code select + note textarea + confirm
export function ActionDialog({
  open, onOpenChange, title, description, reasonCodes, requireReason = false, requireNote = false,
  submitLabel, danger, busy, onSubmit, children, notePlaceholder,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string
  reasonCodes?: { key: string; label: string; labelJa?: string | null }[]; requireReason?: boolean; requireNote?: boolean
  submitLabel: string; danger?: boolean; busy?: boolean
  onSubmit: (vals: { reason: string; note: string }) => Promise<boolean> | boolean
  children?: ReactNode; notePlaceholder?: string
}) {
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on open
    if (open) { setReason(""); setNote("") }
  }, [open])
  const canSubmit = !busy && (!requireReason || !!reason) && (!requireNote || note.trim().length > 0)
  return (
    <DialogShell
      open={open} onOpenChange={onOpenChange} title={title} description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-10">Cancel</Button>
          <Button
            variant={danger ? "destructive" : "default"}
            disabled={!canSubmit}
            className="h-10 min-w-11"
            onClick={async () => {
              const done = await onSubmit({ reason, note: note.trim() })
              if (done) onOpenChange(false)
            }}
          >
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />}
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        {children}
        {reasonCodes && reasonCodes.length > 0 && (
          <Labeled label="Reason code" hint={requireReason ? "Required — recorded in the audit trail" : undefined}>
            <ReasonSelect codes={reasonCodes} value={reason} onChange={setReason} />
          </Labeled>
        )}
        <Labeled label={requireNote ? "Note (required)" : "Note"} hint="Visible in the audit trail">
          <Textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="text-sm"
            placeholder={notePlaceholder || "Optional context for this decision…"}
          />
        </Labeled>
      </div>
    </DialogShell>
  )
}

export function ConfirmButton({ label, variant = "default", icon, confirmTitle, confirmDesc, busyLabel, onConfirm, className, size = "sm" }: {
  label: ReactNode; variant?: "default" | "secondary" | "outline" | "destructive" | "ghost" | "link"
  icon?: ReactNode; confirmTitle: string; confirmDesc?: string; busyLabel?: string
  onConfirm: () => Promise<boolean> | boolean; className?: string; size?: "sm" | "default"
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} className={cn("h-9", className)} onClick={() => setOpen(true)}>
        {icon}{label}
      </Button>
      <DialogShell
        open={open} onOpenChange={setOpen} title={confirmTitle} description={confirmDesc}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={variant === "destructive" ? "destructive" : "default"} className="h-10 min-w-11"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const done = await onConfirm()
                setBusy(false)
                if (done) setOpen(false)
              }}
            >
              {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />}{busyLabel || confirmTitle}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This action is audited with your name and role.</p>
      </DialogShell>
    </>
  )
}

// ── Charts (recharts, teal/gold) ─────────────────────────────────
const CHART_GRID = { stroke: "hsl(var(--border))", strokeDasharray: "3 3" }
const AXIS = { fontSize: 10, stroke: "hsl(var(--muted-foreground))" }

export function ChartCard({ title, children, height = 180 }: { title: string; children: ReactNode; height?: number }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold text-muted-foreground mb-2">{title}</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children as any}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function MiniLineChart({ data, xKey, series }: {
  data: any[]; xKey: string; series: { key: string; color?: string; name?: string }[]
}) {
  const palette = ["#1a7a8a", "#e5b93b", "#b8860b", "#0f766e"]
  return (
    <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
      <CartesianGrid {...CHART_GRID} vertical={false} />
      <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
      {series.map((s, i) => (
        <Line key={s.key} type="monotone" dataKey={s.key} name={s.name || s.key}
          stroke={s.color || palette[i % palette.length]} strokeWidth={2} dot={false} />
      ))}
    </LineChart>
  )
}

export function MiniBarChart({ data, xKey, series }: {
  data: any[]; xKey: string; series: { key: string; color?: string; name?: string }[]
}) {
  const palette = ["#1a7a8a", "#e5b93b", "#b8860b", "#0f766e"]
  return (
    <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
      <CartesianGrid {...CHART_GRID} vertical={false} />
      <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} />
      {series.map((s, i) => (
        <Bar key={s.key} dataKey={s.key} name={s.name || s.key} fill={s.color || palette[i % palette.length]} radius={[3, 3, 0, 0]} />
      ))}
    </BarChart>
  )
}

// ── Misc small pieces ────────────────────────────────────────────
export function Check({ ok }: { ok: boolean }) {
  return <span className={cn("inline-block w-4 text-center font-bold", ok ? "text-emerald-600" : "text-red-500")} aria-label={ok ? "yes" : "no"}>{ok ? "✓" : "✗"}</span>
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-dashed last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{k}</span>
      <span className="text-sm font-medium text-right">{v ?? "—"}</span>
    </div>
  )
}

export function LoadBox({ children, loading }: { children: ReactNode; loading?: boolean }) {
  if (loading) return <div className="p-6 space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
  return <>{children}</>
}

export function NoneRow({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
      <Inbox className="w-4 h-4" aria-hidden />{msg}
    </div>
  )
}
