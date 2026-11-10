// MOB-03 — bid acknowledgement contract (canonical engine ack parsing).
//
// Dependency-free on purpose: the parser is the security-relevant part of the
// bidding path and must be directly testable without a socket or React Native.
//
// The engine's acknowledgement is the authority for three separate facts:
//
//   ok       the command was ACCEPTED
//   winning  the bidder HOLDS THE LEAD
//   outbid   a standing automatic bid covered this bid
//
// A reply that does not carry a boolean `ok` is not a rejection. The command may
// already have been executed and the confirmation lost, so it is reported as
// uncertain and reconciled against canonical auction state by the caller.

export interface BidOutcome {
  ok: boolean;
  amount?: number;
  error?: string;
  /** True when the engine's standing auto-bid immediately covered this bid. */
  outbid?: boolean;
  /** True when the bidder is now the leading bidder. */
  winning?: boolean;
  /**
   * True when the outcome is genuinely unknown (timeout, transport loss
   * mid-command, or an unreadable confirmation). `ok` is false, but that does
   * NOT mean the engine rejected the bid.
   */
  uncertain?: boolean;
  reason?: "timeout" | "disconnected" | "malformed";
}

/**
 * Parse an engine acknowledgement. Non-boolean flags are unknown, never
 * inferred: only an explicit `true` sets `winning`/`outbid`.
 */
export function parseBidAck(res: unknown): BidOutcome {
  const payload = (res ?? {}) as {
    ok?: unknown;
    amount?: unknown;
    error?: unknown;
    outbid?: unknown;
    winning?: unknown;
    uncertain?: unknown;
    reason?: unknown;
  };

  if (typeof payload.ok !== "boolean") {
    return {
      ok: false,
      uncertain: true,
      reason: "malformed",
      error: "The auction engine returned an unreadable confirmation.",
    };
  }

  if (!payload.ok) {
    // The engine can answer ok:false after it has already recorded the bid
    // (audit holds, delegated decisions). If it says the outcome is uncertain,
    // that must survive parsing — reporting a rejection would invite a retry
    // that re-bids against the same maximum.
    const uncertain = payload.uncertain === true;
    const allowed = ["timeout", "disconnected", "malformed"] as const;
    const reason =
      typeof payload.reason === "string" && (allowed as readonly string[]).includes(payload.reason)
        ? (payload.reason as (typeof allowed)[number])
        : undefined;
    return {
      ok: false,
      uncertain: uncertain ? true : undefined,
      reason,
      error: typeof payload.error === "string" ? payload.error : "The bid was not accepted.",
    };
  }

  return {
    ok: true,
    amount: typeof payload.amount === "number" ? payload.amount : undefined,
    outbid: payload.outbid === true ? true : undefined,
    winning: payload.winning === true ? true : payload.winning === false ? false : undefined,
  };
}
