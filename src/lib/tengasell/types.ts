// Tengasell — shared domain types.
// These mirror the TrailBase SQLite schema (mini-services/trailbase-db).
// `user` fields are opaque base64 ids from the records API.

export type AuctionStatus = "live" | "ended" | "sold" | "cancelled" | "draft";
export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "shipped"
  | "delivered"
  | "completed"
  | "cancelled"
  | "disputed";
export type PaymentMethod =
  | "ecocash"
  | "visa"
  | "mastercard"
  | "paypal"
  | "zipit"
  | "cod";

export interface Category {
  id: number;
  slug: string;
  name: string;
  name_ja: string;
  icon: string;
  blurb: string;
  sort: number;
}

export interface Profile {
  id: number;
  user: string;
  username: string;
  display_name: string;
  bio: string;
  city: string;
  rating_avg: number;
  rating_count: number;
  sales: number;
  response_minutes: number;
  verified: number;
  joined_at: string;
}

export interface Auction {
  id: number;
  user: string;
  seller_username: string;
  title: string;
  slug: string;
  description: string;
  category: string;
  condition: string;
  start_price: number;
  current_price: number;
  buy_now_price: number | null;
  /** Private reserve is absent from public auction projection; only server/seller authority may receive it. */
  reserve_price?: number | null;
  reserve_disclosure?: "UNSPECIFIED" | "NO_RESERVE" | "RESERVE_APPLIES" | "UPSET_APPLIES";
  owner_bid_right_disclosure?: "NOT_PERMITTED" | "DISCLOSED";
  policy_profile_key?: string;
  commercial_policy_ready?: number;
  bid_count: number;
  watch_count: number;
  views: number;
  shipping_fee: number;
  shipping: string;
  city: string;
  ends_at: string;
  started_at: string;
  status: AuctionStatus;
  extension_count: number;
  featured: number;
  /** Gap-8 schema fields (present in live TrailBase records). */
  allow_offers?: number;
  offer_min?: number | null;
  live_session_id?: number | null;
  /** IMP-04 asset classification. Whole vehicles are inspection-gated. */
  asset_kind?: "general" | "vehicle" | "part";
  images: string; // JSON-encoded array of urls
  created_at: string;
  updated_at: string;
}

export interface Bid {
  id: number;
  auction_id: number;
  user: string;
  bidder_username: string;
  amount: number;
  max_amount: number;
  is_auto: number;
  status: string; // active | superseded | retracted (Gap-8)
  created_at: string;
  /** Gap-8 retraction metadata. */
  retracted_at?: string | null;
  retraction_reason?: string | null;
}

export interface WatchItem {
  id: number;
  user: string;
  auction_id: number;
  created_at: string;
}

