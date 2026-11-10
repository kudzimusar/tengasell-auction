// RACE01-D1 regression — a stale login must not leave restorable credentials.
//
// Independent review of the RACE01 barrier found that `applyAuthenticated`
// wrote the credential pair and only then re-checked generation ownership. When
// ownership had moved, it threw — and the bytes stayed in the secure store.
// If the newer owner was a login that later failed, the next cold start
// restored the superseded account.
//
// These tests drive the production storage driver with an in-memory slot map,
// so the cleanup rule (delete only my own write) is asserted directly.

import assert from "node:assert/strict";
import test from "node:test";

import { createGuardedSessionStorage } from "../src/auth/session-storage-logic.ts";

function memoryDriver(initial = {}) {
  const slots = new Map(Object.entries(initial));
  return {
    slots,
    driver: {
      read: async (key) => (slots.has(key) ? slots.get(key) : null),
      write: async (key, value) => {
        slots.set(key, value);
      },
      remove: async (key) => {
        slots.delete(key);
      },
    },
  };
}

const AUTH_KEY = "tengasell.session.auth_token";
const REFRESH_KEY = "tengasell.session.refresh_token";

const STALE = { authToken: "stale-a", refreshToken: "stale-r" };
const FRESH = { authToken: "fresh-b", refreshToken: "fresh-r" };

test("RACE01-11 a stale write is removed, leaving no restorable session", async () => {
  const { slots, driver } = memoryDriver({
    [AUTH_KEY]: STALE.authToken,
    [REFRESH_KEY]: STALE.refreshToken,
  });
  const storage = createGuardedSessionStorage(driver);

  const removed = await storage.clearStaleCredentialWrite(STALE);

  assert.equal(removed, true);
  assert.equal(slots.has(AUTH_KEY), false);
  assert.equal(slots.has(REFRESH_KEY), false);
  assert.equal(await storage.readStoredSession(), null);
});

test("RACE01-12 a newer owner's credentials are never discarded by a stale task", async () => {
  const { slots, driver } = memoryDriver({
    [AUTH_KEY]: FRESH.authToken,
    [REFRESH_KEY]: FRESH.refreshToken,
  });
  const storage = createGuardedSessionStorage(driver);

  const removed = await storage.clearStaleCredentialWrite(STALE);

  assert.equal(removed, false);
  assert.equal(slots.get(AUTH_KEY), FRESH.authToken);
  assert.deepEqual(await storage.readStoredSession(), FRESH);
});

test("RACE01-13 cleanup of an already-cleared store is a no-op, not an error", async () => {
  const { driver } = memoryDriver();
  const storage = createGuardedSessionStorage(driver);

  assert.equal(await storage.clearStaleCredentialWrite(STALE), false);
  assert.equal(await storage.readStoredSession(), null);
});
