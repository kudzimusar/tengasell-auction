// TENGASELL-PI-01E / DISC-01 — Structured search indexing, projection refresh,
// outbox consumer, input validation, and rebuild harness.
//
// Search is DERIVED, REBUILDABLE, and NON-AUTHORITATIVE. Canonical truth remains
// in auctions, vehicles, pi_effective_facts and inspection records. Sensitive
// identifiers (VIN, chassis, reg, engine serial, document numbers) are NEVER indexed.

import type { VehicleStore } from "./vehicle-authority";
import {
  isPubliclyVisibleAuction,
  resolveVehicleInspectionProjection,
} from "./product-intelligence";

const clean = (val: unknown, max = 500) => String(val ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function params(fields: Record<string, string | number>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) q.set(key, String(value));
  return q.toString();
}

export const PUBLIC_SEARCH_STATUSES = new Set([
  "live",
  "scheduled",
  "active",
  "closing",
  "settled",
  "ended",
  "sold",
  "unsold",
]);

export const ALLOWED_SEARCH_ORDERS = new Set([
  "ending",
  "newest",
  "price_asc",
  "price_desc",
  "bids",
  "hot",
  "mileage",
  "year",
]);

export class SearchValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "SearchValidationError";
  }
}

export interface SearchQueryInput {
  search?: string;
  categoryKey?: string;
  status?: string;
  city?: string;
  condition?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  minYear?: number | null;
  maxYear?: number | null;
  minMileage?: number | null;
  maxMileage?: number | null;
  make?: string;
  model?: string;
  vehicleClass?: string;
  bodyType?: string;
  fuel?: string;
  transmission?: string;
  drivetrain?: string;
  colour?: string;
  inspectionGrade?: string;
  roadworthy?: boolean | null;
  facets?: Record<string, unknown>;
  endingWithinMinutes?: number | null;
  order?: "ending" | "newest" | "price_asc" | "price_desc" | "bids" | "hot" | "mileage" | "year";
  limit?: number;
  offset?: number;
}

export interface ValidatedSearchQuery {
  search: string;
  categoryKey?: string;
  status: string;
  city?: string;
  condition?: string;
  minPrice: number | null;
  maxPrice: number | null;
  minYear: number | null;
  maxYear: number | null;
  minMileage: number | null;
  maxMileage: number | null;
  make?: string;
  model?: string;
  vehicleClass?: string;
  bodyType?: string;
  fuel?: string;
  transmission?: string;
  drivetrain?: string;
  colour?: string;
  inspectionGrade?: string;
  roadworthy: boolean | null;
  facets?: Record<string, unknown>;
  endingWithinMinutes: number | null;
  order: "ending" | "newest" | "price_asc" | "price_desc" | "bids" | "hot" | "mileage" | "year";
  limit: number;
  offset: number;
}

function parseFiniteOpt(
  value: unknown,
  field: string,
  opts: { integer?: boolean; min?: number; max?: number; positive?: boolean } = {},
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new SearchValidationError("INVALID_NUMBER", `${field} must be a finite number`);
  }
  if (opts.integer && !Number.isInteger(num)) {
    throw new SearchValidationError("INVALID_INTEGER", `${field} must be an integer`);
  }
  if (opts.positive && num <= 0) {
    throw new SearchValidationError("INVALID_BOUND", `${field} must be greater than 0`);
  }
  if (opts.min != null && num < opts.min) {
    throw new SearchValidationError("INVALID_BOUND", `${field} must be >= ${opts.min}`);
  }
  if (opts.max != null && num > opts.max) {
    throw new SearchValidationError("INVALID_BOUND", `${field} must be <= ${opts.max}`);
  }
  return num;
}

