// TENGASELL-PI-01E / DISC-01, DISC-02, DISC-03, DISC-04 unit & remediation tests
import { expect, test } from "bun:test";
import {
  ProductIntelligenceError,
  categoryFilterMetadata,
  deleteOwnedSavedSearch,
  getOwnedSavedSearchFacets,
  listOwnedSavedSearches,
  productCompare,
  saveOwnedSearch,
  setOwnedSavedSearchAlerts,
} from "./product-intelligence";
import {
  SearchValidationError,
  consumeSearchProjectionOutbox,
  queryProductSearch,
  rebuildProductSearchIndex,
  refreshAuctionSearch,
} from "./search-indexing";
import type { VehicleIdentity, VehicleStore } from "./vehicle-authority";

function createInMemoryStore(): VehicleStore & { data: Record<string, any[]> } {
  const data: Record<string, any[]> = {
    categories: [
      { id: 1, slug: "vehicles", name: "Vehicles", category_key: "VEHICLES_MOBILITY", node_kind: "GROUP", active: 1, sort: 1 },
      { id: 2, slug: "cars", name: "Passenger Cars", category_key: "VEHICLE_PASSENGER_CAR", node_kind: "LEAF", parent_id: 1, active: 1, sort: 2 },
      { id: 3, slug: "pickups", name: "Pickups", category_key: "VEHICLE_PICKUP", node_kind: "LEAF", parent_id: 1, active: 1, sort: 3 },
      { id: 4, slug: "phones", name: "Smartphones", category_key: "PHONE_SMARTPHONE", node_kind: "LEAF", parent_id: 10, active: 1, sort: 4 },
    ],
    pi_category_schema_versions: [
      { id: 1, category_id: 2, schema_key: "VEHICLE_V1", status: "ACTIVE", version: 1 },
      { id: 2, category_id: 3, schema_key: "VEHICLE_PICKUP_V1", status: "ACTIVE", version: 1 },
      { id: 3, category_id: 4, schema_key: "PHONE_V1", status: "ACTIVE", version: 1 },
    ],
    pi_attribute_definitions: [
      { id: 1, attribute_key: "MAKE", data_type: "TEXT", filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 1, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
      { id: 2, attribute_key: "MODEL", data_type: "TEXT", filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 2, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
      { id: 3, attribute_key: "MODEL_YEAR", data_type: "INTEGER", filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 3, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
      { id: 4, attribute_key: "DRIVETRAIN", data_type: "ENUM", filter_class: "SECONDARY", display_group: "TECHNICAL", display_order: 4, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
      { id: 5, attribute_key: "ODOMETER_KM", data_type: "MEASUREMENT", filter_class: "PRIMARY", display_group: "TECHNICAL", display_order: 5, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
      { id: 6, attribute_key: "VIN", data_type: "IDENTIFIER", filter_class: "NONE", display_group: "IDENTITY", display_order: 6, active: 1, privacy_policy_key: "VEHICLE_IDENTIFIER_CLASSIFIED" },
      { id: 7, attribute_key: "BRAND", data_type: "TEXT", filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 1, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
      { id: 8, attribute_key: "STORAGE_GB", data_type: "INTEGER", filter_class: "PRIMARY", display_group: "TECHNICAL", display_order: 2, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
      { id: 9, attribute_key: "RAM_GB", data_type: "INTEGER", filter_class: "SECONDARY", display_group: "TECHNICAL", display_order: 3, active: 1, privacy_policy_key: "PRODUCT_PUBLIC" },
    ],
    pi_attribute_definition_versions: [
      { id: 1, attribute_id: 1, version: 1, validation_json: "{}", canonical_unit: null },
      { id: 2, attribute_id: 2, version: 1, validation_json: "{}", canonical_unit: null },
      { id: 3, attribute_id: 3, version: 1, validation_json: '{"minimum":1900,"maximum":2100}', canonical_unit: null },
      { id: 4, attribute_id: 4, version: 1, validation_json: "{}", canonical_unit: null },
      { id: 5, attribute_id: 5, version: 1, validation_json: "{}", canonical_unit: "km" },
      { id: 6, attribute_id: 6, version: 1, validation_json: "{}", canonical_unit: null },
      { id: 7, attribute_id: 7, version: 1, validation_json: "{}", canonical_unit: null },
      { id: 8, attribute_id: 8, version: 1, validation_json: "{}", canonical_unit: "GB" },
      { id: 9, attribute_id: 9, version: 1, validation_json: "{}", canonical_unit: "GB" },
    ],
    pi_attribute_labels: [
      { attribute_id: 1, locale: "en", label: "Make" },
      { attribute_id: 2, locale: "en", label: "Model" },
      { attribute_id: 3, locale: "en", label: "Year" },
      { attribute_id: 4, locale: "en", label: "Drivetrain" },
      { attribute_id: 5, locale: "en", label: "Mileage" },
      { attribute_id: 6, locale: "en", label: "VIN" },
      { attribute_id: 7, locale: "en", label: "Brand" },
      { attribute_id: 8, locale: "en", label: "Storage" },
      { attribute_id: 9, locale: "en", label: "RAM" },
    ],
    pi_attribute_options: [
      { id: 1, attribute_id: 4, option_key: "4WD", sort_order: 1 },
      { id: 2, attribute_id: 4, option_key: "AWD", sort_order: 2 },
      { id: 3, attribute_id: 4, option_key: "FWD", sort_order: 3 },
    ],
    pi_attribute_option_labels: [
      { option_id: 1, locale: "en", label: "Four-Wheel Drive" },
      { option_id: 2, locale: "en", label: "All-Wheel Drive" },
      { option_id: 3, locale: "en", label: "Front-Wheel Drive" },
    ],
    pi_category_attributes: [
      { id: 1, category_id: 2, schema_version_id: 1, attribute_id: 1, attribute_version_id: 1, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 1 },
      { id: 2, category_id: 2, schema_version_id: 1, attribute_id: 2, attribute_version_id: 2, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 2 },
      { id: 3, category_id: 2, schema_version_id: 1, attribute_id: 3, attribute_version_id: 3, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 3 },
      { id: 4, category_id: 2, schema_version_id: 1, attribute_id: 4, attribute_version_id: 4, filter_class: "SECONDARY", display_group: "TECHNICAL", display_order: 4 },
      { id: 5, category_id: 2, schema_version_id: 1, attribute_id: 5, attribute_version_id: 5, filter_class: "PRIMARY", display_group: "TECHNICAL", display_order: 5 },
      { id: 6, category_id: 2, schema_version_id: 1, attribute_id: 6, attribute_version_id: 6, filter_class: "NONE", display_group: "IDENTITY", display_order: 6 },
      { id: 7, category_id: 4, schema_version_id: 3, attribute_id: 7, attribute_version_id: 7, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 1 },
      { id: 8, category_id: 4, schema_version_id: 3, attribute_id: 8, attribute_version_id: 8, filter_class: "PRIMARY", display_group: "TECHNICAL", display_order: 2 },
      { id: 9, category_id: 4, schema_version_id: 3, attribute_id: 9, attribute_version_id: 9, filter_class: "SECONDARY", display_group: "TECHNICAL", display_order: 3 },
    ],
    auctions: [
      { id: 101, title: "2020 Toyota Hilux 2.8 GD-6 4WD", current_price: 32000, start_price: 30000, reserve_price: 34500, product_category_id: 2, product_schema_version_id: 1, city: "Harare", condition: "used", status: "live", ends_at: "2030-01-01T00:00:00Z", images: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: 102, title: "2019 Ford Ranger Wildtrak 3.2 4WD", current_price: 28000, start_price: 25000, reserve_price: 29500, product_category_id: 3, product_schema_version_id: 2, city: "Bulawayo", condition: "used", status: "live", ends_at: "2030-01-01T00:00:00Z", images: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: 103, title: "Apple iPhone 15 Pro Max 256GB", current_price: 1100, start_price: 1000, product_category_id: 4, product_schema_version_id: 3, city: "Harare", condition: "like-new", status: "live", ends_at: "2030-01-01T00:00:00Z", images: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: 104, title: "Draft Secret Vehicle", current_price: 19000, start_price: 19000, product_category_id: 2, product_schema_version_id: 1, city: "Mutare", condition: "used", status: "draft", ends_at: "2030-01-01T00:00:00Z", images: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],
    vehicles: [
      { id: 501, auction_id: 101, make: "Toyota", model: "Hilux", variant: "GD-6", model_year: 2020, odometer_km: 85000, fuel_type: "DIESEL", drivetrain: "4WD", transmission: "AUTOMATIC", primary_exterior_colour: "WHITE", vin: "AHTBA3CD123456789", chassis_number: "CH-SECRET-99", registration_number: "ZAA-1122", engine_number: "1GD-998877" },
      { id: 502, auction_id: 102, make: "Ford", model: "Ranger", variant: "Wildtrak", model_year: 2019, odometer_km: 98000, fuel_type: "DIESEL", drivetrain: "4WD", transmission: "AUTOMATIC", primary_exterior_colour: "GREY", vin: "MNAUMFF50JW123456", cab_type: "DOUBLE_CAB" },
    ],
    vehicle_inspections: [
      { id: 601, vehicle_id: 501, version: 1, lifecycle: "REVIEWED", grade: "B", grade_score: 82, roadworthy: 1, odometer_km: 85000 },
      { id: 602, vehicle_id: 502, version: 1, lifecycle: "REVIEWED", grade: "A", grade_score: 91, roadworthy: 1, odometer_km: 98000 },
    ],
    vehicle_eligibility: [
      { id: 701, vehicle_id: 501, inspection_id: 601, version: 1, status: "ELIGIBLE" },
      { id: 702, vehicle_id: 502, inspection_id: 602, version: 1, status: "ELIGIBLE" },
    ],
    vehicle_inspection_findings: [],
    vehicle_documents: [],
    vehicle_history_events: [],
    vehicle_modifications: [],
    vehicle_equipment: [],
    pi_effective_facts: [],
    pi_fact_assertions: [],
    pi_vehicle_inspection_projection: [],
    pi_vehicle_public: [],
    pi_vehicle_document_public: [],
    product_intake_sessions: [],
    product_search_index: [],
    product_search_facet_values: [],
    pi_projection_outbox: [],
    saved_searches: [],
    saved_search_facets: [],
  };

  let nextId = 1000;
  return {
    data,
    async get(table: string, id: number | string) {
      return (data[table] ?? []).find((r) => String(r.id) === String(id) || (table === "product_search_index" && String(r.auction_id) === String(id))) ?? null;
    },
    async create(table: string, row: any) {
      if (!data[table]) data[table] = [];
      const id = row.id ?? ++nextId;
      const rec = { ...row, id };
      data[table].push(rec);
      return id;
    },
    async update(table: string, id: number | string, patch: any) {
      const list = data[table] ?? [];
      const idx = list.findIndex((r) => String(r.id) === String(id) || (table === "product_search_index" && String(r.auction_id) === String(id)));
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch };
        return true;
      }
      return false;
    },
    async remove(table: string, id: number | string) {
      const list = data[table] ?? [];
      const before = list.length;
      data[table] = list.filter((r) => String(r.id) !== String(id) && (table !== "product_search_index" || String(r.auction_id) !== String(id)));
      return data[table].length < before;
    },
    async list(table: string, queryStr: string) {
      const list = data[table] ?? [];
      const searchParams = new URLSearchParams(queryStr);
      let res = [...list];
      for (const [key, val] of searchParams.entries()) {
        const match = key.match(/^filter\[(\w+)\]\[\$(\w+)\]$/);
        if (match) {
          const [, col, op] = match;
          if (op === "eq") res = res.filter((r) => String(r[col]) === String(val));
          if (op === "gte") res = res.filter((r) => Number(r[col]) >= Number(val));
          if (op === "lte") res = res.filter((r) => Number(r[col]) <= Number(val));
          if (op === "is" && val.toUpperCase() === "NULL") res = res.filter((r) => r[col] == null || r[col] === "");
        }
      }
      const order = searchParams.get("order");
      if (order) {
        const primary = order.split(",")[0];
        const desc = primary.startsWith("-");
        const col = desc ? primary.slice(1) : primary;
        res.sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return desc ? (av < bv ? 1 : -1) : (av < bv ? -1 : 1);
        });
      }
      const offset = Number(searchParams.get("offset") ?? 0);
      const limit = Number(searchParams.get("limit") ?? 100);
      return res.slice(offset, offset + limit);
    },
  };
}

test("category filter metadata enforces category isolation", async () => {
  const store = createInMemoryStore();

  const vehicleFilters = await categoryFilterMetadata(store, "VEHICLE_PASSENGER_CAR");
  const vehicleAttrKeys = vehicleFilters.filters.map((f) => f.attributeKey);
  expect(vehicleAttrKeys).toContain("MAKE");
  expect(vehicleAttrKeys).toContain("MODEL");
  expect(vehicleAttrKeys).toContain("DRIVETRAIN");
  expect(vehicleAttrKeys).not.toContain("STORAGE_GB");
  expect(vehicleAttrKeys).not.toContain("RAM_GB");
  expect(vehicleAttrKeys).not.toContain("VIN");

  const phoneFilters = await categoryFilterMetadata(store, "PHONE_SMARTPHONE");
  const phoneAttrKeys = phoneFilters.filters.map((f) => f.attributeKey);
  expect(phoneAttrKeys).toContain("BRAND");
  expect(phoneAttrKeys).toContain("STORAGE_GB");
  expect(phoneAttrKeys).toContain("RAM_GB");
  expect(phoneAttrKeys).not.toContain("DRIVETRAIN");
  expect(phoneAttrKeys).not.toContain("ODOMETER_KM");
});

test("comparison handles same leaf, related leaves, and unrelated categories", async () => {
  const store = createInMemoryStore();

  const related = await productCompare(store, [101, 102]);
  expect(related.categoryRelationship).toBe("RELATED_FAMILY");
  expect(related.scope).toBe("RELATED_FAMILY");
  const powertrain = related.sections.find((s) => s.title === "Powertrain");
  expect(powertrain).toBeDefined();

  const unrelated = await productCompare(store, [101, 103]);
  expect(unrelated.categoryRelationship).toBe("UNRELATED");
  const sectionTitles = unrelated.sections.map((s) => s.title);
  expect(sectionTitles).toContain("Commercial");
  expect(sectionTitles).not.toContain("Powertrain");
  expect(sectionTitles).not.toContain("Configuration");
});

test("comparison truthful states and strict privacy protection", async () => {
  const store = createInMemoryStore();
  // Seed conflicted odometer fact on vehicle 501
  store.data.pi_effective_facts.push({
    id: 901,
    product_type: "VEHICLE",
    product_id: 501,
    attribute_id: 5,
    source_class: "INSPECTOR_VERIFIED",
    value_decimal: 85000,
    conflict_state: "PEER_CONFLICT",
  });

  const res = await productCompare(store, [101, 102]);
  const serialized = JSON.stringify(res);
  for (const secret of ["AHTBA3CD123456789", "MNAUMFF50JW123456", "CH-SECRET-99", "ZAA-1122", "1GD-998877", "34500", "29500"]) {
    expect(serialized).not.toContain(secret);
  }

  const allRows = res.sections.flatMap((s) => s.rows);
  expect(allRows.find((r) => r.attributeKey === "VIN")).toBeUndefined();

  const vinClassRow = allRows.find((r) => r.attributeKey === "VIN_CLASSIFICATION");
  expect(vinClassRow?.values[0].state).toBe("REDACTED");
  expect(vinClassRow?.values[0].rawValue).toBeNull();
  expect(vinClassRow?.values[0].displayValue).toBe("Recorded privately");

  const doorsRow = allRows.find((r) => r.attributeKey === "DOORS");
  expect(doorsRow?.values[0].state).toBe("UNKNOWN");
  expect(doorsRow?.values[0].rawValue).toBeNull();

  const cabRow = allRows.find((r) => r.attributeKey === "CAB_TYPE");
  expect(cabRow?.values[0].state).toBe("NOT_APPLICABLE");
  expect(cabRow?.values[1].state).toBe("KNOWN");

  const odoRow = allRows.find((r) => r.attributeKey === "ODOMETER_KM");
  expect(odoRow?.values[0].state).toBe("CONFLICTED");
  expect(odoRow?.values[1].state).toBe("KNOWN");
});

test("P0-03 comparison rejects invalid cardinality, duplicates, missing, and non-public listings", async () => {
  const store = createInMemoryStore();

  await expect(productCompare(store, [101])).rejects.toThrow(/at least 2/i);
  await expect(productCompare(store, [101, 102, 103, 104])).rejects.toThrow(/at most 3/i);
  await expect(productCompare(store, [101, 101])).rejects.toThrow(/distinct/i);
  await expect(productCompare(store, [101, 999999])).rejects.toThrow(/not found/i);
  await expect(productCompare(store, [101, 104])).rejects.toThrow(/not publicly available/i);

  store.data.auctions.push({
    id: 105,
    title: "Withdrawn Hilux",
    current_price: 21000,
    start_price: 21000,
    product_category_id: 2,
    product_schema_version_id: 1,
    city: "Harare",
    condition: "used",
    status: "withdrawn",
    ends_at: "2030-01-01T00:00:00Z",
    images: "[]",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  await expect(productCompare(store, [101, 105])).rejects.toThrow(/not publicly available/i);
});

test("P0-01 outbox consumer syncs search index, inspection changes, and removes withdrawn listings", async () => {
  const store = createInMemoryStore();
  await rebuildProductSearchIndex(store);

  // Draft listing 104 must NOT be present in search index
  expect(store.data.product_search_index.some((r) => r.auction_id === 104)).toBe(false);

  // Enqueue outbox events across multiple types
  store.data.auctions[0].current_price = 33500;
  store.data.vehicle_inspections[0].grade = "A";
  store.data.pi_projection_outbox.push(
    { id: 1, event_key: "search:auction:101:t1", product_type: "AUCTION", product_id: 101, event_type: "SEARCH_INDEX_REFRESH", payload: JSON.stringify({ auctionId: 101 }), occurred_at: "2026-01-02T00:00:00Z", published_at: null },
    { id: 2, event_key: "insp:501:t1", product_type: "VEHICLE", product_id: 501, event_type: "INSPECTION_PROJECTED", payload: JSON.stringify({ vehicleId: 501 }), occurred_at: "2026-01-02T00:01:00Z", published_at: null },
  );

  const drain1 = await consumeSearchProjectionOutbox(store);
  expect(drain1.processed).toBe(2);
  expect(drain1.refreshed).toBe(1);
  expect(store.data.pi_projection_outbox.every((e) => typeof e.published_at === "string" && e.published_at.length > 0)).toBe(true);

  const row101 = store.data.product_search_index.find((r) => r.auction_id === 101);
  expect(row101?.price).toBe(33500);
  expect(row101?.inspection_grade).toBe("A");

  // Transition 102 to withdrawn & verify outbox removal removes stale search + facet rows
  store.data.auctions[1].status = "withdrawn";
  store.data.pi_projection_outbox.push({
    id: 3,
    event_key: "search:auction:102:withdrawn",
    product_type: "AUCTION",
    product_id: 102,
    event_type: "SEARCH_INDEX_REFRESH",
    payload: JSON.stringify({ auctionId: 102 }),
    occurred_at: "2026-01-03T00:00:00Z",
    published_at: null,
  });
  const drain2 = await consumeSearchProjectionOutbox(store);
  expect(drain2.removed).toBe(1);
  expect(store.data.product_search_index.some((r) => r.auction_id === 102)).toBe(false);
  expect(store.data.product_search_facet_values.some((f) => f.auction_id === 102)).toBe(false);
});

test("P0-02 saved search ownership and facet normalization block cross-user & anonymous access", async () => {
  const store = createInMemoryStore();
  const sellerA: VehicleIdentity = { id: "user-a", username: "seller_a", admin: false };
  const sellerB: VehicleIdentity = { id: "user-b", username: "seller_b", admin: false };
  const admin: VehicleIdentity = { id: "admin-1", username: "admin", admin: true };

  // Anonymous denied
  await expect(saveOwnedSearch(store, null, { name: "Anon" })).rejects.toThrow(/Sign in/i);

  // Invalid operator & range rejected before saving
  await expect(
    saveOwnedSearch(store, sellerA, {
      name: "Bad Operator",
      facets: [{ attributeKey: "MAKE", operator: "DROP_TABLE", valueText: "Toyota" }],
    }),
  ).rejects.toThrow(/Unsupported facet operator/i);
  await expect(
    saveOwnedSearch(store, sellerA, {
      name: "Inverted Year",
      facets: [{ attributeKey: "YEAR", operator: "BETWEEN", minNumeric: 2024, maxNumeric: 2018 }],
    }),
  ).rejects.toThrow(/valueMin cannot exceed valueMax/i);

  const saved = await saveOwnedSearch(store, sellerA, {
    name: "Diesel Hilux 2018+",
    query: "Hilux",
    facets: [
      { attributeKey: "MAKE", operator: "EQ", optionValue: "Toyota" },
      { attributeKey: "YEAR", operator: "MIN", minNumeric: 2018 },
    ],
  });
  expect(saved.user).toBe("user-a");
  expect(saved.facets.length).toBe(2);
  expect(saved.facets[0].value_text).toBe("Toyota");
  expect(saved.facets[1].attribute_key).toBe("MODEL_YEAR");
  expect(saved.facets[1].value_min).toBe(2018);

  // Owner B cannot read facets, overwrite, toggle alerts, or delete
  await expect(getOwnedSavedSearchFacets(store, sellerB, saved.id)).rejects.toThrow(ProductIntelligenceError);
  await expect(saveOwnedSearch(store, sellerB, { id: saved.id, name: "Hijack" })).rejects.toThrow(/Not authorized/i);
  await expect(setOwnedSavedSearchAlerts(store, sellerB, saved.id, false)).rejects.toThrow(/Not authorized/i);
  await expect(deleteOwnedSavedSearch(store, sellerB, saved.id)).rejects.toThrow(/Not authorized/i);

  // Seller B list returns 0 rows
  expect((await listOwnedSavedSearches(store, sellerB)).length).toBe(0);

  // Owner A and Admin succeed
  expect((await getOwnedSavedSearchFacets(store, sellerA, saved.id)).length).toBe(2);
  expect((await getOwnedSavedSearchFacets(store, admin, saved.id)).length).toBe(2);
  const toggled = await setOwnedSavedSearchAlerts(store, sellerA, saved.id, false);
  expect(toggled.alerts).toBe(0);
  expect(await deleteOwnedSavedSearch(store, sellerA, saved.id)).toBe(true);
  await expect(getOwnedSavedSearchFacets(store, sellerA, saved.id)).rejects.toThrow(/not found/i);
});

test("P1-04 search validation, full-candidate pagination, deterministic ordering, and >1,000 rebuild", async () => {
  const store = createInMemoryStore();

  // Seed 1,050 additional live & draft auctions (same price groups to test deterministic auction_id tie-breaking)
  store.data.auctions = [];
  store.data.vehicles = [];
  for (let i = 1; i <= 1050; i++) {
    const isDraft = i === 1050;
    const isHilux = i <= 60;
    store.data.auctions.push({
      id: 2000 + i,
      title: isHilux ? `Toyota Hilux Batch Lot ${i}` : `Other Lot ${i}`,
      description: isHilux ? "Diesel double cab pickup" : "General lot",
      current_price: isHilux ? 25000 : 10000 + (i % 5) * 100,
      start_price: 9000,
      product_category_id: isHilux ? 2 : 4,
      product_schema_version_id: isHilux ? 1 : 3,
      city: isHilux && i % 2 === 0 ? "Harare" : "Bulawayo",
      condition: "used",
      status: isDraft ? "draft" : "live",
      ends_at: "2030-01-01T00:00:00Z",
      images: "[]",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    if (isHilux) {
      store.data.vehicles.push({
        id: 5000 + i,
        auction_id: 2000 + i,
        make: "Toyota",
        model: "Hilux",
        model_year: 2021,
        odometer_km: 50000,
        fuel_type: "DIESEL",
        drivetrain: "4WD",
        transmission: "AUTOMATIC",
      });
    }
  }

  const rebuilt = await rebuildProductSearchIndex(store, 250);
  expect(rebuilt.count).toBe(1049);
  expect(rebuilt.removed).toBe(1);
  expect(store.data.product_search_index.length).toBe(1049);

  // Pre-pagination filtering + exact total across >250 rows + deterministic auction_id tie-breaker
  const p1 = await queryProductSearch(store, {
    search: "Hilux Diesel",
    facets: { DRIVETRAIN: "4WD" },
    order: "price_asc",
    limit: 10,
    offset: 10,
  });
  expect(p1.total).toBe(60);
  expect(p1.items.length).toBe(10);
  expect(p1.items[0].auction_id).toBe(2011);
  expect(p1.items[9].auction_id).toBe(2020);
  expect(p1.facetOptions.make[0]).toEqual({ value: "Toyota", label: "Toyota", count: 60 });

  // Input validation rejects invalid bounds/status/order/length
  await expect(queryProductSearch(store, { minPrice: 20000, maxPrice: 10000 })).rejects.toThrow(SearchValidationError);
  await expect(queryProductSearch(store, { minYear: 2024, maxYear: 2018 })).rejects.toThrow(SearchValidationError);
  await expect(queryProductSearch(store, { limit: 500 })).rejects.toThrow(SearchValidationError);
  await expect(queryProductSearch(store, { offset: -1 })).rejects.toThrow(SearchValidationError);
  await expect(queryProductSearch(store, { status: "draft" })).rejects.toThrow(SearchValidationError);
  await expect(queryProductSearch(store, { order: "bogus" as any })).rejects.toThrow(SearchValidationError);
  await expect(queryProductSearch(store, { search: "x".repeat(201) })).rejects.toThrow(SearchValidationError);
}, 25000);

test("P0-A search outbox failure handling, deletion unsuppression, 503 resilience, and replay idempotency", async () => {
  const store = createInMemoryStore();
  await rebuildProductSearchIndex(store, 250);

  // 1. Index deletion failure prevents outbox acknowledgement
  // Transition auction 101 to withdrawn
  store.data.auctions[0].status = "withdrawn";
  store.data.pi_projection_outbox.push({
    id: 901,
    event_key: "search:auction:101:withdrawn-fail",
    product_type: "AUCTION",
    product_id: 101,
    event_type: "SEARCH_INDEX_REFRESH",
    payload: JSON.stringify({ auctionId: 101 }),
    occurred_at: "2026-01-04T00:00:00Z",
    published_at: null,
  });

  // Inject failure into store.remove for product_search_index
  const origRemove = store.remove;
  let failIndexDelete = true;
  store.remove = async (table: string, id: number | string) => {
    if (table === "product_search_index" && failIndexDelete) {
      return false; // simulate deletion failure
    }
    return origRemove ? origRemove(table, id) : true;
  };

  const drainFail = await consumeSearchProjectionOutbox(store);
  expect(drainFail.failed).toBe(1);
  const outboxEvt1 = store.data.pi_projection_outbox.find((e) => e.id === 901);
  expect(outboxEvt1?.published_at).toBeNull(); // Event MUST NOT be acknowledged on failed deletion!

  // Now restore store.remove and retry — outbox consumer must succeed and acknowledge
  failIndexDelete = false;
  const drainRetry = await consumeSearchProjectionOutbox(store);
  expect(drainRetry.removed).toBe(1);
  const ackedEvt1 = store.data.pi_projection_outbox.find((e) => e.id === 901);
  expect(typeof ackedEvt1?.published_at).toBe("string");

  // 2. Pending outbox read failure (outage / 503) propagates error instead of treating queue as empty
  const origList = store.list;
  store.list = async (table: string, queryStr: string) => {
    if (table === "pi_projection_outbox") {
      throw new Error("TrailBase 503 Service Unavailable");
    }
    return origList(table, queryStr);
  };
  await expect(consumeSearchProjectionOutbox(store)).rejects.toThrow("TrailBase 503 Service Unavailable");
  store.list = origList;

  // 3. Transient 503 error during vehicle lookup preserves outbox event for retry
  store.data.pi_projection_outbox.push({
    id: 902,
    event_key: "fact:assertion:501:transient",
    product_type: "VEHICLE",
    product_id: 501,
    event_type: "FACT_ASSERTED",
    payload: JSON.stringify({ assertionId: 1 }),
    occurred_at: "2026-01-04T01:00:00Z",
    published_at: null,
  });

  const origGet = store.get;
  let transientVehFail = true;
  store.get = async (table: string, id: number | string) => {
    if (table === "vehicles" && id === 501 && transientVehFail) {
      throw new Error("TrailBase 503 Connection Timeout");
    }
    return origGet(table, id);
  };

  const drainTransient = await consumeSearchProjectionOutbox(store);
  expect(drainTransient.failed).toBe(1);
  const outboxEvt2 = store.data.pi_projection_outbox.find((e) => e.id === 902);
  expect(outboxEvt2?.published_at).toBeNull(); // Must remain pending!

  // Retry when vehicle service recovers
  transientVehFail = false;
  const drainRecovered = await consumeSearchProjectionOutbox(store);
  expect(drainRecovered.processed).toBe(1);
  const ackedEvt2 = store.data.pi_projection_outbox.find((e) => e.id === 902);
  expect(typeof ackedEvt2?.published_at).toBe("string");
  store.get = origGet;

  // 4. Repeated delivery / idempotent replay of already published event
  const replayDrain = await consumeSearchProjectionOutbox(store);
  expect(replayDrain.processed).toBe(0);
  expect(replayDrain.failed).toBe(0);
});

test("P0-B mandatory 11-case projection reliability, mutation verification, and fault-injection suite", async () => {
  const store = createInMemoryStore();
  await rebuildProductSearchIndex(store, 250);

  // Clear outbox for isolated test sequence
  store.data.pi_projection_outbox = [];

  // =========================================================================
  // CASE 1: product_search_index update resolves false
  // Assert: outbox event remains unacknowledged (published_at is null), retry recovers
  // =========================================================================
  {
    store.data.pi_projection_outbox.push({
      id: 911,
      event_key: "case1:psi-update-false",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    const origUpdate = store.update;
    let failPsiUpdate = true;
    store.update = async (table: string, id: number | string, patch: any) => {
      if (table === "product_search_index" && failPsiUpdate) {
        return false; // Fault injection: update fails
      }
      return origUpdate(table, id, patch);
    };

    const drain1 = await consumeSearchProjectionOutbox(store);
    expect(drain1.failed).toBe(1);
    const evt1 = store.data.pi_projection_outbox.find((e) => e.id === 911);
    expect(evt1?.published_at).toBeNull(); // Case 8: Event remains unacknowledged!

    // Case 9: Recovery
    failPsiUpdate = false;
    const drain1Retry = await consumeSearchProjectionOutbox(store);
    expect(drain1Retry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 911)?.published_at).toBe("string");
    store.update = origUpdate;
  }

  // =========================================================================
  // CASE 2: Search-index create returns null and fallback update resolves false
  // Assert: outbox event remains unacknowledged, retry recovers
  // =========================================================================
  {
    // Remove auction 102 from product_search_index so it must be created
    store.data.product_search_index = store.data.product_search_index.filter((r) => r.auction_id !== 102);

    store.data.pi_projection_outbox.push({
      id: 912,
      event_key: "case2:psi-create-null-fallback-false",
      product_type: "AUCTION",
      product_id: 102,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 102 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    const origCreate = store.create;
    const origUpdate = store.update;
    let failPsiCreate = true;
    let failPsiUpdate = true;

    store.create = async (table: string, row: any) => {
      if (table === "product_search_index" && failPsiCreate) {
        return null; // Fault injection: create returns null
      }
      return origCreate(table, row);
    };
    store.update = async (table: string, id: number | string, patch: any) => {
      if (table === "product_search_index" && failPsiUpdate) {
        return false; // Fault injection: fallback update also resolves false
      }
      return origUpdate(table, id, patch);
    };

    const drain2 = await consumeSearchProjectionOutbox(store);
    expect(drain2.failed).toBe(1);
    const evt2 = store.data.pi_projection_outbox.find((e) => e.id === 912);
    expect(evt2?.published_at).toBeNull(); // Case 8: Event remains unacknowledged!

    // Case 9: Recovery
    failPsiCreate = false;
    failPsiUpdate = false;
    const drain2Retry = await consumeSearchProjectionOutbox(store);
    expect(drain2Retry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 912)?.published_at).toBe("string");
    expect(store.data.product_search_index.some((r) => r.auction_id === 102)).toBe(true);

    store.create = origCreate;
    store.update = origUpdate;
  }

  // =========================================================================
  // CASE 3: Facet update resolves false
  // Assert: outbox event remains unacknowledged, retry recovers
  // =========================================================================
  {
    store.data.pi_projection_outbox.push({
      id: 913,
      event_key: "case3:facet-update-false",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    const origUpdate = store.update;
    let failFacetUpdate = true;
    store.update = async (table: string, id: number | string, patch: any) => {
      if (table === "product_search_facet_values" && failFacetUpdate) {
        return false; // Fault injection: facet update fails
      }
      return origUpdate(table, id, patch);
    };

    const drain3 = await consumeSearchProjectionOutbox(store);
    expect(drain3.failed).toBe(1);
    const evt3 = store.data.pi_projection_outbox.find((e) => e.id === 913);
    expect(evt3?.published_at).toBeNull(); // Case 8: Event remains unacknowledged!

    // Case 9: Recovery
    failFacetUpdate = false;
    const drain3Retry = await consumeSearchProjectionOutbox(store);
    expect(drain3Retry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 913)?.published_at).toBe("string");
    store.update = origUpdate;
  }

  // =========================================================================
  // CASE 4: Facet create returns null
  // Assert: outbox event remains unacknowledged, retry recovers
  // =========================================================================
  {
    // Clear facets for auction 101 to force creation of new facet records
    store.data.product_search_facet_values = store.data.product_search_facet_values.filter(
      (f) => f.auction_id !== 101,
    );

    store.data.pi_projection_outbox.push({
      id: 914,
      event_key: "case4:facet-create-null",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    const origCreate = store.create;
    let failFacetCreate = true;
    store.create = async (table: string, row: any) => {
      if (table === "product_search_facet_values" && failFacetCreate) {
        return null; // Fault injection: facet create returns null
      }
      return origCreate(table, row);
    };

    const drain4 = await consumeSearchProjectionOutbox(store);
    expect(drain4.failed).toBe(1);
    const evt4 = store.data.pi_projection_outbox.find((e) => e.id === 914);
    expect(evt4?.published_at).toBeNull(); // Case 8: Event remains unacknowledged!

    // Case 9: Recovery
    failFacetCreate = false;
    const drain4Retry = await consumeSearchProjectionOutbox(store);
    expect(drain4Retry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 914)?.published_at).toBe("string");
    expect(store.data.product_search_facet_values.some((f) => f.auction_id === 101)).toBe(true);
    store.create = origCreate;
  }

  // =========================================================================
  // CASE 5: Stale-facet delete resolves false
  // Assert: outbox event remains unacknowledged, retry recovers
  // =========================================================================
  {
    // Inject a stale facet value that is not part of auction 101's desired facets
    const staleFacetId = 9991;
    store.data.product_search_facet_values.push({
      id: staleFacetId,
      auction_id: 101,
      category_id: 1,
      attribute_id: 999,
      attribute_key: "OLD_OBSOLETE_FACET",
      filter_class: "SINGLE_SELECT",
      data_type: "STRING",
      value_text: "OBSOLETE",
      indexed_at: "2026-01-01T00:00:00Z",
    });

    store.data.pi_projection_outbox.push({
      id: 915,
      event_key: "case5:stale-facet-delete-false",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    const origRemove = store.remove;
    let failStaleRemove = true;
    store.remove = async (table: string, id: number | string) => {
      if (table === "product_search_facet_values" && id === staleFacetId && failStaleRemove) {
        return false; // Fault injection: delete resolves false (row still remains in store)
      }
      return origRemove ? origRemove(table, id) : true;
    };

    const drain5 = await consumeSearchProjectionOutbox(store);
    expect(drain5.failed).toBe(1);
    const evt5 = store.data.pi_projection_outbox.find((e) => e.id === 915);
    expect(evt5?.published_at).toBeNull(); // Case 8: Event remains unacknowledged!

    // Case 9: Recovery
    failStaleRemove = false;
    const drain5Retry = await consumeSearchProjectionOutbox(store);
    expect(drain5Retry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 915)?.published_at).toBe("string");
    // Verify stale facet is removed
    expect(store.data.product_search_facet_values.some((f) => f.id === staleFacetId)).toBe(false);
    store.remove = origRemove;
  }

  // =========================================================================
  // CASE 6: Stale-facet delete throws a TrailBase error
  // Assert: outbox event remains unacknowledged, retry recovers
  // =========================================================================
  {
    const staleFacetId2 = 9992;
    store.data.product_search_facet_values.push({
      id: staleFacetId2,
      auction_id: 101,
      category_id: 1,
      attribute_id: 999,
      attribute_key: "SECOND_OBSOLETE_FACET",
      filter_class: "SINGLE_SELECT",
      data_type: "STRING",
      value_text: "OBSOLETE2",
      indexed_at: "2026-01-01T00:00:00Z",
    });

    store.data.pi_projection_outbox.push({
      id: 916,
      event_key: "case6:stale-facet-delete-throws",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    const origRemove = store.remove;
    let throwStaleRemove = true;
    store.remove = async (table: string, id: number | string) => {
      if (table === "product_search_facet_values" && id === staleFacetId2 && throwStaleRemove) {
        throw new Error("TrailBase 500 Internal Server Error during facet deletion");
      }
      return origRemove ? origRemove(table, id) : true;
    };

    const drain6 = await consumeSearchProjectionOutbox(store);
    expect(drain6.failed).toBe(1);
    const evt6 = store.data.pi_projection_outbox.find((e) => e.id === 916);
    expect(evt6?.published_at).toBeNull(); // Case 8: Event remains unacknowledged!

    // Case 9: Recovery
    throwStaleRemove = false;
    const drain6Retry = await consumeSearchProjectionOutbox(store);
    expect(drain6Retry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 916)?.published_at).toBe("string");
    expect(store.data.product_search_facet_values.some((f) => f.id === staleFacetId2)).toBe(false);
    store.remove = origRemove;
  }

  // =========================================================================
  // CASE 7: Required supporting fact or intake-session read fails
  // Subcase 7A: product_intake_sessions read fails
  // Subcase 7B: pi_effective_facts read fails
  // Subcase 7C: pi_attribute_definitions read fails
  // Subcase 7D: categories read fails
  // Assert: outbox event remains unacknowledged in each, retry recovers
  // =========================================================================
  {
    const origList = store.list;
    const origGet = store.get;

    // 7A: intake sessions list throws
    store.data.pi_projection_outbox.push({
      id: 9171,
      event_key: "case7a:intake-sessions-read-fail",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    let failIntakeList = true;
    store.list = async (table: string, queryStr: string) => {
      if (table === "product_intake_sessions" && failIntakeList) {
        throw new Error("TrailBase 503 Service Unavailable: product_intake_sessions");
      }
      return origList(table, queryStr);
    };

    const drain7A = await consumeSearchProjectionOutbox(store);
    expect(drain7A.failed).toBe(1);
    const evt7A = store.data.pi_projection_outbox.find((e) => e.id === 9171);
    expect(evt7A?.published_at).toBeNull();

    failIntakeList = false;
    const drain7ARetry = await consumeSearchProjectionOutbox(store);
    expect(drain7ARetry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 9171)?.published_at).toBe("string");

    // 7B: pi_effective_facts read fails
    store.data.pi_projection_outbox.push({
      id: 9172,
      event_key: "case7b:effective-facts-read-fail",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    let failFactsList = true;
    store.list = async (table: string, queryStr: string) => {
      if (table === "pi_effective_facts" && failFactsList) {
        throw new Error("TrailBase 503 Service Unavailable: pi_effective_facts");
      }
      return origList(table, queryStr);
    };

    const drain7B = await consumeSearchProjectionOutbox(store);
    expect(drain7B.failed).toBe(1);
    const evt7B = store.data.pi_projection_outbox.find((e) => e.id === 9172);
    expect(evt7B?.published_at).toBeNull();

    failFactsList = false;
    const drain7BRetry = await consumeSearchProjectionOutbox(store);
    expect(drain7BRetry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 9172)?.published_at).toBe("string");

    // 7C: pi_attribute_definitions read fails
    store.data.pi_projection_outbox.push({
      id: 9173,
      event_key: "case7c:definitions-read-fail",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    let failDefsList = true;
    store.list = async (table: string, queryStr: string) => {
      if (table === "pi_attribute_definitions" && failDefsList) {
        throw new Error("TrailBase 503 Service Unavailable: pi_attribute_definitions");
      }
      return origList(table, queryStr);
    };

    const drain7C = await consumeSearchProjectionOutbox(store);
    expect(drain7C.failed).toBe(1);
    const evt7C = store.data.pi_projection_outbox.find((e) => e.id === 9173);
    expect(evt7C?.published_at).toBeNull();

    failDefsList = false;
    const drain7CRetry = await consumeSearchProjectionOutbox(store);
    expect(drain7CRetry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 9173)?.published_at).toBe("string");

    // 7D: categories read fails
    store.data.pi_projection_outbox.push({
      id: 9174,
      event_key: "case7d:categories-read-fail",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    let failCatGet = true;
    store.get = async (table: string, id: number | string) => {
      if (table === "categories" && failCatGet) {
        throw new Error("TrailBase 503 Service Unavailable: categories");
      }
      return origGet(table, id);
    };

    const drain7D = await consumeSearchProjectionOutbox(store);
    expect(drain7D.failed).toBe(1);
    const evt7D = store.data.pi_projection_outbox.find((e) => e.id === 9174);
    expect(evt7D?.published_at).toBeNull();

    failCatGet = false;
    const drain7DRetry = await consumeSearchProjectionOutbox(store);
    expect(drain7DRetry.processed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 9174)?.published_at).toBe("string");

    store.list = origList;
    store.get = origGet;
  }

  // =========================================================================
  // CASE 10: Duplicate replay produces no corruption or false duplicate
  // Assert: outbox replay yields processed: 0, failed: 0; manual redelivery maintains uniqueness
  // =========================================================================
  {
    // A: Consuming with all existing events already acknowledged
    const replay1 = await consumeSearchProjectionOutbox(store);
    expect(replay1.processed).toBe(0);
    expect(replay1.failed).toBe(0);

    // B: Redeliver event 911 (reset published_at to null)
    const evt1 = store.data.pi_projection_outbox.find((e) => e.id === 911);
    if (evt1) evt1.published_at = null;

    const psiRowsBefore = store.data.product_search_index.filter((r) => r.auction_id === 101);
    expect(psiRowsBefore.length).toBe(1);

    const replay2 = await consumeSearchProjectionOutbox(store);
    expect(replay2.processed).toBe(1);
    expect(replay2.failed).toBe(0);

    // Assert no duplicate in product_search_index
    const psiRowsAfter = store.data.product_search_index.filter((r) => r.auction_id === 101);
    expect(psiRowsAfter.length).toBe(1);

    // Assert facet uniqueness (no duplicate facets for same attribute)
    const facetKeys = store.data.product_search_facet_values
      .filter((f) => f.auction_id === 101)
      .map((f) => f.attribute_key);
    const uniqueFacetKeys = new Set(facetKeys);
    expect(facetKeys.length).toBe(uniqueFacetKeys.size);
  }

  // =========================================================================
  // CASE 11: Withdrawn/private listings remain excluded from public search even during projection recovery
  // =========================================================================
  {
    // Transition auction 101 to withdrawn
    const auction101 = store.data.auctions.find((a) => a.id === 101);
    expect(auction101).toBeDefined();
    auction101.status = "withdrawn";

    // Queue withdrawal event
    store.data.pi_projection_outbox.push({
      id: 918,
      event_key: "case11:withdrawn-projection-recovery",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    // Inject temporary failure during removal (simulate outage during recovery)
    const origRemove = store.remove;
    let failRemoval = true;
    store.remove = async (table: string, id: number | string) => {
      if (failRemoval && (table === "product_search_index" || table === "product_search_facet_values")) {
        return false;
      }
      return origRemove ? origRemove(table, id) : true;
    };

    const drain11Fail = await consumeSearchProjectionOutbox(store);
    expect(drain11Fail.failed).toBe(1);
    const evt11 = store.data.pi_projection_outbox.find((e) => e.id === 918);
    expect(evt11?.published_at).toBeNull(); // Remains pending during recovery

    // Verify: even though recovery is pending/failed, querying public search NEVER returns auction 101
    const searchDuringRecovery = await queryProductSearch(store, { search: "Hilux" });
    expect(searchDuringRecovery.items.some((item) => item.auction_id === 101)).toBe(false);

    // Now recovery succeeds
    failRemoval = false;
    const drain11Recover = await consumeSearchProjectionOutbox(store);
    expect(drain11Recover.removed).toBe(1);
    expect(typeof store.data.pi_projection_outbox.find((e) => e.id === 918)?.published_at).toBe("string");

    // Verify still excluded from public search after recovery
    const searchAfterRecovery = await queryProductSearch(store, { search: "Hilux" });
    expect(searchAfterRecovery.items.some((item) => item.auction_id === 101)).toBe(false);
    expect(store.data.product_search_index.some((r) => r.auction_id === 101)).toBe(false);
    expect(store.data.product_search_facet_values.some((f) => f.auction_id === 101)).toBe(false);

    store.remove = origRemove;
  }

  // =========================================================================
  // REQUIREMENT D: Fail closed when store lacks required removal capability
  // =========================================================================
  {
    // A: Stale facet exists, but store.remove is undefined
    const storeNoRemove = createInMemoryStore();
    await rebuildProductSearchIndex(storeNoRemove, 250);
    delete (storeNoRemove as any).remove;

    // Inject stale facet
    storeNoRemove.data.product_search_facet_values.push({
      id: 8881,
      auction_id: 101,
      category_id: 1,
      attribute_id: 888,
      attribute_key: "OBSOLETE_NO_REMOVE",
      filter_class: "SINGLE_SELECT",
      data_type: "STRING",
      value_text: "OBSOLETE",
      indexed_at: "2026-01-01T00:00:00Z",
    });

    storeNoRemove.data.pi_projection_outbox.push({
      id: 919,
      event_key: "case-d:no-remove-stale-facet",
      product_type: "AUCTION",
      product_id: 101,
      event_type: "SEARCH_INDEX_REFRESH",
      payload: JSON.stringify({ auctionId: 101 }),
      occurred_at: "2026-01-04T00:00:00Z",
      published_at: null,
    });

    const drainNoRemove = await consumeSearchProjectionOutbox(storeNoRemove);
    expect(drainNoRemove.failed).toBe(1);
    const evtNoRemove = storeNoRemove.data.pi_projection_outbox.find((e) => e.id === 919);
    expect(evtNoRemove?.published_at).toBeNull(); // Fails closed, leaves outbox pending!
  }
});
