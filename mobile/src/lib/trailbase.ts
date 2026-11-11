// TENGASELL-MOBILE-01 — canonical TrailBase authority client.
// All TrailBase traffic stays behind the canonical gateway and carries
// XTransformPort=3001. No Next BFF, Prisma, or local commercial authority.

import type { Auction, Category, Profile } from "./types";

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

async function requestJson<T>(
  path: string,
  init: RequestInit,
  params: Record<string, string | number | undefined> = {},
  authToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body) headers["content-type"] = "application/json";
  if (authToken) headers.authorization = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(gatewayUrl(path, params), { ...init, headers });
  } catch {
    throw new TrailBaseError("network", "Canonical TrailBase authority is unreachable.");
  }

  const payload = await readJson(res);
  if (!res.ok) {
    if (res.status === 401) {
      throw new TrailBaseError(
        authToken ? "session-invalid" : "auth-rejected",
        authToken
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
  await requestJson<unknown>("/api/auth/v1/logout", { method: "GET" }, {}, authToken);
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
  order?: string;
  limit?: number;
}

export async function fetchAuctions(q: AuctionQuery = {}): Promise<Auction[]> {
  const data = await publicRequest<RecordsResponse<Auction>>("/api/records/v1/auctions", {
    "filter[status][$eq]": q.status ?? "live",
    ...(q.category ? { "filter[category][$eq]": q.category } : {}),
    order: q.order ?? "ends_at",
    limit: q.limit ?? 20,
  });
  return data.records ?? [];
}

export async function fetchAuction(id: number): Promise<Auction | null> {
  try {
    return await publicRequest<Auction>(`/api/records/v1/auctions/${id}`);
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
