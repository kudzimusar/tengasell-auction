"use client";

// Category grid — tiles with the category's lucide icon (by name, Tag as
// fallback), name + blurb and a "Browse →" affordance, linking to #/c/{slug}.
// Responsive columns: 2 / sm:3 / lg:4 / xl:6.

import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Car,
  Dumbbell,
  LayoutGrid,
  Laptop,
  Palette,
  Refrigerator,
  Shirt,
  Smartphone,
  Sprout,
  Sun,
  Tag,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState, SectionHeader } from "@/components/tengasell/ui";
import { useCategories } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import type { Category } from "@/lib/tengasell/types";
import { LinkButton } from "./link-button";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  zap: Zap,
  laptop: Laptop,
  sun: Sun,
  refrigerator: Refrigerator,
  shirt: Shirt,
  car: Car,
  dumbbell: Dumbbell,
  palette: Palette,
  sprout: Sprout,
  "book-open": BookOpen,
};

const GRID =
  "grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";

function CategoryTile({ category, name }: { category: Category; name: string }) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Tag;
  const link = useLinkProps(`/c/${category.slug}`);
  const reduced = useReducedMotion();
  return (
    <motion.a
      {...link}
      whileHover={reduced ? undefined : { y: -3 }}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 26 }}
      aria-label={`Browse ${name}`}
      className="group flex flex-col gap-2.5 rounded-card border border-border bg-raised p-4 min-h-36 hover:border-teal/50 hover:shadow-md transition-colors focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="size-11 grid place-items-center rounded-control bg-teal-tint text-teal transition-colors group-hover:bg-teal group-hover:text-white">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="text-label font-bold text-foreground leading-snug">{name}</span>
      <span className="text-caption text-muted-foreground line-clamp-2 leading-snug">
        {category.blurb}
      </span>
      <span className="mt-auto pt-1 inline-flex items-center gap-1 text-caption font-bold text-teal">
        Browse
        <ArrowRight
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </motion.a>
  );
}

export function CategoryGrid() {
  const { categories, loading } = useCategories();
  const { locale, t } = useI18n();

  return (
    <section className="py-6" aria-label={t("nav.categories")}>
      <div className="mx-auto max-w-7xl px-4">
        <SectionHeader
          icon={<LayoutGrid className="size-5 text-teal" aria-hidden="true" />}
          title={t("nav.categories")}
          subtitle="From solar kits to Shona sculpture — every aisle is a deal aisle"
        />
        {loading ? (
          <div>
            <span role="status" className="sr-only">
              {t("state.loading")}
            </span>
            <div className={GRID} aria-hidden="true">
              {Array.from({ length: 11 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-card border border-border bg-raised p-4 min-h-36 space-y-2.5"
                >
                  <div className="size-11 rounded-control bg-muted animate-pulse" />
                  <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-full rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : categories.length === 0 ? (
          <EmptyState
            icon={<Tag className="size-8" aria-hidden="true" />}
            title="Categories are unavailable"
            body="We could not load the category list right now. You can still browse all live auctions."
            action={
              <LinkButton to="/search" variant="ghost">
                Browse all auctions
                <ArrowRight className="size-4" aria-hidden="true" />
              </LinkButton>
            }
          />
        ) : (
          <div className={GRID}>
            {categories.map((c) => (
              <CategoryTile
                key={c.slug}
                category={c}
                name={locale === "ja" ? c.name_ja : c.name}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
