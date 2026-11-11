# TengaSell `SEC-02` — Persistent Bid Idempotency Migration & Deployment Approval Packet

**Status:** **`UNAPPLIED / APPROVAL PACKET ONLY`**  
**Constraint Notice:** Per `TENGASELL-SEC-01` remediation boundaries, NO database schema migrations have been executed against `deploy/seed/trailbase-main.db`, local depots, or production `tengasell_data`. This document packages the reviewed additive schema change and rollout plan for explicit production operator approval after `PR #12` merges.

---

## 1. Objective

`PR #12` (`TENGASELL-SEC-01`) implements bounded in-memory `clientRequestId` idempotency and uncertain-commit reconciliation in `mini-services/trade-engine/bidding.ts`, plus structural partial-retry protection during normal retries.  
However, if `trade-engine` restarts *between* an ambiguous TrailBase HTTP `502`/reset on `POST /api/records/v1/bids` and the client's retry with the same `clientRequestId`, in-memory tracking alone cannot correlate the retry back to the persisted `bids` row across process restarts.

Persisting `client_request_id` directly on `bids` with a unique partial index closes that cross-restart/multi-worker window permanently.

---

## 2. Additive TrailBase SQLite Migration (Proposed — Do Not Auto-Apply)

Target database: TrailBase `main.db` (`mini-services/trailbase-db/traildepot/migrations/` or supervised production migration window).

```sql
-- Migration: 00XX_add_bids_client_request_id.sql
-- Safe additive migration for TrailBase SQLite >= 3.35

ALTER TABLE bids ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_auction_user_reqid
  ON bids (auction_id, user, client_request_id)
  WHERE client_request_id IS NOT NULL;
```

### Properties
- **Backwards-compatible:** Nullable `TEXT` column allows existing legacy rows and non-keyed callers (`client_request_id IS NULL`) without breaking inserts.
- **Duplicate-safe:** Unique partial index `(auction_id, user, client_request_id)` guarantees SQLite-enforced uniqueness even if two workers or restarted processes race with the same `clientRequestId`.
- **Reconciliation lookup:** Enables `listBids(auctionId)` or direct filtered query `filter[client_request_id][$eq]=...` in `BidService` after a restart to locate the exact committed row deterministically.

---

## 3. Supervised Rollout & Rollback Sequence

1. **Snapshot / Backup First:**
   ```bash
   fly ssh console -a tengasell-zw -C "sqlite3 /data/traildepot/data/main.db \".backup '/data/backups/main-pre-sec02-$(date +%Y%m%d%H%M%S).db'\""
   ```
2. **Pre-Flight Check:** Confirm zero existing column name collisions (`PRAGMA table_info(bids);`).
3. **Apply Additive DDL** during maintenance or rolling window while `PR #12` code tolerates `client_request_id` absence/presence cleanly.
4. **Post-Flight Verification:**
   ```sql
   PRAGMA table_info(bids);
   SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'bids';
   ```
5. **Follow-up Application Wiring (`SEC-02b`):** Once column + unique index are verified present in staging and production `main.db`, enable `client_request_id` persistence in `createBid(...)` and `clientRequestId` row matching inside `BidService.tryReconcileUncertain(...)`.
6. **Rollback Plan:**
   ```sql
   DROP INDEX IF EXISTS idx_bids_auction_user_reqid;
   -- Column drop only if required (additive nullable column causes zero harm if retained):
   -- ALTER TABLE bids DROP COLUMN client_request_id;
   ```
