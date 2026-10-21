"use client";

// Gap-8 (F1): Saved Searches section (#/my/searches).
// One card per saved search: criteria chips, new-match alert toggle
// (api.setSearchAlerts), one-tap "Run search" deep link and a confirmed
// delete (api.deleteSearch). Loading → error-retry → empty states follow the
// My-section conventions (useResource + LoadingGrid/ErrorState/EmptyState).
// NXS long-list rule: >8 cards → the grid scrolls (max-h-96 ts-scrollbar).

import { useState } from "react";
import {
  Banknote,
  BellOff,
  BellRing,
  BookmarkPlus,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import {
  EmptyState,
  ErrorState,
  LoadingGrid,
  SectionHeader,
} from "@/components/tengasell/ui";
import { LinkButton } from "./auth-shared";
import { api } from "@/lib/tengasell/api";
import { formatUSD } from "@/lib/tengasell/format";
import { useCategories, useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import type { SavedSearch } from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";

/** Deep link for "Run search" — param names match the browse page's own
 *  query-param parsing (q + ending as props; cat/min/max read from the
 *  route query). Only set criteria become params. */
function buildRunHref(s: SavedSearch): string {
  const params = new URLSearchParams();
  if (s.query) params.set("q", s.query);
  if (s.category) params.set("cat", s.category);
  if (s.min_price != null) params.set("min", String(s.min_price));
  if (s.max_price != null) params.set("max", String(s.max_price));
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

const CHIP =
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-caption font-semibold whitespace-nowrap";

export function SavedSearchesSection() {
  const { t, locale } = useI18n();
  const { categories } = useCategories();
  const res = useResource(() => api.savedSearches(), []);

  // optimistic alert toggles (id → on) layered over the fetched rows;
  // reverted on failure, so the switch always feels instant.
  const [alertOverrides, setAlertOverrides] = useState<Record<number, boolean>>({});
  const [busyAlerts, setBusyAlerts] = useState<Set<number>>(new Set());

  const items = res.data ?? [];

  const catName = (slug: string) => {
    const c = categories.find((x) => x.slug === slug);
    return c ? (locale === "ja" ? c.name_ja : c.name) : slug;
  };

  const priceLabel = (s: SavedSearch): string => {
    const min = s.min_price;
    const max = s.max_price;
    if (min != null && max != null) return `${formatUSD(min)} \u2013 ${formatUSD(max)}`;
    if (min != null) return `${formatUSD(min)}+`;
    return `${t("searches.save.under")} ${formatUSD(max as number)}`;
  };

  const toggleAlerts = async (s: SavedSearch, on: boolean) => {
    if (busyAlerts.has(s.id)) return;
    setBusyAlerts((prev) => new Set(prev).add(s.id));
    setAlertOverrides((prev) => ({ ...prev, [s.id]: on }));
    try {
      await api.setSearchAlerts(s.id, on);
      toast({ title: on ? t("searches.alertsOn") : t("searches.alertsOff") });
    } catch {
      setAlertOverrides((prev) => {
        const next = { ...prev };
        delete next[s.id];
        return next;
      });
      toast({ title: t("searches.alertsFailed"), variant: "destructive" });
    } finally {
      setBusyAlerts((prev) => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
    }
  };

  const doDelete = async (s: SavedSearch) => {
    try {
      await api.deleteSearch(s.id);
      setAlertOverrides((prev) => {
        const next = { ...prev };
        delete next[s.id];
        return next;
      });
      toast({ title: t("searches.deleted") });
      res.reload();
    } catch {
      toast({ title: t("searches.deleteFailed"), variant: "destructive" });
    }
  };

  return (
    <section aria-labelledby="saved-searches-heading" className="min-w-0">
      <SectionHeader
        icon={<Search className="size-4 text-teal" aria-hidden="true" />}
        title={<span id="saved-searches-heading">{t("searches.title")}</span>}
        subtitle={t("searches.subtitle")}
      />
      <div className="min-w-0">
        {res.loading && !res.data ? (
          <div aria-busy="true" aria-label={t("state.loading")}>
            <LoadingGrid count={4} />
          </div>
        ) : res.error ? (
          <ErrorState message={t("searches.loadError")} onRetry={res.reload} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Search className="size-10" aria-hidden="true" />}
            title={t("searches.empty")}
            body={t("searches.emptyHint")}
            action={
              <LinkButton to="/search" variant="gold">
                <BookmarkPlus className="size-4" aria-hidden="true" />
                {t("searches.browse")}
              </LinkButton>
            }
          />
        ) : (
          <div
            className={cn(
              "grid gap-4 md:grid-cols-2",
              items.length > 8 && "max-h-96 overflow-y-auto ts-scrollbar",
            )}
          >
            {items.map((s) => (
              <SavedSearchCard
                key={s.id}
                saved={s}
                alertsOn={alertOverrides[s.id] ?? s.alerts === 1}
                busy={busyAlerts.has(s.id)}
                catName={s.category ? catName(s.category) : ""}
                priceLabel={
                  s.min_price != null || s.max_price != null ? priceLabel(s) : null
                }
                onToggle={(on) => void toggleAlerts(s, on)}
                onDelete={() => void doDelete(s)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SavedSearchCard({
  saved,
  alertsOn,
  busy,
  catName,
  priceLabel,
  onToggle,
  onDelete,
}: {
  saved: SavedSearch;
  alertsOn: boolean;
  busy: boolean;
  catName: string;
  priceLabel: string | null;
  onToggle: (on: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const runHref = buildRunHref(saved);

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-raised p-4">
      <h3 className="min-w-0 break-words text-bodyStrong font-bold text-foreground">
        {saved.name}
      </h3>

      {/* criteria chips */}
      <ul
        className="flex flex-wrap gap-1.5"
        aria-label={t("searches.save.criteria")}
      >
        {saved.query && (
          <li
            className={cn(
              CHIP,
              "border-teal/30 bg-teal-tint text-teal-deep",
            )}
          >
            <Search className="size-3 shrink-0" aria-hidden="true" />
            <span className="max-w-56 truncate">{`\u201C${saved.query}\u201D`}</span>
          </li>
        )}
        {saved.category && (
          <li
            className={cn(CHIP, "border-border bg-muted text-muted-foreground")}
          >
            <Tag className="size-3 shrink-0" aria-hidden="true" />
            <span className="max-w-56 truncate">{catName}</span>
          </li>
        )}
        {priceLabel != null && (
          <li
            className={cn(
              CHIP,
              "border-gold/40 bg-gold-soft/60 text-gold-on",
            )}
          >
            <Banknote className="size-3 shrink-0" aria-hidden="true" />
            <span className="ts-numeric">{priceLabel}</span>
          </li>
        )}
      </ul>

      {/* new-match alert toggle */}
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label
          htmlFor={`saved-search-alerts-${saved.id}`}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 text-caption text-muted-foreground"
        >
          {alertsOn ? (
            <BellRing className="size-4 shrink-0 text-teal" aria-hidden="true" />
          ) : (
            <BellOff
              className="size-4 shrink-0 text-muted-foreground/70"
              aria-hidden="true"
            />
          )}
          {t("searches.alertsLabel")}
        </Label>
        <Switch
          id={`saved-search-alerts-${saved.id}`}
          checked={alertsOn}
          disabled={busy}
          onCheckedChange={(v) => onToggle(v === true)}
          aria-label={`${t("searches.alertsLabel")} \u2014 ${saved.name}`}
        />
      </div>

      {/* actions */}
      <div className="flex items-center gap-2">
        <LinkButton
          to={runHref}
          variant="primary"
          ariaLabel={`${t("searches.run")} \u2014 ${saved.name}`}
          className="flex-1 px-4"
        >
          <Search className="size-4" aria-hidden="true" />
          {t("searches.run")}
        </LinkButton>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              className="h-11 min-h-11 px-3 text-danger hover:bg-danger/10"
              aria-label={`${t("searches.delete")} \u2014 ${saved.name}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t("searches.delete")}</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("searches.deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("searches.deleteBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 min-h-11">
                {t("searches.deleteCancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                className="h-11 min-h-11"
                onClick={onDelete}
              >
                {t("searches.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}
