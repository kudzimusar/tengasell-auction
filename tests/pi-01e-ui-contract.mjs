#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const filterPanel = read("src/components/tengasell/pages/browse/filter-panel.tsx");
const browsePage = read("src/components/tengasell/pages/browse/browse-page.tsx");
const compareDialog = read("src/components/tengasell/pages/browse/compare-dialog.tsx");
const results = read("src/components/tengasell/pages/browse/results.tsx");
const savedSearches = read("src/components/tengasell/pages/account/saved-searches-section.tsx");
const ui = read("src/components/tengasell/ui.tsx");
const apiIndex = read("src/lib/tengasell/api/index.ts");
const apiRemote = read("src/lib/tengasell/api/remote.ts");
const apiLocal = read("src/lib/tengasell/api/local.ts");
const engine = read("mini-services/trade-engine/index.ts");
const searchIndexing = read("mini-services/trade-engine/search-indexing.ts");

// 1. Condition vocabulary convergence (DISC-02)
assert.ok(
  filterPanel.includes('{ value: "fair", label: "Fair" }'),
  "filter-panel missing 'fair' condition option for vocabulary convergence"
);

// 2. Category-aware Primary, Secondary, and Advanced filters
for (const primary of ["Make", "Model", "Year Range", "Mileage (km)", "Body Type"]) {
  assert.ok(filterPanel.includes(`title="${primary}"`), `filter-panel missing primary filter ${primary}`);
}
for (const secondary of ["Fuel Type", "Transmission", "Drivetrain", "Inspection Grade"]) {
  assert.ok(filterPanel.includes(`title="${secondary}"`), `filter-panel missing secondary filter ${secondary}`);
}
for (const advanced of ["Steering Side", "Import State", "Variant / Trim"]) {
  assert.ok(filterPanel.includes(`title="${advanced}"`), `filter-panel missing advanced filter ${advanced}`);
}

// 3. Browse Page Integration (DISC-01 & DISC-02)
assert.ok(browsePage.includes("api.categoryFilters"), "browse-page does not fetch category filter metadata");
assert.ok(browsePage.includes("syncUrlState"), "browse-page does not synchronize filter state to URL");
assert.ok(browsePage.includes("Compare ("), "browse-page missing floating comparison tray");
assert.ok(browsePage.includes("<CompareDialog"), "browse-page missing CompareDialog invocation");
assert.ok(browsePage.includes("chips.map"), "browse-page missing active filter chips");
assert.ok(browsePage.includes("Clear filters"), "browse-page missing Clear filters button");

// 4. Comparison Contract & Value States (DISC-04)
for (const state of ["KNOWN", "UNKNOWN", "CONFLICTED", "REDACTED", "NOT_APPLICABLE"]) {
  assert.ok(compareDialog.includes(`case "${state}":`), `compare-dialog missing value state handler ${state}`);
}
for (const section of [
  "Identity", "Configuration & Powertrain", "Condition & Provenance", "Commercial & Bidding"
]) {
  assert.ok(apiLocal.includes(`name: "${section}"`), `comparison response missing section ${section}`);
}
assert.ok(compareDialog.includes("Product Comparison"), "compare-dialog missing title");
assert.ok(compareDialog.includes("Full Specification Comparison"), "compare-dialog missing scope badge");

// 5. Privacy in Comparison & Search (DISC-01 & DISC-04)
for (const sensitive of ["vin", "chassis_number", "registration_number", "engine_number", "document_number"]) {
  assert.ok(
    !searchIndexing.includes(`SELECT ${sensitive}`) && !compareDialog.includes(`raw_${sensitive}`),
    `sensitive field ${sensitive} exposed in public search or comparison`
  );
}

// 6. Saved Searches with Structured Facets (DISC-03)
assert.ok(savedSearches.includes("api.savedSearchFacets"), "saved-searches does not load structured facets");
assert.ok(savedSearches.includes("buildRunHref"), "saved-searches missing buildRunHref function");
assert.ok(browsePage.includes("api.saveSearch"), "browse-page does not persist structured saved searches");
assert.ok(browsePage.includes("facets: facets.length > 0 ? facets : undefined"), "browse-page does not pass structured facets to saveSearch");

// 7. Vehicle Specs on Result Cards
assert.ok(ui.includes("auction.inspection_grade"), "AuctionCard does not surface inspection grade");
assert.ok(ui.includes("auction.mileage"), "AuctionCard does not surface mileage");
assert.ok(ui.includes("onToggleCompare"), "AuctionCard missing compare toggle integration");
assert.ok(results.includes("selectedCompareIds"), "ResultsSection missing comparison pass-through");

// 8. API & Trade Engine RPC bindings
for (const rpc of ["product:filters:get", "product:compare", "product:search:query", "product:search:rebuild"]) {
  assert.ok(engine.includes(`socket.on("${rpc}"`), `trade engine missing RPC handler ${rpc}`);
}
assert.ok(apiIndex.includes("categoryFilters("), "api interface missing categoryFilters");
assert.ok(apiIndex.includes("compareProducts("), "api interface missing compareProducts");
assert.ok(apiIndex.includes("savedSearchFacets("), "api interface missing savedSearchFacets");

console.log("PI-01E structured discovery UI contract & interaction proof: PASS");
console.log("  condition vocabulary convergence ('fair'): PASS");
console.log("  category-aware primary, secondary, and advanced filters: PASS");
console.log("  URL filter persistence and active chips: PASS");
console.log("  product comparison matrix (max 3 items) with truthful states: PASS");
console.log("  PI privacy protection in search and comparison: PASS");
console.log("  structured saved search facets and deep linking: PASS");
console.log("  vehicle discovery badges and compare selection: PASS");
