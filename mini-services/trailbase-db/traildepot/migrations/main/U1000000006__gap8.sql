-- Gap-8 completion features (UAT round 2026-10-20):
--   · Best-Offer/haggle  → offers table + auctions.allow_offers/offer_min
--   · Saved searches     → saved_searches table (user-owned, alerts high-water mark)
--   · Live-room auctions → live_sessions table + auctions.live_session_id
--   · Bid retraction     → bids.retracted_at/retraction_reason metadata

ALTER TABLE auctions ADD COLUMN allow_offers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auctions ADD COLUMN offer_min REAL;
ALTER TABLE auctions ADD COLUMN live_session_id INTEGER;

ALTER TABLE bids ADD COLUMN retracted_at TEXT;
ALTER TABLE bids ADD COLUMN retraction_reason TEXT;

CREATE TABLE IF NOT EXISTS offers (
  id              INTEGER PRIMARY KEY,
  auction_id      INTEGER NOT NULL,
  buyer_user      BLOB NOT NULL,
  buyer_username  TEXT NOT NULL,
  amount          REAL NOT NULL,
  message         TEXT,
  -- pending | countered | accepted | declined | expired | withdrawn
  status          TEXT NOT NULL DEFAULT 'pending',
  counter_amount  REAL,
  counter_message TEXT,
  responded_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS saved_searches (
  id           INTEGER PRIMARY KEY,
  user         BLOB NOT NULL,
  name         TEXT NOT NULL,
  query        TEXT,
  category     TEXT,
  min_price    REAL,
  max_price    REAL,
  alerts       INTEGER NOT NULL DEFAULT 1,
  last_seen_id INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS live_sessions (
  id              INTEGER PRIMARY KEY,
  host_user       BLOB NOT NULL,
  host_username   TEXT NOT NULL,
  title           TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,
  -- scheduled | live | closed
  status          TEXT NOT NULL DEFAULT 'scheduled',
  current_lot_id  INTEGER,
  lot_index       INTEGER NOT NULL DEFAULT 0,
  -- going-going-sold hammer clock: each accepted bid pushes close_at out 20s;
  -- the engine sweep sells the lot to the high bidder when it elapses.
  close_at        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_offers_auction ON offers (auction_id, status);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches (user, alerts);
CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_auctions_room ON auctions (live_session_id);
