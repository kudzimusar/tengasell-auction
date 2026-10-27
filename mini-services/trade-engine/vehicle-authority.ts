// IMP-04 server-side Vehicle / Tengasell Inspection authority.
// All writes are mediated by the canonical trade engine admin session; browser
// clients have no direct TrailBase ACL to these collections.

import { appendProductFact } from "./product-intelligence"

export interface VehicleIdentity {
  id: string
  username: string
  admin: boolean
}

export interface VehicleStore {
  create(table: string, row: unknown): Promise<number | null>
  get(table: string, id: number | string): Promise<any | null>
  list(table: string, params: string): Promise<any[]>
  update(table: string, id: number | string, patch: unknown): Promise<boolean>
}

export type VehicleAudit = (
  user: string | null,
  action: string,
  entity: string,
  entityId: number | null,
  source: string,
  payload: unknown,
) => Promise<void>

export type VehiclePermission = {
  inspect: boolean
  review: boolean
  administer: boolean
}

export type VehicleIntakeInput = {
  vin?: string | null
  chassisNumber?: string | null
  registrationNumber?: string | null
  make: string
  model: string
  variant?: string | null
  modelYear: number
  engineNumber?: string | null
  engineDisplacementCc?: number | null
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC" | "LPG" | "OTHER" | "UNKNOWN"
  transmission: "MANUAL" | "AUTOMATIC" | "CVT" | "DCT" | "OTHER" | "UNKNOWN"
  drivetrain: "FWD" | "RWD" | "AWD" | "4WD" | "OTHER" | "UNKNOWN"
  odometerKm: number
  locationCity: string
  locationCountry?: string
  ownershipStatus: "DECLARED_OWNER" | "FINANCED" | "THIRD_PARTY" | "UNKNOWN"
  customsStatus: "LOCAL" | "CLEARED" | "PENDING" | "NOT_APPLICABLE" | "UNKNOWN"
  requestedDurationHours: number
  vehicleClass?: string | null
  bodyType?: string | null
  modelCode?: string | null
  generationSeries?: string | null
  trim?: string | null
  manufactureYear?: number | null
  firstRegistrationDate?: string | null
  steeringSide?: string | null
  doors?: number | null
  seats?: number | null
  cabType?: string | null
  primaryExteriorColour?: string | null
  manufacturerColourName?: string | null
  manufacturerColourCode?: string | null
  interiorColour?: string | null
  interiorMaterial?: string | null
  engineCode?: string | null
  powerKw?: number | null
  torqueNm?: number | null
  gearCount?: number | null
  hybridType?: string | null
  evBatteryCapacityKwh?: number | null
  evRangeKm?: number | null
  ownerCount?: number | null
  originCountry?: string | null
  firstRegistrationCountry?: string | null
  importSourceCountry?: string | null
  serviceHistoryClass?: string | null
  accidentHistory?: string | null
  repairHistory?: string | null
  structuralRepairHistory?: string | null
  modificationStatus?: string | null
  numberOfKeys?: number | null
  spareKey?: boolean | null
  spareWheel?: boolean | null
  toolKit?: boolean | null
  manuals?: boolean | null
  serviceBook?: boolean | null
}

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")
const clean = (v: unknown, max = 160) => String(v ?? "").trim().slice(0, max)
const nullable = (v: unknown, max = 160) => {
  const value = clean(v, max)
  return value ? value : null
}
const vinValue = (v: unknown) => clean(v, 17).toUpperCase()

function params(fields: Record<string, string | number>) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) q.set(key, String(value))
  return q.toString()
}

export async function vehiclePermissions(
  store: VehicleStore,
  user: VehicleIdentity | null,
): Promise<VehiclePermission> {
  if (!user) return { inspect: false, review: false, administer: false }
  if (user.admin) return { inspect: true, review: true, administer: true }
  const roles = await store.list(
    "vehicle_staff_roles",
    params({ "filter[user][$eq]": user.id, "filter[active][$eq]": 1, limit: 10 }),
  )
  return {
    inspect: roles.some((r) => r.role === "INSPECTOR"),
    review: roles.some((r) => r.role === "REVIEWER"),
    administer: false,
  }
}

function validateIntake(input: VehicleIntakeInput): string | null {
  const vin = vinValue(input.vin)
  const chassis = clean(input.chassisNumber, 40).toUpperCase()
  if (!vin && !chassis) return "Enter a VIN or chassis number."
  if (vin && (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))) {
    return "VIN must be 17 uppercase VIN characters (I, O and Q are not valid)."
  }
  if (chassis && chassis.length < 4) return "Chassis number must be at least 4 characters."
  if (clean(input.make, 80).length < 2 || clean(input.model, 80).length < 1) {
    return "Make and model are required."
  }
  const year = Number(input.modelYear)
  const maxYear = new Date().getUTCFullYear() + 1
  if (!Number.isInteger(year) || year < 1900 || year > maxYear) return "Model year is invalid."
  if (!Number.isInteger(Number(input.odometerKm)) || Number(input.odometerKm) < 0) {
    return "Odometer must be a non-negative whole number."
  }
  const hours = Number(input.requestedDurationHours)
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) return "Auction duration is invalid."
  if (input.manufactureYear != null && (!Number.isInteger(Number(input.manufactureYear)) || Number(input.manufactureYear) < 1900 || Number(input.manufactureYear) > maxYear)) {
    return "Manufacture year is invalid."
  }
  if (input.doors != null && (!Number.isInteger(Number(input.doors)) || Number(input.doors) < 0 || Number(input.doors) > 20)) return "Door count is invalid."
  if (input.seats != null && (!Number.isInteger(Number(input.seats)) || Number(input.seats) < 1 || Number(input.seats) > 200)) return "Seat count is invalid."
  if (input.numberOfKeys != null && (!Number.isInteger(Number(input.numberOfKeys)) || Number(input.numberOfKeys) < 0 || Number(input.numberOfKeys) > 20)) return "Key count is invalid."
  return null
}

