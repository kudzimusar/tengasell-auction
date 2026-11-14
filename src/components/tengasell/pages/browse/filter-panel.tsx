"use client";

// Tengasell browse — shared filter form used by the desktop sidebar (260px
// left column) and the mobile vaul drawer. Scope is locked to LIVE listings
// by design (no status toggle). NXS: fieldset/legend semantics, 44px touch
// targets, calm brand surfaces, toasts for invalid input.
// DISC-02: Category-aware filters generated from Product Intelligence schemas.

import { useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Loader2, LocateFixed } from "lucide-react";
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
import type { CategoryFilterMetadata } from "@/lib/tengasell/types";
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

  // ── Product Intelligence vehicle/schema facets ────
  vehicleClass?: string;
  make?: string;
  model?: string;
  minYear?: number | null;
  maxYear?: number | null;
  minKm?: number | null;
  maxKm?: number | null;
  bodyType?: string;
  fuel?: string;
  transmission?: string;
  drivetrain?: string;
  exteriorColour?: string;
  inspectionGrade?: string;
  variant?: string;
  minCc?: number | null;
  maxCc?: number | null;
  steeringSide?: string;
  importState?: string;
  accidentHistory?: string;
  facets?: Record<string, string>;
}

export const CONDITION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All conditions" },
  { value: "new", label: "Brand new" },
  { value: "like-new", label: "Like new" },
  { value: "used", label: "Used" },
  { value: "fair", label: "Fair" },
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

export const VEHICLE_MAKES = [
  "Toyota",
  "Nissan",
  "Honda",
  "Mercedes-Benz",
  "BMW",
  "Ford",
  "Isuzu",
  "Mazda",
  "Mitsubishi",
  "Volkswagen",
  "Hyundai",
  "Kia",
  "Subaru",
  "Land Rover",
];

export const BODY_TYPES = [
  { value: "SEDAN", label: "Sedan" },
  { value: "SUV", label: "SUV" },
  { value: "HATCHBACK", label: "Hatchback" },
  { value: "PICKUP", label: "Pickup / Bakkie" },
  { value: "COUPE", label: "Coupe" },
  { value: "WAGON", label: "Station Wagon" },
  { value: "VAN", label: "Van" },
  { value: "MINIVAN", label: "Minivan" },
];

export const FUEL_TYPES = [
  { value: "PETROL", label: "Petrol" },
  { value: "DIESEL", label: "Diesel" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "ELECTRIC", label: "Electric" },
];

export const TRANSMISSIONS = [
  { value: "AUTOMATIC", label: "Automatic" },
  { value: "MANUAL", label: "Manual" },
  { value: "CVT", label: "CVT" },
];

export const DRIVETRAINS = [
  { value: "AWD_4WD", label: "4WD / AWD" },
  { value: "FWD", label: "Front-Wheel Drive" },
  { value: "RWD", label: "Rear-Wheel Drive" },
];

export const INSPECTION_GRADES = [
  { value: "GRADE_A", label: "Grade A (Excellent)" },
  { value: "GRADE_B", label: "Grade B (Good)" },
  { value: "GRADE_C", label: "Grade C (Fair)" },
  { value: "GRADE_D", label: "Grade D (Poor)" },
  { value: "UNGRADED", label: "Ungraded" },
];

export const IMPORT_STATES = [
  { value: "DOMESTIC_REGISTERED", label: "Domestic (Registered)" },
  { value: "BONDED_WAREHOUSE", label: "Bonded Warehouse" },
  { value: "IN_TRANSIT", label: "In Transit" },
  { value: "DIRECT_IMPORT", label: "Direct Import" },
];

export function initialFilters(endingMinutes?: number | null): BrowseFilters {
  return {
    condition: "",
    minPrice: null,
    maxPrice: null,
    city: "",
    endingMinutes: endingMinutes ?? null,
    freeShipping: false,
    vehicleClass: "",
    make: "",
    model: "",
    minYear: null,
    maxYear: null,
    minKm: null,
    maxKm: null,
    bodyType: "",
    fuel: "",
    transmission: "",
    drivetrain: "",
    exteriorColour: "",
    inspectionGrade: "",
    variant: "",
    minCc: null,
    maxCc: null,
    steeringSide: "",
    importState: "",
    accidentHistory: "",
    facets: {},
  };
}

