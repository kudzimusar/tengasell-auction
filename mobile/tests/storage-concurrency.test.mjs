// ICR02 — credential ownership and atomicity.
//
// These tests drive the production storage authority with an injected
// asynchronous SecureStore driver, so the interleavings are deterministic and
// the assertion is about ordering, not timing.
//
// STORE-01 is the reproduction: against the pre-ICR02 implementation it fails
// because the stale cleanup read the auth token, then deleted both slots, and a
// newer login's pair written in that window was erased.

import assert from "node:assert/strict";
import test from "node:test";

import { createGuardedSessionStorage } from "../src/auth/session-storage-logic.ts";

const AUTH_KEY = "tengasell.session.auth_token";
const REFRESH_KEY = "tengasell.session.refresh_token";
const INTENT_KEY = "tengasell.session.logout_intent.v1";

const A = { authToken: "login-a", refreshToken: "refresh-a" };
const B = { authToken: "login-b", refreshToken: "refresh-b" };
const C = { authToken: "login-c", refreshToken: "refresh-c" };

function tick(times = 4) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i += 1) p = p.then(() => new Promise((r) => setTimeout(r, 0)));
  return p;
}

/**
 * In-memory driver with optional gates and faults.
 * `gateRemovals()` parks every removal until `open()`; `failWrites`/`failRemoves`
 * list the keys that throw.
 */
function makeDriver(initial = {}, { failWrites = [], failRemoves = [] } = {}) {
  const slots = new Map(Object.entries(initial));
  let open = null;
  let gate = Promise.resolve();

  return {
    slots,
    gateRemovals() {
      gate = new Promise((resolve) => {
        open = resolve;
      });
    },
    open() {
      open?.();
    },
    driver: {
      read: async (key) => (slots.has(key) ? slots.get(key) : null),
      write: async (key, value) => {
        if (failWrites.includes(key)) throw new Error(`write fault: ${key}`);
        slots.set(key, value);
      },
      remove: async (key) => {
        await gate;
        if (failRemoves.includes(key)) throw new Error(`remove fault: ${key}`);
        slots.delete(key);
      },
    },
  };
}

test("STORE-01 a stale cleanup cannot delete a newer login's credential pair", async () => {
  const h = makeDriver({
    [AUTH_KEY]: A.authToken,
    [REFRESH_KEY]: A.refreshToken,
  });
  const storage = createGuardedSessionStorage(h.driver);
  h.gateRemovals();

  const cleanup = storage.clearStaleCredentialWrite(A);
  await tick();

  const write = storage.writeStoredSession(B);
  await tick();

  h.open();
  await cleanup;
  await write;

  assert.equal(h.slots.get(AUTH_KEY), B.authToken);
  assert.equal(h.slots.get(REFRESH_KEY), B.refreshToken);
  assert.deepEqual(await storage.readStoredSession(), B);
  assert.equal(storage.concurrencyHighWaterMark(), 1);
});

test("STORE-02 overlapping credential writes never produce a mixed token pair", async () => {
  const h = makeDriver();
  const storage = createGuardedSessionStorage(h.driver);

  const writes = [storage.writeStoredSession(A), storage.writeStoredSession(B)];
  const seen = [];
  for (let i = 0; i < 6; i += 1) {
    seen.push(await storage.readStoredSession().catch(() => "blocked"));
    await tick(1);
  }
  await Promise.all(writes);

  const pairs = new Set(
    seen
      .filter((value) => value !== null && value !== "blocked")
      .map((value) => `${value.authToken}:${value.refreshToken}`),
  );
  for (const pair of pairs) {
    assert.ok(
      pair === `${A.authToken}:${A.refreshToken}` || pair === `${B.authToken}:${B.refreshToken}`,
      `observed a mixed credential pair: ${pair}`,
    );
  }
  assert.deepEqual(await storage.readStoredSession(), B);
  assert.equal(storage.concurrencyHighWaterMark(), 1);
});

test("STORE-03 a failed newer login cannot expose the older user's session", async () => {
  const h = makeDriver(
    { [AUTH_KEY]: A.authToken, [REFRESH_KEY]: A.refreshToken },
    { failWrites: [REFRESH_KEY] },
  );
  const storage = createGuardedSessionStorage(h.driver);

  await assert.rejects(() => storage.writeStoredSession(B));

  // The half-written pair is cleared by the failed write itself.
  assert.equal(h.slots.has(AUTH_KEY), false);
  assert.equal(h.slots.has(REFRESH_KEY), false);

  // And the superseded login's cleanup finds nothing to restore.
  assert.equal(await storage.clearStaleCredentialWrite(A), false);
  assert.equal(await storage.readStoredSession(), null);
});

