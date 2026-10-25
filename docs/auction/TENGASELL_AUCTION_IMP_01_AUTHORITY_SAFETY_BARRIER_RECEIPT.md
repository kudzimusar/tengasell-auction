# TENGASELL-AUCTION-IMP-01 — Auction Authority Safety Barrier Receipt

**Programme:** TENGASELL-AUCTION-01  
**Unit:** TENGASELL-AUCTION-IMP-01  
**Parent:** `98a607c326ca4bcf24062c045d4eaa35762a3aa5`  
**Branch:** `feat/tengasell-auction-imp01-authority-safety-barrier`  
**Canonical commercial auction authority:** `TrailBase + Socket.IO trade-engine`  
**Product SHA:** recorded in the PR description and Moderator return because a Git commit cannot embed its own final SHA.  
**Database migrations:** `NONE`  
**Database mutation during implementation:** `NONE`  
**Deployment:** `NONE`

## Disposition implemented

From this unit onward, Prisma AUCTION is a legacy/read compatibility authority only. It cannot create new auction listings, accept auction bids, transition auction state through the Prisma moderation endpoint, select winners, mark Prisma auctions sold, or create auction orders through the Next scheduler.

Prisma `BUY_NOW` remains supported. Governed `/api/v1/listings` reads remain supported. The canonical Tengasell auction UI continues to use `RemoteApi -> Socket.IO trade-engine` for live commercial mutations.

## Changed product seams

| Seam | IMP-01 state | Classification |
|---|---|---|
| `POST /api/listings` with `type=AUCTION` | 409 fail-closed, code `AUCTION_AUTHORITY_MOVED` | BLOCK_NOW |
| `POST /api/listings` with `type=BUY_NOW` | existing creation path retained | NON_AUCTION |
| `POST /api/listings/[id]/bid` for Prisma AUCTION | 409 fail-closed, no bid/price writes | BLOCK_NOW |
| `POST /api/admin/listings/[id]/action` for Prisma AUCTION | fail-closed before status mutation | BLOCK_NOW |
| `endExpiredAuctions()` | non-mutating suppression result | BLOCK_NOW |
| `/api/v1/listings*` | GET-only compatibility retained | READ_ONLY |
| LocalStore fallback after backend failure | `degraded`; commercial mutations rejected | BLOCK_NOW |
| Static Pages demo | explicit `NEXT_PUBLIC_TENGASELL_EXPLICIT_DEMO=1`; mutable demo retained | SAFE_NONCOMMERCIAL |
| TrailBase/RemoteApi/trade-engine | unchanged | CANONICAL |

## Write-authority inventory

The repository-wide source tree was enumerated at the frozen parent. Auction-relevant Prisma write surfaces found in the active API/scheduler plane were:

1. `src/app/api/listings/route.ts` — Prisma Listing creation. **BLOCK_NOW for AUCTION; BUY_NOW preserved.**
2. `src/app/api/listings/[id]/bid/route.ts` — Prisma Bid/currentPrice authority. **BLOCK_NOW.**
3. `src/lib/server/scheduler.ts::endExpiredAuctions` — winner/SOLD/Order/notification authority. **BLOCK_NOW.**
4. `src/app/api/admin/listings/[id]/action/route.ts` — moderation could activate/reinstate/end Prisma AUCTION rows. **BLOCK_NOW for AUCTION.**
5. `src/app/api/listings/[id]/buy/route.ts` — BUY_NOW only. **NON_AUCTION; preserved.**
6. `src/app/api/admin/orders*` — inspect-only admin order surfaces. **READ_ONLY.**
7. `src/app/api/v1/listings*` — governed GET compatibility. **READ_ONLY.**
8. Existing Prisma AUCTION records — **LEGACY_AUCTION_RECORD / PENDING_RECONCILIATION**; no destructive mutation in IMP-01.

## Demo safety

The client API mode now distinguishes:

- `live`: canonical remote records and trade-engine path.
- `demo`: only when the build explicitly sets `NEXT_PUBLIC_TENGASELL_EXPLICIT_DEMO=1`.
- `degraded`: canonical backend unavailable in a production-capable build.

In `degraded` mode, browsing may use LocalStore as a read fallback, but commercial mutations reject with `AUCTION_SERVICE_UNAVAILABLE`. LocalStore's auction-ending sweep executes only in explicit `demo` mode. A global banner states that browsing is read-only while the canonical auction service is unavailable.

## Evidence

| ID | Claim | Source / proof |
|---|---|---|
| AUC-IMP01-EV-0001 | Frozen parent equals live main at dispatch | GitHub compare: identical, ahead 0, behind 0 |
| AUC-IMP01-EV-0002 | Branch created from exact frozen parent | GitHub branch creation |
| AUC-IMP01-EV-0003 | Prisma AUCTION creation blocked before `db.listing.create` | `src/app/api/listings/route.ts` |
| AUC-IMP01-EV-0004 | Prisma BUY_NOW creation code preserved | same route + contract gate |
| AUC-IMP01-EV-0005 | Prisma bid endpoint contains no bid transaction/write | `src/app/api/listings/[id]/bid/route.ts` |
| AUC-IMP01-EV-0006 | Prisma AUCTION admin state writes blocked | admin listing action route |
| AUC-IMP01-EV-0007 | Prisma scheduler auction close path non-mutating | `endExpiredAuctions()` |
| AUC-IMP01-EV-0008 | Non-auction scheduler jobs remain in `tick()` | scheduler source |
| AUC-IMP01-EV-0009 | Developer listing APIs remain GET-only | `src/app/api/v1/listings*` |
| AUC-IMP01-EV-0010 | Explicit demo and degraded fallback are distinct | `src/lib/tengasell/api/index.ts` |
| AUC-IMP01-EV-0011 | Commercial LocalStore mutations blocked in degraded mode | shared authority policy + API proxy |
| AUC-IMP01-EV-0012 | LocalStore sweep only runs in explicit demo | `demoSweep()` |
| AUC-IMP01-EV-0013 | Static demo explicitly opts in | `scripts/build-static-demo.mjs` |
| AUC-IMP01-EV-0014 | No schema or migration file changed | PR changed-file inventory |
| AUC-IMP01-EV-0015 | Executable authority contract added | `tests/auction-authority-barrier.mjs` |
| AUC-IMP01-EV-0016 | CI runs authority contract before production build | `.github/workflows/ci.yml` |

**Evidence range:** `AUC-IMP01-EV-0001` — `AUC-IMP01-EV-0016`.

## IMP-02 handoff — proven seams, not implemented here

The following canonical defects remain deliberately untouched for `TENGASELL-AUCTION-IMP-02`:

- `mini-services/trade-engine/index.ts::placeBid` performs read-then-multiple-write proxy bidding without a certified atomic/CAS transaction.
- `sellAuctionTo`, `sweepAuctions`, live-room hammer close, and offer acceptance still represent multiple sale/finalization entry paths.
- canonical orders do not yet have the certified `FINAL SOLD OUTCOME -> CREATE_ORDER_ONCE` idempotent transaction.
- durable outbox/domain event persistence, restart recovery, auction/lot versions and equal-max concurrent ordering remain IMP-02 work.

Do not reopen the IMP-01 authority decision during IMP-02.
