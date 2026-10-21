"use client"
// ── Admin › Trust & Support — abuse reports, disputes, tickets ──
import { useState } from "react"
import { Gavel, Send, Lock } from "lucide-react"
import { api } from "@/lib/tengasell/store"
import {
  AdminPage, AdminTable, Col, StatusPill, SearchBox, AdminTabs, ActionDialog, useList, useOne,
  useMutate, useReasonCodes, usd, fmtDT, KV, LoadBox, Labeled, DialogShell, timeAgo, useTT,
} from "../kit"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"

type Row = Record<string, any>

// ── Reports & Safety (reports / enforcements / appeals) ─────────
export function ReportsSection() {
  const tt = useTT()
  const [tab, setTab] = useState("reports")
  return (
    <AdminPage title={tt("Reports & Safety", "違反報告・安全対策")} desc={tt("Abuse queue, enforcement ladder and appeals. Escalations notify the target and are always audited.", "違反キュー・制裁・異議申立て。対応は対象者へ通知され、すべて監査されます。")}>
      <AdminTabs value={tab} onChange={setTab} tabs={[
        { key: "reports", label: tt("Abuse reports", "違反報告") },
        { key: "enforcements", label: tt("Enforcements", "制裁") },
        { key: "appeals", label: tt("Appeals", "異議申立て") },
      ]} />
      {tab === "reports" && <ReportsTab />}
      {tab === "enforcements" && <EnforcementsTab />}
      {tab === "appeals" && <AppealsTab />}
    </AdminPage>
  )
}

function ReportsTab() {
  const tt = useTT()
  const [status, setStatus] = useState("OPEN")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/reports", { status })
  const codes = useReasonCodes()
  const { run, busy } = useMutate()
  const [act, setAct] = useState<{ act: "DISMISS" | "ACTION"; row: Row } | null>(null)
  const [level, setLevel] = useState("WARNING")

  const submit = async (reason: string, note: string) => {
    if (!act) return false
    const ok = await run(`/api/admin/reports/${act.row.id}/action`, {
      action: act.act,
      ...(act.act === "ACTION" ? { enforcementLevel: level } : {}),
      reasonCode: reason || "seller.education",
      note,
    }, tt("Report handled", "報告を処理しました"))
    if (ok) reload()
    return ok
  }

  const columns: Col<Row>[] = [
    { key: "reason", header: tt("Report", "報告"), cell: (r) => (
      <div className="min-w-44">
        <p className="font-medium">{r.reason}</p>
        <p className="text-xs text-muted-foreground">{r.targetType} · {r.targetLabel || "…" + (r.targetId || "").slice(-6)} · {timeAgo(r.createdAt)}</p>
        {r.details && <p className="text-xs text-muted-foreground/80 truncate max-w-64">{r.details}</p>}
      </div>
    ) },
    { key: "reporter", header: tt("Reporter", "報告者"), cell: (r) => <span className="text-xs">{r.reporterName || "—"}</span> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "handledBy", header: tt("Handled by", "担当"), cell: (r) => <span className="text-xs">{r.handledByName || (r.handledBy ? "…" + r.handledBy.slice(-6) : "—")}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => (
      <div className="flex justify-end gap-1.5">
        {["OPEN", "REVIEWING"].includes(r.status) && (
          <>
            <Button size="sm" className="h-9" onClick={() => { setAct({ act: "ACTION", row: r }); setLevel("WARNING") }}>{tt("Act…", "対応…")}</Button>
            <Button size="sm" variant="outline" className="h-9" onClick={() => setAct({ act: "DISMISS", row: r })}>{tt("Dismiss", "却下")}</Button>
          </>
        )}
      </div>
    ) },
  ]

  return (
    <>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("Queue is clear 🎉", "キューは空です 🎉")}
        toolbar={<AdminTabs value={status} onChange={setStatus} tabs={[
          { key: "OPEN", label: tt("Open", "未対応") },
          { key: "REVIEWING", label: tt("Reviewing", "確認中") },
          { key: "ACTIONED", label: tt("Actioned", "対応済") },
          { key: "DISMISSED", label: tt("Dismissed", "却下済") },
          { key: "ALL", label: tt("All", "すべて") },
        ]} />}
      />
      <ActionDialog
        open={!!act}
        onOpenChange={(o) => !o && setAct(null)}
        title={act?.act === "ACTION" ? tt("Take action on report", "報告への対応") : tt("Dismiss report", "報告の却下")}
        description={act?.act === "ACTION"
          ? tt("Applies an enforcement on the target. SUSPENSION/BAN also change the account status; LISTING targets are suspended.", "対象へ制裁を適用。SUSPENSION/BANはアカウント状態も変更。出品対象は停止されます。")
          : tt("The reporter is notified the report was reviewed and closed.", "報告者に確認済みの通知が送られます。")}
        reasonCodes={codes}
        requireReason
        submitLabel={act?.act === "ACTION" ? tt("Enforce", "制裁適用") : tt("Dismiss", "却下")}
        danger={act?.act === "ACTION"}
        busy={busy}
        onSubmit={submit}
      >
        {act?.act === "ACTION" && (
          <Labeled label={tt("Enforcement level", "制裁レベル")}>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="h-10" aria-label="Enforcement level"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WARNING">WARNING — {tt("notice only", "警告のみ")}</SelectItem>
                <SelectItem value="RESTRICTION">RESTRICTION — {tt("feature limits", "機能制限")}</SelectItem>
                <SelectItem value="SUSPENSION">SUSPENSION — {tt("account suspended", "アカウント停止")}</SelectItem>
                <SelectItem value="BAN">BAN — {tt("permanent", "永久停止")}</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
        )}
      </ActionDialog>
    </>
  )
}