export function validateSearchQuery(q: SearchQueryInput = {}): ValidatedSearchQuery {
  if (q == null || typeof q !== "object" || Array.isArray(q)) {
    throw new SearchValidationError("INVALID_QUERY", "Search query must be an object");
  }

  const rawSearch = q.search == null ? "" : String(q.search);
  if (rawSearch.length > 200) {
    throw new SearchValidationError("SEARCH_QUERY_TOO_LONG", "Search text must be at most 200 characters");
  }

  const rawStatus = (q.status == null || String(q.status).trim() === "" ? "live" : String(q.status).trim().toLowerCase());
  if (rawStatus !== "all" && !PUBLIC_SEARCH_STATUSES.has(rawStatus)) {
    throw new SearchValidationError("INVALID_STATUS", `Unsupported or non-public search status: ${rawStatus}`);
  }

  const rawOrder = (q.order ?? "ending") as string;
  if (!ALLOWED_SEARCH_ORDERS.has(rawOrder)) {
    throw new SearchValidationError("INVALID_ORDER", `Unsupported sort order: ${String(rawOrder)}`);
  }

  const limit = parseFiniteOpt(q.limit ?? 48, "limit", { integer: true, min: 1, max: 100 }) ?? 48;
  const offset = parseFiniteOpt(q.offset ?? 0, "offset", { integer: true, min: 0, max: 100_000 }) ?? 0;

  const minPrice = parseFiniteOpt(q.minPrice, "minPrice", { min: 0, max: 1_000_000_000 });
  const maxPrice = parseFiniteOpt(q.maxPrice, "maxPrice", { min: 0, max: 1_000_000_000 });
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    throw new SearchValidationError("INVALID_RANGE", "minPrice cannot exceed maxPrice");
  }

  const minYear = parseFiniteOpt(q.minYear, "minYear", { integer: true, min: 1900, max: 2100 });
  const maxYear = parseFiniteOpt(q.maxYear, "maxYear", { integer: true, min: 1900, max: 2100 });
  if (minYear != null && maxYear != null && minYear > maxYear) {
    throw new SearchValidationError("INVALID_RANGE", "minYear cannot exceed maxYear");
  }

  const minMileage = parseFiniteOpt(q.minMileage, "minMileage", { min: 0, max: 50_000_000 });
  const maxMileage = parseFiniteOpt(q.maxMileage, "maxMileage", { min: 0, max: 50_000_000 });
  if (minMileage != null && maxMileage != null && minMileage > maxMileage) {
    throw new SearchValidationError("INVALID_RANGE", "minMileage cannot exceed maxMileage");
  }

  const endingWithinMinutes = parseFiniteOpt(q.endingWithinMinutes, "endingWithinMinutes", {
    positive: true,
    max: 525_600,
  });

  if (q.facets != null && (typeof q.facets !== "object" || Array.isArray(q.facets))) {
    throw new SearchValidationError("INVALID_FACETS", "facets must be a key/value object");
  }

  const cleanOpt = (v: unknown, max = 120) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    if (!s) return undefined;
    if (s.length > max) {
      throw new SearchValidationError("FILTER_TOO_LONG", `Filter value exceeds ${max} characters`);
    }
    return s;
  };

  return {
    search: rawSearch.trim(),
    categoryKey: cleanOpt(q.categoryKey, 80),
    status: rawStatus,
    city: cleanOpt(q.city, 120),
    condition: cleanOpt(q.condition, 80),
    minPrice,
    maxPrice,
    minYear,
    maxYear,
    minMileage,
    maxMileage,
    make: cleanOpt(q.make, 120),
    model: cleanOpt(q.model, 120),
    vehicleClass: cleanOpt(q.vehicleClass, 80),
    bodyType: cleanOpt(q.bodyType, 80),
    fuel: cleanOpt(q.fuel, 80),
    transmission: cleanOpt(q.transmission, 80),
    drivetrain: cleanOpt(q.drivetrain, 80),
    colour: cleanOpt(q.colour, 80),
    inspectionGrade: cleanOpt(q.inspectionGrade, 40),
    roadworthy: q.roadworthy === undefined || q.roadworthy === null ? null : Boolean(q.roadworthy),
    facets: q.facets,
    endingWithinMinutes,
    order: rawOrder as ValidatedSearchQuery["order"],
    limit,
    offset,
  };
}

async function listAllPages(
  store: VehicleStore,
  table: string,
  baseParams: Record<string, string | number>,
  batchSize = 250,
): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  for (let page = 0; page < 400; page++) {
    const chunk = await store.list(
      table,
      params({ ...baseParams, limit: batchSize, offset }),
    );
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < batchSize) break;
    offset += chunk.length;
  }
  return out;
}

export async function removeAuctionFromSearch(store: VehicleStore, auctionId: number): Promise<void> {
  const existingFacets = await listAllPages(store, "product_search_facet_values", {
    "filter[auction_id][$eq]": auctionId,
  });
  for (const facet of existingFacets) {
    if (store.remove && facet?.id != null) {
      await store.remove("product_search_facet_values", facet.id).catch(() => false);
    }
  }

  if (store.remove) {
    await store.remove("product_search_index", auctionId).catch(() => false);
  } else {
    const existing = (
      await store.list("product_search_index", params({ "filter[auction_id][$eq]": auctionId, limit: 1 }))
    )[0];
    if (existing) {
      await store
        .update("product_search_index", auctionId, {
          auction_status: "deleted",
          updated_at: nowIso(),
          indexed_at: nowIso(),
        })
        .catch(() => false);
    }
  }
}

