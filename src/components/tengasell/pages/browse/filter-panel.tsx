"use client";

// Tengasell browse — shared filter form used by the desktop sidebar (260px
// left column) and the mobile vaul drawer. Scope is locked to LIVE listings
// by design (no status toggle). NXS: fieldset/legend semantics, 44px touch
// targets, calm brand surfaces, toasts for invalid input.

import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/tengasell/i18n";
import { placesByProvince } from "@/components/tengasell/map/cities";
import {
  GeoError,
  geoErrorMessage,
  requestLocation,
  type GeoErrorCode,
} from "@/components/tengasell/map/use-geolocation";
import { cn } from "@/lib/utils";

// ── filter model ───────────────────────────────────────────────────────

export interface BrowseFilters {
  /** api `condition` param: "" = any */
  condition: string;
  minPrice: number | null;
  maxPrice: number | null;
  /** "" = any city */
  city: string;
  /** null = any time; minutes window (url ?ending=60 seeds 60) */
  endingMinutes: number | null;
  /** client-side only: shipping_fee === 0 */
  freeShipping: boolean;
}

export const CONDITION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All conditions" },
  { value: "new", label: "Brand new" },
  { value: "like-new", label: "Like new" },
  { value: "used", label: "Used" },
  { value: "refurbished", label: "Refurbished" },
  { value: "for-parts", label: "For parts" },
];

/** Listing-location taxonomy: every city & town in the gazetteer, grouped by
 *  province (all 64 districts' centres per Wikipedia “Districts of Zimbabwe”). */
export const CITY_GROUPS = placesByProvince();

export const ENDING_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Any time" },
  { value: 60, label: "Within 1 hour" },
  { value: 360, label: "Within 6 hours" },
  { value: 1440, label: "Within 24 hours" },
  { value: 4320, label: "Within 3 days" },
];

export function initialFilters(endingMinutes?: number | null): BrowseFilters {
  return {
    condition: "",
    minPrice: null,
    maxPrice: null,
    city: "",
    endingMinutes: endingMinutes ?? null,
    freeShipping: false,
  };
}

export function countActiveFilters(f: BrowseFilters): number {
  let n = 0;
  if (f.condition) n += 1;
  if (f.minPrice != null || f.maxPrice != null) n += 1;
  if (f.city) n += 1;
  if (f.endingMinutes != null) n += 1;
  if (f.freeShipping) n += 1;
  return n;
}

