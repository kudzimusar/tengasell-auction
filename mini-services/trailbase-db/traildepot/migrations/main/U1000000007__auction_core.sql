
ALTER TABLE auctions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auctions ADD COLUMN finalized_at TEXT;
ALTER TABLE auctions ADD COLUMN outcome TEXT;
ALTER TABLE auctions ADD COLUMN final_order_id INTEGER;

ALTER TABLE bids ADD COLUMN command_key TEXT;
ALTER TABLE bids ADD COLUMN sequence_no INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_auction_once ON orders (auction_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bids_command_key ON bids (command_key) WHERE command_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bids_active_per_auction ON bids (auction_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS auction_standing_bids (
  auction_id       INTEGER NOT NULL,
  user             BLOB NOT NULL,
  bidder_username  TEXT NOT NULL,
  max_amount       REAL NOT NULL CHECK (max_amount > 0),
  first_sequence   INTEGER NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (auction_id, user)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_standing_leader
  ON auction_standing_bids (auction_id, max_amount DESC, first_sequence ASC);

INSERT OR IGNORE INTO auction_standing_bids
  (auction_id,user,bidder_username,max_amount,first_sequence,updated_at)
SELECT auction_id,
       user,
       MAX(bidder_username),
       MAX(max_amount),
       MIN(id),
       MAX(created_at)
  FROM bids
 WHERE retracted_at IS NULL
 GROUP BY auction_id,user;

CREATE TABLE IF NOT EXISTS auction_commands (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key             TEXT NOT NULL UNIQUE,
  auction_id              INTEGER NOT NULL,
  actor_user              BLOB NOT NULL,
  actor_username          TEXT NOT NULL,
  actor_admin             INTEGER NOT NULL DEFAULT 0,
  command_type            TEXT NOT NULL DEFAULT 'PLACE_BID',
  max_amount              REAL,
  target_bid_id           INTEGER,
  reason                  TEXT,
  expected_version        INTEGER,
  status                  TEXT NOT NULL DEFAULT 'pending',
  error_code              TEXT,
  result_price            REAL,
  previous_winner_user    BLOB,
  previous_winner_username TEXT,
  result_winner_user      BLOB,
  result_winner_username  TEXT,
  version_before          INTEGER,
  version_after           INTEGER,
  received_at             TEXT NOT NULL DEFAULT '',
  completed_at            TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_commands_auction ON auction_commands (auction_id, id);

CREATE TABLE IF NOT EXISTS auction_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key     TEXT NOT NULL UNIQUE,
  auction_id    INTEGER NOT NULL,
  command_id    INTEGER,
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  occurred_at   TEXT NOT NULL,
  published_at  TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_outbox_pending ON auction_outbox (published_at, id);

CREATE TABLE IF NOT EXISTS auction_finalization_commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key       TEXT NOT NULL UNIQUE,
  auction_id        INTEGER NOT NULL,
  source            TEXT NOT NULL,
  requested_outcome TEXT NOT NULL DEFAULT 'AUTO',
  buyer_user        BLOB,
  buyer_username    TEXT,
  final_price       REAL,
  address           TEXT,
  expected_version  INTEGER,
  status            TEXT NOT NULL DEFAULT 'pending',
  error_code        TEXT,
  result_outcome    TEXT,
  result_order_id   INTEGER,
  result_price      REAL,
  version_before    INTEGER,
  version_after     INTEGER,
  received_at       TEXT NOT NULL DEFAULT '',
  completed_at      TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_outcomes (
  auction_id       INTEGER PRIMARY KEY,
  source           TEXT NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('sold','unsold')),
  winner_user      BLOB,
  winner_username  TEXT,
  final_price      REAL,
  order_id         INTEGER,
  command_id       INTEGER NOT NULL,
  decided_at       TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS trg_auction_place_bid_process
AFTER INSERT ON auction_commands
WHEN NEW.command_type='PLACE_BID'
BEGIN
  UPDATE auction_commands
     SET received_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         version_before = (SELECT version FROM auctions WHERE id = NEW.auction_id)
   WHERE id = NEW.id;

  UPDATE auction_commands SET status='rejected', error_code='AUCTION_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (SELECT 1 FROM auctions WHERE id=NEW.auction_id);

  UPDATE auction_commands SET status='rejected', error_code='AUCTION_NOT_LIVE'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (SELECT 1 FROM auctions WHERE id=NEW.auction_id AND status <> 'live');

  UPDATE auction_commands SET status='rejected', error_code='AUCTION_ENDED'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (
       SELECT 1 FROM auctions
        WHERE id=NEW.auction_id
          AND unixepoch(ends_at) <= unixepoch('now')
     );

  UPDATE auction_commands SET status='rejected', error_code='SELLER_CANNOT_BID'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (SELECT 1 FROM auctions WHERE id=NEW.auction_id AND user=NEW.actor_user);

  UPDATE auction_commands SET status='rejected', error_code='INVALID_MAX_AMOUNT'
   WHERE id=NEW.id AND status='pending'
     AND (NEW.max_amount IS NULL OR NEW.max_amount <= 0);

  UPDATE auction_commands SET status='rejected', error_code='STALE_AUCTION_VERSION'
   WHERE id=NEW.id AND status='pending'
     AND NEW.expected_version IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM auctions
        WHERE id=NEW.auction_id AND version <> NEW.expected_version
     );

  UPDATE auction_commands
     SET previous_winner_user=(
           SELECT user FROM auction_standing_bids
            WHERE auction_id=NEW.auction_id
            ORDER BY max_amount DESC, first_sequence ASC LIMIT 1
         ),
         previous_winner_username=(
           SELECT bidder_username FROM auction_standing_bids
            WHERE auction_id=NEW.auction_id
            ORDER BY max_amount DESC, first_sequence ASC LIMIT 1
         )
   WHERE id=NEW.id AND status='pending';

  UPDATE auction_commands SET status='rejected', error_code='MAX_NOT_RAISED'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (
       SELECT 1 FROM auction_standing_bids
        WHERE auction_id=NEW.auction_id
          AND user=NEW.actor_user
          AND NEW.max_amount <= max_amount
     );

  UPDATE auction_commands SET status='rejected', error_code='MAX_BELOW_OPENING'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (
       SELECT 1 FROM auction_standing_bids WHERE auction_id=NEW.auction_id
     )
     AND EXISTS (
       SELECT 1 FROM auctions
        WHERE id=NEW.auction_id AND NEW.max_amount < start_price
     );

  UPDATE auction_commands SET status='rejected', error_code='MAX_BELOW_MINIMUM'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (
       SELECT 1 FROM auction_standing_bids
        WHERE auction_id=NEW.auction_id AND user<>NEW.actor_user
     )
     AND NOT EXISTS (
       SELECT 1
         FROM auction_standing_bids s
        WHERE s.auction_id=NEW.auction_id
          AND s.user=NEW.actor_user
          AND s.first_sequence=(
            SELECT first_sequence
              FROM auction_standing_bids
             WHERE auction_id=NEW.auction_id
             ORDER BY max_amount DESC, first_sequence ASC
             LIMIT 1
          )
     )
     AND EXISTS (
       SELECT 1 FROM auctions a
        WHERE a.id=NEW.auction_id
          AND NEW.max_amount <
            a.current_price +
            CASE
              WHEN a.current_price < 50 THEN 1
              WHEN a.current_price < 500 THEN 2
              WHEN a.current_price < 1000 THEN 5
              WHEN a.current_price < 5000 THEN 10
              ELSE 25
            END
     );

  INSERT INTO auction_standing_bids
    (auction_id,user,bidder_username,max_amount,first_sequence,updated_at)
  SELECT NEW.auction_id, NEW.actor_user, NEW.actor_username, NEW.max_amount,
         NEW.id, strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_commands WHERE id=NEW.id)='pending'
  ON CONFLICT(auction_id,user) DO UPDATE SET
    max_amount=excluded.max_amount,
    bidder_username=excluded.bidder_username,
    updated_at=excluded.updated_at;

  UPDATE bids
     SET status='superseded'
   WHERE auction_id=NEW.auction_id
     AND status='active'
     AND (SELECT status FROM auction_commands WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET current_price = (
           SELECT CASE
             WHEN COUNT(*) <= 1 THEN auctions.start_price
             ELSE MIN(
               (SELECT max_amount
                  FROM auction_standing_bids
                 WHERE auction_id=NEW.auction_id
                 ORDER BY max_amount DESC, first_sequence ASC
                 LIMIT 1),
               (SELECT max_amount
                  FROM auction_standing_bids
                 WHERE auction_id=NEW.auction_id
                 ORDER BY max_amount DESC, first_sequence ASC
                 LIMIT 1 OFFSET 1)
               +
               CASE
                 WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC, first_sequence ASC LIMIT 1 OFFSET 1) < 50 THEN 1
                 WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC, first_sequence ASC LIMIT 1 OFFSET 1) < 500 THEN 2
                 WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC, first_sequence ASC LIMIT 1 OFFSET 1) < 1000 THEN 5
                 WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC, first_sequence ASC LIMIT 1 OFFSET 1) < 5000 THEN 10
                 ELSE 25
               END
             )
           END
           FROM auction_standing_bids
          WHERE auction_id=NEW.auction_id
         ),
         bid_count = bid_count + 1,
         ve