import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settleLogout } from "../src/auth/logout-transaction.ts";
import {
  createGuardedSessionStorage,
  SessionRestorationBlockedError,
} from "../src/auth/session-storage-logic.ts";
import { translateNxs } from "../src/nxs/localization/catalog.ts";

const AUTH = "tengasell.session.auth_token";
const REFRESH = "tengasell.session.refresh_token";
const INTENT = "tengasell.session.logout_intent.v1";
const TOKENS = { authToken: "test-only-auth", refreshToken: "test-only-refresh" };

function makeStore(initial = TOKENS) {
  const values = new Map();
  if (initial) {
    values.set(AUTH, initial.authToken);
    values.set(REFRESH, initial.refreshToken);
  }
  const faults = { read: new Set(), write: new Set(), remove: new Set() };
  const events = [];
  const driver = {
    read: async (key) => {
      events.push("read:" + key);
      if (faults.read.has(key)) throw new Error("Injected read failure");
      return values.get(key) ?? null;
    },
    write: async (key, value) => {
      events.push("write:" + key);
      if (faults.write.has(key)) throw new Error("Injected write failure");
      values.set(key, value);
    },
    remove: async (key) => {
      events.push("remove:" + key);
      if (faults.remove.has(key)) throw new Error("Injected remove failure");
      values.delete(key);
    },
  };
  return { values, faults, events, driver, store: createGuardedSessionStorage(driver) };
}

async function execute(f, remote = async () => true, extras = {}) {
  const { store } = f;
  return settleLogout({
    markIntent: store.markLogoutIntent,
    awaitPendingWrite: extras.awaitPendingWrite ?? (async () => {}),
    captureAuthToken: extras.captureAuthToken ??
      (async () => (await store.readCredentialsForLogout())?.authToken ?? null),
    clearCredentials: store.clearStoredSession,
    revokeSession: remote,
    clearIntent: store.clearLogoutIntent,
  });
}

test("R3-01 local deletion succeeds + canonical revocation succeeds", async () => {
  const f = makeStore();
  const r = await execute(f);
  assert.deepEqual([r.status,r.localDeletionVerified,r.remoteRevocationConfirmed,r.markerClearedVerified],
    ["complete",true,true,true]);
  assert.equal(f.values.has(AUTH), false);
  assert.equal(f.values.has(REFRESH), false);
  assert.equal(await f.store.readStoredSession(), null);
});

test("R3-02 verified local deletion survives failed remote logout", async () => {
  const f = makeStore();
  const r = await execute(f, async () => { throw new Error("offline"); });
  assert.equal(r.status, "local-only");
  assert.equal(r.remoteRevocationConfirmed, false);
  assert.equal(await f.store.readStoredSession(), null);
});

test("R3-03 remote revocation confirmed but local deletion fails", async () => {
  const f = makeStore();
  f.faults.remove.add(REFRESH);
  const r = await execute(f, async () => true);
  assert.equal(r.status, "incomplete");
  assert.equal(r.remoteRevocationConfirmed, true);
  assert.equal(r.localDeletionVerified, false);
  assert.equal(f.values.get(INTENT), "pending-v1");
  await assert.rejects(f.store.readStoredSession(), SessionRestorationBlockedError);
});

test("R3-04 both local deletion and canonical revocation fail explicitly", async () => {
  const f = makeStore();
  f.faults.remove.add(REFRESH);
  const r = await execute(f, async () => { throw new Error("offline"); });
  assert.equal(r.status, "incomplete");
  assert.equal(r.intentVerified, true);
  assert.equal(r.remoteRevocationConfirmed, false);
  await assert.rejects(f.store.readStoredSession(), SessionRestorationBlockedError);
});

test("R3-05 restart after incomplete logout honors persisted marker", async () => {
  const f = makeStore();
  f.faults.remove.add(AUTH);
  await execute(f, async () => false);
  const restarted = createGuardedSessionStorage(f.driver);
  assert.equal(await restarted.hasLogoutIntent(), true);
  await assert.rejects(restarted.readStoredSession(), SessionRestorationBlockedError);
  f.faults.remove.clear();
  const retry = await execute(f, async () => false);
  assert.equal(retry.status, "local-only");
  assert.equal(await restarted.readStoredSession(), null);
});

test("R3-06 partial token deletion never produces an accepted session", async () => {
  const f = makeStore();
  f.values.delete(AUTH);
  assert.equal(await f.store.readStoredSession(), null);
  assert.equal(f.values.has(REFRESH), false);
  const other = makeStore();
  other.values.delete(REFRESH);
  other.faults.remove.add(AUTH);
  await assert.rejects(other.store.readStoredSession());
});