export async function refreshAuctionSearch(store: VehicleStore, auctionId: number): Promise<boolean> {
  if (!Number.isSafeInteger(auctionId) || auctionId <= 0) return false;

  const auction = await store.get("auctions", auctionId);
  const intakeSessions = auction
    ? await store.list("product_intake_sessions", params({ "filter[auction_id][$eq]": auctionId, limit: 20 })).catch(() => [])
    : [];

  if (!auction || !isPubliclyVisibleAuction(auction, intakeSessions)) {
    await removeAuctionFromSearch(store, auctionId);
    return false;
  }

  // Read canonical vehicle record if applicable
  const vehicles = await store.list("vehicles", params({ "filter[auction_id][$eq]": auctionId, limit: 1 }));
  const v = vehicles[0] ?? null;

  // Read category and schema
  let cat: any = null;
  if (auction.product_category_id != null) {
    cat = await store.get("categories", auction.product_category_id).catch(() => null);
    if (!cat) {
      cat = (await store.list("categories", params({ "filter[id][$eq]": auction.product_category_id, limit: 1 })))[0] ?? null;
    }
  }
  const categoryKey = cat?.category_key ?? "VEHICLE_WHOLE_UNCLASSIFIED";

  // Read effective facts for vehicle or generic product
  let mileage = v?.odometer_km ?? null;
  const effectiveFactByKey = new Map<string, any>();
  const factTargetType = v?.id ? "VEHICLE" : "AUCTION";
  const factTargetId = v?.id ? Number(v.id) : auctionId;
  const [effectiveFacts, definitions] = await Promise.all([
    store
      .list(
        "pi_effective_facts",
        params({
          "filter[product_type][$eq]": factTargetType,
          "filter[product_id][$eq]": factTargetId,
          limit: 300,
        }),
      )
      .catch(() => []),
    store.list("pi_attribute_definitions", params({ limit: 300 })).catch(() => []),
  ]);
  for (const ef of effectiveFacts) {
    const def = definitions.find((d: any) => Number(d.id) === Number(ef.attribute_id));
    if (def?.attribute_key) {
      effectiveFactByKey.set(String(def.attribute_key).toUpperCase(), ef);
    }
  }
  const odoFact = effectiveFactByKey.get("ODOMETER_KM");
  if (odoFact && odoFact.value_decimal != null) {
    mileage = Math.round(Number(odoFact.value_decimal));
  }

  // Read inspection projection through TrailBase physical-table resolver
  let inspectionStatus: string | null = null;
  let inspectionGrade: string | null = null;
  let roadworthy: number | null = null;
  if (v?.id) {
    const insp = await resolveVehicleInspectionProjection(store, Number(v.id), auctionId);
    if (insp) {
      inspectionStatus = insp.inspection_status != null ? String(insp.inspection_status) : null;
      inspectionGrade = insp.inspection_grade != null ? String(insp.inspection_grade) : null;
      roadworthy = insp.roadworthy != null ? Number(insp.roadworthy) : null;
    }
  }

  const importState =
    v?.customs_status === "LOCAL"
      ? "DOMESTIC"
      : v?.customs_status && ["CLEARED", "PENDING"].includes(v.customs_status)
        ? "IMPORTED"
        : "UNSPECIFIED";

  const makeVal = v?.make ?? effectiveFactByKey.get("MAKE")?.value_text ?? null;
  const modelVal = v?.model ?? effectiveFactByKey.get("MODEL")?.value_text ?? null;
  const yearVal =
    v?.model_year ??
    v?.manufacture_year ??
    (effectiveFactByKey.get("MODEL_YEAR")?.value_integer != null
      ? Number(effectiveFactByKey.get("MODEL_YEAR")?.value_integer)
      : null);

  const row = {
    auction_id: Number(auction.id),
    product_category_id: auction.product_category_id ?? cat?.id ?? 1,
    category_key: categoryKey,
    schema_version_id: auction.product_schema_version_id ?? 1,
    title: clean(auction.title, 180),
    description: clean(auction.description, 2000),
    make: makeVal,
    model: modelVal,
    generation: v?.generation_series ?? null,
    variant: v?.variant ?? null,
    trim: v?.trim ?? null,
    model_code: v?.model_code ?? null,
    year: yearVal,
    price: Number(auction.current_price ?? auction.start_price ?? 0),
    mileage,
    vehicle_class: v?.vehicle_class ?? null,
    body_type: v?.body_type ?? null,
    fuel: v?.fuel_type ?? null,
    transmission: v?.transmission ?? null,
    drivetrain: v?.drivetrain ?? null,
    steering_side: v?.steering_side ?? null,
    exterior_colour: v?.primary_exterior_colour ?? null,
    location: clean(auction.city, 120),
    sale_condition: clean(auction.condition, 80),
    inspection_status: inspectionStatus,
    inspection_grade: inspectionGrade,
    roadworthy,
    service_history_class: v?.service_history_class ?? null,
    accident_history: v?.accident_history ?? null,
    repair_history: v?.repair_history ?? null,
    modification_status: v?.modification_status ?? null,
    import_state: importState,
    customs_status: v?.customs_status ?? null,
    reserve_disclosure: clean(auction.reserve_disclosure, 60) || "UNSPECIFIED",
    auction_status: clean(auction.status, 40).toLowerCase() || "live",
    ending_time: clean(auction.ends_at, 40),
    featured: auction.featured ? 1 : 0,
    created_at: auction.created_at || nowIso(),
    updated_at: auction.updated_at || nowIso(),
    indexed_at: nowIso(),
  };

  const existing = (
    await store.list("product_search_index", params({ "filter[auction_id][$eq]": auctionId, limit: 1 }))
  )[0];
  if (existing) {
    await store.update("product_search_index", auctionId, row);
  } else {
    const created = await store.create("product_search_index", row);
    if (created == null) {
      await store.update("product_search_index", auctionId, row).catch(() => false);
    }
  }

  await refreshAuctionFacets(store, row, definitions, effectiveFactByKey);
  return true;
}

