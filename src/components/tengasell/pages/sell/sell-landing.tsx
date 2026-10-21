"use client";

// Tengasell — Sell landing page (eBay-style "Start selling").
// Route: #/sell · Task 4-d.
// Hero → how it works → seller benefits → fee transparency → live
// "What's hot" strip → sign-in CTA card when signed out.

import { useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Camera,
  ChevronDown,
  Gavel,
  LogIn,
  MessageCircle,
  Percent,
  Radio,
  ShieldCheck,
  Sparkles,
  Tag,
  Timer,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { formatUSD } from "@/lib/tengasell/format";
import { useResource } from "@/lib/tengasell/hooks";
import { useI18n } from "@/lib/tengasell/i18n";
import { useLinkProps } from "@/lib/tengasell/router";
import {
  AuctionCard,
  EmptyState,
  ErrorState,
  LoadingGrid,
  SectionHeader,
} from "@/components/tengasell/ui";

// ── content ─────────────────────────────────────────────────────────

const STEPS = [
  {
    n: 1,
    icon: Camera,
    title: "Snap photos",
    body: "Take a few clear photos and be honest about condition. Listings with real photos sell up to 3× faster.",
  },
  {
    n: 2,
    icon: Gavel,
    title: "Set start price & duration",
    body: "Start low to attract bidders, pick 1–7 days, and optionally add buy-now or a hidden reserve price.",
  },
  {
    n: 3,
    icon: MessageCircle,
    title: "Answer questions & get paid",
    body: "Reply to bidders in minutes — Tenga AI helps — then get paid out within 24h of confirmed delivery.",
  },
] as const;

const BENEFITS = [
  {
    icon: ShieldCheck,
    title: "Seller protection, too",
    body: "Buyer funds are confirmed before you dispatch. You never ship on a promise — payment clears first.",
  },
  {
    icon: BadgeCheck,
    title: "Verified seller badge",
    body: "Complete 10 sales to earn the verified badge Zimbabwe buyers look for before they bid.",
  },
  {
    icon: Timer,
    title: "“Responds in ~5m” badge",
    body: "Your average reply time is shown on your listings. Fast answers build trust and push bids higher.",
  },
  {
    icon: Sparkles,
    title: "Tenga AI answers with you",
    body: "Tenga AI drafts answers to buyer questions from your listing details, so you respond in minutes.",
  },
] as const;

const FEES = [
  {
    fee: "Insertion (listing)",
    amount: "Free",
    amountTone: "ok" as const,
    detail: "First 50 items every month",
  },
  {
    fee: "Featured listing (optional)",
    amount: formatUSD(2),
    amountTone: "gold" as const,
    detail: "Only if you choose to highlight your listing in search",
  },
  {
    fee: "Final value fee",
    amount: "8% — max US$50",
    amountTone: "default" as const,
    detail: "Charged only when your item sells — never on unsold listings",
  },
  {
    fee: "Payouts",
    amount: "Free",
    amountTone: "ok" as const,
    detail: "Money lands within 24h of confirmed delivery",
  },
] as const;

const TRUST_CHIPS = [
  { icon: Tag, label: "50 free listings / month" },
  { icon: Percent, label: "8% final value, capped at US$50" },
  { icon: Banknote, label: "Payouts within 24h of delivery" },
] as const;

// ── component ───────────────────────────────────────────────────────

export default function SellLandingPage() {
  const reduced = useReducedMotion();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const hot = useResource(() => api.auctions({ order: "hot", limit: 6 }), []);

  const newListingLink = useLinkProps("/sell/new");
  const signinLink = useLinkProps("/signin");
  const registerLink = useLinkProps("/register");
  const liveRoomLink = useLinkProps("/live");

  const howRef = useRef<HTMLElement | null>(null);
  const scrollToHow = () =>
    howRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });

  const fadeUp = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-40px" },
          transition: { duration: 0.45, delay, ease: "easeOut" as const },
        };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8 space-y-10 sm:space-y-14">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section
        aria-labelledby="sell-hero-title"
        className="overflow-hidden rounded-card border border-border bg-raised"
      >
        <div className="grid lg:grid-cols-[1.05fr_1fr]">
          <div className="flex flex-col justify-center gap-5 p-6 sm:p-10">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-teal-tint px-3 py-1 text-label text-teal-deep font-bold">
              <Sparkles className="size-4" aria-hidden="true" />
              Start selling
            </span>
            <h1
              id="sell-hero-title"
              className="text-display text-foreground leading-tight"
            >
              Turn your extras into{" "}
              <span className="text-gold-deep">US dollars</span>
            </h1>
            <p className="text-body text-muted-foreground max-w-md">
              Listing is <strong className="text-foreground">free</strong> for
              your first <strong className="text-foreground">50 items</strong>{" "}
              every month. No shop, no rent — just your phone, a photo and a
              starting price.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                asChild
                size="lg"
                className="min-h-11 h-12 px-6 text-base"
              >
                <a {...newListingLink}>
                  List your item
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={scrollToHow}
                className="min-h-11 h-12 px-5"
              >
                See how selling works
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              {TRUST_CHIPS.map((chip) => (
                <li
                  key={chip.label}
                  className="inline-flex items-center gap-1.5 text-caption text-muted-foreground font-medium"
                >
                  <chip.icon
                    className="size-4 text-teal-soft"
                    aria-hidden="true"
                  />
                  {chip.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative min-h-52 aspect-[4/3] lg:aspect-auto lg:min-h-[340px] bg-teal-tint">
            <img
              src="/brand/sell-banner.png"
              alt="Seller packing an item to ship after a successful Tengasell auction"
              loading="lazy"
              className="absolute inset-0 size-full object-cover"
            />
            <span
              aria-hidden="true"
              className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-raised/40 to-transparent lg:hidden"
            />
          </div>
        </div>
      </section>

      {/* ── Sign-in CTA (signed out) ─────────────────────────────── */}
      {!authLoading && !user && (
        <motion.section
          aria-labelledby="signin-cta-title"
          {...fadeUp()}
          className="rounded-card bg-teal p-6 sm:p-8 text-white"
        >
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div className="max-w-xl">
              <h2
                id="signin-cta-title"
                className="text-headline flex items-center gap-2"
              >
                <LogIn className="size-6" aria-hidden="true" />
                Sign in to start selling
              </h2>
              <p className="mt-1.5 text-body text-white/85">
                It takes two minutes. New sellers get 50 free listings every
                month and a verified badge after 10 sales.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                asChild
                size="lg"
                className="min-h-11 h-12 bg-gold text-gold-on hover:bg-gold/90 px-6"
              >
                <a {...signinLink}>Sign in</a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="min-h-11 h-12 border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white px-6"
              >
                <a {...registerLink}>
                  <UserPlus className="size-4" aria-hidden="true" />
                  Create account
                </a>
              </Button>
            </div>
          </div>
        </motion.section>
      )}

      {/* ── How it works ─────────────────────────────────────────── */}
      <section
        ref={howRef}
        aria-labelledby="how-title"
        className="scroll-mt-24"
      >
        <SectionHeader
          title={<span id="how-title">How selling works</span>}
          subtitle="Three steps — most sellers list an item in under 5 minutes"
        />
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.li
              key={step.n}
              {...fadeUp(i * 0.08)}
              className="relative rounded-card border border-border bg-raised p-5 sm:p-6"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-teal text-title font-extrabold text-white"
                >
                  {step.n}
                </span>
                <h3 className="text-title text-foreground flex items-center gap-2">
                  {step.title}
                </h3>
              </div>
              <p className="mt-3 text-body text-muted-foreground">
                {step.body}
              </p>
              <step.icon
                className="absolute end-4 top-4 size-5 text-gold"
                aria-hidden="true"
              />
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute -end-2 top-1/2 hidden size-4 -translate-y-1/2 rotate-45 border-e border-t border-border md:block"
                />
              )}
            </motion.li>
          ))}
        </ol>
      </section>

      {/* ── Gap-8 F3: Host a live room CTA ─────────────────────── */}
      <motion.section
        aria-labelledby="live-room-cta-title"
        {...fadeUp()}
        className="rounded-card border border-gold/40 bg-gold-soft/50 p-5 sm:p-6 dark:bg-gold-soft/25"
      >
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="max-w-2xl">
            <h2
              id="live-room-cta-title"
              className="flex items-center gap-2 text-headline text-foreground"
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-control bg-teal text-white"
              >
                <Radio className="size-4" />
              </span>
              {t("sell.live.title")}
            </h2>
            <p className="mt-1.5 text-body text-muted-foreground">{t("sell.live.body")}</p>
          </div>
          <Button
            asChild
            size="lg"
            className="min-h-11 h-12 shrink-0 bg-teal px-6 text-white hover:bg-teal-deep"
          >
            <a {...liveRoomLink}>
              {t("sell.live.cta")}
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </motion.section>

      {/* ── Seller benefits ──────────────────────────────────────── */}
      <section aria-labelledby="benefits-title">
        <SectionHeader
          title={<span id="benefits-title">Why sell on Tengasell</span>}
          subtitle="Built for Zimbabwean sellers — protected payments, fast payouts, AI backup"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b, i) => (
            <motion.div
              key={b.title}
              {...fadeUp(i * 0.06)}
              className="rounded-card border border-border bg-raised p-5 transition-colors hover:border-teal/40"
            >
              <span className="grid size-11 place-items-center rounded-control bg-teal-tint text-teal">
                <b.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-title text-foreground">{b.title}</h3>
              <p className="mt-1.5 text-caption text-muted-foreground leading-relaxed">
                {b.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Fee transparency ─────────────────────────────────────── */}
      <section aria-labelledby="fees-title">
        <SectionHeader
          title={<span id="fees-title">Fees — no small print</span>}
          subtitle="You always know what selling costs before you list"
        />
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 text-label">Fee</TableHead>
                  <TableHead className="h-11 text-label">Amount</TableHead>
                  <TableHead className="h-11 text-label">
                    When it applies
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FEES.map((row) => (
                  <TableRow key={row.fee}>
                    <TableCell className="py-3.5 text-bodyStrong text-foreground">
                      {row.fee}
                    </TableCell>
                    <TableCell
                      className={
                        row.amountTone === "ok"
                          ? "py-3.5 text-bodyStrong text-ok"
                          : row.amountTone === "gold"
                            ? "py-3.5 text-bodyStrong text-gold-deep"
                            : "py-3.5 text-bodyStrong text-foreground"
                      }
                    >
                      {row.amount}
                    </TableCell>
                    <TableCell className="py-3.5 text-caption text-muted-foreground">
                      {row.detail}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <p className="mt-2 text-caption text-muted-foreground">
          Example: sell at US$300 → final value fee US$24 (8%). Sell at US$1 000
          → fee capped at US$50.
        </p>
      </section>

      {/* ── What's hot ───────────────────────────────────────────── */}
      <section aria-labelledby="hot-title">
        <SectionHeader
          title={
            <span id="hot-title" className="flex items-center gap-2">
              See what sells
            </span>
          }
          subtitle="What's hot on Tengasell right now — most-watched live auctions"
        />
        {hot.loading ? (
          <LoadingGrid count={6} />
        ) : hot.error ? (
          <ErrorState message={hot.error} onRetry={hot.reload} />
        ) : hot.data && hot.data.items.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 sm:gap-4">
            {hot.data.items.slice(0, 6).map((a) => (
              <AuctionCard key={a.id} auction={a} showSeller={false} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Gavel className="size-8" />}
            title="No live auctions yet"
            body="Be the first — list your item and set the pace for everyone else."
            action={
              <Button asChild className="min-h-11">
                <a {...newListingLink}>List your item</a>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
