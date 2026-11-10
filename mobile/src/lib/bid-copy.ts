// MOB-03 / CLOSE-01 — bid acknowledgement presentation.
//
// The trade engine's acknowledgement is the only authority. Three separate
// facts must never collapse into one:
//
//   ok       the engine ACCEPTED the command
//   winning  the bidder now HOLDS THE LEAD
//   outbid   a standing automatic bid covered this bid immediately
//
// `ok === true` therefore proves acceptance and nothing else. Treating it as
// leadership was the CLOSE-01 defect: a user was told "You're the leading
// bidder" whenever the engine replied without a `winning` flag.
//
// Rules enforced here:
//   - missing `winning` is NOT `true`;
//   - missing/invalid `amount` never becomes a fabricated US$0;
//   - contradictory flags never produce a success message;
//   - a malformed or timed-out acknowledgement yields an UNKNOWN state that
//     must be reconciled against canonical auction state, never a success.

import type { BidOutcome } from "./socket";

export type BidTone = "success" | "warning" | "error" | "unknown";

export interface BidPresentation {
  tone: BidTone;
  text: string;
  /**
   * True when the local acknowledgement cannot be trusted as a final state:
   * the caller must re-read canonical auction state before claiming anything.
   */
  reconcile: boolean;
}

function amountText(
  amount: number | undefined,
  formatAmount: (value: number) => string,
): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  return formatAmount(amount);
}

export function presentBidOutcome(
  outcome: BidOutcome,
  formatAmount: (value: number) => string,
): BidPresentation {
  // An undetermined result (timeout, transport loss mid-command) proves nothing:
  // not that the engine rejected the bid, not that it accepted it.
  if (outcome.uncertain) {
    return {
      tone: "unknown",
      text:
        "We could not confirm this bid. It may still have reached the auction — " +
        "checking the current bid before you try again.",
      reconcile: true,
    };
  }

  if (!outcome.ok) {
    return {
      tone: "error",
      text: outcome.error ?? "The bid was not accepted.",
      reconcile: false,
    };
  }

  // Contradictory flags: the ack cannot be both covered and leading.
  if (outcome.outbid === true && outcome.winning === true) {
    return {
      tone: "unknown",
      text:
        "The auction engine returned an inconsistent confirmation. " +
        "Checking the current bid before showing a result.",
      reconcile: true,
    };
  }

  if (outcome.outbid === true) {
    const standing = amountText(outcome.amount, formatAmount);
    return {
      tone: "warning",
      text: standing
        ? `You were outbid — the standing bid is ${standing}.`
        : "You were outbid — a standing automatic bid covered your maximum.",
      reconcile: true,
    };
  }

  // Leadership is only ever claimed from an explicit `winning === true`.
  if (outcome.winning === true) {
    const accepted = amountText(outcome.amount, formatAmount);
    return {
      tone: "success",
      text: accepted
        ? `You're the leading bidder at ${accepted}.`
        : "You're the leading bidder.",
      reconcile: false,
    };
  }

  if (outcome.winning === false) {
    const accepted = amountText(outcome.amount, formatAmount);
    return {
      tone: "warning",
      text: accepted
        ? `Bid accepted at ${accepted}, but you are not leading.`
        : "Bid accepted, but you are not leading.",
      reconcile: false,
    };
  }

  // Accepted, but the engine did not say who leads. This is the CLOSE-01 case:
  // report the acceptance and the uncertainty, never the lead.
  return {
    tone: "unknown",
    text:
      "Your bid was accepted. The engine did not confirm your position — " +
      "checking the current bid.",
    reconcile: true,
  };
}
