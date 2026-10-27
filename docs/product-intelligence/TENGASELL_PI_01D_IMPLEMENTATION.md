# TENGASELL-PI-01D — Vehicle Product Intelligence implementation record

## Custody

- Accepted implementation parent: `bbd6ea033a8261b47fa48ea9379f3baa7e8d4fd1`
- Remote reconstruction ancestor: `3e4c0359bef6fc43c851e79ba7e0a43589d557e6`
- Implementation branch: `feat/tengasell-pi-01d-vehicle-product-intelligence`
- Authority/schema checkpoint: `2a9fac4` (`VEH-01` through `VEH-07`)
- Final candidate: the descendant commit containing this record; use `git rev-parse HEAD` in the controlled checkout.
- No merge, push, Fly mutation, Production deployment, or remote database mutation was performed.
- The pre-existing local-only `scripts/gateway.mjs` worktree change was preserved and excluded from PI commits.

## Migration custody

The accepted local parent already contained `U1000000016__cert01_legal_cooling_off_gate.sql`; therefore the PI-01C proposed U16 start was occupied. PI-01D uses the next safe contiguous sequence:

| PI migration | Repository migration | Purpose |
|---|---|---|
| Proposed U16 | U1000000017 | category hierarchy and immutable schema versions |
| Proposed U17 | U1000000018 | typed attribute registry and category applicability |
| Proposed U18 | U1000000019 | immutable facts, provenance, effective source and visibility policy |
| Proposed U19 | U1000000020 | nullable vehicle specification and governed vocabularies |
| Proposed U20 | U1000000021 | structured history, modifications and equipment |
| Proposed U21 | U1000000022 | document artefact and specific fact convergence |
| Proposed U22 | U1000000023 | atomic resumable intake and privacy-safe buyer projections |

The migrations pass blank U1→U23 installation and U1–U6→U23 upgrade tests. A real disposable U16 database exposed historic JSON `null` evidence during U19 conversion; the final migration explicitly excludes JSON-null values instead of inventing a fact. The same database then upgraded through U23.

## Implementation packets

### VEH-01 — PI schema foundation

- Extended the existing `categories` authority with stable keys, parent hierarchy, `GROUP`/`LEAF`, active state, legacy slug and timestamps.
- Seeded the accepted Vehicles & Mobility hierarchy and broad non-vehicle framework.
- Added localized category labels and immutable category-schema versions.
- Bound canonical auctions with `product_category_id` and `product_schema_version_id` while retaining legacy category and asset-kind fields.
- Added typed definitions, immutable definition versions, localized labels, governed options/aliases, category applicability and stage-specific requiredness.
- Added immutable assertions/links, deterministic effective facts, source policies and visibility rules.

### VEH-02 — vehicle specification extension

- Added the accepted nullable identity, technical, physical, colour, engine/EV, origin, history and included-equipment fields to `vehicles`.
- Did not backfill guesses.
- Added governed vehicle vocabularies and converged them into the category-schema option authority while preserving legacy fuel/transmission/drivetrain mappings.

### VEH-03 — history, modifications and equipment

- Added structured `vehicle_history_events`, `vehicle_modifications` and `vehicle_equipment` authorities.
- Added seller-authorized service commands with validation and audit events.
- Material history/modification declarations append relevant PI facts; equipment records carry their own source actor without duplicating unrelated scalar facts.

### VEH-04 — provenance and effective values

- Seller intake updates canonical vehicle fields, preserves legacy evidence, appends immutable `SELLER_DECLARED` facts and recomputes effective facts.
- Inspection submission appends verified odometer, roadworthy and inspection-state facts; controlled review appends the grade fact.
- Resolution excludes rejected, expired and superseded assertions, then applies per-attribute trust policy.
- Equal-trust disagreement produces `PEER_CONFLICT` with no winner. Higher-trust disagreement preserves both assertions and produces `LOWER_TRUST_DISAGREEMENT`.
- The 87,000 km seller / 91,320 km inspection case is an explicit regression.

### VEH-05 — document and privacy convergence

