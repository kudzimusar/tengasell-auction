// MOB-03 — bid acknowledgement presentation.
//
// The trade engine's ack is the authority. `ok` means the command was
// accepted; it does NOT mean the bidder is leading. `outbid` means a standing
// automatic bid covered the bid immediately; `winning` means the bidder holds
// the lead. Both flags must be read explicitly — inferring the lead from `ok`
// is the defect found on the first device run.

import type { BidOutcome } from "./socket";

export interface BidPresentation {
  tone: "success" | "warning" | "error";
  text: string;
}

export function presentBidOutcome(
  outcome: BidOutcome,
  formatAmount: (value: number) => string,
): BidPresentation | null {
  if (!outcome.ok) {
    return { tone: "error", text: outcome.error ?? "The bid was not accepted." };
  }
  if (outcome.outbid) {
    return {
      tone: "warning",
      text: `You were outbid — the standing bid is ${formatAmount(outcome.amount ?? 0)}.`,
    };
  }
  if (outcome.winning === false) {
    return {
      tone: "warning",
      text: `Bid accepted at ${formatAmount(outcome.amount ?? 0)}, but you are not leading.`,
    };
  }
  return {
    tone: "success",
    text: `You're the leading bidder at ${formatAmount(outcome.amount ?? 0)}.`,
  };
}
