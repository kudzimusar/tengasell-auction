"use client"
// ── Admin › Config (flags, settings, break-glass) & Approvals queue ──
import { useState } from "react"
import { AlertTriangle, ShieldAlert, KeyRound } from "lucide-react"
import { useApp } from "@/lib/tengasell/store"
import {
  AdminPage, AdminTable, Col, StatusPill, AdminTabs, useList, useOne,
  useMutate, useTT, fmtDT, timeAgo, Labeled, DialogShell,
} from "../kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"

type Row = Record<string, any>
const EMERGENCY_FLAGS = ["payments.maintenance", "auctions.enabled"]

export function ConfigSection() {
  const tt = useTT()
  const { session } = useApp()
  const { data, loading, reload } = useOne<{
    flags: Row[]; settings: Row[]; reasonCodes: Row[]
  }>("/api/admin/config")
  const { run, busy } = useMutate()
  const [edit, setEdit] = useState<Row | null>(null)
  const [editVal, setEditVal] = useState("")
  const [editNote, setEditNote] = useState("")

  const isAdmin = session?.role === "ADMIN"
  const flags = data?.flags || []
  const settings = data?.settings || []

  const toggleFlag = async (flag: Row, enabled: boolean) => {
    if (EMERGENCY_FLAGS.includes(flag.key)) {
      const verb = enabled
        ? (flag.key === "payments.maintenance" ? tt("PAUSE payments", "支払を停止") : tt("ENABLE auctions", "オークション開始"))
        : (flag.key === "payments.maintenance" ? tt("RESUME payments", "支払を再開") : tt("DISABLE auctions", "オークション停止"))
      if (!window.confirm(`${verb}?\n\n${tt("Emergency control — audited (CTL-022).", "緊急操作 — 監査されます（CTL-022）。")}`)) return
    }
    const ok = await run(`/api/admin/config/flags/${encodeURIComponent(flag.key)}`, { enabled }, tt("Flag updated", "フラグを更新しました"))
    if (ok) reload()
  }

  const applySetting = async () => {
    if (!edit) return
    let value: unknown = editVal
    try { value = JSON.parse(editVal) } catch { /* keep string */ }
    const ok = await run(`/api/admin/config/settings/${encodeURIComponent(edit.key)}`, { value, note: editNote },
      edit.requiresApproval ? tt("Change queued for second-admin approval", "変更を承認待ちに登録しました") : tt("Setting updated", "設定を更新しました"))
    if (ok) { setEdit(null); reload() }
  }

  return (
    <AdminPage title={tt("Flags & Settings", "フラグ・設定")} desc={tt("Emergency kill-switches and platform configuration. Changes requiring approval route through dual control (CTL-021/022).", "緊急スイッチとプラットフォーム設定。承認必須の設定は二重承認へ回されます。")}>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="p-3 border-b bg-secondary/30 flex items-center gap-2">
              <p className="text-xs font-semibold">{tt("Feature flags", "フィーチャーフラグ")}</p>
            </div>
            {loading ? <div className="p-4 space-y-3"><div className="h-10 bg-muted/40 rounded animate-pulse" /><div className="h-10 bg-muted/40 rounded animate-pulse" /></div> :
              flags.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{tt("No flags", "フラグなし")}</p> :
              <div className="divide-y">
                {flags.map((f) => {
                  const emergency = EMERGENCY_FLAGS.includes(f.key)
                  const maint = f.key === "payments.maintenance"
                  return (
                    <div key={f.key} className={`flex items-center justify-between gap-3 p-3 ${emergency && f.enabled ? (maint ? "bg-red-50 dark:bg-red-950/30" : "bg-amber-50 dark:bg-amber-950/20") : ""}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                          {f.key}
                          {emergency && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 dark:text-red-400">
                              <AlertTriangle className="w-3 h-3" aria-hidden />{tt("EMERGENCY", "緊急")}
                            </span>
                          )}
                          {f.enabled && maint && <StatusPill status="MAINTENANCE" size="xs" />}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{f.description}</p>
                        <p className="text-[10px] text-muted-foreground/70">{f.updatedBy} · {timeAgo(f.updatedAt)}</p>
                      </div>
                      <Switch
                        checked={f.enabled}
                        onCheckedChange={(v) => toggleFlag(f, v)}
                        disabled={!isAdmin || busy}
                        aria-label={`${f.key} toggle`}
                      />
                    </div>
                  )
                })}
              </div>
            }
          </div>

          <AdminTable
            columns={[
              { key: "key", header: tt("Setting", "設定"), cell: (r) => (
                <div>
                  <p className="text-sm font-medium font-mono">{r.key}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-64">{r.description}</p>
                </div>
              ) },
              { key: "value", header: tt("Value", "値"), cell: (r) => <span className="font-mono text-xs">{r.value}</span> },
              { key: "approval", header: tt("Approval", "承認") , cell: (r) => r.requiresApproval ? <StatusPill status="PENDING" size="xs">{tt("dual", "二重")}</StatusPill> : <span className="text-xs text-muted-foreground">—</span> },
              { key: "act", header: "", className: "text-right", cell: (r) => (
                <Button size="sm" variant="outline" className="h-9" disabled={!isAdmin} onClick={() => { setEdit(r); setEditVal(String(r.value)); setEditNote("") }}>
                  {tt("Edit", "編集")}
                </Button>
              ) },
            ]}
            rows={settings} loading={loading} maxHeight={false} empty={tt("No settings", "設定なし")}
          />
        </div>

        <BreakGlassPanel isAdmin={isAdmin} />
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2">{tt("Reason codes", "理由コード")}</p>
        <AdminTable
          columns={[
            { key: "key", header: tt("Code", "コード"), cell: (r) => <span className="font-mono text-xs">{r.key}</span> },
            { key: "label", header: tt("Label", "ラベル"), cell: (r) => <span className="text-sm">{r.label}</span> },
            { key: "labelJa", header: "JA", cell: (r) => <span className="text-sm">{r.labelJa || "—"}</span> },
            { key: "category", header: tt("Category", "分類"), cell: (r) => <StatusPill status="info" size="xs">{r.category}</StatusPill> },
            { key: "active", header: tt("Active", "有効"), cell: (r) => <StatusPill status={r.active ? "ACTIVE" : "neutral"} size="xs" /> },
          ]}
          rows={data?.reasonCodes || []} loading={loading} maxHeight={false} empty={tt("None", "なし")}
        />
      </div>

      <DialogShell
        open={!!edit} onOpenChange={(o) => !o && setEdit(null)}
        title={tt("Edit setting", "設定編集")}
        description={edit ? `${edit.key} — ${edit.requiresApproval ? tt("requires approval by a second admin before it applies", "別管理者の承認後に適用されます") : tt("applies immediately", "即時適用")}` : ""}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setEdit(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={busy || !editVal.trim()} onClick={applySetting}>
              {edit?.requiresApproval ? tt("Submit for approval", "承認へ提出") : tt("Save", "保存")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 py-1">
          <Labeled label={tt("Value (JSON or plain)", "値（JSON可）")}>
            <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} className="h-10 font-mono text-xs" />
          </Labeled>
          <Labeled label={tt("Change note", "変更メモ")}>
            <Textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={2} />
          </Labeled>
        </div>
      </DialogShell>
    </AdminPage>
  )
}

function BreakGlassPanel({ isAdmin }: { isAdmin: boolean }) {
  const tt = useTT()
  const { session } = useApp()
  const { data, loading, reload } = useOne<{ items: Row[] }>("/api/admin/ops/break-glass")
  const { run, busy } = useMutate()
  const [reason, setReason] = useState("")
  const items = (data?.items || []).slice(0, 6)

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-900 bg-card shadow-sm overflow-hidden self-start">
      <div className="p-3 border-b bg-red-50 dark:bg-red-950/30 flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden />
        <p className="text-xs font-semibold">{tt("Break-glass access (CTL-022)", "緊急アクセス（CTL-022）")}</p>
      </div>
      <div className="p-3 space-y-2 max-h-64 overflow-y-auto tgs-scroll">
        {loading ? <p className="text-xs text-muted-foreground">…</p> : items.length === 0
          ? <p className="text-xs text-muted-foreground">{tt("No requests", "申請なし")}</p>
          : items.map((b) => {
            const expired = b.revokedAt || new Date(b.expiresAt) <= new Date()
            return (
              <div key={b.id} className="text-xs border rounded-lg p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{b.requesterName || "—"}</span>
                  {!b.grantedAt && !b.revokedAt
                    ? <StatusPill status="PENDING" size="xs">{tt("pending", "承認待ち")}</StatusPill>
                    : expired
                      ? <StatusPill status="neutral" size="xs">{b.revokedAt ? tt("revoked", "失効") : tt("expired", "期限切れ")}</StatusPill>
                      : <StatusPill status="ACTIVE" size="xs">{tt("granted", "許可中")}</StatusPill>}
                </div>
                <p className="text-muted-foreground">{b.reason}</p>
                {b.grantedAt && !expired && <p className="text-muted-foreground/70">{tt("expires", "有効期限")}: {fmtDT(b.expiresAt)}</p>}
                {!b.grantedAt && !b.revokedAt && session?.role === "ADMIN" && b.requestedBy !== session.id && (
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={async () => {
                      const ok = await run(`/api/admin/ops/break-glass/${b.id}`, { decision: "APPROVE" }, tt("Granted for 60 minutes", "60分許可しました"))
                      if (ok) reload()
                    }}>{tt("Approve 60m", "60分許可")}</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={busy} onClick={async () => {
                      const ok = await run(`/api/admin/ops/break-glass/${b.id}`, { decision: "REVOKE" }, tt("Request revoked", "申請を失効"))
                      if (ok) reload()
                    }}>{tt("Revoke", "失効")}</Button>
                  </div>
                )}
              </div>
            )
          })}
      </div>
      {isAdmin && (
        <div className="p-3 border-t space-y-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            placeholder={tt("Why do you need emergency access?", "緊急アクセスの理由は？")} />
          <Button size="sm" className="h-9 w-full" disabled={!reason.trim() || busy}
            onClick={async () => {
              const ok = await run("/api/admin/ops/break-glass", { reason }, tt("Break-glass requested — awaiting second admin", "緊急アクセスを申請しました。別管理者の承認待ち"))
              if (ok) { setReason(""); reload() }
            }}>
            <KeyRound className="w-3.5 h-3.5" />{tt("Request break-glass", "緊急アクセス申請")}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Approvals queue ─────────────────────────────────────────────
export function ApprovalsSection() {
  const tt = useTT()
  const [status, setStatus] = useState("PENDING")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/approvals", { status })
  const { run, busy } = useMutate()
  const [decide, setDecide] = useState<{ decision: "APPROVED" | "REJECTED"; row: Row } | null>(null)
  const [note, setNote] = useState("")

  const typeTone = (t: string) => (t === "REFUND" || t === "PAYOUT" ? "gold" : "info")

  const columns: Col<Row>[] = [
    { key: "type", header: tt("Type", "種別"), cell: (r) => <StatusPill status="info" tone={typeTone(r.type)} size="xs">{r.type}</StatusPill> },
    { key: "payload", header: tt("Payload", "ペイロード"), cell: (r) => (
      <div className="text-[11px] font-mono text-muted-foreground max-w-72 truncate">{r.payloadPreview || JSON.stringify(r.payload)}</div>
    ) },
    { key: "requester", header: tt("Requested by", "申請者"), cell: (r) => (
      <div>
        <p className="text-sm">{r.requesterName}</p>
        <p className="text-[10px] text-muted-foreground">{r.requesterRole} · {timeAgo(r.createdAt)}</p>
      </div>
    ) },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "decidedBy", header: tt("Decided by", "判定者"), cell: (r) => r.decidedByName ? (
      <span className="text-xs">{r.decidedByName} · {timeAgo(r.decidedAt)}</span>
    ) : "—" },
    { key: "act", header: "", className: "text-right", cell: (r) => r.status === "PENDING" ? (
      <div className="flex justify-end gap-1.5">
        <Button size="sm" className="h-9 bg-emerald-700 hover:bg-emerald-800" onClick={() => { setDecide({ decision: "APPROVED", row: r }); setNote("") }}>
          {tt("Approve…", "承認…")}
        </Button>
        <Button size="sm" variant="outline" className="h-9 text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950" onClick={() => { setDecide({ decision: "REJECTED", row: r }); setNote("") }}>
          {tt("Reject…", "却下…")}
        </Button>
      </div>
    ) : null },
  ]

  return (
    <AdminPage title={tt("Approvals", "承認")} desc={tt("Dual-control queue (CTL-021): the decider must be a different staff member than the requester.", "二重承認キュー（CTL-021）：申請者と別の担当者が判定します。")}>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("Queue clear 🎉", "キューは空です 🎉")}
        toolbar={<AdminTabs value={status} onChange={setStatus} tabs={[
          { key: "PENDING", label: tt("Pending", "承認待ち") },
          { key: "APPROVED", label: tt("Approved", "承認済") },
          { key: "REJECTED", label: tt("Rejected", "却下") },
          { key: "ALL", label: tt("All", "すべて") },
        ]} />}
      />
      <DialogShell
        open={!!decide} onOpenChange={(o) => !o && setDecide(null)}
        title={decide?.decision === "APPROVED" ? tt("Approve request", "リクエスト承認") : tt("Reject request", "リクエスト却下")}
        description={decide
          ? (decide.decision === "APPROVED"
            ? tt("Executing the effect — refund processing / payout batch / config change, with ledger + audit.", "効果を実行します：返金処理／送金バッチ／設定変更。帳簿と監査も記録。")
            : tt("The request is rejected and the requester notified.", "リクエストを却下し、申請者へ通知します。"))
          : ""}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setDecide(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button
              variant={decide?.decision === "REJECTED" ? "destructive" : "default"}
              className="h-10" disabled={busy || (decide?.decision === "REJECTED" && !note.trim())}
              onClick={async () => {
                if (!decide) return
                const ok = await run(`/api/admin/approvals/${decide.row.id}/decide`, {
                  decision: decide.decision, note,
                }, decide.decision === "APPROVED" ? tt("Approved & executed", "承認・実行しました") : tt("Rejected", "却下しました"))
                if (ok) { setDecide(null); reload() }
              }}>
              {decide?.decision === "APPROVED" ? tt("Approve", "承認") : tt("Reject", "却下")}
            </Button>
          </>
        }
      >
        {decide && (
          <div className="space-y-3 py-1">
            <div className="rounded-lg bg-secondary/50 p-3 text-xs font-mono break-all max-h-40 overflow-y-auto tgs-scroll">
              {decide.row.payloadPreview || JSON.stringify(decide.row.payload)}
            </div>
            <Labeled label={tt("Decision note", "判定メモ")} hint={decide.decision === "REJECTED" ? tt("Required for rejections", "却下時は必須") : undefined}>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </Labeled>
          </div>
        )}
      </DialogShell>
    </AdminPage>
  )
}
