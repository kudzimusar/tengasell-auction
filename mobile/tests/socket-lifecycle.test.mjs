// MOB-03 socket/session safety — epoch ownership, late-connect rejection,
// bid-ack presentation, and source-level guarantees.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ConnectionEpoch } from "../src/lib/connection-epoch.ts";
import { presentBidOutcome } from "../src/lib/bid-copy.ts";

const usd = (n) => `US$${n}`;
const socketSource = readFileSync("src/lib/socket.ts", "utf8");
const itemSource = readFileSync("src/app/item/[id].tsx", "utf8");

test("SOCK-01 a connect attempt owns exactly one epoch", () => {
  const e = new ConnectionEpoch();
  const first = e.next();
  assert.equal(e.isCurrent(first), true);
});

test("SOCK-02 logout invalidates an outstanding connect (late completion discarded)", () => {
  const e = new ConnectionEpoch();
  const attempt = e.next();
  e.invalidate(); // logout
  assert.equal(e.isCurrent(attempt), false, "late connect must not be adopted");
});

test("SOCK-03 account switch supersedes the previous connection", () => {
  const e = new ConnectionEpoch();
  const firstAccount = e.next();
  const secondAccount = e.next();
  assert.equal(e.isCurrent(firstAccount), false);
  assert.equal(e.isCurrent(secondAccount), true);
});

test("SOCK-04 reconnect after logout takes a fresh, valid epoch", () => {
  const e = new ConnectionEpoch();
  e.next();
  e.invalidate();
  const afterLogin = e.next();
  assert.equal(e.isCurrent(afterLogin), true);
});

test("SOCK-05 repeated invalidation keeps stale attempts rejected", () => {
  const e = new ConnectionEpoch();
  const attempt = e.next();
  e.invalidate();
  e.invalidate();
  e.invalidate();
  assert.equal(e.isCurrent(attempt), false);
});

test("SOCK-06 accepted proxy bid that is outbid never claims the lead", () => {
  const presented = presentBidOutcome({ ok: true, amount: 695, outbid: true }, usd);
  assert.equal(presented?.tone, "warning");
  assert.match(presented.text, /outbid/i);
  assert.match(presented.text, /US\$695/);
  assert.doesNotMatch(presented.text, /leading bidder/);
});

test("SOCK-07 winning bid reports the lead with the engine amount", () => {
  const presented = presentBidOutcome({ ok: true, amount: 700, winning: true }, usd);
  assert.equal(presented?.tone, "success");
  assert.match(presented.text, /leading bidder at US\$700/);
});

test("SOCK-08 ok-but-not-leading is surfaced as a warning, not success", () => {
  const presented = presentBidOutcome({ ok: true, amount: 700, winning: false }, usd);
  assert.equal(presented?.tone, "warning");
  assert.match(presented.text, /not leading/i);
});

test("SOCK-09 uncoded engine rejection stays uncertain; structured rejection shows error", () => {
  const uncoded = presentBidOutcome({ ok: false, error: "This auction has ended." }, usd);
  assert.equal(uncoded?.tone, "unknown");
  assert.equal(uncoded.reconcile, true);
  assert.doesNotMatch(uncoded.text, /ended|retry|failed/i);

  const structured = presentBidOutcome(
    { ok: false, rejected: true, stage: "pre_commit", error: "This auction has ended." },
    usd,
  );
  assert.equal(structured?.tone, "error");
  assert.equal(structured.text, "This auction has ended.");
});

test("SOCK-10 source: disconnect invalidates ownership and late connects are dropped", () => {
  assert.match(socketSource, /ownership\.invalidate\(\)/, "disconnect must invalidate the epoch");
  assert.match(socketSource, /ownership\.isCurrent\(attempt\)/, "connect handler must check ownership");
  // ICR03: the guard must dispose the attempt's own socket and only clear the
  // module slot if that attempt still owns it. Tearing down `socket` blindly
  // would close a newer, valid connection.
  assert.match(
    socketSource,
    /const attemptSocket = io\(/,
    "the attempt must hold its own socket reference",
  );
  assert.match(
    socketSource,
    /attemptSocket\.disconnect\(\)/,
    "late connect must be torn down",
  );
  assert.match(
    socketSource,
    /if \(socket === attemptSocket\) socket = null/,
    "a stale attempt must not clear a newer attempt's slot",
  );
});

test("SOCK-11 source: no token is logged or echoed in errors", () => {
  assert.doesNotMatch(socketSource, /console\.(log|warn|error)\([^)]*token/i);
  assert.doesNotMatch(itemSource, /console\.(log|warn|error)\([^)]*token/i);
});

test("SOCK-12 source: bidding reconnects when the account identity changes", () => {
  assert.match(itemSource, /session\.phase, session\.identity\?\.id/, "effect must depend on identity");
  assert.match(itemSource, /presentBidOutcome/, "ack presentation must use the shared mapping");
});

test("SOCK-13 detail screen keeps bidding authority with the trade engine", () => {
  assert.match(itemSource, /placeBid/);
  assert.doesNotMatch(itemSource, /api\/records\/v1\/bids/);
});

test("SOCK-14 pre-emit disconnect sets rejected=true, parser uses no string heuristics, ItemScreen reconciles before display", () => {
  const ackSource = readFileSync("src/lib/bid-ack.ts", "utf8");
  const copySource = readFileSync("src/lib/bid-copy.ts", "utf8");
  assert.match(socketSource, /rejected:\s*true/);
  assert.match(itemSource, /reconcileBidOutcome/);
  assert.doesNotMatch(ackSource, /please retry|unexpected error|error\.includes/i);
  assert.doesNotMatch(copySource, /try again|please retry/i);
});