export async function saveVehicleIntake(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  auctionId: number,
  input: VehicleIntakeInput,
): Promise<{ ok: boolean; error?: string; vehicle?: any }> {
  const error = validateIntake(input)
  if (error) return { ok: false, error }
  const auction = await store.get("auctions", auctionId)
  if (!auction) return { ok: false, error: "Auction not found." }
  if (String(auction.user) !== String(me.id) && !me.admin) {
    return { ok: false, error: "Only the seller can submit vehicle intake." }
  }
  if (auction.category !== "vehicles" || auction.asset_kind !== "vehicle") {
    return { ok: false, error: "This listing is not declared as a whole vehicle." }
  }
  if (auction.status !== "draft" || Number(auction.bid_count ?? 0) !== 0) {
    return { ok: false, error: "Vehicle intake is locked once commercial bidding can begin." }
  }

  const existing = (
    await store.list("vehicles", params({ "filter[auction_id][$eq]": auctionId, limit: 1 }))
  )[0]
  if (existing) {
    const inspections = await store.list(
      "vehicle_inspections",
      params({ "filter[vehicle_id][$eq]": existing.id, limit: 1 }),
    )
    if (inspections.length) {
      return { ok: false, error: "Vehicle identity is locked after inspection starts." }
    }
  }

  const row = {
    auction_id: auctionId,
    seller_user: me.id,
    seller_username: me.username,
    vin: vinValue(input.vin) || null,
    chassis_number: nullable(input.chassisNumber, 40)?.toUpperCase() ?? null,
    registration_number: nullable(input.registrationNumber, 40)?.toUpperCase() ?? null,
    make: clean(input.make, 80),
    model: clean(input.model, 80),
    variant: nullable(input.variant, 80),
    model_year: Number(input.modelYear),
    engine_number: nullable(input.engineNumber, 60)?.toUpperCase() ?? null,
    engine_displacement_cc:
      input.engineDisplacementCc == null ? null : Math.round(Number(input.engineDisplacementCc)),
    fuel_type: input.fuelType,
    transmission: input.transmission,
    drivetrain: input.drivetrain,
    odometer_km: Math.round(Number(input.odometerKm)),
    location_city: clean(input.locationCity, 100),
    location_country: clean(input.locationCountry || "Zimbabwe", 100),
    ownership_status: input.ownershipStatus,
    customs_status: input.customsStatus,
    requested_duration_hours: Number(input.requestedDurationHours),
    vehicle_class: nullable(input.vehicleClass, 40),
    body_type: nullable(input.bodyType, 40),
    model_code: nullable(input.modelCode, 80),
    generation_series: nullable(input.generationSeries, 100),
    trim: nullable(input.trim, 100),
    manufacture_year: input.manufactureYear == null ? null : Number(input.manufactureYear),
    first_registration_date: nullable(input.firstRegistrationDate, 40),
    steering_side: nullable(input.steeringSide, 20),
    doors: input.doors == null ? null : Number(input.doors),
    seats: input.seats == null ? null : Number(input.seats),
    cab_type: nullable(input.cabType, 30),
    primary_exterior_colour: nullable(input.primaryExteriorColour, 30),
    manufacturer_colour_name: nullable(input.manufacturerColourName, 100),
    manufacturer_colour_code: nullable(input.manufacturerColourCode, 60),
    interior_colour: nullable(input.interiorColour, 30),
    interior_material: nullable(input.interiorMaterial, 40),
    engine_code: nullable(input.engineCode, 80),
    power_kw: input.powerKw == null ? null : Number(input.powerKw),
    torque_nm: input.torqueNm == null ? null : Number(input.torqueNm),
    gear_count: input.gearCount == null ? null : Number(input.gearCount),
    hybrid_type: nullable(input.hybridType, 40),
    ev_battery_capacity_kwh: input.evBatteryCapacityKwh == null ? null : Number(input.evBatteryCapacityKwh),
    ev_range_km: input.evRangeKm == null ? null : Number(input.evRangeKm),
    owner_count: input.ownerCount == null ? null : Number(input.ownerCount),
    origin_country: nullable(input.originCountry, 100),
    first_registration_country: nullable(input.firstRegistrationCountry, 100),
    import_source_country: nullable(input.importSourceCountry, 100),
    service_history_class: nullable(input.serviceHistoryClass, 40),
    accident_history: nullable(input.accidentHistory, 40),
    repair_history: nullable(input.repairHistory, 40),
    structural_repair_history: nullable(input.structuralRepairHistory, 50),
    modification_status: nullable(input.modificationStatus, 40),
    number_of_keys: input.numberOfKeys == null ? null : Number(input.numberOfKeys),
    spare_key: input.spareKey == null ? null : input.spareKey ? 1 : 0,
    spare_wheel: input.spareWheel == null ? null : input.spareWheel ? 1 : 0,
    tool_kit: input.toolKit == null ? null : input.toolKit ? 1 : 0,
    manuals: input.manuals == null ? null : input.manuals ? 1 : 0,
    service_book: input.serviceBook == null ? null : input.serviceBook ? 1 : 0,
    declaration_accepted_at: nowIso(),
    lifecycle: "INTAKE",
    updated_at: nowIso(),
  }

  let vehicleId: number
  if (existing) {
    const ok = await store.update("vehicles", existing.id, row)
    if (!ok) return { ok: false, error: "Vehicle intake could not be updated." }
    vehicleId = Number(existing.id)
  } else {
    const id = await store.create("vehicles", { ...row, created_at: nowIso() })
    if (id == null) return { ok: false, error: "Vehicle intake could not be created." }
    vehicleId = id
  }

  for (const [fieldKey, value] of Object.entries(row)) {
    if (["auction_id","seller_user","seller_username","created_at","updated_at","lifecycle"].includes(fieldKey)) continue
    await store.create("vehicle_evidence", {
      vehicle_id: vehicleId,
      field_key: fieldKey,
      source_type: "SELLER_DECLARATION",
      source_id: null,
      value_json: JSON.stringify({ value }),
      asserted_by: me.id,
      verified_by: null,
      verified_at: null,
      created_at: nowIso(),
    })
  }
  const factMap: Record<string, unknown> = {
    VIN: row.vin,
    CHASSIS_NUMBER: row.chassis_number,
    REGISTRATION_NUMBER: row.registration_number,
    MAKE: row.make,
    MODEL: row.model,
    VARIANT: row.variant,
    TRIM: row.trim,
    MODEL_YEAR: row.model_year,
    MANUFACTURE_YEAR: row.manufacture_year,
    FIRST_REGISTRATION_DATE: row.first_registration_date,
    VEHICLE_CLASS: row.vehicle_class,
    BODY_TYPE: row.body_type,
    FUEL_TYPE: row.fuel_type,
    TRANSMISSION: row.transmission,
    DRIVETRAIN: row.drivetrain,
    ODOMETER_KM: { value: row.odometer_km, unit: "km" },
    ENGINE_DISPLACEMENT_CC: row.engine_displacement_cc,
    ENGINE_CODE: row.engine_code,
    ENGINE_NUMBER: row.engine_number,
    POWER_KW: row.power_kw,
    TORQUE_NM: row.torque_nm,
    GEAR_COUNT: row.gear_count,
    STEERING_SIDE: row.steering_side,
    DOORS: row.doors,
    SEATS: row.seats,
    EXTERIOR_COLOUR: row.primary_exterior_colour,
    INTERIOR_COLOUR: row.interior_colour,
    SERVICE_HISTORY_CLASS: row.service_history_class,
    ACCIDENT_HISTORY: row.accident_history,
    REPAIR_HISTORY: row.repair_history,
    STRUCTURAL_REPAIR_HISTORY: row.structural_repair_history,
    MODIFICATION_STATUS: row.modification_status,
    OWNERSHIP_STATUS: row.ownership_status,
    CUSTOMS_STATUS: row.customs_status,
    NUMBER_OF_KEYS: row.number_of_keys,
    SPARE_KEY: row.spare_key,
    SPARE_WHEEL: row.spare_wheel,
    TOOL_KIT: row.tool_kit,
    MANUALS: row.manuals,
    SERVICE_BOOK: row.service_book,
  }
  for (const [attributeKey, value] of Object.entries(factMap)) {
    if (value == null || (typeof value === "string" && !value)) continue
    const fact = await appendProductFact(store, {
      vehicleId,
      attributeKey,
      value,
      sourceClass: "SELLER_DECLARED",
      verificationState: "UNVERIFIED",
      actorId: me.id,
      sourceRefType: "vehicles",
      sourceRefId: vehicleId,
      supersedePriorFromSameSource: true,
      note: "Seller intake assertion",
    })
    if (!fact.ok) return { ok: false, error: fact.error }
  }
  await audit(me.id, "vehicle:intake", "vehicles", vehicleId, "trade-engine", {
    auctionId,
    declaration: true,
  })
  return { ok: true, vehicle: await store.get("vehicles", vehicleId) }
}

