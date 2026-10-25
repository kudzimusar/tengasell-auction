-- TENGASELL-AUCTION-IMP-06
-- Event-scoped bidder qualification + race-safe financial capacity authority.
-- Finance accounting remains outside this schema; this migration governs only
-- auction participation capacity/reservations and never posts ledger entries.

CREATE TABLE IF NOT EXISTS auction_bidder_qualifications (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id             INTEGER NOT NULL,
  user                 BLOB NOT NULL,
  username             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK(status IN ('PENDING','QUALIFIED','ON_HOLD','SUSPENDED','REJECTED','EXPIRED')),
  qualification_basis  TEXT NOT NULL DEFAULT 'MANUAL_REVIEW',
  approved_limit       REAL NOT NULL DEFAULT 0 CHECK(approved_limit >= 0),
  lot_limit            REAL CHECK(lot_limit IS NULL OR lot_limit >= 0),
  account_state        TEXT NOT NULL DEFAULT 'ELIGIBLE'
                       CHECK(account_state IN ('ELIGIBLE','ON_HOLD','SUSPENDED')),
  risk_state           TEXT NOT NULL DEFAULT 'CLEAR'
                       CHECK(risk_state IN ('CLEAR','REVIEW','ON_HOLD','SUSPENDED')),
  deposit_state        TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
                       CHECK(deposit_state IN ('NOT_REQUIRED','PENDING','CONFIRMED','HELD','REFUND_PENDING','REFUNDED','FORFEIT_REVIEW')),
  deposit_reference    TEXT,
  deposit_amount       REAL NOT NULL DEFAULT 0 CHECK(deposit_amount >= 0),
  credit_state         TEXT NOT NULL DEFAULT 'NONE'
                       CHECK(credit_state IN ('NONE','PENDING','APPROVED','SUSPENDED','REVOKED')),
  credit_limit         REAL NOT NULL DEFAULT 0 CHECK(credit_limit >= 0),
  reviewer_user        BLOB,
  reviewer_username    TEXT,
  reason_code          TEXT,
  expires_at           TEXT,
  version              INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE(event_id,user)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_bidder_qualification_event_status
  ON auction_bidder_qualifications(event_id,status,user);

CREATE TABLE IF NOT EXISTS auction_qualification_commands (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key          TEXT NOT NULL UNIQUE,
  event_id             INTEGER NOT NULL,
  target_user          BLOB NOT NULL,
  target_username      TEXT NOT NULL,
  actor_user           BLOB NOT NULL,
  actor_username       TEXT NOT NULL,
  actor_admin          INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  command_type         TEXT NOT NULL
                       CHECK(command_type IN ('REVIEW','APPROVE','HOLD','SUSPEND','REJECT','ADJUST_LIMIT','EXPIRE')),
  qualification_basis  TEXT,
  approved_limit       REAL,
  lot_limit            REAL,
  account_state        TEXT,
  risk_state           TEXT,
  deposit_state        TEXT,
  deposit_reference    TEXT,
  deposit_amount       REAL,
  credit_state         TEXT,
  credit_limit         REAL,
  reason_code          TEXT,
  expires_at           TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','accepted','rejected')),
  error_code           TEXT,
  result_qualification_id INTEGER,
  received_at          TEXT NOT NULL DEFAULT '',
  completed_at         TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_capacity_reservations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  qualification_id     INTEGER NOT NULL,
  event_id             INTEGER NOT NULL,
  auction_id           INTEGER NOT NULL,
  user                 BLOB NOT NULL,
  username             TEXT NOT NULL,
  reserved_amount      REAL NOT NULL CHECK(reserved_amount >= 0),
  status               TEXT NOT NULL DEFAULT 'ACTIVE'
                       CHECK(status IN ('ACTIVE','RELEASED','WON_OBLIGATION','SETTLED')),
  source_command_key   TEXT NOT NULL,
  release_reason       TEXT,
  released_at          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE(event_id,auction_id,user)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_capacity_reservation_user_event
  ON auction_capacity_reservations(event_id,user,status);

CREATE TABLE IF NOT EXISTS auction_bid_capacity_commands (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key          TEXT NOT NULL UNIQUE,
  auction_command_key  TEXT NOT NULL UNIQUE,
  event_id             INTEGER NOT NULL,
  auction_id           INTEGER NOT NULL,
  actor_user           BLOB NOT NULL,
  actor_username       TEXT NOT NULL,
  max_amount           REAL NOT NULL,
  expected_version     INTEGER,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending','accepted','rejected')),
  error_code           TEXT,
  qualification_id     INTEGER,
  approved_capacity    REAL,
  reserved_before      REAL,
  previous_reservation REAL,
  reserved_after       REAL,
  available_after      REAL,
  underlying_command_id INTEGER,
  result_price         REAL,
  result_winner_user   BLOB,
  result_winner_username TEXT,
  received_at          TEXT NOT NULL DEFAULT '',
  completed_at         TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_bid_capacity_event_user
  ON auction_bid_capacity_commands(event_id,actor_user,id);

CREATE TRIGGER IF NOT EXISTS trg_qualification_command_process
AFTER INSERT ON auction_qualification_commands
BEGIN
  UPDATE auction_qualification_commands
     SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id;

  UPDATE auction_qualification_commands SET status='rejected',error_code='QUALIFICATION_ADMIN_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1;

  UPDATE auction_qualification_commands SET status='rejected',error_code='EVENT_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM auction_events WHERE id=NEW.event_id);

  UPDATE auction_qualification_commands SET status='rejected',error_code='TARGET_USER_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM _user WHERE id=NEW.target_user);

  UPDATE auction_qualification_commands SET status='rejected',error_code='INVALID_APPROVED_LIMIT'
   WHERE id=NEW.id AND status='pending'
     AND NEW.command_type IN ('APPROVE','ADJUST_LIMIT')
     AND (NEW.approved_limit IS NULL OR NEW.approved_limit < 0);

  INSERT INTO auction_bidder_qualifications(
    event_id,user,username,status,qualification_basis,approved_limit,lot_limit,
    account_state,risk_state,deposit_state,deposit_reference,deposit_amount,
    credit_state,credit_limit,reviewer_user,reviewer_username,reason_code,expires_at,
    version,created_at,updated_at
  )
  SELECT NEW.event_id,NEW.target_user,NEW.target_username,
         CASE NEW.command_type
           WHEN 'APPROVE' THEN 'QUALIFIED'
           WHEN 'HOLD' THEN 'ON_HOLD'
           WHEN 'SUSPEND' THEN 'SUSPENDED'
           WHEN 'REJECT' THEN 'REJECTED'
           WHEN 'EXPIRE' THEN 'EXPIRED'
           ELSE 'PENDING'
         END,
         COALESCE(NULLIF(trim(NEW.qualification_basis),''),'MANUAL_REVIEW'),
         COALESCE(NEW.approved_limit,0),NEW.lot_limit,
         COALESCE(NEW.account_state,'ELIGIBLE'),
         COALESCE(NEW.risk_state,'CLEAR'),
         COALESCE(NEW.deposit_state,'NOT_REQUIRED'),
         NEW.deposit_reference,COALESCE(NEW.deposit_amount,0),
         COALESCE(NEW.credit_state,'NONE'),COALESCE(NEW.credit_limit,0),
         NEW.actor_user,NEW.actor_username,NEW.reason_code,NEW.expires_at,
         1,strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_qualification_commands WHERE id=NEW.id)='pending'
     AND NEW.command_type<>'ADJUST_LIMIT'
  ON CONFLICT(event_id,user) DO UPDATE SET
    username=excluded.username,
    status=excluded.status,
    qualification_basis=excluded.qualification_basis,
    approved_limit=CASE WHEN NEW.approved_limit IS NULL THEN auction_bidder_qualifications.approved_limit ELSE NEW.approved_limit END,
    lot_limit=CASE WHEN NEW.lot_limit IS NULL THEN auction_bidder_qualifications.lot_limit ELSE NEW.lot_limit END,
    account_state=COALESCE(NEW.account_state,auction_bidder_qualifications.account_state),
    risk_state=COALESCE(NEW.risk_state,auction_bidder_qualifications.risk_state),
    deposit_state=COALESCE(NEW.deposit_state,auction_bidder_qualifications.deposit_state),
    deposit_reference=COALESCE(NEW.deposit_reference,auction_bidder_qualifications.deposit_reference),
    deposit_amount=COALESCE(NEW.deposit_amount,auction_bidder_qualifications.deposit_amount),
    credit_state=COALESCE(NEW.credit_state,auction_bidder_qualifications.credit_state),
    credit_limit=COALESCE(NEW.credit_limit,auction_bidder_qualifications.credit_limit),
    reviewer_user=NEW.actor_user,
    reviewer_username=NEW.actor_username,
    reason_code=NEW.reason_code,
    expires_at=COALESCE(NEW.expires_at,auction_bidder_qualifications.expires_at),
    version=auction_bidder_qualifications.version+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now');

  UPDATE auction_bidder_qualifications
     SET approved_limit=NEW.approved_limit,
         lot_limit=COALESCE(NEW.lot_limit,lot_limit),
         reviewer_user=NEW.actor_user,
         reviewer_username=NEW.actor_username,
         reason_code=NEW.reason_code,
         version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND user=NEW.target_user
     AND NEW.command_type='ADJUST_LIMIT'
     AND (SELECT status FROM auction_qualification_commands WHERE id=NEW.id)='pending';

  UPDATE auction_qualification_commands
     SET status='rejected',error_code='QUALIFICATION_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type='ADJUST_LIMIT'
     AND NOT EXISTS(
       SELECT 1 FROM auction_bidder_qualifications
        WHERE event_id=NEW.event_id AND user=NEW.target_user
     );

  UPDATE auction_qualification_commands
     SET status='accepted',
         result_qualification_id=(
           SELECT id FROM auction_bidder_qualifications
            WHERE event_id=NEW.event_id AND user=NEW.target_user
         ),
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.actor_user)),'qualification:'||lower(NEW.command_type),
         'auction_bidder_qualifications',result_qualification_id,'commercial-authority',
         json_object('eventId',NEW.event_id,'target',NEW.target_username,'reasonCode',NEW.reason_code),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_qualification_commands
   WHERE id=NEW.id AND status='accepted';