- Extended vehicle documents with artefact requirement/state, document number, visibility policy, verified hash and historic-review flag.
- Required artefacts cannot become verified without stored evidence.
- Document-derived facts are explicit, attribute-specific verified assertions linked through `pi_document_fact_assertions`.
- Historic verified/no-storage records remain readable and are flagged for review.
- Added anonymous `product:public:get`, which reads only privacy-safe views and filtered effective facts.
- `vehicle:get` now requires authentication and seller, inspector, reviewer, admin or approved operational authority.
- Raw VIN, chassis, registration, engine number, document/storage references and personal identifiers are absent from anonymous projections.

### VEH-06 — dynamic resumable Seller Intake

- Added atomic `product:intake:open`: one command creates the auction draft, binds the governed leaf/schema and creates the intake session, or commits none.
- Added ten governed stages, resumable step records and optimistic revision checks.
- Added separate draft/publish/eligibility requiredness. Draft persistence does not imply publish completeness.
- Seller UI loads the active category schema, selects a governed vehicle leaf, exposes schema-requiredness, preserves explicit `UNKNOWN`, and persists all ten stages.
- Parts bind to `VEHICLE_PARTS_GENERAL`; whole vehicles remain subject to inspection/eligibility authority.

### VEH-07 — inspection projection

- Existing inspection, findings and eligibility tables remain authoritative.
- Added read-only projection for inspection status/grade, roadworthiness, inspection mileage, major/safety-critical defects and condition summaries.
- No duplicate editable inspection fields were introduced.

### VEH-08 — vehicle Item Page

- Added a privacy-safe Product Intelligence block above the fold.
- Added responsive Key Facts, Identity, Technical, Physical, Condition, History, Inspection, Documentation, Known Defects, Included Equipment, Provenance, Auction and Collection/Transport sections.
- Missing values render as `UNKNOWN`, `NOT PROVIDED` or `NOT APPLICABLE` according to context.
- Buyer provenance uses natural labels while retaining exact internal source classes.
- Seller/operational vehicle authority remains separate and is not called anonymously.

## Verification

Green PI-specific gates:

- `python3 tests/trailbase-migration-chain.py`
- `python3 tests/pi-01d-product-intelligence.py`
- `bun test mini-services/trade-engine/product-intelligence.test.ts mini-services/trade-engine/vehicle-authority.test.ts`
- `node tests/pi-01d-ui-contract.mjs`
- focused ESLint for all PI-01D changed source files
- `next build --webpack` production build

Green inherited gates:

- auction authority barrier
- transactional auction core/concurrency/finalization/outbox
- Prisma auction convergence/read-only boundary
- vehicle and Tengasell Inspection authority
- AuctionEvent/LiveSession/Run List
- bidder qualification and capacity
- settlement, Finance callback, transfer, release, transport and handover
- operational grants/tasks/timeline
- Zimbabwe policy/Production fail-closed gates
- commercial lifecycle UI contract
- CERT-01-PREP end-to-end commercial journey

Direct repository-wide `tsc --noEmit` remains red on the accepted parent's pre-existing API route typing backlog. A filtered TypeScript run contains no PI-01D changed-file errors, and the production Webpack build succeeds. The default Turbopack build cannot bind its local CSS worker port in the controlled executor, so the supported Webpack fallback was used.

## Local runtime

- Disposable runtime root: `/private/tmp/tengasell-local01`
- Disposable TrailBase database: `/private/tmp/tengasell-local01/traildepot/data/main.db`
- Applied tip: U1000000023
- Services: TrailBase 3001, trade engine 3002, GIS 3004, Comms 3005, Finance 3006, Trust 3007, Govern 3008, Next.js 13000, restricted gateway 18081.
- Only the gateway is exposed through the free Quick Tunnel.
- Local external-provider behavior remains simulation; this is not payment, statutory transfer, communications-provider or Production certification.

Physical desktop/mobile browser evidence is not included in the candidate because the configured browser-automation runner stopped at its one-time browser/extension/trust-mode setup gate. No screenshot or browser PASS is inferred from source tests.

## Explicitly deferred to PI-01E

- full structured discovery/search indexing
- category-generated Browse filters
- saved structured searches
- comparison UI

The projection outbox provides the indexing seam; it is not a second product authority.
