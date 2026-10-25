-- TENGASELL-AUCTION-IMP-03 — Prisma AUCTION convergence registry.
-- This does not move commercial authority back to Prisma. It stores only
-- verified legacy -> canonical identity evidence inside canonical TrailBase.

CREATE TABLE IF NOT EXISTS legacy_auction_mappings (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_listing_id      TEXT NOT NULL UNIQUE,
  canonical_auction_id   INTEGER NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'VERIFIED'
                         CHECK (status IN ('VERIFIED','CONFLICT','RETIRED')),
  classification         TEXT NOT NULL DEFAULT 'EXPLICIT_VERIFIED_MAPPING',
  legacy_fingerprint     TEXT NOT NULL,
  canonical_fingerprint  TEXT NOT NULL,
  evidence_json          TEXT NOT NULL DEFAULT '{}',
  verified_by            TEXT NOT NULL,
  verified_at            TEXT NOT NULL,
  updated_at             TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_legacy_auction_mappings_status
  ON legacy_auction_mappings (status, legacy_listing_id);
