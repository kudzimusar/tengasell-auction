import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  TrailBaseError,
  identityFromAuthToken,
  loginTrailBase,
  logoutTrailBase,
  refreshTrailBase,
  type TrailBaseIdentity,
  type TrailBaseTokens,
} from "../lib/trailbase";
import {
  clearLogoutIntent,
  clearStoredSession,
  hasLogoutIntent,
  markLogoutIntent,
  readCredentialsForLogout,
  readStoredSession,
  secureSessionStorageAvailable,
  SessionRestorationBlockedError,
  writeStoredSession,
} from "./session-storage";
import {
  settleLogout,
  type LogoutEvidence,
} from "./logout-transaction";

export type SessionPhase =
  | "booting"
  | "anonymous"
  | "authenticated"
  | "session-invalid"
  | "network-degraded"
  | "signout-pending"
  | "signout-incomplete"
  | "signed-out-locally";

export interface SessionSnapshot {
  phase: SessionPhase;
  identity: TrailBaseIdentity | null;
  message: string | null;
}

interface SessionContextValue extends SessionSnapshot {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<LogoutEvidence>;
  retryLogout: () => Promise<LogoutEvidence>;
  retrySessionRecovery: () => Promise<void>;
  withAuthenticatedToken: <T>(operation: (authToken: string) => Promise<T>) => Promise<T>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function isNetworkOrConfiguration(error: unknown): boolean {
  return (
    error instanceof TrailBaseError &&
    (error.kind === "network" || error.kind === "configuration")
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>({
    phase: "booting",
    identity: null,
    message: null,
  });
  const tokensRef = useRef<TrailBaseTokens | null>(null);
  const generationRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<TrailBaseTokens> | null>(null);
  const credentialWriteRef = useRef<Promise<void> | null>(null);
  const logoutPromiseRef = useRef<Promise<LogoutEvidence> | null>(null);

  const clearLocalSession = useCallback(
    async (phase: SessionPhase, message: string | null) => {
      generationRef.current += 1;
      tokensRef.current = null;
      refreshPromiseRef.current = null;
      try {
        await clearStoredSession();
      } finally {
        setSnapshot({ phase, identity: null, message });
      }
    },
    [],
  );

  const applyAuthenticated = useCallback(
    async (tokens: TrailBaseTokens, expectedGeneration: number) => {
      if (generationRef.current !== expectedGeneration) {
        throw new TrailBaseError(
          "session-invalid",
          "Session changed while authentication was completing.",
        );
      }

      const identity = identityFromAuthToken(tokens.authToken);
      if (!identity) {
        await clearLocalSession(
          "session-invalid",
          "TrailBase returned an auth token without a usable subject claim.",
        );
        throw new TrailBaseError(
          "malformed-response",
          "TrailBase auth token did not contain a usable subject claim.",
        );
      }

      const write = writeStoredSession(tokens);
      credentialWriteRef.current = write;
      try {
        await write;
      } finally {
        if (credentialWriteRef.current === write) credentialWriteRef.current = null;
      }
      if (generationRef.current !== expectedGeneration) {
        // The new owner of the generation is responsible for cleanup.
        // In particular, logout waits for in-flight credential writes before
        // verifying deletion; do not race that cleanup from this stale task.
        throw new TrailBaseError(
          "session-invalid",
          "Session changed while credentials were being persisted.",
        );
      }

      tokensRef.current = tokens;
      setSnapshot({ phase: "authenticated", identity, message: null });
    },
    [clearLocalSession],
  );

  const refreshSession = useCallback(async (): Promise<TrailBaseTokens> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const existing = tokensRef.current ?? (await readStoredSession());
    if (!existing) {
      throw new TrailBaseError("session-invalid", "No stored TrailBase session is available.");
    }

    const expectedGeneration = generationRef.current;
    const refreshPromise = (async () => {
      const authToken = await refreshTrailBase(existing.refreshToken);
      const next = { authToken, refreshToken: existing.refreshToken };
      await applyAuthenticated(next, expectedGeneration);
      return next;
    })();

    refreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (refreshPromiseRef.current === refreshPromise) refreshPromiseRef.current = null;
    }
  }, [applyAuthenticated]);

