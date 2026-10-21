"use client"
// ── AccountPage: profile, security, privacy, selling, admin shortcuts (Agent B) ──
import { useCallback, useEffect, useState } from "react"
import { signOut } from "next-auth/react"
import { toast } from "sonner"
import { useApp, tr, api } from "@/lib/tengasell/store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Empty, StatusBadge, fmtDate } from "../../ui"
import {
  Circle, Lock, ShieldCheck, KeyRound, Download, Trash2, FileQuestion, Store, Star,
  LayoutDashboard, Users, Package, ShieldAlert, Scale, LogIn, Pencil, Info, BadgeCheck, MessageSquare, User as UserIcon,
} from "lucide-react"
import {
  FeedbackToaster, SectionCard, AccountData, DsarItem, AVATAR_PRESETS, SandboxBadge,
} from "./shared"

const DSAR_TYPES = ["ACCESS", "CORRECTION", "DELETION", "PORTABILITY", "RESTRICTION", "OBJECTION"] as const

export function AccountPage() {
  const { locale, session, sessionLoaded, setView, refreshSession, setLocale } = useApp()
  const staff = !!session && ["SUPPORT", "MODERATOR", "FINANCE", "COMPLIANCE", "ADMIN"].includes(session.role)

  const [acct, setAcct] = useState<AccountData | null>(null)
  const [dsars, setDsars] = useState<DsarItem[] | null>(null)

  // profile form
  const [name, setName] = useState("")
  const [city, setCity] = useState("")
  const [avatar, setAvatar] = useState("🙂")
  const [loc, setLoc] = useState<"en" | "ja">("en")
  const [savingProfile, setSavingProfile] = useState(false)

  // password form
  const [curPw, setCurPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [savingPw, setSavingPw] = useState(false)

  // dsar dialog
  const [dsarOpen, setDsarOpen] = useState(false)
  const [dsarType, setDsarType] = useState<(typeof DSAR_TYPES)[number]>("ACCESS")
  const [dsarDetails, setDsarDetails] = useState("")
  const [dsarBusy, setDsarBusy] = useState(false)

  const loadAll = useCallback(async () => {
    const [a, d] = await Promise.all([
      api<AccountData>("/api/account"),
      api<{ items: DsarItem[] }>("/api/privacy/dsar"),
    ])
    if (a.ok && a.data) {
      setAcct(a.data)
      setName(a.data.profile.name)
      setCity(a.data.profile.city ?? "")
      setAvatar(a.data.profile.avatarEmoji)
      setLoc(a.data.profile.locale === "ja" ? "ja" : "en")
    }
    if (d.ok && d.data) setDsars(d.data.items)
  }, [])

  useEffect(() => {
    if (!sessionLoaded) return
    void Promise.resolve().then(() => loadAll())
  }, [sessionLoaded, loadAll])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    const res = await api<{ profile: AccountData["profile"]; localeChanged: boolean }>("/api/account", {
      method: "PATCH",
      body: JSON.stringify({ name: name.trim(), city: city.trim(), locale: loc, avatarEmoji: avatar }),
    })
    setSavingProfile(false)
    if (!res.ok) { toast.error(res.error?.message || "Could not save your profile"); return }
    toast.success(tr(locale, "Profile saved", "プロフィールを保存しました"))
    if (res.data?.localeChanged) setLocale(loc)
    await refreshSession()
    loadAll()
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw.length < 8) {
      toast.error(tr(locale, "New password must be at least 8 characters", "新しいパスワードは8文字以上"))
      return
    }
    if (newPw !== confirmPw) {
      toast.error(tr(locale, "New passwords don't match", "新しいパスワードが一致しません"))
      return
    }
    setSavingPw(true)
    const res = await api<{ sessionsRevoked: number }>("/api/account?action=password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
    })
    setSavingPw(false)
    if (!res.ok) {
      toast.error(res.error?.message === "Current password is incorrect"
        ? tr(locale, "Current password is incorrect", "現在のパスワードが違います")
        : res.error?.message || "Could not change password")
      return
    }
    toast.success(tr(locale,
      `Password changed — ${res.data?.sessionsRevoked ?? 0} other session(s) revoked`,
      `パスワード変更 — 他${res.data?.sessionsRevoked ?? 0}セッションを無効化`))
    setCurPw(""); setNewPw(""); setConfirmPw("")
    loadAll()
  }

  async function submitDsar(e: React.FormEvent) {
    e.preventDefault()
    setDsarBusy(true)
    const res = await api("/api/privacy/dsar", {
      method: "POST",
      body: JSON.stringify({ type: dsarType, details: dsarDetails.trim() || undefined }),
    })
    setDsarBusy(false)
    if (!res.ok) { toast.error(res.error?.message || "Could not submit the request"); return }
    toast.success(tr(locale, "Request submitted — compliance must respond within 30 days", "請求を送信 — 30日以内に回答義務があります"))
    setDsarOpen(false); setDsarDetails("")
    loadAll()
  }

  async function downloadExport() {
    try {
      const r = await fetch("/api/account/export", { method: "POST", headers: { "Content-Type": "application/json" } })
      if (!r.ok) { toast.error(tr(locale, "Export failed", "エクスポート失敗")); return }
      const cd = r.headers.get("content-disposition") || ""
      const m = /filename="([^"]+)"/.exec(cd)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = m?.[1] || "tengasell-export.json"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(tr(locale, "Your data download has started", "データのダウンロードを開始しました"))
    } catch {
      toast.error(tr(locale, "Export failed", "エクスポート失敗"))
    }
  }

  async function deleteAccount() {
    const res = await api<{ graceDays: number }>("/api/account/delete", {
      method: "POST",
      body: JSON.stringify({ reason: "Requested from account centre" }),
    })
    if (!res.ok) { toast.error(res.error?.message || "Could not submit the deletion request"); return }
    toast.success(tr(locale,
      "Deletion requested — 30-day grace period applies; orders retained per tax law",
      "削除申請完了 — 30日間の猶予あり。税法により注文記録は保持されます"))
    await signOut({ redirect: false })
    await refreshSession()
    setView({ name: "home" })
  }

  async function toggleConsent(purpose: string, granted: boolean) {
    const res = await api("/api/privacy/consents", {
      method: "PUT",
      body: JSON.stringify({ purpose, granted }),
    })
    if (res.ok) {
      toast.success(tr(locale, "Consent updated", "同意を更新しました"))
      loadAll()
    } else toast.error(res.error?.message || "Failed")
  }

  // ── not signed in ──
  if (sessionLoaded && !session) {
    return (
      <div className="max-w-md mx-auto">
        <FeedbackToaster />
        <Empty icon="👤" title={tr(locale, "Sign in to manage your account", "アカウント管理にはログイン")}
          hint={tr(locale, "Profile, security, privacy controls and selling tools live here.", "プロフィール・セキュリティ・プライバシー・販売ツール。")}>
          <Button className="mt-4 h-11 px-6" onClick={() => setView({ name: "auth" })}>
            <LogIn className="w-4 h-4 mr-1.5" />{tr(locale, "Sign in", "ログイン")}
          </Button>
        </Empty>
      </div>
    )
  }

  if (!sessionLoaded || !acct) {
    return (
      <div className="space-y-3 max-w-2xl" role="status" aria-label="Loading account">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const p = acct.profile
  const isSellerUser = p.isSeller || p.role === "SELLER"
  const marketing = acct.consents.find(c => c.purpose === "MARKETING")
  const cookies = acct.consents.find(c => c.purpose === "COOKIES_ANALYTICS")

  return (
    <div className="max-w-3xl space-y-5">
      <FeedbackToaster />

      {/* header */}
      <div className="border rounded-xl bg-card p-4 flex items-center gap-4 shadow-sm">
        <span className="text-5xl shrink-0" aria-hidden>{p.avatarEmoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-extrabold tracking-tight truncate">{p.name}</h1>
            <Badge variant={p.status === "ACTIVE" ? "default" : "outline"} className="text-[10px]">{p.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">@{p.handle} · {p.email}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <Badge variant="secondary" className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" aria-hidden />{p.role}</Badge>
            {p.mfaEnabled && <Badge variant="outline" className="text-[10px] gap-1"><KeyRound className="w-3 h-3" aria-hidden />MFA</Badge>}
            {isSellerUser && <Badge className="text-[10px] gap-1 bg-[#b8860b]"><Store className="w-3 h-3" aria-hidden />Seller</Badge>}
            <span className="text-[10px] text-muted-foreground">{tr(locale, "Member since", "登録日")} {fmtDate(p.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* (a) profile */}
      <SectionCard title={tr(locale, "Profile", "プロフィール")} icon={<UserIcon className="w-4 h-4" />} subtitle={tr(locale, "How you appear to other members.", "他のメンバーへの表示。")}>
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">{tr(locale, "Display name", "表示名")}</Label>
              <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" minLength={2} maxLength={60} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-city">{tr(locale, "City", "都市")}</Label>
              <Input id="pf-city" value={city} onChange={(e) => setCity(e.target.value)} className="h-11" maxLength={60}
                placeholder={tr(locale, "e.g. Harare", "例: ハラレ")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-locale">{tr(locale, "Language", "言語")}</Label>
            <Select value={loc} onValueChange={(v) => setLoc(v as "en" | "ja")}>
              <SelectTrigger id="pf-locale" className="h-11 w-full sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ja">日本語</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{tr(locale, "Avatar", "アバター")}</legend>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Avatar picker">
              {AVATAR_PRESETS.map(e => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={avatar === e}
                  aria-label={`Avatar ${e}`}
                  onClick={() => setAvatar(e)}
                  className={cn(
                    "w-11 h-11 rounded-lg text-xl flex items-center justify-center border-2 transition-transform hover:scale-105",
                    avatar === e ? "border-primary bg-primary/10" : "border-transparent bg-secondary"
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </fieldset>
          <Button type="submit" className="h-11 font-semibold" disabled={savingProfile}>
            <Pencil className="w-4 h-4 mr-1.5" />
            {savingProfile ? tr(locale, "Saving…", "保存中…") : tr(locale, "Save profile", "プロフィール保存")}
          </Button>
        </form>
      </SectionCard>

      {/* (b) security */}
      <SectionCard title={tr(locale, "Security", "セキュリティ")} icon={<Lock className="w-4 h-4" />}>
        <form onSubmit={changePassword} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">{tr(locale, "Current password", "現在のパスワード")}</Label>
              <Input id="pw-current" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)}
                className="h-11" autoComplete="current-password" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-new">{tr(locale, "New password", "新しいパスワード")}</Label>
              <Input id="pw-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                className="h-11" autoComplete="new-password" minLength={8} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">{tr(locale, "Confirm new", "確認")}</Label>
              <Input id="pw-confirm" type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                className="h-11" autoComplete="new-password" required />
            </div>
          </div>
          <Button type="submit" variant="secondary" className="h-11 font-semibold" disabled={savingPw}>
            <KeyRound className="w-4 h-4 mr-1.5" />
            {savingPw ? tr(locale, "Changing…", "変更中…") : tr(locale, "Change password", "パスワード変更")}
          </Button>
        </form>
        <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" aria-hidden />
            {tr(locale, `Active sessions: ${acct.activeSessions}. Changing your password signs out all other sessions.`, `アクティブセッション: ${acct.activeSessions}。パスワード変更で他セッションは無効化されます。`)}
          </p>
          <p className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" aria-hidden />
            {staff
              ? tr(locale, "MFA (2FA) is available for staff accounts — ask the admin to enable it on yours.", "スタッフは多要素認証（MFA）を利用可能 — 管理者に有効化を依頼してください。")
              : tr(locale, "MFA (2FA) is currently offered to staff accounts; buyers are protected by device checks and rate limits.", "MFAは現在スタッフ向け。購入者は不正検知とレート制限で保護されています。")}
            {p.mfaEnabled && <Badge variant="outline" className="text-[9px] ml-1">MFA on</Badge>}
          </p>
        </div>
      </SectionCard>

      {/* (c) privacy & data */}
      <SectionCard title={tr(locale, "Privacy & your data", "プライバシーとデータ")} icon={<ShieldCheck className="w-4 h-4" />}
        subtitle={tr(locale, "Zimbabwe data-protection rights: access, portability, correction, deletion.", "ジンバブエ個人情報保護に基づく権利。")}
        action={<SandboxBadge />}>
        {/* DSAR list */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold">{tr(locale, "Privacy requests (DSAR)", "プライバシー請求（DSAR）")}</h3>
          <Button variant="secondary" size="sm" className="h-10 font-medium" onClick={() => setDsarOpen(true)}>
            <FileQuestion className="w-4 h-4 mr-1" />{tr(locale, "New request", "新規請求")}
          </Button>
        </div>
        {dsars === null ? <Skeleton className="h-16 w-full" /> : dsars.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{tr(locale, "No privacy requests yet.", "請求履歴はまだありません。")}</p>
        ) : (
          <ul className="divide-y border rounded-lg mb-4 max-h-48 overflow-y-auto tgs-scroll" role="list">
            {dsars.map(d => (
              <li key={d.id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{dsarTypeLabel(locale, d.type)}</p>
                  {d.details && <p className="text-[11px] text-muted-foreground truncate">{d.details}</p>}
                  <p className="text-[10px] text-muted-foreground">{tr(locale, "Due", "期限")} {fmtDate(d.dueAt)}</p>
                </div>
                <StatusBadge status={dsarStatus(d.status)} />
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* export */}
          <Button variant="outline" className="h-11 font-semibold" onClick={downloadExport}>
            <Download className="w-4 h-4 mr-1.5" />{tr(locale, "Download my data", "データをダウンロード")}
          </Button>
          {/* delete */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="h-11 font-semibold">
                <Trash2 className="w-4 h-4 mr-1.5" />{tr(locale, "Delete my account", "アカウント削除")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr(locale, "Delete your account?", "アカウントを削除しますか？")}</AlertDialogTitle>
                <AlertDialogDescription className="text-left">
                  {tr(locale,
                    "Your account enters a 30-day grace period — you can cancel by signing in again. After that, personal data is anonymised or erased. Orders and tax records are retained as required by Zimbabwean tax law. This cannot be undone after the grace period.",
                    "30日間の猶予期間があり、再ログインで取消可能です。その後、個人情報は匿名化・削除されます。税法により注文・税務記録は保持されます。")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11">{tr(locale, "Keep my account", "保持する")}</AlertDialogCancel>
                <AlertDialogAction
                  className="h-11 bg-destructive hover:bg-destructive/90 font-semibold"
                  onClick={(e) => { e.preventDefault(); deleteAccount() }}
                >
                  {tr(locale, "Delete account", "削除する")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="mt-4 space-y-2.5">
          <h3 className="text-sm font-semibold">{tr(locale, "Consent toggles", "同意設定")}</h3>
          {[
            { c: marketing, purpose: "MARKETING", label: tr(locale, "Marketing emails", "マーケティングメール"), toggle: true },
            { c: cookies, purpose: "COOKIES_ANALYTICS", label: tr(locale, "Analytics cookies", "分析Cookie"), toggle: true },
          ].map(({ c, purpose, label, toggle }) => (
            <div key={purpose} className="flex items-center justify-between gap-3 min-h-11">
              <div className="min-w-0">
                <p className="text-xs font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground">
                  {c
                    ? c.granted
                      ? tr(locale, `Granted ${fmtDate(c.grantedAt)}`, `同意: ${fmtDate(c.grantedAt)}`)
                      : tr(locale, `Withdrawn ${fmtDate(c.withdrawnAt)}`, `撤回: ${fmtDate(c.withdrawnAt)}`)
                    : tr(locale, "No consent record (default: off)", "記録なし（初期: OFF）")}
                </p>
              </div>
              <Switch
                checked={c?.granted ?? false}
                disabled={!toggle}
                onCheckedChange={(v) => toggleConsent(purpose, v)}
                aria-label={label}
              />
            </div>
          ))}
          {acct.consents.filter(c => c.purpose === "TERMS" || c.purpose === "PRIVACY").length > 0 && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <BadgeCheck className="w-3 h-3 text-primary" aria-hidden />
              {tr(locale, "Terms & privacy acceptance records are kept for legal evidence and cannot be toggled here.", "利用規約・プライバシーの同意記録は証跡として保持され、ここでは変更できません。")}
            </p>
          )}
        </div>
      </SectionCard>

      {/* (d) selling */}
      {isSellerUser ? (
        <SectionCard title={tr(locale, "Selling", "販売")} icon={<Store className="w-4 h-4" />}>
          {acct.sellerProfile ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-bold">{acct.sellerProfile.shopName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    <StatusBadge status={acct.sellerProfile.status} />
                    {" · "}
                    <Star className="w-3 h-3 inline text-[#e5b93b]" aria-hidden />
                    {acct.sellerProfile.ratingAvg.toFixed(1)} ({acct.sellerProfile.ratingCount})
                  </p>
                </div>
                <Button className="h-11 font-semibold" onClick={() => setView({ name: "sell" })}>
                  <Store className="w-4 h-4 mr-1.5" />{tr(locale, "Open selling dashboard", "販売ダッシュボード")}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground border rounded-lg p-3 space-y-1">
                <p className="font-medium text-foreground">{tr(locale, "Payout information", "送金情報")}</p>
                {acct.sellerProfile.payoutMethod ? (
                  <p>{tr(locale, "Bank transfer", "銀行振込")} · {acct.sellerProfile.payoutMethod.bankName ?? "Mock Bank"} ·{" "}
                    <span className="font-mono">{acct.sellerProfile.payoutMethod.acctMask ?? "****"}</span>
                    {acct.sellerProfile.payoutVerified
                      ? <Badge variant="outline" className="ml-1.5 text-[9px]">verified</Badge>
                      : <Badge variant="outline" className="ml-1.5 text-[9px]">verification pending</Badge>}
                  </p>
                ) : (
                  <p>{tr(locale, "No payout method on file — add bank details from the selling dashboard.", "振込先未設定 — 販売ダッシュボードで銀行情報を追加。")}</p>
                )}
                <p>{tr(locale, "Commission: 5% per sale · payouts approved by finance within 48h.", "手数料: 販売額の5% — 財務承認後48時間以内に送金。")}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{tr(locale, "Seller profile pending — open the dashboard to complete verification.", "出品者プロフィール準備中 — ダッシュボードで審査を完了。")}</p>
              <Button className="h-11" onClick={() => setView({ name: "sell" })}>{tr(locale, "Open", "開く")}</Button>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard title={tr(locale, "Become a seller", "出品者になる")} icon={<Store className="w-4 h-4" />}
          subtitle={tr(locale, "Sell to every district of Zimbabwe.", "ジンバブエ全土へ販売。")}>
          <ul className="text-xs space-y-1.5 mb-3">
            <li className="flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-primary shrink-0" aria-hidden />{tr(locale, "Verified national ID and contact details", "本人確認（国民ID）と連絡先")}</li>
            <li className="flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-primary shrink-0" aria-hidden />{tr(locale, "Bank account for payouts (mock bank in sandbox)", "送金用銀行口座（サンドボックスはモック）")}</li>
            <li className="flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-primary shrink-0" aria-hidden />{tr(locale, "Commission is 5% per completed sale", "手数料は完了取引の5%")}</li>
            <li className="flex items-center gap-2"><BadgeCheck className="w-4 h-4 text-primary shrink-0" aria-hidden />{tr(locale, "First listings are reviewed by moderation before going live", "最初の出品は審査後に公開")}</li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="h-11 font-semibold"
              onClick={() => {
                toast.info(tr(locale, "Ask our team via Messages — we'll guide you through verification.", "Messages でお問い合わせ — 審査をご案内します"))
                setView({ name: "messages" })
              }}>
              <MessageSquare className="w-4 h-4 mr-1.5" />{tr(locale, "Contact support to apply", "サポートに応募を問い合わせ")}
            </Button>
            <span className="text-[11px] text-muted-foreground">support@tengasell.co.zw</span>
          </div>
        </SectionCard>
      )}

      {/* (e) admin shortcuts */}
      {staff && (
        <SectionCard title={tr(locale, "Admin console shortcuts", "管理コンソール")} icon={<LayoutDashboard className="w-4 h-4" />}
          subtitle={tr(locale, "Quick links for staff.", "スタッフ用ショートカット。")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { section: "overview", label: tr(locale, "Overview", "概要"), icon: LayoutDashboard },
              { section: "users", label: tr(locale, "Users", "ユーザー"), icon: Users },
              { section: "orders", label: tr(locale, "Orders", "注文"), icon: Package },
              { section: "moderation", label: tr(locale, "Moderation", "モデレーション"), icon: ShieldAlert },
              { section: "compliance", label: tr(locale, "Compliance", "コンプライアンス"), icon: Scale },
            ].map(s => {
              const Icon = s.icon
              return (
                <button
                  key={s.section}
                  onClick={() => setView({ name: "admin", section: s.section })}
                  className="border rounded-lg px-3 py-3 min-h-11 flex items-center gap-2 text-xs font-semibold hover:bg-secondary transition-colors"
                >
                  <Icon className="w-4 h-4 text-primary shrink-0" aria-hidden />{s.label}
                </button>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* DSAR dialog */}
      <Dialog open={dsarOpen} onOpenChange={setDsarOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tr(locale, "New privacy request", "新しいプライバシー請求")}</DialogTitle>
            <DialogDescription>
              {tr(locale, "Compliance must respond within 30 days. Your identity is verified by this signed-in session.", "30日以内に回答義務があります。ログインセッションで本人確認済み。")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitDsar} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dsar-type">{tr(locale, "Request type", "請求タイプ")}</Label>
              <Select value={dsarType} onValueChange={(v) => setDsarType(v as (typeof DSAR_TYPES)[number])}>
                <SelectTrigger id="dsar-type" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DSAR_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{dsarTypeLabel(locale, t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsar-details">{tr(locale, "Details (optional)", "詳細（任意）")}</Label>
              <Textarea id="dsar-details" value={dsarDetails} onChange={(e) => setDsarDetails(e.target.value)}
                rows={3} maxLength={2000}
                placeholder={tr(locale, "e.g. Please correct my delivery address on order #…", "例: 注文#…の配送先を修正してください")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" className="h-11" onClick={() => setDsarOpen(false)}>{tr(locale, "Cancel", "キャンセル")}</Button>
              <Button type="submit" className="h-11 font-semibold" disabled={dsarBusy}>
                {dsarBusy ? tr(locale, "Submitting…", "送信中…") : tr(locale, "Submit request", "請求を送信")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}


function dsarTypeLabel(locale: "en" | "ja", t: string): string {
  switch (t) {
    case "ACCESS": return tr(locale, "Access my data", "データへのアクセス")
    case "CORRECTION": return tr(locale, "Correct my data", "データの訂正")
    case "DELETION": return tr(locale, "Delete my data", "データの削除")
    case "PORTABILITY": return tr(locale, "Export my data", "データの移転")
    case "RESTRICTION": return tr(locale, "Restrict processing", "処理の制限")
    case "OBJECTION": return tr(locale, "Object to processing", "処理への異議")
    default: return t
  }
}

function dsarStatus(s: string): string {
  // map DSAR statuses to StatusBadge-known values where possible
  switch (s) {
    case "SUBMITTED": return "PENDING"
    case "VERIFYING": return "PENDING_REVIEW"
    case "IN_PROGRESS": return "PENDING_REVIEW"
    case "COMPLETED": return "COMPLETED"
    case "REJECTED": return "REJECTED"
    default: return s
  }
}
