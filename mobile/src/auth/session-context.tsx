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
import { runGuardedLogin } from "./login-barrier";
import {
  clearLogoutIntent,
  clearStoredSession,
  hasLogoutIntent,
  clearStaleCredentialWrite,
  markLogoutIntent,
  readCredentialsForLogout,
  readStoredSession,
  secureSessionStorageAvailable,
  SessionRestorationBlockedError,
  writeStoredSession,
} from "./session-storage";
import { applyAuthenticatedSession } from "./session-orchestrator";
import { runProtectedRequest } from "./protected-request";
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
  invalidateSession: (message?: string) => Promise<void>;
  withAuthenticatedToken: <T>(operation: (authToken: string) => Promise<T>) => Promise<T>;
  /**
   * Read the current session generation (RACE01 ownership counter).
   *
   * Exposed so asynchronous commercial operations can prove they still belong
   * to the session that started them. It is a read of the existing owner ref —
   * not a second session authority, and not a React state value.
   */
  sessionGeneration: () => number;
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
      const expectedGeneration = ++generationRef.current;
      tokensRef.current = null;
      refreshPromiseRef.current = null;
      try {
        await clearStoredSession();
      } finally {
        if (generationRef.current === expectedGeneration) {
          setSnapshot({ phase, identity: null, message });
        }
      }
    },
    [],
  );

  const applyAuthenticated = useCallback(
    async (tokens: TrailBaseTokens, expectedGeneration: number) => {
      // ICR02: the ordering lives in the production orchestrator so the same
      // code path can be exercised by the storage-concurrency suite. This
      // wrapper keeps custody of the in-flight write so logout can await it.
      const outcome = await applyAuthenticatedSession({
        tokens,
        expectedGeneration,
        currentGeneration: () => generationRef.current,
        writeStoredSession: (value) => {
          const write = writeStoredSession(value);
          credentialWriteRef.current = write;
          write.then(
            () => {
              if (credentialWriteRef.current === write) credentialWriteRef.current = null;
            },
            () => {
              if (credentialWriteRef.current === write) credentialWriteRef.current = null;
            },
          );
          return write;
        },
        clearStaleCredentialWrite,
        clearLocalSession: () =>
          clearLocalSession(
            "session-invalid",
            "TrailBase returned an auth token without a usable subject claim.",
          ),
        identityFromAuthToken,
        publish: (identity) => {
          tokensRef.current = tokens;
          setSnapshot({ phase: "authenticated", identity, message: null });
        },
      });

      if (outcome === "superseded") {
        throw new TrailBaseError(
          "session-invalid",
          "Session changed while authentication was completing.",
        );
      }
      if (outcome === "malformed") {
        throw new TrailBaseError(
          "malformed-response",
          "TrailBase auth token did not contain a usable subject claim.",
        );
      }
    },
    [clearLocalSession],
  );

  const refreshSession = useCallback(async (): Promise<TrailBaseTokens> => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;

    const expectedGeneration = generationRef.current;
    const existing = tokensRef.current ?? (await readStoredSession());
    if (generationRef.current !== expectedGeneration) {
      throw new TrailBaseError("session-invalid", "Session changed before refresh.");
    }
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    if (!existing) {
      throw new TrailBaseError("session-invalid", "No stored TrailBase session is available.");
    }
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
      // RACE01: ownership is taken synchronously inside runGuardedLogin, before
      // the logout-intent read. A logout that begins during any await below
      // invalidates this login, so a stale response can neither persist
      // credentials nor publish a session.
      tokensRef.current = null;
      refreshPromiseRef.current = null;
      await runGuardedLogin({
        begin: () => ++generationRef.current,
        current: () => generationRef.current,
        hasLogoutIntent,
        authenticate: () => loginTrailBase(identifier.trim(), password),
        apply: (tokens, generation) => applyAuthenticated(tokens, generation),
      });
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
      // ICR03: the ordering lives in the production orchestrator so the failure
      // path — including a logout and fresh login during a refresh — is
      // testable. A stale operation may discard its own result but must never
      // clear durable state or publish degraded UI for the newer session.
      const result = await runProtectedRequest<T>({
        currentGeneration: () => generationRef.current,
        tokens: tokensRef.current,
        authenticated: snapshot.phase === "authenticated",
        identityFromAuthToken,
        refresh: refreshSession,
        isNetworkOrConfiguration,
        clearLocalSession: () =>
          clearLocalSession("session-invalid", "Your session is no longer valid. Sign in again."),
        onDegraded: (message) => {
          tokensRef.current = null;
          setSnapshot({ phase: "network-degraded", identity: null, message });
        },
        onRefreshed: (tokens) => {
          tokensRef.current = tokens;
        },
        run: operation,
        makeSessionInvalid: (message) => new TrailBaseError("session-invalid", message),
      });
      return result;
    },
    [clearLocalSession, refreshSession, snapshot.phase],
  );

  const retrySessionRecovery = useCallback(async () => {
    if (logoutPromiseRef.current || snapshot.phase === "signout-incomplete" ||
        snapshot.phase === "signout-pending") return;
    setSnapshot({ phase: "booting", identity: null, message: null });
    await restoreSession();
  }, [restoreSession, snapshot.phase]);

  const invalidateSession = useCallback(
    async (message?: string) => {
      if (
        logoutPromiseRef.current ||
        snapshot.phase === "signout-incomplete" ||
        snapshot.phase === "signout-pending"
      ) {
        return;
      }
      await clearLocalSession(
        "session-invalid",
        message ?? "Your session is no longer valid. Sign in again.",
      );
    },
    [clearLocalSession, snapshot.phase],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      ...snapshot,
      login,
      logout,
      retryLogout,
      retrySessionRecovery,
      invalidateSession,
      withAuthenticatedToken,
      sessionGeneration: () => generationRef.current,
    }),
    [
      invalidateSession,
      login,
      logout,
      retryLogout,
      retrySessionRecovery,
      snapshot,
      withAuthenticatedToken,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}
