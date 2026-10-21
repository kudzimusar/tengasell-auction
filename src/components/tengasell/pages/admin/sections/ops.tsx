"use client"
// ── Admin › Ops — incidents/status, backups/DR, webhooks, audit, logs, metrics ──
import { useState } from "react"
import { Plus, RefreshCw, PlayCircle, RotateCcw, PauseCircle, CheckCircle2 } from "lucide-react"
import {
  AdminPage, AdminTable, Col, StatusPill, SearchBox, AdminTabs, useList, useOne,
  useMutate, useTT, fmtDT, timeAgo, Labeled, DialogShell, KV, LoadBox, ChartCard, MiniLineChart, MiniBarChart, usd,
} from "../kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Row = Record<string, any>

// ── Incidents & Status ─────────────────────────────────────────
export function IncidentsSection() {
  const tt = useTT()
  const [status, setStatus] = useState("OPEN")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/ops/incidents", { status })
  const { data: st } = useOne<{ items: Row[] }>("/api/admin/ops/status")
  const { run, busy } = useMutate()
  const [declare, setDeclare] = useState(false)
  const [title, setTitle] = useState("")
  const [severity, setSeverity] = useState("SEV3")
  const [impact, setImpact] = useState("")
  const [summary, setSummary] = useState("")
  const [patch, setPatch] = useState<Row | null>(null)
  const [action, setAction] = useState("MITIGATE")
  const [commander, setCommander] = useState("")
  const [pmRef, setPmRef] = useState("")
  const [note, setNote] = useState("")
  const [postStatus, setPostStatus] = useState({ component: "core", status: "OPERATIONAL", message: "" })

  const statusEvents = st?.items || []

  const columns: Col<Row>[] = [
    { key: "ref", header: tt("Incident", "障害"), cell: (r) => (
      <div className="min-w-44">
        <p className="font-medium">{r.ref} · {r.title}</p>
        <p className="text-xs text-muted-foreground">{r.summary || ""}</p>
        <p className="text-[10px] text-muted-foreground/70">{timeAgo(r.startedAt)}{r.regulatoryNotification ? " · 📣 regulatory" : ""}</p>
      </div>
    ) },
    { key: "severity", header: tt("Severity", "深刻度"), cell: (r) => <StatusPill status={r.severity} /> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "commander", header: tt("Commander", "指揮者"), cell: (r) => <span className="text-xs">{r.commander || "—"}</span> },
    { key: "pm", header: tt("Postmortem", "事後検証"), cell: (r) => <span className="text-xs font-mono">{r.postmortemRef || "—"}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => !["RESOLVED", "CLOSED"].includes(r.status) ? (
      <Button size="sm" variant="outline" className="h-9" onClick={() => { setPatch(r); setAction(r.status === "OPEN" || r.status === "INVESTIGATING" ? "MITIGATE" : "RESOLVE"); setCommander(r.commander || ""); setPmRef(""); setNote("") }}>
        {tt("Update…", "更新…")}
      </Button>
    ) : null },
  ]

  return (
    <AdminPage
      title={tt("Incidents & Status", "障害・ステータス")}
      desc={tt("Declare incidents (auto status-event), command them, then resolve with postmortem. SEV1/SEV2 auto-flag regulatory notification.", "障害を宣言（ステータスイベント自動作成）し指揮・解決。SEV1/2は規制通知フラグ。")}
      action={<Button size="sm" className="h-10" onClick={() => setDeclare(true)}><Plus className="w-4 h-4" />{tt("Declare incident", "障害宣言")}</Button>}
    >
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <AdminTable
            columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
            empty={tt("No incidents in this state", "この状態の障害なし")}
            toolbar={<AdminTabs value={status} onChange={setStatus} tabs={[
              { key: "OPEN", label: tt("Open", "発生中") },
              { key: "MITIGATED", label: tt("Mitigated", "緩和済") },
              { key: "RESOLVED", label: tt("Resolved", "解決") },
              { key: "CLOSED", label: tt("Closed", "終了") },
              { key: "ALL", label: tt("All", "すべて") },
            ]} />}
          />
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3 self-start">
            <p className="text-xs font-semibold text-muted-foreground">{tt("Post a status event", "ステータス発表")}</p>
            <Labeled label={tt("Component", "コンポーネント")}>
              <Select value={postStatus.component} onValueChange={(v) => setPostStatus((s) => ({ ...s, component: v }))}>
                <SelectTrigger className="h-10" aria-label="Component"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["core", "payments", "search", "comms"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label={tt("Status", "ステータス")}>
              <Select value={postStatus.status} onValueChange={(v) => setPostStatus((s) => ({ ...s, status: v }))}>
                <SelectTrigger className="h-10" aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["OPERATIONAL", "DEGRADED", "DOWN", "MAINTENANCE"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label={tt("Message", "メッセージ")}>
              <Input value={postStatus.message} onChange={(e) => setPostStatus((s) => ({ ...s, message: e.target.value }))} className="h-10" />
            </Labeled>
            <Button size="sm" className="h-10 w-full" disabled={busy}
              onClick={async () => {
                const ok = await run("/api/admin/ops/status", postStatus, tt("Status event posted", "ステータスを発表しました"))
                if (ok) setPostStatus({ component: "core", status: "OPERATIONAL", message: "" })
              }}>
              {tt("Post status", "発表する")}
            </Button>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm self-start">
            <p className="text-xs font-semibold text-muted-foreground mb-2">{tt("Recent status events", "最新ステータス")}</p>
            <div className="space-y-2 max-h-64 overflow-y-auto tgs-scroll">
              {statusEvents.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
              {statusEvents.map((e) => (
                <div key={e.id} className="text-xs border rounded-lg p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{e.component}</span>
                    <StatusPill status={e.status} size="xs" />
                  </div>
                  <p className="text-muted-foreground">{e.message || ""}</p>
                  <p className="text-muted-foreground/70">{e.endedAt ? `${fmtDT(e.startedAt)} → ${fmtDT(e.endedAt)}` : `${timeAgo(e.startedAt)} — ongoing`}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <DialogShell
        open={declare} onOpenChange={setDeclare}
        title={tt("Declare incident", "障害宣言")}
        description={tt("Creates INC-### with an open StatusEvent (DEGRADED).", "INC-###を作成し、DEGRADEDのステータスイベントを作成します。")}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setDeclare(false)}>{tt("Cancel", "キャンセル")}</Button>
            <Button variant="destructive" className="h-10" disabled={!title.trim() || busy}
              onClick={async () => {
                const ok = await run("/api/admin/ops/incidents", {
                  title: title.trim(), severity, impact: impact.trim(), summary: summary.trim(),
                }, tt("Incident declared", "障害を宣言しました"))
                if (ok) { setDeclare(false); setTitle(""); setImpact(""); setSummary(""); reload() }
              }}>{tt("Declare", "宣言")}</Button>
          </>
        }
      >
        <div className="space-y-3 py-1">
          <Labeled label={tt("Title", "タイトル")}><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10" /></Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label={tt("Severity", "深刻度")}>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="h-10" aria-label="Severity"><SelectValue /></SelectTrigger>
                <SelectContent>{["SEV1", "SEV2", "SEV3", "SEV4"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </Labeled>
            <Labeled label={tt("Impact", "影響")}><Input value={impact} onChange={(e) => setImpact(e.target.value)} className="h-10" /></Labeled>
          </div>
          <Labeled label={tt("Summary", "概要")}><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} /></Labeled>
        </div>
      </DialogShell>

      <DialogShell
        open={!!patch} onOpenChange={(o) => !o && setPatch(null)}
        title={patch ? `${patch.ref} — update` : ""}
        description={tt("MITIGATE logs mitigation; RESOLVE ends status events and stamps resolvedAt; CLOSE finalises with a postmortem ref.", "MITIGATE は緩和を記録。RESOLVE はステータス終了＋解決日時。CLOSE は事後検証参照で確定。")}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => setPatch(null)}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={busy}
              onClick={async () => {
                if (!patch) return
                const ok = await run(`/api/admin/ops/incidents/${patch.id}`, {
                  action, ...(commander.trim() ? { commander: commander.trim() } : {}), ...(pmRef.trim() ? { postmortemRef: pmRef.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
                }, tt("Incident updated", "障害を更新しました"))
                if (ok) { setPatch(null); reload() }
              }}>{tt("Update incident", "更新")}</Button>
          </>
        }
      >
        <div className="space-y-3 py-1">
          <Labeled label={tt("Action", "操作")}>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="h-10" aria-label="Action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MITIGATE">MITIGATE</SelectItem>
                <SelectItem value="RESOLVE">RESOLVE</SelectItem>
                <SelectItem value="CLOSE">CLOSE</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label={tt("Commander", "指揮者")}><Input value={commander} onChange={(e) => setCommander(e.target.value)} className="h-10" /></Labeled>
            <Labeled label={tt("Postmortem ref", "事後検証参照")}><Input value={pmRef} onChange={(e) => setPmRef(e.target.value)} placeholder="e.g. PM-004" className="h-10 font-mono" /></Labeled>
          </div>
          <Labeled label={tt("Note", "メモ")}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Labeled>
        </div>
      </DialogShell>
    </AdminPage>
  )
}

// ── Backups & DR ────────────────────────────────────────────────
export function BackupsSection() {
  const tt = useTT()
  const { data, loading, reload } = useOne<{
    service: Row; backups: Row[]; lastRestoreTest: Row | null
  }>("/api/admin/ops/backups")
  const { run, busy } = useMutate()
  const [test, setTest] = useState<Row | null>(null)
  const [testResult, setTestResult] = useState<Row | null>(null)
  const svc = data?.service
  const backups = data?.backups || []

  return (
    <AdminPage
      title={tt("Backups & DR", "バックアップ・復旧")}
      desc={tt("Full daily backups with checksums; restore tests prove recoverability (BCP-004/005).", "チェックサム付きの日次バックアップ。復旧テストで復元可能性を実証（BCP-004/005）。")}
      action={
        <Button size="sm" className="h-10" disabled={busy}
          onClick={async () => { const ok = await run("/api/admin/ops/backups/run", {}, tt("Backup started", "バックアップ開始")); if (ok) reload() }}>
          <PlayCircle className="w-4 h-4" />{tt("Run backup now", "今すぐバックアップ")}
        </Button>
      }
    >
      {svc && (
        <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div><p className="text-[10px] text-muted-foreground font-semibold">{tt("Database", "DB")}</p><p className="text-sm font-semibold flex items-center gap-1">{svc.dbOk ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <PauseCircle className="w-3.5 h-3.5 text-red-600" />}{svc.dbOk ? "healthy" : "error"}</p></div>
          <div><p className="text-[10px] text-muted-foreground font-semibold">{tt("Uptime", "稼働時間")}</p><p className="text-sm font-semibold">{svc.uptimeNote}</p></div>
          <div><p className="text-[10px] text-muted-foreground font-semibold">{tt("Scheduler tick", "スケジューラ")}</p><p className="text-sm font-semibold">{svc.schedulerLastTick ? timeAgo(svc.schedulerLastTick) : "—"}</p></div>
          <div><p className="text-[10px] text-muted-foreground font-semibold">{tt("Last restore test", "最終復旧テスト")}</p><p className="text-sm font-semibold">{data?.lastRestoreTest ? <span>{data.lastRestoreTest.result === "PASS" ? "✅" : "❌"} {timeAgo(data.lastRestoreTest.performedAt)}</span> : "none"}</p></div>
        </div>
      )}
      <AdminTable
        columns={[
          { key: "createdAt", header: tt("Run", "実行"), cell: (r) => (
            <div>
              <p className="text-sm">{r.kind === "MANUAL" ? "🧑‍💻 manual" : "⏰ scheduled"}</p>
              <p className="text-xs text-muted-foreground">{fmtDT(r.createdAt)}</p>
            </div>
          ) },
          { key: "sizeBytes", header: tt("Size", "サイズ"), cell: (r) => <span className="text-xs tabular-nums">{r.sizeBytes ? `${(r.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "—"}</span> },
          { key: "checksum", header: tt("Checksum", "チェックサム"), cell: (r) => <span className="text-[10px] font-mono text-muted-foreground">{r.checksum ? `…${r.checksum.slice(-12)}` : "—"}</span> },
          { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
          { key: "act", header: "", className: "text-right", cell: (r) => r.status === "OK" && (
            <Button size="sm" variant="outline" className="h-9" disabled={busy}
              onClick={async () => {
                setTest(r); setTestResult(null)
                const j = await fetch(`/api/admin/ops/backups/${r.id}/restore-test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "spot" }) })
                const res = await j.json()
                if (res.ok) { setTestResult(res.data.test); reload() }
              }}>
              {tt("Restore test", "復旧テスト")}
            </Button>
          ) },
        ]}
        rows={backups} loading={loading} empty={tt("No backups yet", "バックアップなし")}
      />
      <DialogShell
        open={!!test} onOpenChange={(o) => { if (!o) { setTest(null); setTestResult(null) } }}
        title={tt("Restore test", "復旧テスト")}
        description={test ? `${test.kind} · ${fmtDT(test.createdAt)}` : ""}
        footer={<Button variant="outline" className="h-10" onClick={() => { setTest(null); setTestResult(null) }}>{tt("Close", "閉じる")}</Button>}
      >
        {testResult ? (
          <div className="space-y-3 py-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{tt("Result", "結果")}</p>
              <StatusPill status={testResult.result} />
            </div>
            <div className="space-y-1.5">
              {(testResult.checks || []).map((c: { name: string; ok: boolean }, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs border rounded-lg px-2 py-1.5">
                  <span>{c.name}</span>
                  <span className={c.ok ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>{c.ok ? "PASS" : "FAIL"}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{tt("Performed by you · recorded as RestoreTest evidence.", "実行者情報とともにRestoreTestエビデンスとして記録。")}</p>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">{tt("Running spot checks…", "スポットチェック実行中…")}</div>
        )}
      </DialogShell>
    </AdminPage>
  )
}

// ── Webhooks ────────────────────────────────────────────────────
export function WebhooksSection() {
  const tt = useTT()
  const { data, loading, reload } = useOne<{
    endpoints: Row[]; deliveries: Row[]; dlq: number
  }>("/api/admin/ops/webhooks")
  const { run, busy } = useMutate()
  const eps = data?.endpoints || []
  const deliveries = data?.deliveries || []

  return (
    <AdminPage title={tt("Webhooks", "Webhook")} desc={tt("Delivery health with exponential-backoff retries and a dead-letter queue.", "指数バックオフ再試行とデッドレター.queue。")}>
      <AdminTable
        columns={[
          { key: "url", header: tt("Endpoint / Owner", "URL・所有者"), cell: (r) => (
            <div>
              <p className="font-mono text-xs font-medium truncate max-w-64">{r.url}</p>
              <p className="text-xs text-muted-foreground">{r.ownerName} · {JSON.parse(r.events || "[]").join(", ")}</p>
            </div>
          ) },
          { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
          { key: "failureCount", header: tt("Failures", "失敗") , cell: (r) => (
            <span className={`font-bold tabular-nums ${r.failureCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{r.failureCount}</span>
          ) },
          { key: "act", header: "", className: "text-right", cell: (r) => (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="outline" className="h-9" disabled={busy}
                onClick={async () => { const ok = await run(`/api/admin/ops/webhooks/${r.id}/action`, { action: "RETRY" }, tt("Retries queued now", "再試行を予約しました")); if (ok) reload() }}>
                <RotateCcw className="w-3.5 h-3.5" />{tt("Retry", "再試行")}
              </Button>
              {r.status === "ACTIVE"
                ? <Button size="sm" variant="outline" className="h-9 text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950" disabled={busy}
                    onClick={async () => { const ok = await run(`/api/admin/ops/webhooks/${r.id}/action`, { action: "SUSPEND" }, tt("Endpoint suspended", "停止しました")); if (ok) reload() }}>
                    {tt("Suspend", "停止")}
                  </Button>
                : <Button size="sm" variant="outline" className="h-9 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950" disabled={busy}
                    onClick={async () => { const ok = await run(`/api/admin/ops/webhooks/${r.id}/action`, { action: "ACTIVATE" }, tt("Endpoint activated", "有効化しました")); if (ok) reload() }}>
                    {tt("Activate", "有効化")}
                  </Button>}
            </div>
          ) },
        ]}
        rows={eps} loading={loading} empty={tt("No endpoints", "エンドポイントなし")} maxHeight={false}
        toolbar={<div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold text-muted-foreground">{tt("Recent deliveries", "最新配信")}</p>
          {(data?.dlq || 0) > 0 && <StatusPill status="DEAD" size="xs">DLQ: {data?.dlq}</StatusPill>}
        </div>}
      />
      <AdminTable
        columns={[
          { key: "event", header: tt("Event", "イベント"), cell: (r) => <span className="font-mono text-xs">{r.event}</span> },
          { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
          { key: "attempts", header: tt("Attempts", "試行"), cell: (r) => <span className="tabular-nums text-xs">{r.attempts}{r.responseCode ? ` · ${r.responseCode}` : ""}</span> },
          { key: "lastAttemptAt", header: tt("Last try", "最終試行"), cell: (r) => <span className="text-xs">{r.lastAttemptAt ? timeAgo(r.lastAttemptAt) : r.nextRetryAt ? `next ${timeAgo(r.nextRetryAt).replace(" ago", "")}` : "—"}</span> },
        ]}
        rows={deliveries} loading={loading} empty={tt("No deliveries", "配信なし")} maxHeight={false}
      />
    </AdminPage>
  )
}

// ── Audit log ───────────────────────────────────────────────────
export function AuditSection() {
  const tt = useTT()
  const [actor, setActor] = useState("")
  const [action, setAction] = useState("")
  const [targetType, setTargetType] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/audit", { actor, action, targetType })
  const [detail, setDetail] = useState<Row | null>(null)

  return (
    <AdminPage title={tt("Audit log", "監査ログ")} desc={tt("Append-only record of every privileged action (CTL-018).", "特権操作の追記専用記録（CTL-018）。")}>
      <AdminTable
        columns={[
          { key: "createdAt", header: tt("Time", "時刻"), cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDT(r.createdAt)}</span> },
          { key: "actor", header: tt("Actor", "実行者"), cell: (r) => (
            <div>
              <p className="text-sm">{r.actorName || "system"}</p>
              <p className="text-[10px] text-muted-foreground">{r.actorRole || ""}</p>
            </div>
          ) },
          { key: "action", header: tt("Action", "操作"), cell: (r) => <span className="font-mono text-xs font-semibold">{r.action}</span> },
          { key: "target", header: tt("Target", "対象"), cell: (r) => (
            <span className="text-xs text-muted-foreground">{r.targetType || "—"} {r.targetId ? `…${r.targetId.slice(-8)}` : ""}</span>
          ) },
          { key: "reason", header: tt("Reason", "理由"), cell: (r) => <p className="text-xs max-w-40 truncate">{r.reason || "—"}</p> },
          { key: "act", header: "", className: "text-right", cell: (r) => (
            <Button size="sm" variant="outline" className="h-9" onClick={() => setDetail(r)}>{tt("Diff", "差分")}</Button>
          ) },
        ]}
        rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No entries", "記録なし")}
        toolbar={<>
          <SearchBox value={actor} onChange={setActor} placeholder={tt("Actor…", "実行者…")} />
          <SearchBox value={action} onChange={setAction} placeholder={tt("Action…", "操作…")} />
          <Select value={targetType} onValueChange={setTargetType}>
            <SelectTrigger className="w-40 h-9" aria-label="Target type"><SelectValue placeholder={tt("All targets", "全対象")} /></SelectTrigger>
            <SelectContent>
              {["", "USER", "SELLER", "LISTING", "ORDER", "REFUND", "PAYOUT", "TICKET", "DISPUTE", "REPORT", "ENFORCEMENT", "APPEAL", "ARTICLE", "CONFIG", "FLAG", "APPROVAL", "BACKUP", "RESTORE_TEST", "INCIDENT", "STATUS_EVENT", "WEBHOOK", "DSAR", "PRIVACY_INCIDENT", "BREAK_GLASS", "RECONCILIATION", "MONTHLY_CLOSE", "TAX_LINE"].map((t) => (
                <SelectItem key={t} value={t || "ALL"}>{t || tt("All targets", "全対象")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </>}
      />
      <DialogShell
        open={!!detail} onOpenChange={(o) => !o && setDetail(null)}
        title={detail ? `${detail.action} — ${detail.actorName || "system"}` : ""}
        description={detail ? fmtDT(detail.createdAt) : ""}
        footer={<Button variant="outline" className="h-10" onClick={() => setDetail(null)}>{tt("Close", "閉じる")}</Button>}
      >
        {detail && (
          <div className="space-y-3 py-1 text-xs">
            <KV k="Action" v={detail.action} />
            <KV k="Target" v={`${detail.targetType || "—"} ${detail.targetId || ""}`} />
            <KV k="Reason" v={detail.reason || "—"} />
            <KV k="IP / Request" v={`${detail.ip || "—"} / ${detail.requestId || "—"}`} />
            <div>
              <p className="font-semibold mb-1">Before</p>
              <pre className="rounded-lg bg-secondary/60 p-2 max-h-40 overflow-auto tgs-scroll text-[10px]">{detail.before ? JSON.stringify(JSON.parse(detail.before), null, 2) : "—"}</pre>
            </div>
            <div>
              <p className="font-semibold mb-1">After</p>
              <pre className="rounded-lg bg-secondary/60 p-2 max-h-40 overflow-auto tgs-scroll text-[10px]">{detail.after ? JSON.stringify(JSON.parse(detail.after), null, 2) : "—"}</pre>
            </div>
          </div>
        )}
      </DialogShell>
    </AdminPage>
  )
}

// ── App logs ────────────────────────────────────────────────────
export function LogsSection() {
  const tt = useTT()
  const [level, setLevel] = useState("")
  const [source, setSource] = useState("")
  const [q, setQ] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/logs", { level, source, q })

  return (
    <AdminPage title={tt("Application logs", "アプリケーションログ")} desc={tt("Runtime log tail for staff triage.", "運用トリアージ用の実行ログ。")}>
      <AdminTable
        columns={[
          { key: "createdAt", header: tt("Time", "時刻"), cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDT(r.createdAt)}</span> },
          { key: "level", header: tt("Level", "レベル"), cell: (r) => <StatusPill status={r.level === "error" ? "FAILED" : r.level === "warn" ? "PENDING" : "ACTIVE"} size="xs">{r.level}</StatusPill> },
          { key: "source", header: tt("Source", "ソース"), cell: (r) => <span className="font-mono text-xs">{r.source}</span> },
          { key: "message", header: tt("Message", "メッセージ"), cell: (r) => <p className="text-xs max-w-96 truncate" title={r.message}>{r.message}</p> },
          { key: "requestId", header: tt("Request", "リクエスト"), cell: (r) => <span className="text-[10px] font-mono text-muted-foreground">{r.requestId || "—"}</span> },
        ]}
        rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No log entries", "ログなし")}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={tt("Search message…", "メッセージ検索…")} />
          <AdminTabs value={level} onChange={setLevel} tabs={[
            { key: "ALL", label: tt("All", "すべて") },
            { key: "error", label: tt("Error", "エラー") },
            { key: "warn", label: tt("Warn", "警告") },
            { key: "info", label: "info" },
          ]} />
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder={tt("source…", "ソース…")} className="h-9 w-32" aria-label="Source" />
          <Button variant="outline" size="sm" className="h-9" onClick={reload}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </>}
      />
    </AdminPage>
  )
}

// ── Metrics ─────────────────────────────────────────────────────
export function MetricsSection() {
  const tt = useTT()
  const [days, setDays] = useState("14")
  const { data, loading } = useOne<{ items: Row[] }>(`/api/admin/ops/metrics?days=${days}`)
  const series = (data?.items || []).map((m) => ({ ...m, label: m.date.slice(5) }))

  return (
    <AdminPage
      title={tt("Metrics", "メトリクス")}
      desc={tt("Daily rollups: GMV, orders, users, disputes, availability.", "日次ロールアップ：GMV・注文・ユーザー・紛争・可用率。")}
      action={
        <AdminTabs value={days} onChange={setDays} tabs={[
          { key: "14", label: "14d" }, { key: "30", label: "30d" }, { key: "90", label: "90d" },
        ]} />
      }
    >
      <LoadBox loading={loading}>
        <div className="grid md:grid-cols-2 gap-4">
          <ChartCard title={tt("GMV (USD)", "流通総額")}><MiniLineChart data={series} xKey="label" series={[{ key: "gmv", name: "GMV" }]} /></ChartCard>
          <ChartCard title={tt("Orders", "注文")}><MiniBarChart data={series} xKey="label" series={[{ key: "orders", name: "Orders", color: "#e5b93b" }]} /></ChartCard>
          <ChartCard title={tt("Users / New users", "ユーザー・新規")}><MiniLineChart data={series} xKey="label" series={[{ key: "users", name: "Users" }, { key: "newUsers", name: "New", color: "#e5b93b" }]} /></ChartCard>
          <ChartCard title={tt("Disputes / Tickets", "紛争・チケット")}><MiniBarChart data={series} xKey="label" series={[{ key: "disputes", name: "Disputes", color: "#b8860b" }, { key: "tickets", name: "Tickets", color: "#1a7a8a" }]} /></ChartCard>
          <ChartCard title={tt("Availability %", "可用率")}><MiniLineChart data={series} xKey="label" series={[{ key: "availabilityPct", name: "Availability %", color: "#0f766e" }]} /></ChartCard>
          <ChartCard title={tt("Latency p95 (ms)", "レイテンシ")}><MiniBarChart data={series} xKey="label" series={[{ key: "latencyP95Ms", name: "p95 ms", color: "#e5b93b" }]} /></ChartCard>
        </div>
        <AdminTable
          columns={[
            { key: "date", header: tt("Date", "日付"), cell: (r) => <span className="font-mono text-xs">{r.date}</span> },
            { key: "gmv", header: "GMV", cell: (r) => <span className="tabular-nums">{usd(r.gmv)}</span> },
            { key: "orders", header: tt("Orders", "注文"), cell: (r) => <span className="tabular-nums">{r.orders}</span> },
            { key: "newUsers", header: tt("New users", "新規"), cell: (r) => <span className="tabular-nums">{r.newUsers}</span> },
            { key: "bids", header: tt("Bids", "入札"), cell: (r) => <span className="tabular-nums">{r.bids}</span> },
            { key: "availabilityPct", header: tt("Avail %", "可用率"), cell: (r) => <span className="tabular-nums">{r.availabilityPct}</span> },
          ]}
          rows={[...(data?.items || [])].reverse()} maxHeight={false} empty={tt("No metrics", "メトリクスなし")}
        />
      </LoadBox>
    </AdminPage>
  )
}