export async function vehicleBundle(
  store: VehicleStore,
  auctionId: number,
  viewer: VehicleIdentity | null,
) {
  const vehicle = (
    await store.list("vehicles", params({ "filter[auction_id][$eq]": auctionId, limit: 1 }))
  )[0]
  const permissions = await vehiclePermissions(store, viewer)
  if (!vehicle) return { vehicle: null, permissions }
  const operationGrants = viewer
    ? await store.list("auction_operation_grants", params({ "filter[user][$eq]": viewer.id, "filter[active][$eq]": 1, limit: 20 }))
    : []
  const authorised = !!viewer && (
    viewer.admin || permissions.inspect || permissions.review ||
    String(vehicle.seller_user) === String(viewer.id) || operationGrants.length > 0
  )
  if (!authorised) {
    return { vehicle: null, permissions, errorCode: viewer ? "VEHICLE_INTERNAL_AUTH_REQUIRED" : "AUTH_REQUIRED" }
  }

  const [documents, inspections, eligibility] = await Promise.all([
    store.list("vehicle_documents", params({ "filter[vehicle_id][$eq]": vehicle.id, order: "-id", limit: 100 })),
    store.list("vehicle_inspections", params({ "filter[vehicle_id][$eq]": vehicle.id, order: "-version", limit: 20 })),
    store.list("vehicle_eligibility", params({ "filter[vehicle_id][$eq]": vehicle.id, order: "-version", limit: 20 })),
  ])
  const latestInspection = inspections[0] ?? null
  const latestEligibility = eligibility[0] ?? null
  const [findings, reasons, evidence] = await Promise.all([
    latestInspection
      ? store.list("vehicle_inspection_findings", params({ "filter[inspection_id][$eq]": latestInspection.id, order: "id", limit: 200 }))
      : Promise.resolve([]),
    latestEligibility
      ? store.list("vehicle_eligibility_reasons", params({ "filter[eligibility_id][$eq]": latestEligibility.id, order: "id", limit: 50 }))
      : Promise.resolve([]),
    store.list("vehicle_evidence", params({ "filter[vehicle_id][$eq]": vehicle.id, order: "id", limit: 300 })),
  ])
  const publicDocuments = documents.map((d) => ({
    id: d.id,
    document_type: d.document_type,
    document_ref: d.document_ref,
    issuer: d.issuer,
    issued_at: d.issued_at,
    expires_at: d.expires_at,
    status: d.status,
    verified_at: d.verified_at,
    rejection_reason:
      viewer && (permissions.inspect || permissions.review || String(vehicle.seller_user) === String(viewer.id))
        ? d.rejection_reason
        : null,
  }))
  const provenance = evidence.reduce<Record<string, string>>((out, e) => {
    const rank: Record<string, number> = { SELLER_DECLARATION: 1, DOCUMENT: 2, INSPECTION: 3, REVIEW: 4 }
    const current = out[e.field_key]
    if (!current || rank[e.source_type] > rank[current]) out[e.field_key] = e.source_type
    return out
  }, {})

  return {
    vehicle,
    documents: publicDocuments,
    inspections,
    inspection: latestInspection,
    findings,
    eligibility: latestEligibility,
    eligibilityReasons: reasons,
    provenance,
    permissions,
  }
}


