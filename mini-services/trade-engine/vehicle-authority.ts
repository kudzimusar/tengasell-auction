// IMP-04 server-side Vehicle / Tengasell Inspection authority.
// All writes are mediated by the canonical trade engine admin session; browser
// clients have no direct TrailBase ACL to these collections.

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
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC" | "LPG" | "OTHER"
  transmission: "MANUAL" | "AUTOMATIC" | "CVT" | "DCT" | "OTHER"
  drivetrain: "FWD" | "RWD" | "AWD" | "4WD" | "OTHER"
  odometerKm: number
  locationCity: string
  locationCountry?: string
  ownershipStatus: "DECLARED_OWNER" | "FINANCED" | "THIRD_PARTY" | "UNKNOWN"
  customsStatus: "LOCAL" | "CLEARED" | "PENDING" | "NOT_APPLICABLE" | "UNKNOWN"
  requestedDurationHours: number
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
  },
) {
  const owned = await ownedVehicle(store, me, vehicleId)
  if (!owned.vehicle) return { ok: false, error: owned.error }
  const allowed = new Set(["REGISTRATION","OWNERSHIP","CUSTOMS_CLEARANCE","IDENTITY","INSPECTION_PHOTO","OTHER"])
  if (!allowed.has(input.documentType)) return { ok: false, error: "Unsupported document type." }
  const ref = clean(input.documentRef, 120)
  if (ref.length < 2) return { ok: false, error: "Document reference is required." }

  const id = await store.create("vehicle_documents", {
    vehicle_id: vehicleId,
    document_type: input.documentType,
    document_ref: ref,
    issuer: nullable(input.issuer, 120),
    issued_at: nullable(input.issuedAt, 40),
    expires_at: nullable(input.expiresAt, 40),
    storage_ref: nullable(input.storageRef, 240),
    status: input.storageRef ? "UPLOADED" : "DECLARED",
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
  const expired = doc.expires_at && Date.parse(doc.expires_at) <= Date.now()
  const status = expired ? "EXPIRED" : action === "VERIFY" ? "VERIFIED" : "REJECTED"
  const ok = await store.update("vehicle_documents", documentId, {
    status,
    verified_by: action === "VERIFY" && !expired ? me.id : null,
    verified_at: action === "VERIFY" && !expired ? nowIso() : null,
    rejection_reason: action === "REJECT" ? clean(reason, 240) : expired ? "Document expired." : null,
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
  await audit(me.id, "vehicle:review:ack", "vehicle_review_commands", Number(command.id), "trade-engine", {
    inspectionId,
    resultGrade: command.result_grade,
    eligibility: command.eligibility_status,
  })
  return {
    ok: true,
    command,
    bundle: await vehicleBundle(store, Number((await store.get("vehicles", Number(inspection.vehicle_id)))?.auction_id), me),
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
    await store.update("vehicle_staff_roles", `${target.user},${target.role}`, { active: 1 })
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
