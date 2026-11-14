import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// 1. Executable state-machine verification for getTimedAuctionDisplay and getLiveEventDisplay
const displaySource = read("src/lib/tengasell/auction-display.ts");
const { outputText } = ts.transpileModule(displaySource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});
const mod = { exports: {} };
vm.runInNewContext(outputText, {
  module: mod,
  exports: mod.exports,
  Date,
  Number,
  String,
  Boolean,
});

const { getTimedAuctionDisplay, getLiveEventDisplay, getItemAuctionModePresentation } = mod.exports;
// Normalize realm prototype for cross-VM assert.deepEqual
const getTimed = (auction, ms) => ({ ...getTimedAuctionDisplay(auction, ms) });
const getLive = (input) => ({ ...getLiveEventDisplay(input) });
const getItemMode = (input) => ({ ...getItemAuctionModePresentation(input) });

assert.equal(typeof getTimedAuctionDisplay, "function", "getTimedAuctionDisplay must be exported");
assert.equal(typeof getLiveEventDisplay, "function", "getLiveEventDisplay must be exported");
assert.equal(typeof getItemAuctionModePresentation, "function", "getItemAuctionModePresentation must be exported");

const nowMs = Date.parse("2026-11-14T12:00:00.000Z");

// Timed auctions: Open for Bids, Closing Soon, Auction Ended, Sold
assert.equal(
  getTimed({ status: "live", ends_at: "2026-11-14T16:00:00.000Z" }, nowMs).label,
  "Open for Bids",
);
assert.equal(
  getTimed({ status: "live", ends_at: "2026-11-14T16:00:00.000Z" }, nowMs).state,
  "open",
);
assert.equal(
  getTimed({ status: "live", ends_at: "2026-11-14T12:25:00.000Z" }, nowMs).label,
  "Closing Soon",
);
assert.equal(
  getTimed({ status: "ended", ends_at: "2026-11-14T16:00:00.000Z" }, nowMs).label,
  "Auction Ended",
);
assert.equal(
  getTimed({ status: "live", ends_at: "2026-11-14T11:59:00.000Z" }, nowMs).label,
  "Auction Ended",
);
assert.equal(
  getTimed({ status: "sold", ends_at: "2026-11-14T16:00:00.000Z" }, nowMs).label,
  "Sold",
);

// Live Event / Room authoritative gating (4 mandatory conditions)
assert.deepEqual(
  getLive({
    sessionStatus: "scheduled",
    eventStatus: "SCHEDULED",
    currentLotId: null,
  }),
  {
    state: "upcoming",
    label: "Upcoming Live Event",
    isAuthoritativeLive: false,
    ctaLabel: "Explore Live Events",
  },
);

assert.deepEqual(
  getLive({
    sessionStatus: "live",
    eventStatus: "LIVE",
    currentLotId: null,
  }),
  {
    state: "awaiting_lot",
    label: "Room Open — Awaiting Next Lot",
    isAuthoritativeLive: false,
    ctaLabel: "Enter Live Room",
  },
);

// Must NOT report authoritative live before current lot status loads
const checkingDisplay = getLiveEventDisplay({
  sessionStatus: "live",
  eventStatus: "LIVE",
  currentLotId: 101,
  lotStatus: null,
  lotLoaded: false,
  requireLotVerification: true,
});
assert.equal(checkingDisplay.isAuthoritativeLive, false);
assert.equal(checkingDisplay.state, "checking");

// Incompatible event/session/lot state must fail closed
const mismatchEventDisplay = getLiveEventDisplay({
  sessionStatus: "live",
  eventStatus: "SCHEDULED",
  currentLotId: 101,
  lotStatus: "live",
  lotLoaded: true,
  requireLotVerification: true,
});
assert.equal(mismatchEventDisplay.isAuthoritativeLive, false);
assert.equal(mismatchEventDisplay.state, "sync_mismatch");
assert.equal(mismatchEventDisplay.label, "Status temporarily unavailable");

const mismatchLotDisplay = getLiveEventDisplay({
  sessionStatus: "live",
  eventStatus: "LIVE",
  currentLotId: 101,
  lotStatus: "ended",
  lotLoaded: true,
  requireLotVerification: true,
});
assert.equal(mismatchLotDisplay.isAuthoritativeLive, false);
assert.equal(mismatchLotDisplay.state, "sync_mismatch");

