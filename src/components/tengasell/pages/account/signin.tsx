"use client";

// Tengasell — Sign in page (#/signin). Task 5-a; MSCS 12-e platform gate.
//
// The sign-in is BFF-gated (auth-shared.tsx helpers):
//   1. POST /api/auth/login — password checked server-side; SUSPENSION gate
//      (trust /internal/status, fail-open) runs before any token is issued
//   2. MFA-active accounts get a 6-digit code step — the session token is
//      held by TrailBase/the BFF until POST /api/auth/mfa/verify matches
//   3. GET /api/auth/status re-checks suspension with the fresh token
//      BEFORE the session is adopted (a just-suspended account gets nothing)
//   4. session adoption → socket connect → refreshUser → sign-in activity
//      row (fire-and-forget /api/platform/session)
// Inline "Forgot password?" recovery: username → code → new password →
// auto sign-in. Sandbox honesty: the code is surfaced when comms runs mock
// providers (mirrors the comms wizard "Sandbox preview").
// Demo-mode fallback: if the BFF is unreachable the legacy direct sign-in
// path keeps the offline demo store usable.

import { useState, type FormEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  KeyRound,
  LifeBuoy,
  Loader2,
  LogIn,
  LogOut,
  MailQuestion,
  ShieldCheck,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuthCard,
  LinkButton,
  PasswordField,
  bffLogin,
  bffMfaVerify,
  finalizeSession,
  recoveryConfirm,
  recoveryStart,
  usernameValid,
} from "./auth-shared";
import { TengaLogo } from "@/components/tengasell/ui";
import { useAuth } from "@/lib/tengasell/auth";
import { getApiMode } from "@/lib/tengasell/api";
import { connectSocket } from "@/lib/tengasell/socket";
import { useI18n } from "@/lib/tengasell/i18n";
import { useRouter } from "@/lib/tengasell/router";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const DEMO_PASSWORD = "Tengasell#2025";
const DEMO_ACCOUNTS = [
  { username: "simba", role: "buyer" },
  { username: "rufaro", role: "seller" },
  { username: "admin", role: "admin" },
] as const;

type Mode = "form" | "mfa" | "suspended" | "recovery-user" | "recovery-reset";

/**
 * Referrer-free heuristic for "came from an in-app page": history has more
 * than one entry AND the app did not boot directly onto #/signin (a fresh
 * load here means there is no in-app page to go back to).
 */
function hasInAppBackTarget(): boolean {
  if (typeof window === "undefined" || window.history.length <= 1) return false;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav && (nav.name || "").includes("#/signin")) return false;
  } catch {
    /* ignore */
  }
  return true;
}

