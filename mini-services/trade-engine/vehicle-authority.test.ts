/// <reference types="bun-types" />
import { expect, test } from "bun:test";
import {
  addVehicleDocument,
  addVehicleEquipment,
  addVehicleHistoryEvent,
  addVehicleModification,
  reviewVehicleDocument,
  saveVehicleIntake,
  startVehicleInspection,
  type VehicleIdentity,
  type VehicleStore,
} from "./vehicle-authority";

class MemoryStore implements VehicleStore {
  private seq = 10;
  rows: Record<string, any[]> = {
    auctions: [{
      id: 1, user: "seller", seller_username: "seller", category: "vehicles",
      asset_kind: "vehicle", status: "draft", bid_count: 0,
      product_category_id: 101, product_schema_version_id: 201,
    }],
    vehicles: [],
    vehicle_evidence: [],
    vehicle_documents: [],
    vehicle_staff_roles: [
      { id: 1, user: "inspector", username: "inspector", role: "INSPECTOR", active: 1 },
      { id: 2, user: "reviewer", username: "reviewer", role: "REVIEWER", active: 1 },
    ],
    vehicle_inspections: [],
    pi_fact_assertions: [],
    pi_fact_links: [],
    pi_effective_facts: [],
    pi_document_fact_assertions: [],
    vehicle_history_events: [],
    vehicle_modifications: [],
    vehicle_equipment: [],
    auction_operation_grants: [],
    pi_effective_source_policies: [
      { id: 301, policy_key: "DEFAULT_PRODUCT_FACT", attribute_id: null, active: 1 },
      { id: 302, policy_key: "ODOMETER_AUTHORITY", attribute_id: 8, active: 1 },
    ],
    pi_effective_source_policy_entries: [
      ...[301,302].flatMap((policy_id) => [
        { id: policy_id * 10 + 1, policy_id, source_class: "SELLER_DECLARED", trust_rank: 10, verification_required: 0 },
        { id: policy_id * 10 + 2, policy_id, source_class: "DOCUMENT_DERIVED", trust_rank: 20, verification_required: 1 },
        { id: policy_id * 10 + 3, policy_id, source_class: "SYSTEM_DERIVED", trust_rank: 30, verification_required: 1 },
        { id: policy_id * 10 + 4, policy_id, source_class: "INSPECTOR_VERIFIED", trust_rank: 40, verification_required: 1 },
        { id: policy_id * 10 + 5, policy_id, source_class: "EXTERNAL_VERIFIED", trust_rank: 50, verification_required: 1 },
      ]),
    ],
  };

  constructor() {
    const definitions = [
      ["VIN","IDENTIFIER"], ["MAKE","TEXT"], ["MODEL","TEXT"], ["VARIANT","TEXT"],
      ["MODEL_YEAR","INTEGER"], ["FUEL_TYPE","ENUM"], ["TRANSMISSION","ENUM"],
      ["ODOMETER_KM","MEASUREMENT"], ["DRIVETRAIN","ENUM"], ["OWNERSHIP_STATUS","ENUM"],
      ["CUSTOMS_STATUS","ENUM"], ["ROADWORTHY","BOOLEAN"], ["INSPECTION_STATUS","ENUM"],
      ["INSPECTION_GRADE","ENUM"],
      ["MODIFICATION_STATUS","ENUM"],
    ].map(([attribute_key,data_type], index) => ({ id: index + 1, attribute_key, data_type, active: 1 }));
    this.rows.pi_attribute_definitions = definitions;
    this.rows.pi_attribute_definition_versions = definitions.map((definition) => ({
      id: 400 + definition.id, attribute_id: definition.id, version: 1,
      canonical_unit: definition.attribute_key === "ODOMETER_KM" ? "km" : null,
    }));
    this.rows.pi_category_attributes = definitions.map((definition) => ({
      id: 500 + definition.id, category_id: 101, schema_version_id: 201,
      attribute_id: definition.id, attribute_version_id: 400 + definition.id,
    }));
    const odometer = definitions.find((definition) => definition.attribute_key === "ODOMETER_KM")!;
    this.rows.pi_effective_source_policies[1]!.attribute_id = odometer.id;
  }

  async create(table: string, row: any) {
    const id = ++this.seq;
    this.rows[table] ??= [];
    this.rows[table].push({ id, ...row });
    return id;
  }
  async get(table: string, id: number | string) {
    return (this.rows[table] ?? []).find((r) => String(r.id) === String(id)) ?? null;
  }
  async list(table: string, params: string) {
    let rows = [...(this.rows[table] ?? [])];
    const q = new URLSearchParams(params);
    for (const [key, value] of q.entries()) {
      const m = key.match(/^filter\[([^\]]+)\]\[\$eq\]$/);
      if (m) rows = rows.filter((r) => String(r[m[1]!]) === value);
    }
    const order = q.get("order");
    if (order) {
      const desc = order.startsWith("-");
      const field = desc ? order.slice(1) : order;
      rows.sort((a,b) => (Number(a[field] ?? 0)-Number(b[field] ?? 0))*(desc?-1:1));
    }
    const limit = Number(q.get("limit") ?? rows.length);
    return rows.slice(0, limit);
  }
  async update(table: string, id: number | string, patch: any) {
    const row = (this.rows[table] ?? []).find((r) => String(r.id) === String(id));
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  }
}

