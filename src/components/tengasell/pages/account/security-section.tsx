"use client";

// Tengasell — Security section (My Tengasell → Security). MSCS 12-e.
//
// The account security centre, backed by the platform BFF:
//   · MFA card (IAM-004): TOTP enrollment (secret + otpauth URI shown for
//     manual authenticator entry — QR-less by design), live-code activation,
//     8 one-time recovery codes shown EXACTLY ONCE with copy + "I saved
//     them" acknowledgment, disable with a live code (AlertDialog — a
//     stolen session cannot silently remove MFA)
//   · Password change card (IAM-003/016): current + new + repeat →
//     POST /api/auth/password/change → signed out for re-sign-in
//   · Recent sign-in activity (IAM-017): the last 8 account:signin audit
//     rows (recorded by the gated sign-in flow via /api/platform/session)
//   · Account status: suspension state (trust authority, fail-open honest
//     provisioning note) + staff roles
// All fetches RELATIVE /api/auth/* (BFF, 401 unsigned).

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Check,
  ClipboardCopy,
  KeyRound,
  LifeBuoy,
  Loader2,
  Lock,
  LogIn,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/tengasell/ui";
import { PasswordField } from "./auth-shared";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useRouter } from "@/lib/tengasell/router";
import { formatRelative } from "@/lib/tengasell/format";
import { toast } from "@/hooks/use-toast";
import { useResource } from "@/lib/tengasell/hooks";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/tengasell/types";

interface SecurityState {
  ok: boolean;
  username: string;
  mfa_active: boolean;
  has_recovery_codes: boolean;
  suspension: { suspended: boolean; reason: string | null; at: string | null } | null;
  trust_available: boolean;
  roles: string[];
  recent_signins: { at: string; ip: string; ua: string; result: string }[];
}

export function SecuritySection({ user }: { user: CurrentUser }) {
  return (
    <section aria-labelledby="security-heading" className="min-w-0">
      <header className="mb-4">
        <h2 id="security-heading" className="text-sectionTitle text-foreground">
          {/* my.security.title */}
          Security
        </h2>
        <p className="text-caption text-muted-foreground mt-0.5">
          Two-factor authentication, your password, and sign-in history for @{user.username}.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <MfaCard user={user} />
        <PasswordCard />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SigninActivityCard user={user} />
        <StatusCard user={user} />
      </div>
    </section>
  );
}

// ── shared fetch helper (BFF, Bearer) ────────────────────────────────────

