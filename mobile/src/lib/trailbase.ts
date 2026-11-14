// TENGASELL-MOBILE-01 — canonical TrailBase authority client.
// All TrailBase traffic stays behind the canonical gateway and carries
// XTransformPort=3001. No Next BFF, Prisma, or local commercial authority.

import type {
  Auction,
  Category,
  Profile,
  ReserveDisclosure,
  VehiclePublicProjection,
} from "./types";

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
 * Upstream TrailBase Defect Remediation & Boundary Privacy:
 *
 * TrailBase raw records API `/api/records/v1/auctions` exposes the internal
 * `reserve_price` database column directly over public HTTP endpoints.
 *
 * To enforce strict commercial transaction confidentiality and prevent
 * leaking seller reserve figures across the mobile boundary:
 * 1. Numeric `reserve_price` is scrubbed and set to `null` on all public auction projections.
 * 2. Truthful `reserve_disclosure` is derived:
 *    - Preserves canonical `raw.reserve_disclosure` if provided by PR #14 backend.
 *    - If unavailable but raw `reserve_price` > 0, sets `reserve_disclosure = "RESERVE_APPLIES"`
 *      (exposing only boolean existence of a reserve, never the dollar threshold).
 *    - Otherwise defaults to `"UNSPECIFIED"`.
 * 3. Any private vehicle identifiers (`vin`, `chassis_number`, `engine_number`,
 *    `registration_number`, `private_inspection_notes`) are strictly stripped.
 */
export function sanitizeAuctionPublicView(rawRecord: unknown): Auction {
  if (!rawRecord || typeof rawRecord !== "object") {
    throw new TrailBaseError("malformed-response", "Auction record is not an object");
  }

  const raw = rawRecord as Record<string, unknown>;

  const disclosure: ReserveDisclosure =
    typeof raw.reserve_disclosure === "string"
      ? (raw.reserve_disclosure as ReserveDisclosure)
      : raw.reserve_price != null && Number(raw.reserve_price) > 0
        ? "RESERVE_APPLIES"
        : "UNSPECIFIED";

  // Sanitize vehicle projection if present
  let sanitizedVehicleProj: VehiclePublicProjection | null = null;
  if (raw.vehicle_projection && typeof raw.vehicle_projection === "object") {
    const vp = raw.vehicle_projection as Record<string, unknown>;
    sanitizedVehicleProj = {
      make: typeof vp.make === "string" ? vp.make : null,
      model: typeof vp.model === "string" ? vp.model : null,
      year: typeof vp.year === "number" ? vp.year : null,
      mileage: typeof vp.mileage === "number" ? vp.mileage : null,
      odometer_source: typeof vp.odometer_source === "string" ? vp.odometer_source : "SELLER_DECLARED",
      transmission: typeof vp.transmission === "string" ? vp.transmission : null,
      fuel_type: typeof vp.fuel_type === "string" ? vp.fuel_type : null,
      body_type: typeof vp.body_type === "string" ? vp.body_type : null,
      verification_state: vp.verification_state === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
      inspection_status: typeof vp.inspection_status === "string" ? vp.inspection_status : null,
      inspection_grade: typeof vp.inspection_grade === "string" ? vp.inspection_grade : null,
      vin_classification: (vp.vin || vp.vin_classification === "RECORDED") ? "RECORDED" : "NOT_PROVIDED",
    };
  }

  // Clone record, stripping sensitive fields
  const sanitized = { ...raw } as unknown as Auction;
  sanitized.reserve_price = null; // Always scrub numeric reserve
  sanitized.reserve_disclosure = disclosure;
  sanitized.vehicle_projection = sanitizedVehicleProj;

  // Explicitly delete any raw private fields that might have leaked from database
  delete (sanitized as unknown as Record<string, unknown>).vin;
  delete (sanitized as unknown as Record<string, unknown>).chassis_number;
  delete (sanitized as unknown as Record<string, unknown>).engine_number;
  delete (sanitized as unknown as Record<string, unknown>).registration_number;
  delete (sanitized as unknown as Record<string, unknown>).private_inspection_notes;

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
