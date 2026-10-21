"use client";

// Tengasell — Help & honest rules page (#/help) · Task 5-d.
// Sections: #about #sla #fees #protection #payments #contact + FAQ.
// Yahoo-style plain-English rules vibe. In-page anchors use scroll buttons —
// raw href="#id" would clobber the hash-router route.

import { motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  Banknote,
  CircleHelp,
  Copy,
  CreditCard,
  Facebook,
  Globe,
  Instagram,
  Landmark,
  Mail,
  Percent,
  Scale,
  ShieldCheck,
  Smartphone,
  Store,
  Timer,
  Twitter,
  Wallet,
  Zap,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { SLA } from "@/lib/tengasell/format";
import { SectionHeader } from "@/components/tengasell/ui";
import { toast } from "@/hooks/use-toast";
import { HelpContactCard } from "./help-contact-card";

// ── content ─────────────────────────────────────────────────────────

const TOC = [
  { id: "about", label: "About" },
  { id: "sla", label: "Service levels" },
  { id: "fees", label: "Fees" },
  { id: "protection", label: "Buyer protection" },
  { id: "payments", label: "Payments" },
  { id: "contact", label: "Contact" },
  { id: "faq", label: "FAQ" },
] as const;

const ABOUT_CHIPS = [
  "US-dollar auctions",
  "Nationwide shipping & local pickup",
  "Tenga AI copilot included",
] as const;

const SLA_ROWS = [
  {
    commitment: "Payment (winner)",
    window: `${SLA.payWithinHours} hours after the hammer`,
    ifSlips: "Order cancelled, item relisted, unpaid strike recorded on your account",
  },
  {
    commitment: "Dispatch (seller)",
    window: `${SLA.shipWithinDays} business days after payment`,
    ifSlips: "Buyer can open a dispute; repeated slips hurt your seller rating",
  },
  {
    commitment: "Dispute window",
    window: `${SLA.disputeWindowDays} days after delivery`,
    ifSlips: "Claims can no longer be opened — inspect items on arrival",
  },
  {
    commitment: "Refunds",
    window: `${SLA.refundDays} business days after a decided dispute`,
    ifSlips: "Escalate with support if the deadline passes",
  },
  {
    commitment: "Support response",
    window: "Within 24 hours",
    ifSlips: "Mon–Sat — write again and it jumps the queue",
  },
] as const;

const FEE_ROWS = [
  {
    fee: "Insertion (listing)",
    amount: "Free — first 50 / month",
    tone: "ok" as const,
    detail: "New and relisted items count; the counter resets every month",
  },
  {
    fee: "Featured listing (optional)",
    amount: "US$2",
    tone: "gold" as const,
    detail: "Highlights your listing in search results — entirely optional",
  },
  {
    fee: "Final value fee",
    amount: "8% — capped at US$50",
    tone: "default" as const,
    detail: "Charged only when your item sells — never on unsold listings",
  },
  {
    fee: "Payouts",
    amount: "Free — within 24h",
    tone: "ok" as const,
    detail: "Money lands after the buyer confirms delivery",
  },
] as const;

const PROTECTIONS = [
  {
    icon: ShieldCheck,
    title: "Funds held until delivery",
    body: "Your payment is held — the seller can't touch it — until you confirm the item arrived. Nobody ships on a promise, in either direction.",
  },
  {
    icon: BadgeCheck,
    title: "Verified sellers",
    body: "Sellers earn the verified badge after 10 completed sales. Response-time badges (“Responds in ~5m”) are computed from real behaviour, not promises.",
  },
  {
    icon: Scale,
    title: "Honest listings rule",
    body: "Condition must be described truthfully, from Brand new down to For parts. Public Q&A on every listing — ask before you bid.",
  },
] as const;

const DISPUTE_STEPS = [
  {
    title: "Message the seller first",
    body: "Most issues resolve in a day or two. Keep it inside Tengasell messages so there's a record.",
  },
  {
    title: "Open a dispute from the order page",
    body: `Within ${SLA.disputeWindowDays} days of delivery — attach photos, tracking, anything that shows the problem.`,
  },
  {
    title: "Tengasell reviews the evidence",
    body: "Both sides get to state their case. We look at the thread history, the listing and the proof.",
  },
  {
    title: "Refund lands",
    body: `Within ${SLA.refundDays} business days of the decision — the funds were held the whole time.`,
  },
] as const;

const PAYMENTS = [
  {
    icon: Zap,
    name: "Paynow",
    note: "Zimbabwe's payment gateway — pay by EcoCash, InnBucks, Visa/Mastercard, ZimSwitch, bank or PayPal in one secure checkout. You approve the mobile-money prompt on your phone; funds are still held until delivery.",
  },
  {
    icon: Smartphone,
    name: "EcoCash",
    note: "Zimbabwe's mobile money — confirm the SMS reference before marking paid.",
  },
  {
    icon: Landmark,
    name: "ZIPIT",
    note: "Instant interbank transfer. Keep your reference number for the dispute window.",
  },
  {
    icon: CreditCard,
    name: "Visa",
    note: "Credit or debit card — funds are held until delivery is confirmed.",
  },
  {
    icon: CreditCard,
    name: "Mastercard",
    note: "Credit or debit card — the same buyer protection applies.",
  },
  {
    icon: Globe,
    name: "PayPal",
    note: "For international buyers bidding on Zimbabwe listings.",
  },
  {
    icon: Banknote,
    name: "Cash on delivery",
    note: "Where the seller offers it — inspect the item before you pay.",
  },
] as const;

const SOCIALS = [
  { icon: Twitter, name: "X (Twitter)", handle: "@tengasell", url: "https://x.com/tengasell" },
  { icon: Instagram, name: "Instagram", handle: "@tengasell", url: "https://instagram.com/tengasell" },
  { icon: Facebook, name: "Facebook", handle: "@tengasell", url: "https://facebook.com/tengasell" },
] as const;

const FAQS = [
  {
    q: "How does automatic bidding work?",
    a: "You bid the maximum you're willing to pay — say US$60 — and the system bids only the minimum needed to keep you in front, one increment over the next rival's max. If nobody challenges you, you can win at the opening price. You never pay more than needed to beat the second-highest maximum, and your max is never shown to anyone.",
  },
  {
    q: "What is anti-snipe (soft close)?",
    a: "A bid placed in the final 5 minutes extends the auction by 5 minutes — up to 15 times. Sniping a bid at the last second doesn't lock anyone out; everyone gets a fair window to respond. Listings that have been pushed show an “Extended” badge.",
  },
  {
    q: "What happens if I win but don't pay?",
    a: "You have 48 hours to complete payment. After that the order is cancelled, the item is relisted, and an unpaid strike lands on your account. Two strikes and your bidding privileges are suspended — that's the honest-rules way of keeping the floor trustworthy.",
  },
  {
    q: "Can I cancel a bid?",
    a: "No — bids are binding. That's what keeps prices honest for sellers and bidders alike. If you bid by genuine mistake, message the seller straight away; they may cancel the auction, but they are not obliged to. Think it through before you press the button.",
  },
  {
    q: "How do reserves work?",
    a: "A seller can set a hidden minimum price. Until bidding reaches it, the listing shows “Reserve not met” and the seller is not obliged to sell. Once the reserve is met, everything proceeds as a normal auction — most listings don't use one at all.",
  },
] as const;

const SUPPORT_EMAIL = "support@tengasell.com";

// ── page ────────────────────────────────────────────────────────────

export default function HelpPage() {
  const reduced = useReducedMotion();

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({
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

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      toast({ title: "Email address copied", description: SUPPORT_EMAIL });
    } catch {
      toast({
        title: "Could not copy",
        description: "Your browser blocked clipboard access — the address is shown above.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-6 sm:space-y-12 sm:py-8">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header aria-labelledby="help-title" className="space-y-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gold-soft px-3 py-1 text-label font-bold text-gold-on">
          <CircleHelp className="size-4" aria-hidden="true" />
          a snap to your happy deal
        </span>
        <h1 id="help-title" className="text-display leading-tight text-foreground">
          Help <span className="text-gold-deep">&amp; honest rules</span>
        </h1>
        <p className="max-w-2xl text-body text-muted-foreground">
          How Tengasell works — service levels, fees, buyer protection and the
          plain-English rules of the trading floor. No small print anywhere on this page.
        </p>
      </header>

      {/* ── Section nav (scroll buttons — hash-router safe) ──────── */}
      <nav aria-label="Help sections" className="flex flex-wrap gap-2">
        {TOC.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollTo(s.id)}
            className="min-h-11 rounded-full border border-border bg-raised px-4 text-label text-foreground transition-colors hover:border-teal/50 hover:bg-teal-tint/40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* ── About ────────────────────────────────────────────────── */}
      <motion.section id="about" aria-labelledby="about-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Store className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="about-title">About Tengasell</span>}
          subtitle="Zimbabwe's auction marketplace"
        />
        <Card>
          <CardContent className="space-y-3 p-5 sm:p-6">
            <p className="text-body leading-relaxed text-foreground">
              Tengasell is a Yahoo Auctions-style trading floor for Zimbabwe: buyers bid
              in US dollars on everything from solar kits and Starlink dishes to Hiluxes
              and Shona sculpture, while sellers list in minutes with nothing but a
              phone and a photo. <span className="text-gold-deep font-bold">a snap to your happy deal</span>{" "}
              isn't just the tagline — it's the design brief.
            </p>
            <p className="text-body leading-relaxed text-muted-foreground">
              You'll find us at{" "}
              <span className="font-semibold text-foreground">tengasell.com</span> — we're
              currently re-registering the domain, so until the paperwork completes the
              marketplace lives right here, fully live: bidding, chat, orders and
              payouts all work.
            </p>
            <ul className="flex flex-wrap gap-2 pt-1" aria-label="Quick facts">
              {ABOUT_CHIPS.map((chip) => (
                <li
                  key={chip}
                  className="rounded-full border border-border bg-section px-3 py-1.5 text-caption font-semibold text-foreground"
                >
                  {chip}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </motion.section>

      {/* ── SLA ──────────────────────────────────────────────────── */}
      <motion.section id="sla" aria-labelledby="sla-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Timer className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="sla-title">Service level agreements</span>}
          subtitle="Deadlines we hold ourselves — and you — to"
        />
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 text-label">Commitment</TableHead>
                  <TableHead className="h-11 text-label">Window</TableHead>
                  <TableHead className="h-11 text-label">If it slips</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SLA_ROWS.map((row) => (
                  <TableRow key={row.commitment}>
                    <TableCell className="py-3.5 text-bodyStrong text-foreground">
                      {row.commitment}
                    </TableCell>
                    <TableCell className="py-3.5 text-caption font-semibold text-teal-deep">
                      {row.window}
                    </TableCell>
                    <TableCell className="py-3.5 text-caption text-muted-foreground">
                      {row.ifSlips}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.section>

      {/* ── Fees ─────────────────────────────────────────────────── */}
      <motion.section id="fees" aria-labelledby="fees-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Percent className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="fees-title">Fees</span>}
          subtitle="You always know what it costs before you list"
        />
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 text-label">Fee</TableHead>
                  <TableHead className="h-11 text-label">Amount</TableHead>
                  <TableHead className="h-11 text-label">When it applies</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FEE_ROWS.map((row) => (
                  <TableRow key={row.fee}>
                    <TableCell className="py-3.5 text-bodyStrong text-foreground">
                      {row.fee}
                    </TableCell>
                    <TableCell
                      className={
                        row.tone === "ok"
                          ? "py-3.5 text-bodyStrong text-ok"
                          : row.tone === "gold"
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
          Worked example: sell at US$300 → final value fee US$24 (8%). Sell at US$1 000
          → fee capped at US$50. Unsold listings cost you nothing.
        </p>
      </motion.section>

      {/* ── Buyer protection ─────────────────────────────────────── */}
      <motion.section id="protection" aria-labelledby="protection-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<ShieldCheck className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="protection-title">Buyer protection</span>}
          subtitle="Funds held, sellers verified, disputes decided on evidence"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {PROTECTIONS.map((p) => (
            <div key={p.title} className="rounded-card border border-border bg-raised p-4">
              <span className="grid size-11 place-items-center rounded-control bg-teal-tint text-teal">
                <p.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-title text-foreground">{p.title}</h3>
              <p className="mt-1.5 text-caption leading-relaxed text-muted-foreground">
                {p.body}
              </p>
            </div>
          ))}
        </div>

        <h3 className="mt-6 text-title text-foreground">The dispute process, step by step</h3>
        <ol className="mt-3 grid gap-3 sm:grid-cols-2">
          {DISPUTE_STEPS.map((step, i) => (
            <li key={step.title} className="rounded-card border border-border bg-raised p-4">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-gold text-label font-extrabold text-gold-on"
                >
                  {i + 1}
                </span>
                <h4 className="text-label font-bold leading-snug text-foreground">{step.title}</h4>
              </div>
              <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </motion.section>

      {/* ── Payments ─────────────────────────────────────────────── */}
      <motion.section id="payments" aria-labelledby="payments-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Wallet className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="payments-title">Payment methods</span>}
          subtitle="Pay how Zimbabwe actually pays"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PAYMENTS.map((p) => (
            <div key={p.name} className="rounded-card border border-border bg-raised p-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-control bg-teal-tint text-teal">
                  <p.icon className="size-4.5" aria-hidden="true" />
                </span>
                <h3 className="text-label font-bold text-foreground">{p.name}</h3>
              </div>
              <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
                {p.note}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-caption text-muted-foreground">
          Sellers choose which methods they accept per listing. Whatever you pay with,
          funds are held until you confirm delivery — a seller never sees a promise as
          payment.
        </p>
      </motion.section>

      {/* ── Contact ──────────────────────────────────────────────── */}
      <motion.section id="contact" aria-labelledby="contact-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<Mail className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="contact-title">Contact us</span>}
          subtitle="Real humans, 24-hour response, Mon–Sat"
        />
        <Card>
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-label font-semibold text-muted-foreground">Email</p>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="font-mono text-bodyStrong text-teal underline decoration-teal/40 underline-offset-2 hover:decoration-teal"
                >
                  {SUPPORT_EMAIL}
                </a>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void copyEmail()}
              >
                <Copy className="size-4" aria-hidden="true" />
                Copy address
              </Button>
            </div>

            <HelpContactCard />

            <div className="border-t border-border pt-4">
              <p className="text-label font-semibold text-muted-foreground">Social</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {SOCIALS.map((s) => (
                  <li key={s.name}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-section px-4 text-label text-foreground transition-colors hover:border-teal/50 hover:bg-teal-tint/40 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <s.icon className="size-4 text-teal" aria-hidden="true" />
                      {s.name}
                      <span className="text-muted-foreground">{s.handle}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <p className="border-t border-border pt-4 text-caption leading-relaxed text-muted-foreground">
              We answer within 24 hours, Monday to Saturday. For anything urgent about an
              active order, message the seller first — most fixes happen right in the
              thread, and the record helps if a dispute follows.
            </p>
          </CardContent>
        </Card>
      </motion.section>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <motion.section id="faq" aria-labelledby="faq-title" className="scroll-mt-28" {...fadeUp()}>
        <SectionHeader
          icon={<CircleHelp className="size-5 text-teal" aria-hidden="true" />}
          title={<span id="faq-title">Frequently asked questions</span>}
          subtitle="The five questions every bidder eventually asks"
        />
        <Card>
          <CardContent className="p-5 sm:p-6">
            <Accordion type="single" collapsible className="w-full">
              {FAQS.map((f, i) => (
                <AccordionItem key={f.q} value={`faq-${i}`}>
                  <AccordionTrigger className="text-bodyStrong text-foreground hover:no-underline">
                    {f.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-body leading-relaxed text-muted-foreground">
                    {f.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </motion.section>
    </div>
  );
}
