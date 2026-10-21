"use client";

// Tengasell — Platform consoles (admin, #/admin/{users|marketplace|audit|
// health|analytics|config}). MSCS 12-e (platform plane).
//
//   users       — account search (username/email), roles/suspension table,
//                 per-row detail Sheet (profile/orders/ratings/recent audit),
//                 role assignment + suspend/restore (reason REQUIRED,
//                 AlertDialog, honest CTL-021 dual-approval surfacing)
//   marketplace — auction search/status filter, takedown (reason REQUIRED,
//                 AlertDialog) / feature toggle / relist / cancel with the
//                 Finance-console refund pointer
//   audit       — audit_events table with filters (source/action/days),
//                 expandable payloads, privileged-actions summary, CSV export
//   health      — per-service cards (status/latency/stats) from the
//                 aggregated BFF probe, Run smoke checks, Send test alert,
//                 30s auto-refresh
//   analytics   — metric sections with a metric dictionary (i-tooltips),
//                 funnel + monthly cohorts, per-section CSV export
//   config      — feature-flag table with switches, REQUIRED reason on
//                 change, last-changed trail, honest v1 enforcement scope
//
// Every console renders the IAM-010 step-up banner (verified chip / verify
// card / enrollment nudge) per the documented gate design. All fetches are
// RELATIVE /api/platform/** (BFF: 401 unsigned, 403 non-admin, 503 service).

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  BellRing,
  Check,
  ClipboardCopy,
  Database,
  Download,
  Eye,
  FileWarning,
  Info,
  KeyRound,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Store,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import * as Tooltip from "@/components/ui/tooltip";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatRelative } from "@/lib/tengasell/format";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/lib/tengasell/types";

// ── shared client helper (BFF fetch, Bearer, relative paths only) ─────────

async function pf<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data;
}

