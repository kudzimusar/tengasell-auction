# TENGASELL-AUCTION-IMP-05 — Event / Session / Run-List Foundation Receipt

**Programme:** TENGASELL-AUCTION-01  
**Unit:** TENGASELL-AUCTION-IMP-05  
**Long-run branch:** `feat/tengasell-auction-imp-lr01-core-vehicle-events`  
**Parent checkpoint:** `a93170bdfa872daf3a01e952f73d6c5f8e60df9c` (CHECKPOINT C / IMP-04)  
**Canonical commercial authority:** TrailBase + Socket.IO trade-engine  
**Deployment:** NONE  
**Staging/production mutation:** NONE  
**Multi-lane:** DEFERRED

## Product authority implemented

IMP-05 evolves the existing `LiveSession` rather than creating a second auction system.

- `AuctionEvent` owns one evolved `LiveSession`.
- `AuctionVenue` is optional.
- `AuctionLot` is explicit and carries durable `sequence_no`.
- `run_list_version` is the optimistic-concurrency authority.
- stale operators are rejected with `STALE_RUN_LIST_VERSION`.
- `run_list_locked` gates production structural changes and lot opening.
- current and next lots are persisted on both event/session read models.
- vehicle lots are refused unless the latest Tengasell eligibility decision is `ELIGIBLE`.
- withdrawal restores the underlying timed auction authority.
- hammer/pass continues through the IMP-02 unified finalization path before run-list `ADVANCE`.
- accepted run-list commands create audit records.
- event/operator writes are server mediated by the trade engine; direct browser writes remain forbidden.

## Product experiences

- `#/events` — Auction Hub with current/upcoming/recent events and a 14-day calendar.
- `#/events/{id}` — event detail and production Run List.
- `#/live/{sessionId}` — existing Live Room, now event-aware and linked back to the Run List.
- operator controls: add, ready, reorder, withdraw, lock/unlock, open, close event.
- event host may assign Auctioneer or Clerk roles.
- responsive cards/grids and >=44px principal controls are present on the new surfaces.
- explicit demo mode contains no fabricated event data.

## Cross-check remediation carried in Checkpoint D

The long-run fresh-install review found historical seed evidence with duplicate legacy `orders.auction_id` rows. A global unique index on `orders(auction_id)` would have made U1–U10 migration destructive/impossible.

IMP-02 is therefore corrected before merge:

- historical duplicate orders remain untouched with `auction_outcome_key IS NULL`;
- canonical auction outcomes write `auction_outcome_key='auction:<id>'`;
- a partial unique index applies only to non-null canonical outcome keys;
- `auction_outcomes.order_id` resolves by the canonical key;
- the real auction-core test now inserts duplicate legacy orders before applying U7;
- the full migration-chain test runs both blank U1→U10 and U1–U6→U10.

This preserves IMP-03 non-destructive reconciliation evidence while retaining `CREATE_ORDER_ONCE` for canonical outcomes.

## Executable evidence

| Evidence | Proof |
|---|---|
| AUC-IMP05-EV-0001 | U10 creates Event/Venue/Operator/Lot/Run-List authority and evolves LiveSession |
| AUC-IMP05-EV-0002 | SQLite event test proves Event→Session integrity |
| AUC-IMP05-EV-0003 | durable sequence/order and reorder behavior |
| AUC-IMP05-EV-0004 | run-list lock + version behavior |
| AUC-IMP05-EV-0005 | stale operator rejection |
| AUC-IMP05-EV-0006 | real concurrent same-version writers: one accepted, one stale |
| AUC-IMP05-EV-0007 | vehicle eligibility gate before run-list admission/readiness |
| AUC-IMP05-EV-0008 | current/next lot persistence |
| AUC-IMP05-EV-0009 | withdrawal and event close lifecycle |
| AUC-IMP05-EV-0010 | RBAC: unauthorised operator command rejected |
| AUC-IMP05-EV-0011 | accepted run-list command audit rows |
| AUC-IMP05-EV-0012 | Live Room hammer/pass finalizes before Event advance |
| AUC-IMP05-EV-0013 | Auction Hub / Calendar / Event / Run-List route integration |
| AUC-IMP05-EV-0014 | responsive/accessibility integration contract |
| AUC-IMP05-EV-0015 | blank fresh-install U1→U10 proof |
| AUC-IMP05-EV-0016 | U1–U6 parent→U10 proof with duplicate legacy order retention |
| AUC-IMP05-EV-0017 | canonical outcome-key `CREATE_ORDER_ONCE` proof |
| AUC-IMP05-EV-0018 | IMP-01/02/03/04 regression gates remain in CI |
| AUC-IMP05-EV-0019 | production Next build + standalone boot/smoke required by CI |
| AUC-IMP05-EV-0020 | canonical trade-engine compile required by CI |

**Evidence range:** `AUC-IMP05-EV-0001` — `AUC-IMP05-EV-0020`.

## IMP-01 invariants preserved

- Prisma AUCTION creation: BLOCKED.
- Prisma AUCTION direct bidding: BLOCKED.
- Prisma scheduler auction close: BLOCKED.
- Prisma AUCTION admin mutation: BLOCKED.
- Prisma BUY_NOW: PRESERVED.
- developer listing reads: PRESERVED.
- explicit demo: NON-COMMERCIAL ONLY.
- backend outage does not enable mutable demo fallback.
- TrailBase + trade-engine remains canonical.

No PR is merged by this checkpoint and no environment is deployed.