function EnforcementsTab() {
  const tt = useTT()
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/enforcements", {})
  const { run, busy } = useMutate()
  const [lift, setLift] = useState<Row | null>(null)
  const [note, setNote] = useState("")

  const columns: Col<Row>[] = [
    { key: "user", header: tt("User", "ユーザー"), cell: (r) => (
      <div>
        <p className="font-medium">{r.userName || "…" + (r.userId || "").slice(-6)}</p>
        <p className="text-xs text-muted-foreground">{r.userEmail}</p>
      </div>
    ) },
    { key: "level", header: tt("Level", "レベル"), cell: (r) => <StatusPill status={r.level} /> },
    { key: "reason", header: tt("Reason", "理由"), cell: (r) => <p className="text-xs max-w-56 truncate">{r.reason}</p> },
    { key: "issuedBy", header: tt("Issued", "発行"), cell: (r) => <span className="text-xs">{r.issuedByName || "…" + (r.issuedBy || "").slice(-6)} · {timeAgo(r.createdAt)}</span> },
    { key: "lifted", header: tt("State", "状態"), cell: (r) => r.liftedAt ? <StatusPill status="LIFT" size="xs">{tt("lifted", "解除済")}</StatusPill> : <StatusPill status="ACTIVE" size="xs">{tt("active", "有効")}</StatusPill> },
    { key: "act", header: "", className: "text-right", cell: (r) => !r.liftedAt && (
      <Button size="sm" variant="outline" className="h-9 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950" onClick={() => { setLift(r); setNote("") }}>
        {tt("Lift…", "解除…")}
      </Button>
    ) },
  ]

  return (
    <>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No enforcements on record", "制裁記録なし")}
      />
      <DialogShell
        open={!!lift} onOpenChange={(o) => !o && setLift(null)}
        title={tt("Lift enforcement", "制裁の解除")}
        description={lift ? `${lift.level} on ${lift.userName || "user"} — restores the account when applicable.` : ""}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setLift(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={busy || !note.trim()}
              onClick={async () => {
                if (!lift) return
                const ok = await run(`/api/admin/enforcements/${lift.id}/action`, { action: "LIFT", note }, tt("Enforcement lifted", "制裁を解除しました"))
                if (ok) { setLift(null); reload() }
              }}>{tt("Lift", "解除")}</Button>
          </>
        }
      >
        <Labeled label={tt("Note (required)", "メモ（必須）")}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={tt("Why is this being lifted?", "解除の理由は？")} />
        </Labeled>
      </DialogShell>
    </>
  )
}

