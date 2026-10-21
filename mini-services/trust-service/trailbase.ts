// TrailBase REST helpers — copied verbatim in spirit from the trade engine
// (mini-services/trade-engine/index.ts): admin-token login with a single 401
// retry, typed record CRUD, audit_events writer (TNS-014) and the in-app
// notification insert (GOV-010 buyer/seller notices).

import { TRAILBASE, ADMIN_USERNAME, ADMIN_PASSWORD } from "./config";
import { nowIso } from "./util";

let adminToken: string | null = null;

async function tbLogin(): Promise<string> {
  const res = await fetch(`${TRAILBASE}/api/auth/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`);
  const data = await res.json();
  return data.auth_token;
}

async function ensureAdminToken(): Promise<string> {
  if (!adminToken) adminToken = await tbLogin();
  return adminToken;
}

/** One TrailBase request, with a single 401 retry (mirror trade-engine tb()). */
export async function tb(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  const call = async (token: string) => {
    const res = await fetch(`${TRAILBASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* empty body (PATCH) */
    }
    return { ok: res.ok, status: res.status, data };
  };
  let result = await call(await ensureAdminToken());
  if (result.status === 401) {
    adminToken = await tbLogin();
    result = await call(adminToken);
  }
  return result;
}

export async function getRecords(table: string, params: string): Promise<any[]> {
  const res = await tb("GET", `/api/records/v1/${table}?${params}`);
  return res.ok ? (res.data?.records ?? []) : [];
}

export async function getRecord(table: string, id: number | string): Promise<any | null> {
  const res = await tb("GET", `/api/records/v1/${table}/${id}`);
  return res.ok ? res.data : null;
}

export async function createRecord(table: string, row: unknown): Promise<number | null> {
  const res = await tb("POST", `/api/records/v1/${table}`, row);
  const id = res.ok ? res.data?.ids?.[0] : null;
  return id != null ? Number(id) : null;
}

export async function updateRecord(table: string, id: number | string, patch: unknown): Promise<boolean> {
  const res = await tb("PATCH", `/api/records/v1/${table}/${id}`, patch);
  return res.ok;
}

/**
 * Audit trail (TNS-014 / CTL): every admin action lands in TrailBase
 * audit_events exactly the way the trade engine writes them.
 */
export async function audit(
  user: string | null,
  action: string,
  entity: string,
  entityId: number | string | null,
  source: string,
  payload: unknown,
): Promise<void> {
  try {
    await createRecord("audit_events", {
      user,
      action,
      entity,
      entity_id: entityId != null ? Number(entityId) : null,
      source,
      payload: JSON.stringify(payload ?? {}),
      created_at: nowIso(),
    });
  } catch (err) {
    console.warn(`[trust] audit write failed (${action}):`, (err as Error).message);
  }
}

/**
 * In-app notification (GOV-010): insert a TrailBase notifications row so the
 * user sees the notice in their bell. Accepts a TrailBase user UUID.
 */
export async function notifyUser(
  userUuid: string,
  type: string,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  if (!userUuid) return;
  try {
    await createRecord("notifications", {
      user: userUuid,
      type,
      title,
      body,
      link,
      read: 0,
      created_at: nowIso(),
    });
  } catch (err) {
    console.warn(`[trust] notify insert failed:`, (err as Error).message);
  }
}

/** Resolve a username → TrailBase user UUID via the world-readable profiles. */
export async function userUuid(username: string): Promise<string> {
  try {
    const rows = await getRecords(
      "profiles",
      `filter[username][$eq]=${encodeURIComponent(username)}&limit=1`,
    );
    return rows[0]?.user ?? "";
  } catch {
    return "";
  }
}
