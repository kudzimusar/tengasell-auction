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

export type BidRejectionStage = "pre_commit";

export interface BidOutcome {
  ok: boolean;
  amount?: number;
  error?: string;
  errorCode?: string;
  /** True when the engine's standing auto-bid immediately covered this bid. */
  outbid?: boolean;
  /** True when the bidder is now the leading bidder. */
  winning?: boolean;
  /**
   * True ONLY when an authoritative structured pre-commit refusal (client
   * pre-emit check or explicit structured engine stage/committed=false proof)
   * confirms no bid mutation occurred.
   */
  rejected?: boolean;
  stage?: BidRejectionStage;
  /**
   * True when the outcome is genuinely unknown (timeout, transport loss
   * mid-command, an unreadable confirmation, or an uncoded `ok: false` reply
   * lacking structured non-commit proof). `ok` is false, but that does NOT
   * mean the engine rejected the bid.
   */
  uncertain?: boolean;
  reason?: "timeout" | "disconnected" | "malformed" | "unverified";
}

/**
 * Parse an engine acknowledgement. Non-boolean flags are unknown, never
 * inferred: only an explicit `true` sets `winning`/`outbid`, and an uncoded
 * `ok: false` without structured pre-commit authority stays uncertain so post-
 * commit failures are never misrepresented as definite rejections.
 */
export function parseBidAck(res: unknown): BidOutcome {
  const payload = (res ?? {}) as {
    ok?: unknown;
    amount?: unknown;
    error?: unknown;
    code?: unknown;
    outbid?: unknown;
    winning?: unknown;
    uncertain?: unknown;
    reason?: unknown;
    rejected?: unknown;
    stage?: unknown;
    committed?: unknown;
    definite?: unknown;
  };

  if (typeof payload.ok !== "boolean") {
    return {
      ok: false,
      uncertain: true,
      reason: "malformed",
      ...(typeof payload.error === "string" && payload.error.trim() ? { error: payload.error } : {}),
    };
  }

  if (!payload.ok) {
    // Current mini-services/trade-engine/index.ts can emit { ok: false, error }
    // both before mutation and inside post-commit catch blocks (antiSnipe /
    // audit failures). Only treat `ok: false` as a definite rejection when
    // commit is ruled out (`committed !== true`) and an explicit structured
    // contract field confirms pre-commit non-commit; never match error text.
    const authoritativePreCommit =
      payload.uncertain !== true &&
      payload.committed !== true &&
      (payload.rejected === true ||
        payload.stage === "pre_commit" ||
        payload.committed === false ||
        payload.definite === true);

    if (authoritativePreCommit) {
      return {
        ok: false,
        rejected: true,
        stage: "pre_commit",
        ...(typeof payload.code === "string" && payload.code.trim()
          ? { errorCode: payload.code.trim() }
          : {}),
        ...(typeof payload.error === "string" && payload.error.trim()
          ? { error: payload.error }
          : {}),
      };
    }

    const allowed = ["timeout", "disconnected", "malformed", "unverified"] as const;
    const reason =
      typeof payload.reason === "string"
        ? (allowed as readonly string[]).includes(payload.reason)
          ? (payload.reason as (typeof allowed)[number])
          : undefined
        : payload.uncertain === true
          ? undefined
          : "unverified";
    return {
      ok: false,
      uncertain: true,
      reason,
      ...(typeof payload.code === "string" && payload.code.trim()
        ? { errorCode: payload.code.trim() }
        : {}),
      ...(typeof payload.error === "string" && payload.error.trim()
        ? { error: payload.error }
        : {}),
    };
  }

  return {
    ok: true,
    amount: typeof payload.amount === "number" ? payload.amount : undefined,
    outbid: payload.outbid === true ? true : undefined,
    winning: payload.winning === true ? true : payload.winning === false ? false : undefined,
  };
}