async function ownedVehicle(store: VehicleStore, me: VehicleIdentity, vehicleId: number) {
  const vehicle = await store.get("vehicles", vehicleId)
  if (!vehicle) return { vehicle: null, error: "Vehicle not found." }
  if (String(vehicle.seller_user) !== String(me.id) && !me.admin) {
    return { vehicle: null, error: "Only the seller can manage this vehicle." }
  }
  return { vehicle, error: null }
}

export async function addVehicleHistoryEvent(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  vehicleId: number,
  input: any,
) {
  const owned = await ownedVehicle(store, me, vehicleId)
  if (!owned.vehicle) return { ok: false, error: owned.error }
  const allowed = new Set([
    "SERVICE","MAINTENANCE","ACCIDENT","DAMAGE","REPAIR","STRUCTURAL_REPAIR","PAINTWORK",
    "OWNERSHIP_CHANGE","REGISTRATION","IMPORT","CUSTOMS_CLEARANCE","MILEAGE_RECORD","OTHER",
  ])
  const eventType = clean(input?.eventType, 40).toUpperCase()
  if (!allowed.has(eventType)) return { ok: false, error: "Unsupported vehicle history event type." }
  const title = clean(input?.title, 160)
  if (title.length < 3) return { ok: false, error: "History event title is required." }
  const odometer = input?.odometerKm == null || input?.odometerKm === "" ? null : Math.round(Number(input.odometerKm))
  if (odometer != null && (!Number.isInteger(odometer) || odometer < 0)) return { ok: false, error: "History odometer is invalid." }
  const id = await store.create("vehicle_history_events", {
    vehicle_id: vehicleId,
    event_type: eventType,
    occurred_on: nullable(input?.occurredOn, 40),
    odometer_km: odometer,
    title,
    description: clean(input?.description, 1200),
    provider_name: nullable(input?.providerName, 160),
    country_code: nullable(input?.countryCode, 8)?.toUpperCase() ?? null,
    source_class: "SELLER_DECLARED",
    source_fact_assertion_id: null,
    created_by: me.id,
    created_at: nowIso(),
  })
  if (id == null) return { ok: false, error: "Vehicle history event could not be recorded." }
  const derived: Record<string, { attributeKey: string; value: unknown }> = {
    ACCIDENT: { attributeKey: "ACCIDENT_HISTORY", value: "ACCIDENT_DECLARED" },
    DAMAGE: { attributeKey: "ACCIDENT_HISTORY", value: "DAMAGE_DECLARED" },
    REPAIR: { attributeKey: "REPAIR_HISTORY", value: "REPAIRED" },
    PAINTWORK: { attributeKey: "REPAIR_HISTORY", value: "PAINTWORK" },
    STRUCTURAL_REPAIR: { attributeKey: "STRUCTURAL_REPAIR_HISTORY", value: "STRUCTURAL_REPAIR_DECLARED" },
  }
  if (derived[eventType]) {
    const fact = await appendProductFact(store, {
      vehicleId,
      ...derived[eventType],
      sourceClass: "SELLER_DECLARED",
      verificationState: "UNVERIFIED",
      actorId: me.id,
      sourceRefType: "vehicle_history_events",
      sourceRefId: id,
      supersedePriorFromSameSource: true,
      note: `Structured ${eventType.toLowerCase()} history assertion`,
    })
    if (!fact.ok) return { ok: false, error: fact.error }
  }
  await audit(me.id, "vehicle:history:add", "vehicle_history_events", id, "trade-engine", { vehicleId, eventType })
  return { ok: true, historyEvent: await store.get("vehicle_history_events", id) }
}

