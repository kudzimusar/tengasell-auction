"use client"
// ── Admin › Users & Sellers — identity management, verification ──
import { useState } from "react"
import { ShieldAlert, ShieldCheck, KeyRound, Eye, Store } from "lucide-react"
import { useApp, tr } from "@/lib/tengasell/store"
import {
  AdminPage, AdminTable, Col, StatusPill, SearchBox, AdminTabs, ActionDialog, useList, useOne,
  useMutate, useReasonCodes, usd, fmtDT, KV, LoadBox, Check, Labeled, DialogShell, ReasonSelect,
} from "../kit"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"

type Row = Record<string, any>

const ROLES = ["", "BUYER", "SELLER", "SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"]

export function UsersSection() {
  const { locale } = useApp()
  const tt = (en: string, ja: string) => tr(locale, en, ja)
  const [q, setQ] = useState("")
  const [role, setRole] = useState("")
  const [status, setStatus] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/users", { q, role, status })
  const codes = useReasonCodes()
  const { run, busy } = useMutate()
  const [detail, setDetail] = useState<Row | null>(null)
  const [dialog, setDialog] = useState<{ act: string; row: Row } | null>(null)
  const [grant, setGrant] = useState<Row | null>(null)
  const [grantRole, setGrantRole] = useState("")
  const [grantReason, setGrantReason] = useState("")

  const doAction = async (row: Row, action: string, reason: string, note: string) => {
    const ok = await run(`/api/admin/users/${row.id}/action`, {
      action, reasonCode: reason || "other", note,
    }, tt("User updated", "ユーザーを更新しました"))
    if (ok) { reload(); if (detail?.user?.id === row.id) setDetail(null) }
    return ok
  }

  const doGrant = async () => {
    if (!grant || !grantRole) return
    const ok = await run(`/api/admin/users/${grant.id}/action`, {
      action: "GRANT_ROLE", role: grantRole, reasonCode: "staff_grant", note: grantReason,
    }, tt("Role granted", "権限を付与しました"))
    if (ok) { setGrant(null); setGrantRole(""); setGrantReason(""); reload() }
  }

  const columns: Col<Row>[] = [
    { key: "name", header: tt("Name / Email", "氏名・メール"), cell: (r) => (
      <div className="min-w-40">
        <p className="font-medium flex items-center gap-1.5">{r.avatarEmoji} {r.name} {r.isSeller && <Store className="w-3 h-3 text-[#b8860b]" aria-label="seller" />}</p>
        <p className="text-xs text-muted-foreground truncate">{r.email}</p>
      </div>
    ) },
    { key: "role", header: tt("Role", "役割"), cell: (r) => <StatusPill status={r.role} size="xs" tone={r.role === "BUYER" ? "info" : "gold"}>{r.role}</StatusPill> },
    { key: "status", header: tt("Status", "状態"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "riskScore", header: tt("Risk", "リスク"), cell: (r) => (
      <span className={r.riskScore >= 50 ? "text-red-600 font-bold" : r.riskScore >= 20 ? "text-amber-600 font-semibold" : "tabular-nums"}>{r.riskScore}</span>
    ) },
    { key: "lastLoginAt", header: tt("Last login", "最終ログイン"), cell: (r) => <span className="text-xs">{fmtDT(r.lastLoginAt)}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => (
      <div className="flex justify-end gap-1.5">
        <Button variant="outline" size="sm" className="h-9" onClick={() => setDetail(r)}><Eye className="w-3.5 h-3.5" /></Button>
        {r.status === "ACTIVE" ? (
          <>
            <Button variant="outline" size="sm" className="h-9 text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950"
              onClick={() => setDialog({ act: "SUSPEND", row: r })}><ShieldAlert className="w-3.5 h-3.5" />{tt("Suspend", "停止")}</Button>
            <Button variant="outline" size="sm" className="h-9 text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
              onClick={() => setDialog({ act: "BAN", row: r })}>{tt("Ban", "永久停止")}</Button>
          </>
        ) : ["SUSPENDED", "BANNED"].includes(r.status) ? (
          <Button variant="outline" size="sm" className="h-9 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950"
            onClick={() => setDialog({ act: "RESTORE", row: r })}><ShieldCheck className="w-3.5 h-3.5" />{tt("Restore", "復帰")}</Button>
        ) : null}
        <Button variant="outline" size="sm" className="h-9" onClick={() => setDialog({ act: "REQUIRE_RESET", row: r })}><KeyRound className="w-3.5 h-3.5" /></Button>
      </div>
    ) },
  ]

  return (
    <AdminPage title={tt("Users", "ユーザー")} desc={tt("Identity, roles, risk and account actions. All actions are audited.", "ID・役割・リスクとアカウント操作。全操作は監査記録されます。")}>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No users match the filters", "条件に一致するユーザーなし")}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={tt("Search name, email, handle…", "氏名・メール・ID検索…")} />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-36 h-9" aria-label="Role filter"><SelectValue placeholder={tt("All roles", "全役割")} /></SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => <SelectItem key={r} value={r || "ALL"}>{r || tt("All roles", "全役割")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36 h-9" aria-label="Status filter"><SelectValue placeholder={tt("All statuses", "全状態")} /></SelectTrigger>
            <SelectContent>
              {["", "ACTIVE", "SUSPENDED", "BANNED", "PENDING"].map((s) => <SelectItem key={s} value={s || "ALL"}>{s || tt("All statuses", "全状態")}</SelectItem>)}
            </SelectContent>
          </Select>
        </>}
      />

      <ActionDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog ? `${dialog.act.replace("_", " ")} — ${dialog.row.name}` : ""}
        description={
          dialog?.act === "BAN" ? tt("Permanent ban: blocks sign-in and revokes all sessions.", "永久停止：ログイン禁止＋全セッション失効。")
          : dialog?.act === "SUSPEND" ? tt("Suspension blocks sign-in and revokes active sessions.", "停止するとログイン不可＋セッション失効。")
          : dialog?.act === "RESTORE" ? tt("Restores the account to ACTIVE.", "アカウントをACTIVEへ戻します。")
          : tt("Issues a password reset and notifies the user.", "パスワード再設定を発行し通知します。")
        }
        reasonCodes={dialog?.act === "REQUIRE_RESET" ? undefined : codes}
        requireReason={dialog?.act !== "REQUIRE_RESET"}
        submitLabel={tt("Confirm", "確定")}
        danger={dialog?.act === "BAN" || dialog?.act === "SUSPEND"}
        busy={busy}
        onSubmit={({ reason, note }) => dialog ? doAction(dialog.row, dialog.act, reason, note) : false}
      />

      <UserDetailSheet row={detail} onClose={() => setDetail(null)} onGrantRole={(r) => setGrant(r)} />

      <DialogShell
        open={!!grant}
        onOpenChange={(o) => { if (!o) { setGrant(null); setGrantRole(""); setGrantReason("") } }}
        title={tt("Grant staff role", "スタッフ権限の付与")}
        description={grant ? `${grant.name} — admin only, logged to StaffGrant + audit trail.` : ""}
        footer={
          <>
            <Button variant="outline" className="h-10" onClick={() => { setGrant(null); setGrantRole(""); setGrantReason("") }}>{tt("Cancel", "キャンセル")}</Button>
            <Button className="h-10" disabled={!grantRole || busy} onClick={doGrant}>{tt("Grant role", "付与する")}</Button>
          </>
        }
      >
        <div className="space-y-3 py-1">
          <Labeled label={tt("Role", "役割")} hint={tt("Grants console access. Set an expiry via API when needed.", "コンソールへのアクセスを付与。期限はAPIで設定可能。")}>
            <Select value={grantRole} onValueChange={setGrantRole}>
              <SelectTrigger className="h-10" aria-label="Role"><SelectValue placeholder={tt("Select role…", "役割を選択")} /></SelectTrigger>
              <SelectContent>
                {["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </Labeled>
          <Labeled label={tt("Reason (required)", "理由（必須）")}>
            <Textarea value={grantReason} onChange={(e) => setGrantReason(e.target.value)} rows={3} placeholder={tt("Why is this role being granted?", "付与の理由は？")} />
          </Labeled>
        </div>
      </DialogShell>
    </AdminPage>
  )
}

function UserDetailSheet({ row, onClose, onGrantRole }: { row: Row | null; onClose: () => void; onGrantRole: (r: Row) => void }) {
  const { locale, session } = useApp()
  const tt = (en: string, ja: string) => tr(locale, en, ja)
  const { data, loading } = useOne<any>(row ? `/api/admin/users/${row.id}` : null)
  const d = data
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto tgs-scroll p-4 sm:p-6">
        <SheetHeader className="p-0">
          <SheetTitle>{row ? `${row.avatarEmoji} ${row.name}` : ""}</SheetTitle>
          <SheetDescription>{row?.email}</SheetDescription>
        </SheetHeader>
        <LoadBox loading={loading}>
          {d && (
            <div className="space-y-5 mt-4">
              <div className="flex flex-wrap gap-2 items-center">
                <StatusPill status={d.user.status} />
                <StatusPill status={d.user.role === "BUYER" ? "info" : "gold"} size="xs">{d.user.role}</StatusPill>
                <span className="text-xs text-muted-foreground">@{d.user.handle}</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Profile", "プロフィール")}</p>
                <KV k={tt("Risk score", "リスクスコア")} v={d.user.riskScore} />
                <KV k={tt("City", "都市")} v={d.user.city || "—"} />
                <KV k={tt("MFA", "多要素認証")} v={<Check ok={d.user.mfaEnabled} />} />
                <KV k={tt("Email verified", "メール認証")} v={<Check ok={!!d.user.emailVerifiedAt} />} />
                <KV k={tt("Joined", "登録日")} v={fmtDT(d.user.createdAt)} />
                <KV k={tt("Last login", "最終ログイン")} v={fmtDT(d.user.lastLoginAt)} />
              </div>
              {d.sellerProfile && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Seller profile", "出品者プロフィール")}</p>
                  <KV k={tt("Shop", "ショップ")} v={d.sellerProfile.shopName} />
                  <KV k={tt("Status", "状態")} v={<StatusPill status={d.sellerProfile.status} size="xs" />} />
                  <KV k={tt("Health", "健全度")} v={d.sellerProfile.healthScore} />
                  <KV k={tt("Rating", "評価")} v={`${d.sellerProfile.ratingAvg.toFixed(1)} (${d.sellerProfile.ratingCount})`} />
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Counts", "集計")}</p>
                <KV k={tt("Orders", "注文")} v={d.counts?.orders} />
                <KV k={tt("Listings", "出品")} v={d.counts?.listings} />
                <KV k={tt("Reports filed/against", "報告")} v={`${d.counts?.reportsFiled ?? 0} / ${d.counts?.reportsAgainst ?? 0}`} />
                <KV k={tt("Sessions", "セッション")} v={`${d.counts?.sessions ?? 0} (${d.counts?.sessionsActive ?? 0} active)`} />
              </div>
              {d.enforcements?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Enforcements", "制裁")}</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto tgs-scroll">
                    {d.enforcements.map((e: Row) => (
                      <div key={e.id} className="text-xs border rounded-lg p-2 flex items-center justify-between gap-2">
                        <div>
                          <StatusPill status={e.level} size="xs" />
                          <p className="mt-1 text-muted-foreground">{e.reason}</p>
                        </div>
                        <span className="text-muted-foreground shrink-0">{e.liftedAt ? tt("lifted", "解除") : fmtDT(e.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {d.consents?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Consents", "同意状況")}</p>
                  {d.consents.map((c: Row) => (
                    <KV key={c.id} k={c.purpose} v={<Check ok={c.granted} />} />
                  ))}
                </div>
              )}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{tt("Recent audit trail", "最新監査ログ")}</p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto tgs-scroll">
                  {(d.audit || []).map((a: Row) => (
                    <div key={a.id} className="text-xs border rounded-lg p-2">
                      <p className="font-medium">{a.action}</p>
                      <p className="text-muted-foreground">{a.targetType || ""} {a.reason ? `· ${a.reason}` : ""}</p>
                      <p className="text-muted-foreground/70">{fmtDT(a.createdAt)}</p>
                    </div>
                  ))}
                  {(!d.audit || d.audit.length === 0) && <p className="text-xs text-muted-foreground">{tt("No entries", "記録なし")}</p>}
                </div>
              </div>
              {d.user.status !== "DELETED" && session?.role === "ADMIN" && (
                <Button variant="outline" size="sm" className="h-9 w-full" onClick={() => onGrantRole(d.user)}>
                  <KeyRound className="w-3.5 h-3.5 mr-1.5" />{tt("Grant staff role…", "スタッフ権限付与…")}
                </Button>
              )}
            </div>
          )}
        </LoadBox>
      </SheetContent>
    </Sheet>
  )
}

// ── Sellers ─────────────────────────────────────────────────────
export function SellersSection() {
  const { locale } = useApp()
  const tt = (en: string, ja: string) => tr(locale, en, ja)
  const [status, setStatus] = useState("PENDING")
  const [q, setQ] = useState("")
  const { rows, total, page, setPage, loading, reload } = useList("/api/admin/sellers", { status, q })
  const codes = useReasonCodes()
  const { run, busy } = useMutate()
  const [dialog, setDialog] = useState<{ act: string; row: Row } | null>(null)

  const doAction = async (reason: string, note: string) => {
    if (!dialog) return false
    const ok = await run(`/api/admin/sellers/${dialog.row.id}/action`, {
      action: dialog.act, reasonCode: reason || "seller.education", note,
    }, tt("Seller updated", "出品者を更新しました"))
    if (ok) reload()
    return ok
  }

  const columns: Col<Row>[] = [
    { key: "shopName", header: tt("Shop / Owner", "ショップ・所有者"), cell: (r) => (
      <div>
        <p className="font-medium">{r.shopName}</p>
        <p className="text-xs text-muted-foreground">{r.user?.name} · {r.user?.email}</p>
      </div>
    ) },
    { key: "status", header: tt("Verification", "審査"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "flags", header: tt("ID / Biz / Tax / Payout", "ID・法人・税・送金"), cell: (r) => (
      <div className="flex items-center gap-1.5 text-sm">
        <Check ok={r.identityVerified} /><Check ok={r.businessVerified} /><Check ok={r.taxVerified} /><Check ok={r.payoutVerified} />
      </div>
    ) },
    { key: "healthScore", header: tt("Health", "健全度"), cell: (r) => (
      <span className={r.healthScore >= 80 ? "text-emerald-600 font-semibold" : r.healthScore >= 50 ? "text-amber-600 font-semibold" : "text-red-600 font-bold"}>{r.healthScore}</span>
    ) },
    { key: "ratingAvg", header: tt("Rating", "評価"), cell: (r) => <span className="tabular-nums">{r.ratingAvg.toFixed(1)} ({r.ratingCount})</span> },
    { key: "joinedAt", header: tt("Joined", "登録"), cell: (r) => <span className="text-xs">{fmtDT(r.joinedAt)}</span> },
    { key: "act", header: "", className: "text-right", cell: (r) => (
      <div className="flex justify-end gap-1.5 flex-wrap">
        {r.status === "PENDING" && (
          <>
            <Button size="sm" className="h-9" onClick={() => setDialog({ act: "VERIFY", row: r })}><ShieldCheck className="w-3.5 h-3.5" />{tt("Verify", "承認")}</Button>
            <Button size="sm" variant="outline" className="h-9 text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950" onClick={() => setDialog({ act: "REJECT", row: r })}>{tt("Reject", "却下")}</Button>
          </>
        )}
        {r.status === "VERIFIED" && (
          <Button size="sm" variant="outline" className="h-9 text-amber-700 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950" onClick={() => setDialog({ act: "SUSPEND", row: r })}>{tt("Suspend", "停止")}</Button>
        )}
        {["SUSPENDED", "REJECTED"].includes(r.status) && (
          <Button size="sm" variant="outline" className="h-9 text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950" onClick={() => setDialog({ act: "REINSTATE", row: r })}>{tt("Reinstate", "復帰")}</Button>
        )}
      </div>
    ) },
  ]

  return (
    <AdminPage title={tt("Sellers", "出品者")} desc={tt("Verification queue and seller health. VERIFY clears identity, business, tax and payout checks.", "審査キューと出品者の健全性。承認でID・法人・税務・送金チェックを完了扱いにします。")}>
      <AdminTable
        columns={columns} rows={rows} loading={loading} total={total} page={page} onPage={setPage}
        empty={tt("No sellers in this state", "この状態の出品者なし")}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={tt("Search shop, owner…", "ショップ検索…")} />
          <AdminTabs
            value={status || "ALL"}
            onChange={setStatus}
            tabs={[
              { key: "PENDING", label: tt("Pending", "承認待ち") },
              { key: "VERIFIED", label: tt("Verified", "承認済み") },
              { key: "SUSPENDED", label: tt("Suspended", "停止中") },
              { key: "REJECTED", label: tt("Rejected", "却下") },
              { key: "ALL", label: tt("All", "すべて") },
            ]}
          />
        </>}
      />
      <ActionDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog ? `${dialog.act} — ${dialog.row.shopName}` : ""}
        requireReason
        submitLabel={tt("Confirm", "確定")}
        danger={dialog?.act === "REJECT" || dialog?.act === "SUSPEND"}
        busy={busy}
        reasonCodes={codes}
        onSubmit={doAction}
      />
    </AdminPage>
  )
}
