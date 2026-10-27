// TENGASELL-PI-01E / DISC-01 — Structured search indexing, projection refresh
// and rebuild harness.
//
// Search is DERIVED, REBUILDABLE, and NON-AUTHORITATIVE. Canonical truth remains
// in auctions, vehicles, pi_effective_facts and inspection records. Sensitive
// identifiers (VIN, chassis, reg, engine serial, document numbers) are NEVER indexed.

import type { VehicleStore } from "./vehicle-authority";
import type { PiFact } from "./product-intelligence";

const clean = (val: unknown, max = 500) => String(val ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

function params(fields: Record<string, string | number>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) q.set(key, String(value));
  return q.toString();
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

export async function refreshAuctionSearch(store: VehicleStore, auctionId: number): Promise<boolean> {
  const auction = await store.get("auctions", auctionId);
  if (!auction) {
    await store.update("product_search_index", auctionId, { auction_status: "deleted" }).catch(() => false);
    return false;
  }

  // Read canonical vehicle record if applicable
  const vehicles = await store.list("vehicles", params({ "filter[auction_id][$eq]": auctionId, limit: 1 }));
  const v = vehicles[0] ?? null;

  // Read category and schema
  const categories = await store.list("categories", params({ "filter[id][$eq]": auction.product_category_id ?? 0, limit: 1 }));
  const cat = categories[0] ?? null;
  const categoryKey = cat?.category_key ?? "VEHICLE_WHOLE_UNCLASSIFIED";

  // Read effective facts
  let mileage = v?.odometer_km ?? null;
  if (v?.id) {
    const effectiveFacts = await store.list("pi_effective_facts", params({
      "filter[product_type][$eq]": "VEHICLE",
      "filter[product_id][$eq]": v.id,
      limit: 100,
    }));
    const definitions = await store.list("pi_attribute_definitions", params({ limit: 100 }));
    const odoDef = definitions.find((d: any) => d.attribute_key === "ODOMETER_KM");
    if (odoDef) {
      const odoFact = effectiveFacts.find((f: any) => Number(f.attribute_id) === Number(odoDef.id));
      if (odoFact && odoFact.value_decimal != null) {
        mileage = Math.round(Number(odoFact.value_decimal));
      }
    }
  }

  // Read inspection projection
  let inspectionStatus: string | null = null;
  let inspectionGrade: string | null = null;
  let roadworthy: number | null = null;
  if (v?.id) {
    const insp = (await store.list("pi_vehicle_inspection_projection", params({ "filter[vehicle_id][$eq]": v.id, limit: 1 })))[0];
    if (insp) {
      inspectionStatus = insp.inspection_status ?? null;
      inspectionGrade = insp.inspection_grade ?? null;
      roadworthy = insp.roadworthy != null ? Number(insp.roadworthy) : null;
    }
  }

  const importState = v?.customs_status === "LOCAL"
    ? "DOMESTIC"
    : v?.customs_status && ["CLEARED", "PENDING"].includes(v.customs_status)
      ? "IMPORTED"
      : "UNSPECIFIED";

  const row = {
    auction_id: auction.id,
    product_category_id: auction.product_category_id ?? (cat?.id ?? 1),
    category_key: categoryKey,
    schema_version_id: auction.product_schema_version_id ?? 1,
    title: clean(auction.title, 180),
    description: clean(auction.description, 2000),
    make: v?.make ?? null,
    model: v?.model ?? null,
    generation: v?.generation_series ?? null,
    variant: v?.variant ?? null,
    trim: v?.trim ?? null,
    model_code: v?.model_code ?? null,
    year: v?.model_year ?? v?.manufacture_year ?? null,
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
    auction_status: clean(auction.status, 40) || "live",
    ending_time: clean(auction.ends_at, 40),
    featured: auction.featured ? 1 : 0,
    created_at: auction.created_at || nowIso(),
    updated_at: auction.updated_at || nowIso(),
    indexed_at: nowIso(),
  };

  const existing = (await store.list("product_search_index", params({ "filter[auction_id][$eq]": auctionId, limit: 1 })))[0];
  if (existing) {
    await store.update("product_search_index", auctionId, row);
  } else {
    await store.create("product_search_index", row);
  }

  // Refresh Facet values for this auction
  await refreshAuctionFacets(store, row);

  return true;
}

async function refreshAuctionFacets(store: VehicleStore, psi: Record<string, any>) {
  const definitions = await store.list("pi_attribute_definitions", params({ "filter[active][$eq]": 1, limit: 100 }));
  const bindings = await store.list("pi_category_attributes", params({ "filter[schema_version_id][$eq]": psi.schema_version_id, limit: 100 }));

  const facetMap: Record<string, { text?: string; num?: number; bool?: number }> = {
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
    ROADWORTHY: { bool: psi.roadworthy != null ? psi.roadworthy : undefined },
    SERVICE_HISTORY_CLASS: { text: psi.service_history_class },
    ACCIDENT_HISTORY: { text: psi.accident_history },
    CUSTOMS_STATUS: { text: psi.customs_status },
  };

  for (const [key, val] of Object.entries(facetMap)) {
    const def = definitions.find((d: any) => d.attribute_key === key);
    if (!def) continue;
    const bind = bindings.find((b: any) => Number(b.attribute_id) === Number(def.id));
    const filterClass = bind?.filter_class ?? def.filter_class ?? "NONE";

    const hasVal = val.text != null || val.num != null || val.bool != null;
    if (!hasVal) continue;

    const row = {
      auction_id: psi.auction_id,
      category_id: psi.product_category_id,
      attribute_id: def.id,
      attribute_key: key,
      filter_class: filterClass,
      data_type: def.data_type,
      value_text: val.text ?? null,
      value_number: val.num ?? null,
      value_boolean: val.bool ?? null,
      value_date: null,
      indexed_at: nowIso(),
    };

    const existing = (await store.list("product_search_facet_values", params({
      "filter[auction_id][$eq]": psi.auction_id,
      "filter[attribute_key][$eq]": key,
      limit: 1,
    })))[0];

    if (existing) {
      await store.update("product_search_facet_values", existing.id, row);
    } else {
      await store.create("product_search_facet_values", row);
    }
  }
}

/** Full rebuild of search index from canonical truth without mutating product truth. */
export async function rebuildProductSearchIndex(store: VehicleStore): Promise<{ count: number }> {
  const auctions = await store.list("auctions", params({ limit: 1000 }));
  let count = 0;
  for (const a of auctions) {
    await refreshAuctionSearch(store, Number(a.id));
    count++;
  }
  return { count };
}

/** Filter and query against product_search_index. */
export async function queryProductSearch(
  store: VehicleStore,
  q: SearchQueryInput = {},
): Promise<{ items: any[]; total: number; facetOptions: Record<string, { value: string; label: string; count: number }[]> }> {
  const filterList: Record<string, string | number> = {};

  if (q.status && q.status !== "all") {
    filterList["filter[auction_status][$eq]"] = q.status;
  } else {
    filterList["filter[auction_status][$eq]"] = "live";
  }

  if (q.categoryKey) {
    filterList["filter[category_key][$eq]"] = q.categoryKey;
  }
  if (q.city) filterList["filter[location][$eq]"] = q.city;
  if (q.condition) filterList["filter[sale_condition][$eq]"] = q.condition;
  if (q.minPrice != null) filterList["filter[price][$gte]"] = q.minPrice;
  if (q.maxPrice != null) filterList["filter[price][$lte]"] = q.maxPrice;
  if (q.minYear != null) filterList["filter[year][$gte]"] = q.minYear;
  if (q.maxYear != null) filterList["filter[year][$lte]"] = q.maxYear;
  if (q.minMileage != null) filterList["filter[mileage][$gte]"] = q.minMileage;
  if (q.maxMileage != null) filterList["filter[mileage][$lte]"] = q.maxMileage;
  if (q.make) filterList["filter[make][$eq]"] = q.make;
  if (q.model) filterList["filter[model][$eq]"] = q.model;
  if (q.vehicleClass) filterList["filter[vehicle_class][$eq]"] = q.vehicleClass;
  if (q.bodyType) filterList["filter[body_type][$eq]"] = q.bodyType;
  if (q.fuel) filterList["filter[fuel][$eq]"] = q.fuel;
  if (q.transmission) filterList["filter[transmission][$eq]"] = q.transmission;
  if (q.drivetrain) filterList["filter[drivetrain][$eq]"] = q.drivetrain;
  if (q.colour) filterList["filter[exterior_colour][$eq]"] = q.colour;
  if (q.inspectionGrade) filterList["filter[inspection_grade][$eq]"] = q.inspectionGrade;
  if (q.roadworthy != null) filterList["filter[roadworthy][$eq]"] = q.roadworthy ? 1 : 0;

  let orderParam = "ending_time";
  switch (q.order) {
    case "newest": orderParam = "-created_at"; break;
    case "price_asc": orderParam = "price"; break;
    case "price_desc": orderParam = "-price"; break;
    case "mileage": orderParam = "mileage"; break;
    case "year": orderParam = "-year"; break;
    default: orderParam = "ending_time";
  }

  filterList["order"] = orderParam;
  filterList["limit"] = q.limit ?? 48;
  filterList["offset"] = q.offset ?? 0;

  const records = await store.list("product_search_index", params(filterList));

  // Client-side text filter if TrailBase doesn't have FTS direct endpoint
  let filtered = records;
  if (q.search) {
    const term = q.search.toLowerCase().trim();
    filtered = records.filter((r: any) => {
      const hay = `${r.title} ${r.description} ${r.make} ${r.model} ${r.variant} ${r.trim}`.toLowerCase();
      return hay.includes(term);
    });
  }

  // Structured facets extra filters
  if (q.facets && typeof q.facets === "object") {
    filtered = filtered.filter((item: any) => {
      for (const [key, val] of Object.entries(q.facets ?? {})) {
        if (val == null || val === "") continue;
        const col = key.toLowerCase();
        if (item[col] !== undefined && String(item[col]).toLowerCase() !== String(val).toLowerCase()) {
          return false;
        }
      }
      return true;
    });
  }

  // Aggregate facet counts from matched results
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
    facetOptions[facetKey] = Array.from(counts.entries()).map(([value, count]) => ({
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

  return {
    items: filtered,
    total: filtered.length,
    facetOptions,
  };
}