export async function addVehicleModification(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  vehicleId: number,
  input: any,
) {
  const owned = await ownedVehicle(store, me, vehicleId)
  if (!owned.vehicle) return { ok: false, error: owned.error }
  const allowed = new Set(["ENGINE","DRIVETRAIN","SUSPENSION","BRAKES","WHEELS_TYRES","BODY","INTERIOR","ELECTRICAL","SAFETY","ACCESSIBILITY","COMMERCIAL_CONVERSION","OTHER"])
  const category = clean(input?.category, 50).toUpperCase()
  if (!allowed.has(category)) return { ok: false, error: "Unsupported modification category." }
  const title = clean(input?.title, 160)
  if (title.length < 3) return { ok: false, error: "Modification title is required." }
  const id = await store.create("vehicle_modifications", {
    vehicle_id: vehicleId,
    modification_category: category,
    title,
    description: clean(input?.description, 1200),
    installed_on: nullable(input?.installedOn, 40),
    installer: nullable(input?.installer, 160),
    approval_reference: nullable(input?.approvalReference, 160),
    reversible: input?.reversible == null ? null : input.reversible ? 1 : 0,
    status: "DECLARED",
    source_fact_assertion_id: null,
    created_by: me.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  })
  if (id == null) return { ok: false, error: "Vehicle modification could not be recorded." }
  const fact = await appendProductFact(store, {
    vehicleId,
    attributeKey: "MODIFICATION_STATUS",
    value: "MODIFIED",
    sourceClass: "SELLER_DECLARED",
    verificationState: "UNVERIFIED",
    actorId: me.id,
    sourceRefType: "vehicle_modifications",
    sourceRefId: id,
    supersedePriorFromSameSource: true,
    note: "Structured modification declaration",
  })
  if (!fact.ok) return { ok: false, error: fact.error }
  await audit(me.id, "vehicle:modification:add", "vehicle_modifications", id, "trade-engine", { vehicleId, category })
  return { ok: true, modification: await store.get("vehicle_modifications", id) }
}

export async function addVehicleEquipment(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  vehicleId: number,
  input: any,
) {
  const owned = await ownedVehicle(store, me, vehicleId)
  if (!owned.vehicle) return { ok: false, error: owned.error }
  const allowed = new Set(["FACTORY_OPTION","AFTERMARKET_EQUIPMENT","INCLUDED_ACCESSORY","DOCUMENT","TOOL","OTHER_EQUIPMENT"])
  const equipmentType = clean(input?.equipmentType, 50).toUpperCase()
  if (!allowed.has(equipmentType)) return { ok: false, error: "Unsupported equipment type." }
  const label = clean(input?.label, 160)
  if (label.length < 2) return { ok: false, error: "Equipment label is required." }
  const quantity = Math.round(Number(input?.quantity ?? 1))
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: "Equipment quantity is invalid." }
  const id = await store.create("vehicle_equipment", {
    vehicle_id: vehicleId,
    equipment_type: equipmentType,
    equipment_key: nullable(input?.equipmentKey, 120),
    label,
    description: clean(input?.description, 800),
    quantity,
    included: input?.included === false ? 0 : 1,
    condition_state: nullable(input?.conditionState, 30),
    source_fact_assertion_id: null,
    created_by: me.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  })
  if (id == null) return { ok: false, error: "Vehicle equipment could not be recorded." }
  await audit(me.id, "vehicle:equipment:add", "vehicle_equipment", id, "trade-engine", { vehicleId, equipmentType })
  return { ok: true, equipment: await store.get("vehicle_equipment", id) }
}