async function refreshAuctionFacets(
  store: VehicleStore,
  psi: Record<string, any>,
  preloadedDefinitions?: any[],
  effectiveFactByKey?: Map<string, any>,
) {
  const [definitions, bindings, existingFacets] = await Promise.all([
    preloadedDefinitions
      ? Promise.resolve(preloadedDefinitions)
      : store.list("pi_attribute_definitions", params({ "filter[active][$eq]": 1, limit: 300 })),
    store.list("pi_category_attributes", params({ "filter[schema_version_id][$eq]": psi.schema_version_id, limit: 300 })),
    listAllPages(store, "product_search_facet_values", { "filter[auction_id][$eq]": psi.auction_id }),
  ]);

  const facetMap: Record<string, { text?: string | null; num?: number | null; bool?: number | null }> = {
    MAKE: { text: psi.make },
    MODEL: { text: psi.model },
    MODEL_YEAR: { num: psi.year },
    ODOMETER_KM: { num: psi.mileage },
    VEHICLE_CLASS: { text: psi.vehicle_class },
    BODY_TYPE: { text: psi.body_type },
    FUEL_TYPE: { text: psi.fuel },
    TRANSMISSION: { text: psi.transmission },
    DRIVETRAIN: { text: psi.drivetrain },
    EXTERIOR_COLOUR: { text: psi.exterior_colour },
    INSPECTION_STATUS: { text: psi.inspection_status },
    INSPECTION_GRADE: { text: psi.inspection_grade },
    ROADWORTHY: { bool: psi.roadworthy != null ? Number(psi.roadworthy) : undefined },
    SERVICE_HISTORY_CLASS: { text: psi.service_history_class },
    ACCIDENT_HISTORY: { text: psi.accident_history },
    CUSTOMS_STATUS: { text: psi.customs_status },
  };

  if (effectiveFactByKey) {
    for (const [key, ef] of effectiveFactByKey.entries()) {
      if (facetMap[key]) continue;
      if (ef?.value_text != null || ef?.value_integer != null || ef?.value_decimal != null || ef?.value_boolean != null) {
        facetMap[key] = {
          text: ef.value_text ?? null,
          num:
            ef.value_integer != null
              ? Number(ef.value_integer)
              : ef.value_decimal != null
                ? Number(ef.value_decimal)
                : null,
          bool: ef.value_boolean != null ? Number(ef.value_boolean) : null,
        };
      }
    }
  }

  const desiredKeys = new Set<string>();
  const existingByKey = new Map<string, any>();
  for (const ef of existingFacets) {
    if (ef?.attribute_key) existingByKey.set(String(ef.attribute_key).toUpperCase(), ef);
  }

  for (const [key, val] of Object.entries(facetMap)) {
    const def = definitions.find((d: any) => String(d.attribute_key).toUpperCase() === key);
    if (!def) continue;
    const bind = bindings.find((b: any) => Number(b.attribute_id) === Number(def.id));
    const filterClass = bind?.filter_class ?? def.filter_class ?? "NONE";

    const hasVal =
      (val.text != null && String(val.text).trim() !== "") ||
      val.num != null ||
      val.bool != null;
    if (!hasVal) continue;

    desiredKeys.add(key);
    const row = {
      auction_id: psi.auction_id,
      category_id: psi.product_category_id,
      attribute_id: def.id,
      attribute_key: key,
      filter_class: filterClass,
      data_type: def.data_type,
      value_text: val.text != null && String(val.text).trim() !== "" ? String(val.text) : null,
      value_number: val.num ?? null,
      value_boolean: val.bool ?? null,
      value_date: null,
      indexed_at: nowIso(),
    };

    const existing = existingByKey.get(key);
    if (existing?.id != null) {
      await store.update("product_search_facet_values", existing.id, row);
    } else {
      await store.create("product_search_facet_values", row);
    }
  }

  // Delete stale facets removed by later edits
  if (store.remove) {
    for (const [key, existing] of existingByKey.entries()) {
      if (!desiredKeys.has(key) && existing?.id != null) {
        await store.remove("product_search_facet_values", existing.id).catch(() => false);
      }
    }
  }
}

