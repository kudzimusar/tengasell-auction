"use client"
// ── AuthPage: sign in / register with demo-account helper (Agent B) ──
import { useState } from "react"
import { signIn } from "next-auth/react"
import { toast } from "sonner"
import { useApp, tr } from "@/lib/tengasell/store"
import { api } from "@/lib/tengasell/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { LogIn, UserPlus, KeyRound, Info } from "lucide-react"
import { DEMO_ACCOUNTS, DEMO_PASSWORD, passwordStrength, FeedbackToaster } from "./shared"

export function AuthPage() {
  const { locale, setView } = useApp()
  const [tab, setTab] = useState<"signin" | "register">("signin")
  const [busy, setBusy] = useState(false)

  // Sign-in state
  const [siEmail, setSiEmail] = useState("")
  const [siPassword, setSiPassword] = useState("")

  // Register state
  const [regName, setRegName] = useState("")
  const [regHandle, setRegHandle] = useState("")
  const [regEmail, setRegEmail] = useState("")
  const [regPassword, setRegPassword] = useState("")
  const [regLocale, setRegLocale] = useState<"en" | "ja">(locale)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [acceptPrivacy, setAcceptPrivacy] = useState(false)
  const strength = passwordStrength(regPassword)

  async function finishSignIn(email: string, password: string) {
    const res = await signIn("credentials", { email, password, redirect: false })
    if (res?.error) {
      toast.error(tr(locale, "Invalid email or password", "メールアドレスまたはパスワードが違います"))
      return false
    }
    await useApp.getState().refreshSession()
    toast.success(tr(locale, "Signed in — welcome back!", "ログインしました — おかえりなさい！"))
    setView({ name: "home" })
    return true
  }

  async function doSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!siEmail || !siPassword) {
      toast.error(tr(locale, "Enter your email and password", "メールとパスワードを入力してください"))
      return
    }
    setBusy(true)
    await finishSignIn(siEmail.trim().toLowerCase(), siPassword)
    setBusy(false)
  }

  async function doRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!acceptTerms || !acceptPrivacy) {
      toast.error(tr(locale, "Please accept the Terms and Privacy Policy first", "利用規約とプライバシーポリシーに同意してください"))
      return
    }
    if (regPassword.length < 8) {
      toast.error(tr(locale, "Password must be at least 8 characters", "パスワードは8文字以上必要です"))
      return
    }
    setBusy(true)
    const res = await api<{ id: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: regEmail.trim().toLowerCase(),
        password: regPassword,
        name: regName.trim(),
        handle: regHandle.trim() ? regHandle.trim().toLowerCase() : undefined,
        locale: regLocale,
      }),
    })
    if (!res.ok) {
      toast.error(res.error?.message === "An account with this email already exists"
        ? tr(locale, "An account with this email already exists", "このメールのアカウントは既に存在します")
        : res.error?.message || "Registration failed")
      setBusy(false)
      return
    }
    toast.success(tr(locale, "Account created — signing you in…", "アカウントを作成しました — ログイン中…"))
    await finishSignIn(regEmail.trim().toLowerCase(), regPassword)
    setBusy(false)
  }

  function prefill(email: string) {
    setSiEmail(email)
    setSiPassword(DEMO_PASSWORD)
    setTab("signin")
    toast.info(tr(locale, "Credentials filled — press Sign in", "入力しました — サインインを押してください"))
  }

  return (
    <div className="max-w-md mx-auto py-4">
      <FeedbackToaster />
      <div className="text-center mb-5">
        <div className="w-14 h-14 rounded-2xl tgs-gradient-teal mx-auto flex items-center justify-center mb-3" aria-hidden>
          <LogIn className="w-7 h-7 text-[#e5b93b]" />
        </div>
        <h1 className="text-xl font-extrabold tracking-tight">
          {tr(locale, "Welcome to Tengasell", "Tengasellへようこそ")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {tr(locale, "Zimbabwe's online auction marketplace — bid, sell, stay protected.", "ジンバブエのオンラインオークション — 入札・出品・安全な取引。")}
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "signin" | "register")}>
        <TabsList className="grid grid-cols-2 w-full mb-4">
          <TabsTrigger value="signin" className="min-h-11">{tr(locale, "Sign in", "ログイン")}</TabsTrigger>
          <TabsTrigger value="register" className="min-h-11">{tr(locale, "Register", "新規登録")}</TabsTrigger>
        </TabsList>

        <TabsContent value="signin">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tr(locale, "Sign in to your account", "アカウントにログイン")}</CardTitle>
              <CardDescription>
                {tr(locale, "Continue bidding, selling and messaging.", "入札・出品・メッセージを続ける。")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={doSignIn} className="space-y-3" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="si-email">Email · メール</Label>
                  <Input
                    id="si-email" type="email" inputMode="email" autoComplete="email"
                    value={siEmail} onChange={(e) => setSiEmail(e.target.value)}
                    placeholder="you@example.com" className="h-11" required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="si-password">{tr(locale, "Password", "パスワード")}</Label>
                  <Input
                    id="si-password" type="password" autoComplete="current-password"
                    value={siPassword} onChange={(e) => setSiPassword(e.target.value)}
                    placeholder="••••••••" className="h-11" required
                  />
                </div>
                <Button type="submit" className="w-full h-11 font-semibold" disabled={busy}>
                  {busy ? tr(locale, "Signing in…", "ログイン中…") : <><LogIn className="w-4 h-4 mr-1.5" />{tr(locale, "Sign in", "ログイン")}</>}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="shadow-sm mt-4 border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-[#b8860b]" aria-hidden />
                {tr(locale, "Demo accounts (sandbox)", "デモアカウント（サンドボックス）")}
              </CardTitle>
              <CardDescription className="text-xs">
                {tr(locale, `Password for all demo users: ${DEMO_PASSWORD}`, `全デモユーザーのパスワード: ${DEMO_PASSWORD}`)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 max-h-72 overflow-y-auto tgs-scroll pr-1" aria-label="Demo accounts list">
                {DEMO_ACCOUNTS.map((a) => (
                  <li key={a.email}>
                    <button
                      type="button"
                      onClick={() => prefill(a.email)}
                      className="w-full text-left flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 min-h-11 hover:bg-secondary transition-colors"
                      aria-label={`Prefill ${a.label}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-medium truncate">{a.email}</span>
                        <span className="block text-[11px] text-muted-foreground truncate">{a.label}</span>
                      </span>
                      <Badge
                        variant={a.kind === "staff" ? "default" : a.kind === "seller" ? "secondary" : "outline"}
                        className="text-[10px] shrink-0"
                      >
                        {a.kind === "staff" ? "Staff" : a.kind === "seller" ? "Seller" : "Buyer"}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="register">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{tr(locale, "Create your account", "アカウントを作成")}</CardTitle>
              <CardDescription>
                {tr(locale, "Buyers register free — selling requires verification later.", "購読者は無料 — 出品は後で審査が必要です。")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={doRegister} className="space-y-3" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-name">{tr(locale, "Full name", "氏名")}</Label>
                  <Input id="reg-name" value={regName} onChange={(e) => setRegName(e.target.value)}
                    placeholder={tr(locale, "e.g. Tariro Gumbo", "例: 山田 太郎")} className="h-11" required minLength={2} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-handle">{tr(locale, "Handle (optional)", "ハンドル（任意）")}</Label>
                  <Input id="reg-handle" value={regHandle} onChange={(e) => setRegHandle(e.target.value.replace(/[^a-z0-9_]/g, ""))}
                    placeholder="tariro_g" className="h-11" inputMode="text" maxLength={20} />
                  <p className="text-[11px] text-muted-foreground">{tr(locale, "Lowercase letters, numbers, underscores.", "小文字・数字・アンダースコア。")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-email">Email · メール</Label>
                  <Input id="reg-email" type="email" inputMode="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@example.com" className="h-11" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-password">{tr(locale, "Password", "パスワード")}</Label>
                  <Input id="reg-password" type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)}
                    placeholder={tr(locale, "At least 8 characters", "8文字以上")} className="h-11" required minLength={8} />
                  {regPassword && (
                    <div className="flex items-center gap-2 pt-1">
                      <Progress value={strength.pct} className="h-1.5 flex-1" aria-hidden />
                      <span className="text-[11px] text-muted-foreground w-14 text-right">{tr(locale, strength.label, strength.labelJa)}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-locale">{tr(locale, "Language", "言語")}</Label>
                  <Select value={regLocale} onValueChange={(v) => setRegLocale(v as "en" | "ja")}>
                    <SelectTrigger id="reg-locale" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator className="my-1" />
                <div className="space-y-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer" htmlFor="accept-terms">
                    <Checkbox id="accept-terms" checked={acceptTerms} onCheckedChange={(v) => setAcceptTerms(v === true)} className="mt-0.5" />
                    <span className="text-xs leading-relaxed">
                      {tr(locale, "I accept the ", "同意します: ")}
                      <button type="button" className="text-primary underline underline-offset-2 font-medium"
                        onClick={(e) => { e.preventDefault(); setView({ name: "policy", key: "terms" }) }}>
                        {tr(locale, "Terms of Service", "利用規約")}
                      </button>
                      <span className="text-destructive ml-0.5" aria-hidden>*</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 cursor-pointer" htmlFor="accept-privacy">
                    <Checkbox id="accept-privacy" checked={acceptPrivacy} onCheckedChange={(v) => setAcceptPrivacy(v === true)} className="mt-0.5" />
                    <span className="text-xs leading-relaxed">
                      {tr(locale, "I accept the ", "同意します: ")}
                      <button type="button" className="text-primary underline underline-offset-2 font-medium"
                        onClick={(e) => { e.preventDefault(); setView({ name: "policy", key: "privacy" }) }}>
                        {tr(locale, "Privacy Policy", "プライバシーポリシー")}
                      </button>
                      <span className="text-destructive ml-0.5" aria-hidden>*</span>
                    </span>
                  </label>
                </div>
                <Button type="submit" className="w-full h-11 font-semibold" disabled={busy}>
                  {busy ? tr(locale, "Creating…", "作成中…") : <><UserPlus className="w-4 h-4 mr-1.5" />{tr(locale, "Create account", "アカウント作成")}</>}
                </Button>
                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                  {tr(locale,
                    "Marketing emails are OFF by default (privacy-by-default). Transactional order and account notices are always sent.",
                    "マーケティングメールは初期設定でOFF（プライバシー規定）。取引通知は常に送信されます。")}
                </p>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
