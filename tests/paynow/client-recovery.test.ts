// R5 — client recovery policy, negative tests (the pure decision table
// behind usePaynowReturn):
//   · transient network (http 0) and server errors (5xx) → RETRY, never
//     a claimed payment success
//   · 401 → sign-in stop; 404/none → quiet stop; paid ONLY when the
//     server said paid with ok:true — even a 500 carrying a paid body
//     must NOT confirm the payment
//   · cancelled/failed/disputed/none map to stop states with a retry note
//   · the retry budget constant is exported and bounded

import { describe, it, expect } from "vitest";
import { decidePoll, MAX_TRANSIENT_ERRORS } from "@/components/tengasell/pages/orders/paynow-return";
import { postPaynowPoll } from "@/lib/tengasell/paynow-client";

describe("R5 — poll decision table (never claims success on error)", () => {
  it("server errors retry", () => {
    expect(decidePoll({ http: 500, body: null })).toEqual({ kind: "retry" });
    expect(decidePoll({ http: 502, body: { ok: true, status: "paid" } }).kind).toBe("retry");
    expect(decidePoll({ http: 503, body: null })).toEqual({ kind: "retry" });
  });

  it("network failure (http 0) retries", () => {
    expect(decidePoll({ http: 0, body: null })).toEqual({ kind: "retry" });
  });

  it("a 5xx response carrying a PAID body must NOT confirm the payment", () => {
    const decision = decidePoll({ http: 500, body: { ok: true, status: "paid", amount: 10 } });
    expect(decision.kind).toBe("retry"); // never "paid"
  });

  it("401 (expired session) stops with the sign-in state", () => {
    expect(decidePoll({ http: 401, body: { ok: false } })).toEqual({ kind: "signin" });
  });

  it("404 and non-ok bodies stop quietly (none)", () => {
    expect(decidePoll({ http: 404, body: { ok: false, error: "nope" } })).toEqual({
      kind: "terminal",
      state: "none",
    });
    expect(decidePoll({ http: 200, body: null })).toEqual({ kind: "terminal", state: "none" });
    expect(decidePoll({ http: 200, body: { ok: false, error: "bad" } })).toEqual({
      kind: "terminal",
      state: "none",
    });
    expect(decidePoll({ http: 400, body: { ok: false } })).toEqual({
      kind: "terminal",
      state: "none",
    });
  });

  it("paid is only ever decided from an ok:true 2xx body", () => {
    expect(decidePoll({ http: 200, body: { ok: true, status: "paid", amount: 10 } })).toEqual({
      kind: "paid",
      amount: 10,
    });
    expect(decidePoll({ http: 200, body: { ok: true, status: "pending" } })).toEqual({
      kind: "pending",
    });
  });

  it("unsuccessful payments stop with the retry-note state", () => {
    expect(decidePoll({ http: 200, body: { ok: true, status: "cancelled" } })).toEqual({
      kind: "terminal",
      state: "cancelled",
    });
    expect(decidePoll({ http: 200, body: { ok: true, status: "failed" } })).toEqual({
      kind: "terminal",
      state: "cancelled",
    });
  });

  it("disputed and none stop quietly (support path / nothing to watch)", () => {
    expect(decidePoll({ http: 200, body: { ok: true, status: "disputed" } })).toEqual({
      kind: "terminal",
      state: "none",
    });
    expect(decidePoll({ http: 200, body: { ok: true, status: "none" } })).toEqual({
      kind: "terminal",
      state: "none",
    });
  });

  it("the transient retry budget is bounded (6 consecutive failures then stop)", () => {
    expect(MAX_TRANSIENT_ERRORS).toBe(6);
    // six transient outcomes exhaust the budget → the hook transitions to
    // "unreachable" with a manual re-check action (see usePaynowReturn).
  });
});

describe("R5 — postPaynowPoll transport", () => {
  it("maps a thrown fetch to http 0 with a null body (never fabricates status)", async () => {
    const original = global.fetch;
    global.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    try {
      const outcome = await postPaynowPoll({ orderId: 11 });
      expect(outcome.http).toBe(0);
      expect(outcome.body).toBeNull();
    } finally {
      global.fetch = original;
    }
  });
});
