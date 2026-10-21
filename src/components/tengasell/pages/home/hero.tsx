"use client";

// Home hero — eBay-style banner over the Tengasell brand illustration with
// headline, quick-search chips and CTAs, plus the "How bidding works"
// 3-step education strip (Yahoo Auctions style: bid max → auto-bid → win).

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bot, ChevronRight, Gavel, Tag, Trophy } from "lucide-react";
import { useLinkProps } from "@/lib/tengasell/router";
import { useI18n } from "@/lib/tengasell/i18n";
import { LinkButton } from "./link-button";

const QUICK_SEARCH_CHIPS = ["iPhone", "Solar kit", "Hilux", "Starlink", "Jordan"] as const;

const BIDDING_STEPS = [
  {
    icon: Gavel,
    title: "Bid your max",
    body: "Set your true top price once — no babysitting the clock.",
  },
  {
    icon: Bot,
    title: "Automatic bidding",
    body: "We bid only the minimum needed to keep you in the lead.",
  },
  {
    icon: Trophy,
    title: "Win & pay in 48h",
    body: "Funds are held until delivery is confirmed.",
  },
] as const;

function QuickChip({ term }: { term: string }) {
  const link = useLinkProps(`/search?q=${encodeURIComponent(term)}`);
  const reduced = useReducedMotion();
  return (
    <motion.a
      {...link}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      className="inline-flex items-center min-h-11 px-4 rounded-full border border-white/30 bg-white/10 text-label font-semibold text-white backdrop-blur-sm hover:bg-white/25 hover:border-white/50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
    >
      {term}
    </motion.a>
  );
}

function HowBiddingWorks() {
  return (
    <div className="border-b border-border bg-section">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <h2 className="sr-only">How bidding works</h2>
        <ol
          className="grid gap-3 md:grid-cols-3 md:gap-6"
          aria-label="How bidding works in three steps"
        >
          {BIDDING_STEPS.map((step, i) => (
            <li key={step.title} className="flex items-center gap-3 min-w-0">
              <span className="size-11 shrink-0 grid place-items-center rounded-full bg-teal-tint text-teal">
                <step.icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-label font-bold text-foreground leading-snug">
                  <span className="text-teal ts-numeric">{i + 1} · </span>
                  {step.title}
                </p>
                <p className="text-caption text-muted-foreground leading-snug">
                  {step.body}
                </p>
              </div>
              {i < BIDDING_STEPS.length - 1 && (
                <ChevronRight
                  className="hidden md:block size-4 text-border ms-auto shrink-0"
                  aria-hidden="true"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function Hero() {
  const reduced = useReducedMotion();
  const { t } = useI18n();
  return (
    <section aria-label="Welcome to Tengasell">
      <div className="relative overflow-hidden bg-teal-deep">
        <img
          src="/brand/hero-main.png"
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-teal-deep/95 via-teal-deep/75 to-teal-deep/25"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-teal-deep/70 to-transparent"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:py-20 lg:py-24 min-h-[420px] flex items-center">
          <motion.div
            initial={reduced ? undefined : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
            className="max-w-2xl"
          >
            <p className="inline-flex items-center rounded-full bg-gold/15 border border-gold/40 px-3 py-1 text-caption font-bold uppercase tracking-widest text-gold">
              Zimbabwe&apos;s auction marketplace
            </p>
            <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.1]">
              Win it. <span className="text-gold">Tengasell it.</span>
            </h1>
            <p className="mt-3 text-lg text-white/85 font-medium">
              a snap to your happy deal
            </p>

            <div className="mt-7">
              <p className="text-caption font-bold uppercase tracking-wider text-white/60 mb-2.5">
                {t("home.hero.chipsLabel")}
              </p>
              <ul className="flex flex-wrap gap-2">
                {QUICK_SEARCH_CHIPS.map((term) => (
                  <li key={term}>
                    <QuickChip term={term} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <LinkButton to="/search" variant="gold" className="px-6">
                Start bidding
                <ArrowRight className="size-4" aria-hidden="true" />
              </LinkButton>
              <LinkButton to="/sell" variant="outline">
                <Tag className="size-4" aria-hidden="true" />
                Sell an item
              </LinkButton>
            </div>
          </motion.div>
        </div>
      </div>
      <HowBiddingWorks />
    </section>
  );
}
