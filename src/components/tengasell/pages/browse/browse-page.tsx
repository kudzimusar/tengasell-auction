"use client";

// Tengasell browse/search page — eBay-style catalog browser used for
//   #/search?q=…&ending=…   search results (?ending=60 → closing-soon mode,
//                           seeds the "Ending within" filter with 60 minutes)
//   #/c/{slug}              category browse (name + blurb via useCategories)
//   #/search?cat=&min=&max=  saved-search deep links (Gap-8): the router only
//                           forwards q/ending as props, so cat/min/max are
//                           read here from the route query to re-seed filters.
//
// Desktop: 260px filter sidebar + results column. Mobile: "Filters" button
// opening a vaul drawer. Sort maps to the api order param (ending|newest|
// price_asc|price_desc|bids|hot); grid uses AuctionCard, list uses compact
// rows. The results section is remounted (key) on every query change so
// loading skeletons show exactly when they should.
//
// Gap-8 (F1): "Save this search" — signed-in users store the current
// criteria (keyword, category, price range) as a named saved search with an
// optional new-match alert.

import { useCallback, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  BellPlus,
  ChevronRight,
  LayoutGrid,
  List,
  Loader2,
  SlidersHorizontal,
  X,
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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useCategories } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { formatUSD } from "@/lib/tengasell/format";
import { useRouter } from "@/lib/tengasell/router";
import type { AuctionQuery } from "@/lib/tengasell/types";
import { cn } from "@/lib/utils";
import {
  countActiveFilters,
  conditionOptionLabel,
  endingLabel,
  FilterPanel,
  initialFilters,
  type BrowseFilters,
} from "./filter-panel";
import { ResultsSection } from "./results";

type SortOrder = NonNullable<AuctionQuery["order"]>;
type ViewMode = "grid" | "list";

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "ending", label: "Ending soonest" },
  { value: "newest", label: "Newest listed" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "bids", label: "Most bids" },
  { value: "hot", label: "Hottest" },
];