export default function SignInPage() {
  const { user, loading: authLoading, signIn, signOut, refreshUser } = useAuth();
  const router = useRouter();
  const { t } = useI18n();
  const reduced = useReducedMotion();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // MFA challenge state — the session token is NOT here: it stays with
  // TrailBase (mfa_token challenge) or the BFF (trust_pending id) until the
  // code verifies.
  const [mode, setMode] = useState<Mode>("form");
  const [challenge, setChallenge] = useState<{ mfaToken?: string; trustPending?: string; username: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [suspendedReason, setSuspendedReason] = useState<string | null>(null);

  // recovery flow state
  const [recoveryUser, setRecoveryUser] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPw, setRecoveryPw] = useState("");
  const [recoveryPw2, setRecoveryPw2] = useState("");
  const [sandboxCode, setSandboxCode] = useState<string | null>(null);

  /** Adopt the verified token: status re-check → storage → socket → user. */
  const adoptSession = async (token: string, uname: string): Promise<boolean> => {
    const fin = await finalizeSession(token, uname);
    if (!fin.ok) {
      setSuspendedReason(null);
      setMode("suspended");
      setChallenge(null);
      setPassword("");
      setSubmitting(false);
      return false;
    }
    if (getApiMode() === "live") {
      await connectSocket(token).catch(() => {});
    }
    await refreshUser();
    return true;
  };

  /** The full gated pipeline (also the recovery auto-sign-in path). */
  const runGatedLogin = async (uname: string, pw: string): Promise<boolean> => {
    const res = await bffLogin(uname, pw);
    if (res.kind === "suspended") {
      setSuspendedReason(res.reason ?? null);
      setMode("suspended");
      setSubmitting(false);
      return false;
    }
    if (res.kind === "mfa") {
      setChallenge({ mfaToken: res.mfaToken, trustPending: res.trustPending, username: res.username });
      setMfaCode("");
      setMode("mfa");
      setSubmitting(false);
      return false;
    }
    if (res.kind === "unreachable") {
      // BFF unreachable (offline/demo environment) → legacy direct path so
      // the demo store keeps working. Documented fallback, never silent.
      const legacy = await signIn(uname, pw);
      if (!legacy.ok) {
        setError(legacy.error || res.error);
        setSubmitting(false);
        return false;
      }
      toast({ title: "Mhoro 👋", description: "You're signed in — welcome back to Tengasell." });
      if (hasInAppBackTarget()) router.back();
      else router.navigate("/");
      return true;
    }
    if (res.kind === "error") {
      setError(res.error);
      setSubmitting(false);
      return false;
    }
    // gates passed (or no MFA) — final pre-storage suspension check
    const adopted = await adoptSession(res.token, res.username);
    if (!adopted) return false;
    toast({ title: "Mhoro 👋", description: "You're signed in — welcome back to Tengasell." });
    if (hasInAppBackTarget()) router.back();
    else router.navigate("/");
    return true;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const uname = username.trim().toLowerCase();
    if (!uname || !password) {
      setError("Enter your username and password to continue.");
      return;
    }
    setSubmitting(true);
    try {
      await runGatedLogin(uname, password);
    } catch {
      setError("Could not reach the sign-in service. Please try again.");
      setSubmitting(false);
    }
  };

  const submitMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !challenge) return;
    setError(null);
    if (!/^\d{6}$/.test(mfaCode)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    const res = await bffMfaVerify({ mfaToken: challenge.mfaToken, trustPending: challenge.trustPending }, mfaCode);
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return; // stay on the code step — retry allowed, session never stored
    }
    const adopted = await adoptSession(res.token, challenge.username);
    if (!adopted) return;
    toast({
      title: "Verified 🔐",
      description: "Two-factor code accepted — you're signed in.",
    });
    if (hasInAppBackTarget()) router.back();
    else router.navigate("/");
  };

  const startRecovery = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const uname = recoveryUser.trim().toLowerCase();
    if (!usernameValid(uname)) {
      setError("Enter the username on the account.");
      return;
    }
    setSubmitting(true);
    const res = await recoveryStart(uname);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? "Could not start the recovery. Try again.");
      return;
    }
    setSandboxCode(typeof res.code === "string" ? res.code : null);
    setMode("recovery-reset");
  };

  const submitRecovery = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const uname = recoveryUser.trim().toLowerCase();
    if (!/^\d{6}$/.test(recoveryCode.trim())) {
      setError("Enter the 6-digit code we sent you.");
      return;
    }
    if (recoveryPw.length < 8) {
      setError("New passwords must be at least 8 characters.");
      return;
    }
    if (recoveryPw !== recoveryPw2) {
      setError("The new passwords don't match.");
      return;
    }
    setSubmitting(true);
    const res = await recoveryConfirm({ username: uname, code: recoveryCode.trim(), newPassword: recoveryPw });
    if (!res.ok) {
      setError(res.error ?? "That code isn't right or has expired.");
      setSubmitting(false);
      return;
    }
    toast({ title: "Password updated", description: "Signing you in with your new password…" });
    setUsername(uname);
    setPassword(recoveryPw);
    await runGatedLogin(uname, recoveryPw);
  };

  const resetToForm = () => {
    setMode("form");
    setChallenge(null);
    setError(null);
    setMfaCode("");
    setSandboxCode(null);
    setPassword("");
  };

  // ── while the session is being restored, keep the layout calm ─────
  if (authLoading) {
    return (
      <Centered>
        <div className="w-full max-w-md rounded-card border border-border bg-raised p-6 sm:p-8 space-y-4">
          <div className="flex justify-center">
            <Skeleton className="size-11 rounded-control" />
          </div>
          <Skeleton className="h-6 w-40 mx-auto" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Centered>
    );
  }

  // ── already signed in ─────────────────────────────────────────────
  if (user) {
    return (
      <Centered>
        <div className="w-full max-w-md rounded-card border border-border bg-raised p-6 sm:p-8 text-center space-y-4">
          <TengaLogo size={44} />
          <div>
            <h1 className="text-headline text-foreground">You&apos;re signed in</h1>
            <p className="text-body text-muted-foreground mt-1">
              {user.profile?.display_name ?? user.username} ·{" "}
              <span className="text-teal font-semibold">@{user.username}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <LinkButton to="/my" className="w-full">
              <User className="size-4" aria-hidden="true" />
              {t("nav.my")}
            </LinkButton>
            <Button
              variant="outline"
              className="h-11 w-full text-label"
              onClick={async () => {
                await signOut();
                toast({ title: "Signed out", description: "See you soon — mhoro zvakanaka." });
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
              {t("nav.signout")}
            </Button>
          </div>
        </div>
      </Centered>
    );
  }

  // ── SUSPENDED — blocked state, nothing was stored ─────────────────
  if (mode === "suspended") {
    return (
      <Centered>
        <div className="w-full max-w-md">
          <div className="rounded-card border border-danger/40 bg-raised p-6 sm:p-8 shadow-sm">
            <div className="flex flex-col items-center text-center gap-2">
              <span className="grid size-14 place-items-center rounded-full bg-danger/10">
                <Ban className="size-7 text-danger" aria-hidden="true" />
              </span>
              <h1 className="text-headline text-foreground">{t("security.suspended.title")}</h1>
              <p className="text-body text-muted-foreground">{t("security.suspended.body")}</p>
            </div>
            {suspendedReason && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-control border border-danger/30 bg-danger/5 p-3"
              >
                <AlertCircle className="size-4 mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <p className="text-body text-danger">{suspendedReason}</p>
              </div>
            )}
            <div className="mt-5 rounded-control border border-border bg-teal-tint/60 p-4 space-y-2.5">
              <p className="text-label font-bold text-teal-deep">{t("security.suspended.appeal")}</p>
              <ol className="list-decimal ms-5 space-y-1.5 text-body text-foreground/90">
                <li>
                  {t("security.suspended.step1")}{" "}
                  <a href="#/help" className="text-teal font-bold hover:underline">
                    {t("security.suspended.helpLink")}
                  </a>{" "}
                  {t("security.suspended.step1b")}
                </li>
                <li>{t("security.suspended.step2")}</li>
                <li>
                  {t("security.suspended.step3")}{" "}
                  <a href="#/policies/tos" className="text-teal font-bold hover:underline">
                    {t("security.suspended.tosLink")}
                  </a>
                </li>
              </ol>
            </div>
            <Button variant="outline" className="mt-5 h-11 w-full text-label" onClick={resetToForm}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("security.suspended.back")}
            </Button>
          </div>
          <p className="text-center text-caption text-muted-foreground mt-4">
            {t("security.suspended.footer")}
          </p>
        </div>
      </Centered>
    );
  }

  // ── MFA code step — token deliberately NOT in this component ──────
  if (mode === "mfa" && challenge) {
    return (
      <Centered>
        <AuthCard title={t("security.mfa.stepTitle")} subtitle={t("security.mfa.stepSub")}>
          <form onSubmit={submitMfa} noValidate className="space-y-4">
            <div className="flex items-center gap-2.5 rounded-control border border-teal/25 bg-teal-tint p-3">
              <ShieldCheck className="size-5 shrink-0 text-teal-deep" aria-hidden="true" />
              <p className="text-caption text-teal-deep">{t("security.mfa.stepNote")}</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mfa-code" className="text-label font-semibold">
                {t("security.mfa.codeLabel")} <span className="text-muted-foreground ts-numeric">@{challenge.username}</span>
              </label>
              <input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                aria-invalid={error ? true : undefined}
                autoFocus
                className="ts-numeric flex h-12 w-full min-w-0 rounded-input border border-input bg-transparent px-3 text-center text-title tracking-[0.35em] shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              />
            </div>
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/5 p-3"
              >
                <AlertCircle className="size-4 mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <p className="text-body text-danger">{error}</p>
              </div>
            )}
            <Button type="submit" disabled={submitting} className="h-12 w-full text-base font-bold">
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("security.mfa.verifying")}
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  {t("security.mfa.verify")}
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={resetToForm}
              className="mx-auto flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-semibold text-teal hover:bg-accent/60"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("security.mfa.startOver")}
            </button>
          </form>
        </AuthCard>
      </Centered>
    );
  }

  // ── recovery: username → code ─────────────────────────────────────
  if (mode === "recovery-user") {
    return (
      <Centered>
        <AuthCard title={t("security.recovery.title")} subtitle={t("security.recovery.sub")}>
          <form onSubmit={startRecovery} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="recovery-username" className="text-label font-semibold">
                {t("security.recovery.usernameLabel")}
              </label>
              <input
                id="recovery-username"
                type="text"
                value={recoveryUser}
                onChange={(e) => setRecoveryUser(e.target.value.toLowerCase())}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="simba"
                aria-invalid={error ? true : undefined}
                className="flex h-11 w-full min-w-0 rounded-input border border-input bg-transparent px-3 text-body shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              />
            </div>
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/5 p-3">
                <AlertCircle className="size-4 mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <p className="text-body text-danger">{error}</p>
              </div>
            )}
            <Button type="submit" disabled={submitting} className="h-12 w-full text-base font-bold">
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("security.recovery.sending")}
                </>
              ) : (
                <>
                  <MailQuestion className="size-4" aria-hidden="true" />
                  {t("security.recovery.send")}
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={resetToForm}
              className="mx-auto flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-semibold text-teal hover:bg-accent/60"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("security.recovery.back")}
            </button>
          </form>
        </AuthCard>
      </Centered>
    );
  }

  // ── recovery: code + new password ─────────────────────────────────
  if (mode === "recovery-reset") {
    return (
      <Centered>
        <AuthCard
          title={t("security.recovery.resetTitle")}
          subtitle={t("security.recovery.resetSub")}
        >
          <form onSubmit={submitRecovery} noValidate className="space-y-4">
            {sandboxCode && (
              <div className="rounded-control border border-gold/50 bg-gold-soft p-3.5">
                <p className="text-label font-bold text-gold-deep">{t("security.recovery.sandboxTitle")}</p>
                <p className="text-caption text-gold-deep/90 mt-0.5">{t("security.recovery.sandboxBody")}</p>
                <p className="ts-numeric mt-1.5 text-title font-bold tracking-[0.3em] text-gold-deep" aria-label={`${t("security.recovery.codeLabel")} ${sandboxCode}`}>
                  {sandboxCode}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="recovery-code" className="text-label font-semibold">
                {t("security.recovery.codeLabel")}
              </label>
              <input
                id="recovery-code"
                type="text"
                inputMode="numeric"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                aria-invalid={error ? true : undefined}
                className="ts-numeric flex h-11 w-full min-w-0 rounded-input border border-input bg-transparent px-3 text-center text-body tracking-[0.3em] shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              />
            </div>
            <PasswordField
              id="recovery-pw"
              label={t("security.recovery.newPw")}
              value={recoveryPw}
              onChange={setRecoveryPw}
              autoComplete="new-password"
              placeholder={t("security.recovery.newPwHint")}
            />
            <PasswordField
              id="recovery-pw2"
              label={t("security.recovery.newPw2")}
              value={recoveryPw2}
              onChange={setRecoveryPw2}
              autoComplete="new-password"
              placeholder={t("security.recovery.newPwHint")}
            />
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/5 p-3">
                <AlertCircle className="size-4 mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                <p className="text-body text-danger">{error}</p>
              </div>
            )}
            <Button type="submit" disabled={submitting} className="h-12 w-full text-base font-bold">
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("security.recovery.saving")}
                </>
              ) : (
                <>
                  <KeyRound className="size-4" aria-hidden="true" />
                  {t("security.recovery.save")}
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={resetToForm}
              className="mx-auto flex min-h-11 items-center gap-1.5 rounded-control px-3 text-label font-semibold text-teal hover:bg-accent/60"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("security.recovery.back")}
            </button>
          </form>
        </AuthCard>
      </Centered>
    );
  }

  // ── sign-in form ──────────────────────────────────────────────────
  return (
    <Centered>
      <AuthCard
        title="Welcome back"
        subtitle="a snap to your happy deal"
        footer={
          <>
            New to Tengasell?{" "}
            <a
              href="#/register"
              onClick={(e) => {
                e.preventDefault();
                router.navigate("/register");
              }}
              className="text-teal font-bold hover:underline"
            >
              Create your free account
            </a>
          </>
        }
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="signin-username" className="text-label font-semibold">
              Username
            </label>
            <input
              id="signin-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="simba"
              aria-invalid={error ? true : undefined}
              className="flex h-11 w-full min-w-0 rounded-input border border-input bg-transparent px-3 text-body shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
            />
          </div>

          <PasswordField
            id="signin-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            placeholder="••••••••••"
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setMode("recovery-user");
                setError(null);
                setSandboxCode(null);
                setRecoveryCode("");
                setRecoveryPw("");
                setRecoveryPw2("");
              }}
              className="flex min-h-11 items-center rounded-control px-1 text-label font-semibold text-teal hover:underline"
            >
              {t("security.recovery.forgot")}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/5 p-3"
            >
              <AlertCircle className="size-4 mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              <p className="text-body text-danger">{error}</p>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="h-12 w-full text-base font-bold"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                <LogIn className="size-4" aria-hidden="true" />
                {t("nav.signin")}
              </>
            )}
          </Button>
        </form>

        {/* demo credential helper (teal-tint) */}
        <div className="mt-5 rounded-control border border-teal/25 bg-teal-tint p-3.5">
          <p className="text-label font-bold text-teal-deep">Try the demo</p>
          <p className="text-caption text-muted-foreground mt-0.5">
            buyer <code className="font-mono text-teal-deep font-bold">simba</code> ·
            seller <code className="font-mono text-teal-deep font-bold">rufaro</code> ·
            admin <code className="font-mono text-teal-deep font-bold">admin</code> —
            password <code className="font-mono text-teal-deep font-bold">Tengasell#2025</code>
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {DEMO_ACCOUNTS.map((acc) => (
              <motion.button
                key={acc.username}
                type="button"
                whileTap={reduced ? undefined : { scale: 0.96 }}
                onClick={() => {
                  setUsername(acc.username);
                  setPassword(DEMO_PASSWORD);
                  setError(null);
                }}
                aria-label={`Fill demo credentials for ${acc.username} (${acc.role})`}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-teal/30 bg-raised px-3.5 text-label font-semibold text-teal-deep",
                  "hover:border-teal hover:bg-raised/80 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                )}
              >
                <span className="ts-numeric">@{acc.username}</span>
                <span className="text-caption text-muted-foreground font-medium">{acc.role}</span>
              </motion.button>
            ))}
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-caption text-muted-foreground">
            <LifeBuoy className="mt-px size-3.5 shrink-0 text-teal" aria-hidden="true" />
            {t("security.signin.gatedNote")}
          </p>
        </div>
      </AuthCard>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10 sm:py-14">
      {children}
    </div>
  );
}