// Symmetric check: event LIVE while session closed/scheduled fails closed
assert.equal(
  getLiveEventDisplay({
    sessionStatus: "scheduled",
    eventStatus: "LIVE",
    currentLotId: 101,
    lotStatus: "live",
    lotLoaded: true,
  }).state,
  "sync_mismatch",
);

// Genuine authoritative live room
const activeDisplay = getLiveEventDisplay({
  sessionStatus: "live",
  sessionExists: true,
  sessionLoaded: true,
  eventBacked: true,
  eventStatus: "LIVE",
  eventLoaded: true,
  sessionMatchesEvent: true,
  currentLotId: 101,
  eventCurrentLotId: 5001,
  lotMatchesSession: true,
  eventLotStatus: "LIVE",
  lotAuctionStatus: "live",
  lotStatus: "live",
  lotLoaded: true,
  requireLotVerification: true,
});
assert.equal(activeDisplay.isAuthoritativeLive, true);
assert.equal(activeDisplay.state, "live_bidding");
assert.equal(activeDisplay.label, "Live Bidding Now");
assert.equal(activeDisplay.ctaLabel, "Enter Live Room");

// 1b. Mandatory A2 10 negative cases — MUST NEVER return isAuthoritativeLive: true
const negativeCases = [
  ["1. event.status=LIVE with session=null", { sessionStatus: null, sessionExists: false, sessionLoaded: true, eventBacked: true, eventStatus: "LIVE", currentLotId: null }],
  ["2. event.status=LIVE with session.status=scheduled", { sessionStatus: "scheduled", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, lotLoaded: true }],
  ["3. event.status=LIVE with session.status=closed", { sessionStatus: "closed", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, lotLoaded: true }],
  ["4. session.status=live with event.status=SCHEDULED", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "SCHEDULED", currentLotId: 101, lotStatus: "live", lotLoaded: true }],
  ["5. session.status=live with event.status=CANCELLED", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "CANCELLED", currentLotId: 101, lotStatus: "live", lotLoaded: true }],
  ["6. current_lot_id present while lot fetch pending", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, lotLoaded: false }],
  ["7. current_lot_id present while lot fetch failed", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, lotLoaded: true, dataError: true }],
  ["8a. AuctionLot.status=PASSED", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "PASSED", lotAuctionStatus: "live", lotLoaded: true }],
  ["8b. AuctionLot.status=SOLD", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "SOLD", lotAuctionStatus: "sold", lotLoaded: true }],
  ["8c. AuctionLot.status=WITHDRAWN", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "WITHDRAWN", lotAuctionStatus: "live", lotLoaded: true }],
  ["9a. Auction.status=ended", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "LIVE", lotAuctionStatus: "ended", lotLoaded: true }],
  ["9b. Auction.status=sold", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "LIVE", lotAuctionStatus: "sold", lotLoaded: true }],
  ["9c. Auction.status=cancelled", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "LIVE", lotAuctionStatus: "cancelled", lotLoaded: true }],
  ["10a. Reconnecting socket", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "LIVE", lotAuctionStatus: "live", lotLoaded: true, reconnecting: true }],
  ["10b. Stale state", { sessionStatus: "live", sessionExists: true, eventBacked: true, eventStatus: "LIVE", currentLotId: 101, eventCurrentLotId: 5001, eventLotStatus: "LIVE", lotAuctionStatus: "live", lotLoaded: true, stale: true }],
];
for (const [desc, input] of negativeCases) {
  const out = getLive(input);
  assert.equal(out.isAuthoritativeLive, false, `${desc} MUST NOT return isAuthoritativeLive=true`);
  assert.notEqual(out.state, "live_bidding", `${desc} MUST NOT return state='live_bidding'`);
}

