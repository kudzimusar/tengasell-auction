/**
 * Testable SecureStore sign-out guard. All data and the non-secret marker remain
 * in the OS-backed secure store. The driver lets tests inject read/write/delete
 * faults without importing React Native native modules.
 */
import type { TrailBaseTokens } from "../lib/trailbase";

const AUTH_TOKEN_KEY = "tengasell.session.auth_token";
const REFRESH_TOKEN_KEY = "tengasell.session.refresh_token";
const LOGOUT_INTENT_KEY = "tengasell.session.logout_intent.v1";
const LOGOUT_INTENT_VALUE = "pending-v1";

export class SessionRestorationBlockedError extends Error {
  constructor() {
    super("A previous sign-out needs to be completed before this device can sign in.");
    this.name = "SessionRestorationBlockedError";
  }
}

export interface SecureSlotDriver {
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export function createGuardedSessionStorage(driver: SecureSlotDriver) {
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

  async function readStoredSession(): Promise<TrailBaseTokens | null> {
    // Guard read failure throws: it is never interpreted as no logout intent.
    if (await hasLogoutIntent()) throw new SessionRestorationBlockedError();
    return readCredentials();
  }

  async function writeStoredSession(tokens: TrailBaseTokens): Promise<void> {
    if (await hasLogoutIntent()) throw new SessionRestorationBlockedError();
    try {
      await Promise.all([
        driver.write(AUTH_TOKEN_KEY, tokens.authToken),
        driver.write(REFRESH_TOKEN_KEY, tokens.refreshToken),
      ]);
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

  return {
    hasLogoutIntent,
    markLogoutIntent,
    clearLogoutIntent,
    clearStoredSession,
    readStoredSession,
    readCredentialsForLogout: readCredentials,
    writeStoredSession,
  };
}
