// TENGASELL-PI-01D — Product Intelligence authority.
//
// This module is deliberately policy-oriented. Canonical product writes still
// belong to auctions/vehicles/inspection. PI appends immutable assertions,
// deterministically resolves effective facts, and emits privacy-safe buyer
// projections without returning raw canonical vehicle rows.

import type { VehicleIdentity, VehicleStore } from "./vehicle-authority";

export type PiSourceClass =
  | "SELLER_DECLARED"
  | "DOCUMENT_DERIVED"
  | "SYSTEM_DERIVED"
  | "INSPECTOR_VERIFIED"
  | "EXTERNAL_VERIFIED";
export type PiVerificationState = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED";
export type PiConflictState = "NONE" | "LOWER_TRUST_DISAGREEMENT" | "PEER_CONFLICT" | "RESOLVED";

export type PiFact = {
  id: number;
  source_class: PiSourceClass;
  verification_state: PiVerificationState;
  asserted_at: string;
  valid_until?: string | null;
  value_text?: string | null;
  value_integer?: number | null;
  value_decimal?: number | null;
  value_boolean?: number | null;
  value_date?: string | null;
  value_datetime?: string | null;
  value_option_key?: string | null;
  value_json?: string | null;
  measurement_unit?: string | null;
  identifier_class?: string | null;
};

type FactLink = { from_assertion_id: number; to_assertion_id: number; link_type: string };
type PolicyEntry = { source_class: PiSourceClass; trust_rank: number; verification_required: number };

const VALUE_COLUMNS = [
  "value_text", "value_integer", "value_decimal", "value_boolean", "value_date",
  "value_datetime", "value_option_key", "value_json", "measurement_unit", "identifier_class",
] as const;

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);

function params(fields: Record<string, string | number>) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) q.set(key, String(value));
  return q.toString();
}

function factValue(fact: PiFact): unknown {
  if (fact.value_text != null) return fact.value_text;
  if (fact.value_integer != null) return fact.value_integer;
  if (fact.value_decimal != null) return fact.value_decimal;
  if (fact.value_boolean != null) return Boolean(fact.value_boolean);
  if (fact.value_date != null) return fact.value_date;
  if (fact.value_datetime != null) return fact.value_datetime;
  if (fact.value_option_key != null) return fact.value_option_key;
  if (fact.value_json != null) {
    try { return JSON.parse(fact.value_json); } catch { return fact.value_json; }
  }
  return null;
}

function valueSignature(fact: PiFact): string {
  return JSON.stringify({ value: factValue(fact), unit: fact.measurement_unit ?? null });
}

export function resolveEffectiveFact(
  facts: PiFact[],
  links: FactLink[],
  policy: PolicyEntry[],
  at = nowIso(),
): { assertion: PiFact | null; conflict: PiConflictState } {
  const excluded = new Set<number>();
  for (const fact of facts) {
    if (fact.verification_state === "REJECTED" || fact.verification_state === "EXPIRED") excluded.add(fact.id);
    if (fact.valid_until && fact.valid_until <= at) excluded.add(fact.id);
  }
  for (const link of links) {
    if (link.link_type === "SUPERSEDES" || link.link_type === "REJECTS") excluded.add(Number(link.to_assertion_id));
  }
  const rules = new Map(policy.map((entry) => [entry.source_class, entry]));
  const candidates = facts.filter((fact) => {
    if (excluded.has(fact.id)) return false;
    const rule = rules.get(fact.source_class);
    if (!rule) return false;
    return !rule.verification_required || fact.verification_state === "VERIFIED";
  });
  if (!candidates.length) return { assertion: null, conflict: "NONE" };

  const rank = (fact: PiFact) => Number(rules.get(fact.source_class)?.trust_rank ?? -1);
  const topRank = Math.max(...candidates.map(rank));
  const peers = candidates.filter((fact) => rank(fact) === topRank);
  const peerValues = new Set(peers.map(valueSignature));
  if (peerValues.size > 1) return { assertion: null, conflict: "PEER_CONFLICT" };

  // Timestamp is never an authority decision. A stable id only chooses between
  // equivalent assertions after trust and value equality are established.
  const assertion = [...peers].sort((a, b) => Number(a.id) - Number(b.id))[0] ?? null;
  const lowerDisagreement = assertion && candidates.some(
    (fact) => rank(fact) < topRank && valueSignature(fact) !== valueSignature(assertion),
  );
  return { assertion, conflict: lowerDisagreement ? "LOWER_TRUST_DISAGREEMENT" : "NONE" };
}

function typedValue(definition: any, value: unknown): Record<string, unknown> {
  switch (definition.data_type) {
    case "TEXT": return { value_text: clean(value, 2000) };
    case "INTEGER": return { value_integer: Math.round(Number(value)) };
    case "DECIMAL": return { value_decimal: Number(value) };
    case "BOOLEAN": return { value_boolean: value ? 1 : 0 };
    case "DATE": return { value_date: clean(value, 40) };
    case "DATETIME": return { value_datetime: clean(value, 40) };
    case "ENUM": return { value_option_key: clean(value, 120).toUpperCase() };
    case "MULTI_ENUM": return { value_json: JSON.stringify(Array.isArray(value) ? value : [value]) };
    case "MEASUREMENT": return {
      value_decimal: Number(typeof value === "object" && value ? (value as any).value : value),
      measurement_unit: clean(typeof value === "object" && value ? (value as any).unit : definition.canonical_unit, 30),
    };
    case "IDENTIFIER": return { value_text: clean(value, 240), identifier_class: definition.attribute_key };
    default: throw new Error(`Unsupported PI attribute type: ${definition.data_type}`);
  }
}

async function definitionFor(store: VehicleStore, attributeKey: string) {
  const definition = (await store.list(
    "pi_attribute_definitions",
    params({ "filter[attribute_key][$eq]": attributeKey, limit: 1 }),
  ))[0];
  if (!definition) return null;
  const version = (await store.list(
    "pi_attribute_definition_versions",
    params({ "filter[attribute_id][$eq]": definition.id, order: "-version", limit: 1 }),
  ))[0];
  return version ? { ...definition, definitionVersion: version } : null;
}

async function productBinding(store: VehicleStore, vehicleId: number) {
  const vehicle = await store.get("vehicles", vehicleId);
  if (!vehicle) return null;
  const auction = await store.get("auctions", Number(vehicle.auction_id));
  if (!auction?.product_category_id || !auction?.product_schema_version_id) return null;
  return { vehicle, auction };
}