// 1c. Mandatory A5 Item-page auction mode states
assert.equal(
  getItemMode({ auction: { id: 101, status: "live", ends_at: "2026-11-14T20:00:00Z", live_session_id: null }, nowMs }).mode,
  "standalone_timed",
);
assert.equal(
  getItemMode({
    auction: { id: 201, status: "live", ends_at: "2026-11-14T20:00:00Z", live_session_id: 702 },
    session: { id: 702, status: "scheduled", current_lot_id: null, event_id: 72 },
    sessionLoaded: true,
    event: { id: 72, session_id: 702, status: "SCHEDULED", current_lot_id: null },
    eventLoaded: true,
    lot: { id: 5002, auction_id: 201, status: "READY" },
    nowMs,
  }).mode,
  "live_event_scheduled",
);
assert.equal(
  getItemMode({
    auction: { id: 201, status: "live", ends_at: "2026-11-14T20:00:00Z", live_session_id: 701 },
    session: { id: 701, status: "live", current_lot_id: 201, event_id: 71 },
    sessionLoaded: true,
    event: { id: 71, session_id: 701, status: "LIVE", current_lot_id: 5001 },
    eventLoaded: true,
    lot: { id: 5001, auction_id: 201, status: "LIVE" },
    nowMs,
  }).mode,
  "live_floor_active",
);
assert.equal(
  getItemMode({
    auction: { id: 201, status: "sold", ends_at: "2026-11-14T20:00:00Z", live_session_id: 701 },
    session: { id: 701, status: "closed", current_lot_id: null, event_id: 71 },
    sessionLoaded: true,
    event: { id: 71, session_id: 701, status: "CLOSED", current_lot_id: null },
    eventLoaded: true,
    lot: { id: 5001, auction_id: 201, status: "SOLD" },
    nowMs,
  }).mode,
  "live_event_concluded",
);
assert.equal(
  getItemMode({
    auction: { id: 201, status: "live", ends_at: "2026-11-14T20:00:00Z", live_session_id: 701 },
    session: { id: 701, status: "live", current_lot_id: 202, event_id: 71 },
    sessionLoaded: true,
    event: { id: 71, session_id: 701, status: "LIVE", current_lot_id: 5002 },
    eventLoaded: true,
    lot: { id: 5001, auction_id: 201, status: "WITHDRAWN" },
    nowMs,
  }).mode,
  "returned_to_timed",
);

// 2. UI surface & terminology contracts
const homePage = read("src/components/tengasell/pages/home/home-page.tsx");
for (const marker of [
  "AuctionModeGateways",
  "data-testid=\"auction-mode-gateways\"",
  "Timed Auctions",
  "Bid at Your Pace",
  "Browse Timed Auctions",
  "Live Auction Events",
  "Experience the Live Bidding Floor",
  "Explore Live Events",
  "resolveGatewayLiveState",
]) {
  assert(homePage.includes(marker), `home-page.tsx must include ${marker}`);
}

const closingSoon = read("src/components/tengasell/pages/home/closing-soon.tsx");
assert(closingSoon.includes("Closing Soon"), "closing-soon.tsx must use Closing Soon label");
assert(!/>\s*LIVE\s*</.test(closingSoon), "closing-soon.tsx must not render a red LIVE room label");
assert(!closingSoon.includes("text-urgent"), "closing-soon.tsx must not use urgent red styling for timed auctions");

const listRow = read("src/components/tengasell/pages/browse/list-row.tsx");
assert(listRow.includes("TimedAuctionBadge"), "list-row.tsx must render TimedAuctionBadge");
assert(!listRow.includes("bg-urgent"), "list-row.tsx must not use bg-urgent for timed listings");

const browsePage = read("src/components/tengasell/pages/browse/browse-page.tsx");
assert(browsePage.includes("Timed Auctions"), "browse-page.tsx must label timed auctions clearly");
assert(!browsePage.includes("All live auctions"), "browse-page.tsx must not use generic All live auctions heading");
assert(browsePage.includes("#/events"), "browse-page.tsx must cross-link to Live Auction Events");

const results = read("src/components/tengasell/pages/browse/results.tsx");
assert(results.includes("Open for Bids"), "results.tsx must surface Open for Bids terminology");
assert(!results.includes("live listings"), "results.tsx must not say live listings");

const filterPanel = read("src/components/tengasell/pages/browse/filter-panel.tsx");
assert(filterPanel.includes("Open for Bids"), "filter-panel.tsx must use Open for Bids");

const profilePage = read("src/components/tengasell/pages/account/profile.tsx");
assert(profilePage.includes("Timed auctions from @"), "profile.tsx must distinguish Timed auctions");

