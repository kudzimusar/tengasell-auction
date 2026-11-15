// Tengasell server-side TrailBase admin helper.
//
// Mirrors the trade engine's (mini-services/trade-engine/index.ts) tbLogin
// pattern: sign in as the admin user once, cache the auth_token for 24h
// (TrailBase auth_token_ttl_sec) and attach it as a Bearer header on every
// request. Server-side only — never import from client components.
//
// Env vars (same as the trade engine):
//   ADMIN_USERNAME  (default "admin")
//   ADMIN_PASSWORD  (required — fail-closed if unset at runtime)

function getTrailbaseUrl(): string {
  return process.env.TRAILBASE_URL ?? "http://localhost:3001";
}

function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME ?? "admin";
}

export class TrailBaseError extends Error {
  readonly status: number;
  readonly code: string;
  readonly collection?: string;

  constructor(
    message: string,
    status = 500,
    code = "TRAILBASE_ERROR",
    collection?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "TrailBaseError";
    this.status = status;
    this.code = code;
    this.collection = collection;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return "TRAILBASE_BAD_REQUEST";
    case 401:
      return "TRAILBASE_UNAUTHORIZED";
    case 403:
      return "TRAILBASE_FORBIDDEN";
    case 404:
      return "TRAILBASE_NOT_FOUND";
    case 409:
      return "TRAILBASE_CONFLICT";
    case 429:
      return "TRAILBASE_RATE_LIMITED";
    case 502:
      return "TRAILBASE_BAD_GATEWAY";
    case 503:
      return "TRAILBASE_UNAVAILABLE";
    case 504:
      return "TRAILBASE_GATEWAY_TIMEOUT";
    default:
      return status >= 500 ? "TRAILBASE_SERVER_ERROR" : "TRAILBASE_ERROR";
  }
}