export async function addVehicleDocument(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  vehicleId: number,
  input: {
    documentType: string
    documentRef: string
    issuer?: string | null
    issuedAt?: string | null
    expiresAt?: string | null
    storageRef?: string | null
    documentNumber?: string | null
    artifactRequired?: boolean
  },
) {
  const owned = await ownedVehicle(store, me, vehicleId)
  if (!owned.vehicle) return { ok: false, error: owned.error }
  const allowed = new Set(["REGISTRATION","OWNERSHIP","CUSTOMS_CLEARANCE","IDENTITY","INSPECTION_PHOTO","OTHER"])
  if (!allowed.has(input.documentType)) return { ok: false, error: "Unsupported document type." }
  const ref = clean(input.documentRef, 120)
  if (ref.length < 2) return { ok: false, error: "Document reference is required." }

  const artifactRequired = input.artifactRequired ?? ["REGISTRATION","OWNERSHIP","CUSTOMS_CLEARANCE","IDENTITY"].includes(input.documentType)
  const storageRef = nullable(input.storageRef, 240)
  const id = await store.create("vehicle_documents", {
    vehicle_id: vehicleId,
    document_type: input.documentType,
    document_ref: ref,
    issuer: nullable(input.issuer, 120),
    issued_at: nullable(input.issuedAt, 40),
    expires_at: nullable(input.expiresAt, 40),
    storage_ref: storageRef,
    status: storageRef ? "UPLOADED" : "DECLARED",
    document_number: nullable(input.documentNumber, 120),
    artifact_required: artifactRequired ? 1 : 0,
    artifact_state: artifactRequired ? (storageRef ? "STORED" : "MISSING") : "NOT_REQUIRED",
    visibility_policy_key: "DOCUMENT_REFERENCE_CLASSIFIED",
    verified_artifact_hash: null,
    historic_review_required: 0,
    uploaded_by: me.id,
    verified_by: null,
    verified_at: null,
    rejection_reason: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  })
  if (id == null) return { ok: false, error: "Document could not be recorded." }
  await audit(me.id, "vehicle:document:add", "vehicle_documents", id, "trade-engine", {
    vehicleId,
    documentType: input.documentType,
  })
  return { ok: true, document: await store.get("vehicle_documents", id) }
}

export async function reviewVehicleDocument(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  documentId: number,
  action: "VERIFY" | "REJECT",
  reason?: string | null,
  derivedFact?: { attributeKey: string; value: unknown; extractionPath: string } | null,
) {
  const permissions = await vehiclePermissions(store, me)
  if (!permissions.inspect && !permissions.review) {
    return { ok: false, error: "Inspector or reviewer permission is required." }
  }
  const doc = await store.get("vehicle_documents", documentId)
  if (!doc) return { ok: false, error: "Vehicle document not found." }
  if (!["DECLARED","UPLOADED","REJECTED"].includes(String(doc.status))) {
    return { ok: false, error: "This document lifecycle no longer allows review." }
  }
  if (action === "REJECT" && clean(reason, 240).length < 5) {
    return { ok: false, error: "Give a rejection reason." }
  }
  if (action === "VERIFY" && Number(doc.artifact_required) === 1 && !doc.storage_ref) {
    return { ok: false, error: "The required document artefact must be stored before verification." }
  }
  const expired = doc.expires_at && Date.parse(doc.expires_at) <= Date.now()
  const status = expired ? "EXPIRED" : action === "VERIFY" ? "VERIFIED" : "REJECTED"
  const ok = await store.update("vehicle_documents", documentId, {
    status,
    verified_by: action === "VERIFY" && !expired ? me.id : null,
    verified_at: action === "VERIFY" && !expired ? nowIso() : null,
    rejection_reason: action === "REJECT" ? clean(reason, 240) : expired ? "Document expired." : null,
    artifact_state: action === "REJECT" ? "REJECTED" : status === "VERIFIED" && doc.storage_ref ? "VERIFIED" : doc.artifact_state,
    updated_at: nowIso(),
  })
  if (!ok) return { ok: false, error: "Document review could not be saved." }

  if (status === "VERIFIED") {
    await store.create("vehicle_evidence", {
      vehicle_id: Number(doc.vehicle_id),
      field_key: `document:${doc.document_type}`,
      source_type: "DOCUMENT",
      source_id: documentId,
      value_json: JSON.stringify({ documentRef: doc.document_ref, issuer: doc.issuer ?? null }),
      asserted_by: doc.uploaded_by,
      verified_by: me.id,
      verified_at: nowIso(),
      created_at: nowIso(),
    })
    if (derivedFact) {
      const fact = await appendProductFact(store, {
        vehicleId: Number(doc.vehicle_id),
        attributeKey: clean(derivedFact.attributeKey, 120).toUpperCase(),
        value: derivedFact.value,
        sourceClass: "DOCUMENT_DERIVED",
        verificationState: "VERIFIED",
        actorId: String(doc.uploaded_by),
        verifierId: me.id,
        sourceRefType: "vehicle_documents",
        sourceRefId: documentId,
        supersedePriorFromSameSource: false,
        note: `Derived from ${clean(derivedFact.extractionPath, 200)}`,
      })
      if (!fact.ok || !fact.assertion) return { ok: false, error: fact.error ?? "Document fact could not be recorded." }
      await store.create("pi_document_fact_assertions", {
        document_id: documentId,
        fact_assertion_id: Number(fact.assertion.id),
        extraction_path: clean(derivedFact.extractionPath, 240),
        created_by: me.id,
        created_at: nowIso(),
      })
    }
  }
  await audit(me.id, "vehicle:document:review", "vehicle_documents", documentId, "trade-engine", {
    status,
    reason: action === "REJECT" ? clean(reason, 240) : null,
  })
  return { ok: true, document: await store.get("vehicle_documents", documentId) }
}