const appShell = read("src/components/tengasell/app-shell.tsx");
const eventsNavIdx = appShell.indexOf('router.navigate("/events")');
const catSliceIdx = appShell.indexOf("categories.slice(0, 8)");
assert(eventsNavIdx >= 0 && catSliceIdx >= 0 && eventsNavIdx < catSliceIdx, "app-shell.tsx must keep Auction Hub before category overflow");
assert(appShell.includes("Timed Auctions"), "app-shell.tsx must expose Timed Auctions navigation");
assert(appShell.includes("#/my/communications") || appShell.includes("/my/communications"), "app-shell.tsx must link to Communications Centre");
assert(!appShell.includes('className="size-3.5 animate-pulse"'), "app-shell.tsx must wrap animate-pulse with motion-safe:");

const uiFile = read("src/components/tengasell/ui.tsx");
assert(uiFile.includes("motion-safe:animate-pulse"), "ui.tsx live badge must respect reduced motion");
assert(uiFile.includes("AuctionCommsNotice"), "ui.tsx must export AuctionCommsNotice");
assert(uiFile.includes("AuctionCommsRoadmapCard"), "ui.tsx must export AuctionCommsRoadmapCard");

const eventsPage = read("src/components/tengasell/pages/events/auction-events.tsx");
assert(eventsPage.includes("LiveEventStatusBadge"), "auction-events.tsx must use LiveEventStatusBadge");
assert(eventsPage.includes("AuctionCommsNotice"), "auction-events.tsx must include comms discoverability");
assert(eventsPage.includes("events-empty-guidance"), "auction-events.tsx must explain empty schedules");
assert(eventsPage.includes("bundleCacheRef") && eventsPage.includes("CONCURRENCY_LIMIT"), "auction-events.tsx must deduplicate and bound bundle requests");
assert(eventsPage.includes("}, [liveEventsKey])"), "auction-events.tsx must not include raw live array reference in useEffect deps");

const liveRoom = read("src/components/tengasell/pages/live/live-room.tsx");
assert(liveRoom.includes("getLiveEventDisplay"), "live-room.tsx must derive status via getLiveEventDisplay");
assert(liveRoom.includes("Room Open — Awaiting Next Lot"), "live-room.tsx must label open room awaiting lot");
assert(liveRoom.includes("Status temporarily unavailable"), "live-room.tsx must fail closed on mismatch");
assert(liveRoom.includes("hammer-clock-pending"), "live-room.tsx HammerClock must render neutral pending state when local timer elapses");
assert(!liveRoom.includes('t("room.clock.sold")') || liveRoom.includes("isSoldAuthoritatively"), "live-room.tsx HammerClock must gate SOLD on authoritative lot status");
assert(!/\banimate-pulse\b/.test(liveRoom.replace(/motion-safe:animate-pulse/g, "")), "live-room.tsx must gate animate-pulse on motion-safe:");

const itemPage = read("src/components/tengasell/pages/item/item-page.tsx");
assert(itemPage.includes("TimedAuctionBadge"), "item-page.tsx must show TimedAuctionBadge");
assert(itemPage.includes("AuctionCommsNotice"), "item-page.tsx must link to Communications Centre");
assert(itemPage.includes("getItemAuctionModePresentation"), "item-page.tsx must derive item auction mode via getItemAuctionModePresentation");

const commsCenter = read("src/components/tengasell/pages/account/comms-center.tsx");
const myPage = read("src/components/tengasell/pages/account/my-page.tsx");
assert(commsCenter.includes("AuctionCommsRoadmapCard"), "comms-center.tsx must render AuctionCommsRoadmapCard");
assert(myPage.includes("AuctionCommsRoadmapCard"), "my-page.tsx must render AuctionCommsRoadmapCard on signed-out communications route");

const i18nFile = read("src/lib/tengasell/i18n.tsx");
assert(!i18nFile.includes("live listings right now"), "i18n.tsx must not use ambiguous live listings copy");
assert(i18nFile.includes("Timed auctions · Open for Bids"), "i18n.tsx must describe timed auctions accurately");

console.log("TENGASELL-LIVE-COMMS-UX-01 R1 contract tests passed.");
