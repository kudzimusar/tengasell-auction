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

import {
  translateNxs,
  type NxsStringKey,
  type NxsTranslator,
} from "../nxs/localization/catalog.ts";
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

const defaultTranslate: NxsTranslator = (key, values) =>
  translateNxs(key, "en", values);

const ERROR_CODE_KEY_MAP: Record<string, NxsStringKey> = {
  NOT_CONNECTED: "bid.notConnected",
  AUTH_REQUIRED: "bid.code.AUTH_REQUIRED",
  AUTH_INVALID: "bid.code.AUTH_INVALID",
  AUTH_EXPIRED: "bid.code.AUTH_EXPIRED",
  AUTH_REVOKED: "bid.code.AUTH_REVOKED",
  AUTH_UNAVAILABLE: "bid.code.AUTH_UNAVAILABLE",
  PROFILE_MISSING: "bid.code.PROFILE_MISSING",
  AUCTION_NOT_FOUND: "bid.code.AUCTION_NOT_FOUND",
  AUCTION_LOOKUP_FAILED: "bid.code.AUCTION_LOOKUP_FAILED",
  AUCTION_NOT_LIVE: "bid.code.AUCTION_NOT_LIVE",
  AUCTION_ENDED: "bid.code.AUCTION_ENDED",
  SELF_BID: "bid.code.SELF_BID",
  ALREADY_LEADING: "bid.code.ALREADY_LEADING",
  INVALID_AMOUNT: "bid.code.INVALID_AMOUNT",
  BELOW_MINIMUM: "bid.code.BELOW_MINIMUM",
  BELOW_MIN_BID: "bid.code.BELOW_MINIMUM",
  BELOW_START_PRICE: "bid.code.BELOW_START_PRICE",
  BID_LEDGER_UNAVAILABLE: "bid.code.BID_LEDGER_UNAVAILABLE",
  INVALID_AUCTION: "bid.code.INVALID_AUCTION",
  INVALID_REQUEST_ID: "bid.code.INVALID_REQUEST_ID",
  IDEMPOTENCY_CONFLICT: "bid.code.IDEMPOTENCY_CONFLICT",
  RATE_LIMITED: "bid.code.RATE_LIMITED",
  WRITE_REJECTED: "bid.code.WRITE_REJECTED",
};

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
  t: NxsTranslator = defaultTranslate,
): BidPresentation {
  // An unconfirmed result (timeout, transport loss, or an uncoded `ok: false`
  // lacking structured pre-commit non-commit authority) proves nothing: never
  // claim the bid failed or invite an immediate retry.
  if (outcome.uncertain || (!outcome.ok && outcome.rejected !== true)) {
    return {
      tone: "unknown",
      text: t("bid.unconfirmed"),
      reconcile: true,
    };
  }

  if (!outcome.ok) {
    const mappedKey = outcome.errorCode ? ERROR_CODE_KEY_MAP[outcome.errorCode] : undefined;
    const text = mappedKey
      ? t(mappedKey)
      : outcome.error
        ? t("bid.rejectedWithReason", { reason: outcome.error })
        : t("bid.notAccepted");
    return {
      tone: "error",
      // Structured pre-commit non-commit proof (local pre-emit guard or explicit
      // engine stage/committed=false authority); still refresh canonical state.
      text,
      reconcile: true,
    };
  }

  // Contradictory flags: the ack cannot be both covered and leading.
  if (outcome.outbid === true && outcome.winning === true) {
    return {
      tone: "unknown",
      text: t("bid.inconsistent"),
      reconcile: true,
    };
  }

  if (outcome.outbid === true) {
    const standing = amountText(outcome.amount, formatAmount);
    return {
      tone: "warning",
      text: standing
        ? t("bid.outbidStanding", { amount: standing })
        : t("bid.outbidCovered"),
      reconcile: true,
    };
  }

  // Leadership is only ever claimed from an explicit `winning === true`.
  if (outcome.winning === true) {
    const accepted = amountText(outcome.amount, formatAmount);
    return {
      tone: "success",
      text: accepted
        ? t("bid.leadingAt", { amount: accepted })
        : t("bid.leading"),
      reconcile: false,
    };
  }

  if (outcome.winning === false) {
    const accepted = amountText(outcome.amount, formatAmount);
    return {
      tone: "warning",
      text: accepted
        ? t("bid.acceptedNotLeadingAt", { amount: accepted })
        : t("bid.acceptedNotLeading"),
      reconcile: false,
    };
  }

  // Accepted, but the engine did not say who leads. This is the CLOSE-01 case:
  // report the acceptance and the uncertainty, never the lead.
  return {
    tone: "unknown",
    text: t("bid.acceptedPositionUnknown"),
    reconcile: true,
  };
}
