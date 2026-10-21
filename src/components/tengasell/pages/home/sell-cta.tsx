"use client";

// Sell CTA banner — brand illustration with gradient overlay, "Turn your
// extras into US dollars" copy and a "List in 2 minutes" CTA to #/sell/new.

import { ArrowRight } from "lucide-react";
import { LinkButton } from "./link-button";

export function SellCta() {
  return (
    <section className="py-6" aria-label="Sell on Tengasell">
      <div className="mx-auto max-w-7xl px-4">
        <div className="relative overflow-hidden rounded-card bg-teal-deep min-h-[300px] sm:min-h-[340px] flex items-center">
          <img
            src="/brand/sell-banner.png"
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-teal-deep/95 via-teal-deep/85 to-gold-deep/20"
          />
          <div className="relative w-full p-6 sm:p-10 max-w-xl">
            <p className="text-caption font-bold uppercase tracking-widest text-gold">
              Sell on Tengasell
            </p>
            <h2 className="mt-2 text-2xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Turn your extras into US dollars
            </h2>
            <p className="mt-3 text-body text-white/85 leading-relaxed">
              Snap a photo, set your price, and let the bidding do the rest.
              USD payouts with buyer protection built in.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <LinkButton to="/sell/new" variant="gold" className="px-6">
                List in 2 minutes
                <ArrowRight className="size-4" aria-hidden="true" />
              </LinkButton>
              <LinkButton to="/sell" variant="outline">
                How selling works
              </LinkButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