const seller: VehicleIdentity = { id: "seller", username: "seller", admin: false };
const outsider: VehicleIdentity = { id: "outsider", username: "outsider", admin: false };
const inspector: VehicleIdentity = { id: "inspector", username: "inspector", admin: false };
const reviewer: VehicleIdentity = { id: "reviewer", username: "reviewer", admin: false };
const audit = async () => {};

const intake = {
  vin: "JH4KA8260MC000001",
  make: "Toyota", model: "Hilux", variant: "GD-6", modelYear: 2020,
  fuelType: "DIESEL" as const, transmission: "MANUAL" as const, drivetrain: "4WD" as const,
  odometerKm: 82000, locationCity: "Harare", locationCountry: "Zimbabwe",
  ownershipStatus: "DECLARED_OWNER" as const, customsStatus: "LOCAL" as const,
  requestedDurationHours: 72,
};

test("seller authority is enforced for vehicle intake", async () => {
  const store = new MemoryStore();
  const denied = await saveVehicleIntake(store, audit, outsider, 1, intake);
  expect(denied.ok).toBe(false);
  expect(denied.error).toContain("seller");

  const accepted = await saveVehicleIntake(store, audit, seller, 1, intake);
  expect(accepted.ok).toBe(true);
  expect(accepted.vehicle?.vin).toBe("JH4KA8260MC000001");
  expect(store.rows.vehicle_evidence.length).toBeGreaterThan(5);
});

test("inspector role is required to start a versioned inspection", async () => {
  const store = new MemoryStore();
  const created = await saveVehicleIntake(store, audit, seller, 1, intake);
  const vehicleId = Number(created.vehicle.id);

  const denied = await startVehicleInspection(store, audit, outsider, vehicleId);
  expect(denied.ok).toBe(false);
  expect(denied.error).toContain("Inspector permission");

  const accepted = await startVehicleInspection(store, audit, inspector, vehicleId);
  expect(accepted.ok).toBe(true);
  expect(accepted.inspection?.version).toBe(1);
  expect(accepted.inspection?.inspector_user).toBe("inspector");
});

test("document ownership and reviewer/inspector verification authority are separated", async () => {
  const store = new MemoryStore();
  const created = await saveVehicleIntake(store, audit, seller, 1, intake);
  const vehicleId = Number(created.vehicle.id);

  const outsiderDoc = await addVehicleDocument(store, audit, outsider, vehicleId, {
    documentType: "OWNERSHIP", documentRef: "OWN-1",
  });
  expect(outsiderDoc.ok).toBe(false);

  const sellerDoc = await addVehicleDocument(store, audit, seller, vehicleId, {
    documentType: "OWNERSHIP", documentRef: "OWN-1", storageRef: "local-uat://ownership/OWN-1",
  });
  expect(sellerDoc.ok).toBe(true);

  const denied = await reviewVehicleDocument(store, audit, outsider, Number(sellerDoc.document.id), "VERIFY");
  expect(denied.ok).toBe(false);
  expect(denied.error).toContain("permission");

  const accepted = await reviewVehicleDocument(store, audit, reviewer, Number(sellerDoc.document.id), "VERIFY");
  expect(accepted.ok).toBe(true);
  expect(accepted.document?.status).toBe("VERIFIED");
  expect(accepted.document?.verified_by).toBe("reviewer");
});

test("structured history, modification and equipment commands preserve seller authority", async () => {
  const store = new MemoryStore();
  const created = await saveVehicleIntake(store, audit, seller, 1, intake);
  const vehicleId = Number(created.vehicle.id);

  const denied = await addVehicleHistoryEvent(store, audit, outsider, vehicleId, {
    eventType: "SERVICE", title: "Annual service",
  });
  expect(denied.ok).toBe(false);

  const history = await addVehicleHistoryEvent(store, audit, seller, vehicleId, {
    eventType: "SERVICE", title: "Annual service", odometerKm: 80_000,
  });
  expect(history.ok).toBe(true);

  const modification = await addVehicleModification(store, audit, seller, vehicleId, {
    category: "SUSPENSION", title: "Raised suspension", reversible: true,
  });
  expect(modification.ok).toBe(true);
  expect(store.rows.pi_fact_assertions.some((row) => row.source_ref_type === "vehicle_modifications")).toBe(true);

  const equipment = await addVehicleEquipment(store, audit, seller, vehicleId, {
    equipmentType: "TOOL", equipmentKey: "JACK", label: "Vehicle jack", quantity: 1,
  });
  expect(equipment.ok).toBe(true);
});
