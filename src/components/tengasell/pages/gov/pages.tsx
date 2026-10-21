"use client"
// ── GOV/PUBLIC TRACK (Agent D files completed by orchestrator) ──
// Help centre · Policy viewer · Status page · Privacy centre · Developer portal · MSCS certification console
import { useEffect, useState, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { Price, SectionTitle, Empty, StatusBadge, fmtDate } from "../../ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import {
  BookOpen, Search, FileText, Activity, ShieldCheck, Key, Webhook, Plus, Trash2, Copy,
  CheckCircle2, XCircle, ChevronLeft, ChevronRight, Lock, Download, Scale, Megaphone,
  ClipboardCheck, Award, AlertTriangle, Filter, RefreshCw, Eye, Flag, Send,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Loc = "en" | "ja"
const useT = () => { const { locale } = useApp(); return (en: string, ja: string) => (locale === "ja" ? ja : en) as string }

function Md({ body }: { body: string }) {
  return (
    <div className="prose-tgs text-sm leading-relaxed space-y-2 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h3]:font-semibold [&_h3]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:p-1.5 [&_th]:bg-secondary [&_td]:border [&_td]:p-1.5 [&_a]:text-primary [&_a]:underline [&_code]:bg-secondary [&_code]:px-1 [&_code]:rounded [&_p]:mt-2">
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
  )
}

// ── Help centre ─────────────────────────────────────────────────
export function HelpPage() {
  const tt = useT()
  const { setView, locale } = useApp()
  const [q, setQ] = useState("")
  const [type, setType] = useState("ALL")
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true)
      const r = await api<any>(`/api/public/help?q=${encodeURIComponent(q)}${type !== "ALL" ? `&type=${type}` : ""}`)
      setItems(r?.data?.items || [])
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q, type])
  const groups = useMemo(() => {
    const g: Record<string, any[]> = {}
    for (const it of items) (g[it.type] = g[it.type] || []).push(it)
    return g
  }, [items])
  return (
    <div className="space-y-4">
      <div className="tgs-gradient-teal text-white rounded-xl p-6 sm:p-8">
        <h1 className="text-2xl font-extrabold">{tr(locale, "Help centre", "ヘルプセンター")}</h1>
        <p className="text-white/85 text-sm mt-1">{tr(locale, "Guides for buyers, sellers and partners.", "購入者・出品者のためのガイド。")}</p>
        <div className="flex gap-2 mt-4 max-w-lg">
          <label htmlFor="help-search" className="sr-only">Search help</label>
          <Input id="help-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr(locale, "Search help articles…", "ヘルプ記事を検索…")} className="bg-white/95 h-10" />
        </div>
      </div>
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Article types">
        {[["ALL", "All", "すべて"], ["HELP", "Help", "ヘルプ"], ["SELLER_DOC", "Seller academy", "セラーアカデミー"], ["ANNOUNCEMENT", "Announcements", "お知らせ"]].map(([k, en, ja]) => (
          <Button key={k} size="sm" variant={type === k ? "default" : "outline"} className="h-9" onClick={() => setType(k)} role="tab" aria-selected={type === k}>
            {tr(locale, en, ja)}
          </Button>
        ))}
      </div>
      {loading ? <p className="text-sm text-muted-foreground">…</p> : items.length === 0 ? (
        <Empty icon="📚" title={tr(locale, "No articles found", "記事が見つかりません")} hint={tr(locale, "Try a different search.", "別のキーワードでお試しください。")} />
      ) : (
        Object.entries(groups).map(([gtype, arts]) => (
          <section key={gtype} aria-label={gtype}>
            <SectionTitle>{gtype === "HELP" ? tt("Help topics", "ヘルプ") : gtype === "SELLER_DOC" ? tt("Seller academy", "セラーアカデミー") : gtype === "ANNOUNCEMENT" ? tt("Announcements", "お知らせ") : gtype}</SectionTitle>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {arts.map((a: any) => (
                <Card key={a.slug} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => setView({ name: "helpArticle", slug: a.slug })}>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-start gap-2"><BookOpen className="w-4 h-4 mt-0.5 text-primary shrink-0" />{locale === "ja" && a.titleJa ? a.titleJa : a.title}</CardTitle></CardHeader>
                  <CardContent className="pt-0"><p className="text-xs text-muted-foreground line-clamp-2">{locale === "ja" && a.bodyJa ? a.bodyJa.slice(0, 120) : (a.summary || a.body || "").slice(0, 120)}</p></CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

export function HelpArticlePage({ slug }: { slug: string }) {
  const tt = useT()
  const { setView, locale } = useApp()
  const [art, setArt] = useState<any>(null)
  const [related, setRelated] = useState<any[]>([])
  const [helpful, setHelpful] = useState<null | boolean>(null)
  useEffect(() => { api<any>(`/api/public/help/${slug}`).then(r => { setArt(r?.data?.article || null); setRelated(r?.data?.related || []) }) }, [slug])
  if (!art) return <Empty title={tt("Loading…", "読み込み中…")} />
  const body = locale === "ja" && art.bodyJa ? art.bodyJa : art.body
  return (
    <article className="max-w-3xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" onClick={() => setView({ name: "help" })} className="h-9"><ChevronLeft className="w-4 h-4" />{tt("Help centre", "ヘルプセンター")}</Button>
      <div><Badge variant="outline">{art.type}</Badge><h1 className="text-2xl font-extrabold mt-2">{locale === "ja" && art.titleJa ? art.titleJa : art.title}</h1>
        <p className="text-xs text-muted-foreground mt-1">{tt("Updated", "更新")} {fmtDate(art.updatedAt)} · v{art.version}</p></div>
      <div className="border rounded-lg p-4 bg-card"><Md body={body || ""} /></div>
      <Card><CardContent className="flex items-center justify-between gap-3 py-4">
        <p className="text-sm font-medium">{tt("Was this helpful?", "参考になりましたか？")}</p>
        <div className="flex gap-2">
          <Button variant={helpful === true ? "default" : "outline"} size="sm" onClick={() => { setHelpful(true); toast.success(tt("Thanks for the feedback!", "ご意見ありがとうございます！")) }} aria-label="Yes"><CheckCircle2 className="w-4 h-4" /></Button>
          <Button variant={helpful === false ? "destructive" : "outline"} size="sm" onClick={() => { setHelpful(false); toast(tt("Sorry about that.", "申し訳ありません。")) }} aria-label="No"><XCircle className="w-4 h-4" /></Button>
        </div>
      </CardContent></Card>
      {related?.length > 0 && (
        <section><SectionTitle>{tt("Related articles", "関連記事")}</SectionTitle>
          <div className="grid sm:grid-cols-2 gap-2">
            {related.map((a: any) => <Button key={a.slug} variant="outline" className="justify-start h-11 text-sm" onClick={() => setView({ name: "helpArticle", slug: a.slug })}><BookOpen className="w-4 h-4 mr-2 text-primary" />{a.title}</Button>)}
          </div>
        </section>
      )}
      <Card className="bg-secondary/50"><CardContent className="flex items-center gap-3 py-4 text-sm">
        <Megaphone className="w-4 h-4 text-primary" />{tt("Still stuck? Contact support from Messages or support@tengasell.co.zw", "解決しない場合はメッセージまたは support@tengasell.co.zw へ")}
      </CardContent></Card>
    </article>
  )
}

// ── Policy viewer ───────────────────────────────────────────────
export function PolicyPage({ keyName }: { keyName: string }) {
  const tt = useT()
  const { locale, setView } = useApp()
  const [pol, setPol] = useState<any>(null)
  const [art, setArt] = useState<any>(null)
  useEffect(() => {
    api<any>(`/api/public/policies?key=${keyName}`).then(r => {
      if (r?.data?.policy) setPol(r.data.policy)
      else api<any>(`/api/public/help/${keyName}`).then(r2 => setArt(r2?.data?.article || null))
    })
  }, [keyName])
  const body = pol?.body || (locale === "ja" && art?.bodyJa ? art.bodyJa : art?.body)
  const title = pol?.title || (locale === "ja" && art?.titleJa ? art.titleJa : art?.title) || keyName
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" className="h-9" onClick={() => setView({ name: "help" })}><ChevronLeft className="w-4 h-4" />{tt("Help & policies", "ヘルプとポリシー")}</Button>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-extrabold">{title}</h1>
          {pol && <p className="text-xs text-muted-foreground mt-1">v{pol.version} · {tt("Effective", "発効")} {fmtDate(pol.effectiveAt)} · {JSON.parse(pol.jurisdictions || '["ZW"]').join(", ")}</p>}
        </div>
        {pol?.acceptanceRequired && <Badge className="bg-[#b8860b]"><Lock className="w-3 h-3 mr-1" />{tt("Acceptance required", "同意必須")}</Badge>}
      </div>
      {body ? <div className="border rounded-lg p-4 bg-card"><Md body={body} /></div>
        : <Empty icon="📄" title={tt("Policy not found", "ポリシーが見つかりません")} hint={tt("It may be published in the help centre instead.", "ヘルプセンターに公開されている場合があります。")} />}
      <div className="flex gap-2 flex-wrap border-t pt-4">
        {["terms", "privacy", "aup", "refunds", "seller", "prohibited", "accessibility", "api-terms", "cookies"].filter(k => k !== keyName).map(k => (
          <Button key={k} size="sm" variant="outline" className="h-9 capitalize text-xs" onClick={() => setView({ name: "policy", key: k })}>{k}</Button>
        ))}
      </div>
    </div>
  )
}

// ── Public status page ──────────────────────────────────────────
export function StatusPage() {
  const tt = useT()
  const { locale } = useApp()
  const [data, setData] = useState<any>(null)
  const refresh = () => api<any>("/api/public/status").then(r => setData(r?.data))
  useEffect(() => { refresh(); const i = setInterval(refresh, 30000); return () => clearInterval(i) }, [])
  if (!data) return <Empty title={tt("Loading status…", "状態を取得中…")} />
  const tone = data.overall === "OPERATIONAL" ? "bg-emerald-600" : data.overall === "DEGRADED" ? "bg-amber-500" : "bg-destructive"
  const label = data.overall === "OPERATIONAL" ? tt("All systems operational", "すべてのシステムが正常に稼働中") : data.overall === "DEGRADED" ? tt("Degraded performance", "パフォーマンス低下") : tt("Service disruption", "サービス障害")
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className={cn("rounded-xl p-6 text-white", tone)} role="status">
        <h1 className="text-2xl font-extrabold flex items-center gap-2"><Activity className="w-6 h-6" />{label}</h1>
        <p className="text-white/85 text-sm mt-1">{tt("Tengasell service health", "Tengasellのサービス状態")} · {fmtDate(data.generatedAt, true)}</p>
      </div>
      <section aria-label="Components">
        <SectionTitle>{tt("Components", "コンポーネント")}</SectionTitle>
        <div className="space-y-2">
          {Object.entries(data.current || {}).map(([comp, ev]: [string, any]) => (
            <div key={comp} className="flex items-center justify-between border rounded-lg px-4 py-3">
              <span className="text-sm font-medium capitalize">{comp}</span>
              <span className="flex items-center gap-2 text-xs">
                {ev.message && <span className="text-muted-foreground">{ev.message}</span>}
                <Badge variant={ev.status === "OPERATIONAL" ? "default" : ev.status === "DEGRADED" ? "outline" : "destructive"}>{ev.status}</Badge>
              </span>
            </div>
          ))}
        </div>
      </section>
      {data.incidents?.length > 0 && (
        <section aria-label="Incidents"><SectionTitle>{tt("Incident history", "障害履歴")}</SectionTitle>
          <div className="space-y-2">
            {data.incidents.map((i: any) => (
              <Card key={i.ref}><CardContent className="py-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap"><Badge variant="outline">{i.severity}</Badge><span className="text-sm font-semibold">{i.title}</span></div>
                <p className="text-xs text-muted-foreground">{i.impact}</p>
                <p className="text-[11px] text-muted-foreground">{fmtDate(i.startedAt, true)} — {i.resolvedAt ? fmtDate(i.resolvedAt, true) : tt("ongoing", "進行中")}{i.postmortemRef ? ` · PM: ${i.postmortemRef}` : ""}</p>
              </CardContent></Card>
            ))}
          </div>
        </section>
      )}
      <p className="text-xs text-muted-foreground border-t pt-3">{tt("Subscribe to status updates from your notification preferences (Account → Comms).", "アカウント→通知設定からステータス更新を購読できます。")}</p>
    </div>
  )
}

// ── Privacy centre ──────────────────────────────────────────────
export function PrivacyPage() {
  const tt = useT()
  const { session, setView, locale } = useApp()
  const [inv, setInv] = useState<any[]>([])
  const [dsars, setDsars] = useState<any[]>([])
  const [consents, setConsents] = useState<any[]>([])
  const [dialog, setDialog] = useState<null | string>(null)
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<any>("/api/public/privacy").then(r => setInv(r?.data?.items || [])) }, [])
  const loadMine = () => {
    if (!session) return
    api<any>("/api/privacy/dsar").then(r => setDsars(r?.data?.items || []))
    api<any>("/api/privacy/consents").then(r => setConsents(r?.data?.items || []))
  }
  useEffect(loadMine, [session])
  const submitDsar = async (type: string) => {
    setBusy(true)
    const r = await api("/api/privacy/dsar", { method: "POST", body: JSON.stringify({ type, details }) })
    setBusy(false)
    if (r.ok) { toast.success(tt("Request submitted — tracked with a 30-day SLA.", "リクエストを送信しました（30日SLAで対応）。")); setDialog(null); setDetails(""); loadMine() }
    else toast.error(r.error?.message || "Failed")
  }
  const exportData = async () => {
    setBusy(true)
    const r = await fetch("/api/account/export", { method: "POST", headers: { "Content-Type": "application/json" } })
    setBusy(false)
    if (r.ok) {
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = "tengasell-my-data.json"; a.click(); URL.revokeObjectURL(url)
      toast.success(tt("Data export downloaded", "データをダウンロードしました"))
    } else toast.error(tt("Export failed", "エクスポートに失敗しました"))
  }
  const RIGHTS: [string, string, string, string][] = [
    ["ACCESS", "Access", "開示", "Get a copy of the personal data we hold about you."],
    ["CORRECTION", "Correction", "訂正", "Fix inaccurate personal data."],
    ["DELETION", "Deletion", "削除", "Request erasure of your personal data (statutory retention exceptions apply)."],
    ["PORTABILITY", "Portability", "ポータビリティ", "Receive your data in a machine-readable format."],
    ["RESTRICTION", "Restriction", "制限", "Restrict processing of your data pending a dispute."],
    ["OBJECTION", "Objection", "異議申し立て", "Object to processing based on legitimate interest."],
  ]
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="tgs-gradient-teal text-white rounded-xl p-6">
        <h1 className="text-2xl font-extrabold flex items-center gap-2"><ShieldCheck className="w-6 h-6" />{tr(locale, "Privacy centre", "プライバシーセンター")}</h1>
        <p className="text-white/85 text-sm mt-1">{tr(locale, "Your data, your rights — Cyber & Data Protection Act [Chapter 12:07] and GDPR-aligned.", "あなたのデータと権利 — サイバー・データ保護法およびGDPR準拠。")}</p>
      </div>
      {!session && (
        <Card className="border-[#b8860b]"><CardContent className="flex items-center justify-between py-4">
          <p className="text-sm">{tt("Sign in to exercise your data rights", "データ権利を行使するにはログインしてください")}</p>
          <Button onClick={() => setView({ name: "auth" })}>{tt("Sign in", "ログイン")}</Button>
        </CardContent></Card>
      )}
      <section><SectionTitle>{tt("Your data rights", "データ権利")}</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {RIGHTS.map(([type, en, ja, desc]) => (
            <Card key={type} className="hover:shadow-sm"><CardContent className="p-3">
              <p className="text-sm font-semibold">{tt(en, ja)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{desc}</p>
              <Button size="sm" variant="outline" className="h-8 mt-2 w-full text-xs" disabled={!session} onClick={() => setDialog(type)}>{tt("Request", "リクエスト")}</Button>
            </CardContent></Card>
          ))}
        </div>
        {dsars.length > 0 && (
          <div className="mt-3 border rounded-lg divide-y">
            {dsars.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium">{d.type}</span>
                <span className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{tt("Due", "期限")} {fmtDate(d.dueAt)}</span><StatusBadge status={d.status} /></span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="grid sm:grid-cols-2 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Download className="w-4 h-4 text-primary" />{tt("Download your data", "データのダウンロード")}</CardTitle></CardHeader>
          <CardContent><p className="text-xs text-muted-foreground mb-2">{tt("Machine-readable export of everything linked to your account (portability).", "アカウントに関連する全データの機械可読エクスポート。")}</p>
            <Button size="sm" disabled={!session || busy} onClick={exportData}>{busy ? "…" : tt("Export JSON", "JSONをエクスポート")}</Button></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Megaphone className="w-4 h-4 text-primary" />{tt("Marketing consent", "マーケティング同意")}</CardTitle></CardHeader>
          <CardContent>
            {consents.filter((c: any) => c.purpose === "MARKETING").map((c: any) => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <span>{tt("Marketing emails (opt-in)", "マーケティングメール（オプトイン）")}</span>
                <Switch checked={!!c.granted} disabled={!session} onCheckedChange={async (v) => { await api("/api/privacy/consents", { method: "PUT", body: JSON.stringify({ purpose: "MARKETING", granted: v }) }); loadMine(); toast.success(v ? tt("Subscribed", "購読しました") : tt("Unsubscribed", "配信停止しました")) }} />
              </div>
            ))}
            {consents.length === 0 && <p className="text-xs text-muted-foreground">{tt("Manage email preferences in Comms.", "通知設定で管理してください。")}</p>}
          </CardContent></Card>
      </section>
      <section><SectionTitle>{tt("What we hold & why (RoPA)", "保持データと目的（RoPA）")}</SectionTitle>
        <div className="border rounded-lg overflow-x-auto text-xs">
          <table className="w-full"><thead className="bg-secondary"><tr><th className="p-2 text-left">{tt("Data", "データ")}</th><th className="p-2 text-left">{tt("Purpose", "目的")}</th><th className="p-2 text-left">{tt("Legal basis", "法的根拠")}</th><th className="p-2 text-left">{tt("Retention", "保持期間")}</th></tr></thead>
            <tbody className="divide-y">
              {inv.map((d: any) => (<tr key={d.id} className="align-top"><td className="p-2 font-medium">{d.asset}</td><td className="p-2">{d.purpose}</td><td className="p-2">{d.legalBasis}</td><td className="p-2">{d.retention}</td></tr>))}
            </tbody></table>
        </div>
      </section>
      <Card className="bg-secondary/40"><CardContent className="py-3 text-xs text-muted-foreground">
        {tt("Data Protection Officer: privacy@tengasell.co.zw · Processors and sub-processors listed in our Privacy Policy · Complaints route included in policy.", "データ保護責任者: privacy@tengasell.co.zw · 処理者はプライバシーポリシーに記載 · 苦情処理手続きも同様。")}
      </CardContent></Card>
      <Dialog open={!!dialog} onOpenChange={() => setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tt("Submit data request", "データリクエストを送信")}</DialogTitle><DialogDescription>{tt("We verify identity via your signed-in session. SLA: 30 days.", "ログインセッションで本人確認します。SLA: 30日。")}</DialogDescription></DialogHeader>
          <Textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} placeholder={tt("Optional details…", "詳細（任意）…")} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDialog(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button disabled={busy} onClick={() => submitDsar(dialog!)}><Send className="w-4 h-4 mr-1" />{tt("Submit request", "送信")}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Developer portal ────────────────────────────────────────────
export function DeveloperPage() {
  const tt = useT()
  const { session, setView, locale } = useApp()
  const [tab, setTab] = useState("keys")
  const [keys, setKeys] = useState<any[]>([])
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyName, setKeyName] = useState("")
  const [busy, setBusy] = useState(false)
  const [apps, setApps] = useState<any[]>([])
  const [hooks, setHooks] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [delivs, setDelivs] = useState<any[]>([])
  const load = () => {
    api<any>("/api/dev/keys").then(r => setKeys(r?.data?.items || []))
    api<any>("/api/dev/apps").then(r => setApps(r?.data?.items || []))
    api<any>("/api/dev/webhooks").then(r => { setHooks(r?.data?.endpoints || []); setDelivs(r?.data?.deliveries || []) })
    api<any>("/api/dev/logs").then(r => setLogs(r?.data?.items || []))
  }
  useEffect(() => { if (session) load() }, [session])
  const createKey = async () => {
    setBusy(true)
    const r = await api<any>("/api/dev/keys", { method: "POST", body: JSON.stringify({ name: keyName || "My key", scopes: ["read"] }) })
    setBusy(false)
    if (r.ok) { setNewKey(r.data.key); setKeyName(""); load() } else toast.error(r.error?.message || "Failed")
  }
  if (!session) return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-extrabold">{tr(locale, "Tengasell Developer Platform", "Tengasell開発者プラットフォーム")}</h1>
      <Card><CardContent className="space-y-3 text-sm py-4">
        <p>{tt("Build on the Tengasell marketplace with a governed read API:", "ガバナンスされた読み取りAPIでTengasellを活用：")}</p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>GET /api/v1/listings — search auctions (scopes: read)</li>
          <li>GET /api/v1/listings/{"{id}"} — listing detail with anonymised bids</li>
          <li>Signed webhooks: bid.placed, order.paid, order.shipped, dispute.opened, auction.won</li>
          <li>Bearer keys with per-key rate limits; request IDs on every call; 429 + Retry-After when throttled</li>
        </ul>
        <p className="text-xs text-muted-foreground">{tt("Terms: ", "規約: ")}<button className="text-primary underline" onClick={() => setView({ name: "policy", key: "api-terms" })}>{tt("API terms", "API利用規約")}</button></p>
        <Button onClick={() => setView({ name: "auth" })}>{tt("Sign in to get a key", "キーを取得するにはログイン")}</Button>
      </CardContent></Card>
    </div>
  )
  const TABS: [string, string, string][] = [["keys", "API keys", "APIキー"], ["apps", "Apps", "アプリ"], ["webhooks", "Webhooks", "Webhook"], ["logs", "Request logs", "リクエストログ"], ["docs", "Docs", "ドキュメント"]]
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-extrabold flex items-center gap-2"><Key className="w-6 h-6 text-primary" />{tr(locale, "Developer console", "開発者コンソール")}</h1>
      <div className="flex gap-2 flex-wrap" role="tablist">{TABS.map(([k, en, ja]) => (
        <Button key={k} size="sm" role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "outline"} className="h-9" onClick={() => setTab(k)}>{tt(en, ja)}</Button>
      ))}</div>
      {tab === "keys" && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{tt("API keys (Bearer)", "APIキー（Bearer）")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2"><Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder={tt("Key name…", "キー名…")} className="h-10 max-w-xs" />
              <Button onClick={createKey} disabled={busy} className="h-10"><Plus className="w-4 h-4" />{tt("Create key", "作成")}</Button></div>
            {newKey && (
              <div className="border border-[#b8860b] bg-[#fbf4dd] rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-[#705a10]">{tt("Copy your key now — shown only once:", "今すぐコピーしてください（再表示されません）：")}</p>
                <div className="flex items-center gap-2"><code className="text-xs bg-white px-2 py-1 rounded border flex-1 overflow-x-auto">{newKey}</code>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newKey); toast.success(tt("Copied", "コピーしました")) }}><Copy className="w-3.5 h-3.5" /></Button></div>
              </div>
            )}
            <div className="divide-y border rounded-lg">
              {keys.map(k => (
                <div key={k.id} className="flex items-center justify-between px-3 py-2.5">
                  <div><p className="text-sm font-medium">{k.name}</p><p className="text-xs text-muted-foreground font-mono">{k.prefix}… · scopes: {JSON.parse(k.scopes || "[]").join(",")}</p></div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{k.lastUsedAt ? fmtDate(k.lastUsedAt, true) : tt("never used", "未使用")}</span>
                    {k.revokedAt ? <Badge variant="destructive">{tt("revoked", "失効")}</Badge> :
                      <Button size="sm" variant="outline" className="h-8 text-destructive border-destructive/40" onClick={async () => { await api(`/api/dev/keys?id=${k.id}`, { method: "DELETE" }); load(); toast(tt("Key revoked", "キーを失効しました")) }}><Trash2 className="w-3.5 h-3.5" /></Button>}
                  </div>
                </div>
              ))}
              {keys.length === 0 && <p className="text-sm text-muted-foreground p-3">{tt("No keys yet.", "キーはまだありません。")}</p>}
            </div>
          </CardContent></Card>
      )}
      {tab === "apps" && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{tt("Applications (OAuth clients)", "アプリケーション（OAuthクライアント）")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">{tt("Register apps to integrate with Tengasell. Sandbox on by default.", "Tengasellと連携するアプリを登録。既定でサンドボックス。")}</p>
            <Button size="sm" onClick={async () => { const r = await api<any>("/api/dev/apps", { method: "POST", body: JSON.stringify({ name: "App " + (apps.length + 1) }) }); if (r.ok) { toast.success(`clientId: ${r.data.clientId} — secret shown once: ${r.data.clientSecret}`); load() } }}><Plus className="w-4 h-4" />{tt("Register app", "アプリを登録")}</Button>
            <div className="divide-y border rounded-lg">{apps.map(a => (
              <div key={a.id} className="px-3 py-2.5 flex items-center justify-between">
                <div><p className="text-sm font-medium">{a.name}</p><p className="text-xs text-muted-foreground font-mono">{a.clientId}</p></div>
                <Badge variant={a.sandbox ? "outline" : "default"}>{a.sandbox ? "sandbox" : "live"}</Badge>
              </div>))}
              {apps.length === 0 && <p className="text-sm text-muted-foreground p-3">{tt("No apps yet.", "アプリはまだありません。")}</p>}</div>
          </CardContent></Card>
      )}
      {tab === "webhooks" && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Webhook className="w-4 h-4 text-primary" />{tt("Webhook endpoints", "Webhookエンドポイント")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button size="sm" onClick={async () => { const r = await api<any>("/api/dev/webhooks", { method: "POST", body: JSON.stringify({ url: "https://example.mock/hook", events: ["bid.placed", "order.paid"] }) }); if (r.ok) { toast.success(`Secret (once): ${r.data.secret}`); load() } }}><Plus className="w-4 h-4" />{tt("Add endpoint", "追加")}</Button>
            <div className="divide-y border rounded-lg">{hooks.map(h => (
              <div key={h.id} className="px-3 py-2.5 flex items-center justify-between">
                <div className="min-w-0"><p className="text-xs font-mono truncate">{h.url}</p><p className="text-[11px] text-muted-foreground">{JSON.parse(h.events || "[]").join(" · ")}</p></div>
                <div className="flex items-center gap-2"><Badge variant={h.status === "ACTIVE" ? "default" : "destructive"}>{h.status}</Badge>
                  <Button size="sm" variant="outline" className="h-8" onClick={async () => { await api(`/api/dev/webhooks?id=${h.id}`, { method: "DELETE" }); load() }}><Trash2 className="w-3.5 h-3.5" /></Button></div>
              </div>))}
              {hooks.length === 0 && <p className="text-sm text-muted-foreground p-3">{tt("No endpoints yet.", "エンドポイントはまだありません。")}</p>}</div>
            <SectionTitle>{tt("Recent deliveries", "最近の配信")}</SectionTitle>
            <div className="divide-y border rounded-lg text-xs max-h-64 overflow-y-auto tgs-scroll">{delivs.map(d => (
              <div key={d.id} className="px-3 py-2 flex items-center justify-between">
                <span className="font-mono">{d.event}</span>
                <span className="flex items-center gap-2"><Badge variant={d.status === "DELIVERED" ? "default" : d.status === "DEAD" ? "destructive" : "outline"}>{d.status}</Badge>
                  <span className="text-muted-foreground">{d.attempts}× {d.responseCode ?? ""}</span></span>
              </div>))}</div>
            <p className="text-[11px] text-muted-foreground">{tt("Retries: exponential backoff, 5 attempts → dead-letter (DLQ). HMAC-SHA256 signature header x-tgs-signature.", "再試行: 指数バックオフ5回→DLQ。署名: HMAC-SHA256 x-tgs-signature。")}</p>
          </CardContent></Card>
      )}
      {tab === "logs" && (
        <Card><CardContent className="py-3">
          <div className="divide-y border rounded-lg text-xs max-h-96 overflow-y-auto tgs-scroll">
            {logs.map(l => (
              <div key={l.id} className="px-3 py-2 flex items-center justify-between">
                <span className="font-mono">{l.method} {l.route}</span>
                <span className="flex items-center gap-2"><Badge variant={l.status < 400 ? "default" : "destructive"}>{l.status}</Badge><span className="text-muted-foreground">{l.latencyMs}ms</span></span>
              </div>))}
            {logs.length === 0 && <p className="text-sm text-muted-foreground p-3">{tt("No API calls logged yet — call /api/v1/listings with your key.", "まだありません。/api/v1/listings をキーで呼び出してください。")}</p>}</div>
        </CardContent></Card>
      )}
      {tab === "docs" && (
        <Card><CardContent className="space-y-3 py-4 text-sm">
          <p className="font-semibold">{tt("Quick start", "クイックスタート")}</p>
          <pre className="text-xs bg-secondary rounded-lg p-3 overflow-x-auto">curl -H "Authorization: Bearer tga_live_xxx.yyy" {"\\"}
{"\n"}  http://localhost:3000/api/v1/listings?q=phone</pre>
          <p className="font-semibold mt-2">{tt("Endpoints", "エンドポイント")}</p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li><code>GET /api/v1/listings</code> — params: q, category, type, sort, page, limit (≤100)</li>
            <li><code>GET /api/v1/listings/{"{id}"}</code> — detail + top bids</li>
          </ul>
          <p className="font-semibold mt-2">{tt("Conventions", "規約")}</p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li>{tt("Envelope: {ok, data, requestId} · errors {ok:false,error:{message,code}}", "エンベロープ: {ok, data, requestId} · エラー {ok:false,error:{message,code}}")}</li>
            <li>{tt("429 with Retry-After when over your per-key rate limit", "レート制限超過時は429 + Retry-After")}</li>
            <li><a className="text-primary underline" href="/api/openapi.json" target="_blank" rel="noreferrer">OpenAPI 3.1 JSON</a></li>
          </ul>
        </CardContent></Card>
      )}
    </div>
  )
}