/** CSV download through the authed BFF (blob + object URL). */
async function downloadCsv(path: string, token: string, filename: string): Promise<void> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Export failed (${res.status}).`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── console shell + IAM-010 step-up banner ────────────────────────────────

function PlatformShell({
  user,
  titleKey,
  subKey,
  icon,
  children,
}: {
  user: CurrentUser;
  titleKey: string;
  subKey: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0 space-y-5">
      <SectionHeader icon={icon} title={t(titleKey)} subtitle={t(subKey)} />
      <StepUpBanner user={user} />
      {children}
    </div>
  );
}

function StepUpBanner({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const [nonce, setNonce] = useState(0);
  const state = useResource<{ mfa_active: boolean; required: boolean; last_verified_at: string | null }>(
    async () =>
      pf<{ mfa_active: boolean; required: boolean; last_verified_at: string | null }>("/api/platform/admin/stepup", user.token).catch(() => ({
        mfa_active: false,
        required: false,
        last_verified_at: null,
      })),
    [user.token, nonce],
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.loading && !state.data) return null;
  const d = state.data;
  if (!d) return null;

  // MFA off → honest enrollment nudge (gate activates the moment MFA is on)
  if (!d.mfa_active) {
    return (
      <div className="flex flex-wrap items-center gap-2.5 rounded-control border border-gold/40 bg-gold-soft/70 px-4 py-3">
        <KeyRound className="size-4 shrink-0 text-gold-deep" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-caption text-foreground/90">{t("platform.stepup.nudge")}</p>
        <a
          href="#/my/security"
          className="flex min-h-11 items-center rounded-control border border-gold-deep/40 bg-raised px-3.5 text-label font-bold text-gold-deep hover:bg-raised/80"
        >
          {t("platform.stepup.setup")}
        </a>
      </div>
    );
  }

  if (!d.required) {
    return (
      <div className="flex flex-wrap items-center gap-2.5 rounded-control border border-ok/30 bg-ok/5 px-4 py-3">
        <ShieldCheck className="size-4 shrink-0 text-ok" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-caption text-foreground/90">{t("platform.stepup.ok")}</p>
        {d.last_verified_at && (
          <span className="text-caption text-muted-foreground">
            {t("platform.stepup.expires")} · {formatRelative(d.last_verified_at)}
          </span>
        )}
      </div>
    );
  }

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError(t("platform.stepup.codeError"));
      return;
    }
    setBusy(true);
    try {
      await pf("/api/auth/admin/stepup", user.token, { method: "POST", body: { code } });
      toast({ title: t("platform.stepup.verified"), description: t("platform.stepup.verifiedBody") });
      setCode("");
      setNonce((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={verify}
      className="rounded-control border border-teal/30 bg-teal-tint/70 px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <ShieldCheck className="size-4 shrink-0 text-teal-deep" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-caption text-teal-deep">{t("platform.stepup.required")}</p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label htmlFor="stepup-code" className="sr-only">
          {t("platform.stepup.codeLabel")}
        </label>
        <input
          id="stepup-code"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          aria-invalid={error ? true : undefined}
          className="ts-numeric h-11 w-32 rounded-input border border-teal/40 bg-raised px-3 text-center tracking-[0.3em] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button type="submit" disabled={busy} className="h-11 text-label font-bold">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
          {t("platform.stepup.verify")}
        </Button>
        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
            <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

// ── small shared pieces ───────────────────────────────────────────────────

function StatusChip({ tone, children }: { tone: "ok" | "danger" | "warn" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-caption font-bold",
        tone === "ok" && "border-ok/40 bg-ok/10 text-ok",
        tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
        tone === "warn" && "border-gold-deep/40 bg-gold-soft text-gold-deep",
        tone === "muted" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden" aria-busy="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 border-b border-border/60 px-4 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-24" : c === cols - 1 ? "w-16" : "w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// USERS console
// ═══════════════════════════════════════════════════════════════════════

interface AdminUser {
  username: string;
  email: string | null;
  admin: boolean;
  mfa_active: boolean;
  created: string;
  profile: {
    display_name: string;
    city: string;
    sales: number;
    rating_avg: number;
    rating_count: number;
    verified: boolean;
  } | null;
  suspended: boolean;
  suspension_reason: string | null;
  roles: string[];
  trust_available: boolean;
}

interface UserDetail {
  user: {
    username: string;
    email: string | null;
    admin: boolean;
    mfa_active: boolean;
    created: string;
    profile: { display_name: string; bio: string; city: string; sales: number; rating_avg: number; rating_count: number; verified: boolean; joined_at: string } | null;
    orders: { buying: number; selling: number };
    ratings: { count: number; avg: number | null };
    suspended: boolean;
    suspension_reason: string | null;
    roles: string[];
    trust_available: boolean;
    recent_audit: { id: number; action: string; entity: string; source: string; at: string }[];
  };
}

const ROLE_OPTIONS = ["user", "support", "moderator", "finance", "compliance"] as const;
const SUSPEND_DAYS = [
  { value: "3", labelKey: "platform.users.days3" },
  { value: "0", labelKey: "platform.users.daysOpen" },
] as const;

export function UsersConsole({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [roleFor, setRoleFor] = useState<AdminUser | null>(null);
  const [role, setRole] = useState("");
  const [roleReason, setRoleReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [suspendFor, setSuspendFor] = useState<AdminUser | null>(null);
  const [suspendAction, setSuspendAction] = useState<"suspend" | "restore">("suspend");
  const [suspendDays, setSuspendDays] = useState("3");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendNote, setSuspendNote] = useState("");

  const list = useResource<{ users: AdminUser[] }>(
    async () => pf(`/api/platform/admin/users?q=${encodeURIComponent(query)}`, user.token),
    [user.token, query],
  );

  const users = list.data?.users ?? [];

  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q.trim());
  };

  const assignRole = async () => {
    if (!roleFor || busy) return;
    setDialogError(null);
    if (roleReason.trim().length < 3) {
      setDialogError(t("platform.reasonRequired"));
      return;
    }
    setBusy(true);
    try {
      await pf(`/api/platform/admin/users/${encodeURIComponent(roleFor.username)}/role`, user.token, {
        method: "POST",
        body: { role: role || "user", reason: roleReason.trim() },
      });
      toast({ title: t("platform.users.roleToast"), description: `@${roleFor.username} → ${role || "user"}` });
      setRoleFor(null);
      setRole("");
      setRoleReason("");
      void list.reload();
      setOpenUser(roleFor.username); // keep detail open to show fresh state
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Role assignment failed.");
    } finally {
      setBusy(false);
    }
  };

  const enforce = async () => {
    if (!suspendFor || busy) return;
    setDialogError(null);
    if (suspendReason.trim().length < 3) {
      setDialogError(t("platform.reasonRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await pf<{ pending?: boolean }>(
        `/api/platform/admin/users/${encodeURIComponent(suspendFor.username)}/enforcement`,
        user.token,
        {
          method: "POST",
          body: {
            action: suspendAction,
            reason: suspendReason.trim(),
            note: suspendNote.trim(),
            days: suspendAction === "suspend" ? Number(suspendDays) || null : null,
          },
        },
      );
      toast({
        title:
          res.pending
            ? t("platform.users.pendingToast")
            : suspendAction === "suspend"
              ? t("platform.users.suspendedToast")
              : t("platform.users.restoredToast"),
        description: res.pending
          ? t("platform.users.pendingBody")
          : suspendAction === "suspend"
            ? `@${suspendFor.username} — ${suspendDays === "0" ? "" : t("platform.users.days3").replace("{n}", suspendDays) + " "}${t("platform.users.suspendedBody")}`
            : `@${suspendFor.username}`,
      });
      setSuspendFor(null);
      setSuspendReason("");
      setSuspendNote("");
      void list.reload();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Enforcement failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlatformShell user={user} titleKey="admin.users.title" subKey="admin.users.sub" icon={<Users className="size-5 text-teal" aria-hidden="true" />}>
      <form onSubmit={search} className="flex gap-2" role="search">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("platform.users.searchPlaceholder")}
            aria-label={t("platform.users.searchPlaceholder")}
            className="h-11 ps-10"
          />
        </div>
        <Button type="submit" className="h-11 text-label font-bold">
          <Search className="size-4" aria-hidden="true" />
          {t("platform.search")}
        </Button>
      </form>

      {list.loading && !list.data ? (
        <TableSkeleton rows={5} cols={5} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : users.length === 0 ? (
        <EmptyState
          icon={<Users className="size-10" />}
          title={query ? t("platform.users.noMatch") : t("platform.users.none")}
          body={query ? t("platform.users.noMatchBody") : t("platform.users.noneBody")}
        />
      ) : (
        <div className="overflow-x-auto ts-scrollbar rounded-card border border-border bg-raised">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-label">{t("platform.users.colUser")}</TableHead>
                <TableHead className="text-label">{t("platform.users.colEmail")}</TableHead>
                <TableHead className="text-label">{t("platform.users.colCreated")}</TableHead>
                <TableHead className="text-label">{t("platform.users.colRoles")}</TableHead>
                <TableHead className="text-label">{t("platform.users.colState")}</TableHead>
                <TableHead className="text-label sr-only">{t("platform.users.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.username} className={cn(u.suspended && "bg-danger/5")}>
                  <TableCell className="font-semibold text-foreground">
                    <button
                      type="button"
                      onClick={() => setOpenUser(u.username)}
                      className="min-h-11 text-teal font-bold hover:underline text-start"
                    >
                      @{u.username}
                    </button>
                    {u.admin && <span className="ms-1.5 text-caption text-gold-deep font-bold">admin</span>}
                  </TableCell>
                  <TableCell className="text-body text-muted-foreground max-w-44 truncate">{u.email ?? "—"}</TableCell>
                  <TableCell className="text-caption text-muted-foreground whitespace-nowrap">
                    {formatRelative(u.created)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 ? (
                        <StatusChip tone="muted">{t("platform.users.roleUser")}</StatusChip>
                      ) : (
                        u.roles.map((r) => (
                          <StatusChip key={r} tone="warn">
                            {r}
                          </StatusChip>
                        ))
                      )}
                      {u.mfa_active && <StatusChip tone="ok">MFA</StatusChip>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.suspended ? (
                      <StatusChip tone="danger">{t("platform.users.suspended")}</StatusChip>
                    ) : !u.trust_available ? (
                      <StatusChip tone="warn">?</StatusChip>
                    ) : (
                      <StatusChip tone="ok">{t("platform.users.active")}</StatusChip>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        className="h-9 min-w-9 px-2.5 text-caption"
                        onClick={() => {
                          setRoleFor(u);
                          setRole(u.roles[0] ?? "");
                          setRoleReason("");
                          setDialogError(null);
                        }}
                        aria-label={`${t("platform.users.assignRole")} @${u.username}`}
                      >
                        <UserCheck className="size-4" aria-hidden="true" />
                      </Button>
                      {u.suspended ? (
                        <Button
                          variant="outline"
                          className="h-9 min-w-9 px-2.5 text-caption text-ok border-ok/40 hover:bg-ok/10"
                          onClick={() => {
                            setSuspendFor(u);
                            setSuspendAction("restore");
                            setSuspendReason("");
                            setSuspendNote("");
                            setSuspendDays("3");
                            setDialogError(null);
                          }}
                          aria-label={`${t("platform.users.restore")} @${u.username}`}
                        >
                          <ShieldCheck className="size-4" aria-hidden="true" />
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={u.username === "admin"}
                          className="h-9 min-w-9 px-2.5 text-caption text-danger border-danger/40 hover:bg-danger/10"
                          onClick={() => {
                            setSuspendFor(u);
                            setSuspendAction("suspend");
                            setSuspendReason("");
                            setSuspendNote("");
                            setSuspendDays("3");
                            setDialogError(null);
                          }}
                          aria-label={`${t("platform.users.suspend")} @${u.username}`}
                        >
                          <ShieldOff className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-caption text-muted-foreground">{t("platform.users.sourceNote")}</p>

      {/* detail sheet */}
      <UserDetailSheet
        username={openUser}
        token={user.token}
        onClose={() => setOpenUser(null)}
        onRole={(u) => {
          setRoleFor(u);
          setRole(u.roles[0] ?? "");
          setRoleReason("");
          setDialogError(null);
        }}
        onSuspend={(u, action) => {
          setSuspendFor(u);
          setSuspendAction(action);
          setSuspendReason("");
          setSuspendNote("");
          setSuspendDays("3");
          setDialogError(null);
        }}
      />

      {/* role dialog */}
      <Dialog open={!!roleFor} onOpenChange={(v) => !v && setRoleFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("platform.users.assignRole")}</DialogTitle>
            <DialogDescription>
              {t("platform.users.roleBody")} <span className="font-semibold text-foreground">@{roleFor?.username}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="role-select" className="text-label">
                {t("platform.users.role")}
              </Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="role-select" className="h-11 w-full">
                  <SelectValue placeholder={t("platform.users.role")} />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r} className="text-body">
                      {r === "user" ? t("platform.users.roleUser") : r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-reason" className="text-label">
                {t("platform.reason")} <span className="text-danger">*</span>
              </Label>
              <Textarea
                id="role-reason"
                value={roleReason}
                onChange={(e) => setRoleReason(e.target.value)}
                placeholder={t("platform.users.roleReasonHint")}
                className="min-h-20 text-body"
              />
            </div>
            {dialogError && (
              <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {dialogError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setRoleFor(null)}>
              {t("platform.cancel")}
            </Button>
            <Button className="h-11 font-bold" disabled={busy} onClick={assignRole}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <UserCheck className="size-4" aria-hidden="true" />}
              {t("platform.users.assignRole")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* enforcement dialog */}
      <Dialog open={!!suspendFor} onOpenChange={(v) => !v && setSuspendFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {suspendAction === "suspend" ? t("platform.users.suspendTitle") : t("platform.users.restoreTitle")}
            </DialogTitle>
            <DialogDescription>
              {suspendAction === "suspend"
                ? t("platform.users.suspendBody")
                : t("platform.users.restoreBody")}{" "}
              <span className="font-semibold text-foreground">@{suspendFor?.username}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {suspendAction === "suspend" && (
              <div className="space-y-1.5">
                <Label htmlFor="suspend-days" className="text-label">
                  {t("platform.users.duration")}
                </Label>
                <Select value={suspendDays} onValueChange={setSuspendDays}>
                  <SelectTrigger id="suspend-days" className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUSPEND_DAYS.map((d) => (
                      <SelectItem key={d.value} value={d.value} className="text-body">
                        {t(d.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {suspendDays === "0" && (
                  <p className="flex items-start gap-1.5 text-caption text-gold-deep">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                    {t("platform.users.dualNote")}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="suspend-reason" className="text-label">
                {t("platform.reason")} <span className="text-danger">*</span>
              </Label>
              <Input
                id="suspend-reason"
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder={t("platform.users.reasonHint")}
                className="h-11 text-body"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="suspend-note" className="text-label">
                {t("platform.users.note")}
              </Label>
              <Textarea
                id="suspend-note"
                value={suspendNote}
                onChange={(e) => setSuspendNote(e.target.value)}
                placeholder={t("platform.users.noteHint")}
                className="min-h-16 text-body"
              />
            </div>
            {dialogError && (
              <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {dialogError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setSuspendFor(null)}>
              {t("platform.cancel")}
            </Button>
            <Button
              className={cn("h-11 font-bold", suspendAction === "suspend" && "bg-danger text-white hover:bg-danger/90")}
              disabled={busy}
              onClick={enforce}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : suspendAction === "suspend" ? <ShieldOff className="size-4" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}
              {suspendAction === "suspend" ? t("platform.users.suspend") : t("platform.users.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}

function UserDetailSheet({
  username,
  token,
  onClose,
  onRole,
  onSuspend,
}: {
  username: string | null;
  token: string;
  onClose: () => void;
  onRole: (u: AdminUser) => void;
  onSuspend: (u: AdminUser, action: "suspend" | "restore") => void;
}) {
  const { t } = useI18n();
  const detail = useResource<UserDetail | null>(
    async () => {
      if (!username) return null;
      return pf<UserDetail>(`/api/platform/admin/users/${encodeURIComponent(username)}/detail`, token);
    },
    [token, username],
  );
  const u = detail.data?.user;

  return (
    <Sheet open={!!username} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto ts-scrollbar p-0">
        <SheetHeader className="px-5 py-4 border-b border-border">
          <SheetTitle className="text-title">
            {u ? `@${u.username}` : t("platform.users.detail")}
          </SheetTitle>
          <SheetDescription className="text-caption">
            {u ? `${u.email ?? "—"} · ${t("platform.users.joined")} ${formatRelative(u.created)}` : ""}
          </SheetDescription>
        </SheetHeader>
        {detail.loading && !u ? (
          <div className="px-5 py-4 space-y-3" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : detail.error ? (
          <div className="p-5">
            <ErrorState message={detail.error} onRetry={detail.reload} />
          </div>
        ) : u ? (
          <div className="px-5 py-4 space-y-4 text-body">
            <div className="flex flex-wrap gap-1.5">
              {u.admin && <StatusChip tone="warn">admin</StatusChip>}
              {u.mfa_active && <StatusChip tone="ok">MFA</StatusChip>}
              {u.suspended ? <StatusChip tone="danger">{t("platform.users.suspended")}</StatusChip> : <StatusChip tone="ok">{t("platform.users.active")}</StatusChip>}
              {u.roles.map((r) => (
                <StatusChip key={r} tone="warn">
                  {r}
                </StatusChip>
              ))}
            </div>
            {u.suspended && u.suspension_reason && (
              <p className="rounded-control border border-danger/30 bg-danger/5 p-3 text-caption text-danger">
                {u.suspension_reason}
              </p>
            )}
            {u.profile && (
              <div className="rounded-control border border-border p-3.5 space-y-1.5">
                <p className="text-label font-bold">{u.profile.display_name}</p>
                <p className="text-caption text-muted-foreground">
                  {u.profile.city || t("platform.users.noCity")} · {t("platform.users.sales")}:{" "}
                  <span className="ts-numeric font-bold text-foreground">{u.profile.sales}</span> ·{" "}
                  {t("platform.users.rating")}:{" "}
                  <span className="ts-numeric font-bold text-foreground">
                    {u.profile.rating_count ? `${u.profile.rating_avg}/5 (${u.profile.rating_count})` : "—"}
                  </span>
                </p>
                {u.profile.bio && <p className="text-caption text-foreground/80">{u.profile.bio}</p>}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-control border border-border p-2.5">
                <p className="ts-numeric text-title font-bold text-teal-deep">{u.orders.buying}</p>
                <p className="text-caption text-muted-foreground">{t("platform.users.buying")}</p>
              </div>
              <div className="rounded-control border border-border p-2.5">
                <p className="ts-numeric text-title font-bold text-teal-deep">{u.orders.selling}</p>
                <p className="text-caption text-muted-foreground">{t("platform.users.selling")}</p>
              </div>
              <div className="rounded-control border border-border p-2.5">
                <p className="ts-numeric text-title font-bold text-teal-deep">{u.ratings.count}</p>
                <p className="text-caption text-muted-foreground">{t("platform.users.ratings")}</p>
              </div>
            </div>
            <div>
              <p className="text-label font-bold mb-1.5">{t("platform.users.recentAudit")}</p>
              {u.recent_audit.length === 0 ? (
                <p className="text-caption text-muted-foreground">{t("platform.users.noAudit")}</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto ts-scrollbar rounded-control border border-border divide-y divide-border/60">
                  {u.recent_audit.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">{a.action}</span>
                      <span className="shrink-0 text-caption text-muted-foreground">{formatRelative(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="outline"
                className="h-11 text-label"
                onClick={() =>
                  onRole({
                    username: u.username,
                    email: u.email,
                    admin: u.admin,
                    mfa_active: u.mfa_active,
                    created: u.created,
                    profile: null,
                    suspended: u.suspended,
                    suspension_reason: u.suspension_reason,
                    roles: u.roles,
                    trust_available: u.trust_available,
                  })
                }
              >
                <UserCheck className="size-4" aria-hidden="true" />
                {t("platform.users.assignRole")}
              </Button>
              <Button
                variant="outline"
                disabled={u.username === "admin"}
                className={cn(
                  "h-11 text-label",
                  u.suspended ? "text-ok border-ok/40 hover:bg-ok/10" : "text-danger border-danger/40 hover:bg-danger/10",
                )}
                onClick={() =>
                  onSuspend(
                    {
                      username: u.username,
                      email: u.email,
                      admin: u.admin,
                      mfa_active: u.mfa_active,
                      created: u.created,
                      profile: null,
                      suspended: u.suspended,
                      suspension_reason: u.suspension_reason,
                      roles: u.roles,
                      trust_available: u.trust_available,
                    },
                    u.suspended ? "restore" : "suspend",
                  )
                }
              >
                {u.suspended ? <ShieldCheck className="size-4" aria-hidden="true" /> : <ShieldOff className="size-4" aria-hidden="true" />}
                {u.suspended ? t("platform.users.restore") : t("platform.users.suspend")}
              </Button>
              <a
                href={`#/u/${u.username}`}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-border text-label font-semibold text-teal hover:bg-accent/60"
              >
                {t("platform.users.viewPublic")}
              </a>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MARKETPLACE console
