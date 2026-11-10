// RACE01 regression suite — pre-authentication generation barrier.
// Drives the production `runGuardedLogin` sequencing with controlled promises.

import assert from "node:assert/strict";
import test from "node:test";

import {
  runGuardedLogin,
  SupersededLoginError,
} from "../src/auth/login-barrier.ts";
import { SessionRestorationBlockedError } from "../src/auth/session-storage-logic.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Minimal generation owner mirroring SessionProvider's ref semantics. */
function makeGuard() {
  let generation = 0;
  return {
    begin: () => ++generation,
    current: () => generation,
    invalidate: () => {
      generation += 1;
    },
  };
}

const TOKENS = { authToken: "a", refreshToken: "r" };

test("RACE01-01 ownership is taken synchronously, before the intent read resolves", async () => {
  const guard = makeGuard();
  const intent = deferred();
  let observedGenerationAtCall = -1;

  const run = runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: () => {
      observedGenerationAtCall = guard.current();
      return intent.promise;
    },
    authenticate: async () => TOKENS,
    apply: async () => undefined,
  });

  // Ownership already advanced while the intent read is still pending.
  assert.equal(observedGenerationAtCall, 1);
  intent.resolve(false);
  await run;
});

test("RACE01-02 logout during the intent read supersedes the login (no auth, no publish)", async () => {
  const guard = makeGuard();
  const intent = deferred();
  let authenticated = 0;
  let applied = 0;

  const run = runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: () => intent.promise,
    authenticate: async () => {
      authenticated += 1;
      return TOKENS;
    },
    apply: async () => {
      applied += 1;
    },
  });

  guard.invalidate(); // logout begins while the marker read is pending
  intent.resolve(false); // stale "no intent" answer

  await assert.rejects(run, SupersededLoginError);
  assert.equal(authenticated, 0, "stale login must not call TrailBase authentication");
  assert.equal(applied, 0, "stale login must not publish a session");
});

test("RACE01-03 a persisted logout intent blocks login before authentication", async () => {
  const guard = makeGuard();
  let authenticated = 0;

  await assert.rejects(
    runGuardedLogin({
      begin: guard.begin,
      current: guard.current,
      hasLogoutIntent: async () => true,
      authenticate: async () => {
        authenticated += 1;
        return TOKENS;
      },
      apply: async () => undefined,
    }),
    SessionRestorationBlockedError,
  );
  assert.equal(authenticated, 0);
});

test("RACE01-04 logout during authentication rejects before persistence", async () => {
  const guard = makeGuard();
  const auth = deferred();
  let applied = 0;

  const run = runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: async () => false,
    authenticate: () => auth.promise,
    apply: async () => {
      applied += 1;
    },
  });

  await Promise.resolve();
  guard.invalidate(); // logout during the TrailBase call
  auth.resolve(TOKENS);

  await assert.rejects(run, SupersededLoginError);
  assert.equal(applied, 0, "credentials must not be persisted after logout began");
});

test("RACE01-05 logout during persistence propagates instead of publishing", async () => {
  const guard = makeGuard();
  const persist = deferred();

  const run = runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: async () => false,
    authenticate: async () => TOKENS,
    apply: async (_tokens, generation) => {
      await persist.promise;
      // Production applyAuthenticated re-checks after the write.
      if (guard.current() !== generation) throw new SupersededLoginError();
    },
  });

  await Promise.resolve();
  await Promise.resolve();
  guard.invalidate();
  persist.resolve();

  await assert.rejects(run, SupersededLoginError);
});

test("RACE01-06 legitimate login after a completed logout succeeds", async () => {
  const guard = makeGuard();
  guard.invalidate(); // a logout happened first
  let applied = 0;

  await runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: async () => false,
    authenticate: async () => TOKENS,
    apply: async (_tokens, generation) => {
      assert.equal(guard.current(), generation);
      applied += 1;
    },
  });
  assert.equal(applied, 1);
});

test("RACE01-07 sequential account changes: the later login wins, the earlier never publishes", async () => {
  const guard = makeGuard();
  const firstAuth = deferred();
  const published = [];

  const first = runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: async () => false,
    authenticate: () => firstAuth.promise,
    apply: async (_t, generation) => {
      published.push(`first:${generation}`);
    },
  });

  const second = runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: async () => false,
    authenticate: async () => ({ authToken: "a2", refreshToken: "r2" }),
    apply: async (_t, generation) => {
      published.push(`second:${generation}`);
    },
  });

  firstAuth.resolve(TOKENS);
  await assert.rejects(first, SupersededLoginError);
  await second;

  assert.deepEqual(published, ["second:2"], "only the newest owner may publish");
});

test("RACE01-08 stale publication is rejected by the apply contract", async () => {
  const guard = makeGuard();
  await assert.rejects(
    runGuardedLogin({
      begin: guard.begin,
      current: guard.current,
      hasLogoutIntent: async () => false,
      authenticate: async () => TOKENS,
      apply: async (_tokens, generation) => {
        guard.invalidate(); // logout lands between authenticate and apply
        if (guard.current() !== generation) throw new SupersededLoginError();
      },
    }),
    SupersededLoginError,
  );
});

test("RACE01-09 intent read failure does not publish a session", async () => {
  const guard = makeGuard();
  let applied = 0;
  await assert.rejects(
    runGuardedLogin({
      begin: guard.begin,
      current: guard.current,
      hasLogoutIntent: async () => {
        throw new Error("secure store unavailable");
      },
      authenticate: async () => TOKENS,
      apply: async () => {
        applied += 1;
      },
    }),
    /secure store unavailable/,
  );
  assert.equal(applied, 0);
});

test("RACE01-10 repeated logout invalidations keep rejecting the in-flight login", async () => {
  const guard = makeGuard();
  const auth = deferred();
  const run = runGuardedLogin({
    begin: guard.begin,
    current: guard.current,
    hasLogoutIntent: async () => false,
    authenticate: () => auth.promise,
    apply: async () => undefined,
  });

  await Promise.resolve();
  guard.invalidate();
  guard.invalidate();
  guard.invalidate();
  auth.resolve(TOKENS);

  await assert.rejects(run, SupersededLoginError);
});
