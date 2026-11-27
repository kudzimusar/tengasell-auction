// R4 — gateway trust boundary, negative tests:
//   · amount mismatch between hash-valid gateway evidence and the session
//     → disputed, never settled
//   · missing amount → fail closed
//   · unsafe gateway polling URLs (http / foreign host) are rejected and
//     never stored; Paynow-hosted https URLs are kept
//   · invalid hash → 403; unknown reference → 404
//   · missing production credentials (no integration key) → 503 fail closed
//   · poll path: gateway reporting paid with a mismatched amount → no
//     settlement, disputed session

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import {
  createDb,
  installFetchMock,
  tokenFor,
  OLD,
  count,
  type DbState,
} from "./test-utils";

const INTEGRATION_KEY = "test-integration-key";
const REF = "TS-ORDR11-1760000000011";

let db: DbState;
let callbackPOST: (r: NextRequest) => Promise<Response>;
let pollPOST: (r: NextRequest) => Promise<Response>;

beforeEach(async () => {
  db = createDb({
    orders: [
      { id: 11, buyer_username: "buyer1", seller_username: "seller1", final_price: 10 },
    ],
    sessions: [
      {
        id: 1,
        order_id: 11,
        reference: REF,
        amount: 10,
        method: "ecocash",
        status: "pending",
        poll_url: "https://www.paynow.co.zw/Interface/CheckPayment/?ref=" + REF,
        updated_at: OLD,
      },
    ],
  });
  installFetchMock(db);
});

afterEach(() => {
  delete process.env.PAYNOW_INTEGRATION_ID;
  delete process.env.PAYNOW_INTEGRATION_KEY;
  process.env.PAYNOW_INTEGRATION_ID = "9999";
  process.env.PAYNOW_INTEGRATION_KEY = INTEGRATION_KEY;
});

/** Build a hash-validated callback form body in exact field order. */
async function callbackBody(fields: Record<string, string>): Promise<string> {
  const { paynowHash } = await import("@/lib/server/paynow");
  const values = Object.entries(fields)
    .filter(([k]) => k.toLowerCase() !== "hash")
    .map(([, v]) => v);
  const hash = paynowHash(values, INTEGRATION_KEY);
  return new URLSearchParams({ ...fields, hash }).toString();
}

async function loadRoutes() {
  ({ POST: callbackPOST } = await import("@/app/api/paynow/callback/route"));
  ({ POST: pollPOST } = await import("@/app/api/paynow/poll/route"));
}

function post(url: string, body: string, headers?: Record<string, string>) {
  const r = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(headers ?? {}) },
    body,
  });
  return (url.includes("callback") ? callbackPOST : pollPOST)(r as unknown as NextRequest);
}

describe("R4 — callback trust boundary", () => {
  it("a valid paid callback with a matching amount settles the order", async () => {
    await loadRoutes();
    const body = await callbackBody({
      reference: REF,
      paynowreference: "PN-123",
      amount: "10.00",
      status: "paid",
      pollurl: "https://www.paynow.co.zw/Interface/CheckPayment/?ref=" + REF,
    });
    const res = await post("http://localhost:3000/api/paynow/callback", body);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(db.rows.paynow_sessions[0].status).toBe("paid");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
    expect(count(db, "paynow_settlements", (j) => j.status === "done")).toBe(1);
  });

  it("a hash-valid callback with a MISMATCHED amount is disputed and never settles", async () => {
    await loadRoutes();
    const body = await callbackBody({
      reference: REF,
      paynowreference: "PN-123",
      amount: "5.00", // session is 10.00
      status: "paid",
      pollurl: "https://www.paynow.co.zw/Interface/CheckPayment/?ref=" + REF,
    });
    const res = await post("http://localhost:3000/api/paynow/callback", body);
    expect(res.status).toBe(200); // acknowledged to stop retries
    expect(db.rows.paynow_sessions[0].status).toBe("disputed");
    expect(String(db.rows.paynow_sessions[0].error)).toContain("amount-mismatch");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("pending_payment");
    expect(count(db, "payments", () => true)).toBe(0);
    expect(
      count(db, "audit_events", (a) => a.action === "paynow:callback"),
    ).toBe(1);
  });

  it("a hash-valid callback with a MISSING amount fails closed (no settlement)", async () => {
    await loadRoutes();
    const body = await callbackBody({
      reference: REF,
      paynowreference: "PN-123",
      status: "paid",
      pollurl: "https://www.paynow.co.zw/Interface/CheckPayment/?ref=" + REF,
    });
    const res = await post("http://localhost:3000/api/paynow/callback", body);
    expect(res.status).toBe(200);
    expect(db.rows.paynow_sessions[0].status).toBe("disputed");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("pending_payment");
    expect(count(db, "payments", () => true)).toBe(0);
  });

  it("rejects an unsafe gateway pollurl (http, foreign host) — never stored, never called", async () => {
    await loadRoutes();
    const original = String(db.rows.paynow_sessions[0].poll_url);
    const body = await callbackBody({
      reference: REF,
      paynowreference: "PN-123",
      amount: "10.00",
      status: "paid",
      pollurl: "http://evil.example.com/poll?ref=" + REF,
    });
    const res = await post("http://localhost:3000/api/paynow/callback", body);
    expect(res.status).toBe(200);
    expect(db.rows.paynow_sessions[0].poll_url).toBe(original); // unchanged
    expect(
      count(db, "audit_events", (a) => a.action === "paynow:callback"),
    ).toBeGreaterThanOrEqual(1); // pollurl-rejected signal
    // the stored safe URL may still be used for settlement:
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
  });

  it("rejects an invalid hash outright (403), nothing is written", async () => {
    await loadRoutes();
    const body = new URLSearchParams({
      reference: REF,
      amount: "10.00",
      status: "paid",
      hash: "DEADBEEF",
    }).toString();
    const res = await post("http://localhost:3000/api/paynow/callback", body);
    expect(res.status).toBe(403);
    expect(count(db, "payments", () => true)).toBe(0);
  });

  it("unknown references are 404", async () => {
    await loadRoutes();
    const body = await callbackBody({
      reference: "TS-ORDR11-1760000000099",
      amount: "10.00",
      status: "paid",
    });
    const res = await post("http://localhost:3000/api/paynow/callback", body);
    expect(res.status).toBe(404);
  });

  it("missing production credentials → 503 fail closed", async () => {
    delete process.env.PAYNOW_INTEGRATION_KEY;
    await loadRoutes();
    const res = await post("http://localhost:3000/api/paynow/callback", "reference=" + REF);
    expect(res.status).toBe(503);
  });

  it("poll path: gateway reports 'paid' with a mismatched amount → disputed, no settlement", async () => {
    await loadRoutes();
    db.gateway.set(REF, { status: "paid", amount: "7.00" }); // session 10.00
    const r = new Request("http://localhost:3000/api/paynow/poll", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFor("buyer1")}`,
      },
      body: JSON.stringify({ reference: REF }),
    });
    const res = await pollPOST(r as unknown as NextRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("disputed");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("pending_payment");
    expect(count(db, "payments", () => true)).toBe(0);
  });

  it("poll path: matching gateway evidence settles via the return-page loop", async () => {
    await loadRoutes();
    db.gateway.set(REF, { status: "paid", amount: "10.00" });
    const r = new Request("http://localhost:3000/api/paynow/poll", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFor("buyer1")}`,
      },
      body: JSON.stringify({ orderId: 11 }),
    });
    const res = await pollPOST(r as unknown as NextRequest);
    const body = await res.json();
    expect(body.status).toBe("paid");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
  });
});