export async function appendProductFact(
  store: VehicleStore,
  input: {
    vehicleId: number;
    attributeKey: string;
    value: unknown;
    sourceClass: PiSourceClass;
    verificationState: PiVerificationState;
    actorId?: string | null;
    verifierId?: string | null;
    sourceRefType?: string | null;
    sourceRefId?: number | null;
    validUntil?: string | null;
    note?: string | null;
    supersedePriorFromSameSource?: boolean;
  },
): Promise<{ ok: boolean; error?: string; assertion?: any; effective?: any }> {
  const binding = await productBinding(store, input.vehicleId);
  if (!binding) return { ok: false, error: "PI product binding is unavailable." };
  const definition = await definitionFor(store, input.attributeKey);
  if (!definition) return { ok: false, error: `Unknown Product Intelligence attribute ${input.attributeKey}.` };
  const applicability = (await store.list(
    "pi_category_attributes",
    params({
      "filter[category_id][$eq]": binding.auction.product_category_id,
      "filter[schema_version_id][$eq]": binding.auction.product_schema_version_id,
      "filter[attribute_id][$eq]": definition.id,
      limit: 1,
    }),
  ))[0];
  if (!applicability) return { ok: false, error: "PI attribute is not applicable to this product category." };

  const previous = input.supersedePriorFromSameSource
    ? (await store.list(
        "pi_fact_assertions",
        params({
          "filter[product_type][$eq]": "VEHICLE",
          "filter[product_id][$eq]": input.vehicleId,
          "filter[attribute_id][$eq]": definition.id,
          "filter[source_class][$eq]": input.sourceClass,
          order: "-id",
          limit: 1,
        }),
      ))[0]
    : null;
  const assertedAt = nowIso();
  const id = await store.create("pi_fact_assertions", {
    product_type: "VEHICLE",
    product_id: input.vehicleId,
    category_id: Number(binding.auction.product_category_id),
    schema_version_id: Number(binding.auction.product_schema_version_id),
    attribute_id: Number(definition.id),
    attribute_version_id: Number(definition.definitionVersion.id),
    source_class: input.sourceClass,
    verification_state: input.verificationState,
    value_text: null,
    value_integer: null,
    value_decimal: null,
    value_boolean: null,
    value_date: null,
    value_datetime: null,
    value_option_key: null,
    value_json: null,
    measurement_unit: null,
    identifier_class: null,
    ...typedValue({ ...definition, ...definition.definitionVersion }, input.value),
    source_ref_type: input.sourceRefType ?? null,
    source_ref_id: input.sourceRefId ?? null,
    asserted_by: input.actorId ?? null,
    verified_by: input.verifierId ?? null,
    asserted_at: assertedAt,
    verified_at: input.verificationState === "VERIFIED" ? assertedAt : null,
    valid_until: input.validUntil ?? null,
    note: clean(input.note, 500),
  });
  if (id == null) return { ok: false, error: `PI assertion for ${input.attributeKey} could not be recorded.` };
  if (previous) {
    await store.create("pi_fact_links", {
      from_assertion_id: id,
      to_assertion_id: Number(previous.id),
      link_type: "SUPERSEDES",
      created_by: input.actorId ?? null,
      created_at: assertedAt,
    });
  }
  const effective = await recomputeEffectiveFact(store, input.vehicleId, Number(definition.id));
  return { ok: true, assertion: await store.get("pi_fact_assertions", id), effective };
}

export async function recomputeEffectiveFact(store: VehicleStore, vehicleId: number, attributeId: number) {
  const facts = await store.list("pi_fact_assertions", params({
    "filter[product_type][$eq]": "VEHICLE",
    "filter[product_id][$eq]": vehicleId,
    "filter[attribute_id][$eq]": attributeId,
    order: "id",
    limit: 500,
  }));
  const linkRows: any[] = [];
  for (const fact of facts) {
    linkRows.push(
      ...await store.list("pi_fact_links", params({ "filter[from_assertion_id][$eq]": fact.id, limit: 1000 })),
      ...await store.list("pi_fact_links", params({ "filter[to_assertion_id][$eq]": fact.id, limit: 1000 })),
    );
  }
  const specific = (await store.list("pi_effective_source_policies", params({
    "filter[attribute_id][$eq]": attributeId, "filter[active][$eq]": 1, limit: 1,
  })))[0];
  const defaultPolicy = (await store.list("pi_effective_source_policies", params({
    "filter[policy_key][$eq]": "DEFAULT_PRODUCT_FACT", "filter[active][$eq]": 1, limit: 1,
  })))[0];
  const policyId = Number(specific?.id ?? defaultPolicy?.id);
  const policy = await store.list("pi_effective_source_policy_entries", params({
    "filter[policy_id][$eq]": policyId, limit: 20,
  }));
  const links = [...new Map(linkRows.map((row) => [Number(row.id), row])).values()];
  const result = resolveEffectiveFact(facts as PiFact[], links, policy as PolicyEntry[]);
  const chosen = result.assertion;
  const valueFields = Object.fromEntries(VALUE_COLUMNS.map((column) => [column, chosen ? (chosen as any)[column] ?? null : null]));
  const row = {
    assertion_id: chosen?.id ?? null,
    source_class: chosen?.source_class ?? null,
    verification_state: chosen?.verification_state ?? null,
    conflict_state: result.conflict,
    ...valueFields,
    resolved_at: nowIso(),
  };
  const existing = (await store.list("pi_effective_facts", params({
    "filter[product_type][$eq]": "VEHICLE",
    "filter[product_id][$eq]": vehicleId,
    "filter[attribute_id][$eq]": attributeId,
    limit: 1,
  })))[0];
  if (existing) await store.update("pi_effective_facts", Number(existing.id), row);
  else await store.create("pi_effective_facts", { product_type: "VEHICLE", product_id: vehicleId, attribute_id: attributeId, ...row });
  return { ...row, id: existing?.id ?? null };
}

