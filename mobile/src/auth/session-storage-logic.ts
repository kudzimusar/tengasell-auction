/**
 * Testable SecureStore sign-out guard. All data and the non-secret marker remain
 * in the OS-backed secure store. The driver lets tests inject read/write/delete
 * faults without importing React Native native modules.
 *
 * ICR02 — atomic credential ownership.
 *
 * Every credential operation runs on one serialized queue. Without it, the stale
 * cleanup was a compare-and-delete split across awaits: it read the auth token,
 * then deleted both slots, and a newer login could persist a valid pair inside
 * that window and have it erased. Serialization makes each operation — read,
 * compare, mutate, verify — indivisible with respect to every other credential
 * operation on this store.
 *
 * Reads are serialized too, deliberately: an unserialized read could observe an
 * auth token whose refresh token is not yet written, treat the pair as
 * incomplete, and delete the write that is still in flight.
 *
 * The queue is internal to this module. Callers keep the same API, and the
 * generation authority remains SessionProvider's: this is storage coordination,
 * not a second session system.
 */
import type { TrailBaseTokens } from "../lib/trailbase";

const AUTH_TOKEN_KEY = "tengasell.session.auth_token";
const REFRESH_TOKEN_KEY = "tengasell.session.refresh_token";
const LOGOUT_INTENT_KEY = "tengasell.session.logout_intent.v1";
const LOGOUT_INTENT_VALUE = "pending-v1";

export class SessionRestorationBlockedError extends Error {
  constructor(
    message = "A previous sign-out needs to be completed before this device can sign in.",
  ) {
    super(message);
    this.name = "SessionRestorationBlockedError";
  }
}

export interface SecureSlotDriver {
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export function createGuardedSessionStorage(driver: SecureSlotDriver) {
  // ── serialization ────────────────────────────────────────────────────────
  // One operation at a time, in submission order. A failure releases the queue
  // for the next operation but is still reported to its own caller.
  let tail: Promise<unknown> = Promise.resolve();
  let inFlight = 0;
  let maxConcurrent = 0;

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      try {
        return await operation();
      } finally {
        inFlight -= 1;
      }
    };
    const result = tail.then(run, run);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Highest number of credential operations ever run at once (0 or 1). */
  function concurrencyHighWaterMark(): number {
    return maxConcurrent;
  }

  // ── raw operations (never queued recursively) ────────────────────────────
  async function hasLogoutIntent(): Promise<boolean> {
    const value = await driver.read(LOGOUT_INTENT_KEY);
    if (value === null) return false;
    if (value !== LOGOUT_INTENT_VALUE) throw new SessionRestorationBlockedError();
    return true;
  }

  async function markLogoutIntent(): Promise<void> {
    await driver.write(LOGOUT_INTENT_KEY, LOGOUT_INTENT_VALUE);
    if (!(await hasLogoutIntent())) throw new SessionRestorationBlockedError();
  }

  async function clearLogoutIntent(): Promise<void> {
    await driver.remove(LOGOUT_INTENT_KEY);
    if (await hasLogoutIntent()) throw new SessionRestorationBlockedError();
  }

  async function clearStoredSession(): Promise<void> {
    // Delete both independently. If one fails, still attempt the other.
    await Promise.allSettled([
      driver.remove(AUTH_TOKEN_KEY),
      driver.remove(REFRESH_TOKEN_KEY),
    ]);
    const [authToken, refreshToken] = await Promise.all([
      driver.read(AUTH_TOKEN_KEY),
      driver.read(REFRESH_TOKEN_KEY),
    ]);
    if (authToken !== null || refreshToken !== null) {
      throw new Error("Secure credential deletion could not be verified.");
    }
  }

  async function readCredentials(): Promise<TrailBaseTokens | null> {
    const [authToken, refreshToken] = await Promise.all([
      driver.read(AUTH_TOKEN_KEY),
      driver.read(REFRESH_TOKEN_KEY),
    ]);
    if (!authToken && !refreshToken) return null;
    if (!authToken || !refreshToken) {
      // An incomplete pair is never admissible as an authenticated session.
      await clearStoredSession();
      return null;
    }
    return { authToken, refreshToken };
  }

  async function writeStoredSession(tokens: TrailBaseTokens): Promise<void> {
    if (await hasLogoutIntent()) throw new SessionRestorationBlockedError();
    try {
      // Both writes must settle inside this operation. Promise.all rejects on
      // the first failure and lets the sibling write run on after the queued
      // operation has ended — that write then lands under a later login's
      // operation and can pair one account's auth token with another's refresh
      // token. Awaiting allSettled keeps every write inside the queue.
      const writes = await Promise.allSettled([
        driver.write(AUTH_TOKEN_KEY, tokens.authToken),
        driver.write(REFRESH_TOKEN_KEY, tokens.refreshToken),
      ]);
      const failed = writes.find((result) => result.status === "rejected");
      if (failed && failed.status === "rejected") throw failed.reason;
      // A concurrent sign-out can have set its marker during persistence.
      if (await hasLogoutIntent()) throw new SessionRestorationBlockedError();
    } catch (error) {
      try {
        await clearStoredSession();
      } catch {
        // Fail the login; caller must not publish authenticated state.
        // Native crash durability with simultaneous storage faults is not provable.
      }
      throw error;
    }
  }

  /**
   * Remove credentials written by a login that lost session ownership before it
   * could publish.
   *
   * Runs as one queued operation, so the token comparison and the deletion
   * cannot be separated by another login's write: either the newer pair is
   * already stored (token mismatch, nothing deleted) or it is written after
   * this operation completes (and therefore survives).
   */
  async function clearStaleCredentialWrite(tokens: TrailBaseTokens): Promise<boolean> {
    const current = await driver.read(AUTH_TOKEN_KEY);
    if (current !== tokens.authToken) return false;
    try {
      await clearStoredSession();
      return true;
    } catch (error) {
      // The stale pair may still be restorable and deletion could not be
      // verified. Set the durable sign-out marker so restoration fails closed
      // instead of trusting a store we just failed to clean, and report the
      // failure rather than claiming the credentials were removed.
      try {
        await markLogoutIntent();
      } catch {
        // The marker is best effort here; the original failure is what matters.
      }
      throw error;
    }
  }

  // ── public, serialized API ───────────────────────────────────────────────
  return {
    // The sign-out marker is deliberately NOT queued. R3 requires the intent to
    // be writable and observable while a credential write is still in flight —
    // that is how "intent wins over late persistence" works. Serializing it
    // would make the marker wait behind the very write it must interrupt.
    // It is a single idempotent key with its own read-back verification.
    hasLogoutIntent,
    markLogoutIntent,
    clearLogoutIntent,
    // Credential slots ARE queued: read, compare, mutate and verify cannot be
    // separated by another login's write.
    clearStoredSession: () => serialized(clearStoredSession),
    readStoredSession: () =>
      serialized(async () => {
        if (await hasLogoutIntent()) throw new SessionRestorationBlockedError();
        return readCredentials();
      }),
    readCredentialsForLogout: () => serialized(readCredentials),
    writeStoredSession: (tokens: TrailBaseTokens) => serialized(() => writeStoredSession(tokens)),
    clearStaleCredentialWrite: (tokens: TrailBaseTokens) =>
      serialized(() => clearStaleCredentialWrite(tokens)),
    concurrencyHighWaterMark,
  };
}
