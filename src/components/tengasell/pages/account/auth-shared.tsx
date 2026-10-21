"use client";

// Tengasell — shared building blocks for the account module (Task 5-a).
// Used by #/signin, #/register and the My Tengasell sections.
// NXS: 44px touch targets, focus rings, reduced motion, brand tokens only.

import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/tengasell/api";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TengaLogo } from "@/components/tengasell/ui";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";

// ── link styled as a button (hash-router aware, press feedback) ──────

type LinkVariant = "primary" | "gold" | "outline" | "ghost" | "danger";

const LINK_VARIANTS: Record<LinkVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs font-bold",
  gold: "bg-gold text-gold-on hover:bg-gold-deep shadow-xs font-bold",
  outline:
    "border border-border bg-raised text-foreground hover:border-teal/40 hover:text-teal shadow-xs font-semibold",
  ghost: "text-teal hover:bg-accent/60 font-semibold",
  danger: "text-danger hover:bg-danger/10 font-semibold",
};

export function LinkButton({
  to,
  variant = "primary",
  className,
  children,
  ariaLabel,
}: {
  to: string;
  variant?: LinkVariant;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const link = useLinkProps(to);
  const reduced = useReducedMotion();
  return (
    <motion.a
      {...link}
      aria-label={ariaLabel}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-5 text-label transition-colors",
        LINK_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </motion.a>
  );
}

// ── auth card shell (centered, logo + tagline) ───────────────────────

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full max-w-md">
      <div className="rounded-card border border-border bg-raised p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col items-center text-center gap-1.5 mb-6">
          <TengaLogo size={44} />
          <h1 className="text-headline text-foreground mt-2">{title}</h1>
          {subtitle && (
            <p className="text-caption text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {children}
      </div>
      {footer && (
        <p className="text-center text-body text-muted-foreground mt-4">
          {footer}
        </p>
      )}
    </div>
  );
}

// ── inline field error ───────────────────────────────────────────────

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-1.5 text-caption text-danger font-medium"
    >
      <AlertCircle className="size-3.5 mt-px shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

// ── password field with show/hide toggle ─────────────────────────────

export function PasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  autoComplete,
  placeholder,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  autoComplete?: string;
  placeholder?: string;
  error?: string | null;
  hint?: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-label">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="h-11 pe-12"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute inset-y-0 end-0 w-11 grid place-items-center rounded-e-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring transition-colors"
        >
          {show ? <EyeOff className="size-4.5" aria-hidden="true" /> : <Eye className="size-4.5" aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <FieldError id={errorId}>{error}</FieldError>
      ) : (
        hint && (
          <p id={hintId} className="text-caption text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

// ── password strength (weak / okay / strong) ─────────────────────────

export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return 1; // weak
  if (score <= 3) return 2; // okay
  return 3; // strong
}

const STRENGTH_LABEL = { 0: "", 1: "Weak", 2: "Okay", 3: "Strong" } as const;
const STRENGTH_BAR = {
  1: "bg-danger",
  2: "bg-gold-deep",
  3: "bg-ok",
} as const;

export function PasswordStrengthBar({ password }: { password: string }) {
  const level = passwordStrength(password);
  if (!password) return null;
  return (
    <div
      className="flex items-center gap-2"
      aria-label={`Password strength: ${STRENGTH_LABEL[level]}`}
    >
      <div className="flex gap-1 flex-1" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= level ? STRENGTH_BAR[level] : "bg-muted",
            )}
          />
        ))}
      </div>
      <span
        className={cn(
          "text-caption font-bold w-12 text-end",
          level === 1 && "text-danger",
          level === 2 && "text-gold-deep",
          level === 3 && "text-ok",
        )}
      >
        {STRENGTH_LABEL[level]}
      </span>
    </div>
  );
}

// ── shared username rule (matches backend + demo store) ──────────────

export function usernameValid(username: string): boolean {
  return /^[a-z0-9]{3,24}$/.test(username);
}

// ═══════════════════════════════════════════════════════════════════════
// 12-e platform: BFF-gated sign-in helpers (IAM-004/007/017, EXP gate).
//
// The sign-in flow NEVER talks to TrailBase auth directly anymore:
//   POST /api/auth/login           → server-side password check + SUSPENSION
//                                    gate (trust, fail-open) + MFA gate
//   POST /api/auth/mfa/verify      → code step; the session token is only
//                                    released when the code matches
//   GET  /api/auth/status          → final pre-finalization check with the
//                                    fresh token (suspension re-check)
//   POST /api/platform/session     → fire-and-forget sign-in activity row
//                                    (what the Security section reads back)
// Only when every gate passes does the client adopt the token.
// ═════════════════════════════════════════════════════════════════════