async function secFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  token?: string,
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token ?? ""}`,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data;
}

// ── MFA card ─────────────────────────────────────────────────────────────

function MfaCard({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const token = user.token;
  const [step, setStep] = useState<"idle" | "enroll" | "codes">("idle");
  const [enroll, setEnroll] = useState<{ totp_url: string; secret: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  const state = useResource<SecurityState>(
    async () => secFetch<SecurityState>("/api/auth/security/state", {}, token),
    [token],
  );
  const active = state.data?.mfa_active ?? false;

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const d = await secFetch<{ totp_url: string; secret: string | null }>(
        "/api/auth/security/mfa/start",
        { method: "POST" },
        token,
      );
      setEnroll(d);
      setCode("");
      setStep("enroll");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start enrollment.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!enroll || busy) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("security.mfa.codeError"));
      return;
    }
    setBusy(true);
    try {
      const d = await secFetch<{ recovery_codes: string[] }>(
        "/api/auth/security/mfa/confirm",
        { method: "POST", body: { totp_url: enroll.totp_url, code } },
        token,
      );
      setCodes(d.recovery_codes ?? []);
      setSaved(false);
      setStep("codes");
      void state.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't match. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setDisableError(null);
    if (!/^\d{6}$/.test(disableCode)) {
      setDisableError(t("security.mfa.codeError"));
      return;
    }
    setBusy(true);
    try {
      await secFetch("/api/auth/security/mfa/disable", { method: "POST", body: { code: disableCode } }, token);
      toast({ title: t("security.mfa.offToast"), description: t("security.mfa.offToastBody") });
      setDisableOpen(false);
      setDisableCode("");
      setStep("idle");
      setEnroll(null);
      void state.reload();
    } catch (err) {
      setDisableError(err instanceof Error ? err.message : "That code isn't right.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("security.copied"), description: label });
    } catch {
      toast({ title: t("security.copyFailed"), description: label });
    }
  };

  return (
    <div className="rounded-card border border-border bg-raised p-4 sm:p-6 min-w-0">
      <div className="flex items-start gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", active ? "bg-ok/10" : "bg-gold-soft")}>
          <Smartphone className={cn("size-5", active ? "text-ok" : "text-gold-deep")} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-label font-bold text-foreground">{t("security.mfa.title")}</h3>
          <p className="text-caption text-muted-foreground mt-0.5">{t("security.mfa.sub")}</p>
        </div>
        {state.loading && !state.data ? null : (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-caption font-bold",
              active ? "border-ok/40 bg-ok/10 text-ok" : "border-gold-deep/40 bg-gold-soft text-gold-deep",
            )}
          >
            {active ? t("security.mfa.on") : t("security.mfa.off")}
          </span>
        )}
      </div>

      <div className="mt-4">
        {state.loading && !state.data ? (
          <div className="space-y-2.5" aria-busy="true">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : step === "codes" && codes ? (
          <div className="space-y-3">
            <div className="rounded-control border border-gold/50 bg-gold-soft p-3.5">
              <p className="text-label font-bold text-gold-deep">{t("security.mfa.codesTitle")}</p>
              <p className="text-caption text-gold-deep/90 mt-0.5">{t("security.mfa.codesOnce")}</p>
              <ul className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {codes.map((c) => (
                  <li key={c} className="ts-numeric rounded-control border border-gold-deep/30 bg-raised px-3 py-2 text-body font-bold text-gold-deep">
                    {c}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="h-11 text-label"
                  onClick={() => copy(codes.join("\n"), t("security.mfa.codesCopied"))}
                >
                  <ClipboardCopy className="size-4" aria-hidden="true" />
                  {t("security.mfa.copyAll")}
                </Button>
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2.5 rounded-control border border-border px-3.5 cursor-pointer">
              <Checkbox
                checked={saved}
                onCheckedChange={(v) => setSaved(v === true)}
                aria-label={t("security.mfa.savedLabel")}
              />
              <span className="text-body">{t("security.mfa.savedLabel")}</span>
            </label>
            <Button className="h-11 w-full text-label font-bold" disabled={!saved} onClick={() => setStep("idle")}>
              <Check className="size-4" aria-hidden="true" />
              {t("security.mfa.done")}
            </Button>
          </div>
        ) : step === "enroll" && enroll ? (
          <form onSubmit={confirm} className="space-y-3.5">
            <div className="rounded-control border border-teal/25 bg-teal-tint p-3.5 space-y-2.5">
              <div>
                <p className="text-label font-bold text-teal-deep">{t("security.mfa.secretLabel")}</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="ts-numeric min-w-0 flex-1 overflow-x-auto ts-scrollbar rounded-control border border-teal/30 bg-raised px-2.5 py-2 text-body font-bold text-teal-deep whitespace-nowrap">
                    {enroll.secret ?? "—"}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 shrink-0"
                    aria-label={t("security.mfa.copySecret")}
                    onClick={() => copy(enroll.secret ?? "", t("security.mfa.secretLabel"))}
                  >
                    <ClipboardCopy className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-label font-bold text-teal-deep">{t("security.mfa.uriLabel")}</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-control border border-teal/30 bg-raised px-2.5 py-2 text-caption text-teal-deep">
                    {enroll.totp_url}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    className="size-11 shrink-0"
                    aria-label={t("security.mfa.copyUri")}
                    onClick={() => copy(enroll.totp_url, t("security.mfa.uriLabel"))}
                  >
                    <ClipboardCopy className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <p className="text-caption text-teal-deep/80">{t("security.mfa.manualNote")}</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mfa-enroll-code" className="text-label font-semibold">
                {t("security.mfa.activateLabel")}
              </label>
              <input
                id="mfa-enroll-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                aria-invalid={error ? true : undefined}
                className="ts-numeric flex h-11 w-full min-w-0 rounded-input border border-input bg-transparent px-3 text-center text-body tracking-[0.3em] shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
              />
            </div>
            {error && (
              <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                <AlertCircle className="size-3.5 mt-px shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button type="submit" disabled={busy} className="h-11 flex-1 text-label font-bold">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
                {t("security.mfa.activate")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 text-label"
                onClick={() => {
                  setStep("idle");
                  setEnroll(null);
                  setError(null);
                }}
              >
                {t("security.mfa.cancel")}
              </Button>
            </div>
          </form>
        ) : active ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-control border border-ok/30 bg-ok/5 p-3">
              <BadgeCheck className="size-4 mt-0.5 shrink-0 text-ok" aria-hidden="true" />
              <p className="text-caption text-foreground/90">{t("security.mfa.onNote")}</p>
            </div>
            <p className="text-caption text-muted-foreground">
              {state.data?.has_recovery_codes
                ? t("security.mfa.codesOnFile")
                : t("security.mfa.noCodes")}
            </p>
            <AlertDialog open={disableOpen} onOpenChange={(v) => { setDisableOpen(v); setDisableError(null); }}>
              <Button variant="outline" className="h-11 w-full text-label text-danger border-danger/40 hover:bg-danger/10" onClick={() => setDisableOpen(true)}>
                <ShieldOff className="size-4" aria-hidden="true" />
                {t("security.mfa.disable")}
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("security.mfa.disableTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("security.mfa.disableBody")} <span className="text-foreground font-semibold">@{user.username}</span>.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-1.5">
                  <label htmlFor="mfa-disable-code" className="text-label font-semibold">
                    {t("security.mfa.disableCode")}
                  </label>
                  <input
                    id="mfa-disable-code"
                    type="text"
                    inputMode="numeric"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    className="ts-numeric flex h-11 w-full rounded-input border border-input bg-transparent px-3 text-center tracking-[0.3em] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  />
                  {disableError && (
                    <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                      <AlertCircle className="size-3.5 mt-px shrink-0" aria-hidden="true" />
                      {disableError}
                    </p>
                  )}
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-11">{t("security.mfa.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    className="h-11 bg-danger text-white hover:bg-danger/90"
                    onClick={(e) => {
                      e.preventDefault();
                      void disable();
                    }}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldOff className="size-4" aria-hidden="true" />}
                    {t("security.mfa.disableConfirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-control border border-gold/40 bg-gold-soft/60 p-3">
              <AlertCircle className="size-4 mt-0.5 shrink-0 text-gold-deep" aria-hidden="true" />
              <p className="text-caption text-foreground/90">{t("security.mfa.offNote")}</p>
            </div>
            {error && (
              <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                <AlertCircle className="size-3.5 mt-px shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
            <Button className="h-11 w-full text-label font-bold" disabled={busy} onClick={start}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
              {t("security.mfa.enable")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── password change card ─────────────────────────────────────────────────

function PasswordCard() {
  const { user, signOut } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = repeat.length > 0 && repeat !== next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!current || next.length < 8) {
      setError(t("security.pw.rules"));
      return;
    }
    if (next !== repeat) {
      setError(t("security.pw.mismatch"));
      return;
    }
    setBusy(true);
    try {
      if (!user) throw new Error("Not signed in.");
      await secFetch(
        "/api/auth/password/change",
        { method: "POST", body: { old_password: current, new_password: next } },
        user.token,
      );
      toast({ title: t("security.pw.changed"), description: t("security.pw.changedBody") });
      setCurrent("");
      setNext("");
      setRepeat("");
      await signOut();
      router.navigate("/signin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-border bg-raised p-4 sm:p-6 min-w-0">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-teal-tint">
          <Lock className="size-5 text-teal-deep" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-label font-bold text-foreground">{t("security.pw.title")}</h3>
          <p className="text-caption text-muted-foreground mt-0.5">{t("security.pw.sub")}</p>
        </div>
      </div>
      <form onSubmit={submit} noValidate className="mt-4 space-y-3.5">
        <PasswordField
          id="pw-current"
          label={t("security.pw.current")}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          placeholder="••••••••••"
        />
        <PasswordField
          id="pw-new"
          label={t("security.pw.new")}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          placeholder={t("security.pw.newHint")}
          error={mismatch ? null : next.length > 0 && next.length < 8 ? t("security.pw.rules") : null}
        />
        <PasswordField
          id="pw-repeat"
          label={t("security.pw.repeat")}
          value={repeat}
          onChange={setRepeat}
          autoComplete="new-password"
          placeholder={t("security.pw.newHint")}
          error={mismatch ? t("security.pw.mismatch") : null}
        />
        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
            <AlertCircle className="size-3.5 mt-px shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-11 w-full text-label font-bold">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
          {t("security.pw.submit")}
        </Button>
        <p className="text-caption text-muted-foreground">{t("security.pw.note")}</p>
      </form>
    </div>
  );
}

// ── recent sign-in activity ──────────────────────────────────────────────

function SigninActivityCard({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const state = useResource<SecurityState>(
    async () => secFetch<SecurityState>("/api/auth/security/state", {}, user.token),
    [user.token],
  );
  const rows = useMemo(() => state.data?.recent_signins ?? [], [state.data]);
  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden min-w-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <LogIn className="size-4 text-teal-soft" aria-hidden="true" />
        <h3 className="text-label font-bold text-foreground">{t("security.signins.title")}</h3>
        <span className="ms-auto text-caption text-muted-foreground">{t("security.signins.caption")}</span>
      </div>
      {state.loading && !state.data ? (
        <div className="px-4 py-3 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3 items-center">
              <Skeleton className="size-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : state.error ? (
        <div className="p-4">
          <ErrorState message={state.error} onRetry={state.reload} />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-caption text-muted-foreground">
          {t("security.signins.empty")}
        </p>
      ) : (
        <ul className="max-h-96 overflow-y-auto ts-scrollbar divide-y divide-border/60">
          {rows.map((r, i) => (
            <li key={i} className="flex gap-3 items-center px-4 py-3">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", r.result === "ok" ? "bg-ok/10" : "bg-danger/10")}>
                {r.result === "ok" ? <Check className="size-4 text-ok" aria-hidden="true" /> : <AlertCircle className="size-4 text-danger" aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-label font-semibold text-foreground truncate">
                  {r.result === "ok" ? t("security.signins.ok") : t("security.signins.blocked")}
                </p>
                <p className="text-caption text-muted-foreground truncate">
                  <span className="ts-numeric">{r.ip || "—"}</span> · {r.ua ? r.ua.slice(0, 60) : "—"}
                </p>
              </div>
              <time className="shrink-0 text-caption text-muted-foreground" dateTime={r.at}>
                {formatRelative(r.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── account status card ──────────────────────────────────────────────────

function StatusCard({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const state = useResource<SecurityState>(
    async () => secFetch<SecurityState>("/api/auth/security/state", {}, user.token),
    [user.token],
  );
  const d = state.data;
  const suspended = d?.suspension?.suspended === true;
  return (
    <div className="rounded-card border border-border bg-raised p-4 sm:p-6 min-w-0">
      <div className="flex items-start gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", suspended ? "bg-danger/10" : "bg-ok/10")}>
          {suspended ? <AlertCircle className="size-5 text-danger" aria-hidden="true" /> : <ShieldCheck className="size-5 text-ok" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <h3 className="text-label font-bold text-foreground">{t("security.status.title")}</h3>
          <p className="text-caption text-muted-foreground mt-0.5">{t("security.status.sub")}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {state.loading && !d ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : (
          <>
            <StatusRow label={t("security.status.account")} value={suspended ? t("security.status.suspended") : t("security.status.good")} danger={suspended} />
            {suspended && d?.suspension?.reason && (
              <p className="text-caption text-danger ps-1">{d.suspension.reason}</p>
            )}
            <StatusRow label={t("security.status.mfa")} value={d?.mfa_active ? t("security.status.mfaOn") : t("security.status.mfaOff")} />
            <StatusRow
              label={t("security.status.roles")}
              value={d?.roles?.length ? d.roles.join(", ") : t("security.status.noRoles")}
            />
            <StatusRow
              label={t("security.status.trust")}
              value={d?.trust_available ? t("security.status.trustUp") : t("security.status.trustDown")}
              warn={d ? !d.trust_available : false}
            />
            {!d?.trust_available && (
              <p className="flex items-start gap-1.5 text-caption text-gold-deep">
                <LifeBuoy className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {t("security.status.trustNote")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatusRow({ label, value, danger, warn }: { label: string; value: string; danger?: boolean; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-body text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-label font-bold text-end",
          danger ? "text-danger" : warn ? "text-gold-deep" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
