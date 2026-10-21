"use client";

// Tengasell — New listing wizard (Yahoo Auctions 出品 flow).
// Route: #/sell/new · Task 4-d.
// Step 1 Photos & basics → Step 2 Pricing & shipping → Step 3 Review & list.
// Auth-gated: signed-out users get an EmptyState sign-in CTA.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Camera,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  Gavel,
  Info,
  Loader2,
  Lock,
  MapPin,
  Package,
  Plus,
  Sparkles,
  Tag,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { api } from "@/lib/tengasell/api";
import { useAuth } from "@/lib/tengasell/auth";
import { useI18n } from "@/lib/tengasell/i18n";
import {
  SLA,
  bidIncrement,
  conditionLabel,
  formatDateTime,
  formatUSD,
  round2,
  shippingLabel,
} from "@/lib/tengasell/format";
import { useCategories } from "@/lib/tengasell/hooks";
import { useLinkProps } from "@/lib/tengasell/router";
import type { Auction } from "@/lib/tengasell/types";
import {
  Avatar,
  Countdown,
  EmptyState,
  PriceTag,
} from "@/components/tengasell/ui";
import { ZimbabweMap } from "@/components/tengasell/map/zimbabwe-map";
import { ALL_PLACES, placesByProvince } from "@/components/tengasell/map/cities";
import { IMAGES } from "@/data/images";
import { cn } from "@/lib/utils";

// ── constants ───────────────────────────────────────────────────────

const MAX_IMAGES = 4;
const TITLE_MAX = 80;
const TITLE_MIN = 8;
const DESC_MIN = 30;
const FEE_RATE = 0.08;
const FEE_CAP = 50;

// Full listing-location taxonomy: the 6 marketplace cities PLUS every town
// & growth point from the GIS gazetteer (all 64 districts' centres, per
// Wikipedia “Districts of Zimbabwe”). Grouped by province in the select.
const CITY_GROUPS = placesByProvince();
const KNOWN_CITIES = new Set(ALL_PLACES.map((c) => c.name));
const CONDITIONS = [
  "new",
  "like-new",
  "used",
  "fair",
  "refurbished",
  "for-parts",
] as const;

const DURATIONS = [
  { hours: 24, label: "1 day", hint: "Quick flip" },
  { hours: 72, label: "3 days", hint: "Popular" },
  { hours: 120, label: "5 days", hint: "Balanced" },
  { hours: 168, label: "7 days", hint: "Most bids" },
] as const;

const SHIPPING_OPTIONS = [
  {
    value: "courier",
    label: "Courier",
    hint: "Door-to-door, 1–3 days",
    icon: Truck,
  },
  {
    value: "national",
    label: "Nationwide",
    hint: "Bus freight or ZimPost",
    icon: Package,
  },
  {
    value: "pickup",
    label: "Pickup only",
    hint: "Buyer collects in your city",
    icon: MapPin,
  },
] as const;
type ShippingType = (typeof SHIPPING_OPTIONS)[number]["value"];

const STEP_DEFS = [
  { id: 1, short: "Photos", label: "Photos & basics" },
  { id: 2, short: "Pricing", label: "Pricing & shipping" },
  { id: 3, short: "Review", label: "Review & list" },
] as const;

/** Curated stock pool: all URLs of the first 8 image keys, topped up with
 *  first URLs of further keys → ~16 photos for the "choose stock photo" grid. */
const STOCK_PHOTOS: string[] = (() => {
  const entries = Object.entries(IMAGES);
  const pool: string[] = [];
  for (let k = 0; k < 8 && k < entries.length && pool.length < 16; k++) {
    for (const url of entries[k]![1]) {
      if (pool.length >= 16) break;
      pool.push(url);
    }
  }
  for (let k = 8; k < entries.length && pool.length < 16; k++) {
    const url = entries[k]![1][0];
    if (url) pool.push(url);
  }
  return pool.slice(0, 16);
})();

