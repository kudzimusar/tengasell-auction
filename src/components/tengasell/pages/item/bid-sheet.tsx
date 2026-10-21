"use client";

// Tengasell BidSheet — Yahoo Auctions-style proxy bidding entry point.
// Dialog on desktop, bottom Sheet on mobile. Handles: signed-out prompt,
// own-auction note, maximum-bid input with automatic bidding explainer,
// inline errors with a re-rendered minimum, and a subtle success state.

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  LogIn,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import { formatUSD, minNextBid, round2 } from "@/lib/tengasell/format";
import { useLinkProps } from "@/lib/tengasell/router";
import type { Auction } from "@/lib/tengasell/types";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BidRules } from "@/components/tengasell/ui";

interface BidSheetProps {
  auction: Auction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** refresh auction + bid history after a placed bid */
  onRefresh: () => void;
}

export function BidSheet({ auction, open, onOpenChange, onRefresh }: BidSheetProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const own = !!user && user.username === auction.seller_username;
  const signedIn = !!user;

  const heading = "Place your bid";
  const description = auction.title;

  const body = own ? (
    <OwnListingNote username={user!.username} />
  ) : !signedIn ? (
    <SignInPrompt />
  ) : (
    <BidForm auction={auction} onRefresh={onRefresh} onDone={() => onOpenChange(false)} />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-sheet max-h-[92dvh] overflow-y-auto ts-scrollbar px-0 pt-2 pb-6 gap-2"
        >
          {/* native sheet handle — visual swipe-to-dismiss affordance */}
          <span
            aria-hidden="true"
            className="absolute top-1.5 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-border"
          />
          <SheetHeader className="px-4 text-left">
            <SheetTitle className="text-headline">{heading}</SheetTitle>
            <SheetDescription className="line-clamp-1">{description}</SheetDescription>
          </SheetHeader>
          <div className="px-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[88vh] overflow-y-auto ts-scrollbar">
        <DialogHeader>
          <DialogTitle className="text-headline">{heading}</DialogTitle>
          <DialogDescription className="line-clamp-1">{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

// ── the proxy-bid form ────────────────────────────────────────────────

function BidForm({
  auction,
  onRefresh,
  onDone,
}: {
  auction: Auction;
  onRefresh: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ max: number; amount: number } | null>(null);

  const min = minNextBid(auction.current_price, auction.bid_count);

  // Prefill with the minimum next bid; also re-syncs when the auction
  // refreshes (e.g. you were outbid → the new minimum is rendered).
  useEffect(() => {
    setValue(min % 1 === 0 ? String(min) : min.toFixed(2));
    setError(null);
  }, [min]);

  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0;
  const effective = valid ? Math.max(parsed, min) : min;
  const total = round2(effective + (auction.shipping_fee ?? 0));

  const submit = async () => {
    if (submitting || success) return;
    if (!valid) {
      setError("Enter a valid bid amount.");
      return;
    }
    if (parsed < min) {
      setError(`Your maximum bid is below the minimum next bid of ${formatUSD(min)}.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.placeBid(auction.id, round2(parsed));
      if (res.ok) {
        if (res.outbid) {
          // Standing bidder's automatic bidding beat this offer — keep the
          // sheet open and surface the new minimum (auction prop refreshes).
          onRefresh();
          toast({
            title: "You were outbid by automatic bidding",
            description: "The standing bidder's maximum is higher — raise your maximum to stay in.",
            variant: "destructive",
          });
          return;
        }
        setSuccess({ max: round2(parsed), amount: res.auction?.current_price ?? effective });
        toast({
          title: "Bid placed — you're the highest bidder",
          description: `Maximum ${formatUSD(round2(parsed))} · currently winning at ${formatUSD(res.auction?.current_price ?? effective)}.`,
        });
        onRefresh();
        setTimeout(() => onDone(), 1400);
      } else {
        setError(res.error ?? "Your bid could not be placed.");
        onRefresh(); // price may have moved — re-render the new minimum
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your bid could not be placed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="py-6 flex flex-col items-center text-center gap-3" role="status">
        <motion.span
          initial={reduced ? undefined : { scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          className="inline-flex"
        >
          <CheckCircle2 className="size-14 text-ok" aria-hidden="true" />
        </motion.span>
        <p className="text-title text-foreground">You&apos;re the highest bidder</p>
        <p className="text-caption text-muted-foreground">
          Maximum {formatUSD(success.max)} · winning at {formatUSD(success.amount)} · you only pay
          the minimum needed to win
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BidRules auction={auction} />

      <div className="space-y-1.5">
        <label htmlFor="ts-max-bid" className="text-label text-foreground">
          Your maximum bid (automatic)
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 start-3 flex items-center text-bodyStrong font-bold text-muted-foreground pointer-events-none"
          >
            $
          </span>
          <Input
            id="ts-max-bid"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            disabled={submitting}
            aria-invalid={!!error}
            aria-describedby="ts-max-bid-hint"
            placeholder={min % 1 === 0 ? String(min) : min.toFixed(2)}
            className="pl-7 h-12 text-title font-bold ts-numeric rounded-input"
          />
        </div>
        <p id="ts-max-bid-hint" className="text-caption text-muted-foreground">
          Minimum next bid:{" "}
          <span className="font-semibold text-foreground ts-numeric">{formatUSD(min)}</span>
        </p>
      </div>

      {/* Yahoo-style automatic bidding explainer */}
      <div
        role="note"
        className="rounded-control border border-teal/30 bg-teal-tint/70 dark:bg-teal-tint/40 p-3 flex gap-2 items-start"
      >
        <Info className="size-4 text-teal-soft shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-caption text-foreground leading-relaxed">
          <span className="font-bold">{t("bid.auto")}</span>
          <span className="text-muted-foreground">
            {" "}
            — enter the most you&apos;re willing to pay. If someone bids higher, Tengasell raises
            your bid by the smallest increment until your maximum is reached.
          </span>
        </p>
      </div>

      {/* potential total incl. shipping */}
      <div className="rounded-control bg-muted/60 p-3 text-caption space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Potential winning bid</span>
          <span className="font-semibold ts-numeric text-foreground">{formatUSD(effective)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Shipping</span>
          <span className="font-semibold ts-numeric text-foreground">
            {auction.shipping_fee > 0 ? formatUSD(auction.shipping_fee) : "Free"}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1.5">
          <span className="font-semibold text-foreground">Potential total</span>
          <span className="font-bold ts-numeric text-teal">{formatUSD(total)}</span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-control border border-danger/40 bg-danger/10 text-danger text-caption p-3 flex gap-2 items-start"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <motion.div whileTap={reduced ? undefined : { scale: 0.98 }}>
        <Button
          onClick={submit}
          disabled={submitting}
          className="w-full min-h-12 text-bodyStrong rounded-control"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Placing bid…
            </>
          ) : (
            <>
              <Zap className="size-4" aria-hidden="true" /> Place bid
            </>
          )}
        </Button>
      </motion.div>

      <p className="flex gap-2 items-start text-caption text-muted-foreground">
        <ShieldCheck className="size-4 text-teal-soft shrink-0 mt-0.5" aria-hidden="true" />
        By bidding you agree to complete payment within 48h of winning (SLA).
      </p>
    </div>
  );
}

// ── signed-out prompt ─────────────────────────────────────────────────

function SignInPrompt() {
  const link = useLinkProps("/signin");
  return (
    <div className="py-4 flex flex-col items-center text-center gap-3">
      <span className="size-12 grid place-items-center rounded-full bg-teal-tint text-teal-deep dark:text-teal-soft">
        <LogIn className="size-6" aria-hidden="true" />
      </span>
      <p className="text-title text-foreground">Sign in to bid</p>
      <p className="text-caption text-muted-foreground max-w-xs">
        Create a free account or sign in to place bids on Tengasell auctions — it takes a snap.
      </p>
      <Button asChild className="min-h-11 px-6 rounded-control">
        <a {...link}>Sign in</a>
      </Button>
    </div>
  );
}

// ── own listing note ──────────────────────────────────────────────────

function OwnListingNote({ username }: { username: string }) {
  return (
    <div className="py-4 flex flex-col items-center text-center gap-3">
      <span className="size-12 grid place-items-center rounded-full bg-gold-soft text-gold-deep">
        <UserRound className="size-6" aria-hidden="true" />
      </span>
      <p className="text-title text-foreground">This is your auction</p>
      <p className="text-caption text-muted-foreground max-w-xs">
        You can&apos;t bid on your own listing, @{username}. Buyer questions will appear in the
        Q&amp;A tab below.
      </p>
    </div>
  );
}
