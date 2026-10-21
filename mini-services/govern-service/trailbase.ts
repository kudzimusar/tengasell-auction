// trailbase.ts — govern-service's server-side TrailBase admin client.
//
// Mirrors the trade engine's tbLogin pattern: sign in as the admin user once,
// cache the auth_token for 24h and attach it as a Bearer header on every
// request. Used ONLY for DSAR export bundles (the privacy deletion flow never
// purges TrailBase rows — retention exceptions are honoured, see routes/privacy).

import { TRAILBASE, ADMIN_USERNAME, ADMIN_PASSWORD } from "./config";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

let cached: { token: string; fetchedAt: number } | null = null;

async function tbLogin(): Promise<string> {
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

async function ensureAdminToken(force = false): Promise<string> {
  const fresh = cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS;
  if (force || !cached || !fresh) {
    cached = { token: await tbLogin(), fetchedAt: Date.now() };
  }
  return cached.token;
}

/**
 * List records from a TrailBase collection with a filter.
 * @param filters e.g. { username: "rufaro" } → filter[username][$eq]=rufaro
 */
export async function tbList(
  collection: string,
  filters: Record<string, string> = {},
  limit = 1000,
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) qs.set(`filter[${k}][$eq]`, v);
  qs.set("limit", String(limit));
  const path = `/api/records/v1/${collection}?${qs.toString()}`;

  const run = async (token: string) =>
    fetch(`${TRAILBASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

  try {
    let res = await run(await ensureAdminToken());
    if (res.status === 401) {
      cached = null;
      res = await run(await ensureAdminToken(true));
    }
    if (!res.ok) return [];
    const data = (await res.json()) as { records?: Record<string, unknown>[] };
    return data.records ?? [];
  } catch {
    return []; // engine-down safety doctrine: DSAR must never 500 on TB hiccups
  }
}
