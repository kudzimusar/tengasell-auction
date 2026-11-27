// paynow-client.ts — shared CLIENT-side helpers for the Paynow surface.
//
// Everything here runs in the browser: reading the signed-in TrailBase
// token (the R1 authenticated poll requires it as a Bearer header) and
// POSTing /api/paynow/poll with it. Server-only modules must never import
// this file.

/** The signed-in TrailBase auth token (mirrors RemoteApi's storage). */
export function readTrailbaseToken(): string | null {
  try {
    const raw = localStorage.getItem("ts_auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

/** Minimal customer-safe poll DTO (must mirror the server response). */
export interface PaynowPollBody {
  ok?: boolean;
  status?: string;
  reference?: string;
  amount?: number;
  method?: string;
  orderId?: number;
  title?: string;
  payBy?: string | null;
  phoneMask?: string | null;
  error?: string;
}

export interface PaynowPollOutcome {
  /** HTTP status code (0 = network failure). */
  http: number;
  body: PaynowPollBody | null;
}

/**
 * POST /api/paynow/poll with the caller's session credentials
 * (`{ orderId }` for the return-page loop, `{ reference }` for the
 * sandbox page). Unauthenticated calls are rejected by the server with
 * 401 — this helper never fabricates a status on failure: callers must
 * treat non-2xx/network results as "unknown", never "paid".
 */
export async function postPaynowPoll(payload: {
  orderId?: number;
  reference?: string;
}): Promise<PaynowPollOutcome> {
  const token = readTrailbaseToken();
  try {
    const res = await fetch("/api/paynow/poll", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as PaynowPollBody | null;
    return { http: res.status, body };
  } catch {
    return { http: 0, body: null };
  }
}

/** Public payment capability descriptor from GET /api/paynow/config. */
export interface PaynowConfig {
  ok: boolean;
  mode: "live" | "sandbox";
  simulatedPayments: boolean;
}

export async function fetchPaynowConfig(): Promise<PaynowConfig | null> {
  try {
    const res = await fetch("/api/paynow/config", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as PaynowConfig | null;
    return body?.ok ? body : null;
  } catch {
    return null;
  }
}
