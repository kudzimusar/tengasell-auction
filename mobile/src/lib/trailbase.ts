// TENGASELL-MOBILE-01 — canonical TrailBase authority client.
// All TrailBase traffic stays behind the canonical gateway and carries
// XTransformPort=3001. No Next BFF, Prisma, or local commercial authority.

import {
  ALLOWED_AUCTION_STATUSES,
  ALLOWED_FACT_VERIFICATION_STATES,
  ALLOWED_RESERVE_DISCLOSURES,
  type Auction,
  type AuctionStatus,
  type Category,
  type Profile,
  type ReserveDisclosure,
  type VehiclePublicProjection,
} from "./types.ts";

export const TB_PORT = 3001;

export type TrailBaseErrorKind =
  | "configuration"
  | "network"
  | "http"
  | "auth-rejected"
  | "session-invalid"
  | "mfa-required"
  | "malformed-response";

export class TrailBaseError extends Error {
  readonly kind: TrailBaseErrorKind;
  readonly status?: number;

  constructor(kind: TrailBaseErrorKind, message: string, status?: number) {
    super(message);
    this.name = "TrailBaseError";
    this.kind = kind;
    this.status = status;
  }
}

export interface TrailBaseTokens {
  authToken: string;
  refreshToken: string;
}

export interface TrailBaseIdentity {
  id: string;
  expiresAt?: number;
}

interface RecordsResponse<T> {
  records?: T[];
  cursor?: string;
  total_count?: number;
}

