// CLOSE-02 regression suite — session-safe bid completion.
//
// Drives the production `runGuardedBid` boundary with controlled promises, so
// the completion ordering (not a test double) is what is asserted.

import assert from "node:assert/strict";
import test from "node:test";

import { runGuardedBid, settleBidAttempt } from "../src/bids/bid-completion.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Mirrors SessionProvider's generation ref + the transport epoch. */
function arena({ identityId = "nyasha", generation = 1, epoch = 1 } = {}) {
  const state = { identityId, generation, epoch, mounted: true };
  return {
    state,
    guard: {
      sessionGeneration: () => state.generation,
      identityId: () => state.identityId,
      isConnectionCurrent: (token) => token === state.epoch,
      isMounted: () => state.mounted,
    },
    takeOwnership: () => ({
      sessionGeneration: state.generation,
      identityId: state.identityId,
      connectionEpoch: state.epoch,
    }),
    logout() {
      state.generation += 1;
      state.identityId = null;
      state.epoch += 1;
    },
    switchAccount(nextIdentity) {
      state.generation += 1;
      state.identityId = nextIdentity;
      state.epoch += 1;
    },
    invalidateConnection() {
      state.epoch += 1;
    },
    unmount() {
      state.mounted = false;
    },
  };
}

const OK = { ok: true, winning: true, amount: 700 };

test("BID-01 logout while the bid is pending discards the completion", async () => {
  const a = arena();
  const pending = deferred();
  const published = [];

  const task = runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: () => pending.promise,
    publish: (outcome) => published.push(outcome),
  });

  a.logout();
  pending.resolve(OK);

  const verdict = await task;
  assert.deepEqual(verdict, { state: "discarded", reason: "session-changed" });
  assert.equal(published.length, 0);
});

test("BID-02 account switch while pending discards the completion", async () => {
  const a = arena();
  const pending = deferred();
  const published = [];

  const task = runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: () => pending.promise,
    publish: (outcome) => published.push(outcome),
  });

  a.switchAccount("tendai");
  pending.resolve(OK);

  const verdict = await task;
  assert.equal(verdict.state, "discarded");
  assert.ok(["session-changed", "account-changed"].includes(verdict.reason));
  assert.equal(published.length, 0);
});

test("BID-03 unmount while pending discards and publishes nothing", async () => {
  const a = arena();
  const pending = deferred();
  let published = 0;

  const task = runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: () => pending.promise,
    publish: () => {
      published += 1;
    },
  });

  a.unmount();
  pending.resolve(OK);

  assert.deepEqual(await task, { state: "discarded", reason: "unmounted" });
  assert.equal(published, 0);
});

test("BID-04 disconnect before acknowledgement is uncertain, never applied as success", async () => {
  const a = arena();
  const pending = deferred();
  const published = [];

  const task = runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: () => pending.promise,
    publish: (outcome) => published.push(outcome),
  });

  a.invalidateConnection();
  pending.resolve({ ok: false, uncertain: true, reason: "disconnected" });

  const verdict = await task;
  assert.deepEqual(verdict, { state: "discarded", reason: "connection-superseded" });
  assert.equal(published.length, 0);
});

test("BID-05 a stale acknowledgement arriving after reconnect is discarded", async () => {
  const a = arena();
  const pending = deferred();
  const published = [];

  const task = runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: () => pending.promise,
    publish: (outcome) => published.push(outcome),
  });

  a.invalidateConnection(); // logged out / socket replaced
  a.state.epoch += 1; // a fresh connection now owns bidding
  pending.resolve(OK);

  assert.equal((await task).state, "discarded");
  assert.equal(published.length, 0);
});

test("BID-06 the original account cannot publish into the new account's state", async () => {
  const a = arena({ identityId: "nyasha" });
  const pending = deferred();
  const seenByNewAccount = [];

  const task = runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: () => pending.promise,
    publish: (outcome) => seenByNewAccount.push(outcome),
  });

  // Identity changes without touching the generation counter: the identity
  // guard alone must catch this.
  a.state.identityId = "tendai";
  pending.resolve(OK);

  assert.deepEqual(await task, { state: "discarded", reason: "account-changed" });
  assert.equal(seenByNewAccount.length, 0);
});

test("BID-07 the valid new account can complete its own bid", async () => {
  const a = arena({ identityId: "nyasha" });
  const first = deferred();
  const published = [];

  const stale = runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: () => first.promise,
    publish: (outcome) => published.push(outcome),
  });

  a.switchAccount("tendai");
  first.resolve(OK);
  assert.equal((await stale).state, "discarded");

  const fresh = await runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: async () => ({ ok: true, winning: true, amount: 710 }),
    publish: (outcome) => published.push(outcome),
  });

  assert.equal(fresh.state, "applied");
  assert.equal(published.length, 1);
  assert.equal(published[0].amount, 710);
});

test("BID-08 expired token publishes the rejection, never a winning state", async () => {
  const a = arena();
  const published = [];

  const verdict = await runGuardedBid({
    guard: a.guard,
    takeOwnership: a.takeOwnership,
    place: async () => ({ ok: false, error: "Session expired. Sign in again." }),
    publish: (outcome) => published.push(outcome),
  });

  assert.equal(verdict.state, "applied");
  assert.equal(published.length, 1);
  assert.equal(published[0].ok, false);
  assert.equal(published[0].winning, undefined);
});

test("BID-09 settlement is pure: no state change is applied by the decision", () => {
  const a = arena();
  const ownership = a.takeOwnership();

  assert.deepEqual(settleBidAttempt(ownership, a.guard), { state: "applied" });

  a.state.mounted = false;
  assert.deepEqual(settleBidAttempt(ownership, a.guard), {
    state: "discarded",
    reason: "unmounted",
  });
});