export async function productSchema(store: VehicleStore, categoryKey?: string | null) {
  const leaves = await store.list("categories", params({ "filter[node_kind][$eq]": "LEAF", "filter[active][$eq]": 1, order: "sort", limit: 200 }));
  const vehicleLeaves = leaves.filter((row) => String(row.category_key).startsWith("VEHICLE_"));
  const category = vehicleLeaves.find((row) => row.category_key === categoryKey)
    ?? vehicleLeaves.find((row) => row.category_key === "VEHICLE_WHOLE_UNCLASSIFIED")
    ?? vehicleLeaves[0];
  if (!category) return { categories: [], category: null, schema: null, attributes: [] };
  const schema = (await store.list("pi_category_schema_versions", params({
    "filter[category_id][$eq]": category.id, "filter[status][$eq]": "ACTIVE", limit: 1,
  })))[0] ?? null;
  if (!schema) return { categories: vehicleLeaves, category, schema: null, attributes: [] };
  const bindings = await store.list("pi_category_attributes", params({
    "filter[schema_version_id][$eq]": schema.id, order: "display_group,display_order", limit: 300,
  }));
  const definitions = await store.list("pi_attribute_definitions", params({ "filter[active][$eq]": 1, limit: 300 }));
  const labels = await store.list("pi_attribute_labels", params({ "filter[locale][$eq]": "en", limit: 300 }));
  const versions = await store.list("pi_attribute_definition_versions", params({ limit: 300 }));
  const options = await store.list("pi_attribute_options", params({ "filter[active][$eq]": 1, order: "sort_order", limit: 1000 }));
  const optionLabels = await store.list("pi_attribute_option_labels", params({ "filter[locale][$eq]": "en", limit: 1000 }));
  const attributes = bindings.map((binding) => {
    const definition = definitions.find((row) => Number(row.id) === Number(binding.attribute_id));
    const version = versions.find((row) => Number(row.id) === Number(binding.attribute_version_id));
    return {
      ...definition,
      ...binding,
      label: labels.find((row) => Number(row.attribute_id) === Number(binding.attribute_id))?.label ?? definition?.attribute_key,
      validation: (() => { try { return JSON.parse(version?.validation_json ?? "{}"); } catch { return {}; } })(),
      canonicalUnit: version?.canonical_unit ?? null,
      options: options.filter((row) => Number(row.attribute_id) === Number(binding.attribute_id)).map((option) => ({
        key: option.option_key,
        label: optionLabels.find((row) => Number(row.option_id) === Number(option.id))?.label ?? option.option_key,
      })),
    };
  });
  return {
    categories: vehicleLeaves.map((row) => ({ id: row.id, key: row.category_key, label: row.name, kind: row.node_kind })),
    category: { id: category.id, key: category.category_key, label: category.name },
    schema: { id: schema.id, key: schema.schema_key, version: schema.version, hash: schema.schema_hash },
    attributes,
  };
}

export async function openProductIntake(
  store: VehicleStore,
  me: VehicleIdentity,
  input: any,
) {
  const schema = await productSchema(store, clean(input?.categoryKey, 120));
  if (!schema.category || !schema.schema) return { ok: false, error: "Select an active Product Intelligence product type." };
  const assetKind = schema.category.key === "VEHICLE_PARTS_GENERAL" ? "part" : "vehicle";
  const commandKey = clean(input?.commandId, 160);
  if (!commandKey) return { ok: false, error: "Intake command id is required." };
  const reserve = input?.reserve_price == null || input?.reserve_price === "" ? null : Number(input.reserve_price);
  const createdAt = nowIso();
  let command = (await store.list("product_intake_open_commands", params({ "filter[command_key][$eq]": commandKey, limit: 1 })))[0];
  if (!command) {
    const id = await store.create("product_intake_open_commands", {
      command_key: commandKey,
      actor_user: me.id,
      actor_username: me.username,
      category_id: schema.category.id,
      schema_version_id: schema.schema.id,
      title: clean(input?.title, 160),
      slug: clean(input?.slug, 180),
      description: clean(input?.description, 5000),
      legacy_category: assetKind === "vehicle" ? "vehicles" : "vehicle-parts",
      condition: clean(input?.condition, 80),
      start_price: Number(input?.start_price ?? 0),
      buy_now_price: input?.buy_now_price == null ? null : Number(input.buy_now_price),
      reserve_price: reserve,
      reserve_disclosure: assetKind === "vehicle" ? (reserve == null ? "NO_RESERVE" : "RESERVE_APPLIES") : "UNSPECIFIED",
      shipping_fee: Number(input?.shipping_fee ?? 0),
      shipping: clean(input?.shipping, 120),
      city: clean(input?.city, 120),
      ends_at: clean(input?.ends_at, 40),
      asset_kind: assetKind,
      images: JSON.stringify(Array.isArray(input?.images) ? input.images.slice(0, 8) : []),
      allow_offers: input?.allow_offers ? 1 : 0,
      offer_min: input?.offer_min == null ? null : Number(input.offer_min),
      received_at: createdAt,
    });
    command = id == null
      ? (await store.list("product_intake_open_commands", params({ "filter[command_key][$eq]": commandKey, limit: 1 })))[0]
      : await store.get("product_intake_open_commands", id);
  }
  if (!command || command.status !== "accepted") {
    return { ok: false, error: `Product intake could not be opened: ${command?.error_code ?? "COMMAND_PERSIST_FAILED"}` };
  }
  return {
    ok: true,
    auction: await store.get("auctions", Number(command.result_auction_id)),
    session: await store.get("product_intake_sessions", Number(command.result_session_id)),
    schema,
  };
}

export async function intakeSession(store: VehicleStore, me: VehicleIdentity, auctionId: number) {
  const session = (await store.list("product_intake_sessions", params({ "filter[auction_id][$eq]": auctionId, limit: 1 })))[0];
  if (!session) return { ok: false, error: "Product intake session not found." };
  if (!me.admin && String(session.owner_user) !== String(me.id)) return { ok: false, error: "Only the seller can resume this intake." };
  const steps = await store.list("product_intake_steps", params({ "filter[session_id][$eq]": session.id, order: "id", limit: 20 }));
  return { ok: true, session, steps };
}

export async function saveIntakeStep(store: VehicleStore, me: VehicleIdentity, input: any) {
  const commandKey = clean(input?.commandId, 160);
  let command = (await store.list("product_intake_step_commands", params({ "filter[command_key][$eq]": commandKey, limit: 1 })))[0];
  if (!command) {
    const id = await store.create("product_intake_step_commands", {
      command_key: commandKey,
      session_id: Number(input?.sessionId),
      actor_user: me.id,
      actor_admin: me.admin ? 1 : 0,
      expected_revision: Number(input?.expectedRevision),
      step_key: clean(input?.stepKey, 40).toUpperCase(),
      step_state: input?.complete ? "COMPLETE" : "IN_PROGRESS",
      data_json: JSON.stringify(input?.data ?? {}),
      received_at: nowIso(),
    });
    command = id == null
      ? (await store.list("product_intake_step_commands", params({ "filter[command_key][$eq]": commandKey, limit: 1 })))[0]
      : await store.get("product_intake_step_commands", id);
  }
  if (!command || command.status !== "accepted") return { ok: false, error: command?.error_code ?? "INTAKE_STEP_FAILED", command };
  return { ok: true, command, session: await store.get("product_intake_sessions", Number(input?.sessionId)) };
}

