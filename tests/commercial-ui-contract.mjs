import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const escapeRe = (text) => text.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

const events = read("src/components/tengasell/pages/events/auction-events.tsx");
for (const text of [
  "Bidder qualification",
  "Approved capacity",
  "Currently reserved",
  "Available capacity",
  "Deposit / credit",
  "Action required",
]) assert.match(events, new RegExp(escapeRe(text)));
assert.match(events, /qualification:bundle/);
assert.match(events, /sm:grid-cols-2/);
assert.match(events, /lg:grid-cols-4/);
assert.match(events, /min-h-11/);
assert.match(events, /role="alert"/);

const settlement = read("src/components/tengasell/pages/orders/vehicle-auction-settlement.tsx");
for (const text of [
  "Won-lot vehicle settlement",
  "Invoice &amp; Finance",
  "Payment",
  "Transfer",
  "Release",
  "Collection / Transport",
  "Complete",
  "pending Finance confirmation",
  "statutory ownership transfer",
  "Request transport",
  "Physical handover",
]) assert.match(settlement, new RegExp(escapeRe(text)));
assert.match(settlement, /settlement:bundle/);
assert.match(settlement, /settlement:transport-request/);
assert.match(settlement, /sm:grid-cols-2/);
assert.match(settlement, /lg:grid-cols-2/);
assert.match(settlement, /min-h-11/);
assert.match(settlement, /role="alert"/);

const orders = read("src/components/tengasell/pages/orders/orders-page.tsx");
assert.match(orders, /VehicleAuctionSettlementCard/);
assert.match(orders, /VehicleSettlementActionNotice/);
assert.match(orders, /vehicleAuction/);
assert.match(orders, /!vehicleAuction && <DisputeButton/);

const operations = read("src/components/tengasell/pages/events/auction-operations.tsx");
for (const text of [
  "Qualification review queue",
  "Release &amp; handover queue",
  "Zimbabwe Production readiness",
  "Production policy still required",
  "Auction outbox backlog",
  "Finance bridge backlog",
]) assert.match(operations, new RegExp(escapeRe(text)));
for (const event of [
  "qualification:command",
  "settlement:release-command",
  "settlement:handover-command",
  "production:gates",
  "policy:snapshot",
  "operations:observability",
]) assert.match(operations, new RegExp(event.replace(":", "\\:")));
assert.match(operations, /md:grid-cols-2/);
assert.match(operations, /min-h-11/);

const item = read("src/components/tengasell/pages/item/item-page.tsx");
assert.match(item, /reserve_disclosure === "RESERVE_APPLIES"/);
assert.match(item, /private reserve amount is not displayed/);
assert.match(item, /owner_bid_right_disclosure/);
assert.doesNotMatch(item, /Retract-bid dialog — 60-minute/);
assert.doesNotMatch(item, /payment is due within 48h \(SLA\)/);

const i18n = read("src/lib/tengasell/i18n.tsx");
assert.match(i18n, /Request bid retraction/);
assert.match(i18n, /hammer\/customary completion/);
assert.doesNotMatch(i18n, /Bids can be retracted within 60 minutes/);

const remote = read("src/lib/tengasell/api/remote.ts");
assert.match(remote, /auction_public/);

const types = read("src/lib/tengasell/types.ts");
assert.match(types, /reserve_price\?: number \| null/);
assert.match(types, /reserve_disclosure\?/);

const engine = read("mini-services/trade-engine/index.ts");
assert.match(engine, /FINANCE_CONFIRMATION_REQUIRED/);
assert.match(engine, /VEHICLE_RELEASE_AUTHORITY_REQUIRED/);
assert.match(engine, /VEHICLE_HANDOVER_AUTHORITY_REQUIRED/);
assert.match(engine, /submitVehicleRetractionRequest/);
assert.match(engine, /assertProductionMutationAllowed/);

const policy = read("mini-services/trailbase-db/traildepot/migrations/main/U1000000014__zimbabwe_policy_production_gates.sql");
for (const contract of [
  "auction_public",
  "legal.auction.completion_retraction",
  "legal.auction.reserve_upset_notice",
  "legal.electronic_transaction.requirements",
  "business.supplier_disclosure_profile",
  "business.payment_deadline_hours",
  "business.deposit_policy",
  "business.fee_policy",
  "auction_policy_retraction_requests",
  "auction_observability_events",
]) assert.match(policy, new RegExp(escapeRe(contract)));

console.log("LR02 commercial lifecycle responsive/accessibility contract: PASS");
console.log("  bidder qualification + financial capacity UI: PASS");
console.log("  won-lot settlement / transfer / release / transport UI: PASS");
console.log("  operator qualification + release/handover controls: PASS");
console.log("  Zimbabwe production-gate observability UI: PASS");
console.log("  reserve privacy + vehicle retraction wording: PASS");
console.log("  responsive breakpoints + 44px controls + alert hooks: PASS");
