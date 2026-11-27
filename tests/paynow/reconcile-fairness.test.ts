// R2 — reconciliation fairness, negative test:
//   · 21+ stale pending sessions with a FIXED batch limit (20): the
//     rotating cursor must reach sessions BEYOND the first batch —
//     abandoned pending sessions can never indefinitely starve later
//     sessions from being checked.
//   · also proves abandoned-but-forever-pending rows do not block later
//     sessions from settling.

import { describe, it, expect, beforeEach } from "vitest";
import {
  createDb,
  installFetchMock,
  freshModules,
  OLD,
  type DbState,
} from "./test-utils";

let db: DbState;
let sweepPending: () => Promise<{ checked: number; updated: number; settled: number }>;

beforeEach(async () => {
  // 25 stale pending sessions (ids 1..25) — all older than the sweep's
  // 120s staleness window, in live mode.
  db = createDb({
    orders: Array.from({ length: 25 }, (_, i) => ({
      id: 100 + i,
      buyer_username: "buyer1",
      seller_username: "seller1",
      final_price: 10,
    })),
    sessions: Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      order_id: 100 + i,
      reference: `TS-ORDR${100 + i}-17600000000${String(i + 1).padStart(2, "0")}`,
      amount: 10,
      status: "pending" as string,
      poll_url: `https://www.paynow.co.zw/Interface/CheckPayment/?ref=TS-ORDR${100 + i}-17600000000${String(i + 1).padStart(2, "0")}`,
      updated_at: OLD,
    })),
  });
  installFetchMock(db);
  const { paynowReconcile } = await freshModules();
  sweepPending = paynowReconcile.sweepPendingPaynowSessions;
  // Reset the rotating cursor between tests (module state is globalThis).
  const g = globalThis as unknown as { __tgsPaynowSweepCursor?: number };
  delete g.__tgsPaynowSweepCursor;
});

function setGateway(status: string, amount = "10.00") {
  for (const s of db.rows.paynow_sessions) {
    db.gateway.set(String(s.reference), { status, amount });
  }
}

describe("R2 — sweep fairness (21+ stale pending sessions)", () => {
  it("checks ALL 25 sessions across two sweeps despite the batch limit of 20", async () => {
    setGateway("pending"); // all abandoned — gateway keeps saying pending

    const first = await sweepPending();
    expect(first.checked).toBe(20); // batch 1: ids 1..20

    const second = await sweepPending();
    expect(second.checked).toBe(5); // batch 2: ids 21..25 — NOT starved

    // Sessions 21..25 (beyond the first batch) were actually polled:
    for (let i = 21; i <= 25; i++) {
      const ref = String(db.rows.paynow_sessions[i - 1].reference);
      expect(db.gatewayPolls.get(ref) ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("wraps the cursor so the next rotation re-examines from the start", async () => {
    setGateway("pending");
    await sweepPending();
    await sweepPending();
    const third = await sweepPending();
    expect(third.checked).toBe(20); // wrapped: ids 1..20 again
  });

  it("abandoned forever-pending sessions cannot starve later paid ones from settling", async () => {
    // Sessions 1..20 stay 'pending' forever (abandoned); 21..25 are paid.
    let i = 0;
    for (const s of db.rows.paynow_sessions) {
      i += 1;
      db.gateway.set(String(s.reference), { status: i <= 20 ? "pending" : "paid", amount: "10.00" });
    }

    await sweepPending(); // checks 1..20 — none settle
    const second = await sweepPending(); // checks 21..25

    expect(second.settled).toBe(5);
    for (let k = 0; k < 5; k++) {
      expect(db.rows.orders.find((o) => o.id === 120 + k)?.status).toBe("paid");
    }
    // the abandoned 20 remain pending_payment, unchecked-blocked no more
    for (let k = 0; k < 20; k++) {
      expect(db.rows.orders.find((o) => o.id === 100 + k)?.status).toBe("pending_payment");
    }
  });

  it("a gateway-reported amount mismatch marks the session disputed and never settles", async () => {
    setGateway("paid", "9.50"); // session amount is 10.00 — mismatch
    const result = await sweepPending();
    expect(result.settled).toBe(0);
    expect(db.rows.orders.find((o) => o.id === 100)?.status).toBe("pending_payment");
    expect(db.rows.paynow_sessions[0].status).toBe("disputed");
    expect(String(db.rows.paynow_sessions[0].error)).toContain("amount-mismatch");
  });

  it("an unsafe stored poll_url is never called (fail closed)", async () => {
    db.rows.paynow_sessions[0].poll_url = "http://evil.example.com/poll"; // http + foreign host
    setGateway("paid");
    await sweepPending();
    expect(db.rows.orders.find((o) => o.id === 100)?.status).toBe("pending_payment");
    // no gateway call for that session, and no crash:
    const ref = String(db.rows.paynow_sessions[0].reference);
    expect(db.gatewayPolls.get(ref) ?? 0).toBe(0);
  });
});