function parseEnding(ending?: string): number | null {
  if (!ending) return null;
  const n = Number(ending);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Saved-search deep link price param — mirrors the filter panel's parse
 *  (finite, >= 0, rounded to cents). */
function parsePriceParam(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

interface FilterChip {
  key: string;
  label: string;
  clear: () => void;
}

export default function BrowsePage({
  mode,
  categorySlug,
  q,
  ending,
}: {
  mode: "search" | "category";
  categorySlug?: string;
  q?: string;
  ending?: string;
}) {
  const { categories } = useCategories();
  const { route, navigate } = useRouter();
  const { user } = useAuth();
  const { t, locale } = useI18n();

  // Saved-search deep-link params (read once per mount — the page is remounted
  // by the router's AnimatePresence on every hash change, same as q/ending).
  const catParam = mode === "search" ? route.query.get("cat") : null;
  const urlMin = parsePriceParam(route.query.get("min"));
  const urlMax = parsePriceParam(route.query.get("max"));

  const [filters, setFilters] = useState<BrowseFilters>(() => {
    const base = initialFilters(parseEnding(ending));
    return {
      ...base,
      minPrice: urlMin ?? base.minPrice,
      maxPrice: urlMax ?? base.maxPrice,
    };
  });
  const [sort, setSort] = useState<SortOrder>("ending");
  const [view, setView] = useState<ViewMode>("grid");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const reduced = useReducedMotion();

  // Gap-8 F1: save-this-search dialog state
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveAlerts, setSaveAlerts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const category = useMemo(
    () => {
      const slug = mode === "category" ? categorySlug : catParam;
      return slug ? categories.find((c) => c.slug === slug) : undefined;
    },
    [mode, categorySlug, catParam, categories],
  );

  const heading =
    mode === "category"
      ? (category?.name ?? "All auctions")
      : q
        ? `Results for \u201c${q}\u201d`
        : catParam && category
          ? category.name
          : parseEnding(ending) != null
            ? "Closing soon"
            : "All live auctions";

  const activeCount = countActiveFilters(filters);
  const routeKey = `${mode}:${categorySlug ?? ""}:${q ?? ""}:${ending ?? ""}`;
  // FilterPanel remount key — route changes AND external price-filter changes
  // (chip removal, clear all) re-seed the draft inputs without sync effects.
  const panelKey = `${routeKey}:${filters.minPrice ?? ""}-${filters.maxPrice ?? ""}`;

  // URL changes (q / category / ending) remount this page via the router's
  // AnimatePresence key, so useState initializers re-run on every route.

  const applyFilters = useCallback((patch: Partial<BrowseFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(initialFilters(null));
    toast({
      title: "Filters cleared",
      description: "Showing all live auctions in this view.",
    });
  }, []);

  // ── Gap-8 F1: save this search ────────────────────────────────
  // Criteria come from page state only (q/category props + filter state),
  // never re-parsed from the URL.
  const activeCategorySlug = mode === "category" ? categorySlug : catParam;
  const categoryDisplayName = category
    ? locale === "ja"
      ? category.name_ja
      : category.name
    : (activeCategorySlug ?? "");

  const criteriaRows = useMemo(() => {
    const rows: { key: string; label: string; value: string }[] = [];
    if (q) rows.push({ key: "query", label: t("searches.save.query"), value: q });
    if (categoryDisplayName)
      rows.push({ key: "category", label: t("searches.save.category"), value: categoryDisplayName });
    if (filters.minPrice != null || filters.maxPrice != null) {
      const min = filters.minPrice;
      const max = filters.maxPrice;
      let value: string;
      if (min != null && max != null) value = `${formatUSD(min)} \u2013 ${formatUSD(max)}`;
      else if (min != null) value = `${formatUSD(min)}+`;
      else value = `${t("searches.save.under")} ${formatUSD(max as number)}`;
      rows.push({ key: "price", label: t("searches.save.price"), value });
    }
    return rows;
  }, [q, categoryDisplayName, filters.minPrice, filters.maxPrice, t]);

  const defaultSaveName = useMemo(
    () =>
      q
        ? q
        : categoryDisplayName
          ? `${t("searches.save.namePrefix")} ${categoryDisplayName}`
          : t("searches.save.any"),
    [q, categoryDisplayName, t],
  );

  const openSaveDialog = () => {
    if (!user) {
      navigate("/signin");
      return;
    }
    setSaveName(defaultSaveName);
    setSaveAlerts(true);
    setSaveError(null);
    setSaveOpen(true);
  };

  const confirmSave = async () => {
    if (saving) return;
    const name = saveName.trim().slice(0, 80) || defaultSaveName;
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveSearch({
        name,
        query: q ?? null,
        category: activeCategorySlug ?? null,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        alerts: saveAlerts,
      });
      setSaveOpen(false);
      toast({
        title: t("searches.save.successTitle"),
        description: t("searches.save.success"),
      });
    } catch {
      setSaveError(t("searches.save.error"));
    } finally {
      setSaving(false);
    }
  };

  // compact filter summary chips (whole chip = remove target, 44px)
  const chips: FilterChip[] = useMemo(() => {
    const list: FilterChip[] = [];
    if (filters.condition) {
      list.push({
        key: "condition",
        label: `Condition: ${conditionOptionLabel(filters.condition)}`,
        clear: () => applyFilters({ condition: "" }),
      });
    }
    const min = filters.minPrice;
    const max = filters.maxPrice;
    if (min != null || max != null) {
      let range: string;
      if (min != null && max != null) range = `${formatUSD(min)} \u2013 ${formatUSD(max)}`;
      else if (min != null) range = `${formatUSD(min)}+`;
      else range = `Under ${formatUSD(max as number)}`;
      list.push({
        key: "price",
        label: `Price: ${range}`,
        clear: () => applyFilters({ minPrice: null, maxPrice: null }),
      });
    }
    if (filters.city) {
      list.push({
        key: "city",
        label: `City: ${filters.city}`,
        clear: () => applyFilters({ city: "" }),
      });
    }
    if (filters.endingMinutes != null) {
      list.push({
        key: "ending",
        label: endingLabel(filters.endingMinutes),
        clear: () => applyFilters({ endingMinutes: null }),
      });
    }
    if (filters.freeShipping) {
      list.push({
        key: "shipping",
        label: "Free shipping",
        clear: () => applyFilters({ freeShipping: false }),
      });
    }
    return list;
  }, [filters, applyFilters]);

  // server-side query — free shipping stays client-side by design
  const query = useMemo(() => {
    const base: AuctionQuery = { status: "live", order: sort };
    if (mode === "category" && categorySlug) base.category = categorySlug;
    if (mode === "search" && catParam) base.category = catParam;
    if (mode === "search" && q) base.search = q;
    if (filters.condition) base.condition = filters.condition;
    if (filters.minPrice != null) base.minPrice = filters.minPrice;
    if (filters.maxPrice != null) base.maxPrice = filters.maxPrice;
    if (filters.city) base.city = filters.city;
    if (filters.endingMinutes != null) {
      base.endingWithinMinutes = filters.endingMinutes;
    }
    return base;
  }, [mode, categorySlug, catParam, q, sort, filters]);

  const queryKey = JSON.stringify(query);

  const popularCategories = useMemo(
    () => categories.slice(0, 5).map((c) => ({ slug: c.slug, name: c.name })),
    [categories],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="flex items-center gap-1 text-caption text-muted-foreground">
          <li>
            <a href="#/" className="hover:text-teal transition-colors">
              Home
            </a>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3" />
          </li>
          <li aria-current="page" className="truncate max-w-60">
            {mode === "category" ? "Category" : "Search"}
          </li>
        </ol>
      </nav>

      <header className="mb-4">
        <h1 className="text-headline text-foreground break-words">{heading}</h1>
        {mode === "category" && category?.blurb && (
          <p className="text-body text-muted-foreground mt-1">
            {category.blurb}
          </p>
        )}
        <p className="text-caption text-muted-foreground mt-1">
          Live auctions across Zimbabwe · USD
          {resultCount != null && (
            <>
              {" · "}
              <span className="ts-numeric text-teal font-semibold">
                {resultCount}
              </span>{" "}
              {resultCount === 1 ? "auction" : "auctions"}
            </>
          )}
        </p>

        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <motion.button
                key={chip.key}
                type="button"
                whileTap={reduced ? undefined : { scale: 0.96 }}
                onClick={chip.clear}
                aria-label={`Remove filter: ${chip.label}`}
                className="min-h-11 inline-flex items-center gap-1.5 rounded-full border border-border bg-raised ps-3 pe-2 text-caption font-semibold text-foreground hover:border-teal/40 hover:bg-accent/50 transition-colors"
              >
                {chip.label}
                <X className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </motion.button>
            ))}
            <Button
              variant="ghost"
              className="h-11 px-3 text-caption font-semibold text-teal rounded-control"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          </div>
        )}
      </header>

      <div className="lg:flex lg:items-start lg:gap-6">
        {/* desktop filter sidebar (260px) */}
        <aside className="hidden lg:block w-[260px] shrink-0" aria-label="Filters">
          <div className="lg:sticky lg:top-30 rounded-card border border-border bg-raised p-4 max-h-[calc(100vh-9.5rem)] overflow-y-auto ts-scrollbar">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-label font-bold text-foreground flex items-center gap-1.5">
                <SlidersHorizontal className="size-3.5 text-teal" aria-hidden="true" />
                Filters
              </h2>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="min-h-11 px-2 text-caption font-semibold text-teal hover:text-teal-deep transition-colors rounded-control"
                >
                  Clear all ({activeCount})
                </button>
              )}
            </div>
            <FilterPanel key={panelKey} filters={filters} onApply={applyFilters} />
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {/* sort + view controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button
              variant="outline"
              className="lg:hidden h-11 rounded-control"
              onClick={() => setDrawerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Filters
              {activeCount > 0 && (
                <span className="min-w-5 h-5 px-1 rounded-full bg-teal text-white text-[10px] font-bold grid place-items-center ts-numeric">
                  {activeCount}
                </span>
              )}
            </Button>

            {/* Gap-8 F1: save this search — icon-only under sm (44px target),
                label appears from sm up; stays in this toolbar on mobile */}
            <Button
              variant="outline"
              className="h-11 min-h-11 min-w-11 rounded-control"
              onClick={openSaveDialog}
              aria-label={t("searches.save.button")}
              aria-haspopup="dialog"
            >
              <BellPlus className="size-4 text-teal" aria-hidden="true" />
              <span className="hidden sm:inline">{t("searches.save.button")}</span>
            </Button>

            <div className="flex items-center gap-2 ms-auto">
              <label htmlFor="browse-sort" className="sr-only">
                Sort auctions
              </label>
              <Select
                value={sort}
                onValueChange={(v) => setSort(v as SortOrder)}
              >
                <SelectTrigger
                  id="browse-sort"
                  className="h-11 w-[11rem] sm:w-48 rounded-control"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div
                role="group"
                aria-label="Result view"
                className="flex rounded-control border border-border bg-raised overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setView("grid")}
                  aria-pressed={view === "grid"}
                  aria-label="Grid view"
                  className={cn(
                    "size-11 grid place-items-center transition-colors",
                    view === "grid"
                      ? "bg-secondary text-teal"
                      : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  <LayoutGrid className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-pressed={view === "list"}
                  aria-label="List view"
                  className={cn(
                    "size-11 grid place-items-center transition-colors border-s border-border",
                    view === "list"
                      ? "bg-secondary text-teal"
                      : "text-muted-foreground hover:bg-accent/60",
                  )}
                >
                  <List className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          <ResultsSection
            key={queryKey}
            query={query}
            queryKey={queryKey}
            view={view}
            freeShipping={filters.freeShipping}
            hasActiveFilters={chips.length > 0}
            onClearFilters={clearFilters}
            onCountChange={setResultCount}
            popularCategories={popularCategories}
          />
        </div>
      </div>

      {/* mobile filters — vaul drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader className="pb-0">
            <DrawerTitle className="text-left">Filters</DrawerTitle>
            <DrawerDescription className="text-left">
              {resultCount != null ? `${resultCount} live auctions` : "Live auctions"}{" "}
              · Zimbabwe · USD
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto ts-scrollbar px-4 py-3">
            <FilterPanel key={panelKey} filters={filters} onApply={applyFilters} />
          </div>
          <DrawerFooter className="flex-row gap-2 pt-0">
            <Button
              variant="outline"
              className="flex-1 h-11 rounded-control"
              onClick={clearFilters}
              disabled={activeCount === 0}
            >
              Clear all
            </Button>
            <Button
              className="flex-1 h-11 rounded-control"
              onClick={() => setDrawerOpen(false)}
            >
              Show results
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Gap-8 F1: save this search dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-title text-foreground">
              {t("searches.save.title")}
            </DialogTitle>
            <DialogDescription>{t("searches.save.desc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* read-only criteria summary */}
            <div className="rounded-control border border-border bg-raised p-3">
              <h3 className="text-caption font-bold uppercase tracking-wide text-muted-foreground">
                {t("searches.save.criteria")}
              </h3>
              {criteriaRows.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {criteriaRows.map((row) => (
                    <li key={row.key} className="flex items-baseline gap-2 text-body">
                      <span className="shrink-0 text-caption text-muted-foreground">
                        {row.label}
                      </span>
                      <span className="min-w-0 break-words font-semibold text-foreground">
                        {row.value}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-body text-foreground">
                  {t("searches.save.any")}
                </p>
              )}
            </div>

            {/* name */}
            <div className="space-y-1.5">
              <Label htmlFor="save-search-name" className="text-bodyStrong">
                {t("searches.save.nameLabel")}
              </Label>
              <Input
                id="save-search-name"
                maxLength={80}
                autoComplete="off"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="h-11 min-h-11"
              />
              <p className="text-caption text-muted-foreground">
                {t("searches.save.nameHint")}
              </p>
            </div>

            {/* alerts */}
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label
                htmlFor="save-search-alerts"
                className="cursor-pointer text-body text-foreground"
              >
                {t("searches.save.alerts")}
              </Label>
              <Switch
                id="save-search-alerts"
                checked={saveAlerts}
                onCheckedChange={(v) => setSaveAlerts(v === true)}
              />
            </div>

            {saveError && (
              <p
                role="alert"
                className="flex items-center gap-1.5 text-caption text-danger"
              >
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                {saveError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="h-11 min-h-11"
              onClick={() => setSaveOpen(false)}
              disabled={saving}
            >
              {t("action.cancel")}
            </Button>
            <Button
              className="h-11 min-h-11"
              onClick={() => void confirmSave()}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("searches.save.saving")}
                </>
              ) : (
                t("searches.save.confirm")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
