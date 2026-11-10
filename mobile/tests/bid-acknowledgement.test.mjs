// CLOSE-01 regression suite — bid acknowledgement truthfulness.
//
// Drives the production presenter directly. The suite exists because the
// shipped version reported "You're the leading bidder" whenever the engine
// replied `ok` without a `winning` flag, and formatted a missing amount as
// US$0.

import assert from "node:assert/strict";
import test from "node:test";

import { presentBidOutcome } from "../src/lib/bid-copy.ts";

const money = (value) => `US$${value.toLocaleString("en-US")}`;

test("ACK-01 winning=true reports the lead at the accepted amount", () => {
  const result = presentBidOutcome({ ok: true, winning: true, amount: 700 }, money);

  assert.equal(result.tone, "success");
  assert.match(result.text, /leading bidder/i);
  assert.match(result.text, /US\$700/);
  assert.equal(result.reconcile, false);
});

test("ACK-02 outbid=true reports the standing bid, not a lead", () => {
  const result = presentBidOutcome({ ok: true, outbid: true, amount: 750 }, money);

  assert.equal(result.tone, "warning");
  assert.match(result.text, /outbid/i);
  assert.match(result.text, /US\$750/);
  assert.doesNotMatch(result.text, /you're the leading bidder/i);
  assert.equal(result.reconcile, true);
});

test("ACK-03 winning=false reports acceptance without the lead", () => {
  const result = presentBidOutcome({ ok: true, winning: false, amount: 700 }, money);

  assert.equal(result.tone, "warning");
  assert.match(result.text, /not leading/i);
  assert.match(result.text, /US\$700/);
});

test("ACK-04 missing winning is never treated as leading", () => {
  const result = presentBidOutcome({ ok: true, amount: 700 }, money);

  assert.notEqual(result.tone, "success");
  assert.equal(result.tone, "unknown");
  assert.doesNotMatch(result.text, /leading bidder/i);
  assert.equal(result.reconcile, true);
});

test("ACK-05 missing amount never fabricates US$0", () => {
  const winning = presentBidOutcome({ ok: true, winning: true }, money);
  const accepted = presentBidOutcome({ ok: true, winning: false }, money);
  const outbid = presentBidOutcome({ ok: true, outbid: true }, money);
  const zero = presentBidOutcome({ ok: true, winning: true, amount: 0 }, money);

  for (const result of [winning, accepted, outbid, zero]) {
    assert.doesNotMatch(result.text, /US\$0\b/);
    assert.doesNotMatch(result.text, /NaN|undefined|null/);
  }
  assert.equal(winning.tone, "success");
  assert.match(winning.text, /leading bidder/i);
});

test("ACK-06 contradictory flags never produce a success message", () => {
  const result = presentBidOutcome(
    { ok: true, outbid: true, winning: true, amount: 700 },
    money,
  );

  assert.equal(result.tone, "unknown");
  assert.doesNotMatch(result.text, /you're the leading bidder/i);
  assert.equal(result.reconcile, true);
});

test("ACK-07 malformed acknowledgement yields a truthful unknown state", () => {
  const empty = presentBidOutcome({ ok: true }, money);
  const junk = presentBidOutcome({ ok: true, amount: Number.NaN }, money);

  for (const result of [empty, junk]) {
    assert.equal(result.tone, "unknown");
    assert.equal(result.reconcile, true);
    assert.doesNotMatch(result.text, /leading bidder/i);
    assert.doesNotMatch(result.text, /US\$/);
  }
});

test("ACK-08 timeout is uncertain, not a rejection and not a success", () => {
  const result = presentBidOutcome(
    { ok: false, uncertain: true, reason: "timeout", error: "The auction engine did not respond." },
    money,
  );

  assert.equal(result.tone, "unknown");
  assert.equal(result.reconcile, true);
  assert.doesNotMatch(result.text, /not accepted|rejected|failed/i);
  assert.doesNotMatch(result.text, /leading bidder/i);
  assert.match(result.text, /may still have reached/i);
});
