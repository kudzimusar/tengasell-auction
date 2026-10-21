"use client"
// ── Admin › CMS articles — editor + workflow (submit/approve/publish) ──
import { useEffect, useState } from "react"
import { Plus, Eye, Send, CheckCircle2, Globe, Archive, Undo2 } from "lucide-react"
import {
  AdminPage, AdminTable, Col, StatusPill, SearchBox, AdminTabs, useList, useOne,
  useMutate, useTT, fmtDT, LoadBox, Labeled, DialogShell,
} from "../kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"

type Row = Record<string, any>

const TYPES = ["HELP", "POLICY", "ANNOUNCEMENT", "SELLER_DOC", "RUNBOOK", "KB", "ADR", "CHANGELOG", "API_DOC"]
const STATUSES = ["ALL", "DRAFT", "IN_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"]

export function ArticlesSection() {
  const tt = useTT()
  const [status, setStatus] = useState("ALL")
  const [type, setType] = useState("ALL")
  const [q, setQ] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/cms/articles", { status, type, q })
  const [editing, setEditing] = useState<Row | null>(null)
  const [creating, setCreating] = useState(false)
  const { run, busy } = useMutate()

  const columns: Col<Row>[] = [
    { key: "title", header: tt("Article", "記事"), cell: (r) => (
      <div className="min-w-48">
        <p className="font-medium truncate max-w-64">{r.title}</p>
        <p className="text-xs text-muted-foreground font-mono">{r.slug} · v{r.version}</p>
      </div>
    ) },
    { key: "type", header: tt("Type", "種別"), cell: (r) => <StatusPill status="info" size="xs">{r.type}</StatusPill> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "sched", header: tt("Schedule / Published", "予約・公開"), cell: (r) => (
      <span className="text-xs">{r.publishedAt ? fmtDT(r.publishedAt) : r.scheduledFor ? `⏰ ${fmtDT(r.scheduledFor)}` : "—"}</span>
    ) },
    { key: "updatedAt", header: tt("Updated", "更新日"), cell: (r) => <span className="text-xs">{fmtDT(r.updatedAt)}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => (
      <Button size="sm" variant="outline" className="h-9" onClick={() => setEditing(r)}>
        <Eye className="w-3.5 h-3.5" />{tt("Edit", "編集")}
      </Button>
    ) },
  ]

  return (
    <AdminPage
      title={tt("Articles", "記事")}
      desc={tt("Help centre, policies and runbooks. Edits snapshot a new ArticleVersion; transitions are audited.", "ヘルプ・ポリシー・Runbook。編集は新バージョンを記録し、公開ワークフローは監査されます。")}
      action={<Button size="sm" className="h-10" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{tt("New article", "新規記事")}</Button>}
    >
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No articles match", "該当記事なし")}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={tt("Search title…", "タイトル検索…")} />
          <AdminTabs value={status} onChange={setStatus} tabs={STATUSES.map((s) => ({ key: s, label: s === "ALL" ? tt("All", "すべて") : s }))} />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-36 h-9" aria-label="Type filter"><SelectValue placeholder={tt("All types", "全種別")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{tt("All types", "全種別")}</SelectItem>
              {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </>}
      />
      <ArticleEditorSheet row={editing} onClose={() => { setEditing(null); reload() }} busy={busy} run={run} />
      <CreateArticleDialog open={creating} onOpenChange={setCreating} onCreated={reload} busy={busy} run={run} />
    </AdminPage>
  )
}

