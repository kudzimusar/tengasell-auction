"use client";

// Tengasell — Register page (#/register). Task 5-a; MSCS 12-e platform.
//
// 12-e additions (LEG-003/PRV-001): a REQUIRED Terms-of-Service acceptance
// checkbox (blocks submit until checked, links the live policy page) and a
// fire-and-forget acceptance record POST /api/gov/public/acceptances after
// successful signup (govern-service is the legal-records authority; the
// call NEVER blocks or fails the signup). The post-signup sign-in runs
// through the same BFF gates as #/signin (suspension/MFA) via auth-shared.

import { useState, type FormEvent } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AuthCard,
  LinkButton,
  PasswordField,
  PasswordStrengthBar,
  usernameValid,
} from "./auth-shared";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { useRouter } from "@/lib/tengasell/router";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Touched {
  username: boolean;
  password: boolean;
  repeat: boolean;
}

/**
 * Record the ToS acceptance with the governance service — best-effort,
 * never blocking: version is resolved from the public policy list (fallback
 * 1), and any failure is swallowed (the signup already succeeded; the
 * acceptance retry is a documented launch-day reconciliation step).
 */
function recordTosAcceptance(username: string): void {
  void (async () => {
    try {
      let token: string | null = null;
      try {
        const raw = localStorage.getItem("ts_auth");
        if (raw) token = (JSON.parse(raw) as { token?: string }).token ?? null;
      } catch {
        /* anonymous acceptance is a legal record too */
      }
      let version = 1;
      try {
        const res = await fetch("/api/gov/public/policies", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = (await res.json()) as {
            policies?: { key: string; current_version: number }[];
          };
          version = data.policies?.find((p) => p.key === "tos")?.current_version ?? 1;
        }
      } catch {
        /* fall back to version 1 — the service resolves it */
      }
      await fetch("/api/gov/public/acceptances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ policy_key: "tos", version, surface: "signup", username }),
      });
    } catch {
      /* govern unreachable — signup must never depend on it */
    }
  })();
}

