// MOB-03 / MOB3-R3 & R4 — canonical post-ack bid reconciliation and localization checks.

import assert from "node:assert/strict";
import test from "node:test";

import { reconcileBidOutcome } from "../src/bids/bid-reconcile.ts";
import { parseBidAck } from "../src/lib/bid-ack.ts";
import { formatUSD } from "../src/lib/format.ts";
import { translateNxs } from "../src/nxs/localization/catalog.ts";

const money = (value) => formatUSD(value);

test("RECON-01 null beforeTopBidId requires strict bid_count > beforeBidCount proof", async () => {
  const unchanged = await reconcileBidOutcome(
    { ok: false, uncertain: true, reason: "timeout" },
    {
      auctionId: 77,
      identityId: "buyer-1",
      maxAmount: 250,
      beforeTopBidId: null,
      beforeBidCount: 5,
    },
    money,
    async () => ({
      auction: { id: 77, current_price: 200, bid_count: 5 },
      bids: [
        {
          id: 90,
          auction_id: 77,
          user: "buyer-1",
          bidder_username: "buyer1",
          amount: 200,
          max_amount: 250,
          is_auto: 1,
          status: "active",
          created_at: "2026-11-11T00:00:00Z",
        },
      ],
    }),
  );

  assert.equal(unchanged.outcome.ok, false);
  assert.equal(unchanged.outcome.uncertain, true);
  assert.equal(unchanged.presentation.tone, "unknown");
  assert.equal(unchanged.presentation.reconcile, true);

  const committed = await reconcileBidOutcome(
    { ok: false, uncertain: true, reason: "timeout" },
    {
      auctionId: 77,
      identityId: "buyer-1",
      maxAmount: 250,
      beforeTopBidId: null,
      beforeBidCount: 5,
    },
    money,
    async () => ({
      auction: { id: 77, current_price: 202, bid_count: 6 },
      bids: [
        {
          id: 91,
          auction_id: 77,
          user: "buyer-1",
          bidder_username: "buyer1",
          amount: 202,
          max_amount: 250,
          is_auto: 1,
          status: "active",
          created_at: "2026-11-11T00:01:00Z",
        },
      ],
    }),
  );

  assert.equal(committed.outcome.ok, true);
  assert.equal(committed.outcome.winning, true);
  assert.equal(committed.presentation.tone, "success");
});

test("RECON-02 parseBidAck treats committed=true as uncertain even when pre-commit flags are set", () => {
  const parsed = parseBidAck({
    ok: false,
    rejected: true,
    stage: "pre_commit",
    definite: true,
    committed: true,
    error: "Late failure after write",
  });
  assert.equal(parsed.rejected, undefined);
  assert.equal(parsed.uncertain, true);
});

test("RECON-03 all reconciliation error and status branches pseudolocalize under en-XA and ar-XB", async () => {
  const tXa = (key, values) => translateNxs(key, "en-XA", values);
  const tXb = (key, values) => translateNxs(key, "ar-XB", values);
  const moneyXa = (value) => formatUSD(value, { t: tXa });
  const moneyXb = (value) => formatUSD(value, { t: tXb });

  const cases = [
    async () => {
      throw new Error("offline");
    },
    async () => ({ auction: null, bids: [] }),
    async () => ({ auction: { id: 77, current_price: 100, bid_count: 1 }, bids: [] }),
    async () => ({
      auction: { id: 77, current_price: 150, bid_count: 3 },
      bids: [
        {
          id: 20,
          auction_id: 77,
          user: "other",
          bidder_username: "other",
          amount: 150,
          max_amount: 180,
          is_auto: 1,
          status: "active",
          created_at: "2026-11-11T00:00:00Z",
        },
        {
          id: 19,
          auction_id: 77,
          user: "buyer-1",
          bidder_username: "buyer1",
          amount: 140,
          max_amount: 140,
          is_auto: 1,
          status: "superseded",
          created_at: "2026-11-11T00:00:00Z",
        },
      ],
    }),
  ];

  for (const reader of cases) {
    const resXa = await reconcileBidOutcome(
      { ok: false, uncertain: true, reason: "disconnected" },
      { auctionId: 77, identityId: "buyer-1", maxAmount: 140, beforeTopBidId: 18, beforeBidCount: 1 },
      moneyXa,
      reader,
      tXa,
    );
    const resXb = await reconcileBidOutcome(
      { ok: false, uncertain: true, reason: "disconnected" },
      { auctionId: 77, identityId: "buyer-1", maxAmount: 140, beforeTopBidId: 18, beforeBidCount: 1 },
      moneyXb,
      reader,
      tXb,
    );
    assert.ok(resXa.presentation.text.includes("⟦"));
    assert.ok(resXb.presentation.text.includes("\u2067⟦"));
  }
});
