// ICR03-D1 regression — a stale operation must not destroy a newer session.
//
// The defect: when a refresh failed with a non-network error, SessionProvider
// cleared local credentials without checking session generation. If the user had
// logged out and signed in again while that refresh was in flight, the older
// operation wiped the new login's pair.
//
// These tests drive the production orchestrator the provider delegates to.

import assert from "node:assert/strict";
import test from "node:test";

import {
  decideRefreshFailure,
  runProtectedRequest,
} from "../src/auth/protected-request.ts";

const TOKENS = { authToken: "a", refreshToken: "r" };
const LATER = { authToken: "a2", refreshToken: "r2" };

function harness(overrides = {}) {
  const state = {
    generation: 1,
    cleared: 0,
    degraded: [],
    refreshed: [],
    calls: 0,
  };
  const deps = {
    currentGeneration: () => state.generation,
    tokens: TOKENS,
    authenticated: true,
    identityFromAuthToken: () => ({ expiresAt: Date.now() + 600_000 }),
    refresh: async () => TOKENS,
    isNetworkOrConfiguration: () => false,
    clearLocalSession: async () => {
      state.cleared += 1;
    },
    onDegraded: (message) => state.degraded.push(message),
    onRefreshed: (tokens) => state.refreshed.push(tokens.authToken),
    run: async () => {
      state.calls += 1;
      return "ok";
    },
    makeSessionInvalid: (message) => Object.assign(new Error(message), { kind: "session-invalid" }),
    ...overrides,
  };
  return { state, deps };
}

test("ICR03-01 a successful protected request is returned", async () => {
  const { state, deps } = harness();
  assert.equal(await runProtectedRequest(deps), "ok");
  assert.equal(state.calls, 1);
});

test("ICR03-02 a stale refresh failure neither clears nor degrades", async () => {
  const { state, deps } = harness();
  deps.identityFromAuthToken = () => ({ expiresAt: 0 });
  deps.refresh = async () => {
    state.generation += 1; // logout + new login happen during the refresh
    throw new Error("invalid_grant");
  };

  await assert.rejects(() => runProtectedRequest(deps), /invalid_grant/);
  assert.equal(state.cleared, 0, "a stale operation must not clear the newer login");
  assert.deepEqual(state.degraded, [], "nor publish degraded UI for it");
});

test("ICR03-03 a non-stale credential failure still invalidates the session", async () => {
  const { state, deps } = harness();
  deps.identityFromAuthToken = () => ({ expiresAt: 0 });
  deps.refresh = async () => {
    throw new Error("invalid_grant");
  };

  await assert.rejects(() => runProtectedRequest(deps));
  assert.equal(state.cleared, 1);
});

test("ICR03-04 a non-stale network failure degrades without clearing credentials", async () => {
  const { state, deps } = harness();
  deps.identityFromAuthToken = () => ({ expiresAt: 0 });
  deps.refresh = async () => {
    throw new Error("offline");
  };
  deps.isNetworkOrConfiguration = () => true;

  await assert.rejects(() => runProtectedRequest(deps));
  assert.equal(state.cleared, 0);
  assert.equal(state.degraded.length, 1);
});

test("ICR03-05 a response that arrives after the session changed is discarded", async () => {
  const { state, deps } = harness();
  deps.run = async () => {
    state.generation += 1;
    return "late";
  };

  await assert.rejects(() => runProtectedRequest(deps), /discarded/i);
});

test("ICR03-06 refresh-then-retry succeeds and publishes the refreshed token", async () => {
  const { state, deps } = harness();
  let first = true;
  deps.run = async () => {
    state.calls += 1;
    if (first) {
      first = false;
      throw Object.assign(new Error("expired"), { kind: "session-invalid" });
    }
    return "recovered";
  };
  deps.refresh = async () => LATER;

  assert.equal(await runProtectedRequest(deps), "recovered");
  assert.deepEqual(state.refreshed, ["a2"]);
  assert.equal(state.cleared, 0);
});

test("ICR03-07 a stale retry failure clears nothing", async () => {
  const { state, deps } = harness();
  deps.run = async () => {
    throw Object.assign(new Error("expired"), { kind: "session-invalid" });
  };
  deps.refresh = async () => {
    state.generation += 1;
    throw new Error("invalid_grant");
  };

  await assert.rejects(() => runProtectedRequest(deps));
  assert.equal(state.cleared, 0);
});

test("ICR03-08 failure classification is explicit, not incidental", () => {
  assert.equal(decideRefreshFailure({ stale: true, networkOrConfiguration: true }), "ignore");
  assert.equal(decideRefreshFailure({ stale: true, networkOrConfiguration: false }), "ignore");
  assert.equal(decideRefreshFailure({ stale: false, networkOrConfiguration: true }), "degrade");
  assert.equal(decideRefreshFailure({ stale: false, networkOrConfiguration: false }), "invalidate");
});

test("ICR03-09 an unauthenticated request never reaches the operation", async () => {
  const { state, deps } = harness({ authenticated: false });
  await assert.rejects(() => runProtectedRequest(deps), /without an authenticated session/i);
  assert.equal(state.calls, 0);
});
