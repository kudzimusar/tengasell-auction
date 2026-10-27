// TENGASELL-PI-01E / DISC-01, DISC-02, DISC-03, DISC-04 unit tests
import { expect, test } from "bun:test";
import { categoryFilterMetadata, productCompare } from "./product-intelligence";
import { refreshAuctionSearch, rebuildProductSearchIndex, queryProductSearch } from "./search-indexing";
import type { VehicleStore } from "./vehicle-authority";

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
      // Vehicle Passenger Car bindings
      { id: 1, category_id: 2, schema_version_id: 1, attribute_id: 1, attribute_version_id: 1, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 1 },
      { id: 2, category_id: 2, schema_version_id: 1, attribute_id: 2, attribute_version_id: 2, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 2 },
      { id: 3, category_id: 2, schema_version_id: 1, attribute_id: 3, attribute_version_id: 3, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 3 },
      { id: 4, category_id: 2, schema_version_id: 1, attribute_id: 4, attribute_version_id: 4, filter_class: "SECONDARY", display_group: "TECHNICAL", display_order: 4 },
      { id: 5, category_id: 2, schema_version_id: 1, attribute_id: 5, attribute_version_id: 5, filter_class: "PRIMARY", display_group: "TECHNICAL", display_order: 5 },
      { id: 6, category_id: 2, schema_version_id: 1, attribute_id: 6, attribute_version_id: 6, filter_class: "NONE", display_group: "IDENTITY", display_order: 6 },
      // Phone bindings
      { id: 7, category_id: 4, schema_version_id: 3, attribute_id: 7, attribute_version_id: 7, filter_class: "PRIMARY", display_group: "IDENTITY", display_order: 1 },
      { id: 8, category_id: 4, schema_version_id: 3, attribute_id: 8, attribute_version_id: 8, filter_class: "PRIMARY", display_group: "TECHNICAL", display_order: 2 },
      { id: 9, category_id: 4, schema_version_id: 3, attribute_id: 9, attribute_version_id: 9, filter_class: "SECONDARY", display_group: "TECHNICAL", display_order: 3 },
    ],
    auctions: [
      { id: 101, title: "2020 Toyota Hilux 2.8 GD-6 4WD", current_price: 32000, start_price: 30000, product_category_id: 2, product_schema_version_id: 1, city: "Harare", condition: "used", status: "live", ends_at: "2030-01-01T00:00:00Z", images: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: 102, title: "2019 Ford Ranger Wildtrak 3.2 4WD", current_price: 28000, start_price: 25000, product_category_id: 3, product_schema_version_id: 2, city: "Bulawayo", condition: "used", status: "live", ends_at: "2030-01-01T00:00:00Z", images: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: 103, title: "Apple iPhone 15 Pro Max 256GB", current_price: 1100, start_price: 1000, product_category_id: 4, product_schema_version_id: 3, city: "Harare", condition: "like-new", status: "live", ends_at: "2030-01-01T00:00:00Z", images: "[]", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ],
    vehicles: [
      { id: 501, auction_id: 101, make: "Toyota", model: "Hilux", variant: "GD-6", model_year: 2020, odometer_km: 85000, fuel_type: "DIESEL", drivetrain: "4WD", transmission: "AUTOMATIC", primary_exterior_colour: "WHITE", vin: "AHTBA3CD123456789" },
      { id: 502, auction_id: 102, make: "Ford", model: "Ranger", variant: "Wildtrak", model_year: 2019, odometer_km: 98000, fuel_type: "DIESEL", drivetrain: "4WD", transmission: "AUTOMATIC", primary_exterior_colour: "GREY", vin: "MNAUMFF50JW123456" },
    ],
    pi_effective_facts: [],
    pi_vehicle_inspection_projection: [
      { vehicle_id: 501, inspection_status: "COMPLETED", inspection_grade: "B", roadworthy: 1 },
      { vehicle_id: 502, inspection_status: "COMPLETED", inspection_grade: "A", roadworthy: 1 },
    ],
    product_search_index: [],
    product_search_facet_values: [],
  };

  let nextId = 1000;
  return {
    data,
    async get(table: string, id: number | string) {
      return (data[table] ?? []).find((r) => String(r.id) === String(id) || String(r.auction_id) === String(id)) ?? null;
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
      const idx = list.findIndex((r) => String(r.id) === String(id) || String(r.auction_id) === String(id));
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch };
        return true;
      }
      return false;
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
        }
      }
      const limit = Number(searchParams.get("limit") ?? 100);
      return res.slice(0, limit);
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
  expect(vehicleAttrKeys).not.toContain("VIN"); // filter_class === 'NONE' is excluded

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

  // Same leaf comparison: two passenger vehicles
  const sameLeaf = await productCompare(store, [101, 102]);
  expect(sameLeaf.categoryRelationship).toBe("RELATED_FAMILY"); // Car and Pickup share VEHICLE_ family
  const powertrain = sameLeaf.sections.find((s) => s.title === "Powertrain");
  expect(powertrain).toBeDefined();

  // Unrelated comparison: Vehicle and Phone
  const unrelated = await productCompare(store, [101, 103]);
  expect(unrelated.categoryRelationship).toBe("UNRELATED");
  // Unrelated categories should only compare Commercial/universal rows, never phone RAM vs car drivetrain!
  const sectionTitles = unrelated.sections.map((s) => s.title);
  expect(sectionTitles).toContain("Commercial");
  expect(sectionTitles).not.toContain("Powertrain");
  expect(sectionTitles).not.toContain("Configuration");
});

test("comparison truthful states and privacy protection", async () => {
  const store = createInMemoryStore();
  const res = await productCompare(store, [101]);

  // VIN must never be raw in comparison!
  const identitySection = res.sections.find((s) => s.title === "Identity");
  const vinRow = res.sections.flatMap((s) => s.rows).find((r) => r.attributeKey === "VIN");
  expect(vinRow).toBeUndefined(); // Raw VIN row is never present

  const vinClassificationRow = res.sections.flatMap((s) => s.rows).find((r) => r.attributeKey === "VIN_CLASSIFICATION");
  expect(vinClassificationRow?.values[0].state).toBe("REDACTED");
  expect(vinClassificationRow?.values[0].displayValue).toBe("Recorded privately");

  // Missing values are truthfully UNKNOWN, never converted to 0 or False
  const doorsRow = res.sections.flatMap((s) => s.rows).find((r) => r.attributeKey === "DOORS");
  expect(doorsRow?.values[0].state).toBe("UNKNOWN");
  expect(doorsRow?.values[0].displayValue).toBe("Not provided");
  expect(doorsRow?.values[0].rawValue).toBeNull();
});

test("search index rebuild is non-authoritative and non-destructive", async () => {
  const store = createInMemoryStore();

  const originalAuctions = JSON.stringify(store.data.auctions);
  const originalVehicles = JSON.stringify(store.data.vehicles);

  // Rebuild index
  const result = await rebuildProductSearchIndex(store);
  expect(result.count).toBe(3);
  expect(store.data.product_search_index.length).toBe(3);

  // Verify canonical facts unchanged
  expect(JSON.stringify(store.data.auctions)).toBe(originalAuctions);
  expect(JSON.stringify(store.data.vehicles)).toBe(originalVehicles);

  // Query search
  const searchRes = await queryProductSearch(store, { make: "Toyota", fuel: "DIESEL" });
  expect(searchRes.items.length).toBe(1);
  expect(searchRes.items[0].title).toContain("Hilux");
});
