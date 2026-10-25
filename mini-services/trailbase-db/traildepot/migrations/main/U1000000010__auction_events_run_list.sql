-- TENGASELL-AUCTION-IMP-05 — event / session / run-list foundation.
-- Multi-lane is intentionally deferred. One AuctionEvent owns one evolved
-- LiveSession and one versioned, ordered run list.

ALTER TABLE live_sessions ADD COLUMN event_id INTEGER;
ALTER TABLE live_sessions ADD COLUMN next_lot_id INTEGER;
ALTER TABLE live_sessions ADD COLUMN run_list_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE live_sessions ADD COLUMN run_list_locked INTEGER NOT NULL DEFAULT 0
  CHECK (run_list_locked IN (0,1));

CREATE TABLE IF NOT EXISTS auction_venues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  country       TEXT NOT NULL DEFAULT 'Zimbabwe',
  timezone      TEXT NOT NULL DEFAULT 'Africa/Harare',
  venue_type    TEXT NOT NULL DEFAULT 'PHYSICAL'
                CHECK (venue_type IN ('PHYSICAL','HYBRID','ONLINE')),
  created_by    BLOB NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  host_user          BLOB NOT NULL,
  host_username      TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  venue_id           INTEGER,
  session_id         INTEGER UNIQUE,
  starts_at          TEXT NOT NULL,
  ends_at            TEXT,
  timezone           TEXT NOT NULL DEFAULT 'Africa/Harare',
  status             TEXT NOT NULL DEFAULT 'SCHEDULED'
                     CHECK (status IN ('DRAFT','SCHEDULED','LIVE','CLOSED','CANCELLED')),
  version            INTEGER NOT NULL DEFAULT 0,
  run_list_version   INTEGER NOT NULL DEFAULT 0,
  run_list_locked    INTEGER NOT NULL DEFAULT 0 CHECK (run_list_locked IN (0,1)),
  current_lot_id     INTEGER,
  next_lot_id        INTEGER,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_events_status_start ON auction_events(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_auction_events_venue ON auction_events(venue_id);

CREATE TABLE IF NOT EXISTS auction_event_operators (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    INTEGER NOT NULL,
  user        BLOB NOT NULL,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('HOST','AUCTIONEER','CLERK')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  granted_by  BLOB NOT NULL,
  granted_at  TEXT NOT NULL,
  UNIQUE (event_id,user,role)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_event_operators_event ON auction_event_operators(event_id,active);

CREATE TABLE IF NOT EXISTS auction_lots (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id                 INTEGER NOT NULL,
  session_id               INTEGER NOT NULL,
  auction_id               INTEGER NOT NULL UNIQUE,
  sequence_no              INTEGER NOT NULL CHECK (sequence_no > 0),
  status                   TEXT NOT NULL DEFAULT 'QUEUED'
                           CHECK (status IN ('QUEUED','READY','LIVE','SOLD','PASSED','WITHDRAWN')),
  version                  INTEGER NOT NULL DEFAULT 0,
  original_ends_at         TEXT NOT NULL,
  original_live_session_id INTEGER,
  ready_at                 TEXT,
  opened_at                TEXT,
  closed_at                TEXT,
  withdrawn_at             TEXT,
  withdrawal_reason        TEXT,
  created_by               BLOB NOT NULL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_lots_run_list ON auction_lots(event_id,session_id,status,sequence_no,id);

CREATE TABLE IF NOT EXISTS run_list_commands (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key                TEXT NOT NULL UNIQUE,
  event_id                   INTEGER NOT NULL,
  session_id                 INTEGER NOT NULL,
  operator_user              BLOB NOT NULL,
  operator_username          TEXT NOT NULL,
  operator_admin             INTEGER NOT NULL DEFAULT 0 CHECK (operator_admin IN (0,1)),
  command_type               TEXT NOT NULL CHECK (command_type IN (
    'ADD','MOVE','READY','WITHDRAW','LOCK','UNLOCK','OPEN','ADVANCE','CLOSE_EVENT'
  )),
  lot_id                     INTEGER,
  auction_id                 INTEGER,
  target_sequence_no         INTEGER,
  reason                     TEXT,
  expected_run_list_version  INTEGER NOT NULL,
  source                     TEXT NOT NULL DEFAULT 'OPERATOR'
                             CHECK (source IN ('OPERATOR','SYSTEM')),
  status                     TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','accepted','rejected','idempotent_existing')),
  error_code                 TEXT,
  version_before             INTEGER,
  version_after              INTEGER,
  result_lot_id              INTEGER,
  result_current_lot_id      INTEGER,
  result_next_lot_id         INTEGER,
  received_at                TEXT NOT NULL DEFAULT '',
  completed_at               TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_run_list_commands_event ON run_list_commands(event_id,id);

CREATE TRIGGER IF NOT EXISTS trg_auction_event_create_session
AFTER INSERT ON auction_events
WHEN NEW.session_id IS NULL
BEGIN
  INSERT INTO live_sessions
    (host_user,host_username,title,scheduled_at,status,current_lot_id,lot_index,close_at,
     created_at,updated_at,event_id,next_lot_id,run_list_version,run_list_locked)
  VALUES
    (NEW.host_user,NEW.host_username,NEW.title,NEW.starts_at,'scheduled',NULL,0,NULL,
     strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'),
     NEW.id,NULL,0,0);

  UPDATE auction_events
     SET session_id=last_insert_rowid(),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id;

  INSERT OR IGNORE INTO auction_event_operators
    (event_id,user,username,role,active,granted_by,granted_at)
  VALUES
    (NEW.id,NEW.host_user,NEW.host_username,'HOST',1,NEW.host_user,
     strftime('%Y-%m-%dT%H:%M:%SZ','now'));

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  VALUES
    (lower(hex(NEW.host_user)),'auction_event:create','auction_events',NEW.id,'event-authority',
     json_object('sessionId',(SELECT session_id FROM auction_events WHERE id=NEW.id)),
     strftime('%Y-%m-%dT%H:%M:%SZ','now'));
END;

CREATE TRIGGER IF NOT EXISTS trg_run_list_process
AFTER INSERT ON run_list_commands
BEGIN
  UPDATE run_list_commands
     SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         version_before=(SELECT run_list_version FROM auction_events WHERE id=NEW.event_id)
   WHERE id=NEW.id;

  UPDATE run_list_commands SET status='rejected',error_code='EVENT_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (SELECT 1 FROM auction_events WHERE id=NEW.event_id);

  UPDATE run_list_commands SET status='rejected',error_code='EVENT_SESSION_INTEGRITY'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (
       SELECT 1 FROM auction_events e
       JOIN live_sessions s ON s.id=e.session_id AND s.event_id=e.id
       WHERE e.id=NEW.event_id AND e.session_id=NEW.session_id
     );

  UPDATE run_list_commands SET status='rejected',error_code='EVENT_CLOSED'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (
       SELECT 1 FROM auction_events e
       WHERE e.id=NEW.event_id AND e.status IN ('CLOSED','CANCELLED')
     );

  UPDATE run_list_commands SET status='rejected',error_code='OPERATOR_PERMISSION_REQUIRED'
   WHERE id=NEW.id AND status='pending'
     AND NEW.operator_admin=0
     AND NOT EXISTS (
       SELECT 1 FROM auction_event_operators o
       WHERE o.event_id=NEW.event_id AND o.user=NEW.operator_user AND o.active=1
     );

  UPDATE run_list_commands SET status='rejected',error_code='STALE_RUN_LIST_VERSION'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (
       SELECT 1 FROM auction_events e
       WHERE e.id=NEW.event_id AND e.run_list_version<>NEW.expected_run_list_version
     );

  UPDATE run_list_commands SET status='rejected',error_code='RUN_LIST_LOCKED'
   WHERE id=NEW.id AND status='pending'
     AND NEW.command_type IN ('ADD','MOVE','READY','WITHDRAW')
     AND EXISTS (
       SELECT 1 FROM auction_events e
       WHERE e.id=NEW.event_id AND e.run_list_locked=1
     );

  UPDATE run_list_commands SET status='rejected',error_code='RUN_LIST_ALREADY_LOCKED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='LOCK'
     AND EXISTS (SELECT 1 FROM auction_events e WHERE e.id=NEW.event_id AND e.run_list_locked=1);

  UPDATE run_list_commands SET status='rejected',error_code='RUN_LIST_NOT_LOCKED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type IN ('UNLOCK','OPEN')
     AND EXISTS (SELECT 1 FROM auction_events e WHERE e.id=NEW.event_id AND e.run_list_locked=0);

  UPDATE run_list_commands SET status='rejected',error_code='AUCTION_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND (NEW.auction_id IS NULL OR NOT EXISTS (SELECT 1 FROM auctions a WHERE a.id=NEW.auction_id));

  UPDATE run_list_commands SET status='rejected',error_code='AUCTION_NOT_AVAILABLE_FOR_EVENT'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND EXISTS (
       SELECT 1 FROM auctions a
       WHERE a.id=NEW.auction_id
         AND (a.status<>'live' OR a.bid_count<>0 OR a.live_session_id IS NOT NULL)
     );

  UPDATE run_list_commands SET status='rejected',error_code='LOT_ALREADY_ASSIGNED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND EXISTS (SELECT 1 FROM auction_lots l WHERE l.auction_id=NEW.auction_id AND l.status<>'WITHDRAWN');

  UPDATE run_list_commands SET status='rejected',error_code='INVALID_SEQUENCE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADD'
     AND NEW.target_sequence_no IS NOT NULL
     AND (NEW.target_sequence_no<1 OR NEW.target_sequence_no>
       (SELECT COUNT(*)+1 FROM auction_lots l WHERE l.event_id=NEW.event_id AND l.status<>'WITHDRAWN'));

  UPDATE run_list_commands SET status='rejected',error_code='VEHICLE_NOT_ELIGIBLE'
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

  UPDATE run_list_commands SET status='rejected',error_code='LOT_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NEW.command_type IN ('MOVE','READY','WITHDRAW','OPEN')
     AND (
       NEW.lot_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM auction_lots l
         WHERE l.id=NEW.lot_id AND l.event_id=NEW.event_id AND l.session_id=NEW.session_id
       )
     );

  UPDATE run_list_commands SET status='rejected',error_code='LOT_NOT_REORDERABLE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='MOVE'
     AND EXISTS (SELECT 1 FROM auction_lots l WHERE l.id=NEW.lot_id AND l.status NOT IN ('QUEUED','READY'));

  UPDATE run_list_commands SET status='rejected',error_code='INVALID_SEQUENCE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='MOVE'
     AND (
       NEW.target_sequence_no IS NULL OR NEW.target_sequence_no<1 OR
       NEW.target_sequence_no>(SELECT COUNT(*) FROM auction_lots l WHERE l.event_id=NEW.event_id AND l.status<>'WITHDRAWN')
     );

  UPDATE run_list_commands SET status='rejected',error_code='LOT_NOT_QUEUED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='READY'
     AND EXISTS (SELECT 1 FROM auction_lots l WHERE l.id=NEW.lot_id AND l.status<>'QUEUED');

  UPDATE run_list_commands SET status='rejected',error_code='VEHICLE_NOT_ELIGIBLE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='READY'
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

  UPDATE run_list_commands SET status='rejected',error_code='LOT_NOT_WITHDRAWABLE'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='WITHDRAW'
     AND EXISTS (SELECT 1 FROM auction_lots l WHERE l.id=NEW.lot_id AND l.status NOT IN ('QUEUED','READY'));

  UPDATE run_list_commands SET status='rejected',error_code='WITHDRAWAL_REASON_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='WITHDRAW'
     AND (NEW.reason IS NULL OR length(trim(NEW.reason))<5);

  UPDATE run_list_commands SET status='rejected',error_code='CURRENT_LOT_OPEN'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type IN ('OPEN','CLOSE_EVENT')
     AND EXISTS (SELECT 1 FROM auction_events e WHERE e.id=NEW.event_id AND e.current_lot_id IS NOT NULL);

  UPDATE run_list_commands SET status='rejected',error_code='LOT_NOT_READY'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='OPEN'
     AND EXISTS (SELECT 1 FROM auction_lots l WHERE l.id=NEW.lot_id AND l.status<>'READY');

  UPDATE run_list_commands SET status='rejected',error_code='RUN_LIST_NOT_LOCKED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='CLOSE_EVENT'
     AND EXISTS (SELECT 1 FROM auction_events e WHERE e.id=NEW.event_id AND e.run_list_locked=0);

  UPDATE run_list_commands SET status='rejected',error_code='NO_CURRENT_LOT'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADVANCE'
     AND NOT EXISTS (
       SELECT 1 FROM auction_events e WHERE e.id=NEW.event_id AND e.current_lot_id=NEW.lot_id
     );

  UPDATE run_list_commands SET status='rejected',error_code='LOT_OUTCOME_NOT_COMMITTED'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADVANCE'
     AND EXISTS (
       SELECT 1 FROM auction_lots l
       JOIN auctions a ON a.id=l.auction_id
       WHERE l.id=NEW.lot_id AND a.status NOT IN ('sold','ended','cancelled')
     );

  UPDATE auction_lots
     SET sequence_no=sequence_no+1, version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND status<>'WITHDRAWN'
     AND NEW.command_type='ADD'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending'
     AND NEW.target_sequence_no IS NOT NULL
     AND sequence_no>=NEW.target_sequence_no;

  INSERT INTO auction_lots
    (event_id,session_id,auction_id,sequence_no,status,version,
     original_ends_at,original_live_session_id,created_by,created_at,updated_at)
  SELECT NEW.event_id,NEW.session_id,NEW.auction_id,
         COALESCE(NEW.target_sequence_no,
           (SELECT COALESCE(MAX(sequence_no),0)+1 FROM auction_lots WHERE event_id=NEW.event_id AND status<>'WITHDRAWN')),
         'QUEUED',0,a.ends_at,a.live_session_id,NEW.operator_user,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auctions a
   WHERE a.id=NEW.auction_id
     AND NEW.command_type='ADD'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET live_session_id=NEW.session_id,
         ends_at=strftime('%Y-%m-%dT%H:%M:%SZ','now','+30 days'),
         version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.auction_id
     AND NEW.command_type='ADD'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE run_list_commands
     SET result_lot_id=(SELECT id FROM auction_lots WHERE auction_id=NEW.auction_id)
   WHERE id=NEW.id AND NEW.command_type='ADD'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET sequence_no=sequence_no+1, version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id
     AND id<>NEW.lot_id
     AND NEW.command_type='MOVE'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending'
     AND NEW.target_sequence_no < (SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id)
     AND sequence_no>=NEW.target_sequence_no
     AND sequence_no<(SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id);

  UPDATE auction_lots
     SET sequence_no=sequence_no-1, version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id
     AND id<>NEW.lot_id
     AND NEW.command_type='MOVE'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending'
     AND NEW.target_sequence_no > (SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id)
     AND sequence_no<=NEW.target_sequence_no
     AND sequence_no>(SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id);

  UPDATE auction_lots
     SET sequence_no=NEW.target_sequence_no,version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id AND NEW.command_type='MOVE'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET status='READY',ready_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id AND NEW.command_type='READY'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET status='WITHDRAWN',withdrawn_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         withdrawal_reason=substr(trim(NEW.reason),1,300),version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id AND NEW.command_type='WITHDRAW'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET live_session_id=(SELECT original_live_session_id FROM auction_lots WHERE id=NEW.lot_id),
         ends_at=CASE
           WHEN unixepoch((SELECT original_ends_at FROM auction_lots WHERE id=NEW.lot_id))>unixepoch('now')
             THEN (SELECT original_ends_at FROM auction_lots WHERE id=NEW.lot_id)
           ELSE strftime('%Y-%m-%dT%H:%M:%SZ','now','+7 days')
         END,
         version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(SELECT auction_id FROM auction_lots WHERE id=NEW.lot_id)
     AND NEW.command_type='WITHDRAW'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET sequence_no=sequence_no-1,version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND status<>'WITHDRAWN'
     AND NEW.command_type='WITHDRAW'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending'
     AND sequence_no>(SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id);

  UPDATE auction_events SET run_list_locked=1
   WHERE id=NEW.event_id AND NEW.command_type='LOCK'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';
  UPDATE auction_events SET run_list_locked=0
   WHERE id=NEW.event_id AND NEW.command_type='UNLOCK'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET status='LIVE',opened_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id AND NEW.command_type='OPEN'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_events
     SET status='LIVE',current_lot_id=NEW.lot_id
   WHERE id=NEW.event_id AND NEW.command_type='OPEN'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET status='live',current_lot_id=(SELECT auction_id FROM auction_lots WHERE id=NEW.lot_id),
         lot_index=(SELECT sequence_no FROM auction_lots WHERE id=NEW.lot_id),
         close_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND NEW.command_type='OPEN'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET status=CASE
           WHEN (SELECT status FROM auctions WHERE id=auction_lots.auction_id)='sold' THEN 'SOLD'
           ELSE 'PASSED'
         END,
         closed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.lot_id AND NEW.command_type='ADVANCE'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_events
     SET current_lot_id=NULL
   WHERE id=NEW.event_id AND NEW.command_type='ADVANCE'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET current_lot_id=NULL,close_at=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND NEW.command_type='ADVANCE'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET live_session_id=(
           SELECT l.original_live_session_id FROM auction_lots l WHERE l.auction_id=auctions.id
         ),
         ends_at=CASE
           WHEN unixepoch((SELECT l.original_ends_at FROM auction_lots l WHERE l.auction_id=auctions.id))>unixepoch('now')
             THEN (SELECT l.original_ends_at FROM auction_lots l WHERE l.auction_id=auctions.id)
           ELSE strftime('%Y-%m-%dT%H:%M:%SZ','now','+7 days')
         END,
         version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id IN (
       SELECT auction_id FROM auction_lots
       WHERE event_id=NEW.event_id AND status IN ('QUEUED','READY')
   )
     AND NEW.command_type='CLOSE_EVENT'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_lots
     SET status='WITHDRAWN',withdrawn_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         withdrawal_reason='Event closed',version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND status IN ('QUEUED','READY')
     AND NEW.command_type='CLOSE_EVENT'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_events
     SET status='CLOSED',current_lot_id=NULL,next_lot_id=NULL
   WHERE id=NEW.event_id AND NEW.command_type='CLOSE_EVENT'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET status='closed',current_lot_id=NULL,next_lot_id=NULL,close_at=NULL
   WHERE id=NEW.session_id AND NEW.command_type='CLOSE_EVENT'
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_events
     SET next_lot_id=(
       SELECT l.id FROM auction_lots l
       WHERE l.event_id=NEW.event_id AND l.status='READY'
         AND (
           auction_events.current_lot_id IS NULL OR
           l.sequence_no>(
             SELECT sequence_no FROM auction_lots c WHERE c.id=auction_events.current_lot_id
           )
         )
       ORDER BY l.sequence_no,l.id LIMIT 1
     )
   WHERE id=NEW.event_id
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET next_lot_id=(
       SELECT auction_id FROM auction_lots
       WHERE id=(SELECT next_lot_id FROM auction_events WHERE id=NEW.event_id)
     )
   WHERE id=NEW.session_id
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE auction_events
     SET run_list_version=run_list_version+1,
         version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.event_id
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE live_sessions
     SET run_list_version=(SELECT run_list_version FROM auction_events WHERE id=NEW.event_id),
         run_list_locked=(SELECT run_list_locked FROM auction_events WHERE id=NEW.event_id),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id
     AND (SELECT status FROM run_list_commands WHERE id=NEW.id)='pending';

  UPDATE run_list_commands
     SET status='accepted',
         version_after=(SELECT run_list_version FROM auction_events WHERE id=NEW.event_id),
         result_current_lot_id=(SELECT current_lot_id FROM auction_events WHERE id=NEW.event_id),
         result_next_lot_id=(SELECT next_lot_id FROM auction_events WHERE id=NEW.event_id),
         result_lot_id=COALESCE(result_lot_id,NEW.lot_id),
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.operator_user)),
         'run_list:'||lower(NEW.command_type),
         'auction_events',NEW.event_id,'run-list-authority',
         json_object(
           'sessionId',NEW.session_id,
           'lotId',(SELECT result_lot_id FROM run_list_commands WHERE id=NEW.id),
           'auctionId',NEW.auction_id,
           'versionBefore',(SELECT version_before FROM run_list_commands WHERE id=NEW.id),
           'versionAfter',(SELECT version_after FROM run_list_commands WHERE id=NEW.id),
           'source',NEW.source
         ),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM run_list_commands WHERE id=NEW.id)='accepted';

  UPDATE run_list_commands
     SET completed_at=COALESCE(completed_at,strftime('%Y-%m-%dT%H:%M:%SZ','now')),
         version_after=COALESCE(version_after,version_before)
   WHERE id=NEW.id;
END;
