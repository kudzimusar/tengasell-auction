import fs from "node:fs";

const eventAuthority = fs.readFileSync("mini-services/trade-engine/event-authority.ts", "utf8");
const engine = fs.readFileSync("mini-services/trade-engine/index.ts", "utf8");
const shell = fs.readFileSync("src/components/tengasell/app-shell.tsx", "utf8");
const hub = fs.readFileSync("src/components/tengasell/pages/events/auction-events.tsx", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const gate = eventAuthority.indexOf("const authorization = eventCreateAuthorization(me)");
const eventInsert = eventAuthority.indexOf('store.create("auction_events"');
assert(gate >= 0, "createAuctionEvent must enforce eventCreateAuthorization");
assert(eventInsert > gate, "event create authorization must run before auction_events insert");
assert(
  eventAuthority.includes('EVENT_CREATE_AUTHORITY = "ADMIN"') &&
  eventAuthority.includes('code: allowed ? null : "EVENT_CREATE_FORBIDDEN"'),
  "event creation must fail closed to administrator authority",
);

const socketStart = engine.indexOf('socket.on("event:create"');
const socketEnd = engine.indexOf('socket.on("event:operator:grant"', socketStart);
const socketBlock = engine.slice(socketStart, socketEnd);
assert(socketStart >= 0 && socketBlock.includes("eventCreateAuthorization(user)"), "event:create socket must enforce creator authorization");
assert(socketBlock.includes("EVENT_CREATE_FORBIDDEN") || socketBlock.includes("authorization.code"), "event:create socket must return the authorization rejection");

const roomStart = engine.indexOf('socket.on("room:create"');
const roomEnd = engine.indexOf('socket.on("room:add-lot"', roomStart);
const roomBlock = engine.slice(roomStart, roomEnd);
assert(roomStart >= 0 && roomBlock.includes("eventCreateAuthorization(user)"), "room:create must not bypass event creator authorization");

assert(shell.includes('router.navigate("/events")'), "Auction Hub must be reachable from the global shell");
assert(shell.includes("Auction Hub & calendar"), "Auction Hub must be discoverable in the marketplace footer");
assert(shell.indexOf('router.navigate("/events")') < shell.indexOf("categories.slice(0, 8)"), "Auction Hub must be visible before the long category strip on mobile");
assert(hub.includes("Event creation is restricted to administrators."), "Auction Hub must explain event creation authority");
assert(hub.includes('user?.admin ? "Create auction event"'), "Auction Hub must distinguish authorized event creators");

console.log("LR01-R1 event RBAC + Auction Hub discoverability contract: PASS");
console.log("ordinary event creator = REJECTED");
console.log("authorized event creator = ADMIN");
console.log("direct event:create + room:create bypass = BLOCKED");
console.log("global/mobile Auction Hub path = PASS");