function AppealsTab() {
  const tt = useTT()
  const [status, setStatus] = useState("SUBMITTED")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/appeals", { status })
  const { run, busy } = useMutate()
  const [decide, setDecide] = useState<{ decision: "UPHOLD" | "REVERSE"; row: Row } | null>(null)

  const columns: Col<Row>[] = [
    { key: "user", header: tt("Appellant", "申立人"), cell: (r) => (
      <div>
        <p className="font-medium">{r.userName || "…" + (r.userId || "").slice(-6)}</p>
        <p className="text-xs text-muted-foreground truncate max-w-56">{r.statement}</p>
      </div>
    ) },
    { key: "enforcement", header: tt("Enforcement", "対象制裁"), cell: (r) => r.enforcement ? <StatusPill status={r.enforcement.level} /> : "—" },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "createdAt", header: tt("Filed", "申立日"), cell: (r) => <span className="text-xs">{fmtDT(r.createdAt)}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW" ? (
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="outline" className="h-9" onClick={() => setDecide({ decision: "UPHOLD", row: r })}>{tt("Uphold…", "維持…")}</Button>
        <Button size="sm" className="h-9 bg-emerald-700 hover:bg-emerald-800" onClick={() => setDecide({ decision: "REVERSE", row: r })}>{tt("Reverse…", "撤回…")}</Button>
      </div>
    ) : null },
  ]

  return (
    <>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No appeals in this state", "この状態の異議申立てなし")}
        toolbar={<AdminTabs value={status} onChange={setStatus} tabs={[
          { key: "SUBMITTED", label: tt("Submitted", "申立済") },
          { key: "UNDER_REVIEW", label: tt("Under review", "確認中") },
          { key: "UPHELD", label: tt("Upheld", "維持") },
          { key: "REVERSED", label: tt("Reversed", "撤回") },
          { key: "ALL", label: tt("All", "すべて") },
        ]} />}
      />
      <ActionDialog
        open={!!decide}
        onOpenChange={(o) => !o && setDecide(null)}
        title={decide?.decision === "REVERSE" ? tt("Reverse enforcement", "制裁の撤回") : tt("Uphold enforcement", "制裁の維持")}
        description={decide?.decision === "REVERSE"
          ? tt("Lifts the enforcement and restores the account to ACTIVE.", "制裁を解除しアカウントをACTIVEへ復帰させます。")
          : tt("The enforcement stays in force; the appellant is notified.", "制裁は有効のまま。申立人へ通知します。")}
        requireNote
        submitLabel={decide?.decision === "REVERSE" ? tt("Reverse", "撤回") : tt("Uphold", "維持")}
        busy={busy}
        onSubmit={async ({ note }) => {
          if (!decide) return false
          const ok = await run(`/api/admin/appeals/${decide.row.id}`, { decision: decide.decision, note }, tt("Appeal decided", "異議申立てを判定しました"))
          if (ok) reload()
          return ok
        }}
      />
    </>
  )
}

