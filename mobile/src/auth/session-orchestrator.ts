// ICR02 — provider-owned session orchestration, extracted so it can be tested.
//
// `SessionProvider` delegates its post-authentication publication to this
// function. The point of the extraction is that the *production* ordering —
// ownership check, credential persistence, stale cleanup, publication — is what
// the STORE-08 integration test drives, rather than a re-implementation of it.
//
// Errors are returned as outcomes rather than thrown, so this module stays free
// of TrailBase/React Native imports and can run under the node test runner. The
// provider maps each outcome to the same user-visible behaviour as before.

import type { TrailBaseTokens } from "../lib/trailbase";

export type ApplySessionOutcome = "published" | "superseded" | "malformed";

export interface ApplySessionDeps {
  tokens: TrailBaseTokens;
  /** Generation this login owns; reads SessionProvider's existing ref. */
  expectedGeneration: number;
  currentGeneration: () => number;
  writeStoredSession: (tokens: TrailBaseTokens) => Promise<void>;
  clearStaleCredentialWrite: (tokens: TrailBaseTokens) => Promise<boolean>;
  clearLocalSession: () => Promise<void>;
  identityFromAuthToken: (authToken: string) => { id: string } | null;
  publish: (identity: { id: string }) => void;
}

export async function applyAuthenticatedSession(
  deps: ApplySessionDeps,
): Promise<ApplySessionOutcome> {
  // Ownership may already have moved before this task ran at all.
  if (deps.currentGeneration() !== deps.expectedGeneration) return "superseded";

  const identity = deps.identityFromAuthToken(deps.tokens.authToken);
  if (!identity) {
    // A token without a usable subject claim is not a session. Drop whatever
    // this task may have persisted and report a malformed response.
    await deps.clearLocalSession();
    return "malformed";
  }

  await deps.writeStoredSession(deps.tokens);

  if (deps.currentGeneration() !== deps.expectedGeneration) {
    // ICR02: remove only the pair this task wrote. The storage authority
    // serializes this against any newer login's write, so a valid newer pair is
    // never erased, and a cleanup failure leaves a fail-closed marker.
    await deps.clearStaleCredentialWrite(deps.tokens).catch(() => undefined);
    return "superseded";
  }

  deps.publish(identity);
  return "published";
}
