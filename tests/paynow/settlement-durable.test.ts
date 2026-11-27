// R3 — durable settlement, negative tests:
//   · crash after marking a session paid (before/during the writes):
//     the settlement journal keeps the claim, the recovery sweep completes
//     the order/payment/notification exactly once
//   · duplicate callbacks (repeat settle calls) and concurrent settles
//     (multiple processes simulated) → exactly one payments row /
//     notification / audit row
//   · cross-process durability: a fresh module instance (new "process")
//     re-settling a done journal writes nothing
//   · a FRESH pending claim (another process actively settling) blocks
//     duplicate writes
//   · amount-invariant: session amount ≠ authoritative order amount →
//     never settled (disputed, support path)

import { describe, it, expect, beforeEach } from "vitest";
import {
  createDb,
  installFetchMock,
  freshModules,
  OLD,
  FRESH,
  count,
  type DbState,
  type SessionSeed,
} from "./test-utils";

const REF = "TS-ORDR11-1760000000011";

let db: DbState;

function seed(session: Partial<SessionSeed> = {}) {
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
        status: "paid",
        updated_at: OLD,
        ...session,
      } as SessionSeed,
    ],
  });
  installFetchMock(db);
}

async function loadSettle() {
  const { paynowOrder } = await freshModules();
  return paynowOrder.settlePaidOrder;
}

async function loadRecovery() {
  const { paynowReconcile } = await freshModules();
  return paynowReconcile.sweepSettlementRecovery;
}

function sessionRow(): Record<string, unknown> {
  return db.rows.paynow_sessions[0];
}

function journal(): Record<string, unknown> | undefined {
  return db.rows.paynow_settlements[0];
}

beforeEach(() => {
  seed();
});

