import assert from "node:assert/strict"
import fs from "node:fs"
import {
  canonicalFingerprint,
  legacyFingerprint,
  reconcileSnapshot,
} from "../scripts/lib/prisma-auction-reconciliation.mjs"
import { inventoryPrismaAuctionConsumers } from "../scripts/inventory-prisma-auction-consumers.mjs"

const legacy1 = {
  id: "legacy-a",
  type: "AUCTION",
  title: "Toyota Hilux 2020",
  sellerId: "seller-a",
  startingPrice: 10000,
}
const legacy2 = {
  id: "legacy-b",
  type: "AUCTION",
  title: "Honda Fit 2018",
  sellerId: "seller-b",
  startingPrice: 4000,
}
const canonical1 = {
  id: 101,
  title: "Toyota Hilux 2020",
  seller_username: "seller-a-canonical",
  start_price: 10000,
}
const candidate = {
  id: 102,
  title: "Honda Fit 2018",
  seller_username: "unknown-cross-id",
  start_price: 4000,
}
const mapping = {
  legacy_listing_id: legacy1.id,
  canonical_auction_id: canonical1.id,
  status: "VERIFIED",
  legacy_fingerprint: legacyFingerprint(legacy1),
  canonical_fingerprint: canonicalFingerprint(canonical1),
}

const report = reconcileSnapshot({
  legacyListings: [legacy1, legacy2, { id: "bn", type: "BUY_NOW" }],
  legacyOrders: [
    { id: "o-ok", listingId: "legacy-a", type: "AUCTION", amount: 12500 },
    { id: "o-unmapped", listingId: "legacy-b", type: "AUCTION", amount: 4500 },
    { id: "o-buy", listingId: "bn", type: "BUY_NOW", amount: 20 },
  ],
  canonicalAuctions: [canonical1, candidate],
  canonicalOrders: [{ id: 9001, auction_id: 101, final_price: 12500 }],
  mappings: [mapping],
})

assert.equal(report.mode, "DRY_RUN")
assert.equal(report.mutationAllowed, false)
assert.equal(report.listings.length, 2)
assert.equal(report.listings[0].classification, "VERIFIED_CANONICAL")
assert.equal(report.listings[0].safeToMap, true)
assert.equal(report.listings[1].classification, "CANDIDATE_UNPROVEN")
assert.equal(report.listings[1].safeToMap, false)
assert.equal(report.orders[0].classification, "ORDER_AMOUNT_MATCH")
assert.equal(report.orders[1].classification, "UNMAPPED_AUCTION_ORDER")

const changedLegacy = { ...legacy1, title: "Toyota Hilux CHANGED" }
const legacyConflict = reconcileSnapshot({
  legacyListings: [changedLegacy],
  canonicalAuctions: [canonical1],
  canonicalOrders: [],
  legacyOrders: [],
  mappings: [mapping],
})
assert.equal(legacyConflict.listings[0].classification, "MAPPED_IMMUTABLE_CONFLICT")
assert.equal(legacyConflict.listings[0].safeToMap, false)

const changedCanonical = { ...canonical1, start_price: 10001 }
const canonicalConflict = reconcileSnapshot({
  legacyListings: [legacy1],
  canonicalAuctions: [changedCanonical],
  canonicalOrders: [],
  legacyOrders: [],
  mappings: [mapping],
})
assert.equal(canonicalConflict.listings[0].classification, "MAPPED_IMMUTABLE_CONFLICT")

const duplicateOrders = reconcileSnapshot({
  legacyListings: [legacy1],
  canonicalAuctions: [canonical1],
  legacyOrders: [{ id: "o", listingId: legacy1.id, type: "AUCTION", amount: 12500 }],
  canonicalOrders: [
    { id: 1, auction_id: 101, final_price: 12500 },
    { id: 2, auction_id: 101, final_price: 12500 },
  ],
  mappings: [mapping],
})
assert.equal(duplicateOrders.orders[0].classification, "CANONICAL_ORDER_DUPLICATE")

