"use client";

// Tengasell — Communications (TUCS user side, task 11-b).
// My Tengasell → #/my/communications:
//   1. Linked channels — Email / Telegram / WhatsApp / Messenger cards with
//      a link wizard (handle → 6-digit code → verified) and unlink confirm.
//   2. Notification preferences matrix — event rows × channel columns
//      (Switch), marketing opt-ins in a visually separate gold card.
//   3. Recent notifications — what Tengasell sent across linked channels.
// All requests stay RELATIVE (/api/comms/… — the BFF proxies :3005 and
// injects x-tgs-user). Contract: worklog Task 11-plan sections B/C/G.

import { useEffect, useMemo, useState } from "react";
import {
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  MessagesSquare,
  Send,
  Unlink,
  Copy,
  ExternalLink,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState, ErrorState, SectionHeader } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { useResource } from "@/lib/tengasell/hooks";
import { formatDateTime, formatRelative } from "@/lib/tengasell/format";
import type { CurrentUser } from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";

// ── contract types (worklog Task 11-plan §B) ──────────────────────────

type Channel = "email" | "telegram" | "whatsapp" | "messenger";
const CHANNELS: Channel[] = ["email", "telegram", "whatsapp", "messenger"];
type ChannelFlags = Record<Channel, boolean>;

interface ChannelLink {
  id: number;
  channel: Channel;
  handle: string;
  displayLabel?: string | null;
  status: "pending" | "verified" | "disabled";
  createdAt?: string;
  verifiedAt?: string | null;
  verifyToken?: string | null;
}

interface LinkPostResult {
  link: ChannelLink;
  instructions?: { en?: string; ja?: string } | null;
  sandbox?: { verifyCode?: string | null } | null;
  verifyToken?: string | null;
  ok?: boolean;
  error?: string;
}

interface PrefRow {
  eventKey: string;
  labelEn?: string;
  labelJa?: string;
  group?: string;
  default?: Partial<ChannelFlags>;
  user?: Partial<ChannelFlags> | null;
}

interface PrefsPayload {
  matrix?: PrefRow[];
  marketingOptIn?: Partial<ChannelFlags>;
}

interface CommsNotification {
  id: number;
  eventKey: string;
  channel: Channel;
  subject?: string;
  snippet?: string;
  threadId?: string | null;
  status?: string;
  createdAt?: string;
}

// ── client helper — RELATIVE fetches with the TrailBase token ────────