export function getCanonicalBaseUrl(): string | null {
  const value = process.env.EXPO_PUBLIC_TENGASELL_API?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function gatewayUrl(
  path: string,
  params: Record<string, string | number | undefined> = {},
): string {
  const canonicalBase = getCanonicalBaseUrl();
  if (!canonicalBase) {
    throw new TrailBaseError(
      "configuration",
      "Canonical API is not configured. Set EXPO_PUBLIC_TENGASELL_API before running this build.",
    );
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  search.set("XTransformPort", String(TB_PORT));
  return `${canonicalBase}${path}?${search.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(res: Response): Promise<unknown> {
  const body = await res.text();
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new TrailBaseError(
      "malformed-response",
      `Canonical TrailBase returned malformed JSON (HTTP ${res.status}).`,
      res.status,
    );
  }
}

async function fetchGateway(
  path: string,
  init: RequestInit,
  params: Record<string, string | number | undefined> = {},
  authToken?: string,
  accept = "application/json",
): Promise<Response> {
  const headers: Record<string, string> = { accept };
  if (init.body) headers["content-type"] = "application/json";
  if (authToken) headers.authorization = `Bearer ${authToken}`;

  try {
    return await fetch(gatewayUrl(path, params), { ...init, headers });
  } catch {
    throw new TrailBaseError("network", "Canonical TrailBase authority is unreachable.");
  }
}

function throwHttpFailure(res: Response, payload: unknown, hasAuthToken: boolean): never {
  if (res.status === 401) {
    throw new TrailBaseError(
      hasAuthToken ? "session-invalid" : "auth-rejected",
      hasAuthToken
        ? "The authenticated TrailBase session is no longer valid."
        : "Incorrect email/username or password.",
      res.status,
    );
  }
  if (res.status === 403 && isRecord(payload) && typeof payload.mfa_token === "string") {
    throw new TrailBaseError(
      "mfa-required",
      "This account requires MFA. MOB-01 does not implement MFA entry.",
      res.status,
    );
  }
  throw new TrailBaseError(
    "http",
    `Canonical TrailBase request failed with HTTP ${res.status}.`,
    res.status,
  );
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  params: Record<string, string | number | undefined> = {},
  authToken?: string,
): Promise<T> {
  const res = await fetchGateway(path, init, params, authToken);
  const payload = await readJson(res);
  if (!res.ok) {
    throwHttpFailure(res, payload, Boolean(authToken));
  }

  return payload as T;
}

function parseLoginResponse(value: unknown): TrailBaseTokens {
  if (!isRecord(value)) {
    throw new TrailBaseError("malformed-response", "TrailBase login response was not an object.");
  }
  if (typeof value.auth_token !== "string" || typeof value.refresh_token !== "string") {
    throw new TrailBaseError(
      "malformed-response",
      "TrailBase login response did not contain both auth and refresh tokens.",
    );
  }
  return { authToken: value.auth_token, refreshToken: value.refresh_token };
}

export async function loginTrailBase(
  identifier: string,
  password: string,
): Promise<TrailBaseTokens> {
  const payload = await requestJson<unknown>("/api/auth/v1/login", {
    method: "POST",
    body: JSON.stringify({
      email_or_username: identifier,
      password,
      response_type: "token",
    }),
  });
  return parseLoginResponse(payload);
}

export async function refreshTrailBase(refreshToken: string): Promise<string> {
  let payload: unknown;
  try {
    payload = await requestJson<unknown>("/api/auth/v1/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (error) {
    if (error instanceof TrailBaseError && (error.status === 401 || error.status === 403)) {
      throw new TrailBaseError(
        "session-invalid",
        "The TrailBase refresh session is invalid or expired.",
        error.status,
      );
    }
    throw error;
  }

  if (!isRecord(payload) || typeof payload.auth_token !== "string") {
    throw new TrailBaseError(
      "malformed-response",
      "TrailBase refresh response did not contain an auth token.",
    );
  }
  return payload.auth_token;
}

export async function logoutTrailBase(authToken: string): Promise<void> {
  // TrailBase v0.35.1 GET /api/auth/v1/logout returns HTTP 200 text/plain ("logged out"),
  // while compatible gateways may return 204 or JSON; reject HTML SPA fallbacks and HTTP failures.
  const res = await fetchGateway(
    "/api/auth/v1/logout",
    { method: "GET" },
    {},
    authToken,
    "application/json, text/plain;q=0.9, */*;q=0.8",
  );
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  const body = res.status === 204 ? "" : await res.text();
  if (!res.ok) {
    let parsed: unknown = null;
    if (body && contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        parsed = null;
      }
    }
    throwHttpFailure(res, parsed, true);
  }
  if (contentType.includes("application/json")) {
    if (!body) return;
    try {
      JSON.parse(body);
      return;
    } catch {
      throw new TrailBaseError(
        "malformed-response",
        `Canonical TrailBase returned malformed JSON (HTTP ${res.status}).`,
        res.status,
      );
    }
  }
  if (contentType.includes("text/html") || /^\s*(?:<!doctype\s+html|<html\b)/i.test(body)) {
    throw new TrailBaseError(
      "malformed-response",
      `Canonical TrailBase logout returned HTML instead of an API response (HTTP ${res.status}).`,
      res.status,
    );
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3 || typeof globalThis.atob !== "function") return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const value = JSON.parse(globalThis.atob(padded)) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function identityFromAuthToken(authToken: string): TrailBaseIdentity | null {
  const payload = decodeJwtPayload(authToken);
  if (!payload || typeof payload.sub !== "string" || !payload.sub) return null;
  return {
    id: payload.sub,
    ...(typeof payload.exp === "number" ? { expiresAt: payload.exp * 1000 } : {}),
  };
}

/** Explicit public TrailBase request path. */
export async function publicRequest<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  return requestJson<T>(path, { method: "GET" }, params);
}

/** Explicit bearer-authenticated TrailBase request path. */
export async function authenticatedRequest<T>(
  authToken: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  return requestJson<T>(path, { method: "GET" }, params, authToken);
}

export async function probeCanonical(): Promise<void> {
  await publicRequest<RecordsResponse<Category>>("/api/records/v1/categories", { limit: 1 });
}

export async function fetchCategories(): Promise<Category[]> {
  const data = await publicRequest<RecordsResponse<Category>>("/api/records/v1/categories", {
    order: "sort",
    limit: 50,
  });
  return data.records ?? [];
}

export interface AuctionQuery {
  status?: string;
  category?: string;
  search?: string;
  order?: string;
  limit?: number;
}

/**
 * Upstream TrailBase Defect Remediation & Presentation Boundary Privacy:
 *
 * CRITICAL SECURITY ARCHITECTURE NOTE:
 * TrailBase raw records API `/api/records/v1/auctions` exposes the internal
 * `reserve_price` database column directly over public HTTP endpoints.
 * Client-side sanitization performed here is DEFENSE-IN-DEPTH for the mobile
 * presentation layer only. It does NOT constitute a server-side confidentiality
 * guarantee. Complete remediation requires the backend/security authority to
 * deploy an authenticated or view-restricted public endpoint (e.g. PR #14).
 * Until server-side authority is certified, the backend gate is BLOCKED.
 *
 * Presentation Projection Invariants:
 * 1. Numeric `reserve_price` is strictly scrubbed to `null`.
 * 2. `reserve_disclosure` is strictly validated at runtime against ALLOWED_RESERVE_DISCLOSURES.
 * 3. Contradictory values (e.g. `NO_RESERVE` with numeric reserve > 0) resolve to `UNSPECIFIED`.
 * 4. Never derive `NO_RESERVE` from absent/null reserve.
 * 5. Strict public-field allowlist mapping: NO OBJECT SPREADING (`...raw`) is permitted,
 *    preventing any unredacted private or schema-drift fields from reaching the UI.
 * 6. Vehicle projections default to `UNVERIFIED` and scrub sensitive VIN/chassis numbers.
 */
export function validateReserveDisclosure(val: unknown): ReserveDisclosure {
  if (typeof val === "string" && (ALLOWED_RESERVE_DISCLOSURES as readonly string[]).includes(val)) {
    return val as ReserveDisclosure;
  }
  return "UNSPECIFIED";
}

export function sanitizeAuctionPublicView(rawRecord: unknown): Auction {
  if (!rawRecord || typeof rawRecord !== "object") {
    throw new TrailBaseError("malformed-response", "Auction record is not an object");
  }

  const raw = rawRecord as Record<string, unknown>;

  // 1. Runtime validation of reserve disclosure
  const explicitDisclosure = validateReserveDisclosure(raw.reserve_disclosure);
  const rawReserveNum = raw.reserve_price != null && !Number.isNaN(Number(raw.reserve_price))
    ? Number(raw.reserve_price)
    : null;

  let disclosure: ReserveDisclosure;

  // Detect contradiction: if declared NO_RESERVE but raw reserve_price > 0, fail closed
  if (explicitDisclosure === "NO_RESERVE" && rawReserveNum != null && rawReserveNum > 0) {
    disclosure = "UNSPECIFIED";
  } else if (explicitDisclosure !== "UNSPECIFIED") {
    disclosure = explicitDisclosure;
  } else if (rawReserveNum != null && rawReserveNum > 0) {
    // Only derive boolean indication that a reserve applies; NEVER derive NO_RESERVE from null
    disclosure = "RESERVE_APPLIES";
  } else {
    disclosure = "UNSPECIFIED";
  }

  // 2. Strict vehicle projection sanitization (never invent facts, never expose raw VIN)
  let sanitizedVehicleProj: VehiclePublicProjection | null = null;
  if (raw.vehicle_projection && typeof raw.vehicle_projection === "object") {
    const vp = raw.vehicle_projection as Record<string, unknown>;
    const rawVerification = typeof vp.verification_state === "string" ? vp.verification_state : "";
    const verificationState = (ALLOWED_FACT_VERIFICATION_STATES as readonly string[]).includes(rawVerification)
      ? (rawVerification as VehiclePublicProjection["verification_state"])
      : "UNVERIFIED";

    sanitizedVehicleProj = {
      make: typeof vp.make === "string" ? vp.make.trim() : null,
      model: typeof vp.model === "string" ? vp.model.trim() : null,
      year: typeof vp.year === "number" && vp.year > 1900 && vp.year < 2100 ? vp.year : null,
      mileage: typeof vp.mileage === "number" && vp.mileage >= 0 ? vp.mileage : null,
      odometer_source: typeof vp.odometer_source === "string" ? vp.odometer_source : "SELLER_DECLARED",
      transmission: typeof vp.transmission === "string" ? vp.transmission : null,
      fuel_type: typeof vp.fuel_type === "string" ? vp.fuel_type : null,
      body_type: typeof vp.body_type === "string" ? vp.body_type : null,
      verification_state: verificationState,
      inspection_status: typeof vp.inspection_status === "string" ? vp.inspection_status : null,
      inspection_grade: typeof vp.inspection_grade === "string" ? vp.inspection_grade : null,
      vin_classification: (vp.vin || vp.vin_classification === "RECORDED") ? "RECORDED" : "NOT_PROVIDED",
    };
  }

  // 3. Strict public-field allowlist mapping — ZERO OBJECT SPREADING
  const rawStatus = typeof raw.status === "string" ? raw.status : "draft";
  const status: AuctionStatus = (ALLOWED_AUCTION_STATUSES as readonly string[]).includes(rawStatus)
    ? (rawStatus as AuctionStatus)
    : "draft";

  const sanitized: Auction = {
    id: typeof raw.id === "number" ? raw.id : Number(raw.id) || 0,
    user: typeof raw.user === "string" ? raw.user : "",
    seller_username: typeof raw.seller_username === "string" ? raw.seller_username : "",
    title: typeof raw.title === "string" ? raw.title : "",
    slug: typeof raw.slug === "string" ? raw.slug : "",
    description: typeof raw.description === "string" ? raw.description : "",
    category: typeof raw.category === "string" ? raw.category : "",
    condition: typeof raw.condition === "string" ? raw.condition : "",
    start_price: typeof raw.start_price === "number" ? raw.start_price : Number(raw.start_price) || 0,
    current_price: typeof raw.current_price === "number" ? raw.current_price : Number(raw.current_price) || 0,
    buy_now_price: raw.buy_now_price != null ? Number(raw.buy_now_price) : null,
    reserve_price: null, // Strictly nullified at boundary
    reserve_disclosure: disclosure,
    bid_count: typeof raw.bid_count === "number" ? raw.bid_count : Number(raw.bid_count) || 0,
    watch_count: typeof raw.watch_count === "number" ? raw.watch_count : Number(raw.watch_count) || 0,
    views: typeof raw.views === "number" ? raw.views : Number(raw.views) || 0,
    shipping_fee: typeof raw.shipping_fee === "number" ? raw.shipping_fee : Number(raw.shipping_fee) || 0,
    shipping: typeof raw.shipping === "string" ? raw.shipping : "",
    city: typeof raw.city === "string" ? raw.city : "",
    ends_at: typeof raw.ends_at === "string" ? raw.ends_at : "",
    started_at: typeof raw.started_at === "string" ? raw.started_at : "",
    status,
    extension_count: typeof raw.extension_count === "number" ? raw.extension_count : Number(raw.extension_count) || 0,
    featured: typeof raw.featured === "number" ? raw.featured : Number(raw.featured) || 0,
    images: typeof raw.images === "string" ? raw.images : "[]",
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
    asset_kind: typeof raw.asset_kind === "string" ? raw.asset_kind : (sanitizedVehicleProj ? "vehicle" : "general"),
    vehicle_projection: sanitizedVehicleProj,
    allow_offers: raw.allow_offers != null ? Number(raw.allow_offers) : undefined,
    offer_min: raw.offer_min != null ? Number(raw.offer_min) : undefined,
    live_session_id: raw.live_session_id != null ? Number(raw.live_session_id) : undefined,
  };

  return sanitized;
}

export async function fetchAuctions(q: AuctionQuery = {}): Promise<Auction[]> {
  const data = await publicRequest<RecordsResponse<unknown>>("/api/records/v1/auctions", {
    "filter[status][$eq]": q.status ?? "live",
    ...(q.category ? { "filter[category][$eq]": q.category } : {}),
    ...(q.search ? { "filter[title][$like]": `%${q.search}%` } : {}),
    order: q.order ?? "ends_at",
    limit: q.limit ?? 20,
  });
  return (data.records ?? []).map(sanitizeAuctionPublicView);
}

export async function fetchAuction(id: number): Promise<Auction | null> {
  try {
    const raw = await publicRequest<unknown>(`/api/records/v1/auctions/${id}`);
    return sanitizeAuctionPublicView(raw);
  } catch (error) {
    if (error instanceof TrailBaseError && error.status === 404) return null;
    throw error;
  }
}

export async function fetchAuthenticatedProfile(
  authToken: string,
  userId: string,
): Promise<Profile | null> {
  const data = await authenticatedRequest<RecordsResponse<Profile>>(
    authToken,
    "/api/records/v1/profiles",
    { "filter[user][$eq]": userId, limit: 1 },
  );
  return data.records?.[0] ?? null;
}