export async function consumeSearchProjectionOutbox(
  store: VehicleStore,
  options: { limit?: number; eventTypes?: string[] } = {},
): Promise<{
  processed: number;
  refreshed: number;
  removed: number;
  failed: number;
  refreshedAuctionIds: number[];
}> {
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const allowedTypes = new Set(
    options.eventTypes ?? [
      "FACT_ASSERTED",
      "EFFECTIVE_FACT_CHANGED",
      "PRODUCT_PUBLISHED",
      "INSPECTION_PROJECTED",
      "SEARCH_INDEX_REFRESH",
    ],
  );

  // Query pending rows (`published_at IS NULL`) and guard against stores lacking `$is=NULL` support.
  const rawPending = await store
    .list("pi_projection_outbox", params({ "filter[published_at][$is]": "NULL", order: "id", limit }))
    .catch(() => []);
  const pending = rawPending.filter(
    (evt: any) => evt && (evt.published_at == null || evt.published_at === "") && allowedTypes.has(String(evt.event_type ?? "")),
  );

  const auctionEvents = new Map<number, any[]>();
  const nonRefreshEvents: any[] = [];

  for (const evt of pending) {
    let payloadObj: Record<string, any> = {};
    if (typeof evt.payload === "string" && evt.payload.trim()) {
      try {
        payloadObj = JSON.parse(evt.payload);
      } catch {
        payloadObj = {};
      }
    } else if (evt.payload && typeof evt.payload === "object") {
      payloadObj = evt.payload;
    }

    let auctionId = Number(payloadObj.auctionId ?? 0);
    if (!auctionId) {
      if (evt.product_type === "AUCTION") {
        auctionId = Number(evt.product_id ?? 0);
      } else if (evt.product_type === "VEHICLE" && Number(evt.product_id) > 0) {
        const veh = await store.get("vehicles", Number(evt.product_id)).catch(() => null);
        auctionId = Number(veh?.auction_id ?? 0);
      }
    }

    if (auctionId > 0) {
      const list = auctionEvents.get(auctionId) ?? [];
      list.push(evt);
      auctionEvents.set(auctionId, list);
    } else {
      nonRefreshEvents.push(evt);
    }
  }

  let processed = 0;
  let refreshed = 0;
  let removed = 0;
  let failed = 0;
  const refreshedAuctionIds: number[] = [];

  for (const [auctionId, evts] of auctionEvents.entries()) {
    try {
      const kept = await refreshAuctionSearch(store, auctionId);
      refreshedAuctionIds.push(auctionId);
      if (kept) refreshed += 1;
      else removed += 1;
      const stamped = nowIso();
      for (const evt of evts) {
        const acked = await store.update("pi_projection_outbox", evt.id, { published_at: stamped });
        if (!acked) {
          failed += 1;
        } else {
          processed += 1;
        }
      }
    } catch {
      failed += evts.length;
    }
  }

  for (const evt of nonRefreshEvents) {
    const acked = await store.update("pi_projection_outbox", evt.id, { published_at: nowIso() }).catch(() => false);
    if (acked) processed += 1;
    else failed += 1;
  }

  return { processed, refreshed, removed, failed, refreshedAuctionIds };
}