const amountConflict = reconcileSnapshot({
  legacyListings: [legacy1],
  canonicalAuctions: [canonical1],
  legacyOrders: [{ id: "o", listingId: legacy1.id, type: "AUCTION", amount: 12000 }],
  canonicalOrders: [{ id: 1, auction_id: 101, final_price: 12500 }],
  mappings: [mapping],
})
assert.equal(amountConflict.orders[0].classification, "ORDER_AMOUNT_CONFLICT")

// Source-level programme invariants.
const scheduler = fs.readFileSync("src/lib/server/scheduler.ts", "utf8")
assert.match(scheduler, /PRISMA_AUCTION_SCHEDULER_PERMANENTLY_DISABLED = true/)
const tickStart = scheduler.indexOf("export async function tick()")
const tickEnd = scheduler.indexOf("export function startScheduler()", tickStart)
assert.ok(tickStart >= 0 && tickEnd > tickStart)
assert.doesNotMatch(scheduler.slice(tickStart, tickEnd), /endExpiredAuctions\(/)

const buyNow = fs.readFileSync("src/app/api/listings/[id]/buy/route.ts", "utf8")
assert.match(buyNow, /listing\.type !== "BUY_NOW"/)
assert.match(buyNow, /db\.\$transaction/)
assert.match(buyNow, /type: "BUY_NOW"/)

const legacyBid = fs.readFileSync("src/app/api/listings/[id]/bid/route.ts", "utf8")
assert.match(legacyBid, /resolveLegacyAuction/)
assert.match(legacyBid, /canonicalRpcEvent/)
assert.doesNotMatch(legacyBid, /db\.bid\.(create|update|delete|upsert)/)

for (const path of [
  "src/app/api/listings/route.ts",
  "src/app/api/listings/[id]/route.ts",
  "src/app/api/admin/listings/route.ts",
  "src/app/api/v1/listings/route.ts",
  "src/app/api/v1/listings/[id]/route.ts",
]) {
  const src = fs.readFileSync(path, "utf8")
  assert.match(src, /resolveLegacyAuction/)
  assert.match(src, /auctionAuthority/)
}

const config = fs.readFileSync("mini-services/trailbase-db/traildepot/config.textproto", "utf8")
assert.match(config, /name: "legacy_auction_mappings"/)
const configStart = config.indexOf('name: "legacy_auction_mappings"')
const configEnd = config.indexOf("\n  },\n  {", configStart)
assert.ok(configStart >= 0 && configEnd > configStart, "legacy mapping collection block must be bounded")
const configBlock = config.slice(configStart, configEnd)
assert.match(configBlock, /acl_authenticated: \[READ\]/)
assert.doesNotMatch(configBlock, /acl_authenticated: \[[^\]]*(CREATE|UPDATE|DELETE)/)

const reconcileCli = fs.readFileSync("scripts/reconcile-prisma-auctions.mjs", "utf8")
assert.match(reconcileCli, /mode: "DRY_RUN"|reconcileSnapshot/)
assert.match(reconcileCli, /--apply is forbidden/)
assert.doesNotMatch(reconcileCli, /\.create\(|\.update\(|\.delete\(|\.upsert\(/)

const inventory = inventoryPrismaAuctionConsumers()
assert.ok(inventory.length >= 10, "expected broad Prisma listing/bid/order consumer inventory")
assert.ok(inventory.some((r) => r.file.endsWith("src/app/api/listings/route.ts")))
assert.ok(inventory.some((r) => r.file.endsWith("src/lib/server/scheduler.ts")))
assert.ok(inventory.some((r) => r.file.endsWith("src/app/api/orders/route.ts")))

console.log("IMP-03 Prisma auction convergence: PASS")
console.log(JSON.stringify({
  consumerCount: inventory.length,
  consumers: inventory,
  listingClassifications: report.summary.listingClassifications,
  orderClassifications: report.summary.orderClassifications,
}, null, 2))
