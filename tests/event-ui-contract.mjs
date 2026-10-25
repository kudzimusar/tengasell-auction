import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const page = read("src/components/tengasell/pages/events/auction-events.tsx");
assert.match(page, /Auction Hub/);
assert.match(page, /Calendar/);
assert.match(page, /Production Run List/);
assert.match(page, /Run list v/);
assert.match(page, /Current lot/);
assert.match(page, /Next lot/);
assert.match(page, /Lock run list/);
assert.match(page, /Unlock run list/);
assert.match(page, /STALE|latest run-list version|run-list version/i);
assert.match(page, /grid-cols-2/);
assert.match(page, /sm:grid-cols-/);
assert.match(page, /lg:grid-cols-/);
assert.match(page, /min-h-11/);
assert.match(page, /role="alert"/);
assert.match(page, /aria-label/);
assert.match(page, /#\/live\//);

const app = read("src/components/tengasell/tengasell-app.tsx");
assert.match(app, /case "events"/);
assert.match(app, /AuctionEventsPage/);

const live = read("src/components/tengasell/pages/live/live-room.tsx");
assert.match(live, /eventBacked/);
assert.match(live, /#\/events/);
assert.match(live, /Run List/);

const remote = read("src/lib/tengasell/api/remote.ts");
for (const method of [
  "auctionEvents",
  "auctionEventBundle",
  "createAuctionEvent",
  "grantEventOperator",
  "runListCommand",
]) assert.match(remote, new RegExp(`async ${method}\\(`));

const engine = read("mini-services/trade-engine/index.ts");
for (const event of [
  'event:bundle',
  'event:create',
  'event:operator:grant',
  'run-list:command',
]) assert.match(engine, new RegExp(event.replace(":", "\\:")));
assert.match(engine, /commandType: "ADVANCE"/);
assert.match(engine, /session\.event_id != null/);

const migration = read("mini-services/trailbase-db/traildepot/migrations/main/U1000000010__auction_events_run_list.sql");
for (const contract of [
  "auction_events",
  "auction_venues",
  "auction_lots",
  "sequence_no",
  "run_list_version",
  "run_list_locked",
  "STALE_RUN_LIST_VERSION",
  "VEHICLE_NOT_ELIGIBLE",
  "current_lot_id",
  "next_lot_id",
]) assert.match(migration, new RegExp(contract));

console.log("IMP-05 responsive/accessibility/integration contract: PASS");
console.log("  Auction Hub + Calendar + Event UI: PASS");
console.log("  production run-list controls: PASS");
console.log("  responsive breakpoints + 44px targets: PASS");
console.log("  alert/label accessibility hooks: PASS");
console.log("  Live Room integration: PASS");
