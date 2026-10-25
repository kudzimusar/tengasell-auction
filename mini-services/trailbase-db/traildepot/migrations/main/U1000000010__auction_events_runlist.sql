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
  source_sequence   INTEGER,
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


CREATE TRIGGER IF NOT EXISTS trg_runlist_command_process
AFTER INSERT ON auction_runlist_commands
BEGIN
  UPDATE auction_runlist_commands
     SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         version_before=(SELECT run_list_version FROM live_sessions WHERE id=NEW.session_id),
         source_sequence=(SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id AND session_id=NEW.session_id)
   WHERE id=NEW.id;

  UPDATE auction_runlist_commands SET status='rejected', error_code='SESSION_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id);

  UPDATE auction_runlist_commands SET status='rejected', error_code='EVENT_REQUIRED'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.event_id IS NULL);

  UPDATE auction_runlist_commands SET status='rejected', error_code='OPERATOR_FORBIDDEN'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (
       SELECT 1 FROM live_sessions s
        WHERE s.id=NEW.session_id
          AND (s.host_user=NEW.actor_user OR NEW.actor_admin=1)
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='STALE_RUN_LIST_VERSION'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (
       SELECT 1 FROM live_sessions s
        WHERE s.id=NEW.session_id AND s.run_list_version<>NEW.expected_version
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='SESSION_CLOSED'
   WHERE id=NEW.id AND status='pending'
     AND NEW.command_type IN ('ADD','MOVE','WITHDRAW','LOCK','UNLOCK','OPEN')
     AND EXISTS (SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.status='closed');

  UPDATE auction_runlist_commands SET status='rejected', error_code='RUN_LIST_LOCKED'
   WHERE id=NEW.id AND status='pending'
     AND NEW.command_type IN ('ADD','MOVE','WITHDRAW')
     AND EXISTS (SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.run_list_locked=1);

  UPDATE auction_runlist_commands SET status='rejected', error_code='RUN_LIST_ALREADY_LOCKED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='LOCK'
     AND EXISTS (SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.run_list_locked=1);

  UPDATE auction_runlist_commands SET status='rejected', error_code='RUN_LIST_ALREADY_UNLOCKED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='UNLOCK'
     AND EXISTS (SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.run_list_locked=0);

  UPDATE auction_runlist_commands SET status='rejected', error_code='LIVE_RUN_LIST_CANNOT_UNLOCK'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='UNLOCK'
     AND EXISTS (
       SELECT 1 FROM live_sessions s
        WHERE s.id=NEW.session_id
          AND (s.status='live' OR s.current_auction_lot_id IS NOT NULL)
     );

  -- ADD preconditions.
  UPDATE auction_runlist_commands SET status='rejected', error_code='AUCTION_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND NOT EXISTS (SELECT 1 FROM auctions a WHERE a.id=NEW.auction_id);

  UPDATE auction_runlist_commands SET status='rejected', error_code='LOT_NOT_READY'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND EXISTS (
       SELECT 1 FROM auctions a
        WHERE a.id=NEW.auction_id
          AND (a.status<>'live' OR a.bid_count<>0)
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='LOT_ALREADY_ASSIGNED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND (
       EXISTS (SELECT 1 FROM auction_lots l WHERE l.auction_id=NEW.auction_id)
       OR EXISTS (
         SELECT 1 FROM auctions a
          WHERE a.id=NEW.auction_id
            AND a.live_session_id IS NOT NULL
            AND a.live_session_id<>NEW.session_id
       )
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='VEHICLE_NOT_ELIGIBLE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND EXISTS (SELECT 1 FROM auctions a WHERE a.id=NEW.auction_id AND a.asset_kind='vehicle')
     AND NOT EXISTS (
       SELECT 1
         FROM vehicles v
         JOIN vehicle_eligibility e ON e.vehicle_id=v.id
        WHERE v.auction_id=NEW.auction_id
          AND e.version=(SELECT MAX(e2.version) FROM vehicle_eligibility e2 WHERE e2.vehicle_id=v.id)
          AND e.status='ELIGIBLE'
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='INVALID_SEQUENCE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND NEW.target_sequence IS NOT NULL
     AND (
       NEW.target_sequence<1
       OR NEW.target_sequence>(
         SELECT COALESCE(MAX(sequence_no),0)+1
           FROM auction_lots
          WHERE session_id=NEW.session_id AND status<>'WITHDRAWN'
       )
     );

  -- MOVE / WITHDRAW preconditions.
  UPDATE auction_runlist_commands SET status='rejected', error_code='LOT_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type IN ('MOVE','WITHDRAW','OPEN','CLOSE')
     AND NOT EXISTS (
       SELECT 1 FROM auction_lots l
        WHERE l.id=NEW.lot_id AND l.session_id=NEW.session_id
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='LOT_NOT_REORDERABLE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='MOVE'
     AND EXISTS (
       SELECT 1 FROM auction_lots l
        WHERE l.id=NEW.lot_id AND l.status<>'READY'
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='INVALID_SEQUENCE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='MOVE'
     AND (
       NEW.target_sequence IS NULL
       OR NEW.target_sequence<1
       OR NEW.target_sequence>(
         SELECT COALESCE(MAX(sequence_no),0)
           FROM auction_lots
          WHERE session_id=NEW.session_id AND status<>'WITHDRAWN'
       )
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='LOT_NOT_WITHDRAWABLE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='WITHDRAW'
     AND EXISTS (SELECT 1 FROM auction_lots l WHERE l.id=NEW.lot_id AND l.status<>'READY');

  UPDATE auction_runlist_commands SET status='rejected', error_code='WITHDRAW_REASON_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='WITHDRAW'
     AND (NEW.reason IS NULL OR length(trim(NEW.reason))<5);

  -- OPEN preconditions.
  UPDATE auction_runlist_commands SET status='rejected', error_code='RUN_LIST_MUST_BE_LOCKED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='OPEN'
     AND EXISTS (SELECT 1 FROM live_sessions s WHERE s.id=NEW.session_id AND s.run_list_locked=0);

  UPDATE auction_runlist_commands SET status='rejected', error_code='CURRENT_LOT_ACTIVE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='OPEN'
     AND EXISTS (
       SELECT 1 FROM live_sessions s
        WHERE s.id=NEW.session_id AND s.current_auction_lot_id IS NOT NULL
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='LOT_NOT_READY'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='OPEN'
     AND EXISTS (SELECT 1 FROM auction_lots l WHERE l.id=NEW.lot_id AND l.status<>'READY');

  UPDATE auction_runlist_commands SET status='rejected', error_code='OUT_OF_SEQUENCE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='OPEN'
     AND NEW.lot_id<>(
       SELECT l.id FROM auction_lots l
        WHERE l.session_id=NEW.session_id AND l.status='READY'
        ORDER BY l.sequence_no,l.id LIMIT 1
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='VEHICLE_NOT_ELIGIBLE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='OPEN'
     AND EXISTS (
       SELECT 1 FROM auction_lots l
       JOIN auctions a ON a.id=l.auction_id
       WHERE l.id=NEW.lot_id AND a.asset_kind='vehicle'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM auction_lots l
         JOIN vehicles v ON v.auction_id=l.auction_id
         JOIN vehicle_eligibility e ON e.vehicle_id=v.id
        WHERE l.id=NEW.lot_id
          AND e.version=(SELECT MAX(e2.version) FROM vehicle_eligibility e2 WHERE e2.vehicle_id=v.id)
          AND e.status='ELIGIBLE'
     );

  -- CLOSE / END preconditions.
  UPDATE auction_runlist_commands SET status='rejected', error_code='CURRENT_LOT_MISMATCH'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='CLOSE'
     AND NOT EXISTS (
       SELECT 1 FROM live_sessions s
        WHERE s.id=NEW.session_id AND s.current_auction_lot_id=NEW.lot_id
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='AUCTION_NOT_FINALIZED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='CLOSE'
     AND EXISTS (
       SELECT 1 FROM auction_lots l JOIN auctions a ON a.id=l.auction_id
        WHERE l.id=NEW.lot_id AND a.status NOT IN ('sold','ended')
     );

  UPDATE auction_runlist_commands SET status='rejected', error_code='CURRENT_LOT_ACTIVE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='END'
     AND EXISTS (
       SELECT 1 FROM live_sessions s
        WHERE s.id=NEW.session_id AND s.current_auction_lot_id IS NOT NULL
     );

  -- ADD.
  UPDATE auction_lots
     SET sequence_no=sequence_no+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE session_id=NEW.session_id
     AND status<>'WITHDRAWN'
     AND sequence_no>=COALESCE(
       NEW.target_sequence,
       (SELECT COALESCE(MAX(sequence_no),0)+1 FROM auction_lots WHERE session_id=NEW.session_id AND status<>'WITHDRAWN')
     )
     AND NEW.command_type='ADD'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  INSERT INTO auction_lots
    (event_id,session_id,auction_id,sequence_no,status,created_at,updated_at)
  SELECT s.event_id,NEW.session_id,NEW.auction_id,
         COALESCE(
           NEW.target_sequence,
           (SELECT COALESCE(MAX(sequence_no),0)+1 FROM auction_lots WHERE session_id=NEW.session_id AND status<>'WITHDRAWN')
         ),
         'READY',strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM live_sessions s
   WHERE s.id=NEW.session_id
     AND NEW.command_type='ADD'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE auction_runlist_commands SET result_lot_id=last_insert_rowid()
   WHERE id=NEW.id AND NEW.command_type='ADD' AND status='pending';

  UPDATE auctions
     SET live_session_id=NEW.session_id,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.auction_id
     AND NEW.command_type='ADD'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  -- MOVE: source_sequence was captured before any mutation.
  UPDATE auction_lots SET sequence_no=0,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id
     AND NEW.command_type='MOVE'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending'
     AND (SELECT source_sequence FROM auction_runlist_commands WHERE id=NEW.id)<>NEW.target_sequence;

  UPDATE auction_lots
     SET sequence_no=sequence_no+1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE session_id=NEW.session_id AND id<>NEW.lot_id
     AND NEW.command_type='MOVE'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending'
     AND NEW.target_sequence<(SELECT source_sequence FROM auction_runlist_commands WHERE id=NEW.id)
     AND sequence_no>=NEW.target_sequence
     AND sequence_no<(SELECT source_sequence FROM auction_runlist_commands WHERE id=NEW.id);

  UPDATE auction_lots
     SET sequence_no=sequence_no-1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE session_id=NEW.session_id AND id<>NEW.lot_id
     AND NEW.command_type='MOVE'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending'
     AND NEW.target_sequence>(SELECT source_sequence FROM auction_runlist_commands WHERE id=NEW.id)
     AND sequence_no>(SELECT source_sequence FROM auction_runlist_commands WHERE id=NEW.id)
     AND sequence_no<=NEW.target_sequence;

  UPDATE auction_lots SET sequence_no=NEW.target_sequence,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id
     AND NEW.command_type='MOVE'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  -- WITHDRAW.
  UPDATE auction_lots
     SET status='WITHDRAWN',
         withdrawn_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         withdrawn_by=NEW.actor_user,
         withdraw_reason=substr(trim(NEW.reason),1,240),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id
     AND NEW.command_type='WITHDRAW'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET live_session_id=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(SELECT auction_id FROM auction_lots WHERE id=NEW.lot_id)
     AND NEW.command_type='WITHDRAW'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  -- LOCK / UNLOCK.
  UPDATE live_sessions
     SET run_list_locked=1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND NEW.command_type='LOCK'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET run_list_locked=0,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND NEW.command_type='UNLOCK'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  -- OPEN first ready lot.
  UPDATE auction_lots
     SET status='LIVE',opened_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id AND NEW.command_type='OPEN'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET status='live',
         current_auction_lot_id=NEW.lot_id,
         current_lot_id=(SELECT auction_id FROM auction_lots WHERE id=NEW.lot_id),
         lot_index=(SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id),
         next_auction_lot_id=(
           SELECT l.id FROM auction_lots l
            WHERE l.session_id=NEW.session_id AND l.status='READY'
            ORDER BY l.sequence_no,l.id LIMIT 1
         ),
         close_at=strftime('%Y-%m-%dT%H:%M:%SZ','now','+20 seconds'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND NEW.command_type='OPEN'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE auction_events
     SET status='LIVE',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(SELECT event_id FROM live_sessions WHERE id=NEW.session_id)
     AND NEW.command_type='OPEN'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  -- CLOSE finalized current lot, then atomically promote the next READY lot.
  UPDATE auction_lots
     SET status=CASE
           WHEN (SELECT status FROM auctions WHERE id=auction_lots.auction_id)='sold' THEN 'SOLD'
           ELSE 'UNSOLD'
         END,
         closed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id AND NEW.command_type='CLOSE'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET status='LIVE',opened_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(
       SELECT l.id FROM auction_lots l
        WHERE l.session_id=NEW.session_id AND l.status='READY'
        ORDER BY l.sequence_no,l.id LIMIT 1
     )
     AND NEW.command_type='CLOSE'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET current_auction_lot_id=(
           SELECT l.id FROM auction_lots l
            WHERE l.session_id=NEW.session_id AND l.status='LIVE'
            ORDER BY l.sequence_no,l.id LIMIT 1
         ),
         current_lot_id=(
           SELECT l.auction_id FROM auction_lots l
            WHERE l.session_id=NEW.session_id AND l.status='LIVE'
            ORDER BY l.sequence_no,l.id LIMIT 1
         ),
         lot_index=COALESCE((
           SELECT l.sequence_no FROM auction_lots l
            WHERE l.session_id=NEW.session_id AND l.status='LIVE'
            ORDER BY l.sequence_no,l.id LIMIT 1
         ),lot_index),
         next_auction_lot_id=(
           SELECT l.id FROM auction_lots l
            WHERE l.session_id=NEW.session_id AND l.status='READY'
            ORDER BY l.sequence_no,l.id LIMIT 1
         ),
         status=CASE
           WHEN EXISTS (SELECT 1 FROM auction_lots l WHERE l.session_id=NEW.session_id AND l.status='LIVE')
             THEN 'live'
           ELSE 'closed'
         END,
         close_at=CASE
           WHEN EXISTS (SELECT 1 FROM auction_lots l WHERE l.session_id=NEW.session_id AND l.status='LIVE')
             THEN strftime('%Y-%m-%dT%H:%M:%SZ','now','+20 seconds')
           ELSE NULL
         END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND NEW.command_type='CLOSE'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  -- END may only occur with no active lot.
  UPDATE auction_lots
     SET status='WITHDRAWN',
         withdrawn_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         withdrawn_by=NEW.actor_user,
         withdraw_reason='Session ended by operator',
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE session_id=NEW.session_id AND status='READY'
     AND NEW.command_type='END'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET live_session_id=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id IN (
       SELECT l.auction_id FROM auction_lots l
        WHERE l.session_id=NEW.session_id AND l.status='WITHDRAWN'
     )
     AND NEW.command_type='END'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET status='closed',current_lot_id=NULL,current_auction_lot_id=NULL,
         next_auction_lot_id=NULL,close_at=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND NEW.command_type='END'
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  -- Every accepted operator mutation advances the run-list version exactly once.
  UPDATE live_sessions
     SET run_list_version=run_list_version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='pending';

  UPDATE auction_runlist_commands
     SET status='accepted',
         version_after=(SELECT run_list_version FROM live_sessions WHERE id=NEW.session_id),
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  -- Close the event when its last session is closed.
  UPDATE auction_events
     SET status='CLOSED',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(SELECT event_id FROM live_sessions WHERE id=NEW.session_id)
     AND NEW.command_type IN ('CLOSE','END')
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='accepted'
     AND NOT EXISTS (
       SELECT 1 FROM live_sessions s
        WHERE s.event_id=auction_events.id AND s.status<>'closed'
     );

  INSERT INTO auction_event_audit
    (event_id,session_id,lot_id,actor_user,action,payload,created_at)
  SELECT s.event_id,NEW.session_id,
         COALESCE(NEW.lot_id,(SELECT result_lot_id FROM auction_runlist_commands WHERE id=NEW.id)),
         NEW.actor_user,
         'runlist:'||lower(NEW.command_type),
         json_object(
           'commandKey',NEW.command_key,
           'auctionId',NEW.auction_id,
           'targetSequence',NEW.target_sequence,
           'sourceSequence',(SELECT source_sequence FROM auction_runlist_commands WHERE id=NEW.id),
           'versionBefore',(SELECT version_before FROM auction_runlist_commands WHERE id=NEW.id),
           'versionAfter',(SELECT version_after FROM auction_runlist_commands WHERE id=NEW.id)
         ),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM live_sessions s
   WHERE s.id=NEW.session_id
     AND (SELECT status FROM auction_runlist_commands WHERE id=NEW.id)='accepted';

  UPDATE auction_runlist_commands
     SET completed_at=COALESCE(completed_at,strftime('%Y-%m-%dT%H:%M:%SZ','now')),
         version_after=COALESCE(version_after,version_before)
   WHERE id=NEW.id;
END;
