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
  clearStoredSession,
  readStoredSession,
  secureSessionStorageAvailable,
  writeStoredSession,
} from "./session-storage";

export type SessionPhase =
  | "booting"
  | "anonymous"
  | "authenticated"
  | "session-invalid"
  | "network-degraded";

export interface SessionSnapshot {
  phase: SessionPhase;
  identity: TrailBaseIdentity | null;
  message: string | null;
}

interface SessionContextValue extends SessionSnapshot {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

      await writeStoredSession(tokens);
      if (generationRef.current !== expectedGeneration) {
        await clearStoredSession();
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

      await clearLocalSession(
        "session-invalid",
        error instanceof Error ? error.message : "Stored session could not be restored safely.",
      );
    }
  }, [applyAuthenticated, clearLocalSession]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const expectedGeneration = ++generationRef.current;
      tokensRef.current = null;
      refreshPromiseRef.current = null;
      const tokens = await loginTrailBase(identifier.trim(), password);
      await applyAuthenticated(tokens, expectedGeneration);
    },
    [applyAuthenticated],
  );

  const logout = useCallback(async () => {
    let previous = tokensRef.current;
    if (!previous) {
      try {
        previous = await readStoredSession();
      } catch {
        previous = null;
      }
    }

    generationRef.current += 1;
    tokensRef.current = null;
    refreshPromiseRef.current = null;
    setSnapshot({ phase: "anonymous", identity: null, message: null });

    try {
      await clearStoredSession();
    } catch {
      // State and in-memory credentials are already cleared. A later session recovery
      // will fail closed if secure storage could not actually be cleared.
    }

    if (previous?.authToken) {
      try {
        await logoutTrailBase(previous.authToken);
      } catch {
        // Local logout must not retain privileged UI when the authority is unreachable.
        // Independent verification covers server-side invalidation and offline logout paths.
      }
    }
  }, []);

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
    setSnapshot({ phase: "booting", identity: null, message: null });
    await restoreSession();
  }, [restoreSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...snapshot,
      login,
      logout,
      retrySessionRecovery,
      withAuthenticatedToken,
    }),
    [login, logout, retrySessionRecovery, snapshot, withAuthenticatedToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}