// ── Disputes ────────────────────────────────────────────────────
export function DisputesSection() {
  const tt = useTT()
  const [status, setStatus] = useState("OPEN")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/disputes", { status })
  const { run, busy } = useMutate()
  const { data: overview } = useOne<{ staff: { id: string; name: string; role: string }[] }>("/api/admin/overview")
  const [assign, setAssign] = useState<Row | null>(null)
  const [assignTo, setAssignTo] = useState("")
  const [resolve, setResolve] = useState<Row | null>(null)
  const [resolution, setResolution] = useState("RESOLVED_BUYER")
  const [resNote, setResNote] = useState("")
  const staff = overview?.staff || []

  const columns: Col<Row>[] = [
    { key: "order", header: tt("Dispute / Order", "紛争・注文"), cell: (r) => (
      <div className="min-w-44">
        <p className="font-medium">{r.reason}</p>
        <p className="text-xs text-muted-foreground">{r.listingTitle || "order"} · {usd(r.orderAmount)} · {timeAgo(r.openedAt)}</p>
        {r.details && <p className="text-xs text-muted-foreground/80 truncate max-w-64">{r.details}</p>}
      </div>
    ) },
    { key: "openedBy", header: tt("Opened by", "申立人"), cell: (r) => <span className="text-xs">{r.openedByName || "…" + (r.openedBy || "").slice(-6)}</span> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "assignedTo", header: tt("Assigned", "担当"), cell: (r) => <span className="text-xs">{r.assignedToName || "—"}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => ["OPEN", "UNDER_REVIEW"].includes(r.status) ? (
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="outline" className="h-9" onClick={() => { setAssign(r); setAssignTo("") }}><Gavel className="w-3.5 h-3.5" />{tt("Assign", "割当")}</Button>
        <Button size="sm" className="h-9" onClick={() => { setResolve(r); setResolution("RESOLVED_BUYER"); setResNote("") }}>{tt("Resolve…", "解決…")}</Button>
      </div>
    ) : null },
  ]

  return (
    <AdminPage title={tt("Disputes", "紛争")} desc={tt("Mediation queue. RESOLVED_BUYER sets the order to REFUND_PENDING — raise the refund in Finance. RESOLVED_SELLER completes the order. Both parties are notified.", "調停キュー。購入者勝訴で注文は返金待ちに（返金は財務で起票）。出品者勝訴で注文完了。双方へ通知されます。")}>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No open disputes", "進行中の紛争なし")}
        toolbar={<AdminTabs value={status} onChange={setStatus} tabs={[
          { key: "OPEN", label: tt("Open", "未対応") },
          { key: "UNDER_REVIEW", label: tt("Under review", "確認中") },
          { key: "RESOLVED_BUYER", label: tt("Buyer won", "購入者勝訴") },
          { key: "RESOLVED_SELLER", label: tt("Seller won", "出品者勝訴") },
          { key: "CLOSED", label: tt("Closed", "終了") },
          { key: "ALL", label: tt("All", "すべて") },
        ]} />}
      />

      <DialogShell
        open={!!assign} onOpenChange={(o) => !o && setAssign(null)}
        title={tt("Assign dispute", "紛争の割当")}
        description={tt("Assign a staff mediator; the dispute moves to UNDER_REVIEW.", "担当スタッフを割当てると確認中に移行します。")}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setAssign(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={!assignTo || busy}
              onClick={async () => {
                if (!assign) return
                const ok = await run(`/api/admin/disputes/${assign.id}/action`, { action: "ASSIGN", assignTo }, tt("Dispute assigned", "割当てました"))
                if (ok) { setAssign(null); reload() }
              }}>{tt("Assign", "割当")}</Button>
          </>
        }
      >
        <Labeled label={tt("Mediator", "担当者")}>
          <Select value={assignTo} onValueChange={setAssignTo}>
            <SelectTrigger className="h-10" aria-label="Mediator"><SelectValue placeholder={tt("Select staff…", "スタッフを選択")} /></SelectTrigger>
            <SelectContent>
              {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.role})</SelectItem>)}
            </SelectContent>
          </Select>
        </Labeled>
      </DialogShell>

      <DialogShell
        open={!!resolve} onOpenChange={(o) => !o && setResolve(null)}
        title={tt("Resolve dispute", "紛争の解決")}
        description={tt("Resolution updates the order, notifies both parties and is audited.", "判定は注文を更新し、双方へ通知、監査されます。")}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setResolve(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={!resNote.trim() || busy}
              onClick={async () => {
                if (!resolve) return
                const ok = await run(`/api/admin/disputes/${resolve.id}/action`, {
                  action: "RESOLVE", resolution, note: resNote,
                }, tt("Dispute resolved", "紛争を解決しました"))
                if (ok) { setResolve(null); reload() }
              }}>{tt("Resolve", "解決")}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Labeled label={tt("Resolution", "判定")}>
            <Select value={resolution} onValueChange={setResolution}>
              <SelectTrigger className="h-10" aria-label="Resolution"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RESOLVED_BUYER">{tt("Buyer wins — order → refund pending", "購入者勝訴 — 注文は返金待ち")}</SelectItem>
                <SelectItem value="RESOLVED_SELLER">{tt("Seller wins — order → completed", "出品者勝訴 — 注文完了")}</SelectItem>
                <SelectItem value="CLOSED">{tt("Closed — no fault found", "終了 — 問題なし")}</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label={tt("Decision note (required)", "判定メモ（必須）")}>
            <Textarea value={resNote} onChange={(e) => setResNote(e.target.value)} rows={3} placeholder={tt("Evidence summary shared with both parties…", "両者へ共有する証拠の要約…")} />
          </Labeled>
        </div>
      </DialogShell>
    </AdminPage>
  )
}