export type BffLoginResult =
  | { kind: "ok"; token: string; username: string }
  | { kind: "mfa"; username: string; mfaToken?: string; trustPending?: string }
  | { kind: "suspended"; reason?: string }
  | { kind: "error"; error: string }
  | { kind: "unreachable"; error: string };

/** Step 1 — password + gates through the platform BFF (never TrailBase direct). */
export async function bffLogin(username: string, password: string): Promise<BffLoginResult> {
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    return { kind: "unreachable", error: "Could not reach the sign-in service." };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status >= 500) return { kind: "unreachable", error: String(data.error ?? "Sign-in service error.") };
  if (data.suspended === true) return { kind: "suspended", reason: String(data.error ?? "") };
  if (data.mfa_required === true) {
    return {
      kind: "mfa",
      username: String(data.username ?? username),
      mfaToken: typeof data.mfa_token === "string" ? data.mfa_token : undefined,
      trustPending: typeof data.trust_pending === "string" ? data.trust_pending : undefined,
    };
  }
  if (res.ok && typeof data.token === "string") return { kind: "ok", token: data.token, username: String(data.username ?? username) };
  return { kind: "error", error: String(data.error ?? "Incorrect username or password.") };
}

/** Step 2 — the 6-digit MFA code (TrailBase-native or trust-held pending session). */
export async function bffMfaVerify(
  challenge: { mfaToken?: string; trustPending?: string },
  code: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        ...(challenge.mfaToken ? { mfa_token: challenge.mfaToken } : {}),
        ...(challenge.trustPending ? { trust_pending: challenge.trustPending } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && typeof data.token === "string") return { ok: true, token: data.token };
    return { ok: false, error: String(data.error ?? "That code isn't right. Try again.") };
  } catch {
    return { ok: false, error: "Could not reach the sign-in service. Try again." };
  }
}

/**
 * Final gate + session adoption. Returns false when the account turned out
 * suspended (token discarded — nothing stored). On success the session lands
 * in the exact same storage the app shell restores from ("ts_auth" — the
 * key remote.ts owns), the trade-engine socket connects, and the sign-in
 * activity row is recorded (fire-and-forget).
 */
export async function finalizeSession(token: string, username: string): Promise<{ ok: boolean; suspended?: boolean }> {
  // GET /api/auth/status with the fresh token BEFORE storing anything
  try {
    const res = await fetch("/api/auth/status", { headers: { Authorization: `Bearer ${token}` } });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (data.suspended && (data.suspended as Record<string, unknown>) !== null) {
      return { ok: false, suspended: true };
    }
    if (data.suspension && (data.suspension as Record<string, unknown>).suspended !== false) {
      const sus = data.suspension as Record<string, unknown>;
      if (sus.suspended === true) return { ok: false, suspended: true };
    }
  } catch {
    /* status probe failed — the BFF login gate already ran; adopt the session */
  }
  try {
    localStorage.setItem("ts_auth", JSON.stringify({ token, username }));
    // Mirror the session into the API's in-memory state so currentUser()
    // sees it immediately — no page reload needed (the constructor only
    // reads localStorage once, at module init).
    api.adoptExternalSession({ token, username });
  } catch {
    /* storage unavailable — session cannot persist */
  }
  // record sign-in activity (audit row + trust mirror) — fire-and-forget
  void fetch("/api/platform/session", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(
    () => {},
  );
  return { ok: true };
}

// ── account recovery (IAM-007) — inline "Forgot password?" flow ──────────

export interface RecoveryStartResult {
  ok: boolean;
  sandbox?: boolean;
  code?: string;
  error?: string;
}

export async function recoveryStart(username: string): Promise<RecoveryStartResult> {
  try {
    const res = await fetch("/api/auth/recovery/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    return (await res.json().catch(() => ({}))) as RecoveryStartResult;
  } catch {
    return { ok: false, error: "Could not reach the recovery service." };
  }
}

export async function recoveryConfirm(input: {
  username: string;
  code: string;
  newPassword: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: input.username,
        code: input.code,
        new_password: input.newPassword,
        new_password_repeat: input.newPassword,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && data.ok) return { ok: true };
    return { ok: false, error: data.error ?? "That code isn't right or has expired." };
  } catch {
    return { ok: false, error: "Could not reach the recovery service." };
  }
}
