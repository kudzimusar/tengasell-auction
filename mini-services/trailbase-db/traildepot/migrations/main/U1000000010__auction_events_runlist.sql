-- TENGASELL-AUCTION-IMP-05 — Event / Session / Run-List authority.
-- Single-lane foundation only. Multi-lane is intentionally deferred.

CREATE TABLE IF NOT EXISTS auction_venues (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  address_line1  TEXT NOT NULL,
  address_line2  TEXT,
  city           TEXT NOT NULL,
  country        TEXT NOT NULL DEFAULT 'Zimbabwe',
  timezone       TEXT NOT NULL DEFAULT 'Africa/Harare',
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  venue_id           INTEGER,
  starts_at          TEXT NOT NULL,
  ends_at            TEXT NOT NULL,
  timezone           TEXT NOT NULL DEFAULT 'Africa/Harare',
  status             TEXT NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT','PUBLISHED','LIVE','CLOSED','CANCELLED')),
  organizer_user     BLOB NOT NULL,
  organizer_username TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (unixepoch(ends_at) > unixepoch(starts_at))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_events_calendar
  ON auction_events (status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_auction_events_venue
  ON auction_events (venue_id, starts_at);

ALTER TABLE live_sessions ADD COLUMN event_id INTEGER;
ALTER TABLE live_sessions ADD COLUMN run_list_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE live_sessions ADD COLUMN run_list_locked INTEGER NOT NULL DEFAULT 0 CHECK (run_list_locked IN (0,1));
ALTER TABLE live_sessions ADD COLUMN current_auction_lot_id INTEGER;
ALTER TABLE live_sessions ADD COLUMN next_auction_lot_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_live_sessions_event
  ON live_sessions (event_id, scheduled_at);

CREATE TABLE IF NOT EXISTS auction_lots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       INTEGER NOT NULL,
  session_id     INTEGER NOT NULL,
  auction_id     INTEGER NOT NULL UNIQUE,
  sequence_no    INTEGER NOT NULL CHECK (sequence_no > 0),
  status         TEXT NOT NULL DEFAULT 'READY'
                      CHECK (status IN ('READY','LIVE','SOLD','UNSOLD','WITHDRAWN')),
  withdrawn_at   TEXT,
  withdrawn_by   BLOB,
  withdraw_reason TEXT,
  opened_at      TEXT,
  closed_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_lots_runlist
  ON auction_lots (session_id, sequence_no, id);
CREATE INDEX IF NOT EXISTS idx_auction_lots_event
  ON auction_lots (event_id, session_id, sequence_no);

CREATE TABLE IF NOT EXISTS auction_runlist_commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key       TEXT NOT NULL UNIQUE,
  session_id        INTEGER NOT NULL,
  actor_user        BLOB NOT NULL,
  actor_username    TEXT NOT NULL,
  actor_admin       INTEGER NOT NULL DEFAULT 0 CHECK (actor_admin IN (0,1)),
  command_type      TEXT NOT NULL CHECK (command_type IN (
    'ADD','MOVE','WITHDRAW','LOCK','UNLOCK','OPEN','CLOSE','END'
  )),
  auction_id        INTEGER,
  lot_id            INTEGER,
  target_sequence   INTEGER,
  expected_version  INTEGER NOT NULL,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','accepted','rejected')),
  error_code        TEXT,
  result_lot_id     INTEGER,
  version_before    INTEGER,
  version_after     INTEGER,
  received_at       TEXT NOT NULL DEFAULT '',
  completed_at      TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_runlist_commands_session
  ON auction_runlist_commands (session_id, id);

CREATE TABLE IF NOT EXISTS auction_event_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER,
  session_id  INTEGER,
  lot_id      INTEGER,
  actor_user  BLOB,
  action      TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_event_audit_event
  ON auction_event_audit (event_id, id);
CREATE INDEX IF NOT EXISTS idx_auction_event_audit_session
  ON auction_event_audit (session_id, id);

CREATE TRIGGER IF NOT EXISTS trg_event_venue_integrity_insert
BEFORE INSERT ON auction_events
WHEN NEW.venue_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM auction_venues v WHERE v.id=NEW.venue_id AND v.active=1)
BEGIN
  SELECT RAISE(ABORT,'AUCTION_VENUE_NOT_FOUND');
END;

CREATE TRIGGER IF NOT EXISTS trg_event_venue_integrity_update
BEFORE UPDATE OF venue_id ON auction_events
WHEN NEW.venue_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM auction_venues v WHERE v.id=NEW.venue_id AND v.active=1)
BEGIN
  SELECT RAISE(ABORT,'AUCTION_VENUE_NOT_FOUND');
END;

CREATE TRIGGER IF NOT EXISTS trg_session_event_integrity_insert
BEFORE INSERT ON live_sessions
WHEN NEW.event_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM auction_events e WHERE e.id=NEW.event_id)
BEGIN
  SELECT RAISE(ABORT,'AUCTION_EVENT_NOT_FOUND');
END;

CREATE TRIGGER IF NOT EXISTS trg_session_event_integrity_update
BEFORE UPDATE OF event_id ON live_sessions
WHEN NEW.event_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM auction_events e WHERE e.id=NEW.event_id)
BEGIN
  SELECT RAISE(ABORT,'AUCTION_EVENT_NOT_FOUND');
END;

CREATE TRIGGER IF NOT EXISTS trg_lot_event_session_integrity_insert
BEFORE INSERT ON auction_lots
WHEN NOT EXISTS (
  SELECT 1 FROM live_sessions s
   WHERE s.id=NEW.session_id
     AND s.event_id=NEW.event_id
)
BEGIN
  SELECT RAISE(ABORT,'EVENT_SESSION_INTEGRITY');
END;

CREATE TRIGGER IF NOT EXISTS trg_lot_event_session_integrity_update
BEFORE UPDATE OF event_id,session_id ON auction_lots
WHEN NOT EXISTS (
  SELECT 1 FROM live_sessions s
   WHERE s.id=NEW.session_id
     AND s.event_id=NEW.event_id
)
BEGIN
  SELECT RAISE(ABORT,'EVENT_SESSION_INTEGRITY');
END;
