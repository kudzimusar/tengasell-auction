// Tengasell server-side TrailBase admin helper.
//
// Mirrors the trade engine's (mini-services/trade-engine/index.ts) tbLogin
// pattern: sign in as the admin user once, cache the auth_token for 24h
// (TrailBase auth_token_ttl_sec) and attach it as a Bearer header on every
// request. Server-side only — never import from client components.
//
// Env vars (same as the trade engine):
//   ADMIN_USERNAME  (default "admin")
//   ADMIN_PASSWORD  (default "Tengasell#2025")

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Tengasell#2025";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // TrailBase auth_token_ttl_sec: 86400

let cached: { token: string; fetchedAt: number; expMs: number } | null = null;

function tokenExpMs(token: string): number {
  try {
    const part = token.split(".")[1] ?? "";
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload?.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : Date.now() + TOKEN_TTL_MS;
  } catch {
    return Date.now() + TOKEN_TTL_MS;
  }
}

/** POST /api/auth/v1/login → auth_token (same as the trade engine's tbLogin). */
export async function tbLogin(): Promise<string> {
  const res = await fetch(`${TRAILBASE}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
  const data = (await res.json()) as { auth_token?: string };
  if (!data.auth_token) throw new Error("admin login failed: no auth_token");
  return data.auth_token;
}

/** Cached admin token — refreshed before expiry or after a 401/403. */
export async function ensureAdminToken(force = false): Promise<string> {
  const now = Date.now();
  const fresh =
    cached &&
    now - cached.fetchedAt < TOKEN_TTL_MS &&
    cached.expMs - now > 30_000;
  if (force || !cached || !fresh) {
    const token = await tbLogin();
    cached = { token, fetchedAt: Date.now(), expMs: tokenExpMs(token) };
  }
  return cached.token;
}

function invalidate() {
  cached = null;
}

/**
 * fetch() wrapper that attaches the admin Bearer token.
 * Retries once with a fresh token on 401/403 (TrailBase returns 403 as well
 * as 401 when an admin bearer token expires on record routes).
 */
export async function tbFetch(
  path: string,
  init?: RequestInit & { params?: Record<string, string | number> },
): Promise<Response> {
  const { params, ...rest } = init ?? {};
  let url = `${TRAILBASE}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    url += `?${qs.toString()}`;
  }
  const run = async (token: string) =>
    fetch(url, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(rest.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await run(await ensureAdminToken());
  if (res.status === 401 || res.status === 403) {
    invalidate();
    res = await run(await ensureAdminToken(true));
  }
  return res;
}

/** GET a single record → row object or null (404). */
export async function tbGet(
  collection: string,
  id: number | string,
): Promise<Record<string, unknown> | null> {
  const res = await tbFetch(`/api/records/v1/${collection}/${id}`);
  if (!res.ok) return null;
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET a record list (filtered) → records array. */
export async function tbList(
  collection: string,
  params: Record<string, string | number>,
): Promise<Record<string, unknown>[]> {
  const res = await tbFetch(`/api/records/v1/${collection}`, { params });
  if (!res.ok) return [];
  try {
    const data = (await res.json()) as { records?: Record<string, unknown>[] };
    return data.records ?? [];
  } catch {
    return [];
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
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { ids?: unknown[] };
    const id = data.ids?.[0];
    return id != null ? Number(id) : null;
  } catch {
    return null;
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
  return res.ok;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}