test("STORE-04 a durable logout intent still blocks credential persistence", async () => {
  const h = makeDriver();
  const storage = createGuardedSessionStorage(h.driver);

  await storage.markLogoutIntent();
  await assert.rejects(() => storage.writeStoredSession(A), /sign-out needs to be completed/i);

  assert.equal(h.slots.has(AUTH_KEY), false);
  assert.equal(h.slots.has(REFRESH_KEY), false);
  await assert.rejects(() => storage.readStoredSession(), /sign-out needs to be completed/i);
});

test("STORE-05 a failed cleanup fails closed and claims nothing", async () => {
  const h = makeDriver(
    { [AUTH_KEY]: A.authToken, [REFRESH_KEY]: A.refreshToken },
    { failRemoves: [AUTH_KEY] },
  );
  const storage = createGuardedSessionStorage(h.driver);

  await assert.rejects(() => storage.clearStaleCredentialWrite(A), /could not be verified/i);

  // Deletion was not verified, so the store must not be trusted: the durable
  // marker is set and restoration refuses until a sign-out completes.
  assert.equal(h.slots.get(INTENT_KEY), "pending-v1");
  await assert.rejects(() => storage.readStoredSession(), /sign-out needs to be completed/i);
});

test("STORE-06 concurrent login, logout and login settle on one coherent pair", async () => {
  const h = makeDriver({ [AUTH_KEY]: A.authToken, [REFRESH_KEY]: A.refreshToken });
  const storage = createGuardedSessionStorage(h.driver);

  const write = storage.writeStoredSession(B);
  const cleanup = storage.clearStaleCredentialWrite(A);
  await Promise.all([write, cleanup]);

  await storage.markLogoutIntent();
  await storage.clearStoredSession();
  await storage.clearLogoutIntent();

  await storage.writeStoredSession(C);

  assert.deepEqual(await storage.readStoredSession(), C);
  assert.equal(storage.concurrencyHighWaterMark(), 1);
});

test("STORE-07 a legitimate fresh login works after a completed logout", async () => {
  const h = makeDriver({ [AUTH_KEY]: A.authToken, [REFRESH_KEY]: A.refreshToken });
  const storage = createGuardedSessionStorage(h.driver);

  assert.deepEqual(await storage.readStoredSession(), A);

  await storage.markLogoutIntent();
  await storage.clearStoredSession();
  await storage.clearLogoutIntent();
  assert.equal(await storage.readStoredSession(), null);

  await storage.writeStoredSession(B);
  assert.deepEqual(await storage.readStoredSession(), B);
});

test("STORE-09 a write that fails cannot outlive its operation and mix pairs", async () => {
  // Login A's auth write is slow; its refresh write fails immediately. If the
  // operation ends on the first rejection, A's auth write lands after login B's
  // pair and the store holds {A-auth, B-refresh} — restorable as a valid session.
  const slots = new Map();
  let releaseSlowWrite;
  const slow = new Promise((resolve) => {
    releaseSlowWrite = resolve;
  });

  const storage = createGuardedSessionStorage({
    read: async (key) => (slots.has(key) ? slots.get(key) : null),
    write: async (key, value) => {
      if (value === A.authToken) {
        await slow;
        slots.set(key, value);
        return;
      }
      if (key === REFRESH_KEY && value === A.refreshToken) {
        throw new Error("refresh write fault");
      }
      slots.set(key, value);
    },
    remove: async (key) => {
      slots.delete(key);
    },
  });

  const failing = storage.writeStoredSession(A).catch((error) => error);
  await tick(2);

  const newer = storage.writeStoredSession(B);
  await tick(3);

  assert.equal(
    slots.has(AUTH_KEY),
    false,
    "login B must not start while login A's write is still in flight",
  );

  releaseSlowWrite();
  const failure = await failing;
  assert.ok(failure instanceof Error, "the failed login must reject");

  await newer;

  const stored = await storage.readStoredSession();
  assert.deepEqual(stored, B);
  assert.equal(storage.concurrencyHighWaterMark(), 1);
});