function ArticleEditorSheet({ row, onClose, busy, run }: {
  row: Row | null; onClose: () => void
  busy: boolean
  run: (path: string, body: unknown, success: string, opts?: { method?: string }) => Promise<boolean>
}) {
  const tt = useTT()
  const { data, loading, reload } = useOne<any>(row ? `/api/admin/cms/articles/${row.id}` : null)
  const a = data?.article
  const [title, setTitle] = useState("")
  const [titleJa, setTitleJa] = useState("")
  const [body, setBody] = useState("")
  const [bodyJa, setBodyJa] = useState("")
  const [sched, setSched] = useState("")
  const [loaded, setLoaded] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!a) return
    setLoaded(a.id)
    setTitle(a.title || ""); setTitleJa(a.titleJa || "")
    setBody(a.body || ""); setBodyJa(a.bodyJa || "")
    setSched(a.scheduledFor ? a.scheduledFor.slice(0, 16) : "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id])

  const save = async (extra: Record<string, unknown> = {}) => {
    if (!a) return
    setSaving(true)
    const ok = await run(`/api/admin/cms/articles/${a.id}`, {
      title: title.trim(), titleJa: titleJa.trim(), body: body.trim(), bodyJa: bodyJa.trim() || undefined,
      ...(sched ? { scheduledFor: new Date(sched).toISOString() } : {}),
      ...extra,
    }, tt("Saved — new version snapshotted", "保存しました。バージョン記録済み"))
    setSaving(false)
    if (ok) reload()
  }

  const transitionBtn = (label: string, transition: string, icon: React.ReactNode, cls = "", disabled = false, method = "PATCH") => (
    <Button size="sm" className={`h-9 ${cls}`} disabled={busy || saving || disabled}
      onClick={() => save({ transition })}>
      {icon}{label}
    </Button>
  )

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto tgs-scroll p-4 sm:p-6">
        <SheetHeader className="p-0">
          <SheetTitle>{a?.title || row?.title}</SheetTitle>
          <SheetDescription>{a?.slug} · v{a?.version} · {a?.type}</SheetDescription>
        </SheetHeader>
        <LoadBox loading={loading}>
          {a && (
            <div className="space-y-4 mt-4">
              <div className="flex flex-wrap gap-1.5 items-center">
                <StatusPill status={a.status} />
                {a.scheduledFor && !a.publishedAt && <StatusPill status="SCHEDULED" size="xs">{tt("scheduled", "予約済")}</StatusPill>}
                <div className="flex-1" />
                {a.status === "DRAFT" && transitionBtn(tt("Submit review", "レビューへ"), "submit", <Send className="w-3.5 h-3.5" />)}
                {a.status === "IN_REVIEW" && transitionBtn(tt("Approve", "承認"), "approve", <CheckCircle2 className="w-3.5 h-3.5" />, "bg-emerald-700 hover:bg-emerald-800")}
                {(a.status === "APPROVED" || a.status === "SCHEDULED") && transitionBtn(tt("Publish now", "公開"), "publish", <Globe className="w-3.5 h-3.5" />)}
                {a.status === "PUBLISHED" && transitionBtn(tt("Unpublish", "非公開"), "unpublish", <Undo2 className="w-3.5 h-3.5" />, "text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800")}
                {["PUBLISHED", "UNPUBLISHED"].includes(a.status) && transitionBtn(tt("Archive", "アーカイブ"), "archive", <Archive className="w-3.5 h-3.5" />)}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label={tt("Title (EN)", "タイトル（EN）")}><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10" /></Labeled>
                <Labeled label={tt("Title (JA)", "タイトル（JA）")}><Input value={titleJa} onChange={(e) => setTitleJa(e.target.value)} className="h-10" /></Labeled>
              </div>
              <Labeled label={tt("Body (EN, markdown)", "本文（EN・Markdown）")}>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="font-mono text-xs" />
              </Labeled>
              <Labeled label={tt("Body (JA)", "本文（JA）")}>
                <Textarea value={bodyJa} onChange={(e) => setBodyJa(e.target.value)} rows={6} className="font-mono text-xs" />
              </Labeled>
              <div className="grid sm:grid-cols-2 gap-3">
                <Labeled label={tt("Schedule for", "公開予約")} hint={tt("Approve with a schedule → SCHEDULED", "予約付きで承認すると予約公開に")}>
                  <Input type="datetime-local" value={sched} onChange={(e) => setSched(e.target.value)} className="h-10" />
                </Labeled>
                <div className="flex items-end">
                  <Button size="sm" className="h-10 w-full" disabled={saving || busy} onClick={() => save()}>
                    {saving ? tt("Saving…", "保存中…") : tt("Save new version", "新バージョン保存")}
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{tt("Version history", "バージョン履歴")}</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto tgs-scroll">
                  {(data?.versions || []).map((v: Row) => (
                    <div key={v.id} className="text-xs border rounded-lg p-2 flex items-center justify-between">
                      <div>
                        <p className="font-semibold">v{v.version} {v.changeNote ? `· ${v.changeNote}` : ""}</p>
                        <p className="text-muted-foreground">{v.changedByName || v.changedBy} · {fmtDT(v.createdAt)}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => {
                        const snap = (() => { try { return JSON.parse(v.snapshot) } catch { return {} } })()
                        setTitle(snap.title || ""); setTitleJa(snap.titleJa || "")
                        setBody(snap.body || ""); setBodyJa(snap.bodyJa || "")
                      }}>{tt("load", "読込")}</Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </LoadBox>
      </SheetContent>
    </Sheet>
  )
}

function CreateArticleDialog({ open, onOpenChange, onCreated, busy, run }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void; busy: boolean
  run: (path: string, body: unknown, success: string, opts?: { method?: string }) => Promise<boolean>
}) {
  const tt = useTT()
  const [slug, setSlug] = useState("")
  const [type, setType] = useState("HELP")
  const [title, setTitle] = useState("")
  const [titleJa, setTitleJa] = useState("")
  const [body, setBody] = useState("")
  const [bodyJa, setBodyJa] = useState("")
  const [sched, setSched] = useState("")
  const [status, setStatus] = useState("DRAFT")

  const create = async () => {
    const ok = await run("/api/admin/cms/articles", {
      slug: slug.trim(), type, title: title.trim(), titleJa: titleJa.trim() || title.trim(),
      body: body.trim(), bodyJa: bodyJa.trim() || undefined,
      ...(sched ? { scheduledFor: new Date(sched).toISOString() } : {}),
      status,
    }, tt("Article created", "記事を作成しました"))
    if (ok) {
      onOpenChange(false)
      setSlug(""); setType("HELP"); setTitle(""); setTitleJa(""); setBody(""); setBodyJa(""); setSched(""); setStatus("DRAFT")
      onCreated()
    }
  }

  return (
    <DialogShell
      open={open} onOpenChange={onOpenChange} wide
      title={tt("New article", "新規記事")}
      description={tt("Creates the article with version 1. Submit for review when ready.", "v1として作成。準備ができたらレビューへ。")}
      footer={
        <>
          <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)}>{tt("Cancel", "キャンセル")}</Button>
          <Button className="h-10" disabled={!slug.trim() || !title.trim() || !body.trim() || busy} onClick={create}>{tt("Create", "作成")}</Button>
        </>
      }
    >
      <div className="space-y-3 py-1">
        <div className="grid sm:grid-cols-2 gap-3">
          <Labeled label={tt("Slug", "スラッグ")} hint="e.g. how-bidding-works">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="h-10 font-mono text-xs" />
          </Labeled>
          <Labeled label={tt("Type", "種別")}>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-10" aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Labeled>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Labeled label={tt("Title (EN)", "タイトル（EN）")}><Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10" /></Labeled>
          <Labeled label={tt("Title (JA)", "タイトル（JA）")}><Input value={titleJa} onChange={(e) => setTitleJa(e.target.value)} className="h-10" /></Labeled>
        </div>
        <Labeled label={tt("Body (EN, markdown)", "本文（EN・Markdown）")}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="font-mono text-xs" />
        </Labeled>
        <Labeled label={tt("Body (JA)", "本文（JA）")}>
          <Textarea value={bodyJa} onChange={(e) => setBodyJa(e.target.value)} rows={4} className="font-mono text-xs" />
        </Labeled>
        <div className="grid sm:grid-cols-2 gap-3">
          <Labeled label={tt("Initial status", "初期状態")}>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-10" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">DRAFT</SelectItem>
                <SelectItem value="IN_REVIEW">IN_REVIEW</SelectItem>
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label={tt("Schedule for", "公開予約")}>
            <Input type="datetime-local" value={sched} onChange={(e) => setSched(e.target.value)} className="h-10" />
          </Labeled>
        </div>
      </div>
    </DialogShell>
  )
}
