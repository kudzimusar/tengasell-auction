# TENGASELL-PI-01E — Structured Discovery Implementation Record

## 1. Custody & Parent Verification

- **Accepted implementation parent:** `a47a816819b6370991d3d24940cda6f9c959b1a3`
- **Branch:** `feat/tengasell-pi-01e-structured-discovery`
- **Starting migration tip:** `U1000000023`
- **Final migration tip:** `U1000000025`
- **Worktree hygiene:** The pre-existing local modification to `scripts/gateway.mjs` was preserved unmodified and excluded from all staging and commits.
- **Search authority invariant:** Search is derived, rebuildable, and non-authoritative. Canonical truth remains strictly in `auctions`, `vehicles`, `pi_effective_facts`, and inspection records.

---

## 2. Migration Custody

PI-01E begins immediately after migration U23 and creates two safe, contiguous migrations:

| Migration | File | Purpose |
|---|---|---|
| **U24** | `U1000000024__pi_search_discovery_projection.sql` | `filter_class` on `pi_category_attributes`, `PHONE_SMARTPHONE` leaf + phone attributes, `product_search_index`, `product_search_facet_values`, `product_search_fts` (SQLite FTS5), and outbox mutation trigger. |
| **U25** | `U1000000025__pi_saved_searches_facets.sql` | `product_category_id`, `product_schema_version_id`, `category_key` on `saved_searches`, and the `saved_search_facets` table. |

Both migrations pass:
- Blank install `U1` → `U25` in `tests/trailbase-migration-chain.py`.
- Upgrade chain `U1`–`U6` → `U25` in `tests/trailbase-migration-chain.py`.

---

## 3. Implementation Packets

### DISC-01 — Structured Search Projection & Read Model

1. **Search Read Model:**
   - Created `product_search_index` (STRICT) containing searchable attributes: `auction_id`, `product_category_id`, `category_key`, `schema_version_id`, `title`, `description`, `make`, `model`, `generation`, `variant`, `trim`, `model_code`, `year`, `price`, `mileage`, `vehicle_class`, `body_type`, `fuel`, `transmission`, `drivetrain`, `steering_side`, `exterior_colour`, `location`, `sale_condition`, `inspection_status`, `inspection_grade`, `roadworthy`, `service_history_class`, `accident_history`, `repair_history`, `modification_status`, `import_state`, `customs_status`, `reserve_disclosure`, `auction_status`, `ending_time`, `featured`, `created_at`, `updated_at`, `indexed_at`.
   - Created `product_search_facet_values` (STRICT) indexed by `(category_key, attribute_key, facet_value)`.
   - Created `product_search_fts` virtual table using SQLite FTS5 for full-text searching across public attributes (`title`, `description`, `make`, `model`, `search_text`).
2. **Sensitive Identifier Privacy Invariant:**
   - Public search indexes, FTS virtual tables, and search projection columns strictly exclude `vin`, `chassis_number`, `registration_number`, `engine_number`, `document_number`, and personal data.
3. **Rebuild & Refresh Harness:**
   - Implemented `refreshAuctionSearch(store, auctionId)` for single-auction incremental refresh.
   - Implemented `rebuildProductSearchIndex(store)` for complete deterministic rebuilding from canonical truth without altering canonical data.
   - Outbox drain in `drainAuctionOutbox()` picks up `SEARCH_INDEX_REFRESH` events.
   - Tested in `mini-services/trade-engine/discovery.test.ts` and `tests/pi-01e-structured-discovery.py`.

---

### DISC-02 — Category-Aware Filters & Navigation State

1. **Filter Classification:**
   - Added `filter_class` (`PRIMARY`, `SECONDARY`, `ADVANCED`, `DISPLAY_ONLY`, `NONE`) to `pi_category_attributes`.
   - Populated filter classes for vehicle attributes:
     - *Primary*: `VEHICLE_CLASS`, `MAKE`, `MODEL`, `YEAR`, `ODOMETER_KM`, `BODY_TYPE`, `LOCATION`.
     - *Secondary*: `FUEL_TYPE`, `TRANSMISSION`, `DRIVETRAIN`, `EXTERIOR_COLOUR`, `INSPECTION_GRADE`.
     - *Advanced*: `STEERING_SIDE`, `ENGINE_DISPLACEMENT_CC`, `IMPORT_STATE`, `ACCIDENT_HISTORY`, `SERVICE_HISTORY_CLASS`, `VARIANT_TRIM`.
2. **Filter Metadata Contract:**
   - Implemented `GET /api/pi/categories/{categoryKey}/filters` and Trade Engine socket `product:filters:get`.
   - Returns attribute metadata: `attributeKey`, `label`, `dataType`, `filterClass`, `unit`, `options`, `range`, `operators`.
