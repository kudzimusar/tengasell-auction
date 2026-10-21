"use client";

// Tengasell — Policies pages (#/policies/{key}). Task 12-d (govern plane).
//
// PUBLIC reader — no auth: fetches /api/gov/public/policies for the side
// list and /api/gov/public/policies/{key}?locale= for the body. The service
// stores markdown-lite (## headings, - list items, blank-line paragraphs);
// the renderer below maps those three constructs to styled JSX — text is
// rendered through React elements ONLY (no dangerouslySetInnerHTML), so any
// HTML in a policy body is escaped by construction.
//
// Signed-in visitors can record an acceptance ("I've read and accept this
// version" → POST /api/gov/public/acceptances — the BFF attaches their
// username). Not-published policies render a clean empty state.

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/tengasell/ui";
import { useI18n } from "@/lib/tengasell/i18n";
import { useAuth } from "@/lib/tengasell/auth";
import { useLinkProps } from "@/lib/tengasell/router";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useResource } from "@/lib/tengasell/hooks";
import { PolicyMarkdown } from "../gov-client";

const POLICY_KEYS = [
  "tos",
  "privacy",
  "rules",
  "seller",
  "aup",
  "refunds",
  "ip",
  "accessibility",
] as const;

export type PolicyKey = (typeof POLICY_KEYS)[number];

export const POLICY_ROUTE_KEYS: readonly string[] = POLICY_KEYS;

// ── wire types (govern-service serializers) ─────────────────────────────

interface PolicyListItem {
  key: string;
  title: string;
  title_ja: string;
  current_version: number;
  effective_from: string | null;
}

interface PolicyBody {
  key: string;
  title: string;
  title_en: string;
  title_ja: string;
  version: number;
  locale: string;
  fallback: boolean;
  effective_from: string;
  published_at: string | null;
  change_note: string | null;
  body: string;
}

interface AcceptanceRow {
  policy_key: string;
  version: number;
  accepted_at: string;
  surface: string;
}

// ── markdown-lite rendering lives in gov-client.tsx (PolicyMarkdown) —
// text flows through React elements only, so HTML in a body is escaped
// by construction.

// ── TOC side list ────────────────────────────────────────────────────────

function PolicyTocLink({
  item,
  activeKey,
  labelFor,
}: {
  item: PolicyListItem;
  activeKey: string;
  labelFor: (item: PolicyListItem) => string;
}) {
  const { t } = useI18n();
  const { href, onClick } = useLinkProps(`/policies/${item.key}`);
  const active = item.key === activeKey;
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-control px-3 py-2 text-label transition-colors",
        active
          ? "bg-teal-tint text-teal-deep font-bold border border-teal/30"
          : "text-foreground/80 hover:bg-accent border border-transparent",
      )}
    >
      {active && <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 truncate">{labelFor(item)}</span>
      <span className="ml-auto text-caption text-muted-foreground ts-numeric shrink-0">
        v{item.current_version}
      </span>
      <span className="sr-only">{t("policies.version")}</span>
    </a>
  );
}

// ── page ─────────────────────────────────────────────────────────────────