// ═══════════════════════════════════════════════════════════════════════

interface AdminAuction {
  id: number;
  title: string;
  seller: string;
  category: string;
  status: string;
  featured: boolean;
  current_price: number;
  bid_count: number;
  views: number;
  ends_at: string;
  created_at: string;
}

const TAKEDOWN_REASONS = [
  "prohibited_item",
  "counterfeit",
  "ip_violation",
  "off_platform_payment",
  "fraud_suspected",
  "duplicate",
  "other",
] as const;

export function MarketplaceConsole({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [takeFor, setTakeFor] = useState<AdminAuction | null>(null);
  const [takeReason, setTakeReason] = useState("");
  const [takeNote, setTakeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<AdminAuction | null>(null);
  const [cancelReason, setCancelReason] = useState("seller_request");

  const list = useResource<{ auctions: AdminAuction[] }>(
    async () =>
      pf(
        `/api/platform/admin/marketplace?q=${encodeURIComponent(query)}&status=${status}`,
        user.token,
      ),
    [user.token, query, status],
  );
  const auctions = list.data?.auctions ?? [];

  const action = async (
    a: AdminAuction,
    kind: "takedown" | "feature" | "relist" | "cancel",
    body?: Record<string, unknown>,
  ) => {
    setBusy(true);
    try {
      await pf(`/api/platform/admin/marketplace/${a.id}/${kind}`, user.token, {
        method: "POST",
        body: body ?? {},
      });
      void list.reload();
      return true;
    } catch (err) {
      toast({
        title: t("platform.market.failed"),
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmTakedown = async () => {
    if (!takeFor || busy) return;
    setDialogError(null);
    if (!takeReason) {
      setDialogError(t("platform.reasonRequired"));
      return;
    }
    setBusy(true);
    try {
      await pf(`/api/platform/admin/marketplace/${takeFor.id}/takedown`, user.token, {
        method: "POST",
        body: { reason_code: takeReason, note: takeNote.trim() },
      });
      toast({ title: t("platform.market.takenDown"), description: `#${takeFor.id} · ${takeReason}` });
      setTakeFor(null);
      setTakeReason("");
      setTakeNote("");
      void list.reload();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Takedown failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelFor || busy) return;
    setBusy(true);
    try {
      const res = await pf<{ orders_affected: number }>(
        `/api/platform/admin/marketplace/${cancelFor.id}/cancel`,
        user.token,
        { method: "POST", body: { reason_code: cancelReason } },
      );
      toast({
        title: t("platform.market.cancelled"),
        description: t("platform.market.refundPointer").replace("{n}", String(res.orders_affected)),
      });
      setCancelFor(null);
      void list.reload();
    } catch (err) {
      toast({ title: t("platform.market.failed"), description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlatformShell user={user} titleKey="admin.market.title" subKey="admin.market.sub" icon={<PackageSearch className="size-5 text-teal" aria-hidden="true" />}>
      <div className="flex flex-col sm:flex-row gap-2">
        <form
          className="flex gap-2 min-w-0 flex-1"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("platform.market.searchPlaceholder")}
              aria-label={t("platform.market.searchPlaceholder")}
              className="h-11 ps-10"
            />
          </div>
          <Button type="submit" className="h-11 text-label font-bold">
            <Search className="size-4" aria-hidden="true" />
            {t("platform.search")}
          </Button>
        </form>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 sm:w-40" aria-label={t("platform.market.statusFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["all", "live", "ended", "sold"].map((s) => (
              <SelectItem key={s} value={s} className="text-body">
                {s === "all" ? t("platform.market.all") : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.loading && !list.data ? (
        <TableSkeleton rows={6} cols={6} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : auctions.length === 0 ? (
        <EmptyState
          icon={<PackageSearch className="size-10" />}
          title={t("platform.market.none")}
          body={t("platform.market.noneBody")}
        />
      ) : (
        <div className="overflow-x-auto ts-scrollbar rounded-card border border-border bg-raised">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-label">#</TableHead>
                <TableHead className="text-label">{t("platform.market.colTitle")}</TableHead>
                <TableHead className="text-label">{t("platform.market.colSeller")}</TableHead>
                <TableHead className="text-label">{t("platform.market.colStatus")}</TableHead>
                <TableHead className="text-label">{t("platform.market.colPrice")}</TableHead>
                <TableHead className="text-label">{t("platform.market.colBids")}</TableHead>
                <TableHead className="text-label sr-only">{t("platform.users.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auctions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="ts-numeric text-caption text-muted-foreground">{a.id}</TableCell>
                  <TableCell className="max-w-64">
                    <a href={`#/item/${a.id}`} target="_blank" rel="noopener noreferrer" className="min-h-11 block py-2 font-semibold text-teal hover:underline">
                      {a.title}
                    </a>
                    {a.featured && <StatusChip tone="warn">{t("platform.market.featured")}</StatusChip>}
                  </TableCell>
                  <TableCell className="text-body text-muted-foreground">@{a.seller || "—"}</TableCell>
                  <TableCell>
                    <StatusChip tone={a.status === "live" ? "ok" : a.status === "sold" ? "warn" : "muted"}>
                      {a.status}
                    </StatusChip>
                  </TableCell>
                  <TableCell className="ts-numeric text-body font-semibold">${a.current_price}</TableCell>
                  <TableCell className="ts-numeric text-body">{a.bid_count}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {a.status === "live" && (
                        <>
                          <Button
                            variant="outline"
                            disabled={busy}
                            className="h-9 px-2.5 text-caption text-danger border-danger/40 hover:bg-danger/10"
                            onClick={() => {
                              setTakeFor(a);
                              setTakeReason("");
                              setTakeNote("");
                              setDialogError(null);
                            }}
                          >
                            <FileWarning className="size-4" aria-hidden="true" />
                            {t("platform.market.takedown")}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            className="h-9 px-2.5 text-caption"
                            onClick={() => void action(a, "feature", { on: !a.featured })}
                          >
                            <Store className="size-4" aria-hidden="true" />
                            {a.featured ? t("platform.market.unfeature") : t("platform.market.feature")}
                          </Button>
                        </>
                      )}
                      {a.status === "ended" && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          className="h-9 px-2.5 text-caption"
                          onClick={() => void action(a, "relist")}
                        >
                          <RefreshCw className="size-4" aria-hidden="true" />
                          {t("platform.market.relist")}
                        </Button>
                      )}
                      {(a.status === "live" || a.status === "sold") && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          className="h-9 px-2.5 text-caption text-danger border-danger/40 hover:bg-danger/10"
                          onClick={() => setCancelFor(a)}
                        >
                          <ShieldOff className="size-4" aria-hidden="true" />
                          {t("platform.market.cancel")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-caption text-muted-foreground">{t("platform.market.refundNote")}</p>

      {/* takedown dialog (reason REQUIRED) */}
      <Dialog open={!!takeFor} onOpenChange={(v) => !v && setTakeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("platform.market.takedownTitle")}</DialogTitle>
            <DialogDescription>
              {t("platform.market.takedownBody")}{" "}
              <span className="font-semibold text-foreground">“{takeFor?.title}”</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="take-reason" className="text-label">
                {t("platform.reason")} <span className="text-danger">*</span>
              </Label>
              <Select value={takeReason} onValueChange={setTakeReason}>
                <SelectTrigger id="take-reason" className="h-11 w-full">
                  <SelectValue placeholder={t("platform.market.reasonHint")} />
                </SelectTrigger>
                <SelectContent>
                  {TAKEDOWN_REASONS.map((r) => (
                    <SelectItem key={r} value={r} className="text-body">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="take-note" className="text-label">
                {t("platform.users.note")}
              </Label>
              <Textarea
                id="take-note"
                value={takeNote}
                onChange={(e) => setTakeNote(e.target.value)}
                placeholder={t("platform.market.noteHint")}
                className="min-h-16 text-body"
              />
            </div>
            {dialogError && (
              <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {dialogError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setTakeFor(null)}>
              {t("platform.cancel")}
            </Button>
            <Button className="h-11 bg-danger font-bold text-white hover:bg-danger/90" disabled={busy} onClick={confirmTakedown}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileWarning className="size-4" aria-hidden="true" />}
              {t("platform.market.takedown")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* cancel confirm (AlertDialog — destructive) */}
      <AlertDialog open={!!cancelFor} onOpenChange={(v) => !v && setCancelFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("platform.market.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("platform.market.cancelBody")}{" "}
              <span className="font-semibold text-foreground">“{cancelFor?.title}”</span>.{" "}
              {t("platform.market.refundNote")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason" className="text-label">
              {t("platform.reason")} <span className="text-danger">*</span>
            </Label>
            <Select value={cancelReason} onValueChange={setCancelReason}>
              <SelectTrigger id="cancel-reason" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["seller_request", "prohibited_item", "fraud_suspected", "other"].map((r) => (
                  <SelectItem key={r} value={r} className="text-body">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("platform.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-danger font-bold text-white hover:bg-danger/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmCancel();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldOff className="size-4" aria-hidden="true" />}
              {t("platform.market.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PlatformShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// AUDIT console
// ═══════════════════════════════════════════════════════════════════════

interface AuditRow {
  id: number;
  user: string;
  action: string;
  entity: string;
  entity_id: number | null;
  source: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface AuditPayload {
  rows: AuditRow[];
  page: number;
  page_size: number;
  total: number;
  days: number;
  privileged: {
    admin_actions: { action: string; count: number }[];
    admin_total: number;
    account_events: { action: string; count: number }[];
    account_total: number;
  };
}

export function AuditConsole({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const [source, setSource] = useState("all");
  const [action, setAction] = useState("");
  const [actionQuery, setActionQuery] = useState("");
  const [days, setDays] = useState("30");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const data = useResource<AuditPayload>(
    async () =>
      pf(
        `/api/platform/admin/audit?source=${source}&action=${encodeURIComponent(actionQuery)}&days=${days}&page=${page}`,
        user.token,
      ),
    [user.token, source, actionQuery, days, page],
  );

  const rows = data.data?.rows ?? [];
  const priv = data.data?.privileged;
  const total = data.data?.total ?? 0;
  const pageSize = data.data?.page_size ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(
        `/api/platform/admin/audit/export?source=${source}&action=${encodeURIComponent(actionQuery)}&days=${days}`,
        user.token,
        `tengasell-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      toast({ title: t("platform.audit.exported"), description: t("platform.audit.exportedBody") });
    } catch (err) {
      toast({ title: t("platform.audit.exportFailed"), description: err instanceof Error ? err.message : "" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <PlatformShell user={user} titleKey="admin.audit.title" subKey="admin.audit.sub" icon={<Database className="size-5 text-teal" aria-hidden="true" />}>
      {/* privileged actions summary */}
      {priv ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-border bg-raised p-4">
            <p className="text-label font-bold text-foreground">
              {t("platform.audit.privileged")} · <span className="ts-numeric text-teal-deep">{priv.admin_total}</span>
            </p>
            {priv.admin_actions.length === 0 ? (
              <p className="mt-1.5 text-caption text-muted-foreground">{t("platform.audit.none30d")}</p>
            ) : (
              <ul className="mt-2 max-h-40 overflow-y-auto ts-scrollbar space-y-1">
                {priv.admin_actions.map((a) => (
                  <li key={a.action} className="flex items-center justify-between gap-2 text-caption">
                    <span className="min-w-0 truncate font-semibold text-foreground">{a.action}</span>
                    <span className="ts-numeric shrink-0 font-bold text-teal-deep">×{a.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-card border border-border bg-raised p-4">
            <p className="text-label font-bold text-foreground">
              {t("platform.audit.accountEvents")} · <span className="ts-numeric text-teal-deep">{priv.account_total}</span>
            </p>
            {priv.account_events.length === 0 ? (
              <p className="mt-1.5 text-caption text-muted-foreground">{t("platform.audit.none30d")}</p>
            ) : (
              <ul className="mt-2 max-h-40 overflow-y-auto ts-scrollbar space-y-1">
                {priv.account_events.map((a) => (
                  <li key={a.action} className="flex items-center justify-between gap-2 text-caption">
                    <span className="min-w-0 truncate font-semibold text-foreground">{a.action}</span>
                    <span className="ts-numeric shrink-0 font-bold text-teal-deep">×{a.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="h-11 w-36" aria-label={t("platform.audit.sourceFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["all", "web", "admin", "agent", "mcp"].map((s) => (
              <SelectItem key={s} value={s} className="text-body">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="relative min-w-0 flex-1 min-w-40"
          onSubmit={(e) => {
            e.preventDefault();
            setActionQuery(action.trim());
            setPage(1);
          }}
        >
          <Search className="absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder={t("platform.audit.actionFilter")}
            aria-label={t("platform.audit.actionFilter")}
            className="h-11 ps-10"
          />
        </form>
        <Select value={days} onValueChange={(v) => { setDays(v); setPage(1); }}>
          <SelectTrigger className="h-11 w-28" aria-label={t("platform.audit.daysFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["1", "7", "30", "90"].map((d) => (
              <SelectItem key={d} value={d} className="text-body">
                {t("platform.audit.days").replace("{n}", d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" className="h-11 text-label font-semibold" disabled={exporting} onClick={exportCsv}>
          {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
          {t("platform.audit.exportCsv")}
        </Button>
      </div>

      {data.loading && !data.data ? (
        <TableSkeleton rows={6} cols={6} />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Database className="size-10" />} title={t("platform.audit.empty")} body={t("platform.audit.emptyBody")} />
      ) : (
        <div className="overflow-x-auto ts-scrollbar rounded-card border border-border bg-raised">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-label">{t("platform.audit.colAt")}</TableHead>
                <TableHead className="text-label">{t("platform.audit.colAction")}</TableHead>
                <TableHead className="text-label">{t("platform.audit.colSource")}</TableHead>
                <TableHead className="text-label">{t("platform.audit.colEntity")}</TableHead>
                <TableHead className="text-label sr-only">{t("platform.audit.payload")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  <TableCell className="whitespace-nowrap text-caption text-muted-foreground">
                    {formatRelative(r.created_at)}
                  </TableCell>
                  <TableCell className="text-body font-semibold text-foreground">
                    {r.action}
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={r.source === "admin" ? "warn" : "muted"}>{r.source}</StatusChip>
                  </TableCell>
                  <TableCell className="text-body text-muted-foreground">
                    {r.entity}
                    {r.entity_id != null ? <span className="ts-numeric"> #{r.entity_id}</span> : null}
                  </TableCell>
                  <TableCell>
                    {expanded === r.id ? (
                      <pre className="max-w-[70vw] max-h-48 overflow-auto ts-scrollbar rounded-control border border-border bg-muted p-2.5 text-caption whitespace-pre-wrap break-all">
                        {JSON.stringify(r.payload, null, 2)}
                      </pre>
                    ) : (
                      <span className="flex min-h-11 items-center gap-1 text-caption text-teal">
                        <Eye className="size-3.5" aria-hidden="true" />
                        {t("platform.audit.expand")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" className="h-11 text-label" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("platform.prev")}
          </Button>
          <span className="text-caption text-muted-foreground ts-numeric">
            {page} / {pages} · {total}
          </span>
          <Button variant="outline" className="h-11 text-label" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("platform.next")}
          </Button>
        </div>
      )}
    </PlatformShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH console
// ═══════════════════════════════════════════════════════════════════════

interface ServiceCard {
  key: string;
  name: string;
  port: number;
  status: "ok" | "degraded" | "down";
  latency_ms: number | null;
  stats?: Record<string, unknown>;
  note?: string;
}

interface HealthPayload {
  checked_at: string;
  services: ServiceCard[];
  summary: { total: number; ok: number; degraded: number; down: number };
  freshness: { last_event_at: string; action: string } | null;
  alerts_enabled: boolean;
  maintenance_mode: boolean;
}

interface SmokePayload {
  smoke: {
    ok: boolean;
    checked_at: string;
    failures: string[];
    checks: { name: string; target: string; ok: boolean; latency_ms: number; detail?: string }[];
  };
}

export function HealthConsole({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const data = useResource<HealthPayload>(
    async () => pf("/api/platform/admin/health", user.token),
    [user.token],
  );
  const [smoke, setSmoke] = useState<SmokePayload["smoke"] | null>(null);
  const [smoking, setSmoking] = useState(false);
  const [alerting, setAlerting] = useState(false);

  // 30s auto-refresh
  useEffect(() => {
    const timer = setInterval(() => void data.reload(), 30_000);
    return () => clearInterval(timer);
  }, [user.token]);

  const runSmoke = async () => {
    setSmoking(true);
    try {
      const res = await pf<SmokePayload>("/api/platform/admin/smoke", user.token, { method: "POST" });
      setSmoke(res.smoke);
      toast({
        title: res.smoke.ok ? t("platform.health.smokeGreen") : t("platform.health.smokeRed"),
        description: res.smoke.ok ? t("platform.health.smokeGreenBody") : res.smoke.failures.join(", "),
      });
    } catch (err) {
      toast({ title: t("platform.market.failed"), description: err instanceof Error ? err.message : "" });
    } finally {
      setSmoking(false);
    }
  };

  const sendAlert = async () => {
    setAlerting(true);
    try {
      const res = await pf<{ note: string; queued: number; channels: string[] }>(
        "/api/platform/admin/alert",
        user.token,
        { method: "POST" },
      );
      toast({ title: t("platform.health.alertSent"), description: res.note });
    } catch (err) {
      toast({ title: t("platform.health.alertFailed"), description: err instanceof Error ? err.message : "" });
    } finally {
      setAlerting(false);
    }
  };

  const services = data.data?.services ?? [];
  const summary = data.data?.summary;

  return (
    <PlatformShell user={user} titleKey="admin.health.title" subKey="admin.health.sub" icon={<Activity className="size-5 text-teal" aria-hidden="true" />}>
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-11 text-label font-bold" disabled={smoking} onClick={runSmoke}>
          {smoking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
          {t("platform.health.runSmoke")}
        </Button>
        <Button variant="outline" className="h-11 text-label font-semibold" disabled={alerting} onClick={sendAlert}>
          {alerting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <BellRing className="size-4" aria-hidden="true" />}
          {t("platform.health.testAlert")}
        </Button>
        {data.data && (
          <span className="ms-auto text-caption text-muted-foreground">
            {t("platform.health.checked")} {formatRelative(data.data.checked_at)} · {t("platform.health.auto")}
          </span>
        )}
      </div>

      {summary ? (
        <ul className="grid grid-cols-3 gap-2" aria-label={t("platform.health.summary")}>
          <li className="rounded-card border border-ok/40 bg-ok/5 p-3">
            <p className="ts-numeric text-title font-bold text-ok">{summary.ok}</p>
            <p className="text-caption text-muted-foreground">{t("platform.health.ok")}</p>
          </li>
          <li className="rounded-card border border-gold-deep/40 bg-gold-soft p-3">
            <p className="ts-numeric text-title font-bold text-gold-deep">{summary.degraded}</p>
            <p className="text-caption text-muted-foreground">{t("platform.health.degraded")}</p>
          </li>
          <li className="rounded-card border border-danger/40 bg-danger/5 p-3">
            <p className="ts-numeric text-title font-bold text-danger">{summary.down}</p>
            <p className="text-caption text-muted-foreground">{t("platform.health.down")}</p>
          </li>
        </ul>
      ) : null}

      {data.loading && !data.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-card" />
          ))}
        </div>
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <div
              key={s.key}
              className={cn(
                "rounded-card border p-4 min-w-0",
                s.status === "ok" ? "border-border bg-raised" : s.status === "degraded" ? "border-gold-deep/40 bg-gold-soft/50" : "border-danger/40 bg-danger/5",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    s.status === "ok" ? "bg-ok" : s.status === "degraded" ? "bg-gold-deep" : "bg-danger",
                  )}
                  aria-hidden="true"
                />
                <h3 className="min-w-0 flex-1 truncate text-label font-bold text-foreground">{s.name}</h3>
                <StatusChip tone={s.status === "ok" ? "ok" : s.status === "degraded" ? "warn" : "danger"}>
                  :{s.port}
                </StatusChip>
              </div>
              <p className="mt-1.5 text-caption text-muted-foreground">
                {s.status === "down" ? (s.note ?? "unreachable") : (s.note ?? "—")}
                {s.latency_ms != null && (
                  <>
                    {" · "}
                    <span className="ts-numeric">{s.latency_ms}ms</span>
                  </>
                )}
              </p>
              {s.stats && Object.keys(s.stats).length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(s.stats)
                    .slice(0, 5)
                    .map(([k, v]) => (
                      <li key={k} className="rounded-full border border-border bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                        {k}: <span className="ts-numeric font-bold text-foreground">{String(v)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {data.data?.freshness && (
        <p className="text-caption text-muted-foreground">
          {t("platform.health.freshness")}{" "}
          <span className="font-semibold text-foreground">{data.data.freshness.action}</span> ·{" "}
          {formatRelative(data.data.freshness.last_event_at)}
          {data.data.maintenance_mode ? (
            <StatusChip tone="warn">
              {" "}
              {t("platform.health.maintenance")}
            </StatusChip>
          ) : null}
        </p>
      )}

      {smoke && (
        <div className="rounded-card border border-border bg-raised p-4">
          <div className="flex items-center gap-2">
            {smoke.ok ? <Check className="size-4 text-ok" aria-hidden="true" /> : <AlertCircle className="size-4 text-danger" aria-hidden="true" />}
            <p className="text-label font-bold text-foreground">
              {t("platform.health.smokeResults")} ·{" "}
              <span className={cn("ts-numeric", smoke.ok ? "text-ok" : "text-danger")}>
                {smoke.checks.filter((c) => c.ok).length}/{smoke.checks.length}
              </span>
            </p>
            <span className="ms-auto text-caption text-muted-foreground">{formatRelative(smoke.checked_at)}</span>
          </div>
          <ul className="mt-2.5 max-h-72 overflow-y-auto ts-scrollbar divide-y divide-border/60">
            {smoke.checks.map((c) => (
              <li key={c.name} className="flex items-center gap-2.5 py-2">
                {c.ok ? <Check className="size-4 shrink-0 text-ok" aria-hidden="true" /> : <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                  <p className="text-label font-semibold text-foreground">{c.name}</p>
                  <p className="text-caption text-muted-foreground truncate">{c.target} · {c.detail}</p>
                </div>
                <span className="ts-numeric shrink-0 text-caption text-muted-foreground">{c.latency_ms}ms</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PlatformShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ANALYTICS console
// ═══════════════════════════════════════════════════════════════════════

interface MetricRow {
  key: string;
  label: string;
  value: number | string;
  hint: string;
}

interface AnalyticsPayload {
  ok: boolean;
  generated_at: string;
  finance: Record<string, unknown> | null;
  finance_note: string | null;
  sections: Record<string, { title: string; note?: string; rows: MetricRow[] }>;
  cohorts: { month: string; registered: number; placed_bid: number; won: number; paid: number; bid_rate: string }[];
  totals: { auctions: number; orders: number };
}

const SECTION_ORDER = ["marketplace", "revenue", "product", "operational", "funnel", "freshness"] as const;

export function AnalyticsConsole({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const data = useResource<AnalyticsPayload>(
    async () => pf("/api/platform/admin/analytics", user.token),
    [user.token],
  );
  const [exporting, setExporting] = useState<string | null>(null);

  const exportSection = async (section: string) => {
    setExporting(section);
    try {
      await downloadCsv(
        `/api/platform/admin/analytics?format=csv&section=${section}`,
        user.token,
        `tengasell-analytics-${section}.csv`,
      );
      toast({ title: t("platform.audit.exported"), description: `${section}.csv` });
    } catch (err) {
      toast({ title: t("platform.audit.exportFailed"), description: err instanceof Error ? err.message : "" });
    } finally {
      setExporting(null);
    }
  };

  const funnelRows = data.data?.sections.funnel?.rows ?? [];
  const maxFunnel = Math.max(1, ...funnelRows.map((r) => Number(r.value) || 0));

  return (
    <PlatformShell user={user} titleKey="admin.analytics.title" subKey="admin.analytics.sub" icon={<BarChart3 className="size-5 text-teal" aria-hidden="true" />}>
      <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0 text-teal" aria-hidden="true" />
        {t("platform.analytics.dictNote")} · {data.data ? `${t("platform.analytics.generated")} ${formatRelative(data.data.generated_at)}` : ""}
      </p>

      {data.loading && !data.data ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-card" />
          ))}
        </div>
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : data.data ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {SECTION_ORDER.map((key) => {
              const s = data.data!.sections[key];
              if (!s) return null;
              return (
                <section key={key} className="rounded-card border border-border bg-raised p-4 min-w-0" aria-labelledby={`an-${key}`}>
                  <div className="flex items-center gap-2">
                    <h3 id={`an-${key}`} className="min-w-0 flex-1 text-label font-bold text-foreground">
                      {s.title}
                    </h3>
                    <Button
                      variant="outline"
                      className="h-9 min-w-9 px-2.5"
                      disabled={exporting === key}
                      onClick={() => void exportSection(key)}
                      aria-label={`${t("platform.audit.exportCsv")} ${s.title}`}
                    >
                      {exporting === key ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                    </Button>
                  </div>
                  {s.note && <p className="mt-1 text-caption text-gold-deep">{s.note}</p>}
                  <ul className="mt-2.5 divide-y divide-border/60">
                    {s.rows.map((m) => (
                      <li key={m.key} className="flex items-center gap-2 py-2">
                        <MetricHint label={m.label} hint={m.hint} />
                        <span
                          className={cn(
                            "ts-numeric ms-auto shrink-0 text-label font-bold text-teal-deep",
                            typeof m.value === "string" && !/^\d/.test(m.value) && "text-caption",
                          )}
                        >
                          {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          {/* funnel bars */}
          {funnelRows.length > 0 && (
            <div className="rounded-card border border-border bg-raised p-4">
              <h3 className="text-label font-bold text-foreground">{t("platform.analytics.funnelViz")}</h3>
              <ul className="mt-3 space-y-2.5">
                {funnelRows.map((m, i) => {
                  const v = Number(m.value) || 0;
                  return (
                    <li key={m.key} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-caption font-semibold text-foreground">{m.label}</span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="h-6 rounded-control bg-teal/80"
                          style={{ width: `${Math.max(4, (v / maxFunnel) * 100)}%` }}
                          role="img"
                          aria-label={`${m.label}: ${v}`}
                        />
                      </div>
                      <span className="ts-numeric w-14 shrink-0 text-end text-label font-bold text-teal-deep">{v}</span>
                      {i > 0 && (
                        <span className="ts-numeric hidden sm:block w-12 shrink-0 text-end text-caption text-muted-foreground">
                          {Math.round((v / (Number(funnelRows[0].value) || 1)) * 100)}%
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* monthly cohorts */}
          {data.data.cohorts.length > 0 && (
            <div className="rounded-card border border-border bg-raised p-4 min-w-0">
              <h3 className="text-label font-bold text-foreground">{t("platform.analytics.cohorts")}</h3>
              <div className="mt-2.5 overflow-x-auto ts-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-label">{t("platform.analytics.month")}</TableHead>
                      <TableHead className="text-label">{t("platform.analytics.registered")}</TableHead>
                      <TableHead className="text-label">{t("platform.analytics.bid")}</TableHead>
                      <TableHead className="text-label">{t("platform.analytics.won")}</TableHead>
                      <TableHead className="text-label">{t("platform.analytics.paid")}</TableHead>
                      <TableHead className="text-label">{t("platform.analytics.bidRate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.cohorts.map((c) => (
                      <TableRow key={c.month}>
                        <TableCell className="ts-numeric font-semibold text-foreground">{c.month}</TableCell>
                        <TableCell className="ts-numeric text-body">{c.registered}</TableCell>
                        <TableCell className="ts-numeric text-body">{c.placed_bid}</TableCell>
                        <TableCell className="ts-numeric text-body">{c.won}</TableCell>
                        <TableCell className="ts-numeric text-body">{c.paid}</TableCell>
                        <TableCell className="ts-numeric text-body font-bold text-teal-deep">{c.bid_rate}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-caption text-muted-foreground">{t("platform.analytics.cohortsNote")}</p>
            </div>
          )}
        </>
      ) : null}
    </PlatformShell>
  );
}

/** Metric dictionary hint — i-icon with the definition (keyboard friendly). */
function MetricHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip.TooltipProvider delayDuration={120}>
      <Tooltip.Tooltip>
        <Tooltip.TooltipTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 min-w-0 items-center gap-1 text-start text-body text-foreground hover:text-teal"
            aria-label={`${label} — ${hint}`}
          >
            <span className="min-w-0 truncate">{label}</span>
            <Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </Tooltip.TooltipTrigger>
        <Tooltip.TooltipContent side="top" className="max-w-64 text-caption leading-snug">
          {hint}
        </Tooltip.TooltipContent>
      </Tooltip.Tooltip>
    </Tooltip.TooltipProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIG console
// ═══════════════════════════════════════════════════════════════════════

interface FlagDef {
  key: string;
  value: boolean;
  label: string;
  description: string;
  lastChangedBy?: string;
  lastChangedAt?: string;
  lastReason?: string;
}

export function ConfigConsole({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const data = useResource<{ flags: FlagDef[] }>(
    async () => pf("/api/platform/admin/flags", user.token),
    [user.token],
  );
  const [editFor, setEditFor] = useState<FlagDef | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const flags = data.data?.flags ?? [];

  const save = async () => {
    if (!editFor || busy) return;
    setDialogError(null);
    if (reason.trim().length < 3) {
      setDialogError(t("platform.reasonRequired"));
      return;
    }
    setBusy(true);
    try {
      await pf("/api/platform/admin/flags", user.token, {
        method: "POST",
        body: { key: editFor.key, value: !editFor.value, reason: reason.trim() },
      });
      toast({
        title: t("platform.config.saved"),
        description: `${editFor.label} → ${!editFor.value ? "ON" : "OFF"}`,
      });
      setEditFor(null);
      setReason("");
      void data.reload();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Flag change failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlatformShell user={user} titleKey="admin.config.title" subKey="admin.config.sub" icon={<Settings2 className="size-5 text-teal" aria-hidden="true" />}>
      <div className="rounded-control border border-teal/25 bg-teal-tint p-3.5">
        <p className="text-label font-bold text-teal-deep">{t("platform.config.scopeTitle")}</p>
        <p className="mt-1 text-caption text-teal-deep/90">{t("platform.config.scopeBody")}</p>
      </div>

      {data.loading && !data.data ? (
        <TableSkeleton rows={5} cols={3} />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : (
        <div className="overflow-x-auto ts-scrollbar rounded-card border border-border bg-raised">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-label">{t("platform.config.colFlag")}</TableHead>
                <TableHead className="text-label">{t("platform.config.colTrail")}</TableHead>
                <TableHead className="text-label">{t("platform.config.colState")}</TableHead>
                <TableHead className="text-label sr-only">{t("platform.users.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((f) => (
                <TableRow key={f.key}>
                  <TableCell className="max-w-96">
                    <p className="text-body font-bold text-foreground">{f.label}</p>
                    <p className="text-caption text-muted-foreground">{f.description}</p>
                  </TableCell>
                  <TableCell className="text-caption text-muted-foreground">
                    {f.lastChangedAt ? (
                      <>
                        <span className="font-semibold text-foreground">@{f.lastChangedBy ?? "—"}</span>
                        {" · "}
                        {formatRelative(f.lastChangedAt)}
                        {f.lastReason ? (
                          <span className="block max-w-64 truncate">“{f.lastReason}”</span>
                        ) : null}
                      </>
                    ) : (
                      t("platform.config.neverChanged")
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={f.value ? "ok" : "muted"}>{f.value ? "ON" : "OFF"}</StatusChip>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Switch
                        checked={f.value}
                        onCheckedChange={() => {
                          setEditFor(f);
                          setReason("");
                          setDialogError(null);
                        }}
                        aria-label={`${t("platform.config.toggle")} ${f.label}`}
                        className="data-[state=checked]:bg-teal"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-caption text-muted-foreground">{t("platform.config.note")}</p>

      {/* reason dialog — REQUIRED */}
      <Dialog open={!!editFor} onOpenChange={(v) => !v && setEditFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("platform.config.changeTitle")}</DialogTitle>
            <DialogDescription>
              {t("platform.config.changeBody")}{" "}
              <span className="font-semibold text-foreground">
                {editFor?.label} → {editFor ? (!editFor.value ? "ON" : "OFF") : ""}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="flag-reason" className="text-label">
                {t("platform.reason")} <span className="text-danger">*</span>
              </Label>
              <Textarea
                id="flag-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("platform.config.reasonHint")}
                className="min-h-20 text-body"
              />
            </div>
            {dialogError && (
              <p role="alert" className="flex items-start gap-1.5 text-caption text-danger font-medium">
                <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {dialogError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setEditFor(null)}>
              {t("platform.cancel")}
            </Button>
            <Button className="h-11 font-bold" disabled={busy} onClick={save}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Settings2 className="size-4" aria-hidden="true" />}
              {t("platform.config.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlatformShell>
  );
}
