"use client";

// Tengasell — friendly 404 · Task 5-d.
// Shown by the hash router for unknown slugs (#/whatever).

import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Home, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TengaLogo } from "@/components/tengasell/ui";
import { useLinkProps, useRouter } from "@/lib/tengasell/router";

export default function NotFoundPage() {
  const reduced = useReducedMotion();
  const home = useLinkProps("/");
  const browse = useLinkProps("/search");
  const { navigate } = useRouter();
  const [term, setTerm] = useState("");

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = term.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <div className="relative mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 py-12 text-center">
      {/* decorative giant 404 behind the content */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-8 select-none text-[7rem] font-extrabold leading-none text-teal/5 sm:text-[9rem]"
      >
        404
      </span>

      <motion.div
        initial={reduced ? undefined : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative flex flex-col items-center"
      >
        <TengaLogo size={64} tagline />

        <h1 className="mt-6 text-display text-foreground">
          This page took a gap year{" "}
          <span role="img" aria-label="globe">
            🌍
          </span>
        </h1>
        <p className="mt-2 max-w-md text-body text-muted-foreground">
          The page you&apos;re after isn&apos;t here — it may have ended, sold, or never
          existed. The deals, thankfully, are all still where you left them.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 min-h-11 px-6">
            <a {...home}>
              <Home className="size-4" aria-hidden="true" />
              Back home
            </a>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 min-h-11 px-6"
          >
            <a {...browse}>
              <Store className="size-4" aria-hidden="true" />
              Browse auctions
            </a>
          </Button>
        </div>

        <form
          onSubmit={submitSearch}
          className="mt-8 flex w-full max-w-sm items-end gap-2"
          aria-label="Search auctions"
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="nf-search" className="sr-only">
              Search auctions
            </label>
            <input
              id="nf-search"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Or search for something specific…"
              className="min-h-11 w-full rounded-input border border-input bg-section px-3.5 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <Button type="submit" aria-label="Search" className="size-11 shrink-0">
            <Search className="size-4" aria-hidden="true" />
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