// ── MSCS certification console (rendered inside admin) ───────────
type MscsControlRow = {
  id: string; domain: string; domainName: string; name: string; floor: string; criticality: string
  applicability: string; applicabilityNote: string | null; status: string; statusNote: string | null
  ownerRole: string | null; evidenceRefs: string[]; openFindings: number
}

export function MscsAdminSection() {
  const tt = useT()
  const { session, locale } = useApp()
  const [summary, setSummary] = useState<any>(null)
  const [rows, setRows] = useState<MscsControlRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [fDomain, setFDomain] = useState("ALL")
  const [fApp, setFApp] = useState("ALL")
  const [fStatus, setFStatus] = useState("ALL")
  const [fCrit, setFCrit] = useState("ALL")
  const [search, setSearch] = useState("")
  const [detail, setDetail] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const canEdit = session && ["COMPLIANCE", "ADMIN"].includes(session.role)
  const isAdmin = session?.role === "ADMIN"

  const loadSummary = () => api<any>("/api/mscs/summary").then(r => setSummary(r?.data))
  const loadRows = () => {
    const p = new URLSearchParams({ page: String(page), limit: "50" })
    if (fDomain !== "ALL") p.set("domain", fDomain)
    if (fApp !== "ALL") p.set("applicability", fApp)
    if (fStatus !== "ALL") p.set("status", fStatus)
    if (fCrit !== "ALL") p.set("criticality", fCrit)
    if (search.trim()) p.set("search", search.trim())
    api<any>(`/api/mscs/controls?${p}`).then(r => { setRows(r?.data?.items || []); setTotal(r?.data?.total || 0) })
  }
  useEffect(() => { loadSummary() }, [])
  useEffect(() => { const t = setTimeout(loadRows, 200); return () => clearTimeout(t) }, [page, fDomain, fApp, fStatus, fCrit, search])

  const setStatus = async (id: string, status: string, statusNote: string) => {
    setBusy(true)
    const r = await api(`/api/mscs/controls/${id}`, { method: "PATCH", body: JSON.stringify({ status, statusNote }) })
    setBusy(false)
    if (r.ok) { toast.success(`${id} → ${status}`); loadRows(); loadSummary() } else toast.error(r.error?.message || "Update failed")
  }
  const runCertify = async () => {
    setBusy(true)
    const r = await api<any>("/api/mscs/certify", { method: "POST" })
    setBusy(false)
    if (r.ok) {
      const c = r.data.certification
      toast.success(`${c.disposition} — score ${r.data.score}%`, { duration: 8000 })
      loadSummary()
    } else toast.error(r.error?.message || "Certification failed")
  }
  const s = summary
  const cert = s?.certification
  const gates: [string, boolean, string, string][] = [
    ["A", s?.gates?.A ?? false, "All required C3/C4 controls evidenced (≥S60)", "必須C3/C4コントロールが全てS60以上"],
    ["B", s?.gates?.B ?? false, "No unapproved high-risk exceptions", "未承認の高リスク例外なし"],
    ["C", s?.gates?.C ?? false, "Runtime evidence (E3×20, reconciliation balanced, restore test PASS)", "実行時証拠（E3×20、突合一致、復元テスト合格）"],
    ["D", s?.gates?.D ?? false, "M2 operations: backups, support, incidents, reconciliation", "M2運用: バックアップ・サポート・障害・突合"],
  ]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold flex items-center gap-2"><Award className="w-5 h-5 text-[#b8860b]" />{tr(locale, "MSCS 1.0 Registry & Certification", "MSCS 1.0 レジストリと認証")}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {tr(locale, "11-11 Tech Master Software Capability Standard — 609 controls, line by line. Profile: ", "11-11 Tech MSCS — 609コントロールを一行ずつ。プロファイル: ")}
            <Badge variant="secondary" className="mx-1">{s?.assessment?.profile || "M2"}</Badge>
            · {tr(locale, "Declared authority: sandbox", "宣言された環境: サンドボックス")}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={runCertify} disabled={busy} className="tgs-gradient-gold text-[#3d2f05] font-bold hover:opacity-95">
            <ClipboardCheck className="w-4 h-4" />{tr(locale, "Run certification gate", "認証ゲートを実行")}
          </Button>
        )}
      </div>

      {/* Score + gates + disposition */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">{tr(locale, "Weighted readiness", "加重準備度")}</p>
          <p className="text-3xl font-extrabold text-primary">{s?.scorePct ?? "—"}<span className="text-base">%</span></p>
          <p className="text-[11px] text-muted-foreground">{s?.readyCount ?? 0}/{s?.applicableCount ?? 0} {tr(locale, "applicable controls ≥ S60", "適用コントロールがS60以上")}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">{tr(locale, "Disposition", "判定")}</p>
          {cert ? (
            <Badge className={cn("text-sm mt-2", cert.disposition === "PASS" ? "bg-emerald-600" : cert.disposition === "PASS_WITH_CONDITIONS" ? "bg-[#b8860b]" : "bg-destructive")}>{cert.disposition}</Badge>
          ) : <p className="text-sm text-muted-foreground mt-2">{tr(locale, "Not certified yet", "未認証")}</p>}
          <p className="text-[11px] text-muted-foreground mt-1">{cert ? `${cert.id} · review ${fmtDate(cert.reviewAt)}` : tr(locale, "Run the gate when ready", "準備ができたらゲートを実行")}</p>
        </CardContent></Card>
        <Card className="sm:col-span-2"><CardContent className="py-4 grid grid-cols-2 gap-2">
          {gates.map(([g, pass, en, ja]) => (
            <div key={g} className={cn("rounded-lg border px-2.5 py-2 text-xs", pass ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950" : "border-destructive/40 bg-red-50 dark:bg-red-950")} title={tr(locale, en, ja)}>
              <span className="font-bold">{tr(locale, `Gate ${g}`, `ゲート ${g}`)}: </span>{pass
                ? <span className="text-emerald-700 font-semibold">{tr(locale, "pass", "合格")}</span>
                : <span className="text-destructive font-semibold">{tr(locale, "fail", "不合格")}</span>}
            </div>
          ))}
        </CardContent></Card>
      </div>

      {cert && (cert.conditions?.length > 0 || cert.riskExceptions?.length > 0) && (
        <Card className="border-[#b8860b]"><CardContent className="py-3 text-xs space-y-1">
          <p className="font-semibold">{tr(locale, "Open conditions", "未了の条件")}</p>
          {cert.conditions?.map((c: string, i: number) => <p key={i} className="text-muted-foreground">• {c}</p>)}
          {cert.riskExceptions?.length > 0 && <p className="text-muted-foreground">{tr(locale, "Approved risk exceptions: ", "承認済みリスク例外: ")}{cert.riskExceptions.join(", ")}</p>}
        </CardContent></Card>
      )}

      {/* Domain grid */}
      {s?.domains && (
        <section>
          <SectionTitle>{tr(locale, "37 domains", "37ドメイン")}</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {s.domains.map((d: any) => (
              <button key={d.domain} onClick={() => { setFDomain(d.domain); setPage(1) }}
                className={cn("border rounded-lg p-2 text-left hover:shadow-sm transition-shadow", fDomain === d.domain ? "border-primary bg-secondary" : "")}
                aria-label={`${d.domain}: ${d.scorePct}%`}>
                <p className="text-[11px] font-bold text-primary">{d.domain}</p>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-1"><div className={cn("h-full", d.scorePct >= 90 ? "bg-emerald-500" : d.scorePct >= 50 ? "bg-[#e5b93b]" : "bg-destructive")} style={{ width: `${Math.max(d.scorePct, 2)}%` }} /></div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{d.ready}/{d.applicable}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Control worksheet */}
      <section>
        <SectionTitle action={<span className="text-xs text-muted-foreground">{total} {tr(locale, "controls", "コントロール")}</span>}>
          {tr(locale, "Line-by-line control worksheet", "コントロールワークシート")}
        </SectionTitle>
        <div className="flex flex-wrap gap-2 mb-2 items-center">
          <Select value={fApp} onValueChange={(v) => { setFApp(v); setPage(1) }}>
            <SelectTrigger className="w-32 h-9" aria-label="Applicability"><SelectValue /></SelectTrigger>
            <SelectContent>{["ALL", "R", "C", "NA", "F"].map(v => <SelectItem key={v} value={v}>{v === "ALL" ? tr(locale, "All applic.", "全適用") : v}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={fStatus} onValueChange={(v) => { setFStatus(v); setPage(1) }}>
            <SelectTrigger className="w-32 h-9" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>{["ALL", "S00", "S10", "S20", "S30", "S40", "S50", "S60", "S70", "S80", "S90"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={fCrit} onValueChange={(v) => { setFCrit(v); setPage(1) }}>
            <SelectTrigger className="w-28 h-9" aria-label="Criticality"><SelectValue /></SelectTrigger>
            <SelectContent>{["ALL", "C3", "C4", "C2", "C1", "C0"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex-1 min-w-40"><Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder={tr(locale, "Search ID or name…", "ID・名称で検索…")} className="h-9" /></div>
          {fDomain !== "ALL" && <Button size="sm" variant="outline" className="h-9" onClick={() => setFDomain("ALL")}>{fDomain} ✕</Button>}
        </div>
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary sticky top-0"><tr>
              <th className="p-2 text-left">ID</th><th className="p-2 text-left">{tr(locale, "Capability", "ケイパビリティ")}</th>
              <th className="p-2 text-left">{tr(locale, "Floor", "下限")}</th><th className="p-2 text-left">Crit.</th>
              <th className="p-2 text-left">{tr(locale, "Appl.", "適用")}</th><th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Owner</th><th className="p-2 text-left">EV</th><th className="p-2 text-left">Findings</th><th />
            </tr></thead>
            <tbody className="divide-y">
              {rows.map(c => (
                <tr key={c.id} className={cn("hover:bg-secondary/50", (c.criticality === "C3" || c.criticality === "C4") && (c.applicability === "R" || c.applicability === "F" || c.applicability === "C") && !c.status.startsWith("S6") && !c.status.startsWith("S7") && !c.status.startsWith("S8") && !c.status.startsWith("S9") && c.applicability !== "F" ? "bg-red-50 dark:bg-red-950/40" : "")}>
                  <td className="p-2 font-mono font-semibold">{c.id}</td>
                  <td className="p-2 max-w-64"><p className="truncate" title={c.name}>{c.name}</p></td>
                  <td className="p-2">{c.floor}</td>
                  <td className="p-2"><Badge variant={c.criticality === "C4" || c.criticality === "C3" ? "destructive" : "secondary"} className="text-[10px]">{c.criticality}</Badge></td>
                  <td className="p-2"><Badge variant={c.applicability === "R" ? "default" : c.applicability === "NA" ? "outline" : "secondary"} className="text-[10px]">{c.applicability}</Badge></td>
                  <td className="p-2">
                    {canEdit ? (
                      <Select value={c.status} onValueChange={(v) => setStatus(c.id, v, c.statusNote || "")} disabled={busy}>
                        <SelectTrigger className="h-7 w-20 text-[11px]" aria-label={`Status of ${c.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{["S00", "S10", "S20", "S30", "S40", "S50", "S60", "S70", "S80", "S90"].map(v => <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : <span className="font-mono">{c.status}</span>}
                  </td>
                  <td className="p-2 text-muted-foreground max-w-28 truncate" title={c.ownerRole || ""}>{c.ownerRole || "—"}</td>
                  <td className="p-2">{c.evidenceRefs?.length || 0}</td>
                  <td className="p-2">{c.openFindings > 0 ? <Badge variant="destructive" className="text-[10px]">{c.openFindings}</Badge> : "0"}</td>
                  <td className="p-1"><Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => api<any>(`/api/mscs/controls/${c.id}`).then(r => setDetail({ ...r.data, control: c }))} aria-label={`Open ${c.id}`}><Eye className="w-3.5 h-3.5" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs">
          <Button size="sm" variant="outline" className="h-9" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span>{tr(locale, "Page", "ページ")} {page} / {Math.max(Math.ceil(total / 50), 1)}</span>
          <Button size="sm" variant="outline" className="h-9" disabled={page >= Math.ceil(total / 50)} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </section>

      {/* Control detail drawer */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto tgs-scroll">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap"><span className="font-mono">{detail.control?.id}</span><span>{detail.control?.name}</span></DialogTitle>
                <DialogDescription>{detail.control?.domainName} · {tr(locale, "Floor", "下限")} {detail.control?.floor} · {detail.control?.criticality} · {tr(locale, "Applicability", "適用")}: {detail.control?.applicability}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <p className="text-muted-foreground">{detail.control?.applicabilityNote}</p>
                <p className="text-muted-foreground">{detail.control?.statusNote}</p>
                <div><p className="font-semibold">{tr(locale, "Evidence", "証拠")} ({detail.evidence?.length || 0})</p>
                  <div className="divide-y border rounded-lg mt-1">
                    {(detail.evidence || []).map((e: any) => (
                      <div key={e.id} className="px-2.5 py-2">
                        <p><Badge variant="secondary" className="text-[10px] mr-1">{e.evidenceClass}</Badge><span className="font-mono">{e.id}</span> — {e.description}</p>
                        <p className="text-muted-foreground mt-0.5">{tr(locale, "Observed", "観測")}: {e.observed} · {tr(locale, "Source", "ソース")}: {e.source}</p>
                      </div>
                    ))}
                    {(detail.evidence || []).length === 0 && <p className="px-2.5 py-2 text-muted-foreground">{tr(locale, "No evidence attached yet.", "証拠はまだありません。")}</p>}
                  </div>
                </div>
                <div><p className="font-semibold">{tr(locale, "Findings", "所見")} ({detail.findings?.length || 0})</p>
                  <div className="divide-y border rounded-lg mt-1">
                    {(detail.findings || []).map((f: any) => (
                      <div key={f.id} className="px-2.5 py-2 flex items-center justify-between gap-2">
                        <p><Badge variant="outline" className="text-[10px] mr-1">{f.code}</Badge>{f.note}</p>
                        <Badge variant={f.status === "OPEN" ? "destructive" : "secondary"} className="text-[10px]">{f.status}</Badge>
                      </div>
                    ))}
                    {(detail.findings || []).length === 0 && <p className="px-2.5 py-2 text-muted-foreground">{tr(locale, "No findings.", "所見なし。")}</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