END;

CREATE TRIGGER IF NOT EXISTS trg_qualification_status_release
AFTER UPDATE OF status ON auction_bidder_qualifications
WHEN NEW.status<>'QUALIFIED'
BEGIN
  UPDATE auction_capacity_reservations
     SET status='RELEASED',release_reason='QUALIFICATION_'||NEW.status,
         released_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND user=NEW.user AND status='ACTIVE';
END;

CREATE TRIGGER IF NOT EXISTS trg_bid_capacity_process
AFTER INSERT ON auction_bid_capacity_commands
BEGIN
  UPDATE auction_bid_capacity_commands
     SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         qualification_id=(
           SELECT q.id FROM auction_bidder_qualifications q
            WHERE q.event_id=NEW.event_id AND q.user=NEW.actor_user LIMIT 1
         ),
         approved_capacity=(
           SELECT q.approved_limit FROM auction_bidder_qualifications q
            WHERE q.event_id=NEW.event_id AND q.user=NEW.actor_user LIMIT 1
         ),
         reserved_before=COALESCE((
           SELECT SUM(r.reserved_amount) FROM auction_capacity_reservations r
            WHERE r.event_id=NEW.event_id AND r.user=NEW.actor_user
              AND r.status IN ('ACTIVE','WON_OBLIGATION')
         ),0),
         previous_reservation=COALESCE((
           SELECT r.reserved_amount FROM auction_capacity_reservations r
            WHERE r.event_id=NEW.event_id AND r.auction_id=NEW.auction_id
              AND r.user=NEW.actor_user AND r.status='ACTIVE' LIMIT 1
         ),0)
   WHERE id=NEW.id;

  UPDATE auction_bid_capacity_commands SET status='rejected',error_code='AUCTION_EVENT_MISMATCH'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(
       SELECT 1 FROM auction_lots
        WHERE event_id=NEW.event_id AND auction_id=NEW.auction_id
          AND status IN ('QUEUED','READY','LIVE')
     );

  UPDATE auction_bid_capacity_commands SET status='rejected',error_code='BIDDER_NOT_QUALIFIED'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(
       SELECT 1 FROM auction_bidder_qualifications q
        WHERE q.event_id=NEW.event_id AND q.user=NEW.actor_user
          AND q.status='QUALIFIED'
          AND q.account_state='ELIGIBLE'
          AND q.risk_state='CLEAR'
          AND q.approved_limit>0
          AND (q.expires_at IS NULL OR unixepoch(q.expires_at)>unixepoch('now'))
     );

  UPDATE auction_bid_capacity_commands SET status='rejected',error_code='LOT_BID_LIMIT_EXCEEDED'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS(
       SELECT 1 FROM auction_bidder_qualifications q
        WHERE q.event_id=NEW.event_id AND q.user=NEW.actor_user
          AND q.lot_limit IS NOT NULL AND NEW.max_amount>q.lot_limit
     );

  UPDATE auction_bid_capacity_commands SET status='rejected',error_code='INSUFFICIENT_BID_CAPACITY'
   WHERE id=NEW.id AND status='pending'
     AND NEW.max_amount > COALESCE((
       SELECT q.approved_limit
            - COALESCE((SELECT SUM(r.reserved_amount)
                          FROM auction_capacity_reservations r
                         WHERE r.event_id=NEW.event_id AND r.user=NEW.actor_user
                           AND r.status IN ('ACTIVE','WON_OBLIGATION')
                           AND r.auction_id<>NEW.auction_id),0)
         FROM auction_bidder_qualifications q
        WHERE q.event_id=NEW.event_id AND q.user=NEW.actor_user
     ),0);

  INSERT INTO auction_capacity_reservations(
    qualification_id,event_id,auction_id,user,username,reserved_amount,status,
    source_command_key,created_at,updated_at
  )
  SELECT qualification_id,NEW.event_id,NEW.auction_id,NEW.actor_user,NEW.actor_username,
         NEW.max_amount,'ACTIVE',NEW.command_key,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_bid_capacity_commands
   WHERE id=NEW.id AND status='pending'
  ON CONFLICT(event_id,auction_id,user) DO UPDATE SET
    qualification_id=excluded.qualification_id,
    username=excluded.username,
    reserved_amount=excluded.reserved_amount,
    status='ACTIVE',
    source_command_key=excluded.source_command_key,
    release_reason=NULL,
    released_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now');

  INSERT OR IGNORE INTO auction_commands(
    command_key,auction_id,actor_user,actor_username,actor_admin,command_type,
    max_amount,expected_version
  )
  SELECT NEW.auction_command_key,NEW.auction_id,NEW.actor_user,NEW.actor_username,0,
         'PLACE_BID',NEW.max_amount,NEW.expected_version
   WHERE (SELECT status FROM auction_bid_capacity_commands WHERE id=NEW.id)='pending';

  UPDATE auction_bid_capacity_commands
     SET underlying_command_id=(
           SELECT id FROM auction_commands WHERE command_key=NEW.auction_command_key
         ),
         status=CASE
           WHEN (SELECT status FROM auction_commands WHERE command_key=NEW.auction_command_key)='accepted'
             THEN 'accepted'
           ELSE 'rejected'
         END,
         error_code=CASE
           WHEN (SELECT status FROM auction_commands WHERE command_key=NEW.auction_command_key)='accepted'
             THEN NULL
           ELSE COALESCE((SELECT error_code FROM auction_commands WHERE command_key=NEW.auction_command_key),'AUCTION_COMMAND_REJECTED')
         END,
         result_price=(SELECT result_price FROM auction_commands WHERE command_key=NEW.auction_command_key),
         result_winner_user=(SELECT result_winner_user FROM auction_commands WHERE command_key=NEW.auction_command_key),
         result_winner_username=(SELECT result_winner_username FROM auction_commands WHERE command_key=NEW.auction_command_key)
   WHERE id=NEW.id AND status='pending';

  -- Restore the actor's previous reservation if the canonical auction command
  -- rejected. A first-time rejected command leaves no reservation.
  UPDATE auction_capacity_reservations
     SET reserved_amount=(SELECT previous_reservation FROM auction_bid_capacity_commands WHERE id=NEW.id),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND auction_id=NEW.auction_id AND user=NEW.actor_user
     AND (SELECT status FROM auction_bid_capacity_commands WHERE id=NEW.id)='rejected'
     AND (SELECT previous_reservation FROM auction_bid_capacity_commands WHERE id=NEW.id)>0;

  DELETE FROM auction_capacity_reservations
   WHERE event_id=NEW.event_id AND auction_id=NEW.auction_id AND user=NEW.actor_user
     AND (SELECT status FROM auction_bid_capacity_commands WHERE id=NEW.id)='rejected'
     AND (SELECT previous_reservation FROM auction_bid_capacity_commands WHERE id=NEW.id)=0;

  -- Accepted proxy bidding reserves capacity only for the current financially
  -- exposed leader. Outbid bidders are released immediately.
  UPDATE auction_capacity_reservations
     SET status='RELEASED',release_reason='OUTBID',
         released_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND auction_id=NEW.auction_id AND status='ACTIVE'
     AND (SELECT status FROM auction_bid_capacity_commands WHERE id=NEW.id)='accepted'
     AND user<>(SELECT result_winner_user FROM auction_bid_capacity_commands WHERE id=NEW.id);

  INSERT INTO auction_capacity_reservations(
    qualification_id,event_id,auction_id,user,username,reserved_amount,status,
    source_command_key,created_at,updated_at
  )
  SELECT q.id,NEW.event_id,NEW.auction_id,s.user,s.bidder_username,s.max_amount,'ACTIVE',
         NEW.command_key,strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_bid_capacity_commands c
    JOIN auction_standing_bids s
      ON s.auction_id=NEW.auction_id AND s.user=c.result_winner_user
    JOIN auction_bidder_qualifications q
      ON q.event_id=NEW.event_id AND q.user=s.user
   WHERE c.id=NEW.id AND c.status='accepted'
  ON CONFLICT(event_id,auction_id,user) DO UPDATE SET
    qualification_id=excluded.qualification_id,
    username=excluded.username,
    reserved_amount=excluded.reserved_amount,
    status='ACTIVE',
    source_command_key=excluded.source_command_key,
    release_reason=NULL,released_at=NULL,
    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now');

  UPDATE auction_bid_capacity_commands
     SET reserved_after=COALESCE((
           SELECT SUM(r.reserved_amount) FROM auction_capacity_reservations r
            WHERE r.event_id=NEW.event_id AND r.user=NEW.actor_user
              AND r.status IN ('ACTIVE','WON_OBLIGATION')
         ),0),
         available_after=MAX(0,COALESCE(approved_capacity,0)-COALESCE((
           SELECT SUM(r.reserved_amount) FROM auction_capacity_reservations r
            WHERE r.event_id=NEW.event_id AND r.user=NEW.actor_user
              AND r.status IN ('ACTIVE','WON_OBLIGATION')
         ),0)),
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id;

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.actor_user)),
         CASE WHEN status='accepted' THEN 'bid:qualified-capacity-accepted' ELSE 'bid:qualified-capacity-rejected' END,
         'auctions',NEW.auction_id,'commercial-authority',
         json_object('eventId',NEW.event_id,'commandKey',NEW.command_key,'status',status,'errorCode',error_code),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_bid_capacity_commands WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_capacity_outcome_transition
AFTER INSERT ON auction_outcomes
BEGIN
  UPDATE auction_capacity_reservations
     SET status='RELEASED',
         release_reason=CASE WHEN NEW.outcome='unsold' THEN 'AUCTION_UNSOLD' ELSE 'AUCTION_COMPLETED_NOT_WINNER' END,
         released_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE auction_id=NEW.auction_id AND status='ACTIVE'
     AND (NEW.outcome='unsold' OR user<>NEW.winner_user);

  UPDATE auction_capacity_reservations
     SET status='WON_OBLIGATION',
         reserved_amount=COALESCE(NEW.final_price,reserved_amount),
         release_reason=NULL,released_at=NULL,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE auction_id=NEW.auction_id AND user=NEW.winner_user
     AND status='ACTIVE' AND NEW.outcome='sold';
END;

CREATE TRIGGER IF NOT EXISTS trg_capacity_withdraw_release
AFTER UPDATE OF status ON auction_lots
WHEN NEW.status='WITHDRAWN' AND OLD.status<>'WITHDRAWN'
BEGIN
  UPDATE auction_capacity_reservations
     SET status='RELEASED',release_reason='LOT_WITHDRAWN',
         released_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE auction_id=NEW.auction_id AND status='ACTIVE';
END;