// ── Tickets ─────────────────────────────────────────────────────
export function TicketsSection() {
  const tt = useTT()
  const [status, setStatus] = useState("OPEN")
  const [q, setQ] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/tickets", { status, q })
  const [detail, setDetail] = useState<Row | null>(null)

  const columns: Col<Row>[] = [
    { key: "subject", header: tt("Ticket", "チケット"), cell: (r) => (
      <div className="min-w-44">
        <p className="font-medium truncate max-w-64">{r.subject}</p>
        <p className="text-xs text-muted-foreground">{r.userName} · {r.category} · {timeAgo(r.createdAt)}</p>
      </div>
    ) },
    { key: "priority", header: tt("Priority", "優先度"), cell: (r) => <StatusPill status={r.priority === "URGENT" || r.priority === "HIGH" ? "SEV2" : "neutral"} size="xs">{r.priority}</StatusPill> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "sla", header: "SLA", cell: (r) => r.slaBreached
      ? <StatusPill status="SEV1" size="xs">{tt("breached", "超過")}</StatusPill>
      : <span className="text-xs text-muted-foreground">{fmtDT(r.slaDueAt)}</span> },
    { key: "assignedTo", header: tt("Assignee", "担当"), cell: (r) => <span className="text-xs">{r.assignedToName || "—"}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => (
      <Button size="sm" variant="outline" className="h-9" onClick={() => setDetail(r)}>{tt("Open", "開く")}</Button>
    ) },
  ]

  return (
    <AdminPage title={tt("Support tickets", "サポートチケット")} desc={tt("SLA-tracked queue with public replies and internal notes.", "SLA管理キュー。公開返信と内部メモを区別。")}>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No tickets here", "チケットなし")}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={tt("Search subject…", "件名検索…")} />
          <AdminTabs value={status} onChange={setStatus} tabs={[
            { key: "OPEN", label: tt("Open", "未対応") },
            { key: "IN_PROGRESS", label: tt("In progress", "対応中") },
            { key: "WAITING", label: tt("Waiting", "待ち") },
            { key: "CLOSED", label: tt("Closed", "終了") },
            { key: "ALL", label: tt("All", "すべて") },
          ]} />
        </>}
      />
      <TicketDetailSheet row={detail} onClose={() => { setDetail(null); reload() }} />
    </AdminPage>
  )
}

function TicketDetailSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const tt = useTT()
  const { data: overview } = useOne<{ staff: { id: string; name: string; role: string }[] }>("/api/admin/overview")
  const { data, loading, reload } = useOne<any>(row ? `/api/admin/tickets/${row.id}` : null)
  const [body, setBody] = useState("")
  const [internal, setInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [assignTo, setAssignTo] = useState("")
  const [satisfaction, setSatisfaction] = useState("5")
  const staff = overview?.staff || []
  const t = data?.ticket

  const sendReply = async () => {
    if (!row || !body.trim()) return
    setSending(true)
    try {
      const j = await api<any>(`/api/admin/tickets/${row.id}/reply`, { method: "POST", body: JSON.stringify({ body: body.trim(), internal }) })
      if (j.ok) { setBody(""); reload(); toast({ title: internal ? tt("Internal note added", "内部メモを追加") : tt("Reply sent", "返信しました") }) }
      else toast({ title: tt("Reply failed", "返信失敗"), description: j.error?.message, variant: "destructive" })
    } finally { setSending(false) }
  }

  const doAction = async (action: string, extra: Record<string, unknown>) => {
    if (!t) return
    const j = await api<any>(`/api/admin/tickets/${t.id}/action`, { method: "POST", body: JSON.stringify({ action, ...extra }) })
    if (j.ok) { toast({ title: action === "CLOSE" ? tt("Ticket closed", "チケットを終了") : tt("Ticket assigned", "担当を割当て") }); reload(); onClose() }
    else toast({ title: tt("Action failed", "失敗"), description: j.error?.message, variant: "destructive" })
  }

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto tgs-scroll p-4 sm:p-6">
        <SheetHeader className="p-0">
          <SheetTitle>{t?.subject || row?.subject}</SheetTitle>
          <SheetDescription>
            {t ? `${t.userName} · ${t.category} · ${t.priority}` : ""}
          </SheetDescription>
        </SheetHeader>
        <LoadBox loading={loading}>
          {t && (
            <div className="space-y-4 mt-4">
              <div className="flex flex-wrap gap-2 items-center">
                <StatusPill status={t.status} />
                {t.slaBreached && <StatusPill status="SEV1" size="xs">{tt("SLA breached", "SLA超過")}</StatusPill>}
                {t.satisfaction && <StatusPill status="good" size="xs">{tt("CSAT", "満足度")}: {t.satisfaction}/5</StatusPill>}
              </div>
              <KV k={tt("Opened", "受付")} v={fmtDT(t.createdAt)} />
              <KV k={tt("First response", "初回応答")} v={t.firstResponseAt ? fmtDT(t.firstResponseAt) : tt("none yet", "未対応")} />
              <div className="border rounded-lg divide-y max-h-80 overflow-y-auto tgs-scroll bg-secondary/20">
                {(data.messages || []).map((m: Row) => (
                  <div key={m.id} className={`p-3 text-sm ${m.internal ? "bg-amber-50/70 dark:bg-amber-950/20" : ""}`}>
                    <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                      {m.internal && <Lock className="w-3 h-3" aria-label="internal" />}
                      {m.role === "SUPPORT" ? (m.authorName || "Support") : m.role === "SYSTEM" ? "System" : (t.userName || "User")}
                      · {timeAgo(m.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
                  placeholder={internal ? tt("Internal note (not visible to the user)…", "内部メモ（ユーザー非表示）…") : tt("Reply to the customer…", "顧客への返信…")} />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <Switch checked={internal} onCheckedChange={setInternal} aria-label="Internal note" />
                    {tt("Internal note", "内部メモ")}
                  </label>
                  <Button size="sm" className="h-10 px-4" disabled={!body.trim() || sending} onClick={sendReply}>
                    {sending ? <Send className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
                    {tt("Send", "送信")}
                  </Button>
                </div>
              </div>
              {t.status !== "CLOSED" && (
                <div className="border rounded-lg p-3 space-y-2.5">
                  <p className="text-xs font-semibold text-muted-foreground">{tt("Ticket actions", "チケット操作")}</p>
                  <div className="flex gap-2 flex-wrap">
                    <Select value={assignTo} onValueChange={setAssignTo}>
                      <SelectTrigger className="h-9 w-44" aria-label="Assignee"><SelectValue placeholder={tt("Assign to…", "担当者…")} /></SelectTrigger>
                      <SelectContent>
                        {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="h-9" disabled={!assignTo}
                      onClick={async () => { await doAction("ASSIGN", { assignTo }); setAssignTo("") }}>
                      {tt("Assign", "割当")}
                    </Button>
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    <Select value={satisfaction} onValueChange={setSatisfaction}>
                      <SelectTrigger className="h-9 w-20" aria-label="Satisfaction"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["5", "4", "3", "2", "1"].map((s) => <SelectItem key={s} value={s}>{s} ★</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" className="h-9"
                      onClick={() => doAction("CLOSE", { satisfaction: Number(satisfaction) })}>
                      {tt("Close ticket", "チケット終了")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </LoadBox>
      </SheetContent>
    </Sheet>
  )
}
