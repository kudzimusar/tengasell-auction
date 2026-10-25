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