describe("R3 — durable settlement", () => {
  it("settles fully on the happy path: order, payments, notification, audit, journal, finance", async () => {
    const settle = await loadSettle();
    const order = await settle((await import("@/lib/server/paynow-order")).toSessionRow(sessionRow())!);
    expect(order?.status).toBe("paid");
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
    expect(count(db, "notifications", (n) => n.link === "#/orders/11")).toBe(1);
    expect(count(db, "audit_events", (a) => a.action === "order:pay")).toBe(1);
    expect(journal()?.status).toBe("done");
    expect(db.financeEvents.length).toBe(1);
    expect((db.financeEvents[0] as { type?: string }).type).toBe("order.paid");
  });

  it("duplicate callbacks (repeat settles) never double-write", async () => {
    const settle = await loadSettle();
    const toSessionRow = (await import("@/lib/server/paynow-order")).toSessionRow;
    for (let i = 0; i < 4; i++) {
      await settle(toSessionRow(sessionRow())!);
    }
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
    expect(count(db, "notifications", (n) => n.link === "#/orders/11")).toBe(1);
    expect(count(db, "audit_events", (a) => a.action === "order:pay")).toBe(1);
    expect(count(db, "paynow_settlements", () => true)).toBe(1);
  });

  it("concurrent settles (two processes racing on the same paid session) write one payments row", async () => {
    const settle = await loadSettle();
    const toSessionRow = (await import("@/lib/server/paynow-order")).toSessionRow;
    await Promise.all([
      settle(toSessionRow(sessionRow())!),
      settle(toSessionRow(sessionRow())!),
      settle(toSessionRow(sessionRow())!),
    ]);
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
    expect(count(db, "notifications", (n) => n.link === "#/orders/11")).toBe(1);
    expect(count(db, "paynow_settlements", () => true)).toBe(1);
  });

  it("crash after the order transition (payments insert fails): the journal stays pending and the recovery sweep completes the settlement exactly once", async () => {
    db.failOnce.paymentsInsert = true; // simulate the process dying mid-write
    let settle = await loadSettle();
    const toSessionRow = (await import("@/lib/server/paynow-order")).toSessionRow;
    await settle(toSessionRow(sessionRow())!); // order patched, payments missing

    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
    expect(count(db, "payments", () => true)).toBe(0);
    expect(journal()?.status).toBe("pending");
    expect(String(journal()?.last_error)).toContain("payments insert failed");

    // 120s pass (the claim goes stale) — emulate by ageing the journal row:
    db.rows.paynow_settlements[0].updated_at = OLD;

    const recovery = await loadRecovery();
    const result = await recovery();
    expect(result.recovered).toBe(1);
    expect(journal()?.status).toBe("done");
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
    expect(count(db, "notifications", (n) => n.link === "#/orders/11")).toBe(1);
    expect(count(db, "audit_events", (a) => a.action === "order:pay")).toBe(1);

    // a second recovery pass is a no-op:
    settle = await loadSettle();
    await recovery();
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
    expect(count(db, "notifications", (n) => n.link === "#/orders/11")).toBe(1);
  });

  it("crash before ANY settlement write (paid session, no journal, order still pending): the recovery lane settles it", async () => {
    const recovery = await loadRecovery();
    const result = await recovery();
    expect(result.recovered).toBe(1);
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("paid");
    expect(journal()?.status).toBe("done");
    expect(count(db, "payments", (p) => p.reference === REF)).toBe(1);
  });

  it("a FRESH pending claim (another process actively settling) blocks duplicate writes", async () => {
    // Another worker just claimed the settlement seconds ago.
    db.rows.paynow_settlements = [
      {
        id: 1,
        reference: REF,
        order_id: 11,
        status: "pending",
        attempts: 1,
        last_error: null,
        created_at: FRESH,
        updated_at: FRESH,
      },
    ];
    const settle = await loadSettle();
    const toSessionRow = (await import("@/lib/server/paynow-order")).toSessionRow;
    await settle(toSessionRow(sessionRow())!);
    // blocked: nothing was written, the other process owns the claim
    expect(count(db, "payments", () => true)).toBe(0);
    expect(count(db, "notifications", () => true)).toBe(0);
    expect(db.rows.orders.find((o) => o.id === 11)?.status).toBe("pending_payment");
  });

  it("cross-process durability: a fresh module instance (simulated new process) re-settling a done journal writes nothing", async () => {
    const settle = await loadSettle();
    const toSessionRow = (await import("@/lib/server/paynow-order")).toSessionRow;
    await settle(toSessionRow(sessionRow())!);
    const writesBefore = {
      payments: count(db, "payments", () => true),
      notifications: count(db, "notifications", () => true),
      audits: count(db, "audit_events", () => true),
    };

    // "New process": fresh module registry, empty in-process guards.
    const settle2 = (await freshModules()).paynowOrder.settlePaidOrder;
    const toSessionRow2 = (await freshModules()).paynowOrder.toSessionRow;
    await settle2(toSessionRow2(sessionRow())!);

    expect(count(db, "payments", () => true)).toBe(writesBefore.payments);
    expect(count(db, "notifications", () => true)).toBe(writesBefore.notifications);
    expect(count(db, "audit_events", () => true)).toBe(writesBefore.audits);
  });

  it("session amount contradicting the authoritative order amount is never settled (disputed)", async () => {
    seed({ amount: 8 }); // order final_price is 10 — tampered/buggy row
    const settle = await loadSettle();
    const toSessionRow = (await import("@/lib/server/paynow-order")).toSessionRow;
    const order = await settle(toSessionRow(sessionRow())!);
    expect(order?.status).toBe("pending_payment"); // NOT settled
    expect(db.rows.paynow_sessions[0].status).toBe("disputed");
    expect(String(db.rows.paynow_sessions[0].error)).toContain("order-amount-mismatch");
    expect(count(db, "payments", () => true)).toBe(0);
    expect(count(db, "paynow_settlements", () => true)).toBe(0);
    expect(
      count(db, "audit_events", (a) => a.action === "paynow:settle-rejected"),
    ).toBe(1);
  });
});
