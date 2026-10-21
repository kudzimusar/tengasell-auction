"use client"
// ── MessagesPage: buyer↔seller mediation threads (Agent B) ──
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, StatusBadge, fmtDate } from "../../ui"
import {
  MessageSquare, Send, ShieldCheck, AlertTriangle, ArrowLeft, MessagesSquare, Plus, Lock, RefreshCw, Circle, Image as ImageIcon,
} from "lucide-react"
import { FeedbackToaster, ThreadDetail, ThreadListItem, ThreadMessage } from "./shared"

type PendingThread = { listingId: string; title: string; sellerId: string }

export function MessagesPage() {
  const { locale, session, sessionLoaded, setView, setUnread } = useApp()
  const staff = !!session && ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"].includes(session.role)

  const [threads, setThreads] = useState<ThreadListItem[] | null>(null)
  const [allMode, setAllMode] = useState(staff)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [sending, setSending] = useState(false)
  const [bodyText, setBodyText] = useState("")

  // "New thread" dialog driven by the tgs-pending-thread handoff from ItemPage
  const [pending, setPending] = useState<PendingThread | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [newSubject, setNewSubject] = useState("")
  const [creating, setCreating] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  const loadThreads = useCallback(async (all: boolean) => {
    const res = await api<{ items: ThreadListItem[]; scope: string }>(
      `/api/threads${all && staff ? "?all=1" : ""}`
    )
    if (res.ok && res.data) setThreads(res.data.items)
    else setThreads([])
  }, [staff])

  const loadDetail = useCallback(async (id: string) => {
    const res = await api<ThreadDetail>(`/api/threads/${id}`)
    if (res.ok && res.data) {
      setDetail(res.data)
      setUnread(res.data.unreadAfter)
    }
  }, [setUnread])

  function checkPendingThread() {
    const s = useApp.getState().session
    try {
      const raw = sessionStorage.getItem("tgs-pending-thread")
      if (raw) {
        const p = JSON.parse(raw) as PendingThread
        if (p?.listingId && p?.sellerId) {
          if (s && p.sellerId === s.id) {
            toast.error(tr(locale, "This is your own listing — no conversation needed", "自分の出品のため会話は不要です"))
            sessionStorage.removeItem("tgs-pending-thread")
            return
          }
          setPending(p)
          setNewSubject(tr(locale, `Question about: ${p.title}`, `質問: ${p.title}`).slice(0, 120))
          setNewOpen(true)
        } else {
          sessionStorage.removeItem("tgs-pending-thread")
        }
      }
    } catch {
      sessionStorage.removeItem("tgs-pending-thread")
    }
  }

  // Initial load (deferred so no setState runs synchronously in the effect body)
  useEffect(() => {
    if (!sessionLoaded) return
    void Promise.resolve().then(() => loadThreads(allMode))
  }, [sessionLoaded, allMode, loadThreads])

  useEffect(() => {
    if (!sessionLoaded || !session) return
    void Promise.resolve().then(() => checkPendingThread())
  }, [sessionLoaded, session])


  // Load detail + gentle polling for the open thread
  useEffect(() => {
    if (!selectedId) return
    void Promise.resolve().then(() => loadDetail(selectedId))
    const t = setInterval(() => loadDetail(selectedId), 20_000)
    return () => clearInterval(t)
  }, [selectedId, loadDetail])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [detail?.messages.length])

  async function createThread(e: React.FormEvent) {
    e.preventDefault()
    if (!pending) return
    if (newSubject.trim().length < 2) {
      toast.error(tr(locale, "Add a short subject first", "件名を入力してください"))
      return
    }
    setCreating(true)
    const res = await api<{ id: string; existing: boolean }>("/api/threads", {
      method: "POST",
      body: JSON.stringify({ listingId: pending.listingId, subject: newSubject.trim() }),
    })
    setCreating(false)
    if (!res.ok) {
      toast.error(res.error?.message || "Could not start the conversation")
      return
    }
    sessionStorage.removeItem("tgs-pending-thread")
    setNewOpen(false)
    setPending(null)
    setNewSubject("")
    toast.success(res.data?.existing
      ? tr(locale, "Continuing your existing conversation", "既存の会話を開きます")
      : tr(locale, "Conversation started — the seller is notified", "会話を開始しました — 出品者に通知しました"))
    await loadThreads(allMode)
    setSelectedId(res.data?.id ?? null)
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId || !bodyText.trim()) return
    setSending(true)
    const res = await api<{ message: ThreadMessage; redacted: boolean }>(`/api/threads/${selectedId}`, {
      method: "POST",
      body: JSON.stringify({ body: bodyText.trim() }),
    })
    setSending(false)
    if (!res.ok) {
      toast.error(res.error?.message || "Could not send the message")
      return
    }
    if (res.data?.redacted) {
      toast.warning(tr(locale,
        "Contact details were removed — keep it on Tengasell",
        "連絡先は削除されました — Tengasell内でやり取りしてください"))
    }
    setBodyText("")
    loadDetail(selectedId)
    loadThreads(allMode)
  }

  // ── not signed in ──
  if (sessionLoaded && !session) {
    return (
      <div className="max-w-md mx-auto">
        <FeedbackToaster />
        <Empty icon="✉️" title={tr(locale, "Sign in to see your messages", "メッセージを見るにはログイン")} hint={tr(locale, "Conversations with sellers, mediation notes and order updates live here.", "出品者とのやり取り・調停メモ・注文更新がここにあります。")}>
          <Button className="mt-4 h-11 px-6" onClick={() => setView({ name: "auth" })}>
            <Lock className="w-4 h-4 mr-1.5" />{tr(locale, "Sign in", "ログイン")}
          </Button>
        </Empty>
      </div>
    )
  }

  if (!sessionLoaded || threads === null) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground" role="status">
        {tr(locale, "Loading messages…", "メッセージを読み込み中…")}
      </div>
    )
  }

  const counterpartOf = (t: ThreadListItem) => {
    if (t.youAre === "BUYER") return { ...t.seller, roleLabel: "Seller" }
    if (t.youAre === "SELLER") return { ...t.buyer, roleLabel: "Buyer" }
    return null // staff all-mode: show both
  }

  return (
    <div>
      <FeedbackToaster />
      <div className="flex items-center justify-between gap-2 mb-3">
        <h1 className="text-lg font-extrabold tracking-tight flex items-center gap-2">
          <MessagesSquare className="w-5 h-5 text-primary" aria-hidden />
          {tr(locale, "Messages", "メッセージ")}
          {threads.length > 0 && <Badge variant="secondary">{threads.length}</Badge>}
        </h1>
        <div className="flex items-center gap-3">
          {staff && (
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" aria-label="All threads toggle">
              <Switch checked={allMode} onCheckedChange={(v) => { setAllMode(v); setSelectedId(null) }} />
              {tr(locale, "All threads", "全スレッド")}
            </label>
          )}
          <Button variant="ghost" size="sm" className="h-10 w-10 p-0" aria-label="Refresh"
            onClick={() => { loadThreads(allMode); if (selectedId) loadDetail(selectedId) }}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-[340px_1fr] gap-4">
        {/* Thread list */}
        <div className={cn("md:block", selectedId ? "hidden md:block" : "block")}>
          <div className="border rounded-lg bg-card md:max-h-[70vh] overflow-y-auto tgs-scroll">
            {threads.length === 0 ? (
              <Empty icon="💬" title={tr(locale, "No conversations yet", "会話はまだありません")}
                hint={tr(locale, "Open a listing and tap “Ask a question” to start one.", "出品詳細から「質問する」で開始できます。")}>
                <Button variant="secondary" className="mt-3 h-11" onClick={() => setView({ name: "home" })}>
                  {tr(locale, "Browse listings", "出品を見る")}
                </Button>
              </Empty>
            ) : (
              <ul role="list">
                {threads.map((t) => {
                  const c = counterpartOf(t)
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelectedId(t.id)}
                        aria-current={selectedId === t.id}
                        className={cn(
                          "w-full text-left px-3 py-3 flex gap-3 items-start border-b min-h-11 hover:bg-secondary/60 transition-colors",
                          selectedId === t.id && "bg-secondary"
                        )}
                      >
                        <span className="text-2xl shrink-0 mt-0.5" aria-hidden>{c ? c.avatarEmoji : "🤝"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-semibold truncate max-w-40">
                              {c ? (c.shopName || c.name) : `${t.buyer.name} ↔ ${t.seller.name}`}
                            </span>
                            {c && <span className="text-[10px] text-muted-foreground">{c.roleLabel === "Seller" ? tr(locale, "Seller", "出品者") : tr(locale, "Buyer", "購入者")}</span>}
                            {t.status !== "OPEN" && <StatusBadge status={t.status} />}
                          </span>
                          <span className="block text-xs font-medium text-foreground truncate">{t.subject}</span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {t.previewRedacted && <AlertTriangle className="w-3 h-3 inline text-[#b8860b] mr-1" aria-label="Contains redacted content" />}
                            {t.preview || "—"}
                          </span>
                          {t.listing && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5 truncate max-w-56">
                              <ImageIcon className="w-3 h-3 shrink-0" aria-hidden />
                              {t.listing.title}
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0 whitespace-nowrap pt-1">
                          {fmtDate(t.lastMessageAt, true)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {pending && !newOpen && (
            <button
              onClick={() => setNewOpen(true)}
              className="mt-2 w-full border border-primary/40 bg-primary/5 rounded-lg px-3 py-2.5 text-xs font-medium text-primary flex items-center gap-2 min-h-11 hover:bg-primary/10 transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden />
              {tr(locale, `Continue asking about: ${pending.title}`, `この出品について質問: ${pending.title}`)}
            </button>
          )}
        </div>

        {/* Thread view */}
        <div className={cn(selectedId ? "block" : "hidden md:block")}>
          {!detail || !selectedId ? (
            <div className="border rounded-lg bg-card hidden md:flex items-center justify-center h-full min-h-64">
              <Empty icon="🗨️" title={tr(locale, "Select a conversation", "会話を選択")}
                hint={tr(locale, "All messages stay on Tengasell — contact details are auto-redacted to protect you.", "やり取りはTengasell内で — 連絡先は自動削除され安全です。")} />
            </div>
          ) : (
            <div className="border rounded-lg bg-card flex flex-col md:max-h-[70vh]">
              {/* thread header */}
              <div className="p-3 border-b flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-10 w-10 p-0 md:hidden" aria-label="Back to list"
                  onClick={() => setSelectedId(null)}>
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate">{detail.thread.subject}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {detail.thread.youAre === "BUYER" && tr(locale, `You're buying from ${detail.thread.seller?.shopName || detail.thread.seller?.name || "the seller"}`, `${detail.thread.seller?.shopName || detail.thread.seller?.name || "出品者"}との会話（購入側）`)}
                    {detail.thread.youAre === "SELLER" && tr(locale, `You're selling to ${detail.thread.buyer?.name || "the buyer"}`, `${detail.thread.buyer?.name || "購入者"}との会話（出品側）`)}
                    {detail.thread.youAre === "STAFF" && tr(locale, `Staff view — ${detail.thread.buyer?.name} ↔ ${detail.thread.seller?.name}`, `スタッフ表示 — ${detail.thread.buyer?.name} ↔ ${detail.thread.seller?.name}`)}
                    {detail.thread.listing && (
                      <>
                        {" · "}
                        <button className="text-primary underline underline-offset-2"
                          onClick={() => setView({ name: "item", id: detail.thread.listing!.id })}>
                          {detail.thread.listing.title}
                        </button>
                      </>
                    )}
                  </p>
                </div>
                {detail.thread.status !== "OPEN" && <StatusBadge status={detail.thread.status} />}
              </div>

              {/* messages */}
              <div className="flex-1 overflow-y-auto tgs-scroll p-3 space-y-3 max-h-[52vh] md:max-h-none" role="log" aria-label="Messages">
                {detail.messages.map((m) => {
                  const company = m.senderRole === "COMPANY" || m.senderRole === "SYSTEM"
                  if (company) {
                    return (
                      <div key={m.id} className="flex justify-center">
                        <div className="max-w-[85%] rounded-xl border-2 border-[#e5b93b] bg-[#fdf8e9] dark:bg-[#2c2513] px-3.5 py-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <ShieldCheck className="w-4 h-4 text-[#b8860b]" aria-hidden />
                            <span className="text-xs font-bold text-[#b8860b]">Tengasell</span>
                            {m.senderRole === "SYSTEM" && <Badge variant="outline" className="text-[9px] h-4">System</Badge>}
                          </div>
                          <p className="text-xs leading-relaxed">{m.body}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {tr(locale, "Official mediation message", "公式な調停メッセージ")} · {fmtDate(m.createdAt, true)}
                          </p>
                        </div>
                      </div>
                    )
                  }
                  const mine =
                    (detail.thread.youAre === "BUYER" && m.senderRole === "BUYER") ||
                    (detail.thread.youAre === "SELLER" && m.senderRole === "SELLER") ||
                    (!!session && m.sender?.id === session.id)
                  return (
                    <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[85%]", mine ? "items-end" : "items-start")}>
                        <div className={cn(
                          "rounded-2xl px-3.5 py-2.5",
                          mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-secondary rounded-bl-sm"
                        )}>
                          {!mine && (
                            <p className="text-[11px] font-bold mb-0.5 opacity-80">
                              {m.sender?.avatarEmoji} {m.senderRole === "BUYER" ? tr(locale, "Buyer", "購入者") : tr(locale, "Seller", "出品者")}
                            </p>
                          )}
                          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                        </div>
                        {m.redacted && (
                          <p className={cn("flex items-center gap-1 text-[10px] text-[#b8860b] mt-1", mine ? "justify-end" : "")}>
                            <AlertTriangle className="w-3 h-3" aria-hidden />
                            {tr(locale, "Contact details auto-removed — keep it on Tengasell", "連絡先は自動削除 — Tengasell内で")}
                          </p>
                        )}
                        <p className={cn("text-[10px] text-muted-foreground mt-0.5", mine ? "text-right" : "")}>
                          {fmtDate(m.createdAt, true)}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* composer */}
              <form onSubmit={sendMessage} className="p-3 border-t flex items-end gap-2">
                <div className="flex-1">
                  {detail.thread.youAre === "STAFF" && (
                    <p className="text-[10px] text-[#b8860b] font-medium mb-1 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" aria-hidden />
                      {tr(locale, "Posting as Tengasell (official note to both sides)", "Tengasellとして投稿（双方への公式メモ）")}
                    </p>
                  )}
                  <Label htmlFor="composer" className="sr-only">Message</Label>
                  <Textarea
                    id="composer"
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    placeholder={tr(locale, "Write a message… (phone numbers & emails are auto-removed)", "メッセージ（電話・メールは自動削除）")}
                    className="min-h-11 resize-none text-sm"
                    rows={2}
                    maxLength={4000}
                    disabled={sending}
                  />
                </div>
                <Button type="submit" className="h-11 w-11 p-0 shrink-0" disabled={sending || !bodyText.trim()} aria-label="Send message">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* New-thread dialog (from tgs-pending-thread handoff) */}
      <Dialog open={newOpen} onOpenChange={(v) => setNewOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" aria-hidden />
              {tr(locale, "Ask the seller", "出品者に質問")}
            </DialogTitle>
            <DialogDescription>
              {tr(locale,
                `About: ${pending?.title ?? ""} — the seller is notified and all replies stay on Tengasell.`,
                `対象: ${pending?.title ?? ""} — 出品者に通知され、返信はTengasell内で届きます。`)}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createThread} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-subject">{tr(locale, "Subject", "件名")}</Label>
              <Input id="new-subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} maxLength={140}
                className="h-11" placeholder={tr(locale, "e.g. Is shipping to Harare possible?", "例: ハラレへ発送できますか？")} required minLength={2} />
            </div>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden />
              {tr(locale, "Buyer protection: never move payments off-platform.", "購入者保護のため、プラットフォーム外の支払いはしないでください。")}
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" className="h-11" onClick={() => setNewOpen(false)}>
                {tr(locale, "Cancel", "キャンセル")}
              </Button>
              <Button type="submit" className="h-11 font-semibold" disabled={creating}>
                {creating ? tr(locale, "Starting…", "開始中…") : <><Send className="w-4 h-4 mr-1.5" />{tr(locale, "Start conversation", "会話を開始")}</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