export interface Question {
  id: number;
  auction_id: number;
  user: string;
  asker_username: string;
  body: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

export interface Thread {
  id: number;
  auction_id: number | null;
  buyer_user: string;
  seller_user: string;
  buyer_username: string;
  seller_username: string;
  subject: string;
  last_message_at: string | null;
  created_at: string;
}

export interface Message {
  id: number;
  thread_id: number;
  user: string;
  sender_username: string;
  body: string;
  created_at: string;
}

export interface Order {
  id: number;
  auction_id: number;
  auction_title: string;
  buyer_user: string;
  seller_user: string;
  buyer_username: string;
  seller_username: string;
  final_price: number;
  status: OrderStatus;
  pay_by: string | null;
  paid_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  carrier: string | null;
  tracking: string | null;
  /** Delivery address chosen at checkout (GIS displayName), if any. */
  address?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  order_id: number;
  user: string | null;
  method: PaymentMethod | string;
  amount: number;
  status: string;
  reference: string;
  created_at: string;
}

export interface Rating {
  id: number;
  order_id: number;
  user: string;
  ratee_user: string;
  ratee_username: string;
  direction: string; // as_buyer | as_seller
  score: number; // 1..5
  comment: string;
  created_at: string;
}

export interface Notification {
  id: number;
  user: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: number;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  user: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  source: string;
  payload: string;
  created_at: string;
}

// ── Gap-8 types ─────────────────────────────────────────────────────────

export type OfferStatus = "pending" | "countered" | "accepted" | "declined" | "expired" | "withdrawn";

export interface Offer {
  id: number;
  auction_id: number;
  buyer_user: string;
  buyer_username: string;
  amount: number;
  message: string | null;
  status: OfferStatus;
  counter_amount: number | null;
  counter_message: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedSearch {
  id: number;
  user: string;
  name: string;
  query: string | null;
  category: string | null;
  min_price: number | null;
  max_price: number | null;
  alerts: number; // 1 = alert on new matches
  last_seen_id: number;
  created_at: string;
  updated_at: string;
}

export interface LiveSession {
  id: number;
  host_user: string;
  host_username: string;
  title: string;
  scheduled_at: string;
  status: "scheduled" | "live" | "closed";
  current_lot_id: number | null;
  lot_index: number;
  /** going-going-sold hammer clock (each bid pushes it +20s) */
  close_at: string | null;
  /** IMP-05 evolved Event / Run-List linkage. */
  event_id?: number | null;
  next_lot_id?: number | null;
  run_list_version?: number;
  run_list_locked?: number;
  created_at: string;
  updated_at: string;
}


// ── IMP-05 Auction Event / Session / Run-List ─────────────────────────

export interface AuctionVenue {
  id: number;
  name: string;
  address: string;
  city: string;
  country: string;
  timezone: string;
  venue_type: "PHYSICAL" | "HYBRID" | "ONLINE";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AuctionEvent {
  id: number;
  host_user: string;
  host_username: string;
  title: string;
  description: string;
  venue_id: number | null;
  session_id: number | null;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  status: "DRAFT" | "SCHEDULED" | "LIVE" | "CLOSED" | "CANCELLED";
  version: number;
  run_list_version: number;
  run_list_locked: number;
  current_lot_id: number | null;
  next_lot_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface AuctionEventOperator {
  id: number;
  event_id: number;
  user: string;
  username: string;
  role: "HOST" | "AUCTIONEER" | "CLERK";
  active: number;
  granted_by: string;
  granted_at: string;
}

export interface AuctionLot {
  id: number;
  event_id: number;
  session_id: number;
  auction_id: number;
  sequence_no: number;
  status: "QUEUED" | "READY" | "LIVE" | "SOLD" | "PASSED" | "WITHDRAWN";
  version: number;
  original_ends_at: string;
  original_live_session_id: number | null;
  ready_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  auction?: Auction | null;
}

export interface AuctionEventPermissions {
  operate: boolean;
  host: boolean;
  auctioneer: boolean;
  clerk: boolean;
  administer: boolean;
}

export interface AuctionEventBundle {
  event: AuctionEvent | null;
  venue: AuctionVenue | null;
  session: LiveSession | null;
  lots: AuctionLot[];
  operators?: AuctionEventOperator[];
  permissions: AuctionEventPermissions;
}

export interface RunListCommandInput {
  eventId: number;
  sessionId: number;
  commandType: "ADD" | "MOVE" | "READY" | "WITHDRAW" | "LOCK" | "UNLOCK" | "OPEN" | "ADVANCE" | "CLOSE_EVENT";
  expectedRunListVersion: number;
  lotId?: number | null;
  auctionId?: number | null;
  targetSequenceNo?: number | null;
  reason?: string | null;
  commandId?: string | null;
}

export interface SaveSearchInput {
  name: string;
  query?: string | null;
  category?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  alerts?: boolean;
}

// ── Client-side helpers ───────────────────────────────────────────────

export interface AuctionView extends Auction {
  imageList: string[];
  endingSoon: boolean;
  hasBids: boolean;
  reserveMet: boolean | null;
}

export function toAuctionView(a: Auction): AuctionView {
  let imageList: string[] = [];
  try {
    const parsed = JSON.parse(a.images || "[]");
    if (Array.isArray(parsed)) imageList = parsed.filter((x) => typeof x === "string");
  } catch {
    /* ignore malformed */
  }
  const ends = Date.parse(a.ends_at);
  const endingSoon = a.status === "live" && ends - Date.now() < 3600_000;
  return {
    ...a,
    imageList,
    endingSoon,
    hasBids: a.bid_count > 0,
    reserveMet: a.reserve_price == null ? null : a.current_price >= a.reserve_price,
  };
}

export interface AuctionQuery {
  category?: string;
  search?: string;
  status?: AuctionStatus | "all";
  endingWithinMinutes?: number;
  minPrice?: number;
  maxPrice?: number;
  condition?: string;
  city?: string;
  featured?: boolean;
  seller?: string;
  order?: "ending" | "newest" | "price_asc" | "price_desc" | "bids" | "hot";
  limit?: number;
  offset?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface BidResult {
  ok: boolean;
  error?: string;
  auction?: Auction;
  yourBid?: number;
  outbid?: boolean;
}

export interface CurrentUser {
  id: string;
  username: string;
  token: string;
  profile: Profile | null;
  admin: boolean;
}


// ── IMP-04 Vehicle / Tengasell Inspection ─────────────────────────────

export type VehicleFuel = "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC" | "LPG" | "OTHER";
export type VehicleTransmission = "MANUAL" | "AUTOMATIC" | "CVT" | "DCT" | "OTHER";
export type VehicleDrivetrain = "FWD" | "RWD" | "AWD" | "4WD" | "OTHER";
export type VehicleGrade = "A" | "B" | "C" | "D" | "E" | "REJECT";

export interface VehicleIntakeInput {
  vin?: string | null;
  chassisNumber?: string | null;
  registrationNumber?: string | null;
  make: string;
  model: string;
  variant?: string | null;
  modelYear: number;
  engineNumber?: string | null;
  engineDisplacementCc?: number | null;
  fuelType: VehicleFuel;
  transmission: VehicleTransmission;
  drivetrain: VehicleDrivetrain;
  odometerKm: number;
  locationCity: string;
  locationCountry?: string;
  ownershipStatus: "DECLARED_OWNER" | "FINANCED" | "THIRD_PARTY" | "UNKNOWN";
  customsStatus: "LOCAL" | "CLEARED" | "PENDING" | "NOT_APPLICABLE" | "UNKNOWN";
  requestedDurationHours: number;
}

export interface Vehicle {
  id: number;
  auction_id: number;
  seller_user: string;
  seller_username: string;
  vin: string | null;
  chassis_number: string | null;
  registration_number: string | null;
  make: string;
  model: string;
  variant: string | null;
  model_year: number;
  engine_number: string | null;
  engine_displacement_cc: number | null;
  fuel_type: VehicleFuel;
  transmission: VehicleTransmission;
  drivetrain: VehicleDrivetrain;
  odometer_km: number;
  location_city: string;
  location_country: string;
  ownership_status: string;
  customs_status: string;
  requested_duration_hours: number;
  declaration_accepted_at: string;
  lifecycle: "INTAKE" | "INSPECTION" | "REVIEW" | "ELIGIBLE" | "INELIGIBLE" | "RETIRED";
  tengasell_grade: VehicleGrade | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleDocument {
  id: number;
  document_type: string;
  document_ref: string;
  issuer: string | null;
  issued_at: string | null;
  expires_at: string | null;
  status: "DECLARED" | "UPLOADED" | "VERIFIED" | "REJECTED" | "EXPIRED";
  verified_at: string | null;
  rejection_reason?: string | null;
}

export interface VehicleInspection {
  id: number;
  vehicle_id: number;
  version: number;
  inspector_user: string;
  inspector_name: string;
  reviewer_user: string | null;
  reviewer_name: string | null;
  lifecycle: "DRAFT" | "SUBMITTED" | "REVIEWED" | "REJECTED" | "SUPERSEDED";
  odometer_km: number;
  roadworthy: number;
  notes: string;
  grade_score: number | null;
  grade: VehicleGrade | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleFinding {
  id: number;
  inspection_id: number;
  category: string;
  component: string;
  location: string | null;
  severity: "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL";
  description: string;
  repair_recommended: number;
  safety_critical: number;
  evidence_document_id: number | null;
  created_at: string;
}

export interface VehicleEligibility {
  id: number;
  vehicle_id: number;
  inspection_id: number;
  version: number;
  status: "PENDING" | "ELIGIBLE" | "INELIGIBLE";
  decided_by: string;
  decided_at: string;
  created_at: string;
}

export interface VehicleEligibilityReason {
  id: number;
  eligibility_id: number;
  code: string;
  detail: string;
}

export interface VehicleBundle {
  vehicle: Vehicle | null;
  documents?: VehicleDocument[];
  inspections?: VehicleInspection[];
  inspection?: VehicleInspection | null;
  findings?: VehicleFinding[];
  eligibility?: VehicleEligibility | null;
  eligibilityReasons?: VehicleEligibilityReason[];
  provenance?: Record<string, "SELLER_DECLARATION" | "DOCUMENT" | "INSPECTION" | "REVIEW">;
  permissions: { inspect: boolean; review: boolean; administer: boolean };
}
