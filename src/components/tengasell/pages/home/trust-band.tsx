"use client";

// Why Tengasell — calm tonal trust band (bg-teal-tint, no cards): buyer
// protection with held funds, the 48h payment SLA, verified sellers, and
// the Tenga AI trade assistant linking to #/assistant.

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BadgeCheck, ShieldCheck, Sparkles, Timer } from "lucide-react";
import { SectionHeader } from "@/components/tengasell/ui";
import { useLinkProps } from "@/lib/tengasell/router";

const TRUST_ITEMS = [
  {
    icon: ShieldCheck,
    title: "Buyer protection",
    body: "Funds are held until delivery is confirmed.",
  },
  {
    icon: Timer,
    title: "48h payment SLA",
    body: "Win, pay within 48 hours — dispatch in 3 days.",
  },
  {
    icon: BadgeCheck,
    title: "Verified sellers",
    body: "ID-checked sellers with public ratings and history.",
  },
] as const;

function TengaAiLink() {
  const link = useLinkProps("/assistant");
  const reduced = useReducedMotion();
  return (
    <motion.a
      {...link}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      aria-label="Tenga AI trade assistant — ask about prices, deals and listings"
      className="group flex items-start gap-3 rounded-control text-start focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="size-11 shrink-0 grid place-items-center rounded-full bg-gold/15 text-gold-deep transition-colors group-hover:bg-gold group-hover:text-gold-on">
        <Sparkles className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-label font-bold text-foreground">
          Tenga AI trade assistant
        </span>
        <span className="block text-caption text-muted-foreground mt-0.5 leading-relaxed">
          Ask anything — fair prices, deal hunting, listing help.
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-caption font-bold text-teal group-hover:underline">
          Ask Tenga AI
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </span>
    </motion.a>
  );
}

export function TrustBand() {
  return (
    <section aria-label="Why Tengasell" className="bg-teal-tint">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
        <SectionHeader
          title="Why Tengasell"
          subtitle="Trust is the product — every deal is protected end to end"
        />
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
          {TRUST_ITEMS.map((item) => (
            <li key={item.title} className="flex items-start gap-3">
              <span className="size-11 shrink-0 grid place-items-center rounded-full bg-teal/10 text-teal">
                <item.icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-label font-bold text-foreground">
                  {item.title}
                </span>
                <span className="block text-caption text-muted-foreground mt-0.5 leading-relaxed">
                  {item.body}
                </span>
              </span>
            </li>
          ))}
          <li>
            <TengaAiLink />
          </li>
        </ul>
      </div>
    </section>
  );
}
