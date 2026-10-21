// trailbase.ts — the finance-service's own TrailBase admin client.
// Mirrors the trade-engine's login/record helpers (admin token + one 401
// retry). Used by the reconciliation tie-out (COM-024), the 60s self-heal
// sweep and the demo seeder — finance.db is the LEDGER authority and
// TrailBase stays the ORDER authority (worklog 12-plan §G).

import { TRAILBASE, ADMIN_USERNAME, ADMIN_PASSWORD } from "./config";

let adminToken: string | null = null;

export async function tbLogin(): Promise<string> {
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
  adminToken ??= await tbLogin();
  return adminToken;
}

async function tb(
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
      /* empty body */
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

async function listRecords(table: string, params: string): Promise<any[]> {
  const res = await tb("GET", `/api/records/v1/${table}?${params}`);
  return res.ok ? (res.data?.records ?? []) : [];
}

export async function tbListOrders(limit = 200): Promise<any[]> {
  return listRecords("orders", `order=-id&limit=${limit}`);
}

export async function tbListPayments(limit = 500): Promise<any[]> {
  return listRecords("payments", `order=-id&limit=${limit}`);
}

export async function tbGetOrder(orderId: number): Promise<any | null> {
  const res = await tb("GET", `/api/records/v1/orders/${orderId}`);
  return res.ok ? res.data : null;
}

export async function tbGetAuction(auctionId: number): Promise<any | null> {
  const res = await tb("GET", `/api/records/v1/auctions/${auctionId}`);
  return res.ok ? res.data : null;
}

/** Drop the cached admin session (login failures on next call). */
export function tbResetToken(): void {
  adminToken = null;
}