async function commsFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`/api/comms${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) {
    throw new Error(data?.error ?? `Request failed (${res.status}).`);
  }
  return data;
}

// ── channel metadata ────────────────────────────────────────────────

const CHANNEL_ICONS: Record<Channel, LucideIcon> = {
  email: Mail,
  telegram: Send,
  whatsapp: MessageCircle,
  messenger: MessagesSquare,
};

const GROUP_ORDER = [
  "auctions",
  "messages",
  "payments",
  "sla",
  "bookings",
  "account",
] as const;

/** Fallback labels when the service payload omits them. */
const MARKETING_FALLBACK: Record<string, { en: string; ja: string }> = {
  "marketing.digest": {
    en: "Weekly digest of what's hot",
    ja: "今週の注目ダイジェスト",
  },
  "marketing.spotlight": {
    en: "Spotlight deals & featured listings",
    ja: "スポットライト・注目出品",
  },
  "marketing.winback": {
    en: "Win-back offers for inactive buyers",
    ja: "休眠会員向けのお得なオファー",
  },
};

function flags(on: boolean): ChannelFlags {
  return { email: on, telegram: on, whatsapp: on, messenger: on };
}

function allFalse(): ChannelFlags {
  return flags(false);
}

/** Normalize a group name from the service payload (case-insensitive). */
function normGroup(g: string | undefined | null): string {
  return String(g ?? "").trim().toLowerCase();
}

// ── status chips ─────────────────────────────────────────────────────

function StatusChip({ tone, children }: { tone: "ok" | "warn" | "muted" | "danger"; children: React.ReactNode }) {
  const tones = {
    ok: "bg-ok/10 text-ok border-ok/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    muted: "bg-muted text-muted-foreground border-border",
    danger: "bg-danger/10 text-danger border-danger/30",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-caption font-bold whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ── the section ─────────────────────────────────────────────────────

export function CommsSection({ user }: { user: CurrentUser }) {
  const { t } = useI18n();
  const token = user.token;

  const links = useResource<ChannelLink[]>(
    async () => {
      const data = await commsFetch<{ links?: ChannelLink[] }>(token, "/links");
      return data.links ?? [];
    },
    [token],
  );

  const prefs = useResource<PrefsPayload>(
    async () => commsFetch<PrefsPayload>(token, "/preferences"),
    [token],
  );

  const notifications = useResource<CommsNotification[]>(
    async () => {
      const data = await commsFetch<{ items?: CommsNotification[] }>(
        token,
        "/notifications?limit=20",
      );
      return data.items ?? [];
    },
    [token],
  );

  const [wizardChannel, setWizardChannel] = useState<Channel | null>(null);
  const [wizardResume, setWizardResume] = useState<ChannelLink | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<ChannelLink | null>(null);

  return (
    <section aria-labelledby="comms-heading" className="min-w-0 space-y-8">
      <SectionHeader
        title={<span id="comms-heading">{t("nav.communications")}</span>}
        subtitle={t("comms.sectionSub")}
      />

      {/* ── 1. linked channels ─────────────────────────────────────── */}
      <div className="min-w-0 space-y-3">
        <SectionHeader
          title={t("comms.channelsTitle")}
          subtitle={t("comms.channelsSub")}
        />
        {links.loading && !links.data ? (
          <div
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-busy="true"
            aria-label={t("comms.channelsTitle")}
          >
            {CHANNELS.map((ch) => (
              <div key={ch} className="rounded-card border border-border bg-raised p-4 space-y-3">
                <Skeleton className="size-10 rounded-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : links.error ? (
          <ErrorState message={links.error} onRetry={links.reload} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 list-none p-0 m-0">
            {CHANNELS.map((ch) => (
              <ChannelCard
                key={ch}
                channel={ch}
                link={(links.data ?? []).find((l) => l.channel === ch && l.status !== "disabled") ?? null}
                onLink={(resumeLink) => {
                  setWizardResume(resumeLink ?? null);
                  setWizardChannel(ch);
                }}
                onUnlink={(l) => setUnlinkTarget(l)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── 2. preference matrix ───────────────────────────────────── */}
      <PreferencesCard prefs={prefs} token={token} />

      {/* ── 3. recent notifications ─────────────────────────────────── */}
      <div className="min-w-0 space-y-3">
        <SectionHeader title={t("comms.notifTitle")} subtitle={t("comms.notifSub")} />
        <NotificationsCard notifications={notifications} />
      </div>

      {/* ── link wizard dialog ──────────────────────────────────────── */}
      {wizardChannel && (
        <LinkWizard
          channel={wizardChannel}
          token={token}
          open
          resumeLink={wizardResume}
          onOpenChange={(open) => {
            if (!open) {
              setWizardChannel(null);
              setWizardResume(null);
              // A pending link may now exist (code sent but not verified) —
              // refresh so the card shows "Pending" and offers "Enter code".
              links.reload();
            }
          }}
          onVerified={() => {
            setWizardChannel(null);
            setWizardResume(null);
            links.reload();
          }}
        />
      )}

      {/* ── unlink confirm ─────────────────────────────────────────── */}
      <AlertDialog
        open={unlinkTarget != null}
        onOpenChange={(open) => {
          if (!open) setUnlinkTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("comms.unlinkTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("comms.unlinkBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("action.cancel")}</AlertDialogCancel>
            <UnlinkConfirmAction
              link={unlinkTarget}
              token={token}
              onDone={() => {
                setUnlinkTarget(null);
                links.reload();
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ── channel card ─────────────────────────────────────────────────────

function ChannelCard({
  channel,
  link,
  onLink,
  onUnlink,
}: {
  channel: Channel;
  link: ChannelLink | null;
  /** Fresh link → null; resume a pending verification → the existing link. */
  onLink: (resumeLink?: ChannelLink | null) => void;
  onUnlink: (l: ChannelLink) => void;
}) {
  const { t } = useI18n();
  const Icon = CHANNEL_ICONS[channel];
  const label = t(`comms.channel.${channel}`);
  const status: "verified" | "pending" | "notLinked" =
    link == null ? "notLinked" : link.status === "verified" ? "verified" : "pending";

  return (
    <li
      className="rounded-card border border-border bg-raised p-4 flex flex-col gap-3 transition-colors hover:border-teal/40"
      aria-label={label}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2.5 min-w-0">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-tint text-teal-deep">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <span className="text-label font-bold text-foreground">{label}</span>
        </span>
        {status === "verified" && (
          <StatusChip tone="ok">{t("comms.status.verified")}</StatusChip>
        )}
        {status === "pending" && (
          <StatusChip tone="warn">{t("comms.status.pending")}</StatusChip>
        )}
        {status === "notLinked" && (
          <StatusChip tone="muted">{t("comms.status.notLinked")}</StatusChip>
        )}
      </div>

      {link && (
        <p className="text-caption font-mono text-muted-foreground truncate" title={link.handle}>
          {link.handle}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {status === "notLinked" && (
          <Button onClick={() => onLink(null)} className="min-h-11" aria-label={`${t("comms.link")} ${label}`}>
            {t("comms.link")}
          </Button>
        )}
        {status === "pending" && (
          <>
            <Button
              onClick={() => onLink(link)}
              className="min-h-11"
              aria-label={`${t("comms.enterCode")} — ${label}`}
            >
              <KeyRound className="size-4" aria-hidden="true" />
              {t("comms.enterCode")}
            </Button>
            <Button
              variant="outline"
              onClick={() => link && onUnlink(link)}
              className="min-h-11"
              aria-label={`${t("comms.unlink")} ${label}`}
            >
              {t("comms.unlink")}
            </Button>
          </>
        )}
        {status === "verified" && (
          <Button
            variant="outline"
            onClick={() => link && onUnlink(link)}
            className="min-h-11"
            aria-label={`${t("comms.unlink")} ${label}`}
          >
            <Unlink className="size-4" aria-hidden="true" />
            {t("comms.unlink")}
          </Button>
        )}
      </div>
    </li>
  );
}

// ── unlink action (async, toasts) ───────────────────────────────────

function UnlinkConfirmAction({
  link,
  token,
  onDone,
}: {
  link: ChannelLink | null;
  token: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!link) return;
    setBusy(true);
    try {
      await commsFetch(token, `/links/${link.id}/disable`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast({ title: t("comms.unlinkedToast") });
      onDone();
    } catch (err) {
      toast({
        title: t("comms.saveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialogAction
      onClick={(e) => {
        e.preventDefault();
        void run();
      }}
      disabled={busy}
      className="min-h-11 bg-danger text-white hover:bg-danger/90"
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {t("comms.unlink")}
    </AlertDialogAction>
  );
}

// ── link wizard (2-step dialog) ──────────────────────────────────────

function LinkWizard({
  channel,
  token,
  open,
  resumeLink,
  onOpenChange,
  onVerified,
}: {
  channel: Channel;
  token: string;
  open: boolean;
  /** An existing PENDING link to resume verification for (null = fresh). */
  resumeLink?: ChannelLink | null;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void;
}) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<1 | 2>(resumeLink ? 2 : 1);
  const [handle, setHandle] = useState(resumeLink?.handle ?? "");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<LinkPostResult | null>(
    resumeLink ? { link: resumeLink } : null,
  );
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = t(`comms.channel.${channel}`);
  const sandboxCode = result?.sandbox?.verifyCode ?? null;
  const verifyToken = result?.link?.verifyToken ?? result?.verifyToken ?? null;
  const instructions =
    (locale === "ja" ? result?.instructions?.ja : result?.instructions?.en) ?? null;

  function normalize(h: string): string {
    const trimmed = h.trim();
    if (channel === "telegram" && trimmed.startsWith("@")) return trimmed.slice(1);
    if (channel === "whatsapp") {
      const digits = trimmed.replace(/[^\d+]/g, "");
      if (digits.startsWith("+")) return digits;
      if (digits.startsWith("263")) return `+${digits}`;
      if (digits.startsWith("0")) return `+263${digits.slice(1)}`;
      if (digits.length === 9 && digits.startsWith("7")) return `+263${digits}`;
      return digits || trimmed;
    }
    return trimmed;
  }

  async function sendCode() {
    const normalized = normalize(handle);
    if (!normalized) {
      setError(t("comms.wizard.handleRequired"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const data = await commsFetch<LinkPostResult>(token, "/links", {
        method: "POST",
        body: JSON.stringify({ channel, handle: normalized }),
      });
      setResult(data);
      setHandle(data.link?.handle ?? normalized);
      setCode("");
      setStep(2);
    } catch (err) {
      // The service 409s when this channel+handle is already pending —
      // resume verifying the existing link instead of failing hard.
      const msg = err instanceof Error ? err.message : "";
      if (/already linked/i.test(msg) && resumeLink) {
        setResult({ link: resumeLink });
        setHandle(resumeLink.handle);
        setError(null);
        setStep(2);
      } else {
        setError(msg || t("comms.loadFailed"));
      }
    } finally {
      setSending(false);
    }
  }

  async function verify() {
    if (!result?.link) return;
    setVerifying(true);
    setError(null);
    try {
      await commsFetch(token, `/links/${result.link.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      toast({
        title: t("comms.verifiedToastTitle"),
        description: `${label} · ${result.link.handle}`,
      });
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("comms.loadFailed"));
    } finally {
      setVerifying(false);
    }
  }

  const Icon = CHANNEL_ICONS[channel];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-teal-tint text-teal-deep">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            {t(`comms.wizard.${channel}.title`)}
          </DialogTitle>
          <DialogDescription>
            {step === 1 ? t(`comms.wizard.${channel}.hint`) : t("comms.wizard.step2")}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-2">
            <label
              htmlFor={`comms-handle-${channel}`}
              className="text-label font-semibold text-foreground"
            >
              {t(`comms.wizard.${channel}.label`)}
            </label>
            <Input
              id={`comms-handle-${channel}`}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendCode();
              }}
              placeholder={
                channel === "email"
                  ? "you@example.co.zw"
                  : channel === "telegram"
                    ? "@yourname or 263771234567"
                    : channel === "whatsapp"
                      ? "+263 77 123 4567"
                      : "your.name"
              }
              inputMode={channel === "whatsapp" ? "tel" : channel === "email" ? "email" : "text"}
              className="h-11"
              autoFocus
            />
            {error && (
              <p role="alert" className="text-caption text-danger">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-caption text-muted-foreground">
              {t("comms.wizard.sentTo")}:{" "}
              <span className="font-mono text-foreground">{result?.link?.handle}</span>
            </p>
            {instructions && (
              <p className="text-caption text-muted-foreground border-l-2 border-teal/40 pl-3">
                {instructions}
              </p>
            )}

            {channel === "telegram" && (
              <div className="rounded-control border border-border bg-section p-3 space-y-1.5">
                <p className="text-caption font-bold text-foreground">{t("comms.wizard.deepLink")}</p>
                <div className="flex items-center gap-2 min-w-0">
                  <a
                    href={
                      verifyToken
                        ? `https://t.me/TengasellBot?start=${verifyToken}`
                        : "https://t.me/TengasellBot"
                    }
                    target="_blank"
                    rel="noreferrer noopener"
                    className="min-h-11 flex items-center gap-2 truncate font-mono text-caption text-teal-deep underline-offset-2 hover:underline"
                    aria-label={`${t("comms.wizard.deepLink")}: t.me/TengasellBot`}
                  >
                    <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                    {verifyToken
                      ? `t.me/TengasellBot?start=${verifyToken}`
                      : "t.me/TengasellBot"}
                  </a>
                  <Button
                    variant="ghost"
                    className="min-h-11 px-3 shrink-0"
                    aria-label={t("comms.wizard.copy")}
                    onClick={() => {
                      const url = verifyToken
                        ? `https://t.me/TengasellBot?start=${verifyToken}`
                        : "https://t.me/TengasellBot";
                      void navigator.clipboard
                        ?.writeText(url)
                        .then(() => toast({ title: t("comms.wizard.copied") }))
                        .catch(() => {});
                    }}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    {t("comms.wizard.copy")}
                  </Button>
                </div>
              </div>
            )}

            {sandboxCode && (
              <div className="rounded-control border border-gold/40 bg-gold-soft/30 p-3 flex items-center gap-3 flex-wrap" role="status">
                <p className="text-caption font-semibold text-gold-deep">
                  {t("comms.wizard.sandboxPreview")}:{" "}
                  <span className="font-mono text-title tracking-widest">{sandboxCode}</span>
                </p>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setCode(sandboxCode)}
                  aria-label={`${t("comms.wizard.useCode")}: ${sandboxCode}`}
                >
                  {t("comms.wizard.useCode")}
                </Button>
              </div>
            )}

            <label htmlFor="comms-verify-code" className="sr-only">
              {t("comms.wizard.step2")}
            </label>
            <Input
              id="comms-verify-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void verify();
              }}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="h-11 text-center font-mono text-headline tracking-[0.5em]"
              autoFocus
            />
            {error && (
              <p role="alert" className="text-caption text-danger">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-row gap-2">
          {step === 2 && (
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setStep(1);
                setError(null);
              }}
            >
              {t("comms.wizard.back")}
            </Button>
          )}
          {step === 1 ? (
            <Button onClick={() => void sendCode()} disabled={sending || !handle.trim()} className="min-h-11">
              {sending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("comms.wizard.sendCode")}
            </Button>
          ) : (
            <Button onClick={() => void verify()} disabled={verifying || code.trim().length === 0} className="min-h-11">
              {verifying && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {verifying ? t("comms.wizard.verifying") : t("comms.wizard.verify")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── preferences matrix ───────────────────────────────────────────────

interface PrefsDraft {
  rows: Record<string, ChannelFlags>;
  initial: Record<string, ChannelFlags>;
  marketing: ChannelFlags;
  marketingInitial: ChannelFlags;
}

function PreferencesCard({
  prefs,
  token,
}: {
  prefs: ReturnType<typeof useResource<PrefsPayload>>;
  token: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<PrefsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Build the draft whenever fresh data lands (PUT reload → re-init).
  useEffect(() => {
    const data = prefs.data;
    if (!data) return;
    const mkt = data.marketingOptIn ?? {};
    const rows: Record<string, ChannelFlags> = {};
    const initial: Record<string, ChannelFlags> = {};
    for (const row of data.matrix ?? []) {
      const eff = allFalse();
      for (const ch of CHANNELS) {
        const userFlag = row.user?.[ch];
        eff[ch] =
          userFlag != null
            ? !!userFlag
            : normGroup(row.group) === "marketing"
              ? !!mkt[ch]
              : !!(row.default?.[ch] ?? ch === "email");
      }
      rows[row.eventKey] = { ...eff };
      initial[row.eventKey] = { ...eff };
    }
    // Synthesize the marketing rows if the payload omits them (contract §C
    // fixes the three keys) — channel opt-in drives them in that case.
    for (const key of Object.keys(MARKETING_FALLBACK)) {
      if (rows[key]) continue;
      const eff = allFalse();
      for (const ch of CHANNELS) eff[ch] = !!mkt[ch];
      rows[key] = eff;
      initial[key] = { ...eff };
    }
    const marketing = allFalse();
    const marketingInitial = allFalse();
    for (const ch of CHANNELS) {
      const on =
        !!rows["marketing.digest"]?.[ch] ||
        !!rows["marketing.spotlight"]?.[ch] ||
        !!rows["marketing.winback"]?.[ch];
      marketing[ch] = on;
      marketingInitial[ch] = on;
    }
    setDraft({ rows, initial, marketing, marketingInitial });
    setSaveError(null);
  }, [prefs.data]);

  const dirty = useMemo(() => {
    if (!draft) return false;
    for (const key of Object.keys(draft.rows)) {
      for (const ch of CHANNELS) {
        if (draft.rows[key][ch] !== draft.initial[key][ch]) return true;
      }
    }
    return false;
  }, [draft]);

  if (prefs.loading && !prefs.data) {
    return (
      <div className="min-w-0 space-y-3" aria-busy="true" aria-label={t("comms.prefsTitle")}>
        <SectionHeader title={t("comms.prefsTitle")} subtitle={t("comms.prefsSub")} />
        <div className="rounded-card border border-border bg-raised p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (prefs.error) {
    return (
      <div className="min-w-0 space-y-3">
        <SectionHeader title={t("comms.prefsTitle")} subtitle={t("comms.prefsSub")} />
        <ErrorState message={prefs.error} onRetry={prefs.reload} />
      </div>
    );
  }
  if (!draft || !prefs.data) return null;

  const matrix = prefs.data.matrix ?? [];
  const transactionalRows = matrix.filter((r) => normGroup(r.group) !== "marketing");
  const marketingRows = Object.keys(MARKETING_FALLBACK).map((key) => {
    const row = matrix.find((r) => r.eventKey === key);
    return (
      row ?? {
        eventKey: key,
        group: "marketing",
        labelEn: MARKETING_FALLBACK[key].en,
        labelJa: MARKETING_FALLBACK[key].ja,
      }
    );
  });

  function toggle(eventKey: string, ch: Channel) {
    setDraft((d) => {
      if (!d) return d;
      const rows = { ...d.rows, [eventKey]: { ...d.rows[eventKey], [ch]: !d.rows[eventKey][ch] } };
      const marketing = allFalse();
      for (const c of CHANNELS) {
        marketing[c] =
          !!rows["marketing.digest"]?.[c] ||
          !!rows["marketing.spotlight"]?.[c] ||
          !!rows["marketing.winback"]?.[c];
      }
      return { ...d, rows, marketing };
    });
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const allKeys = [...transactionalRows.map((r) => r.eventKey), ...marketingRows.map((r) => r.eventKey)];
      const uniqueKeys = [...new Set(allKeys)];
      await commsFetch(token, "/preferences", {
        method: "PUT",
        body: JSON.stringify({
          matrix: uniqueKeys.map((key) => ({
            eventKey: key,
            email: !!draft?.rows[key]?.email,
            telegram: !!draft?.rows[key]?.telegram,
            whatsapp: !!draft?.rows[key]?.whatsapp,
            messenger: !!draft?.rows[key]?.messenger,
          })),
          marketingOptIn: {
            email: !!draft?.marketing.email,
            telegram: !!draft?.marketing.telegram,
            whatsapp: !!draft?.marketing.whatsapp,
            messenger: !!draft?.marketing.messenger,
          },
        }),
      });
      toast({ title: t("comms.saved") });
      prefs.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("comms.saveFailed"));
      toast({
        title: t("comms.saveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <SectionHeader title={t("comms.prefsTitle")} subtitle={t("comms.prefsSub")} />

      {/* transactional matrix */}
      <div className="rounded-card border border-border bg-raised overflow-hidden">
        <div className="overflow-x-auto ts-scrollbar">
          <PrefsTable rows={transactionalRows} draft={draft.rows} onToggle={toggle} grouped />
        </div>
      </div>
      <p className="text-caption text-muted-foreground border-l-2 border-teal/40 pl-3">
        {t("comms.transactionalNote")}
      </p>

      {/* marketing opt-ins — visually separate, explicit opt-in */}
      <div className="rounded-card border border-gold/50 bg-gold-soft/20 overflow-hidden">
        <div className="p-4 pb-3 space-y-1">
          <h3 className="text-label font-bold text-gold-deep flex items-center gap-2">
            <Inbox className="size-4" aria-hidden="true" />
            {t("comms.marketingTitle")}
          </h3>
          <p className="text-caption text-muted-foreground">{t("comms.marketingNotice")}</p>
        </div>
        <div className="bg-raised">
          <div className="overflow-x-auto ts-scrollbar">
            <PrefsTable rows={marketingRows} draft={draft.rows} onToggle={toggle} marketing />
          </div>
        </div>
      </div>

      {/* save bar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saveError && (
          <p role="alert" className="text-caption text-danger me-auto">
            {saveError}
          </p>
        )}
        <Button
          variant="outline"
          className="min-h-11"
          disabled={!dirty || saving}
          onClick={() => {
            setDraft((d) => (d ? { ...d, rows: { ...d.initial }, marketing: { ...d.marketingInitial } } : d));
            setSaveError(null);
          }}
        >
          {t("comms.revert")}
        </Button>
        <Button onClick={() => void save()} disabled={!dirty || saving} className="min-h-11">
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {saving ? t("comms.saving") : t("action.save")}
        </Button>
      </div>
    </div>
  );
}

// ── the matrix table (sticky first column, 44px rows/targets) ────────

function PrefsTable({
  rows,
  draft,
  onToggle,
  grouped = false,
  marketing = false,
}: {
  rows: PrefRow[];
  draft: Record<string, ChannelFlags>;
  onToggle: (eventKey: string, ch: Channel) => void;
  grouped?: boolean;
  marketing?: boolean;
}) {
  const { t, locale } = useI18n();

  function rowLabel(row: PrefRow): string {
    if (locale === "ja" && row.labelJa) return row.labelJa;
    if (row.labelEn) return row.labelEn;
    return MARKETING_FALLBACK[row.eventKey]
      ? locale === "ja"
        ? MARKETING_FALLBACK[row.eventKey].ja
        : MARKETING_FALLBACK[row.eventKey].en
      : row.eventKey;
  }

  const groups: { key: string; rows: PrefRow[] }[] = grouped
    ? [
        ...GROUP_ORDER.map((g) => ({
          key: g,
          rows: rows.filter((r) => normGroup(r.group) === g),
        })),
        // defensive: render any unexpected group after the pinned ones
        ...[...new Set(rows.map((r) => normGroup(r.group)))]
          .filter((g) => !GROUP_ORDER.includes(g as (typeof GROUP_ORDER)[number]))
          .map((g) => ({ key: g, rows: rows.filter((r) => normGroup(r.group) === g) })),
      ].filter((g) => g.rows.length > 0)
    : [{ key: "marketing", rows }];

  return (
    <table className="w-full min-w-[380px] border-collapse text-start">
      <thead>
        <tr className="border-b border-border bg-section">
          <th scope="col" className="sticky left-0 z-10 bg-section px-4 py-2.5 min-w-[9.5rem] border-r border-border/60">
            <span className="sr-only">{t("comms.prefsTitle")}</span>
          </th>
          {CHANNELS.map((ch) => {
            const Icon = CHANNEL_ICONS[ch];
            const label = t(`comms.channel.${ch}`);
            return (
              <th key={ch} scope="col" className="px-1 py-2">
                <span className="flex min-h-8 flex-col items-center justify-center gap-0.5">
                  <Icon className="size-4 text-teal-deep" aria-hidden="true" />
                  <span className="hidden md:block text-caption font-semibold text-muted-foreground">
                    {label}
                  </span>
                  <span className="sr-only">{label}</span>
                </span>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {groups.map((g, gi) => (
          <RowGroup
            key={`${g.key}-${gi}`}
            groupKey={g.key}
            rows={g.rows}
            rowLabel={rowLabel}
            draft={draft}
            onToggle={onToggle}
            marketing={marketing}
          />
        ))}
      </tbody>
    </table>
  );
}

function RowGroup({
  groupKey,
  rows,
  rowLabel,
  draft,
  onToggle,
  marketing,
}: {
  groupKey: string;
  rows: PrefRow[];
  rowLabel: (r: PrefRow) => string;
  draft: Record<string, ChannelFlags>;
  onToggle: (eventKey: string, ch: Channel) => void;
  marketing: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      {marketing ? null : (
        <tr>
          <th
            scope="colgroup"
            colSpan={5}
            className="bg-section px-4 py-2 text-start text-caption font-bold uppercase tracking-wide text-teal-deep border-y border-border"
          >
            {t(`comms.group.${groupKey}`)}
          </th>
        </tr>
      )}
      {rows.map((row) => {
        const label = rowLabel(row);
        return (
          <tr key={row.eventKey} className="border-b border-border/60 last:border-b-0">
            <th
              scope="row"
              className="sticky left-0 z-10 bg-raised px-4 py-2 text-start font-normal border-r border-border/60"
            >
              <span className="block min-h-6 text-caption text-foreground">{label}</span>
              <span className="sr-only"> ({t(`comms.group.${normGroup(groupKey)}`)})</span>
            </th>
            {CHANNELS.map((ch) => {
              const on = !!draft[row.eventKey]?.[ch];
              const chLabel = t(`comms.channel.${ch}`);
              return (
                <td key={ch} className="px-1 py-1">
                  <div
                    className="flex min-h-11 min-w-11 items-center justify-center"
                    onClick={(e) => {
                      // extend the touch target to the whole 44px cell
                      if (e.target === e.currentTarget) onToggle(row.eventKey, ch);
                    }}
                  >
                    <Switch
                      checked={on}
                      onCheckedChange={() => onToggle(row.eventKey, ch)}
                      aria-label={`${label} — ${chLabel}`}
                    />
                  </div>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

// ── recent notifications ─────────────────────────────────────────────

function statusMeta(status: string | undefined): {
  tone: "ok" | "warn" | "danger" | "muted";
  label: string;
} {
  switch (status) {
    case "sent":
      return { tone: "ok", label: "comms.status.sent" };
    case "queued":
      return { tone: "warn", label: "comms.status.queued" };
    case "sending":
      return { tone: "warn", label: "comms.status.sending" };
    case "failed":
    case "dead":
      return { tone: "danger", label: "comms.status.failed" };
    default:
      return { tone: "muted", label: "" };
  }
}

function NotificationsCard({
  notifications,
}: {
  notifications: ReturnType<typeof useResource<CommsNotification[]>>;
}) {
  const { t } = useI18n();
  const items = notifications.data ?? [];

  return (
    <div className="rounded-card border border-border bg-raised overflow-hidden min-w-0">
      {notifications.loading && !notifications.data ? (
        <div className="px-4 py-3 space-y-4" aria-busy="true" aria-label={t("comms.notifTitle")}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 items-center">
              <Skeleton className="size-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <Skeleton className="h-5 w-14 shrink-0" />
            </div>
          ))}
        </div>
      ) : notifications.error ? (
        <div className="p-4">
          <ErrorState message={notifications.error} onRetry={notifications.reload} />
        </div>
      ) : items.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<Inbox className="size-10" />}
            title={t("state.empty")}
            body={t("comms.notifEmpty")}
          />
        </div>
      ) : (
        <ul
          className="max-h-96 overflow-y-auto ts-scrollbar divide-y divide-border/60 m-0 p-0 list-none"
          aria-label={t("comms.notifTitle")}
        >
          {items.map((n) => {
            const Icon = CHANNEL_ICONS[n.channel] ?? Inbox;
            const meta = statusMeta(n.status);
            return (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-tint text-teal-deep">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-label font-semibold text-foreground truncate">
                    {n.subject || n.eventKey}
                  </p>
                  {n.snippet && (
                    <p className="text-caption text-muted-foreground line-clamp-1">{n.snippet}</p>
                  )}
                  <p className="text-caption text-muted-foreground/80 mt-0.5">
                    <time
                      dateTime={n.createdAt}
                      title={n.createdAt ? formatDateTime(n.createdAt) : undefined}
                    >
                      {n.createdAt ? formatRelative(n.createdAt) : ""}
                    </time>
                  </p>
                </div>
                <div className="shrink-0 pt-0.5">
                  <StatusChip tone={meta.tone}>
                    {meta.label ? t(meta.label) : (n.status ?? "")}
                  </StatusChip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