  const restoreSession = useCallback(async () => {
    const expectedGeneration = ++generationRef.current;
    tokensRef.current = null;
    refreshPromiseRef.current = null;

    try {
      if (!(await secureSessionStorageAvailable())) {
        setSnapshot({
          phase: "session-invalid",
          identity: null,
          message: "Secure credential storage is unavailable on this device.",
        });
        return;
      }

      // A durable logout intent takes precedence over a still-valid token pair.
      // A failed guard read must never be interpreted as "no marker".
      let signoutIntent: boolean;
      try {
        signoutIntent = await hasLogoutIntent();
      } catch {
        setSnapshot({
          phase: "signout-incomplete",
          identity: null,
          message: "We could not check whether your last sign-out finished.",
        });
        return;
      }
      if (signoutIntent) {
        setSnapshot({
          phase: "signout-incomplete",
          identity: null,
          message: "Your last sign-out needs to be completed on this device.",
        });
        return;
      }

      const stored = await readStoredSession();
      if (!stored) {
        setSnapshot({ phase: "anonymous", identity: null, message: null });
        return;
      }

      tokensRef.current = stored;
      const authToken = await refreshTrailBase(stored.refreshToken);
      await applyAuthenticated(
        { authToken, refreshToken: stored.refreshToken },
        expectedGeneration,
      );
    } catch (error) {
      if (generationRef.current !== expectedGeneration) return;
      tokensRef.current = null;

      if (error instanceof SessionRestorationBlockedError) {
        setSnapshot({
          phase: "signout-incomplete",
          identity: null,
          message: "Your last sign-out needs to be completed on this device.",
        });
        return;
      }

      if (isNetworkOrConfiguration(error)) {
        setSnapshot({
          phase: "network-degraded",
          identity: null,
          message:
            error instanceof Error
              ? error.message
              : "Session recovery is temporarily unavailable.",
        });
        return;
      }

      try {
        await clearLocalSession(
          "session-invalid",
          error instanceof Error ? error.message : "Stored session could not be restored safely.",
        );
      } catch {
        setSnapshot({
          phase: "signout-incomplete",
          identity: null,
          message: "We could not safely clear the saved session. Try again.",
        });
      }
    }
  }, [applyAuthenticated, clearLocalSession]);