export function countActiveFilters(f: BrowseFilters): number {
  let n = 0;
  if (f.condition) n += 1;
  if (f.minPrice != null || f.maxPrice != null) n += 1;
  if (f.city) n += 1;
  if (f.endingMinutes != null) n += 1;
  if (f.freeShipping) n += 1;
  if (f.vehicleClass) n += 1;
  if (f.make) n += 1;
  if (f.model) n += 1;
  if (f.minYear != null || f.maxYear != null) n += 1;
  if (f.minKm != null || f.maxKm != null) n += 1;
  if (f.bodyType) n += 1;
  if (f.fuel) n += 1;
  if (f.transmission) n += 1;
  if (f.drivetrain) n += 1;
  if (f.exteriorColour) n += 1;
  if (f.inspectionGrade) n += 1;
  if (f.variant) n += 1;
  if (f.minCc != null || f.maxCc != null) n += 1;
  if (f.steeringSide) n += 1;
  if (f.importState) n += 1;
  if (f.accidentHistory) n += 1;
  if (f.facets) n += Object.keys(f.facets).length;
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
  categoryFilterMeta,
  className,
}: {
  filters: BrowseFilters;
  onApply: (patch: Partial<BrowseFilters>) => void;
  categoryFilterMeta?: CategoryFilterMetadata | null;
  className?: string;
}) {
  const { t } = useI18n();
  const [minDraft, setMinDraft] = useState(
    filters.minPrice != null ? String(filters.minPrice) : "",
  );
  const [maxDraft, setMaxDraft] = useState(
    filters.maxPrice != null ? String(filters.maxPrice) : "",
  );

  const [minYearDraft, setMinYearDraft] = useState(
    filters.minYear != null ? String(filters.minYear) : "",
  );
  const [maxYearDraft, setMaxYearDraft] = useState(
    filters.maxYear != null ? String(filters.maxYear) : "",
  );

  const [minKmDraft, setMinKmDraft] = useState(
    filters.minKm != null ? String(filters.minKm) : "",
  );
  const [maxKmDraft, setMaxKmDraft] = useState(
    filters.maxKm != null ? String(filters.maxKm) : "",
  );

  const [showAdvanced, setShowAdvanced] = useState(false);

  // "Near me" — explicit geolocation
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

  const applyYear = (e?: FormEvent) => {
    e?.preventDefault();
    const ymin = minYearDraft.trim() ? parseInt(minYearDraft.trim(), 10) : null;
    const ymax = maxYearDraft.trim() ? parseInt(maxYearDraft.trim(), 10) : null;
    if (ymin != null && ymax != null && ymin > ymax) {
      toast({
        title: "Invalid year range",
        description: "Minimum year cannot exceed maximum year.",
        variant: "destructive",
      });
      return;
    }
    onApply({ minYear: ymin, maxYear: ymax });
  };

  const applyKm = (e?: FormEvent) => {
    e?.preventDefault();
    const kmin = minKmDraft.trim() ? parseInt(minKmDraft.trim(), 10) : null;
    const kmax = maxKmDraft.trim() ? parseInt(maxKmDraft.trim(), 10) : null;
    if (kmin != null && kmax != null && kmin > kmax) {
      toast({
        title: "Invalid mileage range",
        description: "Minimum mileage cannot exceed maximum mileage.",
        variant: "destructive",
      });
      return;
    }
    onApply({ minKm: kmin, maxKm: kmax });
  };

  const activeMetaKey = categoryFilterMeta?.categoryKey ?? categoryFilterMeta?.category?.key ?? "";
  const activeMetaLower = activeMetaKey.toLowerCase();
  const isPhoneCategory =
    activeMetaKey.startsWith("PHONE") ||
    activeMetaLower === "phones" ||
    activeMetaLower === "phone-smartphone" ||
    activeMetaLower === "electronics";
  const isVehicleCategory =
    !isPhoneCategory &&
    (!categoryFilterMeta ||
      activeMetaKey.startsWith("VEHICLE") ||
      activeMetaLower === "cars" ||
      activeMetaLower === "vehicles");

  return (
    <div className={cn("space-y-5", className)}>
      {/* ── Vehicle Primary Filters ──── */}
      {isVehicleCategory && (
        <>
          <FilterSection title="Make">
            <Select
              value={filters.make || "any"}
              onValueChange={(v) => onApply({ make: v === "any" ? "" : v })}
            >
              <SelectTrigger className="h-11 rounded-control" aria-label="Make filter">
                <SelectValue placeholder="All makes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All makes</SelectItem>
                {VEHICLE_MAKES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>

          <FilterSection title="Model">
            <Input
              type="text"
              value={filters.model || ""}
              onChange={(e) => onApply({ model: e.target.value.trim() || undefined })}
              placeholder="e.g. Hilux, Land Cruiser"
              className="h-11 rounded-input"
              aria-label="Model filter"
            />
          </FilterSection>

          <FilterSection title="Year Range">
            <form className="flex items-center gap-1.5" onSubmit={applyYear}>
              <Input
                type="number"
                min={1970}
                max={2030}
                value={minYearDraft}
                onChange={(e) => setMinYearDraft(e.target.value)}
                placeholder="From"
                className="h-11 flex-1 min-w-0 rounded-input"
                aria-label="Minimum year"
              />
              <span className="text-muted-foreground shrink-0">–</span>
              <Input
                type="number"
                min={1970}
                max={2030}
                value={maxYearDraft}
                onChange={(e) => setMaxYearDraft(e.target.value)}
                placeholder="To"
                className="h-11 flex-1 min-w-0 rounded-input"
                aria-label="Maximum year"
              />
              <Button type="submit" variant="secondary" className="h-11 px-3 text-caption font-bold">
                Apply
              </Button>
            </form>
          </FilterSection>

          <FilterSection title="Mileage (km)">
            <form className="flex items-center gap-1.5" onSubmit={applyKm}>
              <Input
                type="number"
                min={0}
                step={5000}
                value={minKmDraft}
                onChange={(e) => setMinKmDraft(e.target.value)}
                placeholder="Min km"
                className="h-11 flex-1 min-w-0 rounded-input"
                aria-label="Minimum mileage"
              />
              <span className="text-muted-foreground shrink-0">–</span>
              <Input
                type="number"
                min={0}
                step={5000}
                value={maxKmDraft}
                onChange={(e) => setMaxKmDraft(e.target.value)}
                placeholder="Max km"
                className="h-11 flex-1 min-w-0 rounded-input"
                aria-label="Maximum mileage"
              />
              <Button type="submit" variant="secondary" className="h-11 px-3 text-caption font-bold">
                Apply
              </Button>
            </form>
          </FilterSection>

          <FilterSection title="Body Type">
            <Select
              value={filters.bodyType || "any"}
              onValueChange={(v) => onApply({ bodyType: v === "any" ? "" : v })}
            >
              <SelectTrigger className="h-11 rounded-control" aria-label="Body type filter">
                <SelectValue placeholder="All body types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All body types</SelectItem>
                {BODY_TYPES.map((b) => (
                  <SelectItem key={b.value} value={b.value}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>

          <Separator />
        </>
      )}

      {/* ── Dynamic Category Filters (e.g. Phone/Electronics) ──── */}
      {isPhoneCategory && categoryFilterMeta && (
        <>
          {categoryFilterMeta.filters
            .filter((f) => f.filterClass === "PRIMARY" || f.filterClass === "SECONDARY")
            .map((cf) => (
              <FilterSection key={cf.attributeKey} title={cf.label}>
                {Array.isArray(cf.options) && cf.options.length > 0 ? (
                  <Select
                    value={filters.facets?.[cf.attributeKey] || "any"}
                    onValueChange={(v) =>
                      onApply({
                        facets: {
                          ...(filters.facets || {}),
                          [cf.attributeKey]: v === "any" ? "" : v,
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-11 rounded-control">
                      <SelectValue placeholder={`All ${cf.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">All {cf.label.toLowerCase()}</SelectItem>
                      {cf.options.map((opt) => {
                        const optKey = typeof opt === "string" ? opt : opt.key;
                        const optLabel = typeof opt === "string" ? opt : opt.label;
                        return (
                          <SelectItem key={optKey} value={optKey}>
                            {optLabel}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={cf.dataType === "INTEGER" ? "number" : "text"}
                    value={filters.facets?.[cf.attributeKey] || ""}
                    onChange={(e) =>
                      onApply({
                        facets: {
                          ...(filters.facets || {}),
                          [cf.attributeKey]: e.target.value.trim() || "",
                        },
                      })
                    }
                    placeholder={cf.unit ? `e.g. 128 (${cf.unit})` : `Filter by ${cf.label}`}
                    className="h-11 rounded-input"
                  />
                )}
              </FilterSection>
            ))}
          <Separator />
        </>
      )}

      {/* ── Generic Commercial Filters ──── */}
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

      {/* ── Vehicle Secondary Filters ──── */}
      {isVehicleCategory && (
        <>
          <Separator />
          <FilterSection title="Fuel Type">
            <Select
              value={filters.fuel || "any"}
              onValueChange={(v) => onApply({ fuel: v === "any" ? "" : v })}
            >
              <SelectTrigger className="h-11 rounded-control" aria-label="Fuel filter">
                <SelectValue placeholder="All fuel types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All fuel types</SelectItem>
                {FUEL_TYPES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>

          <FilterSection title="Transmission">
            <Select
              value={filters.transmission || "any"}
              onValueChange={(v) => onApply({ transmission: v === "any" ? "" : v })}
            >
              <SelectTrigger className="h-11 rounded-control" aria-label="Transmission filter">
                <SelectValue placeholder="All transmissions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All transmissions</SelectItem>
                {TRANSMISSIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>

          <FilterSection title="Drivetrain">
            <Select
              value={filters.drivetrain || "any"}
              onValueChange={(v) => onApply({ drivetrain: v === "any" ? "" : v })}
            >
              <SelectTrigger className="h-11 rounded-control" aria-label="Drivetrain filter">
                <SelectValue placeholder="All drivetrains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All drivetrains</SelectItem>
                {DRIVETRAINS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>

          <FilterSection title="Inspection Grade">
            <Select
              value={filters.inspectionGrade || "any"}
              onValueChange={(v) => onApply({ inspectionGrade: v === "any" ? "" : v })}
            >
              <SelectTrigger className="h-11 rounded-control" aria-label="Inspection grade filter">
                <SelectValue placeholder="All inspection grades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All inspection grades</SelectItem>
                {INSPECTION_GRADES.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>

          {/* ── Vehicle Advanced Filters (Collapsible) ──── */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="flex items-center justify-between w-full text-caption font-bold text-teal hover:underline py-1"
            >
              <span>Advanced vehicle filters</span>
              {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>

            {showAdvanced && (
              <div className="space-y-4 pt-3 border-t border-border mt-2">
                <FilterSection title="Steering Side">
                  <Select
                    value={filters.steeringSide || "any"}
                    onValueChange={(v) => onApply({ steeringSide: v === "any" ? "" : v })}
                  >
                    <SelectTrigger className="h-11 rounded-control">
                      <SelectValue placeholder="Any steering" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any steering</SelectItem>
                      <SelectItem value="RHD">Right-Hand Drive (RHD)</SelectItem>
                      <SelectItem value="LHD">Left-Hand Drive (LHD)</SelectItem>
                    </SelectContent>
                  </Select>
                </FilterSection>

                <FilterSection title="Import State">
                  <Select
                    value={filters.importState || "any"}
                    onValueChange={(v) => onApply({ importState: v === "any" ? "" : v })}
                  >
                    <SelectTrigger className="h-11 rounded-control">
                      <SelectValue placeholder="Any import status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any import status</SelectItem>
                      {IMPORT_STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterSection>

                <FilterSection title="Variant / Trim">
                  <Input
                    type="text"
                    value={filters.variant || ""}
                    onChange={(e) => onApply({ variant: e.target.value.trim() || undefined })}
                    placeholder="e.g. Raider, TX, GR-Sport"
                    className="h-11 rounded-input"
                  />
                </FilterSection>
              </div>
            )}
          </div>
        </>
      )}

      <Separator />

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