export async function publishIntake(store: VehicleStore, me: VehicleIdentity, input: any) {
  const commandKey = clean(input?.commandId, 160);
  let command = (await store.list("product_intake_publish_commands", params({ "filter[command_key][$eq]": commandKey, limit: 1 })))[0];
  if (!command) {
    const id = await store.create("product_intake_publish_commands", {
      command_key: commandKey,
      session_id: Number(input?.sessionId),
      actor_user: me.id,
      actor_admin: me.admin ? 1 : 0,
      expected_revision: Number(input?.expectedRevision),
      command_type: input?.commandType === "PUBLISH" ? "PUBLISH" : input?.commandType === "ABANDON" ? "ABANDON" : "CHECK_READY",
      received_at: nowIso(),
    });
    command = id == null
      ? (await store.list("product_intake_publish_commands", params({ "filter[command_key][$eq]": commandKey, limit: 1 })))[0]
      : await store.get("product_intake_publish_commands", id);
  }
  if (!command || command.status !== "accepted") return { ok: false, error: command?.error_code ?? "INTAKE_PUBLISH_FAILED", command };
  return { ok: true, command, session: await store.get("product_intake_sessions", Number(input?.sessionId)) };
}

const provenanceLabels: Record<string, string> = {
  SELLER_DECLARED: "Seller declared",
  DOCUMENT_DERIVED: "Document verified",
  SYSTEM_DERIVED: "Tengasell derived",
  INSPECTOR_VERIFIED: "Tengasell inspected",
  EXTERNAL_VERIFIED: "Externally verified",
};

export class ProductIntelligenceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProductIntelligenceError";
  }
}

const PUBLIC_AUCTION_STATUSES = new Set([
  "live",
  "scheduled",
  "active",
  "closing",
  "settled",
  "ended",
  "sold",
  "unsold",
]);

export function isPubliclyVisibleAuction(
  auction: Record<string, unknown> | null | undefined,
  intakeSessions?: Array<Record<string, unknown>>,
): boolean {
  if (!auction || auction.id == null) return false;
  const status = String(auction.status ?? "").trim().toLowerCase();
  if (!PUBLIC_AUCTION_STATUSES.has(status)) return false;
  if (intakeSessions && intakeSessions.length > 0) {
    const hasPublished = intakeSessions.some((s) => String(s.state ?? "").toUpperCase() === "PUBLISHED");
    const hasUnpublished = intakeSessions.some((s) => {
      const state = String(s.state ?? "").toUpperCase();
      return state === "DRAFT" || state === "ABANDONED";
    });
    if (hasUnpublished && !hasPublished) return false;
  }
  return true;
}

export async function resolveVehicleInspectionProjection(
  store: VehicleStore,
  vehicleId: number,
  auctionId?: number,
): Promise<Record<string, unknown> | null> {
  const viewRows = await store.list(
    "pi_vehicle_inspection_projection",
    params({ "filter[vehicle_id][$eq]": vehicleId, limit: 1 }),
  );
  if (viewRows[0]) return viewRows[0];

  const [inspections, eligibilities] = await Promise.all([
    store.list("vehicle_inspections", params({ "filter[vehicle_id][$eq]": vehicleId, order: "-version", limit: 1 })),
    store.list("vehicle_eligibility", params({ "filter[vehicle_id][$eq]": vehicleId, order: "-version", limit: 1 })),
  ]);
  const insp = inspections[0] ?? null;
  const elig = eligibilities[0] ?? null;
  let findings: Array<Record<string, unknown>> = [];
  if (insp?.id != null) {
    findings = await store.list(
      "vehicle_inspection_findings",
      params({ "filter[inspection_id][$eq]": insp.id, limit: 200 }),
    );
  }
  const majorDefectCount = findings.filter((f) => {
    const sev = String(f.severity ?? "").toUpperCase();
    return sev === "MAJOR" || sev === "CRITICAL";
  }).length;
  const safetyCritical = findings.some((f) => Number(f.safety_critical ?? 0) === 1) ? 1 : 0;
  const hasStructural = findings.some((f) => String(f.category ?? "").toUpperCase() === "STRUCTURAL");
  const hasMechanical = findings.some((f) => String(f.category ?? "").toUpperCase() === "MECHANICAL");

  return {
    vehicle_id: vehicleId,
    auction_id: auctionId ?? insp?.auction_id ?? null,
    inspection_id: insp?.id ?? null,
    inspection_status: insp?.lifecycle ?? null,
    inspection_grade: insp?.grade ?? null,
    grade_score: insp?.grade_score ?? null,
    roadworthy: insp?.roadworthy ?? null,
    inspection_odometer_km: insp?.odometer_km ?? null,
    major_defect_count: majorDefectCount,
    safety_critical: safetyCritical,
    structural_condition_summary: hasStructural ? "STRUCTURAL" : "NOT_PROVIDED",
    mechanical_condition_summary: hasMechanical ? "MECHANICAL" : "NOT_PROVIDED",
    eligibility_status: elig?.status ?? null,
  };
}

export async function resolvePublicVehicleDocuments(
  store: VehicleStore,
  vehicleId: number,
): Promise<Array<Record<string, unknown>>> {
  const viewDocs = await store.list(
    "pi_vehicle_document_public",
    params({ "filter[vehicle_id][$eq]": vehicleId, limit: 100 }),
  );
  if (viewDocs.length > 0) {
    return viewDocs.map((d) => ({
      vehicle_id: d.vehicle_id,
      document_type: d.document_type,
      status: d.status,
      evidence_classification: d.evidence_classification,
      historic_review_required: d.historic_review_required ?? 0,
    }));
  }

  const rawDocs = await store.list(
    "vehicle_documents",
    params({ "filter[vehicle_id][$eq]": vehicleId, limit: 100 }),
  );
  return rawDocs.map((d) => {
    const status = String(d.status ?? "");
    const evidenceClassification =
      status === "VERIFIED"
        ? "VERIFIED_EVIDENCE"
        : status === "DECLARED" || status === "UPLOADED"
          ? "PENDING_EVIDENCE"
          : status;
    return {
      vehicle_id: d.vehicle_id,
      document_type: d.document_type,
      status,
      evidence_classification: evidenceClassification,
      historic_review_required: d.historic_review_required ?? 0,
    };
  });
}

function sanitizePublicVehicleRow(row: Record<string, unknown>): Record<string, unknown> {
  const {
    vin: _vin,
    chassis_number: _chassis,
    engine_number: _eng,
    registration_number: _reg,
    reserve_price: _res,
    user: _user,
    seller_user: _sellerUser,
    ...rest
  } = row;
  return rest;
}

