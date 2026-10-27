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
bun test v1.3.14 (0d9b296a)

mini-services/trade-engine/discovery.test.ts:
✓ category filter metadata enforces category isolation [8.93ms]
✓ comparison handles same leaf, related leaves, and unrelated categories [5.32ms]
✓ comparison truthful states and privacy protection [0.38ms]
✓ search index rebuild is non-authoritative and non-destructive [3.47ms]

 4 pass
 0 fail
 29 expect() calls
Ran 4 tests across 1 file. [101.00ms]
PI-01E structured discovery UI contract & interaction proof: PASS
  condition vocabulary convergence ('fair'): PASS
  category-aware primary, secondary, and advanced filters: PASS
  URL filter persistence and active chips: PASS
  product comparison matrix (max 3 items) with truthful states: PASS
  PI privacy protection in search and comparison: PASS
  structured saved search facets and deep linking: PASS
  vehicle discovery badges and compare selection: PASS
```

### Full Regression Proofs
- `npm run test:trailbase-migrations`: PASS (25 migrations verified)
- `npm run test:pi-01d`: PASS (PI-01D authority and UI contracts pass)
- `npm run test:auction-authority`: PASS
- `npm run test:commercial-ui`: PASS
- `npm run test:vehicle-intelligence`: PASS
- `npm run test:auction-core`: PASS
- `npm run test:auction-convergence`: PASS
- `npm run test:auction-events`: PASS
- `npm run test:bidder-qualification`: PASS
- `npm run test:auction-settlement`: PASS
- `npm run test:auction-operations`: PASS
- `npm run test:auction-policy`: PASS
- `npm run test:cert01-prep`: PASS
- `npm run build`: PASS (Turbopack production build succeeds with all dynamic routes)

---

## 5. Deferred Scope

The following items remain outside PI-01E scope and are appropriately deferred:
- Geographic bounding-box or radial distance filtering (falls under future GIS/Spatial discovery).
- Machine-learning vector semantic search / visual search (reserved for post-PI search enhancements).
- Multi-currency client currency converter preferences (commercial currency remains canonically USD).