/** Full paginated rebuild of search index from canonical truth without mutating product truth. */
export async function rebuildProductSearchIndex(
  store: VehicleStore,
  batchSize = 250,
): Promise<{ count: number; removed: number }> {
  const safeBatch = Math.max(1, Math.min(1000, Math.floor(batchSize)));
  const auctions = await listAllPages(store, "auctions", { order: "id" }, safeBatch);
  const activeAuctionIds = new Set<number>();

  let count = 0;
  let removed = 0;
  for (const a of auctions) {
    const id = Number(a.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    activeAuctionIds.add(id);
    const indexed = await refreshAuctionSearch(store, id);
    if (indexed) count += 1;
    else removed += 1;
  }

  // Sweep orphaned search projections that no longer exist in canonical `auctions`.
  const indexedRows = await listAllPages(store, "product_search_index", { order: "auction_id" }, safeBatch);
  for (const row of indexedRows) {
    const aid = Number(row.auction_id);
    if (aid > 0 && !activeAuctionIds.has(aid)) {
      await removeAuctionFromSearch(store, aid);
      removed += 1;
    }
  }

  return { count, removed };
}

function tokenizeSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .split(/[\s\-_/.,:;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function matchesMultiFieldFts(row: Record<string, any>, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = [
    row.title,
    row.description,
    row.make,
    row.model,
    row.generation,
    row.variant,
    row.trim,
    row.model_code,
    row.vehicle_class,
    row.body_type,
    row.fuel,
    row.transmission,
    row.drivetrain,
    row.exterior_colour,
    row.location,
  ]
    .filter((x) => x != null && String(x).trim() !== "")
    .join(" ")
    .toLowerCase();
  return terms.every((term) => hay.includes(term));
}

function matchesStructuredFacet(
  item: Record<string, any>,
  facetKey: string,
  spec: unknown,
  rowFacetMap: Map<string, any> | undefined,
): boolean {
  if (spec == null || spec === "") return true;
  const upperKey = facetKey.toUpperCase();
  const aliasCol: Record<string, string> = {
    MAKE: "make",
    MODEL: "model",
    GENERATION: "generation",
    VARIANT: "variant",
    TRIM: "trim",
    MODEL_CODE: "model_code",
    MODEL_YEAR: "year",
    YEAR: "year",
    ODOMETER_KM: "mileage",
    MILEAGE: "mileage",
    VEHICLE_CLASS: "vehicle_class",
    BODY_TYPE: "body_type",
    FUEL_TYPE: "fuel",
    FUEL: "fuel",
    TRANSMISSION: "transmission",
    DRIVETRAIN: "drivetrain",
    STEERING_SIDE: "steering_side",
    EXTERIOR_COLOUR: "exterior_colour",
    COLOUR: "exterior_colour",
    INSPECTION_STATUS: "inspection_status",
    INSPECTION_GRADE: "inspection_grade",
    ROADWORTHY: "roadworthy",
    SERVICE_HISTORY_CLASS: "service_history_class",
    ACCIDENT_HISTORY: "accident_history",
    REPAIR_HISTORY: "repair_history",
    MODIFICATION_STATUS: "modification_status",
    IMPORT_STATE: "import_state",
    CUSTOMS_STATUS: "customs_status",
    RESERVE_DISCLOSURE: "reserve_disclosure",
  };

  const facetRow = rowFacetMap?.get(upperKey);
  const col = aliasCol[upperKey] ?? facetKey.toLowerCase();
  let actual = item[col];
  if (actual === undefined && facetRow) {
    actual =
      facetRow.value_text ??
      facetRow.value_number ??
      (facetRow.value_boolean != null ? Number(facetRow.value_boolean) : undefined);
  }

  if (typeof spec === "object" && !Array.isArray(spec)) {
    const obj = spec as Record<string, unknown>;
    const op = String(obj.operator ?? "").toUpperCase();
    if (op === "EXISTS" || obj.exists === true) {
      return actual != null && actual !== "";
    }
    if (op === "BETWEEN" || obj.min != null || obj.max != null) {
      const minVal = obj.min != null ? Number(obj.min) : null;
      const maxVal = obj.max != null ? Number(obj.max) : null;
      if (actual == null) return false;
      const num = Number(actual);
      if (!Number.isFinite(num)) return false;
      if (minVal != null && num < minVal) return false;
      if (maxVal != null && num > maxVal) return false;
      return true;
    }
    if (Array.isArray(obj.in)) {
      const allowed = obj.in.map((x) => String(x).toLowerCase());
      return actual != null && allowed.includes(String(actual).toLowerCase());
    }
    if (obj.value !== undefined) {
      spec = obj.value;
    }
  }

  if (Array.isArray(spec)) {
    if (spec.length === 0) return true;
    const allowed = spec.map((x) => String(x).toLowerCase());
    return actual != null && allowed.includes(String(actual).toLowerCase());
  }

  if (actual == null) return false;
  if (typeof spec === "boolean") {
    return Boolean(actual) === spec;
  }
  return String(actual).toLowerCase() === String(spec).toLowerCase();
}

function compareSort(a: any, b: any, order: ValidatedSearchQuery["order"]): number {
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const dateMs = (v: unknown, fallback: number) => {
    const ms = Date.parse(String(v ?? ""));
    return Number.isFinite(ms) ? ms : fallback;
  };
  const aidA = num(a.auction_id, 0);
  const aidB = num(b.auction_id, 0);

  let diff = 0;
  switch (order) {
    case "newest":
      diff = dateMs(b.created_at, 0) - dateMs(a.created_at, 0);
      return diff !== 0 ? diff : aidB - aidA;
    case "price_asc":
      diff = num(a.price, 0) - num(b.price, 0);
      return diff !== 0 ? diff : aidA - aidB;
    case "price_desc":
      diff = num(b.price, 0) - num(a.price, 0);
      return diff !== 0 ? diff : aidA - aidB;
    case "mileage":
      diff = num(a.mileage, Number.POSITIVE_INFINITY) - num(b.mileage, Number.POSITIVE_INFINITY);
      return diff !== 0 ? diff : aidA - aidB;
    case "year":
      diff = num(b.year, Number.NEGATIVE_INFINITY) - num(a.year, Number.NEGATIVE_INFINITY);
      return diff !== 0 ? diff : aidA - aidB;
    case "bids":
    case "hot":
      diff = num(b.featured, 0) - num(a.featured, 0);
      if (diff !== 0) return diff;
      diff = dateMs(a.ending_time, Number.POSITIVE_INFINITY) - dateMs(b.ending_time, Number.POSITIVE_INFINITY);
      return diff !== 0 ? diff : aidA - aidB;
    case "ending":
    default:
      diff = dateMs(a.ending_time, Number.POSITIVE_INFINITY) - dateMs(b.ending_time, Number.POSITIVE_INFINITY);
      return diff !== 0 ? diff : aidA - aidB;
  }
}

/** Filter and query against product_search_index. */
export async function queryProductSearch(
  store: VehicleStore,
  q: SearchQueryInput = {},
): Promise<{
  items: any[];
  total: number;
  limit: number;
  offset: number;
  facetOptions: Record<string, { value: string; label: string; count: number }[]>;
}> {
  const v = validateSearchQuery(q);

  const requestedCatLower = v.categoryKey ? v.categoryKey.toLowerCase() : "";
  const isVehicleFamilyFilter =
    requestedCatLower === "vehicles" || requestedCatLower === "vehicles_mobility";
  const isPhoneFamilyFilter =
    requestedCatLower === "phones" ||
    requestedCatLower === "phone-smartphone" ||
    requestedCatLower === "electronics";

  const filterList: Record<string, string | number> = {};
  if (v.status !== "all") {
    filterList["filter[auction_status][$eq]"] = v.status;
  }
  if (v.categoryKey && !isVehicleFamilyFilter && !isPhoneFamilyFilter) {
    filterList["filter[category_key][$eq]"] = v.categoryKey;
  }
  if (v.minPrice != null) filterList["filter[price][$gte]"] = v.minPrice;
  if (v.maxPrice != null) filterList["filter[price][$lte]"] = v.maxPrice;
  if (v.minYear != null) filterList["filter[year][$gte]"] = v.minYear;
  if (v.maxYear != null) filterList["filter[year][$lte]"] = v.maxYear;
  if (v.minMileage != null) filterList["filter[mileage][$gte]"] = v.minMileage;
  if (v.maxMileage != null) filterList["filter[mileage][$lte]"] = v.maxMileage;
  if (v.roadworthy != null) filterList["filter[roadworthy][$eq]"] = v.roadworthy ? 1 : 0;

  let orderParam = "ending_time,auction_id";
  switch (v.order) {
    case "newest":
      orderParam = "-created_at,-auction_id";
      break;
    case "price_asc":
      orderParam = "price,auction_id";
      break;
    case "price_desc":
      orderParam = "-price,auction_id";
      break;
    case "mileage":
      orderParam = "mileage,auction_id";
      break;
    case "year":
      orderParam = "-year,auction_id";
      break;
    default:
      orderParam = "ending_time,auction_id";
  }
  filterList["order"] = orderParam;

  // Fetch ALL candidate rows before applying FTS / facets / pagination so total & facetOptions are exact.
  const allCandidates = await listAllPages(store, "product_search_index", filterList, 250);

  let ftsIds: Set<number> | null = null;
  if (v.search && store.searchFts) {
    const matchedIds = await store.searchFts(v.search).catch(() => null);
    if (Array.isArray(matchedIds)) {
      ftsIds = new Set(matchedIds.map((id) => Number(id)));
    }
  }
  const searchTerms = v.search ? tokenizeSearchTerms(v.search) : [];

  const nowMs = Date.now();
  const maxEndingMs = v.endingWithinMinutes != null ? nowMs + v.endingWithinMinutes * 60_000 : null;

  // Pre-filter structural & full-text constraints before fetching secondary facet_values if needed
  let filtered = allCandidates.filter((r: any) => {
    const status = String(r.auction_status ?? "").trim().toLowerCase();
    if (!PUBLIC_SEARCH_STATUSES.has(status)) return false;
    if (v.status !== "all" && status !== v.status) return false;

    if (v.categoryKey) {
      const rowCatUpper = String(r.category_key ?? "").toUpperCase();
      if (isVehicleFamilyFilter) {
        if (!rowCatUpper.startsWith("VEHICLE")) return false;
      } else if (isPhoneFamilyFilter) {
        if (!rowCatUpper.startsWith("PHONE")) return false;
      } else if (rowCatUpper !== v.categoryKey.toUpperCase()) {
        return false;
      }
    }
    if (v.city && String(r.location ?? "").toLowerCase() !== v.city.toLowerCase()) return false;
    if (v.condition && String(r.sale_condition ?? "").toLowerCase() !== v.condition.toLowerCase()) return false;
    if (v.make && String(r.make ?? "").toLowerCase() !== v.make.toLowerCase()) return false;
    if (v.model && String(r.model ?? "").toLowerCase() !== v.model.toLowerCase()) return false;
    if (v.vehicleClass && String(r.vehicle_class ?? "").toLowerCase() !== v.vehicleClass.toLowerCase()) return false;
    if (v.bodyType) {
      const wantBody = v.bodyType.toUpperCase();
      const gotBody = String(r.body_type ?? "").toUpperCase();
      if (gotBody !== wantBody && !(wantBody === "PICKUP" && gotBody.startsWith("PICKUP"))) return false;
    }
    if (v.fuel && String(r.fuel ?? "").toLowerCase() !== v.fuel.toLowerCase()) return false;
    if (v.transmission && String(r.transmission ?? "").toLowerCase() !== v.transmission.toLowerCase()) return false;
    if (v.drivetrain) {
      const wantDrive = v.drivetrain.toUpperCase();
      const gotDrive = String(r.drivetrain ?? "").toUpperCase();
      if (gotDrive !== wantDrive && !(wantDrive === "AWD_4WD" && (gotDrive === "4WD" || gotDrive === "AWD" || gotDrive === "AWD_4WD"))) return false;
    }
    if (v.colour && String(r.exterior_colour ?? "").toLowerCase() !== v.colour.toLowerCase()) return false;
    if (v.inspectionGrade && String(r.inspection_grade ?? "").toLowerCase() !== v.inspectionGrade.toLowerCase()) return false;
    if (v.roadworthy != null && Boolean(r.roadworthy) !== v.roadworthy) return false;

    const price = r.price != null ? Number(r.price) : null;
    if (v.minPrice != null && (price == null || price < v.minPrice)) return false;
    if (v.maxPrice != null && (price == null || price > v.maxPrice)) return false;

    const year = r.year != null ? Number(r.year) : null;
    if (v.minYear != null && (year == null || year < v.minYear)) return false;
    if (v.maxYear != null && (year == null || year > v.maxYear)) return false;

    const mileage = r.mileage != null ? Number(r.mileage) : null;
    if (v.minMileage != null && (mileage == null || mileage < v.minMileage)) return false;
    if (v.maxMileage != null && (mileage == null || mileage > v.maxMileage)) return false;

    if (maxEndingMs != null) {
      const endsMs = Date.parse(String(r.ending_time ?? ""));
      if (!Number.isFinite(endsMs) || endsMs < nowMs || endsMs > maxEndingMs) return false;
    }

    if (v.search) {
      if (ftsIds != null) {
        if (!ftsIds.has(Number(r.auction_id))) return false;
      } else if (!matchesMultiFieldFts(r, searchTerms)) {
        return false;
      }
    }

    return true;
  });

  if (v.facets && Object.keys(v.facets).length > 0 && filtered.length > 0) {
    const facetRowsByAuction = new Map<number, Map<string, any>>();
    const needsFacetTableLookup = Object.keys(v.facets).some((k) =>
      filtered.some((item: any) => item[k.toLowerCase()] === undefined),
    );
    if (needsFacetTableLookup) {
      const allFacetRows = await listAllPages(store, "product_search_facet_values", { order: "id" }, 500);
      for (const fr of allFacetRows) {
        const aid = Number(fr.auction_id);
        let map = facetRowsByAuction.get(aid);
        if (!map) {
          map = new Map<string, any>();
          facetRowsByAuction.set(aid, map);
        }
        map.set(String(fr.attribute_key ?? "").toUpperCase(), fr);
      }
    }

    filtered = filtered.filter((item: any) => {
      const aid = Number(item.auction_id);
      const fMap = facetRowsByAuction.get(aid);
      for (const [key, val] of Object.entries(v.facets ?? {})) {
        if (!matchesStructuredFacet(item, key, val, fMap)) {
          return false;
        }
      }
      return true;
    });
  }

  // Deterministic ordering with auction_id tie-breaker
  filtered.sort((a, b) => compareSort(a, b, v.order));

  // Aggregate facet counts across ALL matched results (before pagination)
  const facetOptions: Record<string, { value: string; label: string; count: number }[]> = {};
  const collectFacet = (facetKey: string, prop: string) => {
    const counts = new Map<string, number>();
    for (const r of filtered) {
      const val = r[prop];
      if (val != null && val !== "") {
        const s = String(val);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
    }
    facetOptions[facetKey] = Array.from(counts.entries())
      .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
      .map(([value, count]) => ({
        value,
        label: value,
        count,
      }));
  };

  collectFacet("make", "make");
  collectFacet("model", "model");
  collectFacet("vehicleClass", "vehicle_class");
  collectFacet("bodyType", "body_type");
  collectFacet("fuel", "fuel");
  collectFacet("transmission", "transmission");
  collectFacet("drivetrain", "drivetrain");
  collectFacet("colour", "exterior_colour");
  collectFacet("inspectionGrade", "inspection_grade");

  const items = filtered.slice(v.offset, v.offset + v.limit);

  return {
    items,
    total: filtered.length,
    limit: v.limit,
    offset: v.offset,
    facetOptions,
  };
}
