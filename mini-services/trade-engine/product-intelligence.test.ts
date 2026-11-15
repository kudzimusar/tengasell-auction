/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import {
  isPubliclyVisibleAuction,
  publicProductBundle,
  resolveEffectiveFact,
  type PiFact,
} from "./product-intelligence";

const policy = [
  { source_class: "SELLER_DECLARED" as const, trust_rank: 10, verification_required: 0 },
  { source_class: "DOCUMENT_DERIVED" as const, trust_rank: 20, verification_required: 1 },
  { source_class: "SYSTEM_DERIVED" as const, trust_rank: 30, verification_required: 1 },
  { source_class: "INSPECTOR_VERIFIED" as const, trust_rank: 40, verification_required: 1 },
  { source_class: "EXTERNAL_VERIFIED" as const, trust_rank: 50, verification_required: 1 },
];

const fact = (id: number, source_class: PiFact["source_class"], value: number, extra: Partial<PiFact> = {}): PiFact => ({
  id,
  source_class,
  verification_state: source_class === "SELLER_DECLARED" ? "UNVERIFIED" : "VERIFIED",
  value_decimal: value,
  measurement_unit: "km",
  asserted_at: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z`,
  ...extra,
});

test("inspection wins while preserving lower-trust odometer disagreement", () => {
  const result = resolveEffectiveFact([
    fact(1, "SELLER_DECLARED", 87_000),
    fact(2, "INSPECTOR_VERIFIED", 91_320),
  ], [], policy);
  expect(result.assertion?.id).toBe(2);
  expect(result.assertion?.value_decimal).toBe(91_320);
  expect(result.conflict).toBe("LOWER_TRUST_DISAGREEMENT");
});

test("equal-trust disagreement has no arbitrary buyer-facing winner", () => {
  const result = resolveEffectiveFact([
    fact(1, "INSPECTOR_VERIFIED", 91_320),
    fact(2, "INSPECTOR_VERIFIED", 91_450),
  ], [], policy);
  expect(result.assertion).toBeNull();
  expect(result.conflict).toBe("PEER_CONFLICT");
});

test("superseded, rejected and expired assertions are excluded", () => {
  const facts = [
    fact(1, "SELLER_DECLARED", 87_000),
    fact(2, "SELLER_DECLARED", 88_000),
    fact(3, "INSPECTOR_VERIFIED", 91_320, { verification_state: "REJECTED" }),
    fact(4, "EXTERNAL_VERIFIED", 92_000, { valid_until: "2025-01-01T00:00:00Z" }),
  ];
  const result = resolveEffectiveFact(
    facts,
    [{ from_assertion_id: 2, to_assertion_id: 1, link_type: "SUPERSEDES" }],
    policy,
    "2026-01-01T00:00:00Z",
  );
  expect(result.assertion?.id).toBe(2);
  expect(result.conflict).toBe("NONE");
});

test("equivalent peer assertions are deterministic without timestamp authority", () => {
  const result = resolveEffectiveFact([
    fact(9, "DOCUMENT_DERIVED", 87_000),
    fact(4, "DOCUMENT_DERIVED", 87_000),
  ], [], policy);
  expect(result.assertion?.id).toBe(4);
  expect(result.conflict).toBe("NONE");
});

test("publicProductBundle resolves physical TrailBase tables safely and fails closed for non-public listings", async () => {
  const tables: Record<string, any[]> = {
    categories: [{ id: 2, category_key: "VEHICLE_PASSENGER_CAR", name: "Passenger Cars" }],
    pi_category_labels: [{ category_id: 2, locale: "en", label: "Passenger Car" }],
    pi_category_schema_versions: [{ id: 1, category_id: 2, schema_key: "VEHICLE_V1", status: "ACTIVE" }],
    pi_attribute_definitions: [
      { id: 1, attribute_key: "MAKE", display_group: "IDENTITY", privacy_policy_key: "PRODUCT_PUBLIC", active: 1 },
      { id: 2, attribute_key: "VIN", display_group: "IDENTITY", privacy_policy_key: "VEHICLE_IDENTIFIER_CLASSIFIED", active: 1 },
      { id: 3, attribute_key: "ENGINE_NUMBER", display_group: "IDENTITY", privacy_policy_key: "PRODUCT_INTERNAL", active: 1 },
    ],
    auctions: [
      { id: 10, title: "2020 Toyota Hilux", status: "live", current_price: 28000, city: "Harare", ends_at: "2030-01-01T00:00:00Z", product_category_id: 2, product_schema_version_id: 1, reserve_price: 27000 },
      { id: 11, title: "Secret Draft", status: "draft", current_price: 15000, city: "Harare", ends_at: "2030-01-01T00:00:00Z", product_category_id: 2, product_schema_version_id: 1 },
    ],
    product_intake_sessions: [
      { id: 1, auction_id: 10, state: "PUBLISHED" },
      { id: 2, auction_id: 11, state: "DRAFT" },
    ],
    vehicles: [
      { id: 20, auction_id: 10, make: "Toyota", model: "Hilux", model_year: 2020, fuel_type: "DIESEL", transmission: "AUTOMATIC", drivetrain: "4WD", odometer_km: 88000, vin: "AHTBA3CD123456789", registration_number: "AEZ-9911", seller_user: "seller_a" },
      { id: 21, auction_id: 11, make: "Honda", model: "Fit", model_year: 2018, fuel_type: "PETROL", transmission: "AUTOMATIC", drivetrain: "FWD", odometer_km: 52000, vin: "JHMFIT00000000001" },
    ],
    pi_effective_facts: [
      { id: 1, product_type: "VEHICLE", product_id: 20, attribute_id: 1, source_class: "SELLER_DECLARED", conflict_state: "NONE", value_text: "Toyota" },
      { id: 2, product_type: "VEHICLE", product_id: 20, attribute_id: 2, source_class: "DOCUMENT_DERIVED", conflict_state: "NONE", value_text: "AHTBA3CD123456789" },
      { id: 3, product_type: "VEHICLE", product_id: 20, attribute_id: 3, source_class: "INSPECTOR_VERIFIED", conflict_state: "NONE", value_text: "1GD-SECRET-99" },
    ],
    vehicle_documents: [
      { id: 1, vehicle_id: 20, document_type: "REGISTRATION_BOOK", status: "VERIFIED", storage_ref: "private/secret-reg.pdf", document_number: "ZW-7788" },
    ],
    vehicle_inspections: [{ id: 5, vehicle_id: 20, version: 1, lifecycle: "REVIEWED", grade: "B", grade_score: 82, roadworthy: 1, odometer_km: 88000 }],
    vehicle_eligibility: [{ id: 6, vehicle_id: 20, version: 1, status: "ELIGIBLE" }],
    vehicle_inspection_findings: [
      {
        id: 101,
        inspection_id: 5,
        category: "MECHANICAL",
        component: "Brake Pads",
        location: "Front Left",
        severity: "MINOR",
        description: "Front brake pads 60% worn",
        repair_recommended: 1,
        safety_critical: 0,
        evidence_document_id: 999,
        created_by: "inspector_bob_id",
        created_at: "2026-02-01T00:00:00Z",
        internal_notes: "PRIVATE_NOTE_LEAK_CHECK",
      },
    ],
    vehicle_history_events: [],
    vehicle_modifications: [],
    vehicle_equipment: [],
  };

  const mockStore = {
    async get(table: string, id: number | string) {
      return (tables[table] ?? []).find((r) => String(r.id) === String(id)) ?? null;
    },
    async create() { return null; },
    async update() { return false; },
    async list(table: string, qs: string) {
      const sp = new URLSearchParams(qs);
      let rows = [...(tables[table] ?? [])];
      for (const [k, v] of sp.entries()) {
        const m = k.match(/^filter\[(\w+)\]\[\$(\w+)\]$/);
        if (m && m[2] === "eq") rows = rows.filter((r) => String(r[m[1]]) === String(v));
      }
      return rows;
    },
  };

  expect(isPubliclyVisibleAuction(tables.auctions[0], [tables.product_intake_sessions[0]])).toBe(true);
  expect(isPubliclyVisibleAuction(tables.auctions[1], [tables.product_intake_sessions[1]])).toBe(false);

  const pub = await publicProductBundle(mockStore, 10);
  expect(pub.product).not.toBeNull();
  expect(pub.product?.vin_classification).toBe("RECORDED");
  expect((pub.product as any)?.vin).toBeUndefined();
  expect(JSON.stringify(pub)).not.toContain("AHTBA3CD123456789");
  expect(JSON.stringify(pub)).not.toContain("AEZ-9911");
  expect(JSON.stringify(pub)).not.toContain("1GD-SECRET-99");
  expect(JSON.stringify(pub)).not.toContain("private/secret-reg.pdf");

  // Verify allowlisted finding DTO: only public fields exposed, sensitive internal fields stripped
  expect(pub.findings).toHaveLength(1);
  const f = pub.findings[0] as any;
  expect(f.category).toBe("MECHANICAL");
  expect(f.component).toBe("Brake Pads");
  expect(f.location).toBe("Front Left");
  expect(f.severity).toBe("MINOR");
  expect(f.description).toBe("Front brake pads 60% worn");
  expect(f.repair_recommended).toBe(true);
  expect(f.safety_critical).toBe(false);
  expect(f.id).toBeUndefined();
  expect(f.inspection_id).toBeUndefined();
  expect(f.created_by).toBeUndefined();
  expect(f.evidence_document_id).toBeUndefined();
  expect(f.created_at).toBeUndefined();
  expect(f.internal_notes).toBeUndefined();
  expect(JSON.stringify(pub)).not.toContain("PRIVATE_NOTE_LEAK_CHECK");
  expect(JSON.stringify(pub)).not.toContain("inspector_bob_id");

  const draft = await publicProductBundle(mockStore, 11);
  expect(draft.product).toBeNull();
});

test("PI-G5-PUBLIC-FINDINGS-01: negative proof - unapproved or ineligible inspections never disclose findings or sentinels", async () => {
  const unapprovedLifecycles = ["DRAFT", "SUBMITTED", "REJECTED", "SUPERSEDED"];

  for (const lifecycle of unapprovedLifecycles) {
    const sentinelDesc = `SENTINEL_UNAPPROVED_DESC_${lifecycle}_7766`;
    const sentinelNote = `SENTINEL_DRAFT_FINDING_NOTE_${lifecycle}_9988`;
    const sentinelPhoto = `SENTINEL_PRIVATE_PHOTO_${lifecycle}_5544`;

    const tables: Record<string, any[]> = {
      categories: [{ id: 2, category_key: "VEHICLE_PASSENGER_CAR", name: "Passenger Cars" }],
      pi_category_labels: [{ category_id: 2, locale: "en", label: "Passenger Car" }],
      pi_category_schema_versions: [{ id: 1, category_id: 2, schema_key: "VEHICLE_V1", status: "ACTIVE" }],
      pi_attribute_definitions: [],
      auctions: [{ id: 200, title: "Test Car", status: "live", current_price: 10000, city: "Harare", ends_at: "2030-01-01T00:00:00Z", product_category_id: 2, product_schema_version_id: 1 }],
      product_intake_sessions: [{ id: 1, auction_id: 200, state: "PUBLISHED" }],
      vehicles: [{ id: 50, auction_id: 200, make: "Toyota", model: "Corolla", model_year: 2019, fuel_type: "PETROL", transmission: "MANUAL", drivetrain: "FWD" }],
      pi_effective_facts: [],
      vehicle_documents: [],
      vehicle_inspections: [{ id: 88, vehicle_id: 50, version: 1, lifecycle, grade: "C", grade_score: 70, roadworthy: 1, odometer_km: 50000 }],
      vehicle_eligibility: [{ id: 89, vehicle_id: 50, version: 1, status: "ELIGIBLE" }],
      vehicle_inspection_findings: [
        {
          id: 999,
          inspection_id: 88,
          category: "MECHANICAL",
          component: "Engine",
          severity: "CRITICAL",
          description: sentinelDesc,
          internal_notes: sentinelNote,
          photo_ref: sentinelPhoto,
        },
      ],
      vehicle_history_events: [],
      vehicle_modifications: [],
      vehicle_equipment: [],
    };

    const mockStore = {
      async get(table: string, id: number | string) {
        return (tables[table] ?? []).find((r) => String(r.id) === String(id)) ?? null;
      },
      async create() { return null; },
      async update() { return false; },
      async list(table: string, qs: string) {
        const sp = new URLSearchParams(qs);
        let rows = [...(tables[table] ?? [])];
        for (const [k, v] of sp.entries()) {
          const m = k.match(/^filter\[(\w+)\]\[\$(\w+)\]$/);
          if (m && m[2] === "eq") rows = rows.filter((r) => String(r[m[1]]) === String(v));
        }
        return rows;
      },
    };

    const pub = await publicProductBundle(mockStore, 200);
    expect(pub.product).not.toBeNull();
    expect(pub.product?.inspection_status).toBeNull();
    expect(pub.product?.inspection_grade).toBeNull();
    expect(pub.product?.finding_count).toBe(0);
    expect(pub.findings).toEqual([]);

    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain(sentinelDesc);
    expect(serialized).not.toContain(sentinelNote);
    expect(serialized).not.toContain(sentinelPhoto);
  }

  // Also test when lifecycle is REVIEWED but eligibility is INELIGIBLE
  const ineligibleSentinel = "SENTINEL_INELIGIBLE_FINDING_DESC_1122";
  const ineligibleTables: Record<string, any[]> = {
    categories: [{ id: 2, category_key: "VEHICLE_PASSENGER_CAR", name: "Passenger Cars" }],
    pi_category_labels: [{ category_id: 2, locale: "en", label: "Passenger Car" }],
    pi_category_schema_versions: [{ id: 1, category_id: 2, schema_key: "VEHICLE_V1", status: "ACTIVE" }],
    pi_attribute_definitions: [],
    auctions: [{ id: 300, title: "Ineligible Car", status: "live", current_price: 10000, city: "Harare", ends_at: "2030-01-01T00:00:00Z", product_category_id: 2, product_schema_version_id: 1 }],
    product_intake_sessions: [{ id: 1, auction_id: 300, state: "PUBLISHED" }],
    vehicles: [{ id: 60, auction_id: 300, make: "Nissan", model: "Sunny", model_year: 2015, fuel_type: "PETROL", transmission: "MANUAL", drivetrain: "FWD" }],
    pi_effective_facts: [],
    vehicle_documents: [],
    vehicle_inspections: [{ id: 91, vehicle_id: 60, version: 1, lifecycle: "REVIEWED", grade: "REJECT", grade_score: 30, roadworthy: 0, odometer_km: 150000 }],
    vehicle_eligibility: [{ id: 92, vehicle_id: 60, version: 1, status: "INELIGIBLE" }],
    vehicle_inspection_findings: [
      {
        id: 1000,
        inspection_id: 91,
        category: "STRUCTURAL",
        component: "Chassis Frame",
        severity: "CRITICAL",
        description: ineligibleSentinel,
      },
    ],
    vehicle_history_events: [],
    vehicle_modifications: [],
    vehicle_equipment: [],
  };

  const ineligibleStore = {
    async get(table: string, id: number | string) {
      return (ineligibleTables[table] ?? []).find((r) => String(r.id) === String(id)) ?? null;
    },
    async create() { return null; },
    async update() { return false; },
    async list(table: string, qs: string) {
      const sp = new URLSearchParams(qs);
      let rows = [...(ineligibleTables[table] ?? [])];
      for (const [k, v] of sp.entries()) {
        const m = k.match(/^filter\[(\w+)\]\[\$(\w+)\]$/);
        if (m && m[2] === "eq") rows = rows.filter((r) => String(r[m[1]]) === String(v));
      }
      return rows;
    },
  };

  const ineligPub = await publicProductBundle(ineligibleStore, 300);
  expect(ineligPub.product).not.toBeNull();
  expect(ineligPub.product?.inspection_status).toBeNull();
  expect(ineligPub.product?.finding_count).toBe(0);
  expect(ineligPub.findings).toEqual([]);
  expect(JSON.stringify(ineligPub)).not.toContain(ineligibleSentinel);
});
