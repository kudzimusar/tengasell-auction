"use client"
// ── CommsPage: notifications, prefs matrix, consent, sandbox inbox (Agent B) ──
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Empty, StatusBadge, fmtDate } from "../../ui"
import {
  Bell, Gavel, Trophy, Package, MessageSquare, Megaphone, AlertTriangle, CheckCheck, Mail,
  ShieldCheck, Eye, MousePointerClick, Link2, Inbox, Heart, Info,
} from "lucide-react"
import { FeedbackToaster, OutboxItem, PrefsMatrix, SandboxBadge, SectionCard, ConsentItem } from "./shared"

type NotifItem = {
  id: string; type: string; params: string; readAt: string | null; createdAt: string
}

const NOTIF_EVENTS = ["OUTBID", "WIN", "ORDER", "SHIP", "MSG", "MARKETING", "DIGEST"] as const

export function CommsPage() {
  const { locale, session, sessionLoaded, setView, setUnread } = useApp()
  const staff = !!session && ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"].includes(session.role)

  const [notifs, setNotifs] = useState<NotifItem[] | null>(null)
  const [prefs, setPrefs] = useState<PrefsMatrix | null>(null)
  const [consents, setConsents] = useState<ConsentItem[] | null>(null)
  const [inbox, setInbox] = useState<OutboxItem[] | null>(null)
  const [inboxAll, setInboxAll] = useState(false)
  const [inboxKind, setInboxKind] = useState<string>("ALL")
  const [openEmail, setOpenEmail] = useState<(OutboxItem & { body: string }) | null>(null)

  const loadNotifs = useCallback(async () => {
    const res = await api<{ items: NotifItem[]; unread: number }>("/api/notifications?limit=50")
    if (res.ok && res.data) {
      setNotifs(res.data.items)
      setUnread(res.data.unread)
    } else setNotifs([])
  }, [setUnread])

  const loadPrefs = useCallback(async () => {
    const res = await api<{ matrix: PrefsMatrix }>("/api/comms/prefs")
    if (res.ok && res.data) setPrefs(res.data.matrix)
  }, [])

  const loadConsents = useCallback(async () => {
    const res = await api<{ items: ConsentItem[] }>("/api/privacy/consents")
    if (res.ok && res.data) setConsents(res.data.items)
  }, [])

  const loadInbox = useCallback(async (all: boolean, kind: string) => {
    const p = new URLSearchParams()
    if (all && staff) p.set("mine", "0")
    if (kind === "TRANSACTIONAL" || kind === "MARKETING") p.set("kind", kind)
    const res = await api<{ items: OutboxItem[] }>(`/api/comms/mock-inbox${p.toString() ? `?${p}` : ""}`)
    if (res.ok && res.data) setInbox(res.data.items)
  }, [staff])

  useEffect(() => {
    if (!sessionLoaded) return
    void Promise.resolve().then(() => {
      loadNotifs(); loadPrefs(); loadConsents(); loadInbox(inboxAll, inboxKind)
    })
  }, [sessionLoaded, inboxAll, inboxKind, loadNotifs, loadPrefs, loadConsents, loadInbox])

  async function markAllRead() {
    const res = await api("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) })
    if (res.ok) {
      setNotifs(prev => prev?.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null)
      setUnread(0)
      toast.success(tr(locale, "All notifications marked as read", "すべて既読にしました"))
    } else toast.error(res.error?.message || "Failed")
  }

  async function openNotif(n: NotifItem) {
    // deep-link + mark read
    let params: Record<string, unknown> = {}
    try { params = JSON.parse(n.params || "{}") } catch { /* ignore */ }
    const markRead = async () => {
      await api("/api/notifications", { method: "POST", body: JSON.stringify({ ids: [n.id] }) })
      setNotifs(prev => prev?.map(x => x.id === n.id ? { ...x, readAt: x.readAt ?? new Date().toISOString() } : x) ?? null)
    }
    await markRead()
    switch (n.type) {
      case "OUTBID":
        if (typeof params.listingId === "string") setView({ name: "item", id: params.listingId })
        else setView({ name: "watchlist" })
        break
      case "WIN":
      case "ORDER":
      case "SHIP":
      case "DISPUTE":
      case "DISPUTE_OPENED":
        setView({ name: "orders" })
        break
      case "MSG":
        setView({ name: "messages" })
        break
      case "DSAR_NEW":
      case "PRIVACY_EXPORT":
      case "ACCOUNT_DELETE":
      case "PRIVACY_DELETE":
        setView({ name: "account" })
        break
      default:
        setView({ name: "home" })
    }
  }

  async function togglePref(event: string, channel: string, next: boolean) {
    if (!prefs) return
    setPrefs({ ...prefs, [event]: { ...prefs[event], [channel]: next } }) // optimistic
    const res = await api("/api/comms/prefs", {
      method: "PUT",
      body: JSON.stringify({ event, channel, enabled: next }),
    })
    if (res.ok) {
      toast.success(next
        ? tr(locale, `Enabled ${event} · ${channel}`, `${event} · ${channel} をON`)
        : tr(locale, `Disabled ${event} · ${channel}`, `${event} · ${channel} をOFF`))
      if (event === "MARKETING" && channel === "EMAIL") {
        loadConsents() // consent + suppression side effects
      }
    } else {
      setPrefs({ ...prefs, [event]: { ...prefs[event], [channel]: !next } }) // revert
      toast.error(res.error?.message || "Failed to update preference")
    }
  }

  const marketingConsent = consents?.find(c => c.purpose === "MARKETING")
  const marketingGranted = marketingConsent?.granted ?? false

  async function toggleMarketingConsent(granted: boolean) {
    const res = await api("/api/privacy/consents", {
      method: "PUT",
      body: JSON.stringify({ purpose: "MARKETING", granted }),
    })
    if (res.ok) {
      toast.success(granted
        ? tr(locale, "Marketing emails enabled", "マーケティングメールをON")
        : tr(locale, "Marketing consent withdrawn — you're added to the suppression list", "同意を撤回 — 抑制リストに追加しました"))
      loadConsents(); loadPrefs()
    } else toast.error(res.error?.message || "Failed")
  }

  async function openOutbox(id: string) {
    const res = await api<{ email: OutboxItem & { body: string } }>(`/api/comms/mock-inbox?open=${id}`)
    if (res.ok && res.data) {
      setOpenEmail(res.data.email)
      loadInbox(inboxAll, inboxKind)
    } else toast.error(res.error?.message || "Could not open the email")
  }

  if (sessionLoaded && !session) {
    return (
      <div className="max-w-md mx-auto">
        <FeedbackToaster />
        <Empty icon="🔔" title={tr(locale, "Sign in to manage notifications", "通知を管理するにはログイン")}
          hint={tr(locale, "Your notification centre, email preferences and sandbox inbox live here.", "通知センター・メール設定・サンドボックス受信箱。")}>
          <Button className="mt-4 h-11 px-6" onClick={() => setView({ name: "auth" })}>
            {tr(locale, "Sign in", "ログイン")}
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <FeedbackToaster />
      <div>
        <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
          <Bell className="w-5 h-5 text-primary" aria-hidden />
          {tr(locale, "Notification centre", "通知センター")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {tr(locale, "In-app notifications, email preferences and the sandbox delivery viewer.", "アプリ内通知・メール設定・サンドボックス配信ビューア。")}
        </p>
      </div>

      {/* (1) Notifications */}
      <SectionCard
        title={tr(locale, "Notifications", "通知")}
        subtitle={tr(locale, "Click an item to jump to where it matters.", "クリックで関連画面へ移動。")}
        icon={<Bell className="w-4 h-4" />}
        action={
          notifs && notifs.length > 0 ? (
            <Button variant="secondary" size="sm" className="h-10 font-medium" onClick={markAllRead}>
              <CheckCheck className="w-4 h-4 mr-1" />{tr(locale, "Mark all read", "すべて既読")}
            </Button>
          ) : undefined
        }
      >
        {notifs === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : notifs.length === 0 ? (
          <Empty icon="🔔" title={tr(locale, "No notifications yet", "通知はまだありません")}
            hint={tr(locale, "Bids, wins, orders and messages will appear here.", "入札・落札・注文・メッセージが届きます。")} />
        ) : (
          <ul className="divide-y max-h-96 overflow-y-auto tgs-scroll" role="list">
            {notifs.map((n) => {
              const icon = notifIcon(n.type)
              const text = notifText(locale, n.type, n.params)
              return (
                <li key={n.id}>
                  <button
                    onClick={() => openNotif(n)}
                    className={cn(
                      "w-full text-left flex items-center gap-3 px-1 py-2.5 min-h-11 hover:bg-secondary/60 transition-colors",
                      !n.readAt && "bg-primary/5"
                    )}
                    aria-label={text}
                  >
                    <span className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", n.readAt ? "bg-secondary text-muted-foreground" : "bg-primary/15 text-primary")} aria-hidden>
                      {icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{text}</span>
                      <span className="block text-[11px] text-muted-foreground">{fmtDate(n.createdAt, true)}</span>
                    </span>
                    {!n.readAt && <span className="w-2 h-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {/* (2) Preferences matrix */}
      <SectionCard
        title={tr(locale, "Notification preferences", "通知設定")}
        subtitle={tr(locale, "Choose how each event reaches you. Transactional order notices are recommended to stay on.", "イベントごとの通知方法を選択。取引通知はON推奨。")}
        icon={<Megaphone className="w-4 h-4" />}
      >
        {prefs === null ? (
          <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label="Notification preference matrix">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{tr(locale, "Event", "イベント")}</TableHead>
                  <TableHead className="text-xs text-center w-24">Email</TableHead>
                  <TableHead className="text-xs text-center w-24">{tr(locale, "In-app", "アプリ内")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {NOTIF_EVENTS.map(ev => (
                  <TableRow key={ev}>
                    <TableCell className="text-xs font-medium py-2.5">
                      {notifEventLabel(locale, ev)}
                      {ev === "MARKETING" && (
                        <Badge variant="outline" className="ml-1.5 text-[9px]">{tr(locale, "opt-in", "オプトイン")}</Badge>
                      )}
                    </TableCell>
                    {(["EMAIL", "INAPP"] as const).map(ch => (
                      <TableCell key={ch} className="py-2.5 text-center">
                        <Switch
                          checked={prefs[ev]?.[ch] ?? false}
                          onCheckedChange={(v) => togglePref(ev, ch, v)}
                          aria-label={`${ev} ${ch}`}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* (3) Marketing consent */}
      <SectionCard
        title={tr(locale, "Marketing consent", "マーケティング同意")}
        icon={<Mail className="w-4 h-4" />}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="text-xs leading-relaxed">
            <label htmlFor="marketing-consent" className="font-medium text-sm">
              {tr(locale, "I agree to receive marketing emails.", "マーケティングメールの受信に同意します。")}
            </label>
            <p className="text-muted-foreground mt-1">
              {tr(locale, "Transactional messages (orders, bids, account) are always sent — they are not marketing.", "取引メッセージ（注文・入札・アカウント）は常に送信され、マーケティングには含まれません。")}
            </p>
            <button
              className="text-primary underline underline-offset-2 mt-1"
              onClick={() => setView({ name: "policy", key: "privacy" })}
            >
              {tr(locale, "Read the privacy policy", "プライバシーポリシーを読む")}
            </button>
          </div>
          {consents === null ? <Skeleton className="h-6 w-11" /> : (
            <Switch
              id="marketing-consent"
              checked={marketingGranted}
              onCheckedChange={toggleMarketingConsent}
              aria-label="Marketing consent"
              className="shrink-0"
            />
          )}
        </div>
        {consents !== null && marketingConsent && (
          <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
            <Info className="w-3 h-3" aria-hidden />
            {marketingGranted
              ? tr(locale, `Consented ${fmtDate(marketingConsent.grantedAt)}`, `同意日: ${fmtDate(marketingConsent.grantedAt)}`)
              : tr(locale, `Withdrawn ${fmtDate(marketingConsent.withdrawnAt)} — suppression list active`, `撤回日: ${fmtDate(marketingConsent.withdrawnAt)} — 抑制リスト有効`)}
          </p>
        )}
      </SectionCard>

      {/* (4) Sandbox mock inbox */}
      <SectionCard
        title={tr(locale, "Mock email inbox", "モック受信箱")}
        subtitle={tr(locale, "What the (mock) email provider delivered — opens and clicks are tracked.", "モック配信プロバイダの送信状況 — 開封・クリックを追跡。")}
        icon={<Inbox className="w-4 h-4" />}
        action={<SandboxBadge />}
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {staff && (
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" aria-label="Show all users' emails">
              <Switch checked={inboxAll} onCheckedChange={setInboxAll} />
              {tr(locale, "All users", "全ユーザー")}
            </label>
          )}
          <Select value={inboxKind} onValueChange={setInboxKind}>
            <SelectTrigger className="h-9 w-40 text-xs" aria-label="Kind filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{tr(locale, "All kinds", "すべて")}</SelectItem>
              <SelectItem value="TRANSACTIONAL">Transactional</SelectItem>
              <SelectItem value="MARKETING">Marketing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {inbox === null ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : inbox.length === 0 ? (
          <Empty icon="📭" title={tr(locale, "No emails yet", "メールはまだありません")}
            hint={tr(locale, "Trigger an order or send a message — the mock provider queues the email here.", "注文やメッセージで、ここにメールが届きます。")} />
        ) : (
          <ul className="divide-y max-h-96 overflow-y-auto tgs-scroll" role="list">
            {inbox.map(m => (
              <li key={m.id}>
                <button
                  onClick={() => openOutbox(m.id)}
                  className="w-full text-left flex items-center gap-3 px-1 py-2.5 min-h-11 hover:bg-secondary/60 transition-colors"
                >
                  <StatusBadge status={m.status} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{m.subject}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      → {m.toEmail} · {m.kind === "MARKETING" ? tr(locale, "Marketing", "マーケティング") : tr(locale, "Transactional", "取引")}
                      {m.sentAt ? ` · ${fmtDate(m.sentAt, true)}` : ""}
                    </span>
                  </span>
                  {m.unsubToken && <Link2 className="w-3.5 h-3.5 text-[#b8860b] shrink-0" aria-label="Has unsubscribe link" />}
                  {m.openedAt && <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-label="Opened" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* email open dialog */}
      <Dialog open={!!openEmail} onOpenChange={(v) => !v && setOpenEmail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base pr-6">{openEmail?.subject}</DialogTitle>
            <DialogDescription>
              {openEmail && (
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={openEmail.status} />
                  <Badge variant="outline">{openEmail.kind}</Badge>
                  <span className="text-[11px]">→ {openEmail.toEmail}</span>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {openEmail && (
            <div className="space-y-3">
              <div className="border rounded-lg bg-secondary/40 p-3 text-sm whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto tgs-scroll">
                {openEmail.body}
              </div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <MousePointerClick className="w-3.5 h-3.5" aria-hidden />
                {tr(locale,
                  `Delivery status evidence — opened: ${openEmail.openedAt ? fmtDate(openEmail.openedAt, true) : "—"}, clicked: ${openEmail.clickedAt ? fmtDate(openEmail.clickedAt, true) : "—"}`,
                  `配信証跡 — 開封: ${openEmail.openedAt ? fmtDate(openEmail.openedAt, true) : "—"}、クリック: ${openEmail.clickedAt ? fmtDate(openEmail.clickedAt, true) : "—"}`)}
              </p>
              {openEmail.unsubToken && (
                <div className="border border-[#e5b93b]/60 bg-[#fdf8e9] dark:bg-[#2c2513] rounded-lg p-3">
                  <p className="text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#b8860b]" aria-hidden />
                    {tr(locale, "One-click unsubscribe link (live)", "ワンクリック配信停止リンク（動作）")}
                  </p>
                  <a
                    href={`/api/comms/unsub?token=${openEmail.unsubToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline underline-offset-2 break-all"
                  >
                    /api/comms/unsub?token={openEmail.unsubToken}
                  </a>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {tr(locale, "Opening it withdraws marketing consent and adds the address to the suppression list.", "開くと同意を撤回し、抑制リストに追加します。")}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function notifIcon(type: string) {
  switch (type) {
    case "OUTBID": return <Gavel className="w-4 h-4" />
    case "WIN": return <Trophy className="w-4 h-4" />
    case "ORDER": return <Package className="w-4 h-4" />
    case "SHIP": return <Package className="w-4 h-4" />
    case "MSG": return <MessageSquare className="w-4 h-4" />
    case "MARKETING": return <Megaphone className="w-4 h-4" />
    case "DISPUTE":
    case "DISPUTE_OPENED": return <AlertTriangle className="w-4 h-4" />
    case "PRIVACY_EXPORT": return <ShieldCheck className="w-4 h-4" />
    default: return <Bell className="w-4 h-4" />
  }
}

function notifText(locale: "en" | "ja", type: string, paramsJson: string): string {
  let p: Record<string, unknown> = {}
  try { p = JSON.parse(paramsJson || "{}") } catch { /* ignore */ }
  const listing = typeof p.listingId === "string" ? "" : ""
  switch (type) {
    case "OUTBID":
      return tr(locale, `You've been outbid${listing} — bid again to stay in front`, `入札されました — 再入札してください`)
    case "WIN":
      return tr(locale, "🎉 You won an auction — complete payment within 48h", "🎉 落札しました — 48時間以内にお支払いください")
    case "ORDER":
      return tr(locale, "Order update — check the details", "注文更新 — 詳細を確認")
    case "SHIP":
      return tr(locale, "Your order has shipped", "注文が発送されました")
    case "MSG":
      return typeof p.subject === "string"
        ? tr(locale, `New message: ${p.subject}`, `新着メッセージ: ${p.subject}`)
        : tr(locale, "New message", "新着メッセージ")
    case "MARKETING":
      return tr(locale, "Weekly auction digest", "今週のダイジェスト")
    case "DISPUTE_OPENED":
      return tr(locale, "A dispute was opened on your order", "注文に紛争が発生しました")
    case "DISPUTE":
      return tr(locale, "Dispute update — mediation in progress", "紛争更新 — 調停中")
    case "PRIVACY_EXPORT":
      return tr(locale, "Your data export was generated", "データエクスポートが生成されました")
    case "DSAR_NEW":
      return tr(locale, "New privacy request received", "新しいプライバシー請求を受領")
    case "ACCOUNT_DELETE":
      return tr(locale, "Account deletion request — 30-day grace", "アカウント削除申請 — 30日間の猶予")
    case "REFUND":
      return tr(locale, "Refund update", "返金更新")
    case "TICKET":
      return tr(locale, "Support ticket update", "サポート更新")
    default:
      return tr(locale, "Platform notification", "プラットフォーム通知")
  }
}

function notifEventLabel(locale: "en" | "ja", ev: string): string {
  switch (ev) {
    case "OUTBID": return tr(locale, "Outbid alerts", "入札されました")
    case "WIN": return tr(locale, "Auction wins", "落札")
    case "ORDER": return tr(locale, "Order updates", "注文更新")
    case "SHIP": return tr(locale, "Shipping updates", "発送更新")
    case "MSG": return tr(locale, "New messages", "新着メッセージ")
    case "MARKETING": return tr(locale, "Marketing & digest", "マーケティング")
    case "DIGEST": return tr(locale, "Weekly digest", "週次ダイジェスト")
    default: return ev
  }
}