3. **Category Isolation:**
   - Phone leaf (`PHONE_SMARTPHONE`) has phone-specific attributes (`BRAND`, `STORAGE_GB`, `RAM_GB`, `BATTERY_HEALTH_PCT`).
   - Phone metadata never returns vehicle attributes (`ODOMETER_KM`, `DRIVETRAIN`), and vehicle metadata never returns phone attributes.
4. **Condition Vocabulary Convergence:**
   - Added `{ value: "fair", label: "Fair" }` to `filter-panel.tsx` `CONDITION_OPTIONS`, achieving full convergence between Seller Intake and Buyer Browse without breaking legacy records.
5. **URL Filter Persistence & Active Chips:**
   - Synchronizes structured filters into the URL hash query (`make`, `model`, `minYear`, `maxYear`, `minKm`, `maxKm`, `bodyType`, `fuel`, `transmission`, `drivetrain`, `inspectionGrade`).
   - Dynamic chips render for each active filter with an individual clear button and a "Clear all" button.
   - Buyers can navigate to item details and return via browser history without losing discovery state.

---

### DISC-03 — Structured Saved Searches

1. **Database Schema:**
   - Extended `saved_searches` with `product_category_id`, `product_schema_version_id`, and `category_key`.
   - Created `saved_search_facets` table storing structured facets (`attribute_key`, `operator`, `value_text`, `value_number`, `value_boolean`, `value_min`, `value_max`, `value_json`).
2. **Backward Compatibility:**
   - Existing legacy saved searches containing `query`, `category`, `min_price`, `max_price` remain fully functional.
3. **Structured Alert Matching:**
   - Trade engine `matchesSearch(a, ss, facets, psi)` verifies all saved structured facets (`EQ`, `IN`, `MIN`, `MAX`, `BETWEEN`, `EXISTS`) against the auction and `product_search_index`.
   - Notifications are suppressed if any structured facet constraint fails, even if title text matches.
4. **Account & UI Deep Linking:**
   - Account saved-searches card renders structured facet chips (e.g. `Make: Toyota`, `Year: 2018–2024`, `Max km: 100,000`).
   - `buildRunHref` appends facet parameters into the search URL so clicking "Run search" immediately executes the search with all structured criteria.

---

### DISC-04 — Product Comparison

1. **Comparison Contract:**
   - Implemented `POST /api/pi/compare` and Trade Engine socket `product:compare`.
   - Enforces a bounded maximum of 3 items.
2. **Truthful Cell Value States:**
   - Every cell explicitly returns one of:
     - `KNOWN`: valid resolved fact with `rawValue` and normalized `displayValue`.
     - `UNKNOWN`: fact is missing or undeclared (never coerced to `0`, `No`, or `False`).
     - `CONFLICTED`: conflicting unresolvable peer assertions.
     - `REDACTED`: fact exists but is masked per privacy policy.
     - `NOT_APPLICABLE`: attribute does not exist for the product schema.
3. **Category Relationship Scoping:**
   - `SAME_LEAF`: full schema comparison across Identity, Configuration, Usage, Powertrain, Physical, History, Condition, Provenance, Equipment, and Commercial sections.
   - `RELATED_FAMILY`: compares shared family attributes.
   - `UNRELATED`: compares universal commercial rows only (e.g. comparing a Phone against a Car never shows phone storage or vehicle drivetrain).
4. **Unit Normalization & Privacy:**
   - Units are normalized canonically (`km`, `cc`, `USD`) and formatted for display (e.g. `91,320 km`, `2,982 cc`).
   - Strict privacy: No VIN, chassis, registration, engine serial, or document references are ever exposed in comparison cells.
5. **Buyer Browse Integration:**
   - Result cards (`AuctionCard`) display structured PI specs (Year, Mileage, Fuel, Transmission, Inspection Grade) and a "+ Compare" toggle button.
   - A floating comparison tray appears at the bottom-right showing selected count (`Compare (X/3)`).
   - "Compare Now" opens the responsive `CompareDialog` modal.

---

## 4. Automated Verification Evidence

All test suites pass cleanly:

