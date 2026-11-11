// ICR03 — protected-request orchestration, extracted from SessionProvider so the
// exact failure path that review flagged can be driven by tests.
//
// Defect (ICR03-D1): when a refresh failed with a non-network error, the provider
// called clearLocalSession() without checking whether the session generation had
// moved. A logout followed by a fresh login during that refresh had its
// credentials wiped by the older operation — a valid new session destroyed by a
// stale one.
//
// Rule: a stale operation may never mutate durable state or publish UI. It may
// only discard its own result.

import type { TrailBaseTokens } from "../lib/trailbase";

export type RefreshFailureAction = "ignore" | "degrade" | "invalidate";

/**
 * Decide what a failed credential refresh is allowed to do.
 *
 * `stale` means the session generation moved while the refresh was in flight:
 * the current owner is a newer operation, so this one must do nothing at all.
 */
export function decideRefreshFailure(input: {
  stale: boolean;
  networkOrConfiguration: boolean;
}): RefreshFailureAction {
  if (input.stale) return "ignore";
  return input.networkOrConfiguration ? "degrade" : "invalidate";
}

export interface ProtectedRequestDeps<T> {
  currentGeneration: () => number;
  tokens: TrailBaseTokens | null;
  authenticated: boolean;
  identityFromAuthToken: (authToken: string) => { expiresAt?: number } | null;
  refresh: () => Promise<TrailBaseTokens>;
  isNetworkOrConfiguration: (error: unknown) => boolean;
  clearLocalSession: () => Promise<void>;
  onDegraded: (message: string) => void;
  onRefreshed: (tokens: TrailBaseTokens) => void;
  run: (authToken: string) => Promise<T>;
  makeSessionInvalid: (message: string) => Error;
  now?: () => number;
}

export interface ProtectedRequestResult<T> {
  value: T;
}

const EXPIRY_SKEW_MS = 30_000;

export async function runProtectedRequest<T>(
  deps: ProtectedRequestDeps<T>,
): Promise<T> {
  const generation = deps.currentGeneration();
  const now = deps.now ?? (() => Date.now());
  let tokens = deps.tokens;

  if (!tokens || !deps.authenticated) {
    throw deps.makeSessionInvalid(
      "Protected request attempted without an authenticated session.",
    );
  }

  const applyFailure = async (error: unknown): Promise<never> => {
    const stale = deps.currentGeneration() !== generation;
    const action = decideRefreshFailure({
      stale,
      networkOrConfiguration: deps.isNetworkOrConfiguration(error),
    });

    if (action === "degrade") {
      deps.onDegraded(
        error instanceof Error
          ? error.message
          : "Session refresh is temporarily unavailable.",
      );
    } else if (action === "invalidate") {
      await deps.clearLocalSession();
    }
    throw error;
  };

  const identity = deps.identityFromAuthToken(tokens.authToken);
  const expiring =
    !identity ||
    (identity.expiresAt !== undefined && identity.expiresAt <= now() + EXPIRY_SKEW_MS);

  if (expiring) {
    try {
      tokens = await deps.refresh();
      // ICR03-D2: a refresh that resolves after the session moved must not
      // publish its tokens. Writing them into the live token ref would let a
      // logged-out or superseded session reappear as authenticated.
      if (deps.currentGeneration() !== generation) {
        throw deps.makeSessionInvalid(
          "Protected response was discarded because the session changed.",
        );
      }
      deps.onRefreshed(tokens);
    } catch (error) {
      return applyFailure(error);
    }
  }

  const discardIfStale = <V>(value: V): V => {
    if (deps.currentGeneration() !== generation) {
      throw deps.makeSessionInvalid(
        "Protected response was discarded because the session changed.",
      );
    }
    return value;
  };

  try {
    return discardIfStale(await deps.run(tokens.authToken));
  } catch (error) {
    const recoverable =
      error instanceof Error &&
      (error as { kind?: string }).kind === "session-invalid" &&
      deps.currentGeneration() === generation;
    if (!recoverable) throw error;

    try {
      const refreshed = await deps.refresh();
      if (deps.currentGeneration() !== generation) {
        throw deps.makeSessionInvalid(
          "Protected response was discarded because the session changed.",
        );
      }
      deps.onRefreshed(refreshed);
      return discardIfStale(await deps.run(refreshed.authToken));
    } catch (refreshError) {
      return applyFailure(refreshError);
    }
  }
}