export async function resolvePublicVehicleProjection(
  store: VehicleStore,
  auctionId: number,
): Promise<Record<string, unknown> | null> {
  const [auction, intakeSessions, viewRows] = await Promise.all([
    store.get("auctions", auctionId),
    store.list("product_intake_sessions", params({ "filter[auction_id][$eq]": auctionId, limit: 5 })),
    store.list("pi_vehicle_public", params({ "filter[auction_id][$eq]": auctionId, limit: 1 })),
  ]);
  const viewRow = viewRows[0] ?? null;

  if (auction) {
    if (!isPubliclyVisibleAuction(auction, intakeSessions)) return null;
  } else if (viewRow) {
    if (!isPubliclyVisibleAuction({ id: auctionId, status: viewRow.auction_status ?? "live" }, intakeSessions)) {
      return null;
    }
  } else {
    return null;
  }

  if (viewRow) {
    return sanitizePublicVehicleRow(viewRow);
  }

  const v = (await store.list("vehicles", params({ "filter[auction_id][$eq]": auctionId, limit: 1 })))[0] ?? null;
  if (!v || !auction) return null;

  const [category, labels, schemas, effective, definitions, ip, docs, findings] = await Promise.all([
    auction.product_category_id != null ? store.get("categories", Number(auction.product_category_id)) : Promise.resolve(null),
    auction.product_category_id != null
      ? store.list("pi_category_labels", params({ "filter[category_id][$eq]": auction.product_category_id, limit: 10 }))
      : Promise.resolve([]),
    auction.product_schema_version_id != null
      ? store.list("pi_category_schema_versions", params({ "filter[id][$eq]": auction.product_schema_version_id, limit: 1 }))
      : Promise.resolve([]),
    store.list("pi_effective_facts", params({ "filter[product_type][$eq]": "VEHICLE", "filter[product_id][$eq]": v.id, limit: 300 })),
    store.list("pi_attribute_definitions", params({ "filter[active][$eq]": 1, limit: 300 })),
    resolveVehicleInspectionProjection(store, Number(v.id), auctionId),
    resolvePublicVehicleDocuments(store, Number(v.id)),
    Promise.resolve([] as Array<Record<string, unknown>>),
  ]);

  const enLabel = labels.find((l) => String(l.locale) === "en")?.label ?? category?.name ?? null;
  const odometerAttr = definitions.find((d) => String(d.attribute_key) === "ODOMETER_KM");
  const odometerFact = odometerAttr
    ? effective.find((ef) => Number(ef.attribute_id) === Number(odometerAttr.id))
    : null;
  const effectiveOdometer =
    odometerFact?.value_decimal != null ? Math.round(Number(odometerFact.value_decimal)) : (v.odometer_km ?? null);

  let findingCount = findings.length;
  if (ip?.inspection_id != null) {
    const inspFindings = await store.list(
      "vehicle_inspection_findings",
      params({ "filter[inspection_id][$eq]": Number(ip.inspection_id), limit: 200 }),
    );
    findingCount = inspFindings.length;
  }

  return {
    vehicle_id: v.id,
    auction_id: v.auction_id,
    category_key: category?.category_key ?? null,
    product_type: enLabel,
    schema_key: schemas[0]?.schema_key ?? null,
    title: auction.title,
    auction_status: auction.status,
    current_price: auction.current_price,
    reserve_disclosure: auction.reserve_disclosure ?? null,
    city: auction.city,
    ends_at: auction.ends_at,
    make: v.make,
    model: v.model,
    variant: v.variant ?? null,
    trim: v.trim ?? null,
    model_year: v.model_year,
    manufacture_year: v.manufacture_year ?? null,
    vehicle_class: v.vehicle_class ?? null,
    body_type: v.body_type ?? null,
    fuel_type: v.fuel_type,
    transmission: v.transmission,
    drivetrain: v.drivetrain,
    effective_odometer_km: effectiveOdometer,
    odometer_source: odometerFact?.source_class ?? "SELLER_DECLARED",
    odometer_conflict: odometerFact?.conflict_state ?? "NONE",
    engine_displacement_cc: v.engine_displacement_cc ?? null,
    power_kw: v.power_kw ?? null,
    torque_nm: v.torque_nm ?? null,
    gear_count: v.gear_count ?? null,
    hybrid_type: v.hybrid_type ?? null,
    ev_battery_capacity_kwh: v.ev_battery_capacity_kwh ?? null,
    ev_range_km: v.ev_range_km ?? null,
    steering_side: v.steering_side ?? null,
    doors: v.doors ?? null,
    seats: v.seats ?? null,
    cab_type: v.cab_type ?? null,
    primary_exterior_colour: v.primary_exterior_colour ?? null,
    manufacturer_colour_name: v.manufacturer_colour_name ?? null,
    interior_colour: v.interior_colour ?? null,
    interior_material: v.interior_material ?? null,
    service_history_class: v.service_history_class ?? null,
    accident_history: v.accident_history ?? null,
    repair_history: v.repair_history ?? null,
    structural_repair_history: v.structural_repair_history ?? null,
    modification_status: v.modification_status ?? null,
    number_of_keys: v.number_of_keys ?? null,
    spare_key: v.spare_key ?? null,
    spare_wheel: v.spare_wheel ?? null,
    tool_kit: v.tool_kit ?? null,
    manuals: v.manuals ?? null,
    service_book: v.service_book ?? null,
    vin_classification: v.vin ? "RECORDED" : "NOT_PROVIDED",
    chassis_classification: v.chassis_number ? "RECORDED" : "NOT_PROVIDED",
    registration_classification: v.registration_number ? "RECORDED" : "NOT_PROVIDED",
    inspection_status: ip?.inspection_status ?? null,
    inspection_grade: ip?.inspection_grade ?? null,
    grade_score: ip?.grade_score ?? null,
    roadworthy: ip?.roadworthy ?? null,
    inspection_odometer_km: ip?.inspection_odometer_km ?? null,
    major_defect_count: ip?.major_defect_count ?? 0,
    safety_critical: ip?.safety_critical ?? 0,
    structural_condition_summary: ip?.structural_condition_summary ?? "NOT_PROVIDED",
    mechanical_condition_summary: ip?.mechanical_condition_summary ?? "NOT_PROVIDED",
    eligibility_status: ip?.eligibility_status ?? null,
    verified_document_count: docs.filter((d) => String(d.status) === "VERIFIED").length,
    finding_count: findingCount,
  };
}