export async function startVehicleInspection(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  vehicleId: number,
) {
  const permissions = await vehiclePermissions(store, me)
  if (!permissions.inspect) return { ok: false, error: "Inspector permission is required." }
  const vehicle = await store.get("vehicles", vehicleId)
  if (!vehicle) return { ok: false, error: "Vehicle not found." }
  const existing = await store.list(
    "vehicle_inspections",
    params({ "filter[vehicle_id][$eq]": vehicleId, order: "-version", limit: 1 }),
  )
  if (existing[0] && ["DRAFT","SUBMITTED"].includes(String(existing[0].lifecycle))) {
    return { ok: false, error: "An inspection is already in progress." }
  }
  const version = Number(existing[0]?.version ?? 0) + 1
  const id = await store.create("vehicle_inspections", {
    vehicle_id: vehicleId,
    version,
    inspector_user: me.id,
    inspector_name: me.username,
    reviewer_user: null,
    reviewer_name: null,
    lifecycle: "DRAFT",
    odometer_km: Number(vehicle.odometer_km),
    roadworthy: 1,
    notes: "",
    grade_score: null,
    grade: null,
    submitted_at: null,
    reviewed_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  })
  if (id == null) return { ok: false, error: "Inspection could not be started." }
  await store.update("vehicles", vehicleId, { lifecycle: "INSPECTION", updated_at: nowIso() })
  await audit(me.id, "vehicle:inspection:start", "vehicle_inspections", id, "trade-engine", {
    vehicleId,
    version,
  })
  return { ok: true, inspection: await store.get("vehicle_inspections", id) }
}

export async function addVehicleFinding(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  inspectionId: number,
  input: {
    category: string
    component: string
    location?: string | null
    severity: string
    description: string
    repairRecommended?: boolean
    safetyCritical?: boolean
    evidenceDocumentId?: number | null
  },
) {
  const permissions = await vehiclePermissions(store, me)
  if (!permissions.inspect) return { ok: false, error: "Inspector permission is required." }
  const inspection = await store.get("vehicle_inspections", inspectionId)
  if (!inspection) return { ok: false, error: "Inspection not found." }
  if (inspection.lifecycle !== "DRAFT") return { ok: false, error: "Only a draft inspection can be edited." }
  if (String(inspection.inspector_user) !== String(me.id) && !me.admin) {
    return { ok: false, error: "Only the assigned inspector can add findings." }
  }
  const categories = new Set(["BODY","STRUCTURAL","MECHANICAL","INTERIOR","TYRES","ELECTRICAL","GLASS","UNDERBODY"])
  const severities = new Set(["MINOR","MODERATE","MAJOR","CRITICAL"])
  if (!categories.has(input.category) || !severities.has(input.severity)) {
    return { ok: false, error: "Finding category or severity is invalid." }
  }
  const description = clean(input.description, 600)
  if (description.length < 5) return { ok: false, error: "Describe the inspection finding." }
  const id = await store.create("vehicle_inspection_findings", {
    inspection_id: inspectionId,
    category: input.category,
    component: clean(input.component, 120),
    location: nullable(input.location, 120),
    severity: input.severity,
    description,
    repair_recommended: input.repairRecommended ? 1 : 0,
    safety_critical: input.safetyCritical ? 1 : 0,
    evidence_document_id: input.evidenceDocumentId ?? null,
    created_by: me.id,
    created_at: nowIso(),
  })
  if (id == null) return { ok: false, error: "Finding could not be recorded." }
  await audit(me.id, "vehicle:inspection:finding", "vehicle_inspection_findings", id, "trade-engine", {
    inspectionId,
    severity: input.severity,
    safetyCritical: !!input.safetyCritical,
  })
  return { ok: true, finding: await store.get("vehicle_inspection_findings", id) }
}

export async function submitVehicleInspection(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  inspectionId: number,
  input: { roadworthy: boolean; odometerKm: number; notes?: string | null },
) {
  const permissions = await vehiclePermissions(store, me)
  if (!permissions.inspect) return { ok: false, error: "Inspector permission is required." }
  const inspection = await store.get("vehicle_inspections", inspectionId)
  if (!inspection) return { ok: false, error: "Inspection not found." }
  if (inspection.lifecycle !== "DRAFT") return { ok: false, error: "Inspection is not editable." }
  if (String(inspection.inspector_user) !== String(me.id) && !me.admin) {
    return { ok: false, error: "Only the assigned inspector can submit this inspection." }
  }
  const odometerKm = Math.round(Number(input.odometerKm))
  if (!Number.isInteger(odometerKm) || odometerKm < 0) {
    return { ok: false, error: "Inspection odometer is invalid." }
  }
  const ok = await store.update("vehicle_inspections", inspectionId, {
    roadworthy: input.roadworthy ? 1 : 0,
    odometer_km: odometerKm,
    notes: clean(input.notes, 1200),
    lifecycle: "SUBMITTED",
    submitted_at: nowIso(),
    updated_at: nowIso(),
  })
  if (!ok) return { ok: false, error: "Inspection could not be submitted." }
  await store.update("vehicles", Number(inspection.vehicle_id), {
    lifecycle: "REVIEW",
    updated_at: nowIso(),
  })
  await store.create("vehicle_evidence", {
    vehicle_id: Number(inspection.vehicle_id),
    field_key: "inspection",
    source_type: "INSPECTION",
    source_id: inspectionId,
    value_json: JSON.stringify({ roadworthy: !!input.roadworthy, odometerKm }),
    asserted_by: me.id,
    verified_by: me.id,
    verified_at: nowIso(),
    created_at: nowIso(),
  })
  for (const productFact of [
    { attributeKey: "ODOMETER_KM", value: { value: odometerKm, unit: "km" } },
    { attributeKey: "ROADWORTHY", value: !!input.roadworthy },
    { attributeKey: "INSPECTION_STATUS", value: "SUBMITTED" },
  ]) {
    const fact = await appendProductFact(store, {
      vehicleId: Number(inspection.vehicle_id),
      ...productFact,
      sourceClass: "INSPECTOR_VERIFIED",
      verificationState: "VERIFIED",
      actorId: me.id,
      verifierId: me.id,
      sourceRefType: "vehicle_inspections",
      sourceRefId: inspectionId,
      supersedePriorFromSameSource: true,
      note: "Tengasell inspection assertion",
    })
    if (!fact.ok) return { ok: false, error: fact.error }
  }
  await audit(me.id, "vehicle:inspection:submit", "vehicle_inspections", inspectionId, "trade-engine", {
    roadworthy: !!input.roadworthy,
    odometerKm,
  })
  return { ok: true, inspection: await store.get("vehicle_inspections", inspectionId) }
}

