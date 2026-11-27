// R6 — mock/live safety, negative tests:
//   · production + missing credentials: the sandbox route can no longer
//     approve payments (403) and initiate fails closed (503, no session
//     row) — a missing Fly secret must never turn the mock into a free
//     "approve payment" button
//   · explicit PAYNOW_ALLOW_MOCK=1 re-enables the demo path
//   · development keeps the sandbox flow working (dev parity)
//   · sandbox approval is party-authenticated (buyer ok, anonymous 401,
//     stranger 404)
//   · an unsuccessful payment (decline) leaves the order pending
//   · the trade engine's simulated order:pay gate fails closed in
//     production unless explicitly enabled

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import {
  createDb,
  installFetchMock,
  tokenFor,
  count,
  type DbState,
} from "./test-utils";

const REF = "TS-ORDR11-1760000000011";
const BUYER = tokenFor("buyer1");

let db: DbState;
let initiatePOST: (r: NextRequest) => Promise<Response>;
let sandboxPOST: (r: NextRequest) => Promise<Response>;

beforeEach(async () => {
  db = createDb({
    orders: [
      { id: 11, buyer_username: "buyer1", seller_username: "seller1", final_price: 10 },
    ],
    sessions: [
      { id: 1, order_id: 11, reference: REF, amount: 10, status: "pending" },
    ],
  });
  installFetchMock(db);
});

afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  delete process.env.PAYNOW_ALLOW_MOCK;
});

function env(creds: boolean, production: boolean, allowMock?: string) {
  const e = process.env as Record<string, string | undefined>;
  if (creds) {
    e.PAYNOW_INTEGRATION_ID = "9999";
    e.PAYNOW_INTEGRATION_KEY = "test-integration-key";
  } else {
    delete e.PAYNOW_INTEGRATION_ID;
    delete e.PAYNOW_INTEGRATION_KEY;
  }
  e.NODE_ENV = production ? "production" : "development";
  if (allowMock === undefined) delete e.PAYNOW_ALLOW_MOCK;
  else e.PAYNOW_ALLOW_MOCK = allowMock;
}

async function loadRoutes() {
  ({ POST: initiatePOST } = await import("@/app/api/paynow/initiate/route"));
  ({ POST: sandboxPOST } = await import("@/app/api/paynow/sandbox/route"));
}

function callInitiate(token?: string, orderId = 11) {
  const r = new Request("http://localhost:3000/api/paynow/initiate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ orderId, method: "ecocash", phone: "0771234567" }),
  });
  return initiatePOST(r as unknown as NextRequest);
}

function callSandbox(action: "approve" | "decline", token?: string, reference = REF) {
  const r = new Request("http://localhost:3000/api/paynow/sandbox", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ reference, action }),
  });
  return sandboxPOST(r as unknown as NextRequest);
}

describe("R6 — mock payments cannot approve in production", () => {
  it("production + missing credentials: sandbox approval is rejected (403) and settles nothing", async () => {
    env(false, true); // production, no PAYNOW_* credentials
    await loadRoutes();
    const res = await callSandbox("approve", BUYER);
    expect(res.status).toBe(403);
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("pending_payment");
    expect(count(db, "payments", () => true)).toBe(0);
  });

  it("production + missing credentials: initiate fails closed — no session row is created", async () => {
    env(false, true);
    await loadRoutes();
    const res = await callInitiate(BUYER);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(count(db, "paynow_sessions", (s) => Number(s.id) > 1)).toBe(0);
  });

  it("production + PAYNOW_ALLOW_MOCK=1 (explicit demo opt-in): the sandbox flow works", async () => {
    env(false, true, "1");
    await loadRoutes();
    const res = await callSandbox("approve", BUYER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("paid");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
  });

  it("development (no credentials): initiate opens a sandbox session with a minimal response and no phone in the URL", async () => {
    env(false, false);
    await loadRoutes();
    const res = await callInitiate(BUYER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("sandbox");
    // minimal customer-safe response (R7): no gateway pollUrl, no reference
    expect(Object.keys(body).sort()).toEqual(["mode", "ok", "orderId", "redirectUrl"].sort());
    // the sandbox redirect URL carries display hints but never the phone
    const redirect = new URL("http://localhost:3000/" + String(body.redirectUrl).replace(/^#/, ""));
    expect(redirect.searchParams.has("phone")).toBe(false);
    expect(redirect.searchParams.get("amount")).toBe("10.00");
    expect(count(db, "paynow_sessions", (s) => Number(s.id) > 1)).toBe(1);
  });

  it("sandbox approval requires a party token (anonymous 401, stranger 404)", async () => {
    env(false, false);
    await loadRoutes();
    const anon = await callSandbox("approve");
    expect(anon.status).toBe(401);
    const stranger = await callSandbox("approve", tokenFor("mallory"));
    expect(stranger.status).toBe(404);
    const buyer = await callSandbox("approve", BUYER);
    expect(buyer.status).toBe(200);
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
  });

  it("an unsuccessful payment (decline) leaves the order pending", async () => {
    env(false, false);
    await loadRoutes();
    const res = await callSandbox("decline", BUYER);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("cancelled");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("pending_payment");
    expect(count(db, "payments", () => true)).toBe(0);
  });
});

describe("R6 — trade engine simulated-payment gate", () => {
  const envAsRecord = process.env as Record<string, string | undefined>;
  const saveNodeEnv = process.env.NODE_ENV;

  it("ALLOW_SIMULATED_PAYMENTS=1 allows simulated settlement", async () => {
    const { simulatedPaymentsAllowed } = await import("../../mini-services/trade-engine/pay-gate");
    expect(simulatedPaymentsAllowed({ ALLOW_SIMULATED_PAYMENTS: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("ALLOW_SIMULATED_PAYMENTS=0 blocks simulated settlement even in development", async () => {
    const { simulatedPaymentsAllowed } = await import("../../mini-services/trade-engine/pay-gate");
    expect(simulatedPaymentsAllowed({ ALLOW_SIMULATED_PAYMENTS: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("unset + NODE_ENV=production → blocked (fail closed)", async () => {
    const { simulatedPaymentsAllowed } = await import("../../mini-services/trade-engine/pay-gate");
    envAsRecord.NODE_ENV = "production";
    try {
      expect(simulatedPaymentsAllowed({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    } finally {
      envAsRecord.NODE_ENV = saveNodeEnv;
    }
  });

  it("unset + development → allowed (dev parity)", async () => {
    const { simulatedPaymentsAllowed } = await import("../../mini-services/trade-engine/pay-gate");
    envAsRecord.NODE_ENV = "development";
    try {
      expect(simulatedPaymentsAllowed({} as unknown as NodeJS.ProcessEnv)).toBe(true);
    } finally {
      envAsRecord.NODE_ENV = saveNodeEnv;
    }
  });
});
