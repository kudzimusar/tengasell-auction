// R1 — payment-status access control, negative tests:
//   · unauthenticated access (both reference and orderId paths) → 401
//   · cross-buyer access → 404 (indistinguishable from unknown reference)
//   · guessed sequential order IDs → 404, no session info
//   · payment reference enumeration → identical 404 body
//   · seller permissions → seller is a party and may READ status
//   · the response is a minimal customer-safe DTO (no order row, no raw
//     phone, no poll_url, no gateway hash) and phone is masked (R7)

import { describe, it, expect, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import {
  createDb,
  installFetchMock,
  freshModules,
  tokenFor,
  OLD,
  count,
  type DbState,
} from "./test-utils";

const SELLER_TOKEN = tokenFor("seller1");
const BUYER_TOKEN = tokenFor("buyer1");
const MALLORY_TOKEN = tokenFor("mallory");

let db: DbState;
let POST: (r: NextRequest) => Promise<Response>;

beforeEach(async () => {
  db = createDb({
    orders: [
      { id: 11, buyer_username: "buyer1", seller_username: "seller1", final_price: 10 },
      { id: 12, buyer_username: "buyer2", seller_username: "seller1", final_price: 25 },
    ],
    sessions: [
      {
        id: 1,
        order_id: 11,
        reference: "TS-ORDR11-1760000000001",
        amount: 10,
        phone: "07712343456",
        status: "pending",
      },
      {
        id: 2,
        order_id: 12,
        reference: "TS-ORDR12-1760000000002",
        amount: 25,
        status: "paid",
        updated_at: OLD,
      },
    ],
  });
  installFetchMock(db);
  ({ POST } = await import("@/app/api/paynow/poll/route"));
});

function call(body: unknown, token?: string) {
  const r = new Request("http://localhost:3000/api/paynow/poll", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return POST(r as unknown as NextRequest);
}

describe("R1 — poll access control", () => {
  it("rejects unauthenticated access on the orderId path", async () => {
    const res = await call({ orderId: 11 });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBeUndefined();
    expect(body.reference).toBeUndefined();
  });

  it("rejects unauthenticated access on the reference path", async () => {
    const res = await call({ reference: "TS-ORDR11-1760000000001" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("404s an authenticated non-party (cross-buyer) and gives no session info", async () => {
    const res = await call({ orderId: 11 }, MALLORY_TOKEN);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.status).toBeUndefined();
  });

  it("guessed sequential order IDs (another buyer's order) yield 404, identical to unknown ids", async () => {
    const resExisting = await call({ orderId: 12 }, MALLORY_TOKEN); // order exists, not mallory's
    const resUnknown = await call({ orderId: 9999 }, MALLORY_TOKEN); // does not exist
    expect(resExisting.status).toBe(404);
    expect(resUnknown.status).toBe(404);
    const a = await resExisting.json();
    const b = await resUnknown.json();
    expect(a).toEqual(b); // no existence signal between the two
  });

  it("payment reference enumeration is indistinguishable from unknown references", async () => {
    const resExists = await call({ reference: "TS-ORDR12-1760000000002" }, MALLORY_TOKEN);
    const resUnknown = await call({ reference: "TS-ORDR12-176000000999" }, MALLORY_TOKEN);
    expect(resExists.status).toBe(404);
    expect(resUnknown.status).toBe(404);
    expect(await resExists.json()).toEqual(await resUnknown.json());
  });

  it("the buyer gets a minimal customer-safe DTO — no admin-shaped fields", async () => {
    const res = await call({ orderId: 11 }, BUYER_TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("pending");
    expect(body.orderId).toBe(11);
    expect(body.amount).toBe(10);
    // exact minimal key set — none of the administrator-shaped extras
    expect(Object.keys(body).sort()).toEqual(
      ["amount", "method", "ok", "orderId", "payBy", "phoneMask", "reference", "status", "title"].sort(),
    );
    // forbidden fields never appear
    expect("order" in body).toBe(false);
    expect("phone" in body).toBe(false);
    expect("poll_url" in body).toBe(false);
    expect("pollUrl" in body).toBe(false);
    expect("paynow_hash" in body).toBe(false);
    expect(body.buyer_user).toBeUndefined();
    expect(body.seller_user).toBeUndefined();
    expect(body.final_price).toBeUndefined();
  });

  it("the buyer's phone is returned masked only (R7)", async () => {
    const res = await call({ reference: "TS-ORDR11-1760000000001" }, BUYER_TOKEN);
    const body = await res.json();
    expect(body.phoneMask).toBe("••• ••• 3456");
    expect(JSON.stringify(body)).not.toContain("07712343456");
  });

  it("the seller is a party and may read the payment status", async () => {
    const res = await call({ orderId: 11 }, SELLER_TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("pending");
  });

  it("a party with no gateway session yet gets status 'none' (not an error)", async () => {
    const res = await call({ orderId: 11 }, BUYER_TOKEN);
    // session exists for 11 — remove it and retry:
    db.rows.paynow_sessions = db.rows.paynow_sessions.filter((s) => s.order_id !== 11);
    const res2 = await call({ orderId: 11 }, BUYER_TOKEN);
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("none");
    expect(res.status).toBe(200);
  });

  it("an invalid-format reference is 404 — same as any unknown one", async () => {
    const res = await call({ reference: "TS-ORDR1-1" }, BUYER_TOKEN);
    expect(res.status).toBe(404);
  });

  it("a paid session settles idempotently through repeated authorized polls", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await call({ reference: "TS-ORDR12-1760000000002" }, tokenFor("buyer2"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("paid");
    }
    expect(count(db, "payments", (p) => p.order_id === 12)).toBe(1);
    expect(count(db, "notifications", (n) => n.link === "#/orders/12")).toBe(1);
    expect(count(db, "paynow_settlements", (j) => j.status === "done")).toBe(1);
    expect(db.rows.orders.find((o) => o.id === 12)?.status).toBe("paid");
  });
});
