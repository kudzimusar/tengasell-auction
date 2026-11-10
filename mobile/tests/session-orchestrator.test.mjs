// STORE-08 — provider-owned session orchestration.
//
// SessionProvider cannot be rendered under the node test runner (React Native
// modules), so the production ordering it uses was extracted into
// `applyAuthenticatedSession` and the provider now delegates to it. These tests
// drive that same function, not a re-implementation: the assertion is about the
// code path the app actually runs.

import assert from "node:assert/strict";
import test from "node:test";

import { applyAuthenticatedSession } from "../src/auth/session-orchestrator.ts";

const TOKENS = { authToken: "token-a", refreshToken: "refresh-a" };

function harness({ generation = 1, identity = { id: "user-a" } } = {}) {
  const state = { generation, published: [], cleared: 0, written: [], staleCleanups: [] };
  const deps = {
    tokens: TOKENS,
    expectedGeneration: generation,
    currentGeneration: () => state.generation,
    writeStoredSession: async (tokens) => {
      state.written.push(tokens.authToken);
    },
    clearStaleCredentialWrite: async (tokens) => {
      state.staleCleanups.push(tokens.authToken);
      return true;
    },
    clearLocalSession: async () => {
      state.cleared += 1;
    },
    identityFromAuthToken: () => identity,
    publish: (published) => {
      state.published.push(published.id);
    },
  };
  return { state, deps };
}

test("STORE-08 publishes only while the login still owns the generation", async () => {
  const { state, deps } = harness();
  const outcome = await applyAuthenticatedSession(deps);

  assert.equal(outcome, "published");
  assert.deepEqual(state.published, ["user-a"]);
  assert.deepEqual(state.written, ["token-a"]);
  assert.equal(state.staleCleanups.length, 0);
});

test("STORE-08 a logout during persistence supersedes publication and cleans up", async () => {
  const { state, deps } = harness();
  deps.writeStoredSession = async () => {
    state.written.push("token-a");
    state.generation += 1; // logout lands while credentials are being written
  };

  const outcome = await applyAuthenticatedSession(deps);

  assert.equal(outcome, "superseded");
  assert.deepEqual(state.published, [], "a superseded login must not publish");
  assert.deepEqual(state.staleCleanups, ["token-a"], "its own write must be cleaned up");
});

test("STORE-08 ownership already lost before the task runs does no work at all", async () => {
  const { state, deps } = harness();
  state.generation = 2;

  const outcome = await applyAuthenticatedSession(deps);

  assert.equal(outcome, "superseded");
  assert.deepEqual(state.written, []);
  assert.deepEqual(state.published, []);
  assert.equal(state.cleared, 0);
});

test("STORE-08 a token without a subject claim clears storage and never publishes", async () => {
  const { state, deps } = harness({ identity: null });

  const outcome = await applyAuthenticatedSession(deps);

  assert.equal(outcome, "malformed");
  assert.equal(state.cleared, 1);
  assert.deepEqual(state.published, []);
  assert.deepEqual(state.written, []);
});

test("STORE-08 a failed stale cleanup cannot resurrect a published session", async () => {
  const { state, deps } = harness();
  deps.writeStoredSession = async () => {
    state.generation += 1;
  };
  deps.clearStaleCredentialWrite = async () => {
    throw new Error("Secure credential deletion could not be verified.");
  };

  const outcome = await applyAuthenticatedSession(deps);

  assert.equal(outcome, "superseded");
  assert.deepEqual(state.published, []);
});
