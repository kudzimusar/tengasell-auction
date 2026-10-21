-- Tengasell marketplace schema (STRICT tables, INTEGER primary keys)
-- Ownership columns (`user`, `buyer_user`, `seller_user`) reference _user(id).

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  name_ja     TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT 'tag',
  blurb       TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS profiles (
  id               INTEGER PRIMARY KEY,
  user             BLOB NOT NULL UNIQUE REFERENCES _user(id),
  username         TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  bio              TEXT NOT NULL DEFAULT '',
  city             TEXT NOT NULL DEFAULT '',
  rating_avg       REAL NOT NULL DEFAULT 0,
  rating_count     INTEGER NOT NULL DEFAULT 0,
  sales            INTEGER NOT NULL DEFAULT 0,
  response_minutes INTEGER NOT NULL DEFAULT 120,
  verified         INTEGER NOT NULL DEFAULT 0,
  joined_at        TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE IF NOT EXISTS auctions (
  id               INTEGER PRIMARY KEY,
  user             BLOB NOT NULL REFERENCES _user(id),
  seller_username  TEXT NOT NULL,
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL,
  condition        TEXT NOT NULL DEFAULT 'used',
  start_price      REAL NOT NULL,
  current_price    REAL NOT NULL,
  buy_now_price    REAL,
  reserve_price    REAL,
  bid_count        INTEGER NOT NULL DEFAULT 0,
  watch_count      INTEGER NOT NULL DEFAULT 0,
  views            INTEGER NOT NULL DEFAULT 0,
  shipping_fee     REAL NOT NULL DEFAULT 0,
  shipping         TEXT NOT NULL DEFAULT 'courier',
  city             TEXT NOT NULL DEFAULT 'Harare',
  ends_at          TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'live',
  extension_count  INTEGER NOT NULL DEFAULT 0,
  featured         INTEGER NOT NULL DEFAULT 0,
  images           TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_auctions_status_ends ON auctions (status, ends_at);
CREATE INDEX IF NOT EXISTS idx_auctions_category ON auctions (category);
CREATE INDEX IF NOT EXISTS idx_auctions_user ON auctions (user);

CREATE TABLE IF NOT EXISTS bids (
  id               INTEGER PRIMARY KEY,
  auction_id       INTEGER NOT NULL,
  user             BLOB NOT NULL REFERENCES _user(id),
  bidder_username  TEXT NOT NULL,
  amount           REAL NOT NULL,
  max_amount       REAL NOT NULL,
  is_auto          INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_bids_auction ON bids (auction_id);
CREATE INDEX IF NOT EXISTS idx_bids_user ON bids (user);

CREATE TABLE IF NOT EXISTS watchlist (
  id         INTEGER PRIMARY KEY,
  user       BLOB NOT NULL REFERENCES _user(id),
  auction_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user, auction_id)
) STRICT;

CREATE TABLE IF NOT EXISTS questions (
  id              INTEGER PRIMARY KEY,
  auction_id      INTEGER NOT NULL,
  user            BLOB NOT NULL REFERENCES _user(id),
  asker_username  TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL,
  answer          TEXT,
  answered_at     TEXT,
  created_at      TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_questions_auction ON questions (auction_id);

CREATE TABLE IF NOT EXISTS threads (
  id               INTEGER PRIMARY KEY,
  auction_id       INTEGER,
  buyer_user       BLOB NOT NULL REFERENCES _user(id),
  seller_user      BLOB NOT NULL REFERENCES _user(id),
  buyer_username   TEXT NOT NULL DEFAULT '',
  seller_username  TEXT NOT NULL DEFAULT '',
  subject          TEXT NOT NULL DEFAULT '',
  last_message_at  TEXT,
  created_at       TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_threads_buyer ON threads (buyer_user);
CREATE INDEX IF NOT EXISTS idx_threads_seller ON threads (seller_user);

CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY,
  thread_id        INTEGER NOT NULL,
  user             BLOB NOT NULL REFERENCES _user(id),
  sender_username  TEXT NOT NULL DEFAULT '',
  body             TEXT NOT NULL,
  created_at       TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY,
  auction_id       INTEGER NOT NULL,
  auction_title    TEXT NOT NULL DEFAULT '',
  buyer_user       BLOB NOT NULL REFERENCES _user(id),
  seller_user      BLOB NOT NULL REFERENCES _user(id),
  buyer_username   TEXT NOT NULL DEFAULT '',
  seller_username  TEXT NOT NULL DEFAULT '',
  final_price      REAL NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending_payment',
  pay_by           TEXT,
  paid_at          TEXT,
  shipped_at       TEXT,
  delivered_at     TEXT,
  completed_at     TEXT,
  carrier          TEXT,
  tracking         TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_user);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_user);

CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL,
  user        BLOB REFERENCES _user(id),
  method      TEXT NOT NULL DEFAULT 'ecocash',
  amount      REAL NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  reference   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS ratings (
  id              INTEGER PRIMARY KEY,
  order_id        INTEGER NOT NULL,
  user            BLOB NOT NULL REFERENCES _user(id),
  ratee_user      BLOB NOT NULL REFERENCES _user(id),
  ratee_username  TEXT NOT NULL DEFAULT '',
  direction       TEXT NOT NULL DEFAULT 'as_buyer',
  score           INTEGER NOT NULL DEFAULT 5,
  comment         TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings (ratee_user);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user        BLOB NOT NULL REFERENCES _user(id),
  type        TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user);

CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY,
  user        TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL DEFAULT '',
  entity_id   INTEGER,
  source      TEXT NOT NULL DEFAULT 'web',
  payload     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
) STRICT;