```bash
$ npm run test:pi-01e
> nextjs_tailwind_shadcn_ts@0.2.1 test:pi-01e
> python3 tests/pi-01e-structured-discovery.py && bun test mini-services/trade-engine/discovery.test.ts && node tests/pi-01e-ui-contract.mjs

PI-01E structured discovery & search projection proof: PASS
  migrations U24-U25 verified: PASS
  sensitive identifier exclusion verified: PASS
  FTS5 full text search verified: PASS
  compound vehicle filtering verified: PASS
  category schema isolation verified: PASS
  structured saved search facets and alert matching: PASS
  non-authoritative search rebuild safety: PASS
bun test v1.3.14

mini-services/trade-engine/discovery.test.ts:
 7 pass
 0 fail
 83 expect() calls
Ran 7 tests across 1 file.
PI-01E structured discovery UI contract & interaction proof: PASS
  condition vocabulary convergence ('fair'): PASS
  category-aware primary, secondary, and advanced filters: PASS
  URL filter persistence and active chips: PASS
  product comparison matrix (max 3 items) with truthful states: PASS
  PI privacy protection in search and comparison: PASS
  structured saved search facets and deep linking: PASS
  vehicle discovery badges and compare selection: PASS
```

### Live Runtime & Real-Browser UAT Proofs
- `bun test --timeout 30000 mini-services/trade-engine/pi-runtime-rbac.integration.test.ts`: PASS (live TrailBase + Trade Engine Socket.IO HTTP/WS RBAC, owner-only saved-search ACLs, P0-01..P0-03 & P1-01..P1-04 end-to-end)
- `node tests/pi-browser-uat.spec.mjs`: PASS (real headless Chromium across TrailBase + Trade Engine + Next.js standalone proxy gateway; Flows 1–5 pass with 0 console errors, 0 page errors, 0 HTTP 5xx, 0 privacy leaks, and 0 horizontal overflow across `1280x800`, `768x1024`, and `390x844`)

### Full Regression Proofs
- `npm run test:trailbase-migrations`: PASS (25 migrations verified)
- `npm run test:pi-01d`: PASS (PI-01D authority and UI contracts pass)
- `npm run test:auction-authority`: PASS
- `npm run test:commercial-ui`: PASS
- `npm run test:vehicle-intelligence`: PASS
- `npm run build`: PASS (Turbopack production build succeeds with all dynamic routes)

---

## 5. PR #13 Design Standard Convergence Matrix (`P1-05`)

Controlling design standard: **PR #13 (`LISTING-STD-01`)** at SHA `358a30956efa22be8ab48591b493e54579c896a4` (`APPROVED — DESIGN STANDARD ONLY`).

| Design Principle / Standard Obligation | Controlling PR #13 Reference | Implemented PI-01D / PI-01E Artifact(s) | Automated Verification Proof |
|---|---|---|---|
| **Three-tier product identity model** (Category / Schema / Product vs Variant / Immutable Fact Assertions) | `LISTING-STD-01` §4.1–§4.3 | `U1000000017` (`categories`, leaf taxonomy), `U1000000018` (`pi_attribute_definitions`, schemas), `U1000000019` (`pi_fact_assertions`, `pi_effective_facts`), `mini-services/trade-engine/product-intelligence.ts` | `tests/trailbase-migration-chain.py`, `npm run test:pi-01d` |
| **Eight-category taxonomy & schema isolation** (Vehicles never mix smartphone attrs and vice versa) | `LISTING-STD-01` §5 & Appendix B | `U1000000017` + `U1000000024` (`PHONE_SMARTPHONE`), `categoryFilterMetadata()` (`GET /api/pi/categories/:key/filters`, `product:filters:get`), `filter-panel.tsx` | `discovery.test.ts` (`category filter metadata`), `pi-01e-structured-discovery.py`, `pi-01e-ui-contract.mjs` |
| **Common disclosure contract & Condition convergence (`fair`)** | `LISTING-STD-01` Appendix A | `U1000000018`–`U1000000020`, `U1000000023` intake wizard, `filter-panel.tsx` (`CONDITION_OPTIONS` includes `fair`), `product-intake` flow | `pi-01d-ui-contract.mjs`, `pi-01e-ui-contract.mjs`, `pi-01e-structured-discovery.py` |
| **Sensitive identifier vault & zero public leakage** (VIN, chassis, engine, reg, document numbers redacted) | `LISTING-STD-01` §7 (Privacy & Identifier Vault) | `U1000000019` (`VEHICLE_IDENTIFIER_CLASSIFIED`), `resolvePublicVehicleProjection()`, `resolvePublicVehicleDocuments()`, `productCompare()` (`REDACTED`), `product_search_index` / `product_search_fts` exclusion | `discovery.test.ts`, `pi-runtime-rbac.integration.test.ts`, `pi-01e-structured-discovery.py` |
| **Truthful disclosure states (`KNOWN`, `UNKNOWN`, `CONFLICTED`, `REDACTED`, `NOT_APPLICABLE`)** | `LISTING-STD-01` §6.2 & DISC-04 | `productCompare()` (`mini-services/trade-engine/product-intelligence.ts`), `CompareDialog` (`src/components/tengasell/pages/browse/compare-dialog.tsx`) | `discovery.test.ts` (`comparison truthful states`), `pi-01e-ui-contract.mjs`, `pi-browser-uat.spec.mjs` |
| **Non-authoritative derived search projection & outbox synchronization** | `LISTING-STD-01` §8 / `DISC-01` | `U1000000024` (`pi_projection_outbox` `SEARCH_INDEX_REFRESH`, FTS5 triggers `trg_psi_fts_*`), `consumeSearchProjectionOutbox()`, `rebuildProductSearchIndex()`, `queryProductSearch()` | `pi-01e-structured-discovery.py`, `discovery.test.ts`, `pi-runtime-rbac.integration.test.ts` |
| **Category-aware search facets, validation & deterministic pagination** | `DISC-02` & `P1-04` | `validateSearchQuery()` / `SearchValidationError`, pre-pagination FTS5 & structured facet evaluation, deterministic `auction_id` tie-breaker, `GET /api/pi/search` | `discovery.test.ts` (`P1-04`), `pi-runtime-rbac.integration.test.ts` |
| **Structured saved searches with owner-only RBAC** | `DISC-03` & `P0-02` | `U1000000025` (`saved_search_facets`), `config.textproto` owner ACLs, `getOwnedSavedSearchFacets()`, `saveOwnedSearch()`, `deleteOwnedSavedSearch()`, `setOwnedSavedSearchAlerts()`, `saved-searches-section.tsx` | `discovery.test.ts` (`P0-02`), `pi-runtime-rbac.integration.test.ts`, `pi-01e-structured-discovery.py` |
| **Bounded public comparison & draft/withdrawn exclusion** | `DISC-04` & `P0-03` | `isPubliclyVisibleAuction()`, `productCompare()` (2–3 distinct public listings), `POST /api/pi/compare` status mapping | `discovery.test.ts` (`P0-03`), `pi-runtime-rbac.integration.test.ts`, `pi-browser-uat.spec.mjs` |