export async function publicProductBundle(store: VehicleStore, auctionId: number) {
  const product = await resolvePublicVehicleProjection(store, auctionId);
  if (!product) return { product: null, facts: [], documents: [], history: [], modifications: [], equipment: [], findings: [] };
  const [effective, definitions, documents, history, modifications, equipment, projection] = await Promise.all([
    store.list("pi_effective_facts", params({ "filter[product_type][$eq]": "VEHICLE", "filter[product_id][$eq]": product.vehicle_id as number, limit: 300 })),
    store.list("pi_attribute_definitions", params({ "filter[active][$eq]": 1, limit: 300 })),
    resolvePublicVehicleDocuments(store, Number(product.vehicle_id)),
    store.list("vehicle_history_events", params({ "filter[vehicle_id][$eq]": product.vehicle_id as number, order: "-occurred_at", limit: 100 })),
    store.list("vehicle_modifications", params({ "filter[vehicle_id][$eq]": product.vehicle_id as number, order: "id", limit: 100 })),
    store.list("vehicle_equipment", params({ "filter[vehicle_id][$eq]": product.vehicle_id as number, order: "id", limit: 200 })),
    resolveVehicleInspectionProjection(store, Number(product.vehicle_id), auctionId),
  ]);
  const publicFacts: Array<Record<string, unknown>> = [];
  for (const fact of effective) {
    const definition = definitions.find((row) => Number(row.id) === Number(fact.attribute_id));
    if (!definition) continue;
    if (definition.privacy_policy_key === "PRODUCT_INTERNAL" || definition.privacy_policy_key === "PRODUCT_RESTRICTED") continue;
    if (definition.privacy_policy_key === "VEHICLE_IDENTIFIER_CLASSIFIED") {
      publicFacts.push({ key: definition.attribute_key, group: definition.display_group, value: "RECORDED", source: "Recorded privately", conflict: fact.conflict_state });
      continue;
    }
    publicFacts.push({
      key: definition.attribute_key,
      group: definition.display_group,
      value: factValue(fact as PiFact),
      unit: fact.measurement_unit ?? null,
      source: provenanceLabels[fact.source_class] ?? "Source recorded",
      conflict: fact.conflict_state,
    });
  }
  let findings: any[] = [];
  if (projection?.inspection_id) {
    findings = await store.list("vehicle_inspection_findings", params({ "filter[inspection_id][$eq]": projection.inspection_id as number, order: "id", limit: 200 }));
  }
  return {
    product,
    facts: publicFacts,
    documents,
    history: history.map(({ asserted_by: _actor, created_by: _cby, ...row }) => row),
    modifications: modifications.map(({ asserted_by: _actor, created_by: _cby, ...row }) => row),
    equipment: equipment.map(({ asserted_by: _actor, created_by: _cby, ...row }) => row),
    findings: findings.map(({ created_by: _actor, evidence_document_id: _evidence, ...row }) => row),
  };
}

export type FilterClass = "PRIMARY" | "SECONDARY" | "ADVANCED" | "DISPLAY_ONLY" | "NONE";

export interface CategoryFilterItem {
  attributeKey: string;
  label: string;
  dataType: string;
  filterClass: FilterClass;
  unit: string | null;
  displayGroup: string;
  displayOrder: number;
  options: { key: string; label: string }[];
  range: { min?: number; max?: number } | null;
  operators: string[];
}

export async function categoryFilterMetadata(
  store: VehicleStore,
  categoryKey?: string | null,
): Promise<{
  category: { id: number; key: string; name: string } | null;
  schemaVersion: { id: number; key: string; version: number } | null;
  filters: CategoryFilterItem[];
}> {
  const categories = await store.list("categories", params({ "filter[active][$eq]": 1, limit: 300 }));
  const cat = (categoryKey
    ? categories.find((c: any) => c.category_key === categoryKey || c.slug === categoryKey)
    : null) ?? categories.find((c: any) => c.category_key === "VEHICLE_PASSENGER_CAR") ?? categories[0];

  if (!cat) return { category: null, schemaVersion: null, filters: [] };

  const schemas = await store.list("pi_category_schema_versions", params({
    "filter[category_id][$eq]": cat.id,
    "filter[status][$eq]": "ACTIVE",
    limit: 1,
  }));
  const schema = schemas[0] ?? null;
  if (!schema) {
    return {
      category: { id: cat.id, key: cat.category_key, name: cat.name },
      schemaVersion: null,
      filters: [],
    };
  }

  const [bindings, definitions, versions, labels, options, optionLabels] = await Promise.all([
    store.list("pi_category_attributes", params({ "filter[schema_version_id][$eq]": schema.id, limit: 300 })),
    store.list("pi_attribute_definitions", params({ "filter[active][$eq]": 1, limit: 300 })),
    store.list("pi_attribute_definition_versions", params({ limit: 300 })),
    store.list("pi_attribute_labels", params({ "filter[locale][$eq]": "en", limit: 300 })),
    store.list("pi_attribute_options", params({ "filter[active][$eq]": 1, order: "sort_order", limit: 1000 })),
    store.list("pi_attribute_option_labels", params({ "filter[locale][$eq]": "en", limit: 1000 })),
  ]);

  const filters: CategoryFilterItem[] = [];

  for (const binding of bindings) {
    const def = definitions.find((d: any) => Number(d.id) === Number(binding.attribute_id));
    if (!def) continue;

    const filterClass = (binding.filter_class ?? def.filter_class ?? "NONE") as FilterClass;
    if (filterClass === "NONE" || filterClass === "DISPLAY_ONLY") continue;

    const ver = versions.find((v: any) => Number(v.id) === Number(binding.attribute_version_id));
    const label = labels.find((l: any) => Number(l.attribute_id) === Number(def.id))?.label ?? def.attribute_key;

    let range: { min?: number; max?: number } | null = null;
    if (ver?.validation_json) {
      try {
        const parsed = JSON.parse(ver.validation_json);
        if (parsed.minimum != null || parsed.maximum != null) {
          range = { min: parsed.minimum, max: parsed.maximum };
        }
      } catch {
        /* ignore */
      }
    }

    const attributeOptions = options
      .filter((o: any) => Number(o.attribute_id) === Number(def.id))
      .map((o: any) => ({
        key: o.option_key,
        label: optionLabels.find((ol: any) => Number(ol.option_id) === Number(o.id))?.label ?? o.option_key,
      }));

    let operators = ["EQ"];
    switch (def.data_type) {
      case "ENUM":
      case "MULTI_ENUM":
        operators = ["EQ", "IN"];
        break;
      case "INTEGER":
      case "DECIMAL":
      case "MEASUREMENT":
        operators = ["MIN", "MAX", "BETWEEN", "EQ"];
        break;
      case "BOOLEAN":
        operators = ["EQ"];
        break;
      case "DATE":
        operators = ["MIN", "MAX", "BETWEEN", "EQ"];
        break;
      default:
        operators = ["EQ", "IN", "EXISTS"];
    }

    filters.push({
      attributeKey: def.attribute_key,
      label,
      dataType: def.data_type,
      filterClass,
      unit: ver?.canonical_unit ?? null,
      displayGroup: binding.display_group ?? def.display_group,
      displayOrder: binding.display_order ?? def.display_order,
      options: attributeOptions,
      range,
      operators,
    });
  }

  filters.sort((a, b) => {
    const rank: Record<FilterClass, number> = { PRIMARY: 1, SECONDARY: 2, ADVANCED: 3, DISPLAY_ONLY: 4, NONE: 5 };
    if (rank[a.filterClass] !== rank[b.filterClass]) return rank[a.filterClass] - rank[b.filterClass];
    return a.displayOrder - b.displayOrder;
  });

  return {
    category: { id: cat.id, key: cat.category_key, name: cat.name },
    schemaVersion: { id: schema.id, key: schema.schema_key, version: schema.version },
    filters,
  };
}