test("R3-07 sign-out intent wins over late in-flight credential persistence", async () => {
  const f = makeStore();
  let allowWrite;
  let writing = false;
  let writingStarted;
  const started = new Promise((resolve) => { writingStarted = resolve; });
  const baseWrite = f.driver.write;
  f.driver.write = async (key, value) => {
    if ((key === AUTH || key === REFRESH) && !writing) {
      writing = true;
      writingStarted();
      await new Promise((resolve) => { allowWrite = resolve; });
    }
    return baseWrite(key, value);
  };
  const pending = f.store.writeStoredSession({authToken:"new-auth",refreshToken:"new-refresh"});
  await started;
  const ending = execute(f, async () => false, {
    awaitPendingWrite: async () => { await pending.catch(() => {}); },
  });
  // The barrier may have been written while the credential writes were paused.
  await f.store.hasLogoutIntent();
  allowWrite();
  await assert.rejects(pending);
  const r = await ending;
  assert.equal(r.status, "local-only");
  assert.equal(await f.store.readStoredSession(), null);
});

test("R3-08 stale protected profile results are rejected by generation checks", async () => {
  const source = readFileSync("src/auth/session-context.tsx", "utf8");
  assert.match(source, /const operationGeneration = generationRef.current/);
  assert.match(source, /if \(generationRef.current !== operationGeneration\)/);
  assert.match(source, /Protected response was discarded because the session changed/);
  // Deterministic generation-race model, not a native UI integration test.
  let generation = 3;
  const operationGeneration = generation;
  let resolveProfile;
  const profile = new Promise((resolve) => { resolveProfile = resolve; });
  const guarded = profile.then(value => {
    if (generation !== operationGeneration) throw new Error("stale protected response");
    return value;
  });
  generation += 1;
  resolveProfile({ privateValue:"discarded" });
  await assert.rejects(guarded, /stale protected response/);
});

test("R3-09 sequential login/logout/login never restores old credentials", async () => {
  const f = makeStore();
  const r = await execute(f);
  assert.equal(r.status, "complete");
  await f.store.writeStoredSession({authToken:"new-auth",refreshToken:"new-refresh"});
  assert.deepEqual(await f.store.readStoredSession(),
    {authToken:"new-auth",refreshToken:"new-refresh"});
  assert.notEqual((await f.store.readStoredSession()).refreshToken, TOKENS.refreshToken);
});

test("R3-10 offline logout remains anonymous after network recovery", async () => {
  const f = makeStore();
  const r = await execute(f, async () => { throw new Error("network unavailable"); });
  assert.equal(r.status, "local-only");
  const restarted = createGuardedSessionStorage(f.driver);
  assert.equal(await restarted.readStoredSession(), null);
  await restarted.writeStoredSession({authToken:"fresh-auth",refreshToken:"fresh-refresh"});
  assert.equal((await restarted.readStoredSession()).authToken, "fresh-auth");
});

test("R3-11 SecureStore marker read/write and credential delete faults fail visibly", async () => {
  const unreadable = makeStore();
  unreadable.faults.read.add(INTENT);
  await assert.rejects(unreadable.store.readStoredSession(), /Injected read failure/);
  const unwritable = makeStore();
  unwritable.faults.write.add(INTENT);
  unwritable.faults.remove.add(REFRESH);
  const r = await execute(unwritable, async () => { throw new Error("offline"); });
  assert.equal(r.status, "incomplete");
  assert.equal(r.intentVerified, false);
  const partialWrite = makeStore(null);
  partialWrite.faults.write.add(REFRESH);
  await assert.rejects(partialWrite.store.writeStoredSession(TOKENS));
  assert.equal(await partialWrite.store.readStoredSession(), null);
});

test("R3-12 crash checkpoints: persisted marker blocks restoration until cleanup", async () => {
  const f = makeStore();
  await f.store.markLogoutIntent();
  // Simulated process termination before credential deletion / remote revocation.
  const restarted = createGuardedSessionStorage(f.driver);
  await assert.rejects(restarted.readStoredSession(), SessionRestorationBlockedError);
  await restarted.clearStoredSession();
  // Crash after deletion but before removing the marker remains safely blocked.
  await assert.rejects(restarted.readStoredSession(), SessionRestorationBlockedError);
  await restarted.clearLogoutIntent();
  assert.equal(await restarted.readStoredSession(), null);
  // If marker persistence AND deletion AND remote revocation all fail,
  // no process-restart durability is provable; the test cannot assert otherwise.
});

test("R3-13 English and both pseudolocales preserve dynamic domain values", () => {
  const values = {
    title:"Toyota Corolla 2022",
    price:"USD 12,500",
    bidCount:17,
    remaining:"3h",
    seller:"buyer_01",
    brand:"TengaSell",
  };
  for (const locale of ["en","en-XA","ar-XB"]) {
    const result = translateNxs("home.auctionA11y", locale, values);
    assert.ok(result.includes(values.title), locale + " title");
    assert.ok(result.includes(values.price), locale + " price");
    assert.ok(result.includes(String(values.bidCount)), locale + " bids");
    assert.ok(result.includes(values.remaining), locale + " remaining");
    const signout = translateNxs("session.signoutIncomplete", locale);
    assert.ok(signout.length > 35, locale + " full failure description");
    const cta = translateNxs("session.retrySignout", locale);
    assert.ok(cta.length > 2, locale + " actionable retry label");
  }
  assert.match(translateNxs("session.signoutIncomplete","ar-XB"), /\u2067/);
});