export async function reviewVehicleInspection(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  inspectionId: number,
  commandKey: string,
) {
  const permissions = await vehiclePermissions(store, me)
  if (!permissions.review) return { ok: false, error: "Reviewer permission is required." }
  const inspection = await store.get("vehicle_inspections", inspectionId)
  if (!inspection) return { ok: false, error: "Inspection not found." }
  if (inspection.lifecycle !== "SUBMITTED") return { ok: false, error: "Only a submitted inspection can be reviewed." }

  const key = clean(commandKey, 160)
  if (!key) return { ok: false, error: "Review command id is required." }
  let rows = await store.list(
    "vehicle_review_commands",
    params({ "filter[command_key][$eq]": key, limit: 1 }),
  )
  let command = rows[0]
  if (command) {
    if (
      Number(command.inspection_id) !== inspectionId ||
      String(command.reviewer_user) !== String(me.id)
    ) {
      return { ok: false, error: "Review command id was already used for a different request." }
    }
  } else {
    const id = await store.create("vehicle_review_commands", {
      command_key: key,
      vehicle_id: Number(inspection.vehicle_id),
      inspection_id: inspectionId,
      reviewer_user: me.id,
      reviewer_name: me.username,
    })
    command = id == null
      ? (await store.list("vehicle_review_commands", params({ "filter[command_key][$eq]": key, limit: 1 })))[0]
      : await store.get("vehicle_review_commands", id)
  }
  if (!command) return { ok: false, error: "Review command could not be persisted." }
  if (command.status !== "accepted") {
    return { ok: false, error: `Vehicle review rejected: ${command.error_code ?? "UNKNOWN"}`, command }
  }
  const inspectedVehicle = await store.get("vehicles", Number(inspection.vehicle_id))
  const gradeFact = await appendProductFact(store, {
    vehicleId: Number(inspection.vehicle_id),
    attributeKey: "INSPECTION_GRADE",
    value: command.result_grade,
    sourceClass: "INSPECTOR_VERIFIED",
    verificationState: "VERIFIED",
    actorId: me.id,
    verifierId: me.id,
    sourceRefType: "vehicle_review_commands",
    sourceRefId: Number(command.id),
    supersedePriorFromSameSource: true,
    note: "Controlled inspection review grade",
  })
  if (!gradeFact.ok) return { ok: false, error: gradeFact.error }
  await audit(me.id, "vehicle:review:ack", "vehicle_review_commands", Number(command.id), "trade-engine", {
    inspectionId,
    resultGrade: command.result_grade,
    eligibility: command.eligibility_status,
  })
  return {
    ok: true,
    command,
    bundle: await vehicleBundle(store, Number(inspectedVehicle?.auction_id), me),
  }
}

export async function grantVehicleRole(
  store: VehicleStore,
  audit: VehicleAudit,
  me: VehicleIdentity,
  target: { user: string; username: string; role: "INSPECTOR" | "REVIEWER" },
) {
  if (!me.admin) return { ok: false, error: "Administrator permission is required." }
  const existing = await store.list(
    "vehicle_staff_roles",
    params({ "filter[user][$eq]": target.user, "filter[role][$eq]": target.role, limit: 1 }),
  )
  if (existing[0]) {
    await store.update("vehicle_staff_roles", Number(existing[0].id), { active: 1 })
  } else {
    const id = await store.create("vehicle_staff_roles", {
      user: target.user,
      username: clean(target.username, 120),
      role: target.role,
      active: 1,
      granted_by: me.id,
      granted_at: nowIso(),
    })
    if (id == null) {
      // Composite-key record APIs may not return a numeric id; confirm the row.
      const confirmed = await store.list(
        "vehicle_staff_roles",
        params({ "filter[user][$eq]": target.user, "filter[role][$eq]": target.role, limit: 1 }),
      )
      if (!confirmed.length) return { ok: false, error: "Vehicle role could not be granted." }
    }
  }
  await audit(me.id, "vehicle:role:grant", "vehicle_staff_roles", null, "trade-engine", target)
  return { ok: true }
}