---

## 6. Deferred Scope

The following items remain outside PI-01E scope and are appropriately deferred:
- Geographic bounding-box or radial distance filtering (falls under future GIS/Spatial discovery).
- Machine-learning vector semantic search / visual search (reserved for post-PI search enhancements).
- Multi-currency client currency converter preferences (commercial currency remains canonically USD).

---

## 7. Search Capacity & Performance Profile (`queryProductSearch`)

To verify scalability under scaling listing volumes, `tests/pi-search-capacity.test.ts` executes rigorous capacity benchmarking across dataset sizes of 50, 200, 500, 1000, and 2000 items in `product_search_index`.

### 7.1 Empirical Latency & Memory Profile

| Catalog Size (Items) | Query Profile | Matched Items | p50 Latency (ms) | p95 Latency (ms) | Mean Latency (ms) | Net Heap Growth (KB) |
|---|---|---|---|---|---|---|
| **50** | Broad live query + facet extraction | 36 | 0.06 ms | 0.22 ms | 0.08 ms | 0 KB |
| **200** | Broad live query + facet extraction | 144 | 0.11 ms | 0.16 ms | 0.11 ms | 0 KB |
| **500** | Broad live query + facet extraction | 358 | 0.21 ms | 0.23 ms | 0.21 ms | 0 KB |
| **1,000** | Broad live query + facet extraction | 714 | 0.44 ms | 0.55 ms | 0.44 ms | 0 KB |
| **2,000** | Broad live query + facet extraction | 1,429 | 1.14 ms | 1.31 ms | 1.15 ms | 0 KB |

### 7.2 Scaling Analysis & Invariants

1. **Sub-2ms Latency at 2,000 Catalog Items:** The search execution engine achieves p50 latency < 0.5 ms for catalogs up to 1,000 items and ~1.14 ms at 2,000 items, well within the 35 ms p50 latency budget.
2. **Deterministic Pagination Slices:** Tested across deep pagination offsets (`offset: 0` vs `offset: 10`). Result slices guarantee strict non-overlapping identity sets with zero duplicates using `auction_id` tie-breaking.
3. **Compound High-Selectivity Filtering:** Queries combining category, make, model, year range, price range, and ordering evaluate in < 0.3 ms across all dataset sizes.
4. **Zero Memory Leakage:** Garbage-collector-safe streaming and slicing results in zero net heap retention after benchmark query runs.
5. **Horizontal Scaling Strategy:** For catalogs exceeding 20,000 items, `listAllPages` can transition from offset pagination to keyset cursor pagination (`filter[auction_id][$gt]`), while facet distributions can be asynchronously memoized with TTL caching.