export type ComparisonState = "KNOWN" | "UNKNOWN" | "CONFLICTED" | "REDACTED" | "NOT_APPLICABLE";

export interface ComparisonCell {
  state: ComparisonState;
  rawValue: unknown;
  displayValue: string;
  unit: string | null;
  provenance?: string;
  conflictState?: string;
}

export interface ComparisonRow {
  attributeKey: string;
  label: string;
  section: string;
  unit: string | null;
  values: ComparisonCell[];
}

export interface ProductComparisonResponse {
  items: Array<{
    auctionId: number;
    title: string;
    currentPrice: number;
    thumbnail: string | null;
    categoryKey: string;
    productType: string;
    endsAt: string;
    status: string;
  }>;
  categoryRelationship: "SAME_LEAF" | "RELATED_FAMILY" | "UNRELATED";
  sections: Array<{
    title: string;
    rows: ComparisonRow[];
  }>;
}

export async function productCompare(
  store: VehicleStore,
  auctionIds: number[],
): Promise<ProductComparisonResponse> {
  const boundedIds = Array.isArray(auctionIds) ? auctionIds.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 3) : [];
  if (!boundedIds.length) {
    return { items: [], categoryRelationship: "UNRELATED", sections: [] };
  }

  const bundles = await Promise.all(boundedIds.map(async (id) => {
    const [auction, bundle, psi] = await Promise.all([
      store.get("auctions", id),
      publicProductBundle(store, id).catch(() => null),
      (store.list("product_search_index", params({ "filter[auction_id][$eq]": id, limit: 1 }))).then((r) => r[0]).catch(() => null),
    ]);
    let category = null;
    if (auction?.product_category_id) {
      category = await store.get("categories", auction.product_category_id).catch(() => null);
    }
    return { auctionId: id, auction, bundle, psi, category };
  }));

  const items = bundles.map((b) => {
    const a = b.auction ?? {};
    let thumbnail: string | null = null;
    try {
      const imgs = JSON.parse(a.images || "[]");
      if (Array.isArray(imgs) && imgs[0]) thumbnail = String(imgs[0]);
    } catch {
      /* ignore */
    }
    const catKey = b.bundle?.product?.category_key ?? b.psi?.category_key ?? b.category?.category_key ?? "GENERAL";
    const prodType = b.bundle?.product?.product_type ?? b.category?.name ?? "General Item";
    return {
      auctionId: b.auctionId,
      title: a.title ?? b.psi?.title ?? `Auction #${b.auctionId}`,
      currentPrice: Number(a.current_price ?? a.start_price ?? b.psi?.price ?? 0),
      thumbnail,
      categoryKey: catKey,
      productType: prodType,
      endsAt: a.ends_at ?? b.psi?.ending_time ?? "",
      status: a.status ?? b.psi?.auction_status ?? "live",
    };
  });

  const catKeys = items.map((i) => i.categoryKey);
  const allSameLeaf = catKeys.every((k) => k === catKeys[0]);
  const allVehicle = catKeys.every((k) => k.startsWith("VEHICLE_"));
  const categoryRelationship: "SAME_LEAF" | "RELATED_FAMILY" | "UNRELATED" = allSameLeaf
    ? "SAME_LEAF"
    : allVehicle
      ? "RELATED_FAMILY"
      : "UNRELATED";

  const rows: ComparisonRow[] = [];

  const addRow = (
    attributeKey: string,
    label: string,
    section: string,
    unit: string | null,
    extractor: (b: typeof bundles[0]) => { value: unknown; state?: ComparisonState; unit?: string | null; provenance?: string; conflict?: string },
  ) => {
    const values: ComparisonCell[] = bundles.map((b) => {
      if (!b.auction && !b.psi && !b.bundle) {
        return { state: "UNKNOWN", rawValue: null, displayValue: "Not provided", unit };
      }
      const ext = extractor(b);
      const state = ext.state ?? (ext.value != null && ext.value !== "" ? "KNOWN" : "UNKNOWN");
      let displayValue = "Not provided";
      if (state === "KNOWN") {
        if (typeof ext.value === "boolean") {
          displayValue = ext.value ? "Yes" : "No";
        } else if (typeof ext.value === "number") {
          displayValue = unit ? `${ext.value.toLocaleString()} ${unit}` : ext.value.toLocaleString();
        } else {
          displayValue = String(ext.value);
        }
      } else if (state === "UNKNOWN") {
        displayValue = "Not provided";
      } else if (state === "CONFLICTED") {
        displayValue = `Conflicted (${ext.conflict || "Disputed"})`;
      } else if (state === "REDACTED") {
        displayValue = "Recorded privately";
      } else if (state === "NOT_APPLICABLE") {
        displayValue = "N/A";
      }
      return {
        state,
        rawValue: ext.value,
        displayValue,
        unit: ext.unit ?? unit,
        provenance: ext.provenance,
        conflictState: ext.conflict,
      };
    });
    rows.push({ attributeKey, label, section, unit, values });
  };

  // 1. Identity section
  addRow("MODEL_YEAR", "Year", "Identity", null, (b) => ({
    value: b.bundle?.product?.model_year ?? b.psi?.year ?? null,
  }));
  addRow("MAKE", "Make", "Identity", null, (b) => ({
    value: b.bundle?.product?.make ?? b.psi?.make ?? null,
  }));
  addRow("MODEL", "Model", "Identity", null, (b) => ({
    value: b.bundle?.product?.model ?? b.psi?.model ?? null,
  }));
  if (categoryRelationship !== "UNRELATED") {
    addRow("GENERATION", "Generation", "Identity", null, (b) => ({
      value: b.bundle?.product?.generation_series ?? b.psi?.generation ?? null,
    }));
    addRow("VARIANT", "Variant", "Identity", null, (b) => ({
      value: b.bundle?.product?.variant ?? b.psi?.variant ?? null,
    }));
    addRow("TRIM", "Trim", "Identity", null, (b) => ({
      value: b.bundle?.product?.trim ?? b.psi?.trim ?? null,
    }));
    addRow("MODEL_CODE", "Model Code", "Identity", null, (b) => ({
      value: b.bundle?.product?.model_code ?? b.psi?.model_code ?? null,
    }));

    // 2. Configuration section
    addRow("VEHICLE_CLASS", "Vehicle Class", "Configuration", null, (b) => ({
      value: b.bundle?.product?.vehicle_class ?? b.psi?.vehicle_class ?? null,
    }));
    addRow("BODY_TYPE", "Body Type", "Configuration", null, (b) => ({
      value: b.bundle?.product?.body_type ?? b.psi?.body_type ?? null,
    }));
    addRow("CAB_TYPE", "Cab Type", "Configuration", null, (b) => ({
      value: b.bundle?.product?.cab_type ?? null,
    }));
    addRow("DOORS", "Doors", "Configuration", null, (b) => ({
      value: b.bundle?.product?.doors ?? null,
    }));
    addRow("SEATS", "Seats", "Configuration", null, (b) => ({
      value: b.bundle?.product?.seats ?? null,
    }));

    // 3. Usage section
    addRow("ODOMETER_KM", "Mileage", "Usage", "km", (b) => {
      const p = b.bundle?.product;
      const km = p?.effective_odometer_km ?? b.psi?.mileage ?? null;
      const isConflict = p?.odometer_conflict && p.odometer_conflict !== "NONE";
      return {
        value: km,
        state: isConflict ? "CONFLICTED" : km != null ? "KNOWN" : "UNKNOWN",
        conflict: p?.odometer_conflict,
        provenance: p?.odometer_source,
      };
    });

    // 4. Powertrain section
    addRow("FUEL_TYPE", "Fuel", "Powertrain", null, (b) => ({
      value: b.bundle?.product?.fuel_type ?? b.psi?.fuel ?? null,
    }));
    addRow("ENGINE_DISPLACEMENT_CC", "Engine Displacement", "Powertrain", "cc", (b) => ({
      value: b.bundle?.product?.engine_displacement_cc ?? null,
    }));
    addRow("POWER_KW", "Power", "Powertrain", "kW", (b) => ({
      value: b.bundle?.product?.power_kw ?? null,
    }));
    addRow("TORQUE_NM", "Torque", "Powertrain", "Nm", (b) => ({
      value: b.bundle?.product?.torque_nm ?? null,
    }));
    addRow("TRANSMISSION", "Transmission", "Powertrain", null, (b) => ({
      value: b.bundle?.product?.transmission ?? b.psi?.transmission ?? null,
    }));
    addRow("GEAR_COUNT", "Gears", "Powertrain", null, (b) => ({
      value: b.bundle?.product?.gear_count ?? null,
    }));
    addRow("DRIVETRAIN", "Drivetrain", "Powertrain", null, (b) => ({
      value: b.bundle?.product?.drivetrain ?? b.psi?.drivetrain ?? null,
    }));

    // 5. Physical section
    addRow("EXTERIOR_COLOUR", "Exterior Colour", "Physical", null, (b) => ({
      value: b.bundle?.product?.primary_exterior_colour ?? b.psi?.exterior_colour ?? null,
    }));
    addRow("STEERING_SIDE", "Steering Side", "Physical", null, (b) => ({
      value: b.bundle?.product?.steering_side ?? b.psi?.steering_side ?? null,
    }));

    // 6. History section
    addRow("SERVICE_HISTORY_CLASS", "Service History", "History", null, (b) => ({
      value: b.bundle?.product?.service_history_class ?? b.psi?.service_history_class ?? null,
    }));
    addRow("ACCIDENT_HISTORY", "Accident History", "History", null, (b) => ({
      value: b.bundle?.product?.accident_history ?? b.psi?.accident_history ?? null,
    }));
    addRow("REPAIR_HISTORY", "Repair History", "History", null, (b) => ({
      value: b.bundle?.product?.repair_history ?? b.psi?.repair_history ?? null,
    }));
    addRow("MODIFICATION_STATUS", "Modification Status", "History", null, (b) => ({
      value: b.bundle?.product?.modification_status ?? b.psi?.modification_status ?? null,
    }));
    addRow("CUSTOMS_STATUS", "Customs Status", "History", null, (b) => ({
      value: b.bundle?.product?.customs_status ?? b.psi?.customs_status ?? null,
    }));

    // 7. Condition section
    addRow("INSPECTION_GRADE", "Inspection Grade", "Condition", null, (b) => ({
      value: b.bundle?.product?.inspection_grade ?? b.psi?.inspection_grade ?? null,
    }));
    addRow("ROADWORTHY", "Roadworthy", "Condition", null, (b) => {
      const rw = b.bundle?.product?.roadworthy ?? b.psi?.roadworthy;
      return { value: rw != null ? Boolean(rw) : null };
    });
    addRow("MAJOR_DEFECT_COUNT", "Major Defects", "Condition", null, (b) => ({
      value: b.bundle?.product?.major_defect_count ?? null,
    }));

    // 8. Provenance section
    addRow("VIN_CLASSIFICATION", "VIN Status", "Provenance", null, () => ({
      value: "RECORDED",
      state: "REDACTED",
    }));

    // 9. Equipment section
    addRow("NUMBER_OF_KEYS", "Keys", "Equipment", null, (b) => ({
      value: b.bundle?.product?.number_of_keys ?? null,
    }));
    addRow("SPARE_WHEEL", "Spare Wheel", "Equipment", null, (b) => {
      const sw = b.bundle?.product?.spare_wheel;
      return { value: sw != null ? Boolean(sw) : null };
    });
  }

  // 10. Commercial section (always present for all comparisons)
  addRow("LOCATION", "Location", "Commercial", null, (b) => ({
    value: b.auction?.city ?? b.psi?.location ?? null,
  }));
  addRow("CURRENT_PRICE", "Current Price", "Commercial", "USD", (b) => ({
    value: Number(b.auction?.current_price ?? b.auction?.start_price ?? b.psi?.price ?? 0),
  }));
  addRow("RESERVE_DISCLOSURE", "Reserve", "Commercial", null, (b) => ({
    value: b.auction?.reserve_disclosure ?? b.psi?.reserve_disclosure ?? "UNSPECIFIED",
  }));
  addRow("ENDS_AT", "Auction Ends", "Commercial", null, (b) => ({
    value: b.auction?.ends_at ?? b.psi?.ending_time ?? null,
  }));

  const sectionMap = new Map<string, ComparisonRow[]>();
  for (const r of rows) {
    const list = sectionMap.get(r.section) ?? [];
    list.push(r);
    sectionMap.set(r.section, list);
  }

  return {
    items,
    categoryRelationship,
    sections: Array.from(sectionMap.entries()).map(([title, srows]) => ({ title, rows: srows })),
  };
}