export default function PoliciesPage({ policyKey }: { policyKey: string }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const key = POLICY_KEYS.includes(policyKey as PolicyKey)
    ? (policyKey as PolicyKey)
    : "tos";

  const list = useResource<{ policies: PolicyListItem[] }>(
    async () => {
      const res = await fetch("/api/gov/public/policies");
      const data = (await res.json().catch(() => null)) as
        | { policies?: PolicyListItem[] }
        | null;
      const policies = data?.policies;
      if (!res.ok || !policies) throw new Error(t("policies.loadFailed"));
      return { policies };
    },
    [],
  );

  const policy = useResource<PolicyBody>(
    async () => {
      const res = await fetch(
        `/api/gov/public/policies/${encodeURIComponent(key)}?locale=${locale}`,
      );
      const data = (await res.json().catch(() => null)) as (PolicyBody & { error?: string }) | null;
      if (!res.ok || !data) {
        throw new Error(data?.error ?? t("policies.loadFailed"));
      }
      return data;
    },
    [key, locale],
  );

  // My acceptances (signed-in only) — powers the accepted state of the button.
  const [accepted, setAccepted] = useState<string | null>(null);
  const reloadAccepted = useCallback(async () => {
    if (!user) {
      setAccepted(null);
      return;
    }
    try {
      const res = await fetch("/api/gov/me/policies", {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { acceptances?: AcceptanceRow[] };
      const match = (data.acceptances ?? []).find((a) => a.policy_key === key);
      setAccepted(match ? `${key}:v${match.version}` : null);
    } catch {
      /* non-fatal */
    }
  }, [user, key]);
  useEffect(() => {
    void reloadAccepted();
  }, [reloadAccepted]);

  const [accepting, setAccepting] = useState(false);
  const onAccept = useCallback(async () => {
    if (!policy.data || accepting) return;
    setAccepting(true);
    try {
      const res = await fetch("/api/gov/public/acceptances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_key: policy.data.key,
          version: String(policy.data.version),
          surface: "policy_page",
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? t("policies.loadFailed"));
      }
      toast({ title: t("policies.acceptToast") });
      setAccepted(`${policy.data.key}:v${policy.data.version}`);
    } catch (err) {
      toast({
        title: t("policies.loadFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setAccepting(false);
    }
  }, [policy.data, accepting, t]);

  const tocTitle = (item: PolicyListItem): string =>
    locale === "ja" ? item.title_ja : item.title;

  const activeAccepted =
    policy.data && accepted === `${policy.data.key}:v${policy.data.version}`;

  const notPublished =
    policy.error?.includes("not published") || policy.error?.includes("no published version");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10 w-full">
      <header className="mb-6">
        <p className="text-caption text-gold-deep font-bold uppercase tracking-wide">
          {t("policies.kicker")}
        </p>
        <h1 className="text-headline text-foreground mt-1">
          {policy.data ? policy.data.title : t(`policies.${key}.title`)}
        </h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        {/* side TOC — stacks above the body on mobile */}
        <nav
          aria-label={t("policies.toc.aria")}
          className="rounded-card border border-border bg-raised p-2 lg:sticky lg:top-20 lg:self-start"
        >
          {list.loading ? (
            <div className="space-y-2 p-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : list.error ? null : (
            <ul className="space-y-1 max-h-96 overflow-y-auto ts-scrollbar">
              {(list.data?.policies ?? []).map((item) => (
                <li key={item.key}>
                  <PolicyTocLink item={item} activeKey={key} labelFor={tocTitle} />
                </li>
              ))}
            </ul>
          )}
        </nav>

        {/* policy body */}
        <article className="min-w-0">
          {policy.loading ? (
            <div className="space-y-4" aria-busy="true">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : policy.error ? (
            notPublished ? (
              <EmptyState
                icon={<FileText className="size-10" />}
                title={t("policies.notPublished.title")}
                body={t("policies.notPublished.body")}
              />
            ) : (
              <ErrorState message={policy.error} onRetry={policy.reload} />
            )
          ) : policy.data ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted-foreground">
                <span className="font-bold text-teal-deep ts-numeric">
                  {t("policies.version")} {policy.data.version}
                </span>
                <span className="ts-numeric">
                  {t("policies.effective")}: {policy.data.effective_from}
                </span>
                {policy.data.published_at && (
                  <span className="ts-numeric">
                    {t("policies.publishedAt")}: {policy.data.published_at.slice(0, 10)}
                  </span>
                )}
                {policy.data.fallback && locale === "ja" && (
                  <span className="text-warn">{t("policies.jaFallback")}</span>
                )}
              </div>

              <div className="rounded-card border border-border bg-raised p-4 sm:p-6">
                <PolicyMarkdown body={policy.data.body} />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-2 text-caption text-muted-foreground max-w-xl">
                  <ShieldCheck className="size-4 mt-0.5 shrink-0 text-teal" aria-hidden="true" />
                  {t("policies.notLegalAdvice")}
                </p>
                {user ? (
                  activeAccepted ? (
                    <span
                      className="inline-flex min-h-11 items-center gap-2 rounded-control border border-ok/30 bg-ok/10 px-4 text-label font-bold text-ok"
                      aria-live="polite"
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      {t("policies.accepted")}
                    </span>
                  ) : (
                    <Button
                      onClick={onAccept}
                      disabled={accepting}
                      className="min-h-11"
                      aria-label={t("policies.accept")}
                    >
                      {accepting ? t("comms.saving") : t("policies.accept")}
                    </Button>
                  )
                ) : (
                  <p className="text-caption text-muted-foreground">
                    {t("policies.signinToAccept")}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}
