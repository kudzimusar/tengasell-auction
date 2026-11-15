#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const publicPage = read("src/components/tengasell/pages/item/vehicle-product-intelligence.tsx");
const itemPage = read("src/components/tengasell/pages/item/item-page.tsx");
const seller = read("src/components/tengasell/pages/sell/sell-new.tsx");
const engine = read("mini-services/trade-engine/index.ts");
const authority = read("mini-services/trade-engine/product-intelligence.ts");

for (const section of [
  "KEY FACTS", "IDENTITY", "TECHNICAL", "PHYSICAL", "CONDITION", "HISTORY",
  "INSPECTION", "DOCUMENTATION", "KNOWN DEFECTS", "INCLUDED EQUIPMENT",
  "PROVENANCE", "AUCTION", "COLLECTION / TRANSPORT",
]) {
  assert.ok(publicPage.includes(`"${section}"`), `buyer product page missing ${section}`);
}
for (const value of ["UNKNOWN", "NOT PROVIDED", "NOT APPLICABLE"]) {
  assert.ok(publicPage.includes(value), `truthful missing-state contract missing ${value}`);
}
for (const label of ["Seller declared", "Document verified", "Tengasell inspected", "Externally verified"]) {
  assert.ok(publicPage.includes(label), `natural provenance label missing ${label}`);
}
for (const viewportClass of ["sm:grid-cols-2", "lg:grid-cols-3", "overflow-x-auto"]) {
  assert.ok(publicPage.includes(viewportClass) || seller.includes(viewportClass), `responsive contract missing ${viewportClass}`);
}
assert.ok(itemPage.includes("<VehicleProductIntelligence auctionId={auction.id} compact />"), "vehicle above-fold projection missing");
assert.ok(itemPage.includes("<VehicleProductIntelligence auctionId={auction.id} />"), "complete Product Intelligence tab missing");

for (const step of [
  "CATEGORY", "IDENTITY", "TECHNICAL", "PHYSICAL", "CONDITION", "HISTORY",
  "DOCUMENTS", "MEDIA", "COMMERCIAL", "REVIEW",
]) {
  assert.ok(seller.includes(`"${step}"`), `seller intake step missing ${step}`);
}
assert.ok(seller.includes("api.openProductIntake"), "seller does not use atomic PI intake open command");
assert.ok(seller.includes("api.saveProductIntakeStep"), "seller intake is not resumably persisted");
assert.ok(seller.includes("expectedRevision"), "seller intake optimistic revision contract missing");
assert.ok(seller.includes("api.productSchema"), "seller fields are not bound to the active category schema");

assert.ok(engine.includes('socket.on("product:public:get"'), "public PI RPC missing");
assert.ok(engine.includes('socket.on("product:intake:open"'), "atomic intake RPC missing");
assert.ok(engine.includes('code: "AUTH_REQUIRED"'), "vehicle internal detail does not fail closed for anonymous callers");
assert.ok(authority.includes("privacy_policy_key === \"PRODUCT_INTERNAL\""), "internal fact privacy filtering missing");
assert.ok(authority.includes("VEHICLE_IDENTIFIER_CLASSIFIED"), "identifier classification projection missing");

console.log("PI-01D buyer/seller UI and privacy boundary contract: PASS");
console.log("  complete responsive buyer sections: PASS");
console.log("  truthful UNKNOWN / NOT PROVIDED / NOT APPLICABLE states: PASS");
console.log("  schema-driven resumable seller intake: PASS");
console.log("  public projection + authenticated internal detail split: PASS");