export function conditionOptionLabel(value: string): string {
  return CONDITION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function endingLabel(minutes: number): string {
  return (
    ENDING_OPTIONS.find((o) => o.value === minutes)?.label ??
    `Within ${minutes} min`
  );
}

// ── panel ──────────────────────────────────────────────────────────────

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-label font-bold text-foreground mb-2">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

const ROW =
  "flex items-center gap-2.5 min-h-11 px-2 -mx-2 rounded-control cursor-pointer hover:bg-accent/50 transition-colors text-body font-normal";

export function FilterPanel({
  filters,
  onApply,
  className,
}: {
  filters: BrowseFilters;
  onApply: (patch: Partial<BrowseFilters>) => void;
  className?: string;
}) {
  const { t } = useI18n();
  // price inputs are drafts — applied via the Apply button (or Enter).
  // The parent remounts this panel (key) whenever the applied price range
  // changes from the outside (route change, chip removal, clear all), so
  // the drafts re-seed from `filters` without any sync effects.
  const [minDraft, setMinDraft] = useState(
    filters.minPrice != null ? String(filters.minPrice) : "",
  );
  const [maxDraft, setMaxDraft] = useState(
    filters.maxPrice != null ? String(filters.maxPrice) : "",
  );

  // "Near me" — explicit geolocation (never auto-requested); resolves the
  // nearest marketplace city and selects it in the city filter above.
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const nearMe = () => {
    setGeoBusy(true);
    setGeoError(null);
    requestLocation()
      .then((near) => {
        setGeoBusy(false);
        onApply({ city: near.name });
      })
      .catch((err: unknown) => {
        const code: GeoErrorCode = err instanceof GeoError ? err.code : "unavailable";
        setGeoBusy(false);
        setGeoError(geoErrorMessage(code, t));
      });
  };

  const applyPrice = (e?: FormEvent) => {
    e?.preventDefault();
    const parse = (raw: string): number | null | "invalid" => {
      const t = raw.trim();
      if (t === "") return null;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) return "invalid";
      return Math.round(n * 100) / 100;
    };
    const min = parse(minDraft);
    const max = parse(maxDraft);
    if (min === "invalid" || max === "invalid") {
      toast({
        title: "Invalid price",
        description: "Enter positive numbers, e.g. 50 or 500.",
        variant: "destructive",
      });
      return;
    }
    if (min != null && max != null && min > max) {
      toast({
        title: "Invalid price range",
        description: "Minimum price can't be higher than the maximum.",
        variant: "destructive",
      });
      return;
    }
    onApply({ minPrice: min, maxPrice: max });
  };

  return (
    <div className={cn("space-y-5", className)}>
      <FilterSection title="Condition">
        <RadioGroup
          value={filters.condition}
          onValueChange={(v) => onApply({ condition: v })}
          className="gap-0"
          aria-label="Condition filter"
        >
          {CONDITION_OPTIONS.map((opt) => {
            const id = `cond-${opt.value || "any"}`;
            return (
              <Label key={id} htmlFor={id} className={ROW}>
                <RadioGroupItem id={id} value={opt.value} />
                {opt.label}
              </Label>
            );
          })}
        </RadioGroup>
      </FilterSection>

      <Separator />

      <FilterSection title="Price range (USD)">
        <form className="flex items-center gap-1.5" onSubmit={applyPrice}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={minDraft}
            onChange={(e) => setMinDraft(e.target.value)}
            placeholder="Min"
            aria-label="Minimum price in USD"
            className="h-11 flex-1 min-w-0 rounded-input"
          />
          <span className="text-muted-foreground shrink-0" aria-hidden="true">
            –
          </span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={maxDraft}
            onChange={(e) => setMaxDraft(e.target.value)}
            placeholder="Max"
            aria-label="Maximum price in USD"
            className="h-11 flex-1 min-w-0 rounded-input"
          />
          <Button
            type="submit"
            variant="secondary"
            className="h-11 px-3 shrink-0 rounded-control text-caption font-bold"
          >
            Apply
          </Button>
        </form>
      </FilterSection>

      <Separator />

      <FilterSection title="City">
        <div className="flex items-stretch gap-2">
          <Select
            value={filters.city || "any"}
            onValueChange={(v) => onApply({ city: v === "any" ? "" : v })}
          >
            <SelectTrigger
              id="city-filter"
              className="h-11 min-h-11 min-w-0 flex-1 rounded-control"
              aria-label="City filter"
            >
              <SelectValue placeholder="Any city" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any city</SelectItem>
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
          <Button
            type="button"
            variant="outline"
            onClick={nearMe}
            disabled={geoBusy}
            className="h-11 min-h-11 shrink-0 rounded-control px-3 gap-1.5 text-caption font-bold"
            aria-label={t("location.nearMe")}
          >
            {geoBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="size-4" aria-hidden="true" />
            )}
            <span className="whitespace-nowrap">
              {geoBusy ? t("location.locating") : t("location.nearMe")}
            </span>
          </Button>
        </div>
        {geoError && (
          <p role="alert" className="mt-1.5 text-caption text-danger">
            {geoError}
          </p>
        )}
      </FilterSection>

      <FilterSection title="Ending within">
        <Select
          value={filters.endingMinutes == null ? "any" : String(filters.endingMinutes)}
          onValueChange={(v) =>
            onApply({ endingMinutes: v === "any" ? null : Number(v) })
          }
        >
          <SelectTrigger
            id="ending-filter"
            className="w-full h-11 rounded-control"
            aria-label="Ending within filter"
          >
            <SelectValue placeholder="Any time" />
          </SelectTrigger>
          <SelectContent>
            {ENDING_OPTIONS.map((o) => (
              <SelectItem key={o.label} value={o.value == null ? "any" : String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterSection>

      <Separator />

      <FilterSection title="Shipping">
        <Label htmlFor="free-shipping" className={ROW}>
          <Checkbox
            id="free-shipping"
            checked={filters.freeShipping}
            onCheckedChange={(c) => onApply({ freeShipping: c === true })}
          />
          Free shipping only
        </Label>
      </FilterSection>

      <p className="text-caption text-muted-foreground">
        Showing live listings only — ended and sold auctions are hidden.
      </p>
    </div>
  );
}