  useEffect(() => {
    const task = setTimeout(() => {
      void restoreSession();
    }, 0);
    return () => clearTimeout(task);
  }, [restoreSession]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      if (logoutPromiseRef.current || snapshot.phase === "signout-incomplete" ||
          snapshot.phase === "signout-pending") {
        throw new SessionRestorationBlockedError();
      }
      // Guard the fresh sign-in path as well as automatic session restoration.
      if (await hasLogoutIntent()) throw new SessionRestorationBlockedError();
      const expectedGeneration = ++generationRef.current;
      tokensRef.current = null;
      refreshPromiseRef.current = null;
      const tokens = await loginTrailBase(identifier.trim(), password);
      await applyAuthenticated(tokens, expectedGeneration);
    },
    [applyAuthenticated, snapshot.phase],
  );

  const logout = useCallback((): Promise<LogoutEvidence> => {
    if (logoutPromiseRef.current) return logoutPromiseRef.current;

    // Generation invalidation and privileged UI removal occur synchronously,
    // before ANY await (including an in-flight credential write).
    const previous = tokensRef.current;
    const pendingWrite = credentialWriteRef.current;
    generationRef.current += 1;
    tokensRef.current = null;
    refreshPromiseRef.current = null;
    setSnapshot({ phase: "signout-pending", identity: null, message: null });

    const task = settleLogout({
      markIntent: markLogoutIntent,
      awaitPendingWrite: async () => {
        if (pendingWrite) await pendingWrite.catch(() => undefined);
      },
      captureAuthToken: async () => {
        if (previous) return previous.authToken;
        try {
          return (await readCredentialsForLogout())?.authToken ?? null;
        } catch {
          return null;
        }
      },
      clearCredentials: clearStoredSession,
      revokeSession: async (authToken) => {
        if (!authToken) return false;
        await logoutTrailBase(authToken);
        // TrailBase documents that a successful logout revokes the session's
        // stateful refresh token, but stateless JWTs live until expiry.
        return true;
      },
      clearIntent: clearLogoutIntent,
    });

    logoutPromiseRef.current = task;
    void task.then((evidence) => {
      if (evidence.status === "complete") {
        setSnapshot({ phase: "anonymous", identity: null, message: null });
      } else if (evidence.status === "local-only") {
        setSnapshot({
          phase: "signed-out-locally",
          identity: null,
          message: "Signed out on this device. Server sign-out could not be confirmed.",
        });
      } else {
        setSnapshot({
          phase: "signout-incomplete",
          identity: null,
          message: "Sign-out is incomplete. The saved session needs to be cleared.",
        });
      }
    }).finally(() => {
      if (logoutPromiseRef.current === task) logoutPromiseRef.current = null;
    });
    return task;
  }, []);

  const retryLogout = logout;

  const withAuthenticatedToken = useCallback(
    async <T,>(operation: (authToken: string) => Promise<T>): Promise<T> => {
      const operationGeneration = generationRef.current;
      let tokens = tokensRef.current;
      if (!tokens || snapshot.phase !== "authenticated") {
        throw new TrailBaseError(
          "session-invalid",
          "Protected request attempted without an authenticated session.",
        );
      }

      const identity = identityFromAuthToken(tokens.authToken);
      if (
        !identity ||
        (identity.expiresAt !== undefined && identity.expiresAt <= Date.now() + 30_000)
      ) {
        try {
          tokens = await refreshSession();
        } catch (error) {
          if (isNetworkOrConfiguration(error)) {
            tokensRef.current = null;
            setSnapshot({
              phase: "network-degraded",
              identity: null,
              message:
                error instanceof Error
                  ? error.message
                  : "Session refresh is temporarily unavailable.",
            });
          } else {
            await clearLocalSession("session-invalid", "Your session has expired. Sign in again.");
          }
          throw error;
        }
      }

      try {
        const result = await operation(tokens.authToken);
        if (generationRef.current !== operationGeneration) {
          throw new TrailBaseError(
            "session-invalid",
            "Protected response was discarded because the session changed.",
          );
        }
        return result;
      } catch (error) {
        if (!(error instanceof TrailBaseError) || error.kind !== "session-invalid") throw error;
        if (generationRef.current !== operationGeneration) throw error;

        try {
          const refreshed = await refreshSession();
          const result = await operation(refreshed.authToken);
          if (generationRef.current !== operationGeneration) {
            throw new TrailBaseError(
              "session-invalid",
              "Protected response was discarded because the session changed.",
            );
          }
          return result;
        } catch (refreshError) {
          if (isNetworkOrConfiguration(refreshError)) {
            tokensRef.current = null;
            setSnapshot({
              phase: "network-degraded",
              identity: null,
              message:
                refreshError instanceof Error
                  ? refreshError.message
                  : "Session refresh is temporarily unavailable.",
            });
          } else if (generationRef.current === operationGeneration) {
            await clearLocalSession(
              "session-invalid",
              "Your session is no longer valid. Sign in again.",
            );
          }
          throw refreshError;
        }
      }
    },
    [clearLocalSession, refreshSession, snapshot.phase],
  );

  const retrySessionRecovery = useCallback(async () => {
    if (logoutPromiseRef.current || snapshot.phase === "signout-incomplete" ||
        snapshot.phase === "signout-pending") return;
    setSnapshot({ phase: "booting", identity: null, message: null });
    await restoreSession();
  }, [restoreSession, snapshot.phase]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...snapshot,
      login,
      logout,
      retryLogout,
      retrySessionRecovery,
      withAuthenticatedToken,
    }),
    [login, logout, retryLogout, retrySessionRecovery, snapshot, withAuthenticatedToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}