function getAdminPassword(): string {
  const password = (process.env.ADMIN_PASSWORD ?? "").trim();
  if (!password) {
    throw new TrailBaseError(
      "ADMIN_PASSWORD environment variable is required for privileged TrailBase operations",
      500,
      "TRAILBASE_CONFIG_ERROR",
    );
  }
  return password;
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // TrailBase auth_token_ttl_sec: 86400

let cached: { token: string; fetchedAt: number } | null = null;
let loginPromise: Promise<string> | null = null;

/** Invalidate cached auth token (useful after 401/403 or in tests). */
export function invalidateToken(): void {
  cached = null;
}

/** POST /api/auth/v1/login → auth_token (same as the trade engine's tbLogin). */
export async function tbLogin(): Promise<string> {
  const password = getAdminPassword();
  const trailbase = getTrailbaseUrl();
  const username = getAdminUsername();
  let res: Response;
  try {
    res = await fetch(`${trailbase}/api/auth/v1/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new TrailBaseError(
      "TrailBase login failed: upstream unreachable",
      503,
      "TRAILBASE_UNAVAILABLE",
      undefined,
      err,
    );
  }
  if (!res.ok) {
    throw new TrailBaseError(
      `TrailBase admin login failed with status ${res.status}`,
      res.status,
      statusToCode(res.status),
    );
  }
  let data: { auth_token?: string };
  try {
    data = (await res.json()) as { auth_token?: string };
  } catch (err) {
    throw new TrailBaseError(
      "TrailBase admin login returned malformed JSON",
      502,
      "TRAILBASE_MALFORMED_JSON",
      undefined,
      err,
    );
  }
  if (!data.auth_token) {
    throw new TrailBaseError(
      "TrailBase admin login failed: missing auth_token in response",
      502,
      "TRAILBASE_MALFORMED_RESPONSE",
    );
  }
  return data.auth_token;
}

/** Cached admin token — singleflight refresh when older than 24h or after a 401/403. */
export async function ensureAdminToken(force = false): Promise<string> {
  const fresh = cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS;
  if (!force && cached && fresh) {
    return cached.token;
  }
  if (!loginPromise || force) {
    if (force) {
      cached = null;
    }
    loginPromise = tbLogin()
      .then((token) => {
        cached = { token, fetchedAt: Date.now() };
        return token;
      })
      .finally(() => {
        loginPromise = null;
      });
  }
  return loginPromise;
}

/**
 * fetch() wrapper that attaches the admin Bearer token.
 * Retries once with a fresh token on 401/403 (token expired/invalidated).
 */
export async function tbFetch(
  path: string,
  init?: RequestInit & { params?: Record<string, string | number> },
): Promise<Response> {
  const { params, ...rest } = init ?? {};
  const trailbase = getTrailbaseUrl();
  let url = `${trailbase}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    url += `?${qs.toString()}`;
  }
  const run = async (token: string) => {
    try {
      return await fetch(url, {
        ...rest,
        headers: {
          ...(rest.body ? { "Content-Type": "application/json" } : {}),
          ...(rest.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      throw new TrailBaseError(
        "TrailBase connection failed",
        503,
        "TRAILBASE_UNAVAILABLE",
        undefined,
        err,
      );
    }
  };

  let token = await ensureAdminToken();
  let res = await run(token);
  if (res.status === 401 || res.status === 403) {
    invalidateToken();
    token = await ensureAdminToken(true);
    res = await run(token);
  }
  return res;
}

/** GET a single record → row object or null (404). */
export async function tbGet(
  collection: string,
  id: number | string,
): Promise<Record<string, unknown> | null> {
  const res = await tbFetch(`/api/records/v1/${collection}/${id}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new TrailBaseError(
      `TrailBase record fetch failed for collection '${collection}' id '${id}' with status ${res.status}`,
      res.status,
      statusToCode(res.status),
      collection,
    );
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw new TrailBaseError(
      `TrailBase record fetch returned malformed JSON for collection '${collection}' id '${id}'`,
      502,
      "TRAILBASE_MALFORMED_JSON",
      collection,
      err,
    );
  }
}

/** GET a record list (filtered) → records array. */
export async function tbList(
  collection: string,
  params: Record<string, string | number>,
): Promise<Record<string, unknown>[]> {
  const res = await tbFetch(`/api/records/v1/${collection}`, { params });
  if (!res.ok) {
    throw new TrailBaseError(
      `TrailBase record list failed for collection '${collection}' with status ${res.status}`,
      res.status,
      statusToCode(res.status),
      collection,
    );
  }
  try {
    const data = (await res.json()) as { records?: Record<string, unknown>[] };
    return data.records ?? [];
  } catch (err) {
    throw new TrailBaseError(
      `TrailBase record list returned malformed JSON for collection '${collection}'`,
      502,
      "TRAILBASE_MALFORMED_JSON",
      collection,
      err,
    );
  }
}

/** POST a record → created id or null. */
export async function tbCreate(
  collection: string,
  row: Record<string, unknown>,
): Promise<number | null> {
  const res = await tbFetch(`/api/records/v1/${collection}`, {
    method: "POST",
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new TrailBaseError(
      `TrailBase record creation failed for collection '${collection}' with status ${res.status}`,
      res.status,
      statusToCode(res.status),
      collection,
    );
  }
  try {
    const data = (await res.json()) as { ids?: unknown[] };
    const id = data.ids?.[0];
    return id != null ? Number(id) : null;
  } catch (err) {
    throw new TrailBaseError(
      `TrailBase record creation returned malformed JSON for collection '${collection}'`,
      502,
      "TRAILBASE_MALFORMED_JSON",
      collection,
      err,
    );
  }
}

/** PATCH a record → success. */
export async function tbPatch(
  collection: string,
  id: number | string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const res = await tbFetch(`/api/records/v1/${collection}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new TrailBaseError(
      `TrailBase record update failed for collection '${collection}' id '${id}' with status ${res.status}`,
      res.status,
      statusToCode(res.status),
      collection,
    );
  }
  return true;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}