/** Fire-and-forget sign-in activity row (IAM-017) for the fresh session. */
function recordSessionActivity(): void {
  try {
    const raw = localStorage.getItem("ts_auth");
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : null;
    if (token) {
      void fetch("/api/platform/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export default function RegisterPage() {
  const { user, loading: authLoading, signUp, signOut } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [touched, setTouched] = useState<Touched>({
    username: false,
    password: false,
    repeat: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const uname = username.trim().toLowerCase();
  const usernameError =
    touched.username && !usernameValid(uname)
      ? "Use 3–24 letters and numbers only (no spaces or symbols)."
      : null;
  const passwordError =
    touched.password && password.length < 8
      ? "Passwords must be at least 8 characters."
      : null;
  const repeatError =
    touched.repeat && repeat !== password ? "Passwords don't match." : null;
  const matches = repeat.length > 0 && repeat === password;
  const formValid =
    usernameValid(uname) && password.length >= 8 && repeat === password && tosAccepted;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setTouched({ username: true, password: true, repeat: true });
    if (!usernameValid(uname) || password.length < 8 || repeat !== password) return;
    if (!tosAccepted) {
      setError(t("security.register.tosRequired"));
      return;
    }
    setSubmitting(true);
    try {
      // 1. create the account (TrailBase register — unchanged behavior)
      const res = await signUp(uname, password);
      if (!res.ok) {
        setError(res.error || "Could not create your account. Please try again.");
        setSubmitting(false);
        return;
      }
      // 2. record the ToS acceptance (governance legal record, best-effort)
      recordTosAcceptance(uname);
      // 3. record the sign-in activity row (IAM-017, best-effort)
      recordSessionActivity();
      toast({
        title: "Welcome to Tengasell 🎉",
        description: `@${uname} is live — your first 50 listings are free.`,
      });
      router.navigate("/");
    } catch {
      setError("Could not reach the sign-up service. Please try again.");
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-md rounded-card border border-border bg-raised p-6 sm:p-8 space-y-4">
          <Skeleton className="h-6 w-52 mx-auto" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-md rounded-card border border-border bg-raised p-6 sm:p-8 text-center space-y-4">
          <h1 className="text-headline text-foreground">You already have an account</h1>
          <p className="text-body text-muted-foreground">
            You&apos;re signed in as{" "}
            <span className="text-teal font-semibold">@{user.username}</span>. One
            account is all you need to bid and sell.
          </p>
          <div className="flex flex-col gap-2">
            <LinkButton to="/my" className="w-full">
              {t("nav.my")}
            </LinkButton>
            <Button
              variant="outline"
              className="h-11 w-full text-label"
              onClick={async () => {
                await signOut();
                toast({ title: "Signed out", description: "Create your next account below." });
              }}
            >
              {t("nav.signout")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10 sm:py-14">
      <AuthCard
        title="Create your free account"
        subtitle="Bid, sell and win — Zimbabwe's auction marketplace"
        footer={
          <>
            Already have an account?{" "}
            <a
              href="#/signin"
              onClick={(e) => {
                e.preventDefault();
                router.navigate("/signin");
              }}
              className="text-teal font-bold hover:underline"
            >
              {t("nav.signin")}
            </a>
          </>
        }
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          {/* username */}
          <div className="space-y-1.5">
            <Label htmlFor="reg-username" className="text-label">
              Username
            </Label>
            <div className="relative">
              <Input
                id="reg-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                onBlur={() => setTouched((s) => ({ ...s, username: true }))}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="simba"
                aria-invalid={usernameError ? true : undefined}
                aria-describedby="reg-username-hint"
                className={cn("h-11 pe-10", usernameValid(uname) && uname && "border-teal/40")}
              />
              {usernameValid(uname) && uname.length > 0 && (
                <Check
                  className="absolute inset-y-0 end-3 my-auto size-4 text-ok"
                  aria-hidden="true"
                />
              )}
            </div>
            {usernameError ? (
              <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                <AlertCircle className="size-3.5 mt-px shrink-0" aria-hidden="true" />
                {usernameError}
              </p>
            ) : (
              <p id="reg-username-hint" className="text-caption text-muted-foreground">
                3–24 letters and numbers. Usernames are permanent and public — like{" "}
                <span className="text-teal font-semibold">@simba</span>.
              </p>
            )}
          </div>

          {/* password */}
          <div className="space-y-1.5">
            <PasswordField
              id="reg-password"
              label="Password"
              value={password}
              onChange={setPassword}
              onBlur={() => setTouched((s) => ({ ...s, password: true }))}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              error={passwordError}
              hint="Minimum 8 characters — mix letters, numbers and a symbol."
            />
            {password && <PasswordStrengthBar password={password} />}
          </div>

          {/* repeat password */}
          <div className="space-y-1.5">
            <PasswordField
              id="reg-repeat"
              label="Repeat password"
              value={repeat}
              onChange={setRepeat}
              onBlur={() => setTouched((s) => ({ ...s, repeat: true }))}
              autoComplete="new-password"
              placeholder="Type it once more"
              error={repeatError}
              hint={
                matches ? (
                  <span className="inline-flex items-center gap-1 text-ok font-semibold">
                    <Check className="size-3.5" aria-hidden="true" />
                    Passwords match
                  </span>
                ) : undefined
              }
            />
          </div>

          {/* 12-e: REQUIRED ToS acceptance (LEG-003) */}
          <div className="rounded-control border border-border bg-teal-tint/40 p-3.5">
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="reg-tos"
                checked={tosAccepted}
                onCheckedChange={(v) => {
                  setTosAccepted(v === true);
                  if (v) setError(null);
                }}
                className="mt-0.5"
                aria-required="true"
              />
              <Label htmlFor="reg-tos" className="text-body font-normal leading-snug cursor-pointer">
                {t("security.register.tosLead")}{" "}
                <a
                  href="#/policies/tos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-teal font-bold hover:underline"
                >
                  {t("security.register.tosLink")}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </Label>
            </div>
            <p className="mt-1.5 ms-7 text-caption text-muted-foreground">
              {t("security.register.tosNote")}
            </p>
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

          <Button type="submit" disabled={submitting || !tosAccepted} className="h-12 w-full text-base font-bold">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Creating your account…
              </>
            ) : (
              <>
                <UserPlus className="size-4" aria-hidden="true" />
                Create account
              </>
            )}
          </Button>

          <p className="text-caption text-muted-foreground text-center">
            Free to join · 50 free listings a month · pay 8% final value fee only
            when you sell.
          </p>
        </form>
      </AuthCard>
    </div>
  );
}