function parseMoney(s: string): number {
  const n = Number(s.trim().replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// ── field shell (label always visible, helper + error under input) ──

function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  counter,
  tip,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  counter?: ReactNode;
  tip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label
          htmlFor={htmlFor}
          className="flex items-center gap-1.5 text-bodyStrong"
        >
          {label}
          {tip}
        </Label>
        {counter}
      </div>
      {children}
      {hint && (
        <p
          id={htmlFor ? `${htmlFor}-hint` : undefined}
          className={cn(
            "text-caption text-muted-foreground",
            error && "hidden",
          )}
        >
          {hint}
        </p>
      )}
      {error && (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          className="flex items-center gap-1 text-caption text-danger"
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function MoneyInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  invalid,
  describedBy,
  disabled,
  min,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  /** numeric floor — renders a type=number input (min attr + spinners) */
  min?: number;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-body text-muted-foreground"
      >
        US$
      </span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-11 min-h-11 pl-11"
        {...(min != null ? { type: "number", min, step: "any" } : {})}
      />
    </div>
  );
}

// ── main wizard ─────────────────────────────────────────────────────

export default function SellNewPage() {
  const reduced = useReducedMotion();
  const { user, loading: authLoading } = useAuth();
  const { categories, loading: catsLoading } = useCategories();
  const { t } = useI18n();

  const signinLink = useLinkProps("/signin");
  const mySellingLink = useLinkProps("/my/selling");

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [images, setImages] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");

  const [startPrice, setStartPrice] = useState("");
  const [buyNowPrice, setBuyNowPrice] = useState("");
  const [reservePrice, setReservePrice] = useState("");
  const [durationHours, setDurationHours] = useState<number>(72);
  const [shipping, setShipping] = useState<ShippingType>("courier");
  const [shippingFee, setShippingFee] = useState("");

  // Gap-8 F1: optional boosts — Best-Offer + featured listing (US$2 + VAT)
  const [allowOffers, setAllowOffers] = useState(false);
  const [offerMin, setOfferMin] = useState("");
  const [featured, setFeatured] = useState(false);
  const [featureState, setFeatureState] = useState<
    "idle" | "pending" | "done" | "failed"
  >("idle");

  const [acknowledged, setAcknowledged] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [forceAckError, setForceAckError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<Auction | null>(null);

  const topRef = useRef<HTMLDivElement | null>(null);
  const ackRef = useRef<HTMLDivElement | null>(null);
  const firstStepRun = useRef(true);

  const createdViewLink = useLinkProps(
    created ? `/item/${created.id}` : "/sell/new",
  );

  // default city from the seller's profile
  useEffect(() => {
    if (
      city === "" &&
      user?.profile?.city &&
      KNOWN_CITIES.has(user.profile.city)
    ) {
      setCity(user.profile.city);
    }
  }, [user, city]);

  // scroll wizard into view on step change (skip first mount)
  useEffect(() => {
    if (firstStepRun.current) {
      firstStepRun.current = false;
      return;
    }
    topRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, [step, reduced]);

  useEffect(() => {
    if (created) window.scrollTo({ top: 0 });
  }, [created]);

  // ── derived values ─────────────────────────────────────────────
  const mark = (k: string) => setTouched((p) => ({ ...p, [k]: true }));
  const showErr = (k: string) => touched[k] === true;

  const startNum = parseMoney(startPrice);
  const buyNowNum = buyNowPrice.trim() === "" ? null : parseMoney(buyNowPrice);
  const reserveNum =
    reservePrice.trim() === "" ? null : parseMoney(reservePrice);
  const feeNum = parseMoney(shippingFee || "0");
  const offerMinNum = offerMin.trim() === "" ? null : parseMoney(offerMin);
  const buyNowThreshold =
    startNum > 0 ? round2(startNum + 2 * bidIncrement(startNum)) : null;

  const endIso = useMemo(
    () => new Date(Date.now() + durationHours * 3_600_000).toISOString(),
    [durationHours],
  );

  const errors: Record<string, string | null> = {
    title:
      title.trim().length < TITLE_MIN
        ? `Give your item a title of at least ${TITLE_MIN} characters.`
        : null,
    category: category ? null : "Choose a category.",
    condition: condition ? null : "Choose the item's condition.",
    description:
      description.trim().length < DESC_MIN
        ? `Describe your item — at least ${DESC_MIN} characters (${description.trim().length} so far).`
        : null,
    city: city ? null : "Choose where the item is located.",
    startPrice: startNum > 0 ? null : "Enter a start price above US$0.",
    buyNow:
      buyNowNum == null
        ? null
        : !(buyNowNum > 0)
          ? "Enter a valid buy-now price, or leave it empty."
          : buyNowThreshold != null && buyNowNum <= buyNowThreshold
            ? `Buy-now must be more than ${formatUSD(buyNowThreshold)} (start + 2 bid increments).`
            : null,
    reserve:
      reserveNum == null
        ? null
        : !(reserveNum > 0)
          ? "Enter a valid reserve price, or leave it empty."
          : startNum > 0 && reserveNum <= startNum
            ? "Reserve must be higher than the start price."
            : null,
    shippingFee:
      shipping === "pickup" || (feeNum >= 0 && feeNum <= 500)
        ? null
        : "Enter a shipping fee between US$0 and US$500 (0 = free).",
    offerMin:
      !allowOffers || offerMinNum == null
        ? null
        : !(offerMinNum >= 1)
          ? t("sell.offers.minError")
          : buyNowNum != null && buyNowNum > 0 && offerMinNum >= buyNowNum
            ? t("sell.offers.minBelowBuyNow")
            : null,
    acknowledged: acknowledged
      ? null
      : "Please confirm the seller SLA to list your item.",
  };

  const step1Valid =
    images.length > 0 &&
    !errors.title &&
    !errors.category &&
    !errors.condition &&
    !errors.description &&
    !errors.city;
  const step2Valid =
    !errors.startPrice &&
    !errors.buyNow &&
    !errors.reserve &&
    !errors.shippingFee &&
    !errors.offerMin;

  const stepValid = step === 1 ? step1Valid : step === 2 ? step2Valid : true;

  const saleExample =
    buyNowNum != null && buyNowNum > 0
      ? buyNowNum
      : startNum > 0
        ? startNum
        : 0;
  const finalValueFee = round2(Math.min(saleExample * FEE_RATE, FEE_CAP));
  const categoryName =
    categories.find((c) => c.slug === category)?.name ?? category ?? "—";

  // ── image actions ──────────────────────────────────────────────
  const addImageUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      setUrlError("Enter a full image URL starting with http.");
      return;
    }
    if (images.includes(trimmed)) {
      setUrlError("That image is already added.");
      return;
    }
    if (images.length >= MAX_IMAGES) {
      setUrlError(`You can add up to ${MAX_IMAGES} photos.`);
      return;
    }
    setImages((prev) => [...prev, trimmed]);
    setUrlInput("");
    setUrlError(null);
  };

  const removeImage = (url: string) => {
    setImages((prev) => prev.filter((u) => u !== url));
  };

  const toggleStockPhoto = (url: string) => {
    if (images.includes(url)) {
      removeImage(url);
      return;
    }
    if (images.length >= MAX_IMAGES) {
      toast({
        title: "Photo limit reached",
        description: `You can add up to ${MAX_IMAGES} photos — remove one first.`,
      });
      return;
    }
    setImages((prev) => [...prev, url]);
  };

  // ── navigation ─────────────────────────────────────────────────
  const goNext = () => {
    if (!stepValid) return;
    setForceAckError(false);
    setStep((s) => (s === 1 ? 2 : 3));
  };
  const goBack = () => setStep((s) => (s === 2 ? 1 : s === 3 ? 2 : s));

  // ── submit ─────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!user || submitting) return;
    if (!acknowledged) {
      setForceAckError(true);
      ackRef.current?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "center",
      });
      toast({
        title: "Confirm the seller SLA",
        description: "Tick the box to confirm dispatch and response times.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const auction = await api.createAuction({
        title: title.trim(),
        description: description.trim(),
        category,
        condition,
        start_price: round2(startNum),
        buy_now_price:
          buyNowNum != null && buyNowNum > 0 ? round2(buyNowNum) : null,
        reserve_price:
          reserveNum != null && reserveNum > 0 ? round2(reserveNum) : null,
        shipping_fee:
          shipping === "pickup" ? 0 : round2(Math.max(feeNum, 0) || 0),
        shipping,
        city,
        durationHours,
        images,
        // Gap-8 F1: Best-Offer (offerMin only counts when offers are on)
        allowOffers,
        offerMin:
          allowOffers && offerMinNum != null && offerMinNum >= 1
            ? round2(offerMinNum)
            : null,
      });
      // Gap-8 F1: featured fee is charged AFTER the listing exists, so a fee
      // failure never loses the listing — the success screen offers a retry.
      let featureOk = false;
      if (featured) {
        try {
          await api.featureListing(auction.id);
          featureOk = true;
        } catch {
          featureOk = false;
        }
      }
      setFeatureState(featured ? (featureOk ? "done" : "failed") : "idle");
      setCreated(auction);
      toast({
        title: "Your auction is live!",
        description: `${auction.title} — ends ${formatDateTime(auction.ends_at)}`,
      });
      if (featured && !featureOk) {
        toast({
          title: t("sell.featured.failedTitle"),
          description: t("sell.featured.failedBody"),
          variant: "destructive",
        });
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not list your item. Check your connection and try again.";
      setSubmitError(msg);
      toast({
        title: "Listing failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resetWizard = () => {
    setCreated(null);
    setStep(1);
    setImages([]);
    setUrlInput("");
    setUrlError(null);
    setTitle("");
    setCategory("");
    setCondition("");
    setDescription("");
    setStartPrice("");
    setBuyNowPrice("");
    setReservePrice("");
    setDurationHours(72);
    setShipping("courier");
    setShippingFee("");
    setAllowOffers(false);
    setOfferMin("");
    setFeatured(false);
    setFeatureState("idle");
    setAcknowledged(false);
    setTouched({});
    setForceAckError(false);
    setSubmitError(null);
    const profileCity = user?.profile?.city ?? "";
    setCity(KNOWN_CITIES.has(profileCity) ? profileCity : "");
  };

  // Gap-8 F1: retry the US$2 + VAT feature fee from the success screen
  const retryFeature = async () => {
    if (!created || featureState === "pending") return;
    setFeatureState("pending");
    try {
      const updated = await api.featureListing(created.id);
      setCreated(updated);
      setFeatureState("done");
      toast({ title: t("sell.featured.done") });
    } catch (err) {
      setFeatureState("failed");
      toast({
        title: t("sell.featured.retryFailed"),
        description:
          err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  // ── gates ──────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 space-y-4" aria-busy="true">
        <div className="h-9 w-48 animate-pulse rounded-control bg-muted" />
        <div className="h-1.5 w-full animate-pulse rounded-pill bg-muted" />
        <div className="h-96 animate-pulse rounded-card bg-muted" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14">
        <EmptyState
          icon={<Lock className="size-9" />}
          title="Sign in to sell"
          body="Create a free account to list on Tengasell. Your first 50 listings every month are free — it takes two minutes."
          action={
            <Button asChild size="lg" className="min-h-11 h-12 px-6 text-base">
              <a {...signinLink}>Sign in</a>
            </Button>
          }
        />
      </div>
    );
  }

  // ── success screen ─────────────────────────────────────────────
  if (created) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center sm:py-16">
        <div className="relative mx-auto size-24">
          {!reduced && (
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-gold/40"
              initial={{ scale: 0.8, opacity: 0.8 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          )}
          <motion.div
            role="img"
            aria-label="Listing created successfully"
            className="ts-energy relative grid size-24 place-items-center rounded-full bg-gold text-gold-on"
            initial={reduced ? undefined : { scale: 0, rotate: -24 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
          >
            <Check className="size-12" strokeWidth={3} aria-hidden="true" />
          </motion.div>
        </div>

        <h1 className="mt-6 text-display text-foreground">
          Your auction is live!
        </h1>
        <p className="mx-auto mt-2 max-w-md text-body text-muted-foreground">
          <span className="font-semibold text-foreground">{created.title}</span>{" "}
          is open for bids until {formatDateTime(created.ends_at)}.
        </p>

        {/* Gap-8 F1: featured-listing fee outcome */}
        {featured && featureState === "done" && (
          <p className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-pill bg-gold-soft px-3 py-1 text-caption font-bold text-gold-on">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {t("sell.featured.done")}
          </p>
        )}
        {(featured &&
          (featureState === "failed" || featureState === "pending")) && (
          <div
            role="alert"
            className="mx-auto mt-4 max-w-md rounded-card border border-warn/50 bg-warn/5 p-4 text-start"
          >
            <p className="flex items-center gap-1.5 text-label font-bold text-warn">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              {t("sell.featured.failedTitle")}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {t("sell.featured.failedBody")}
            </p>
            <Button
              variant="outline"
              className="mt-3 h-11 min-h-11"
              onClick={() => void retryFeature()}
              disabled={featureState === "pending"}
            >
              {featureState === "pending" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4" aria-hidden="true" />
              )}
              {t("sell.featured.retry")}
            </Button>
          </div>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Button asChild size="lg" className="min-h-11 h-12 text-base">
            <a {...createdViewLink}>
              <Eye className="size-4" aria-hidden="true" />
              View listing
            </a>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="min-h-11 h-12 text-base"
          >
            <a {...mySellingLink}>
              <Tag className="size-4" aria-hidden="true" />
              Go to My selling
            </a>
          </Button>
        </div>

        <button
          type="button"
          onClick={resetWizard}
          className="mt-8 inline-flex min-h-11 items-center gap-1.5 px-2 text-label font-semibold text-teal hover:underline focus-visible:outline-2 focus-visible:outline-ring rounded-control"
        >
          <Plus className="size-4" aria-hidden="true" />
          List another item
        </button>
      </div>
    );
  }

  // ── wizard ─────────────────────────────────────────────────────
  return (
    <div
      ref={topRef}
      className="mx-auto max-w-3xl scroll-mt-24 px-4 py-6 sm:py-8"
    >
      <header className="mb-5">
        <h1 className="text-headline text-foreground">List your item</h1>
        <p className="mt-0.5 text-caption text-muted-foreground">
          Photos first, pricing second, review and go live. Insertion is free.
        </p>
      </header>

      {/* step indicator + progress */}
      <nav aria-label="Listing steps">
        <ol className="flex items-center gap-1.5 sm:gap-3">
          {STEP_DEFS.map((s, i) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-1.5 sm:gap-3",
                  i < STEP_DEFS.length - 1 && "flex-1",
                )}
              >
                <span
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border text-label font-bold transition-colors",
                    done && "border-teal bg-teal text-white",
                    active && "border-teal bg-teal-tint/70 text-teal-deep",
                    !done && !active && "border-border text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    s.id
                  )}
                </span>
                <span
                  className={cn(
                    "text-label hidden sm:inline",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.short}
                </span>
                {i < STEP_DEFS.length - 1 && (
                  <span aria-hidden="true" className="h-px flex-1 bg-border" />
                )}
              </li>
            );
          })}
        </ol>
        <Progress
          className="mt-3 h-1.5"
          value={(step / 3) * 100}
          aria-label={`Listing progress — step ${step} of 3`}
        />
        <p className="sr-only" aria-live="polite">
          Step {step} of 3: {STEP_DEFS[step - 1]!.label}
        </p>
      </nav>

      <motion.div
        key={step}
        initial={reduced ? undefined : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="mt-6"
      >
        {step === 1 && (
          <StepPhotos
            images={images}
            urlInput={urlInput}
            urlError={urlError}
            setUrlInput={setUrlInput}
            clearUrlError={() => setUrlError(null)}
            addImageUrl={addImageUrl}
            removeImage={removeImage}
            toggleStockPhoto={toggleStockPhoto}
            title={title}
            setTitle={(v) => setTitle(v)}
            titleError={showErr("title") ? errors.title : null}
            mark={mark}
            category={category}
            setCategory={setCategory}
            categoryError={showErr("category") ? errors.category : null}
            catsLoading={catsLoading}
            categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
            condition={condition}
            setCondition={setCondition}
            conditionError={showErr("condition") ? errors.condition : null}
            description={description}
            setDescription={setDescription}
            descriptionError={
              showErr("description") ? errors.description : null
            }
            city={city}
            setCity={setCity}
            cityError={showErr("city") ? errors.city : null}
          />
        )}

        {step === 2 && (
          <StepPricing
            startPrice={startPrice}
            setStartPrice={setStartPrice}
            startError={showErr("startPrice") ? errors.startPrice : null}
            buyNowPrice={buyNowPrice}
            setBuyNowPrice={setBuyNowPrice}
            buyNowError={showErr("buyNow") ? errors.buyNow : null}
            buyNowThreshold={buyNowThreshold}
            reservePrice={reservePrice}
            setReservePrice={setReservePrice}
            reserveError={showErr("reserve") ? errors.reserve : null}
            durationHours={durationHours}
            setDurationHours={setDurationHours}
            endIso={endIso}
            shipping={shipping}
            setShipping={setShipping}
            setShippingFee={setShippingFee}
            shippingFee={shippingFee}
            shippingFeeError={
              showErr("shippingFee") ? errors.shippingFee : null
            }
            saleExample={saleExample}
            finalValueFee={finalValueFee}
            mark={mark}
            allowOffers={allowOffers}
            setAllowOffers={setAllowOffers}
            offerMin={offerMin}
            setOfferMin={setOfferMin}
            offerMinError={showErr("offerMin") ? errors.offerMin : null}
            featured={featured}
            setFeatured={setFeatured}
          />
        )}

        {step === 3 && (
          <StepReview
            images={images}
            title={title}
            condition={condition}
            city={city}
            categoryName={categoryName}
            description={description}
            startNum={startNum > 0 ? startNum : 0}
            buyNowNum={buyNowNum != null && buyNowNum > 0 ? buyNowNum : null}
            reserveNum={
              reserveNum != null && reserveNum > 0 ? reserveNum : null
            }
            endIso={endIso}
            durationLabel={
              DURATIONS.find((d) => d.hours === durationHours)?.label ?? ""
            }
            shipping={shipping}
            feeNum={shipping === "pickup" ? 0 : Math.max(feeNum, 0) || 0}
            allowOffers={allowOffers}
            offerMinNum={
              offerMinNum != null && offerMinNum >= 1 ? round2(offerMinNum) : null
            }
            featured={featured}
            user={user}
            acknowledged={acknowledged}
            setAcknowledged={(v) => {
              setAcknowledged(v);
              if (v) setForceAckError(false);
            }}
            ackError={forceAckError ? errors.acknowledged : null}
            ackRef={ackRef}
            submitError={submitError}
          />
        )}
      </motion.div>

      {/* inline submit error */}
      {submitError && step === 3 && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-control border border-danger/40 bg-danger/5 p-3 text-caption text-danger"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>{submitError}</span>
        </div>
      )}

      {/* nav buttons — sticky at the thumb zone on mobile (native wizard
          pattern: Next is always reachable on long forms), static on desktop */}
      <div className="sticky bottom-[calc(57px+env(safe-area-inset-bottom,0px))] z-30 md:static mt-8 flex items-center justify-between gap-3 border-t border-border pt-5 bg-canvas/95 backdrop-blur md:bg-transparent md:backdrop-blur-none">
        {step > 1 ? (
          <Button
            variant="outline"
            onClick={goBack}
            disabled={submitting}
            className="h-11 min-h-11 px-5"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Button>
        ) : (
          <span aria-hidden="true" />
        )}

        {step < 3 ? (
          <Button
            onClick={goNext}
            disabled={!stepValid}
            className="h-11 min-h-11 px-6"
            title={
              stepValid ? undefined : "Complete the required fields to continue"
            }
          >
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="h-11 min-h-11 px-6"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Listing…
              </>
            ) : (
              <>
                <Gavel className="size-4" aria-hidden="true" />
                List your item
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Step 1: photos & basics ─────────────────────────────────────────

function StepPhotos(props: {
  images: string[];
  urlInput: string;
  urlError: string | null;
  setUrlInput: (v: string) => void;
  clearUrlError: () => void;
  addImageUrl: () => void;
  removeImage: (url: string) => void;
  toggleStockPhoto: (url: string) => void;
  title: string;
  setTitle: (v: string) => void;
  titleError: string | null;
  mark: (k: string) => void;
  category: string;
  setCategory: (v: string) => void;
  categoryError: string | null;
  catsLoading: boolean;
  categories: { slug: string; name: string }[];
  condition: string;
  setCondition: (v: string) => void;
  conditionError: string | null;
  description: string;
  setDescription: (v: string) => void;
  descriptionError: string | null;
  city: string;
  setCity: (v: string) => void;
  cityError: string | null;
}) {
  const {
    images,
    urlInput,
    urlError,
    setUrlInput,
    clearUrlError,
    addImageUrl,
    removeImage,
    toggleStockPhoto,
    title,
    setTitle,
    titleError,
    mark,
    category,
    setCategory,
    categoryError,
    catsLoading,
    categories,
    condition,
    setCondition,
    conditionError,
    description,
    setDescription,
    descriptionError,
    city,
    setCity,
    cityError,
  } = props;

  return (
    <section aria-labelledby="step1-heading" className="space-y-6">
      <h2 id="step1-heading" className="text-title text-foreground">
        Photos & basics
      </h2>

      {/* photos — URL manager */}
      <FieldShell
        label={
          <>
            Photos
            <span className="text-caption font-normal text-muted-foreground">
              (first is the cover · up to {MAX_IMAGES})
            </span>
          </>
        }
        htmlFor="photo-url"
        hint={
          images.length === 0
            ? "At least 1 photo is required — paste an image URL or pick a stock photo below."
            : undefined
        }
        error={urlError}
      >
        <div className="flex gap-2">
          <Input
            id="photo-url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://example.com/photo.jpg"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (urlError) clearUrlError();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addImageUrl();
              }
            }}
            aria-invalid={urlError ? true : undefined}
            className="h-11 min-h-11"
          />
          <Button
            type="button"
            onClick={addImageUrl}
            disabled={!urlInput.trim() || images.length >= MAX_IMAGES}
            className="h-11 min-h-11 shrink-0 px-4"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      </FieldShell>

      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((url, i) => (
            <li
              key={url}
              className="group relative overflow-hidden rounded-input border border-border bg-muted"
            >
              <img
                src={url}
                alt={`Listing photo ${i + 1} of ${images.length}`}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
              {i === 0 && (
                <span className="absolute bottom-1.5 start-1.5 rounded-pill bg-teal/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Cover
                </span>
              )}
              <button
                type="button"
                onClick={() => removeImage(url)}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute end-1 top-1 grid size-9 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-danger/80 focus-visible:outline-2 focus-visible:outline-white"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-input border border-dashed border-border bg-section p-6 text-center">
          <Camera
            className="mx-auto size-6 text-teal-soft"
            aria-hidden="true"
          />
          <p className="mt-2 text-label text-foreground">No photos yet</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            Listings with photos sell faster — paste a URL above or choose from
            the stock photos below.
          </p>
        </div>
      )}

      {/* stock photo grid */}
      <div className="space-y-1.5">
        <Label className="text-bodyStrong">Choose a stock photo</Label>
        <p className="text-caption text-muted-foreground">
          Curated pool — tap to add to your listing, tap again to remove.
        </p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {STOCK_PHOTOS.map((url, i) => {
            const added = images.includes(url);
            return (
              <button
                key={url}
                type="button"
                onClick={() => toggleStockPhoto(url)}
                aria-pressed={added}
                aria-label={
                  added
                    ? `Remove stock photo ${i + 1}`
                    : `Add stock photo ${i + 1}`
                }
                className={cn(
                  "relative aspect-square overflow-hidden rounded-input border transition-all focus-visible:outline-2 focus-visible:outline-ring",
                  added
                    ? "border-teal ring-1 ring-teal"
                    : "border-border hover:border-teal/50",
                )}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
                {added && (
                  <span className="absolute inset-0 grid place-items-center bg-teal/55">
                    <Check className="size-5 text-white" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* title */}
      <FieldShell
        label="Title"
        htmlFor="title"
        hint="Be specific: brand, model, condition, capacity."
        error={titleError}
        counter={
          <span
            className="ts-numeric text-caption text-muted-foreground"
            aria-live="polite"
          >
            {title.length}/{TITLE_MAX}
          </span>
        }
      >
        <Input
          id="title"
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => mark("title")}
          placeholder="e.g. Samsung 225L fridge — excellent condition"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? "title-error" : "title-hint"}
          className="h-11 min-h-11"
        />
      </FieldShell>

      {/* category + condition */}
      <div className="grid gap-5 sm:grid-cols-2">
        <FieldShell label="Category" htmlFor="category" error={categoryError}>
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v);
              mark("category");
            }}
          >
            <SelectTrigger
              id="category"
              className="h-11 min-h-11 w-full"
              aria-invalid={categoryError ? true : undefined}
            >
              <SelectValue
                placeholder={
                  catsLoading ? "Loading categories…" : "Choose a category"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>

        <FieldShell
          label="Condition"
          htmlFor="condition"
          error={conditionError}
        >
          <Select
            value={condition}
            onValueChange={(v) => {
              setCondition(v);
              mark("condition");
            }}
          >
            <SelectTrigger
              id="condition"
              className="h-11 min-h-11 w-full"
              aria-invalid={conditionError ? true : undefined}
            >
              <SelectValue placeholder="Choose the condition" />
            </SelectTrigger>
            <SelectContent>
              {CONDITIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  {conditionLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
      </div>

      {/* description */}
      <FieldShell
        label="Description"
        htmlFor="description"
        hint="Buyers bid on details — mention what's included, flaws, age and reason for selling."
        error={descriptionError}
        counter={
          <span
            className={cn(
              "ts-numeric text-caption",
              description.trim().length >= DESC_MIN
                ? "text-ok"
                : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {description.trim().length}/{DESC_MIN} min
          </span>
        }
      >
        <Textarea
          id="description"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => mark("description")}
          placeholder="e.g. Two years old, works perfectly. Includes original box, cables and spare filter. Small scratch on the left side (see photo 2). Selling because I upgraded."
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={
            descriptionError ? "description-error" : "description-hint"
          }
          className="min-h-11"
        />
      </FieldShell>

      {/* city */}
      <FieldShell
        label="City — item location"
        htmlFor="city"
        hint="Shown on your listing; buyers filter and arrange pickup by city."
        error={cityError}
      >
        <Select
          value={city}
          onValueChange={(v) => {
            setCity(v);
            mark("city");
          }}
        >
          <SelectTrigger
            id="city"
            className="h-11 min-h-11 w-full"
            aria-invalid={cityError ? true : undefined}
          >
            <SelectValue placeholder="Choose the item location" />
          </SelectTrigger>
          <SelectContent>
            {CITY_GROUPS.map((group) => (
              <SelectGroup key={group.province}>
                <SelectLabel className="text-caption text-muted-foreground">
                  {group.province}
                </SelectLabel>
                {group.places.map((c) => (
                  <SelectItem key={c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>

      {/* decorative mini map mirroring the selected city (aria-hidden —
          purely visual, the combobox above is the accessible control) */}
      {city && (
        <div
          aria-hidden="true"
          className="flex justify-center rounded-input border border-border bg-section p-3"
        >
          <ZimbabweMap height={140} activeCity={city} />
        </div>
      )}
    </section>
  );
}

// ── Step 2: pricing & shipping ──────────────────────────────────────

function StepPricing(props: {
  startPrice: string;
  setStartPrice: (v: string) => void;
  startError: string | null;
  buyNowPrice: string;
  setBuyNowPrice: (v: string) => void;
  buyNowError: string | null;
  buyNowThreshold: number | null;
  reservePrice: string;
  setReservePrice: (v: string) => void;
  reserveError: string | null;
  durationHours: number;
  setDurationHours: (v: number) => void;
  endIso: string;
  shipping: ShippingType;
  setShipping: (v: ShippingType) => void;
  setShippingFee: (v: string) => void;
  shippingFee: string;
  shippingFeeError: string | null;
  saleExample: number;
  finalValueFee: number;
  mark: (k: string) => void;
  /** Gap-8 F1: Best-Offer toggle + auto-decline floor */
  allowOffers: boolean;
  setAllowOffers: (v: boolean) => void;
  offerMin: string;
  setOfferMin: (v: string) => void;
  offerMinError: string | null;
  /** Gap-8 F1: featured listing (US$2 + VAT) */
  featured: boolean;
  setFeatured: (v: boolean) => void;
}) {
  const {
    startPrice,
    setStartPrice,
    startError,
    buyNowPrice,
    setBuyNowPrice,
    buyNowError,
    buyNowThreshold,
    reservePrice,
    setReservePrice,
    reserveError,
    durationHours,
    setDurationHours,
    endIso,
    shipping,
    setShipping,
    setShippingFee,
    shippingFee,
    shippingFeeError,
    saleExample,
    finalValueFee,
    mark,
    allowOffers,
    setAllowOffers,
    offerMin,
    setOfferMin,
    offerMinError,
    featured,
    setFeatured,
  } = props;
  const { t } = useI18n();

  return (
    <section aria-labelledby="step2-heading" className="space-y-6">
      <h2 id="step2-heading" className="text-title text-foreground">
        Pricing & shipping
      </h2>

      <div className="grid gap-5 sm:grid-cols-2">
        <FieldShell
          label="Start price"
          htmlFor="start-price"
          hint="Low start prices attract bidders."
          error={startError}
        >
          <MoneyInput
            id="start-price"
            value={startPrice}
            onChange={setStartPrice}
            onBlur={() => mark("startPrice")}
            placeholder="10"
            invalid={!!startError}
            describedBy={startError ? "start-price-error" : "start-price-hint"}
          />
        </FieldShell>

        <FieldShell
          label="Buy-now price"
          htmlFor="buy-now-price"
          hint={
            buyNowThreshold != null
              ? `Buyers win instantly — disappears after the first bid. Must be over ${formatUSD(buyNowThreshold)}.`
              : "Buyers win instantly — disappears after the first bid. Enter the start price first."
          }
          error={buyNowError}
        >
          <MoneyInput
            id="buy-now-price"
            value={buyNowPrice}
            onChange={setBuyNowPrice}
            onBlur={() => mark("buyNow")}
            placeholder="Optional"
            invalid={!!buyNowError}
            describedBy={
              buyNowError ? "buy-now-price-error" : "buy-now-price-hint"
            }
          />
        </FieldShell>
      </div>

      <FieldShell
        label="Reserve price"
        htmlFor="reserve-price"
        tip={
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="What is a reserve price?"
                className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:text-teal focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Info className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Your item only sells if the reserve is met. Hidden from buyers.
            </TooltipContent>
          </Tooltip>
        }
        hint="The item only sells if bidding reaches your reserve — buyers never see it."
        error={reserveError}
      >
        <MoneyInput
          id="reserve-price"
          value={reservePrice}
          onChange={setReservePrice}
          onBlur={() => mark("reserve")}
          placeholder="Optional"
          invalid={!!reserveError}
          describedBy={
            reserveError ? "reserve-price-error" : "reserve-price-hint"
          }
        />
      </FieldShell>

      {/* Gap-8 F1: optional boosts — Best-Offer + featured listing */}
      <div className="space-y-3 rounded-card border border-border bg-raised p-4">
        <h3 className="text-label font-bold text-foreground">
          {t("sell.boosts.title")}
        </h3>

        {/* accept offers */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label
              htmlFor="allow-offers"
              className="cursor-pointer text-bodyStrong"
            >
              {t("sell.offers.label")}
            </Label>
            <p
              id="allow-offers-hint"
              className="mt-0.5 text-caption text-muted-foreground"
            >
              {t("sell.offers.hint")}
            </p>
          </div>
          <Switch
            id="allow-offers"
            checked={allowOffers}
            onCheckedChange={(v) => {
              setAllowOffers(v === true);
              if (!v) setOfferMin("");
            }}
            aria-describedby="allow-offers-hint"
            className="mt-1"
          />
        </div>

        {allowOffers && (
          <FieldShell
            label={t("sell.offers.minLabel")}
            htmlFor="offer-min"
            hint={t("sell.offers.minHint")}
            error={offerMinError}
          >
            <MoneyInput
              id="offer-min"
              value={offerMin}
              onChange={setOfferMin}
              onBlur={() => mark("offerMin")}
              placeholder="Optional"
              min={1}
              invalid={!!offerMinError}
              describedBy={
                offerMinError ? "offer-min-error" : "offer-min-hint"
              }
            />
          </FieldShell>
        )}

        {/* featured listing */}
        <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0">
            <Label
              htmlFor="featured-listing"
              className="cursor-pointer text-bodyStrong"
            >
              {t("sell.featured.label")}
            </Label>
            <p
              id="featured-listing-hint"
              className="mt-0.5 text-caption text-muted-foreground"
            >
              {t("sell.featured.hint")}
            </p>
          </div>
          <Switch
            id="featured-listing"
            checked={featured}
            onCheckedChange={(v) => setFeatured(v === true)}
            aria-describedby="featured-listing-hint"
            className="mt-1"
          />
        </div>
      </div>

      {/* duration */}
      <div className="space-y-1.5">
        <Label className="text-bodyStrong">Auction duration</Label>
        <RadioGroup
          value={String(durationHours)}
          onValueChange={(v) => setDurationHours(Number(v))}
          aria-label="Auction duration"
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {DURATIONS.map((d) => (
            <div key={d.hours} className="relative">
              <RadioGroupItem
                id={`dur-${d.hours}`}
                value={String(d.hours)}
                className="peer sr-only"
              />
              <label
                htmlFor={`dur-${d.hours}`}
                className="flex min-h-11 cursor-pointer flex-col rounded-control border border-border bg-raised p-3 transition-colors hover:border-teal/40 peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-data-[state=checked]:border-teal peer-data-[state=checked]:bg-teal-tint/50"
              >
                <span className="text-label font-bold text-foreground">
                  {d.label}
                </span>
                <span className="text-caption text-muted-foreground">
                  {d.hint}
                </span>
              </label>
            </div>
          ))}
        </RadioGroup>
        <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
          Ends {formatDateTime(endIso)}
        </p>
      </div>

      {/* shipping */}
      <div className="space-y-1.5">
        <Label className="text-bodyStrong">Shipping</Label>
        <RadioGroup
          value={shipping}
          onValueChange={(v) => {
            const next = v as ShippingType;
            setShipping(next);
            if (next === "pickup") setShippingFee("0");
            mark("shipping");
          }}
          aria-label="Shipping type"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {SHIPPING_OPTIONS.map((o) => (
            <div key={o.value} className="relative">
              <RadioGroupItem
                id={`ship-${o.value}`}
                value={o.value}
                className="peer sr-only"
              />
              <label
                htmlFor={`ship-${o.value}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-border bg-raised p-3 transition-colors hover:border-teal/40 peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-data-[state=checked]:border-teal peer-data-[state=checked]:bg-teal-tint/50"
              >
                <o.icon
                  className="size-5 shrink-0 text-teal"
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-label font-bold text-foreground">
                    {o.label}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">
                    {o.hint}
                  </span>
                </span>
              </label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <FieldShell
        label="Shipping fee"
        htmlFor="shipping-fee"
        hint={
          shipping === "pickup"
            ? "Pickup only — no shipping fee."
            : "Set 0 for free shipping — free shipping attracts more bids."
        }
        error={shipping === "pickup" ? null : shippingFeeError}
      >
        <MoneyInput
          id="shipping-fee"
          value={shipping === "pickup" ? "0" : shippingFee}
          onChange={setShippingFee}
          onBlur={() => mark("shippingFee")}
          placeholder="0"
          disabled={shipping === "pickup"}
          invalid={shipping !== "pickup" && !!shippingFeeError}
          describedBy={
            shipping === "pickup"
              ? undefined
              : shippingFeeError
                ? "shipping-fee-error"
                : "shipping-fee-hint"
          }
        />
      </FieldShell>

      {/* fee preview */}
      <Card className="border-teal/25 bg-teal-tint/30">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-label">
            <Banknote className="size-4 text-teal" aria-hidden="true" />
            Fee preview
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {saleExample > 0 ? (
            <dl className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-muted-foreground">
                  If it sells at {formatUSD(saleExample)}{" "}
                  {buyNowPrice.trim() !== "" ? "(buy-now)" : "(start price)"}
                </dt>
                <dd className="ts-numeric text-label text-foreground">
                  {formatUSD(saleExample)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-muted-foreground">
                  Final value fee (8%, max US$50)
                </dt>
                <dd className="ts-numeric text-label text-gold-deep">
                  −{formatUSD(finalValueFee)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-muted-foreground">
                  Insertion fee
                </dt>
                <dd className="text-label text-ok">Free</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
                <dt className="text-caption font-semibold text-foreground">
                  You&apos;d receive
                </dt>
                <dd className="ts-numeric text-title font-extrabold text-teal">
                  {formatUSD(round2(saleExample - finalValueFee))}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-caption text-muted-foreground">
              Enter a start price to preview your fees and payout.
            </p>
          )}
          <p className="mt-2 text-caption text-muted-foreground">
            Fees are charged only if your item sells. Payout within 24h of
            confirmed delivery.
          </p>
        </CardContent>
      </Card>

      <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
        <Sparkles
          className="mt-0.5 size-3.5 shrink-0 text-gold"
          aria-hidden="true"
        />
        Bidders bid their maximum — the system bids the minimum needed
        (automatic bidding), and snipers in the last 5 minutes extend the
        auction.
      </p>
    </section>
  );
}

// ── Step 3: review & list ───────────────────────────────────────────

function StepReview(props: {
  images: string[];
  title: string;
  condition: string;
  city: string;
  categoryName: string;
  description: string;
  startNum: number;
  buyNowNum: number | null;
  reserveNum: number | null;
  endIso: string;
  durationLabel: string;
  shipping: ShippingType;
  feeNum: number;
  /** Gap-8 F1: Best-Offer + featured summary rows */
  allowOffers: boolean;
  offerMinNum: number | null;
  featured: boolean;
  user: { username: string; profile: { response_minutes: number } | null };
  acknowledged: boolean;
  setAcknowledged: (v: boolean) => void;
  ackError: string | null;
  ackRef: RefObject<HTMLDivElement | null>;
  submitError: string | null;
}) {
  const {
    images,
    title,
    condition,
    city,
    categoryName,
    description,
    startNum,
    buyNowNum,
    reserveNum,
    endIso,
    durationLabel,
    shipping,
    feeNum,
    allowOffers,
    offerMinNum,
    featured,
    user,
    acknowledged,
    setAcknowledged,
    ackError,
    ackRef,
  } = props;
  const { t } = useI18n();

  const cover = images[0];

  return (
    <section aria-labelledby="step3-heading" className="space-y-6">
      <h2 id="step3-heading" className="text-title text-foreground">
        Review & list
      </h2>
      <p className="-mt-4 text-caption text-muted-foreground">
        This is close to how buyers will see your listing.
      </p>

      {/* listing card mockup */}
      <Card className="overflow-hidden">
        <div className="grid md:grid-cols-2">
          <div className="bg-muted">
            {cover ? (
              <>
                <img
                  src={cover}
                  alt="Listing cover photo preview"
                  className="aspect-[4/3] w-full object-cover"
                />
                {images.length > 1 && (
                  <div className="ts-scrollbar flex gap-2 overflow-x-auto p-2">
                    {images.map((url, i) => (
                      <img
                        key={url}
                        src={url}
                        alt={`Photo ${i + 1} preview`}
                        loading="lazy"
                        className={cn(
                          "size-16 shrink-0 rounded-input border object-cover",
                          i === 0 ? "border-teal" : "border-border",
                        )}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>

          <div className="space-y-3 p-4 sm:p-5">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-pill bg-gold-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-on">
              Live preview
            </span>
            <h3 className="text-title leading-snug text-foreground">
              {title.trim() || "Untitled listing"}
            </h3>
            <p className="text-caption text-muted-foreground">
              {condition ? conditionLabel(condition) : "Condition —"} ·{" "}
              {city || "City —"} · {categoryName}
            </p>

            <dl className="space-y-2 border-t border-border pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-muted-foreground">
                  Start price
                </dt>
                <dd>
                  <PriceTag amount={startNum} size="md" tone="teal" />
                </dd>
              </div>
              {buyNowNum != null && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-caption text-muted-foreground">
                    Buy now
                  </dt>
                  <dd>
                    <PriceTag amount={buyNowNum} size="md" tone="gold" />
                  </dd>
                </div>
              )}
              {reserveNum != null && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-caption text-muted-foreground">
                    Reserve
                  </dt>
                  <dd className="text-caption text-warn">Hidden from buyers</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-muted-foreground">Shipping</dt>
                <dd className="text-caption text-foreground">
                  {shippingLabel(shipping, feeNum)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-muted-foreground">
                  Ends ({durationLabel})
                </dt>
                <dd className="text-caption text-foreground">
                  <Countdown endsAt={endIso} className="text-caption" /> ·{" "}
                  {formatDateTime(endIso)}
                </dd>
              </div>
            </dl>

            <div className="flex items-center gap-2 border-t border-border pt-3">
              <Avatar username={user.username} size={28} />
              <span className="text-caption text-muted-foreground">
                @{user.username}
                {user.profile?.response_minutes
                  ? ` · responds in ~${user.profile.response_minutes}m`
                  : ""}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* summary grid */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { term: "Category", value: categoryName },
          {
            term: "Condition",
            value: condition ? conditionLabel(condition) : "—",
          },
          { term: "Item location", value: city || "—" },
          { term: "Duration", value: durationLabel },
          { term: "Shipping", value: shippingLabel(shipping, feeNum) },
          { term: "Photos", value: `${images.length} of ${MAX_IMAGES}` },
          {
            // Gap-8 F1: Best-Offer summary (+ auto-decline floor when set)
            term: t("sell.review.offers"),
            value: allowOffers
              ? offerMinNum != null
                ? `${t("sell.review.yes")} (${t("sell.review.min")}${formatUSD(offerMinNum)})`
                : t("sell.review.yes")
              : t("sell.review.no"),
          },
          {
            // Gap-8 F1: featured listing fee summary
            term: t("sell.review.featured"),
            value: featured
              ? `${t("sell.review.yes")} (US$2 + ${t("sell.vat")})`
              : t("sell.review.no"),
          },
        ].map((row) => (
          <div
            key={row.term}
            className="rounded-control border border-border bg-section p-3"
          >
            <dt className="text-caption text-muted-foreground">{row.term}</dt>
            <dd className="mt-0.5 truncate text-label text-foreground">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {description.trim() && (
        <div className="rounded-control border border-border bg-section p-4">
          <h4 className="text-caption font-semibold text-muted-foreground">
            Description preview
          </h4>
          <p className="mt-1 line-clamp-3 text-body text-foreground">
            {description.trim()}
          </p>
        </div>
      )}

      {/* SLA acknowledgement */}
      <div
        ref={ackRef}
        className={cn(
          "scroll-mt-32 rounded-control border bg-section p-4 transition-colors",
          ackError ? "border-danger/50 bg-danger/5" : "border-border",
        )}
      >
        <label
          htmlFor="sla-ack"
          className="flex cursor-pointer items-start gap-3"
        >
          <Checkbox
            id="sla-ack"
            checked={acknowledged}
            onCheckedChange={(v) => setAcknowledged(v === true)}
            className="mt-0.5"
            aria-invalid={ackError ? true : undefined}
          />
          <span className="text-body text-foreground">
            I&apos;ll dispatch within{" "}
            <strong>{SLA.shipWithinDays} business days</strong> of payment
            confirmation and answer buyer questions within{" "}
            <strong>24 hours</strong>.
          </span>
        </label>
        {ackError && (
          <p className="mt-2 flex items-center gap-1 pl-8 text-caption text-danger">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            {ackError}
          </p>
        )}
      </div>
    </section>
  );
}
