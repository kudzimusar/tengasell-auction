// CLOSE-01 regression suite — bid acknowledgement truthfulness.
//
// Drives the production presenter directly. The suite exists because the
// shipped version reported "You're the leading bidder" whenever the engine
// replied `ok` without a `winning` flag, and formatted a missing amount as
// US$0.

import assert from "node:assert/strict";
import test from "node:test";

import { presentBidOutcome } from "../src/lib/bid-copy.ts";
import { parseBidAck } from "../src/lib/bid-ack.ts";
import { reconcileBidOutcome } from "../src/bids/bid-reconcile.ts";
import { translateNxs } from "../src/nxs/localization/catalog.ts";
import { formatUSD } from "../src/lib/format.ts";

const money = (value) => `US$${value.toLocaleString("en-US")}`;

test("ACK-01 winning=true reports the lead at the accepted amount", () => {
  const result = presentBidOutcome({ ok: true, winning: true, amount: 700 }, money);

  assert.equal(result.tone, "success");
  assert.match(result.text, /leading bidder/i);
  assert.match(result.text, /US\$700/);
  assert.equal(result.reconcile, false);
});

test("ACK-02 outbid=true reports the standing bid, not a lead", () => {
  const result = presentBidOutcome({ ok: true, outbid: true, amount: 750 }, money);

  assert.equal(result.tone, "warning");
  assert.match(result.text, /outbid/i);
  assert.match(result.text, /US\$750/);
  assert.doesNotMatch(result.text, /you're the leading bidder/i);
  assert.equal(result.reconcile, true);
});

test("ACK-03 winning=false reports acceptance without the lead", () => {
  const result = presentBidOutcome({ ok: true, winning: false, amount: 700 }, money);

  assert.equal(result.tone, "warning");
  assert.match(result.text, /not leading/i);
  assert.match(result.text, /US\$700/);
});

test("ACK-04 missing winning is never treated as leading", () => {
  const result = presentBidOutcome({ ok: true, amount: 700 }, money);

  assert.notEqual(result.tone, "success");
  assert.equal(result.tone, "unknown");
  assert.doesNotMatch(result.text, /leading bidder/i);
  assert.equal(result.reconcile, true);
});

test("ACK-05 missing amount never fabricates US$0", () => {
  const winning = presentBidOutcome({ ok: true, winning: true }, money);
  const accepted = presentBidOutcome({ ok: true, winning: false }, money);
  const outbid = presentBidOutcome({ ok: true, outbid: true }, money);
  const zero = presentBidOutcome({ ok: true, winning: true, amount: 0 }, money);

  for (const result of [winning, accepted, outbid, zero]) {
    assert.doesNotMatch(result.text, /US\$0\b/);
    assert.doesNotMatch(result.text, /NaN|undefined|null/);
  }
  assert.equal(winning.tone, "success");
  assert.match(winning.text, /leading bidder/i);
});

test("ACK-06 contradictory flags never produce a success message", () => {
  const result = presentBidOutcome(
    { ok: true, outbid: true, winning: true, amount: 700 },
    money,
  );

  assert.equal(result.tone, "unknown");
  assert.doesNotMatch(result.text, /you're the leading bidder/i);
  assert.equal(result.reconcile, true);
});

test("ACK-07 malformed acknowledgement yields a truthful unknown state", () => {
  const empty = presentBidOutcome({ ok: true }, money);
  const junk = presentBidOutcome({ ok: true, amount: Number.NaN }, money);

  for (const result of [empty, junk]) {
    assert.equal(result.tone, "unknown");
    assert.equal(result.reconcile, true);
    assert.doesNotMatch(result.text, /leading bidder/i);
    assert.doesNotMatch(result.text, /US\$/);
  }
});

test("ACK-08 timeout is uncertain, not a rejection and not a success", () => {
  const result = presentBidOutcome(
    { ok: false, uncertain: true, reason: "timeout", error: "The auction engine did not respond." },
    money,
  );

  assert.equal(result.tone, "unknown");
  assert.equal(result.reconcile, true);
  assert.doesNotMatch(result.text, /not accepted|rejected|failed/i);
  assert.doesNotMatch(result.text, /leading bidder/i);
  assert.match(result.text, /may still have reached/i);
});

test("ACK-09 an acknowledgement without a boolean ok is uncertain, not a rejection", () => {
  const missing = parseBidAck(undefined);
  const noFlag = parseBidAck({ amount: 700 });
  const notBoolean = parseBidAck({ ok: "true", amount: 700 });

  for (const parsed of [missing, noFlag, notBoolean]) {
    assert.equal(parsed.ok, false);
    assert.equal(parsed.uncertain, true);
    assert.equal(parsed.reason, "malformed");

    const shown = presentBidOutcome(parsed, money);
    assert.equal(shown.tone, "unknown");
    assert.equal(shown.reconcile, true);
    assert.doesNotMatch(shown.text, /not accepted|rejected/i);
  }
});

test("ACK-10 the parser preserves explicit flags and invents none", () => {
  const explicit = parseBidAck({ ok: true, winning: true, outbid: false, amount: 700 });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.winning, true);
  assert.equal(explicit.outbid, undefined, "outbid=false is not a coverage event");
  assert.equal(explicit.amount, 700);

  const covered = parseBidAck({ ok: true, outbid: true, amount: 750 });
  assert.equal(covered.outbid, true);
  assert.equal(covered.winning, undefined);

  const silent = parseBidAck({ ok: true });
  assert.equal(silent.ok, true);
  assert.equal(silent.winning, undefined);
  assert.equal(silent.outbid, undefined);
  assert.equal(silent.amount, undefined);
  assert.equal(presentBidOutcome(silent, money).tone, "unknown");

  const uncoded = parseBidAck({ ok: false, error: "Auction closed." });
  assert.equal(uncoded.ok, false);
  assert.equal(uncoded.uncertain, true);
  assert.equal(uncoded.reason, "unverified");
  assert.equal(presentBidOutcome(uncoded, money).tone, "unknown");
});

test("ACK-11 an engine rejection that is uncertain stays uncertain", () => {
  // The engine can answer ok:false after recording the bid (audit hold). A
  // rejection claim here would invite a retry against the same maximum.
  const parsed = parseBidAck({
    ok: false,
    uncertain: true,
    reason: "timeout",
    error: "Result not confirmed",
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.uncertain, true);
  assert.equal(parsed.reason, "timeout");

  const shown = presentBidOutcome(parsed, money);
  assert.equal(shown.tone, "unknown");
  assert.equal(shown.reconcile, true);
  assert.doesNotMatch(shown.text, /not accepted|please retry/i);
});

test("ACK-12 uncoded engine error including 'Please retry.' stays uncertain without substring guessing", () => {
  // Exact post-commit catch string emitted by mini-services/trade-engine/index.ts:
  const postCommitCatch = parseBidAck({
    ok: false,
    error: "The trade engine hit an unexpected error. Please retry.",
  });
  // Uncoded pre-commit validation message from unmodified engine is equally uncoded:
  const uncodedValidation = parseBidAck({ ok: false, error: "Bid below the minimum." });

  for (const parsed of [postCommitCatch, uncodedValidation]) {
    assert.equal(parsed.ok, false);
    assert.equal(parsed.uncertain, true);
    assert.equal(parsed.rejected, undefined);
    assert.equal(parsed.reason, "unverified");
    const shown = presentBidOutcome(parsed, money);
    assert.equal(shown.tone, "unknown");
    assert.equal(shown.reconcile, true);
    assert.doesNotMatch(shown.text, /please retry|unexpected error|not accepted|failed/i);
  }
});

test("ACK-13 an unrecognised uncertain reason is not trusted", () => {
  const parsed = parseBidAck({ ok: false, uncertain: true, reason: "garbage" });
  assert.equal(parsed.uncertain, true);
  assert.equal(parsed.reason, undefined);
  assert.equal(presentBidOutcome(parsed, money).tone, "unknown");
});

test("ACK-14 structured pre-commit non-commit authority reports definite error without substring checks", () => {
  const byStage = parseBidAck({
    ok: false,
    stage: "pre_commit",
    error: "The trade engine hit an unexpected error. Please retry.",
  });
  const byCommitted = parseBidAck({
    ok: false,
    committed: false,
    error: "Opening bid is US$50.",
  });
  for (const parsed of [byStage, byCommitted]) {
    assert.equal(parsed.ok, false);
    assert.equal(parsed.rejected, true);
    assert.equal(parsed.stage, "pre_commit");
    assert.equal(parsed.uncertain, undefined);
    const shown = presentBidOutcome(parsed, money);
    assert.equal(shown.tone, "error");
    assert.equal(shown.reconcile, true);
  }
});

test("ACK-15 reconcileBidOutcome recovers post-commit audit/anti-snipe error as canonical lead", async () => {
  let readCalls = 0;
  const raw = parseBidAck({
    ok: false,
    error: "The trade engine hit an unexpected error. Please retry.",
  });
  const reconciled = await reconcileBidOutcome(
    raw,
    {
      auctionId: 9001,
      identityId: "buyer-takudzwa",
      maxAmount: 150,
      beforeTopBidId: 441,
      beforeBidCount: 3,
    },
    money,
    async () => {
      readCalls += 1;
      return {
        auction: { id: 9001, current_price: 122, bid_count: 4 },
        bids: [
          { id: 442, auction_id: 9001, user: "buyer-takudzwa", bidder_username: "takudzwa", amount: 122, max_amount: 150, is_auto: 1, status: "active", created_at: "2026-11-11T01:37:46Z" },
          { id: 441, auction_id: 9001, user: "buyer-nyasha", bidder_username: "nyasha", amount: 102, max_amount: 120, is_auto: 1, status: "superseded", created_at: "2026-11-11T01:37:46Z" },
        ],
      };
    },
  );
  assert.equal(readCalls, 1);
  assert.equal(reconciled.outcome.ok, true);
  assert.equal(reconciled.outcome.winning, true);
  assert.equal(reconciled.outcome.amount, 122);
  assert.equal(reconciled.presentation.tone, "success");
  assert.match(reconciled.presentation.text, /US\$122/);
  assert.doesNotMatch(reconciled.presentation.text, /please retry|error/i);
});

test("ACK-16 reconcileBidOutcome reports outbid when post-ack records show buyer bid was superseded", async () => {
  const reconciled = await reconcileBidOutcome(
    { ok: false, uncertain: true, reason: "timeout" },
    {
      auctionId: 9001,
      identityId: "buyer-nyasha",
      maxAmount: 130,
      beforeTopBidId: 441,
      beforeBidCount: 3,
    },
    money,
    async () => ({
      auction: { id: 9001, current_price: 132, bid_count: 5 },
      bids: [
        { id: 443, auction_id: 9001, user: "buyer-takudzwa", bidder_username: "takudzwa", amount: 132, max_amount: 150, is_auto: 1, status: "active", created_at: "2026-11-11T01:37:46Z" },
        { id: 442, auction_id: 9001, user: "buyer-nyasha", bidder_username: "nyasha", amount: 130, max_amount: 130, is_auto: 1, status: "superseded", created_at: "2026-11-11T01:37:46Z" },
      ],
    }),
  );
  assert.equal(reconciled.outcome.ok, true);
  assert.equal(reconciled.outcome.outbid, true);
  assert.equal(reconciled.presentation.tone, "warning");
  assert.match(reconciled.presentation.text, /outbid/i);
});

test("ACK-17 reconcileBidOutcome stays unknown and never invites retry when unrecorded or unreachable", async () => {
  const raw = parseBidAck({
    ok: false,
    error: "The trade engine hit an unexpected error. Please retry.",
  });
  const unrecorded = await reconcileBidOutcome(
    raw,
    { auctionId: 9001, identityId: "buyer-takudzwa", maxAmount: 25, beforeTopBidId: 438, beforeBidCount: 0 },
    money,
    async () => ({
      auction: { id: 9001, current_price: 50, bid_count: 0 },
      bids: [],
    }),
  );
  assert.equal(unrecorded.presentation.tone, "unknown");
  assert.doesNotMatch(unrecorded.presentation.text, /please retry|failed/i);

  const offline = await reconcileBidOutcome(
    raw,
    { auctionId: 9001, identityId: "buyer-takudzwa", maxAmount: 120, beforeTopBidId: 440, beforeBidCount: 2 },
    money,
    async () => {
      throw new Error("Network down");
    },
  );
  assert.equal(offline.presentation.tone, "unknown");
  assert.doesNotMatch(offline.presentation.text, /please retry|failed/i);
});

test("ACK-18 structured rejection skips unnecessary canonical blocking lookup", async () => {
  let called = 0;
  const raw = parseBidAck({ ok: false, rejected: true, stage: "pre_commit", error: "Not connected to the live auction engine." });
  const settled = await reconcileBidOutcome(
    raw,
    { auctionId: 9001, identityId: "buyer-takudzwa", maxAmount: 120, beforeTopBidId: 440, beforeBidCount: 2 },
    money,
    async () => {
      called += 1;
      return { auction: null, bids: [] };
    },
  );
  assert.equal(called, 0);
  assert.equal(settled, null);
  assert.equal(presentBidOutcome(raw, money).tone, "error");
});

test("ACK-19 committed=true forces uncertain outcome across ALL authoritativePreCommit branches", () => {
  const contradictory = [
    { ok: false, rejected: true, committed: true, error: "Should not trust pre-commit" },
    { ok: false, stage: "pre_commit", committed: true, error: "Post-commit error" },
    { ok: false, definite: true, committed: true, error: "Late audit fail" },
    { ok: false, rejected: true, stage: "pre_commit", definite: true, committed: true },
  ];

  for (const payload of contradictory) {
    const parsed = parseBidAck(payload);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.rejected, undefined, `committed=true must block rejected=true: ${JSON.stringify(payload)}`);
    assert.equal(parsed.uncertain, true);
    const shown = presentBidOutcome(parsed, money);
    assert.equal(shown.tone, "unknown");
    assert.equal(shown.reconcile, true);
  }
});

test("ACK-20 reconcileBidOutcome enforces bid_count > beforeBidCount when beforeTopBidId is null", async () => {
  // Buyer already had an earlier bid matching maxAmount=150 from an earlier session/turn,
  // but beforeTopBidId was null because initial recentBids failed to load.
  // If auction.bid_count did NOT increase above beforeBidCount, we MUST NOT claim committed!
  const unchangedCount = await reconcileBidOutcome(
    { ok: false, uncertain: true, reason: "timeout" },
    {
      auctionId: 9001,
      identityId: "buyer-takudzwa",
      maxAmount: 150,
      beforeTopBidId: null,
      beforeBidCount: 3,
    },
    money,
    async () => ({
      auction: { id: 9001, current_price: 122, bid_count: 3 },
      bids: [
        { id: 441, auction_id: 9001, user: "buyer-takudzwa", bidder_username: "takudzwa", amount: 122, max_amount: 150, is_auto: 1, status: "active", created_at: "2026-11-11T01:37:46Z" },
      ],
    }),
  );
  assert.equal(unchangedCount.outcome.ok, false);
  assert.equal(unchangedCount.outcome.uncertain, true);
  assert.equal(unchangedCount.presentation.tone, "unknown");

  const increasedCount = await reconcileBidOutcome(
    { ok: false, uncertain: true, reason: "timeout" },
    {
      auctionId: 9001,
      identityId: "buyer-takudzwa",
      maxAmount: 150,
      beforeTopBidId: null,
      beforeBidCount: 3,
    },
    money,
    async () => ({
      auction: { id: 9001, current_price: 122, bid_count: 4 },
      bids: [
        { id: 442, auction_id: 9001, user: "buyer-takudzwa", bidder_username: "takudzwa", amount: 122, max_amount: 150, is_auto: 1, status: "active", created_at: "2026-11-11T01:37:46Z" },
      ],
    }),
  );
  assert.equal(increasedCount.outcome.ok, true);
  assert.equal(increasedCount.outcome.winning, true);
  assert.equal(increasedCount.presentation.tone, "success");
});

test("ACK-21 en-XA and ar-XB pseudolocalization covers all bid, reconcile, currency, and engine code outputs", async () => {
  const tXa = (key, values) => translateNxs(key, "en-XA", values);
  const tXb = (key, values) => translateNxs(key, "ar-XB", values);
  const moneyXa = (v) => formatUSD(v, { t: tXa });
  const moneyXb = (v) => formatUSD(v, { t: tXb });

  for (const outcome of [
    { ok: true, winning: true, amount: 700 },
    { ok: true, outbid: true, amount: 750 },
    { ok: true, winning: false, amount: 700 },
    { ok: true },
    { ok: false, uncertain: true, reason: "timeout" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "AUTH_REVOKED" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "AUTH_INVALID" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "PROFILE_MISSING" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "AUCTION_LOOKUP_FAILED" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "BID_LEDGER_UNAVAILABLE" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "SELF_BID" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "ALREADY_LEADING" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "BELOW_MIN_BID" },
    { ok: false, rejected: true, stage: "pre_commit", errorCode: "NOT_CONNECTED" },
  ]) {
    const en = presentBidOutcome(outcome, (v) => formatUSD(v));
    const xa = presentBidOutcome(outcome, moneyXa, tXa);
    const xb = presentBidOutcome(outcome, moneyXb, tXb);
    assert.ok(xa.text.includes("⟦"), `en-XA missing marker on ${JSON.stringify(outcome)}`);
    assert.ok(xa.text.length > en.text.length, `en-XA did not expand ${JSON.stringify(outcome)}`);
    assert.ok(xb.text.includes("\u2067⟦"), `ar-XB missing RLI on ${JSON.stringify(outcome)}`);
  }

  const recXa = await reconcileBidOutcome(
    { ok: false, uncertain: true, reason: "timeout" },
    { auctionId: 9001, identityId: "buyer", maxAmount: 200, beforeTopBidId: 10, beforeBidCount: 1 },
    moneyXa,
    async () => ({ auction: { id: 9001, current_price: 200, bid_count: 2 }, bids: [{ id: 11, auction_id: 9001, user: "buyer", bidder_username: "b", amount: 180, max_amount: 200, is_auto: 1, status: "active", created_at: "2026-11-11T00:00:00Z" }] }),
    tXa,
  );
  assert.ok(recXa.presentation.text.includes("⟦"));
});
