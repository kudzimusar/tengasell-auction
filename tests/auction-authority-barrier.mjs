import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const before = (src, first, second, label) => {
  const a = src.indexOf(first);
  const b = src.indexOf(second);
  assert.ok(a >= 0, `${label}: missing ${first}`);
  assert.ok(b >= 0, `${label}: missing ${second}`);
  assert.ok(a < b, `${label}: authority guard must execute before mutation`);
};

const authority = read("src/lib/auction-authority.ts");
for (const code of [
  "AUCTION_AUTHORITY_MOVED",
  "CANONICAL_AUCTION_REQUIRED",
  "AUCTION_SERVICE_UNAVAILABLE",
  "DEMO_COMMERCIAL_MUTATION_BLOCKED",
]) assert.match(authority, new RegExp(code));
for (const method of [
  "placeBid", "createAuction", "buyNow", "submitOffer", "respondOffer",
  "acceptCounter", "retractBid", "createLiveRoom", "closeRoomLot", "payOrder",
]) assert.match(authority, new RegExp(`"${method}"`));

const listing = read("src/app/api/listings/route.ts");
before(listing, "isLegacyPrismaAuction(data.type)", "db.listing.create", "Prisma AUCTION creation");
assert.match(listing, /AUCTION_AUTHORITY_MOVED/);
assert.match(listing, /data\.type === "BUY_NOW"/);
assert.match(listing, /db\.listing\.create/);

const bid = read("src/app/api/listings/[id]/bid/route.ts");
assert.match(bid, /CANONICAL_AUCTION_REQUIRED/);
assert.doesNotMatch(bid, /db\.bid\.create/);
assert.doesNotMatch(bid, /db\.\$transaction/);
assert.doesNotMatch(bid, /currentPrice:\s*amount/);

const admin = read("src/app/api/admin/listings/[id]/action/route.ts");
before(admin, "isLegacyPrismaAuction(listing.type)", "db.listing.update", "Prisma AUCTION admin mutation");
assert.match(admin, /auction\.authority\.blocked\.prisma_admin_action/);

const scheduler = read("src/lib/server/scheduler.ts");
const start = scheduler.indexOf("export async function endExpiredAuctions()");
const end = scheduler.indexOf("export async function dispatchOutbox", start);
assert.ok(start >= 0 && end > start, "scheduler barrier function not found");
const closure = scheduler.slice(start, end);
assert.match(closure, /suppressed:\s*true/);
assert.match(closure, /CANONICAL_AUCTION_REQUIRED/);
assert.doesNotMatch(closure, /db\./);
assert.doesNotMatch(closure, /order\.create/);
assert.doesNotMatch(closure, /listing\.update/);

const api = read("src/lib/tengasell/api/index.ts");
assert.match(api, /"live" \| "demo" \| "degraded"/);
assert.match(api, /explicitDemoIntent \? "demo" : "degraded"/);
assert.match(api, /mode === "degraded" && DEGRADED_COMMERCIAL_MUTATIONS\.has\(prop\)/);
assert.match(api, /new AuctionAuthorityError\("AUCTION_SERVICE_UNAVAILABLE"\)/);
assert.match(api, /mode !== "demo"/);

const staticDemo = read("scripts/build-static-demo.mjs");
assert.match(staticDemo, /NEXT_PUBLIC_TENGASELL_EXPLICIT_DEMO:\s*"1"/);

for (const path of ["src/app/api/v1/listings/route.ts", "src/app/api/v1/listings/[id]/route.ts"]) {
  const src = read(path);
  assert.match(src, /export async function GET/);
  assert.doesNotMatch(src, /export async function POST/);
}

console.log("IMP-01 auction authority barrier contract: PASS");
