// MOB-03 / CLOSE-02 — session-safe bid completion.
//
// `placeBid()` is asynchronous and can resolve long after the context that
// started it has gone away: a logout, an account switch, a navigation, an
// unmount, or a replaced socket. Applying that acknowledgement to whatever UI
// happens to be mounted now would let a stale operation:
//
//   - restore privileged bidding UI after sign-out;
//   - show "you are leading" for a different account;
//   - attach a result to an auction the user has left.
//
// This module is the ownership boundary for that completion. It deliberately
// REUSES the two existing authorities rather than creating a third:
//
//   - the session generation owned by SessionProvider (the RACE01 primitive);
//   - the connection epoch owned by the bidding transport (MOB-03).
//
// It never retries a commercial action. An uncertain bid is reported as
// uncertain and reconciled against canonical auction state by the caller.

import type { BidOutcome } from "../lib/socket";

export interface BidOwnership {
  /** Session generation at the moment the bid was issued. */
  sessionGeneration: number;
  /** Authenticated identity at the moment the bid was issued. */
  identityId: string | null;
  /** Bidding-connection epoch at the moment the bid was issued. */
  connectionEpoch: number;
}

export interface BidCompletionGuard {
  sessionGeneration: () => number;
  identityId: () => string | null;
  isConnectionCurrent: (epoch: number) => boolean;
  isMounted: () => boolean;
}

export type BidDiscardReason =
  | "session-changed"
  | "account-changed"
  | "connection-superseded"
  | "unmounted";

export type BidSettlement =
  | { state: "applied"; outcome: BidOutcome }
  | { state: "discarded"; reason: BidDiscardReason };

/** Decide whether a pending bid may still be published. Pure. */
export function settleBidAttempt(
  ownership: BidOwnership,
  guard: BidCompletionGuard,
): { state: "applied" } | { state: "discarded"; reason: BidDiscardReason } {
  if (!guard.isMounted()) return { state: "discarded", reason: "unmounted" };
  if (guard.sessionGeneration() !== ownership.sessionGeneration) {
    return { state: "discarded", reason: "session-changed" };
  }
  if (guard.identityId() !== ownership.identityId) {
    return { state: "discarded", reason: "account-changed" };
  }
  if (!guard.isConnectionCurrent(ownership.connectionEpoch)) {
    return { state: "discarded", reason: "connection-superseded" };
  }
  return { state: "applied" };
}

export interface GuardedBidDeps {
  guard: BidCompletionGuard;
  /** Capture ownership synchronously, before the transport call is awaited. */
  takeOwnership: () => BidOwnership;
  /** The commercial command. Must not be retried by this module. */
  place: () => Promise<BidOutcome>;
  /** Called only when the completion is still owned by the current context. */
  publish: (outcome: BidOutcome) => void;
  /** Called when the completion is dropped; must not claim any result. */
  onDiscarded?: (reason: BidDiscardReason) => void;
}

export async function runGuardedBid(deps: GuardedBidDeps): Promise<BidSettlement> {
  // Ownership first, synchronously: anything that signs out or switches
  // account after this point invalidates the attempt.
  const ownership = deps.takeOwnership();

  const outcome = await deps.place();

  const verdict = settleBidAttempt(ownership, deps.guard);
  if (verdict.state === "discarded") {
    deps.onDiscarded?.(verdict.reason);
    return verdict;
  }

  deps.publish(outcome);
  return { state: "applied", outcome };
}
