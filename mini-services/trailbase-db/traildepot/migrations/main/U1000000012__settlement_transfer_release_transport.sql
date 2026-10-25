-- TENGASELL-AUCTION-IMP-07
-- Auction settlement / statutory-transfer readiness / physical release / transport.
-- This is NOT a ledger. Existing Finance remains canonical for accounting.

CREATE TABLE IF NOT EXISTS auction_settlements (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id              INTEGER NOT NULL UNIQUE,
  auction_id            INTEGER NOT NULL UNIQUE,
  event_id              INTEGER,
  vehicle_id            INTEGER,
  buyer_user            BLOB NOT NULL,
  buyer_username        TEXT NOT NULL,
  seller_user           BLOB NOT NULL,
  seller_username       TEXT NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  hammer_price          REAL NOT NULL CHECK(hammer_price >= 0),
  invoice_total         REAL NOT NULL CHECK(invoice_total >= 0),
  paid_amount           REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
  outstanding_amount    REAL NOT NULL CHECK(outstanding_amount >= 0),
  payment_state         TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK(payment_state IN ('PENDING','PARTIALLY_PAID','PAID','FAILED','REFUNDED','DISPUTED')),
  settlement_deadline   TEXT,
  transfer_state        TEXT NOT NULL DEFAULT 'NOT_STARTED'
                        CHECK(transfer_state IN ('NOT_STARTED','DOCUMENTS_REQUIRED','UNDER_REVIEW','READY_FOR_TRANSFER','EXTERNAL_TRANSFER_PENDING','EVIDENCE_RECEIVED','COMPLETE','ON_HOLD')),
  dispute_state         TEXT NOT NULL DEFAULT 'NONE'
                        CHECK(dispute_state IN ('NONE','OPEN','RESOLVED')),
  release_state         TEXT NOT NULL DEFAULT 'BLOCKED'
                        CHECK(release_state IN ('BLOCKED','READY','AUTHORIZED','RELEASED','CANCELLED')),
  transport_state       TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
                        CHECK(transport_state IN ('NOT_REQUESTED','REQUESTED','SCHEDULED','PICKED_UP','DELIVERED','CANCELLED')),
  completion_state      TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK(completion_state IN ('OPEN','COMPLETE','CANCELLED')),
  finance_bridge_state  TEXT NOT NULL DEFAULT 'INVOICE_REQUIRED'
                        CHECK(finance_bridge_state IN ('INVOICE_REQUIRED','INVOICE_ACKNOWLEDGED','PAYMENT_PENDING','SETTLED','FAILED')),
  seller_payout_state   TEXT NOT NULL DEFAULT 'FINANCE_PENDING',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_settlement_buyer ON auction_settlements(buyer_user,payment_state);
CREATE INDEX IF NOT EXISTS idx_settlement_seller ON auction_settlements(seller_user,completion_state);

CREATE TABLE IF NOT EXISTS auction_invoice_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id  INTEGER NOT NULL,
  line_key       TEXT NOT NULL,
  label          TEXT NOT NULL,
  amount         REAL NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  source         TEXT NOT NULL,
  policy_key     TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE(settlement_id,line_key)
) STRICT;

CREATE TABLE IF NOT EXISTS auction_finance_bridge_outbox (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key      TEXT NOT NULL UNIQUE,
  settlement_id  INTEGER NOT NULL,
  order_id       INTEGER NOT NULL,
  event_type     TEXT NOT NULL,
  payload        TEXT NOT NULL DEFAULT '{}',
  occurred_at    TEXT NOT NULL,
  acknowledged_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_finance_bridge_pending ON auction_finance_bridge_outbox(acknowledged_at,id);

CREATE TABLE IF NOT EXISTS auction_finance_callbacks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  settlement_id    INTEGER NOT NULL,
  order_id         INTEGER NOT NULL,
  event_type       TEXT NOT NULL
                   CHECK(event_type IN ('INVOICE_ACKNOWLEDGED','PAYMENT_CAPTURED','PAYMENT_FAILED','PAYMENT_REFUNDED','DISPUTE_OPENED','DISPUTE_RESOLVED','SELLER_PAYOUT_STATUS')),
  amount           REAL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  source_reference TEXT,
  payout_state     TEXT,
  actor_user       BLOB NOT NULL,
  actor_username   TEXT NOT NULL,
  actor_admin      INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code       TEXT,
  received_at      TEXT NOT NULL DEFAULT '',
  completed_at     TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_transfer_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id  INTEGER NOT NULL,
  document_type  TEXT NOT NULL,
  document_ref   TEXT,
  status         TEXT NOT NULL DEFAULT 'REQUIRED'
                 CHECK(status IN ('REQUIRED','SUBMITTED','ACCEPTED','REJECTED','EXTERNAL_PENDING')),
  external_process INTEGER NOT NULL DEFAULT 0 CHECK(external_process IN (0,1)),
  rejection_reason TEXT,
  submitted_at   TEXT,
  reviewed_by    BLOB,
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE(settlement_id,document_type)
) STRICT;

CREATE TABLE IF NOT EXISTS auction_transfer_commands (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key      TEXT NOT NULL UNIQUE,
  settlement_id    INTEGER NOT NULL,
  actor_user       BLOB NOT NULL,
  actor_username   TEXT NOT NULL,
  actor_admin      INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  command_type     TEXT NOT NULL
                   CHECK(command_type IN ('START','REQUIRE_DOCUMENT','SUBMIT_DOCUMENT','ACCEPT_DOCUMENT','REJECT_DOCUMENT','MARK_READY','MARK_EXTERNAL_PENDING','EVIDENCE_RECEIVED','COMPLETE','HOLD')),
  document_type    TEXT,
  document_ref     TEXT,
  external_process INTEGER NOT NULL DEFAULT 0 CHECK(external_process IN (0,1)),
  reason           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code       TEXT,
  received_at      TEXT NOT NULL DEFAULT '',
  completed_at     TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_release_authorizations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id     INTEGER NOT NULL UNIQUE,
  vehicle_id        INTEGER,
  order_id          INTEGER NOT NULL,
  authorization_ref TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'AUTHORIZED'
                    CHECK(status IN ('AUTHORIZED','CANCELLED','USED')),
  collector_type    TEXT NOT NULL
                    CHECK(collector_type IN ('BUYER','REPRESENTATIVE','TRANSPORTER')),
  collector_user    BLOB,
  collector_name    TEXT NOT NULL,
  collector_reference TEXT,
  conditions        TEXT NOT NULL DEFAULT '',
  authorized_by     BLOB NOT NULL,
  authorized_by_username TEXT NOT NULL,
  authorized_at     TEXT NOT NULL,
  used_at           TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_release_commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key       TEXT NOT NULL UNIQUE,
  settlement_id     INTEGER NOT NULL,
  actor_user        BLOB NOT NULL,
  actor_username    TEXT NOT NULL,
  actor_admin       INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  collector_type    TEXT NOT NULL,
  collector_user    BLOB,
  collector_name    TEXT NOT NULL,
  collector_reference TEXT,
  conditions        TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code        TEXT,
  result_authorization_id INTEGER,
  received_at       TEXT NOT NULL DEFAULT '',
  completed_at      TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_transport_bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key      TEXT NOT NULL UNIQUE,
  settlement_id    INTEGER NOT NULL,
  requested_by     BLOB NOT NULL,
  requested_by_username TEXT NOT NULL,
  transporter      TEXT NOT NULL,
  transporter_reference TEXT,
  pickup_location  TEXT NOT NULL,
  destination      TEXT NOT NULL,
  scheduled_at     TEXT,
  status           TEXT NOT NULL DEFAULT 'REQUESTED'
                   CHECK(status IN ('REQUESTED','SCHEDULED','PICKED_UP','DELIVERED','CANCELLED')),
  handover_reference TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_handover_commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key       TEXT NOT NULL UNIQUE,
  settlement_id     INTEGER NOT NULL,
  actor_user        BLOB NOT NULL,
  actor_username    TEXT NOT NULL,
  actor_admin       INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  evidence_reference TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code        TEXT,
  result_handover_id INTEGER,
  received_at       TEXT NOT NULL DEFAULT '',
  completed_at      TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_handovers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id     INTEGER NOT NULL UNIQUE,
  vehicle_id        INTEGER,
  release_authorization_id INTEGER NOT NULL,
  collector_type    TEXT NOT NULL,
  collector_name    TEXT NOT NULL,
  collector_reference TEXT,
  operator_user     BLOB NOT NULL,
  operator_username TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  handed_over_at    TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_settlement_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id  INTEGER NOT NULL,
  event_type     TEXT NOT NULL,
  actor_user     BLOB,
  actor_username TEXT,
  payload        TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_settlement_events ON auction_settlement_events(settlement_id,id);

-- Every sold auction/order becomes exactly one settlement. Optional commercial
-- fees remain zero unless an explicit Finance/policy source later adds lines.
INSERT OR IGNORE INTO auction_settlements(
  order_id,auction_id,event_id,vehicle_id,buyer_user,buyer_username,seller_user,seller_username,
  hammer_price,invoice_total,paid_amount,outstanding_amount,payment_state,settlement_deadline,
  transfer_state,release_state,created_at,updated_at
)
SELECT o.id,o.auction_id,
       (SELECT event_id FROM auction_lots WHERE auction_id=o.auction_id LIMIT 1),
       (SELECT id FROM vehicles WHERE auction_id=o.auction_id LIMIT 1),
       o.buyer_user,o.buyer_username,o.seller_user,o.seller_username,
       o.final_price,o.final_price,
       CASE WHEN o.paid_at IS NULL THEN 0 ELSE o.final_price END,
       CASE WHEN o.paid_at IS NULL THEN o.final_price ELSE 0 END,
       CASE WHEN o.paid_at IS NULL THEN 'PENDING' ELSE 'PAID' END,
       o.pay_by,'NOT_STARTED','BLOCKED',
       o.created_at,o.updated_at
  FROM orders o
 WHERE o.auction_outcome_key IS NOT NULL;

INSERT OR IGNORE INTO auction_invoice_lines(settlement_id,line_key,label,amount,currency,source,created_at)
SELECT s.id,'HAMMER','Hammer price',s.hammer_price,s.currency,'AUCTION_OUTCOME',s.created_at
  FROM auction_settlements s;

INSERT OR IGNORE INTO auction_finance_bridge_outbox(event_key,settlement_id,order_id,event_type,payload,occurred_at)
SELECT 'invoice-required:'||s.order_id,s.id,s.order_id,'AUCTION_INVOICE_REQUIRED',
       json_object('orderId',s.order_id,'auctionId',s.auction_id,'hammerPrice',s.hammer_price,'currency',s.currency),
       s.created_at
  FROM auction_settlements s;

CREATE TRIGGER IF NOT EXISTS trg_outcome_create_settlement
AFTER INSERT ON auction_outcomes
WHEN NEW.outcome='sold' AND NEW.order_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO auction_settlements(
    order_id,auction_id,event_id,vehicle_id,buyer_user,buyer_username,seller_user,seller_username,
    hammer_price,invoice_total,paid_amount,outstanding_amount,payment_state,settlement_deadline,
    created_at,updated_at
  )
  SELECT o.id,o.auction_id,
         (SELECT event_id FROM auction_lots WHERE auction_id=o.auction_id LIMIT 1),
         (SELECT id FROM vehicles WHERE auction_id=o.auction_id LIMIT 1),
         o.buyer_user,o.buyer_username,o.seller_user,o.seller_username,
         o.final_price,o.final_price,0,o.final_price,'PENDING',o.pay_by,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM orders o WHERE o.id=NEW.order_id;

  INSERT OR IGNORE INTO auction_invoice_lines(settlement_id,line_key,label,amount,currency,source,created_at)
  SELECT s.id,'HAMMER','Hammer price',s.hammer_price,s.currency,'AUCTION_OUTCOME',
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.order_id=NEW.order_id;

  INSERT OR IGNORE INTO auction_finance_bridge_outbox(event_key,settlement_id,order_id,event_type,payload,occurred_at)
  SELECT 'invoice-required:'||s.order_id,s.id,s.order_id,'AUCTION_INVOICE_REQUIRED',
         json_object('orderId',s.order_id,'auctionId',s.auction_id,'hammerPrice',s.hammer_price,'currency',s.currency),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.order_id=NEW.order_id;

  INSERT INTO auction_settlement_events(settlement_id,event_type,payload,created_at)
  SELECT s.id,'SETTLEMENT_CREATED',json_object('orderId',s.order_id,'auctionId',s.auction_id),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.order_id=NEW.order_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_canonical_order_create_settlement
AFTER INSERT ON orders
WHEN NEW.auction_outcome_key IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO auction_settlements(
    order_id,auction_id,event_id,vehicle_id,buyer_user,buyer_username,seller_user,seller_username,
    hammer_price,invoice_total,paid_amount,outstanding_amount,payment_state,settlement_deadline,
    created_at,updated_at
  )
  VALUES(
    NEW.id,NEW.auction_id,
    (SELECT event_id FROM auction_lots WHERE auction_id=NEW.auction_id LIMIT 1),
    (SELECT id FROM vehicles WHERE auction_id=NEW.auction_id LIMIT 1),
    NEW.buyer_user,NEW.buyer_username,NEW.seller_user,NEW.seller_username,
    NEW.final_price,NEW.final_price,
    CASE WHEN NEW.paid_at IS NULL THEN 0 ELSE NEW.final_price END,
    CASE WHEN NEW.paid_at IS NULL THEN NEW.final_price ELSE 0 END,
    CASE WHEN NEW.paid_at IS NULL THEN 'PENDING' ELSE 'PAID' END,
    NEW.pay_by,
    strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );

  INSERT OR IGNORE INTO auction_invoice_lines(settlement_id,line_key,label,amount,currency,source,created_at)
  SELECT s.id,'HAMMER','Hammer price',s.hammer_price,s.currency,'AUCTION_OUTCOME',
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.order_id=NEW.id;

  INSERT OR IGNORE INTO auction_finance_bridge_outbox(event_key,settlement_id,order_id,event_type,payload,occurred_at)
  SELECT 'invoice-required:'||s.order_id,s.id,s.order_id,'AUCTION_INVOICE_REQUIRED',
         json_object('orderId',s.order_id,'auctionId',s.auction_id,'hammerPrice',s.hammer_price,'currency',s.currency),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.order_id=NEW.id;

  INSERT INTO auction_settlement_events(settlement_id,event_type,payload,created_at)
  SELECT s.id,'SETTLEMENT_CREATED',json_object('orderId',s.order_id,'auctionId',s.auction_id),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s
   WHERE s.order_id=NEW.id
     AND NOT EXISTS(
       SELECT 1 FROM auction_settlement_events e
        WHERE e.settlement_id=s.id AND e.event_type='SETTLEMENT_CREATED'
     );
END;

CREATE TRIGGER IF NOT EXISTS trg_outcome_order_link_create_settlement
AFTER UPDATE OF order_id ON auction_outcomes
WHEN NEW.outcome='sold' AND NEW.order_id IS NOT NULL AND OLD.order_id IS NULL
BEGIN
  INSERT OR IGNORE INTO auction_settlements(
    order_id,auction_id,event_id,vehicle_id,buyer_user,buyer_username,seller_user,seller_username,
    hammer_price,invoice_total,paid_amount,outstanding_amount,payment_state,settlement_deadline,
    created_at,updated_at
  )
  SELECT o.id,o.auction_id,
         (SELECT event_id FROM auction_lots WHERE auction_id=o.auction_id LIMIT 1),
         (SELECT id FROM vehicles WHERE auction_id=o.auction_id LIMIT 1),
         o.buyer_user,o.buyer_username,o.seller_user,o.seller_username,
         o.final_price,o.final_price,
         CASE WHEN o.paid_at IS NULL THEN 0 ELSE o.final_price END,
         CASE WHEN o.paid_at IS NULL THEN o.final_price ELSE 0 END,
         CASE WHEN o.paid_at IS NULL THEN 'PENDING' ELSE 'PAID' END,
         o.pay_by,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM orders o WHERE o.id=NEW.order_id;

  INSERT OR IGNORE INTO auction_invoice_lines(settlement_id,line_key,label,amount,currency,source,created_at)
  SELECT s.id,'HAMMER','Hammer price',s.hammer_price,s.currency,'AUCTION_OUTCOME',
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.order_id=NEW.order_id;

  INSERT OR IGNORE INTO auction_finance_bridge_outbox(event_key,settlement_id,order_id,event_type,payload,occurred_at)
  SELECT 'invoice-required:'||s.order_id,s.id,s.order_id,'AUCTION_INVOICE_REQUIRED',
         json_object('orderId',s.order_id,'auctionId',s.auction_id,'hammerPrice',s.hammer_price,'currency',s.currency),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.order_id=NEW.order_id;

  INSERT INTO auction_settlement_events(settlement_id,event_type,payload,created_at)
  SELECT s.id,'SETTLEMENT_CREATED',json_object('orderId',s.order_id,'auctionId',s.auction_id),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s
   WHERE s.order_id=NEW.order_id
     AND NOT EXISTS(
       SELECT 1 FROM auction_settlement_events e
        WHERE e.settlement_id=s.id AND e.event_type='SETTLEMENT_CREATED'
     );
END;

CREATE TRIGGER IF NOT EXISTS trg_finance_callback_process
AFTER INSERT ON auction_finance_callbacks
BEGIN
  UPDATE auction_finance_callbacks
     SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id;

  UPDATE auction_finance_callbacks SET status='rejected',error_code='FINANCE_AUTHORITY_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1;

  UPDATE auction_finance_callbacks SET status='rejected',error_code='SETTLEMENT_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM auction_settlements WHERE id=NEW.settlement_id AND order_id=NEW.order_id);

  UPDATE auction_finance_callbacks SET status='rejected',error_code='INVALID_PAYMENT_AMOUNT'
   WHERE id=NEW.id AND status='pending' AND NEW.event_type='PAYMENT_CAPTURED'
     AND (NEW.amount IS NULL OR NEW.amount<=0);

  UPDATE auction_settlements
     SET paid_amount=MIN(invoice_total,paid_amount+NEW.amount),
         outstanding_amount=MAX(0,invoice_total-(paid_amount+NEW.amount)),
         payment_state=CASE
           WHEN paid_amount+NEW.amount>=invoice_total THEN 'PAID'
           ELSE 'PARTIALLY_PAID'
         END,
         finance_bridge_state=CASE
           WHEN paid_amount+NEW.amount>=invoice_total THEN 'SETTLED'
           ELSE 'PAYMENT_PENDING'
         END,
         release_state=CASE
           WHEN paid_amount+NEW.amount>=invoice_total AND transfer_state='COMPLETE' AND dispute_state='NONE'
             THEN 'READY' ELSE 'BLOCKED' END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id
     AND NEW.event_type='PAYMENT_CAPTURED'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE orders
     SET status='paid',paid_at=COALESCE(paid_at,strftime('%Y-%m-%dT%H:%M:%SZ','now')),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.order_id AND NEW.event_type='PAYMENT_CAPTURED'
     AND (SELECT payment_state FROM auction_settlements WHERE id=NEW.settlement_id)='PAID'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET payment_state='FAILED',finance_bridge_state='FAILED',
         release_state='BLOCKED',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id AND NEW.event_type='PAYMENT_FAILED'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET payment_state='REFUNDED',paid_amount=0,outstanding_amount=invoice_total,
         finance_bridge_state='PAYMENT_PENDING',release_state='BLOCKED',
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id AND NEW.event_type='PAYMENT_REFUNDED'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET dispute_state='OPEN',payment_state='DISPUTED',release_state='BLOCKED',
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id AND NEW.event_type='DISPUTE_OPENED'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET dispute_state='RESOLVED',
         payment_state=CASE WHEN paid_amount>=invoice_total THEN 'PAID' ELSE 'PENDING' END,
         release_state=CASE WHEN paid_amount>=invoice_total AND transfer_state='COMPLETE' THEN 'READY' ELSE 'BLOCKED' END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id AND NEW.event_type='DISPUTE_RESOLVED'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET finance_bridge_state='INVOICE_ACKNOWLEDGED',
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id AND NEW.event_type='INVOICE_ACKNOWLEDGED'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET seller_payout_state=COALESCE(NEW.payout_state,seller_payout_state),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id AND NEW.event_type='SELLER_PAYOUT_STATUS'
     AND (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='pending';

  UPDATE auction_finance_callbacks
     SET status='accepted',completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO auction_settlement_events(settlement_id,event_type,actor_user,actor_username,payload,created_at)
  SELECT NEW.settlement_id,'FINANCE_'||NEW.event_type,NEW.actor_user,NEW.actor_username,
         json_object('reference',NEW.source_reference,'amount',NEW.amount,'currency',NEW.currency),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_finance_callbacks WHERE id=NEW.id)='accepted';
END;

CREATE TRIGGER IF NOT EXISTS trg_transfer_command_process
AFTER INSERT ON auction_transfer_commands
BEGIN
  UPDATE auction_transfer_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;
  UPDATE auction_transfer_commands SET status='rejected',error_code='TRANSFER_AUTHORITY_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1;
  UPDATE auction_transfer_commands SET status='rejected',error_code='SETTLEMENT_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NOT EXISTS(SELECT 1 FROM auction_settlements WHERE id=NEW.settlement_id);

  INSERT INTO auction_transfer_documents(
    settlement_id,document_type,document_ref,status,external_process,created_at,updated_at
  )
  SELECT NEW.settlement_id,NEW.document_type,NEW.document_ref,
         CASE NEW.command_type WHEN 'SUBMIT_DOCUMENT' THEN 'SUBMITTED' ELSE 'REQUIRED' END,
         NEW.external_process,strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE NEW.command_type IN ('REQUIRE_DOCUMENT','SUBMIT_DOCUMENT')
     AND NEW.document_type IS NOT NULL
     AND (SELECT status FROM auction_transfer_commands WHERE id=NEW.id)='pending'
  ON CONFLICT(settlement_id,document_type) DO UPDATE SET
    document_ref=COALESCE(excluded.document_ref,auction_transfer_documents.document_ref),
    status=excluded.status,external_process=excluded.external_process,
    submitted_at=CASE WHEN excluded.status='SUBMITTED' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE auction_transfer_documents.submitted_at END,
    updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now');

  UPDATE auction_transfer_documents
     SET status=CASE
           WHEN NEW.command_type='ACCEPT_DOCUMENT' THEN 'ACCEPTED'
           WHEN NEW.command_type='REJECT_DOCUMENT' THEN 'REJECTED'
           ELSE status END,
         rejection_reason=CASE WHEN NEW.command_type='REJECT_DOCUMENT' THEN NEW.reason ELSE NULL END,
         reviewed_by=NEW.actor_user,reviewed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE settlement_id=NEW.settlement_id AND document_type=NEW.document_type
     AND NEW.command_type IN ('ACCEPT_DOCUMENT','REJECT_DOCUMENT')
     AND (SELECT status FROM auction_transfer_commands WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET transfer_state=CASE NEW.command_type
           WHEN 'START' THEN 'DOCUMENTS_REQUIRED'
           WHEN 'REQUIRE_DOCUMENT' THEN 'DOCUMENTS_REQUIRED'
           WHEN 'SUBMIT_DOCUMENT' THEN 'UNDER_REVIEW'
           WHEN 'ACCEPT_DOCUMENT' THEN 'UNDER_REVIEW'
           WHEN 'REJECT_DOCUMENT' THEN 'DOCUMENTS_REQUIRED'
           WHEN 'MARK_READY' THEN 'READY_FOR_TRANSFER'
           WHEN 'MARK_EXTERNAL_PENDING' THEN 'EXTERNAL_TRANSFER_PENDING'
           WHEN 'EVIDENCE_RECEIVED' THEN 'EVIDENCE_RECEIVED'
           WHEN 'COMPLETE' THEN 'COMPLETE'
           WHEN 'HOLD' THEN 'ON_HOLD'
           ELSE transfer_state END,
         release_state=CASE
           WHEN NEW.command_type='COMPLETE' AND payment_state='PAID' AND dispute_state='NONE' THEN 'READY'
           ELSE CASE WHEN NEW.command_type='COMPLETE' THEN release_state ELSE 'BLOCKED' END END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id
     AND (SELECT status FROM auction_transfer_commands WHERE id=NEW.id)='pending';

  UPDATE auction_transfer_commands SET status='accepted',completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO auction_settlement_events(settlement_id,event_type,actor_user,actor_username,payload,created_at)
  SELECT NEW.settlement_id,'TRANSFER_'||NEW.command_type,NEW.actor_user,NEW.actor_username,
         json_object('documentType',NEW.document_type,'reason',NEW.reason),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_transfer_commands WHERE id=NEW.id)='accepted';
END;

CREATE TRIGGER IF NOT EXISTS trg_release_command_process
AFTER INSERT ON auction_release_commands
BEGIN
  UPDATE auction_release_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;
  UPDATE auction_release_commands SET status='rejected',error_code='RELEASE_AUTHORITY_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1;
  UPDATE auction_release_commands SET status='rejected',error_code='SETTLEMENT_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NOT EXISTS(SELECT 1 FROM auction_settlements WHERE id=NEW.settlement_id);
  UPDATE auction_release_commands SET status='rejected',error_code='PAYMENT_NOT_SETTLED'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS(SELECT 1 FROM auction_settlements WHERE id=NEW.settlement_id AND payment_state<>'PAID');
  UPDATE auction_release_commands SET status='rejected',error_code='TRANSFER_NOT_COMPLETE'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS(SELECT 1 FROM auction_settlements WHERE id=NEW.settlement_id AND transfer_state<>'COMPLETE');
  UPDATE auction_release_commands SET status='rejected',error_code='ACTIVE_DISPUTE'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS(SELECT 1 FROM auction_settlements WHERE id=NEW.settlement_id AND dispute_state='OPEN');
  UPDATE auction_release_commands SET status='rejected',error_code='COLLECTOR_REQUIRED'
   WHERE id=NEW.id AND status='pending'
     AND (NEW.collector_type NOT IN ('BUYER','REPRESENTATIVE','TRANSPORTER') OR length(trim(NEW.collector_name))<2);

  INSERT OR IGNORE INTO auction_release_authorizations(
    settlement_id,vehicle_id,order_id,authorization_ref,status,collector_type,collector_user,
    collector_name,collector_reference,conditions,authorized_by,authorized_by_username,authorized_at
  )
  SELECT s.id,s.vehicle_id,s.order_id,printf('REL-%08d',s.id),'AUTHORIZED',NEW.collector_type,NEW.collector_user,
         NEW.collector_name,NEW.collector_reference,COALESCE(NEW.conditions,''),
         NEW.actor_user,NEW.actor_username,strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s
   WHERE s.id=NEW.settlement_id
     AND (SELECT status FROM auction_release_commands WHERE id=NEW.id)='pending';

  UPDATE auction_settlements SET release_state='AUTHORIZED',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id AND (SELECT status FROM auction_release_commands WHERE id=NEW.id)='pending';

  UPDATE auction_release_commands
     SET status='accepted',
         result_authorization_id=(SELECT id FROM auction_release_authorizations WHERE settlement_id=NEW.settlement_id),
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO auction_settlement_events(settlement_id,event_type,actor_user,actor_username,payload,created_at)
  SELECT NEW.settlement_id,'RELEASE_AUTHORIZED',NEW.actor_user,NEW.actor_username,
         json_object('collectorType',NEW.collector_type,'collectorName',NEW.collector_name),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_release_commands WHERE id=NEW.id)='accepted';
END;

CREATE TRIGGER IF NOT EXISTS trg_transport_booking_state
AFTER INSERT ON auction_transport_bookings
BEGIN
  UPDATE auction_settlements
     SET transport_state=CASE WHEN NEW.scheduled_at IS NULL THEN 'REQUESTED' ELSE 'SCHEDULED' END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id;
  INSERT INTO auction_settlement_events(settlement_id,event_type,actor_user,actor_username,payload,created_at)
  VALUES(NEW.settlement_id,'TRANSPORT_REQUESTED',NEW.requested_by,NEW.requested_by_username,
         json_object('transporter',NEW.transporter,'destination',NEW.destination),
         strftime('%Y-%m-%dT%H:%M:%SZ','now'));
END;

CREATE TRIGGER IF NOT EXISTS trg_transport_booking_update
AFTER UPDATE OF status,scheduled_at ON auction_transport_bookings
BEGIN
  UPDATE auction_settlements
     SET transport_state=NEW.status,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id;

  INSERT INTO auction_settlement_events(settlement_id,event_type,actor_user,actor_username,payload,created_at)
  SELECT NEW.settlement_id,'TRANSPORT_'||NEW.status,NEW.requested_by,NEW.requested_by_username,
         json_object('transporter',NEW.transporter,'reference',NEW.transporter_reference),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE OLD.status<>NEW.status;
END;

CREATE TRIGGER IF NOT EXISTS trg_handover_command_process
AFTER INSERT ON auction_handover_commands
BEGIN
  UPDATE auction_handover_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;
  UPDATE auction_handover_commands SET status='rejected',error_code='HANDOVER_AUTHORITY_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1;
  UPDATE auction_handover_commands SET status='rejected',error_code='RELEASE_NOT_AUTHORIZED'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM auction_release_authorizations WHERE settlement_id=NEW.settlement_id AND status='AUTHORIZED');
  UPDATE auction_handover_commands SET status='rejected',error_code='HANDOVER_EVIDENCE_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND length(trim(NEW.evidence_reference))<3;

  INSERT OR IGNORE INTO auction_handovers(
    settlement_id,vehicle_id,release_authorization_id,collector_type,collector_name,collector_reference,
    operator_user,operator_username,evidence_reference,handed_over_at
  )
  SELECT s.id,s.vehicle_id,r.id,r.collector_type,r.collector_name,r.collector_reference,
         NEW.actor_user,NEW.actor_username,NEW.evidence_reference,strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s
    JOIN auction_release_authorizations r ON r.settlement_id=s.id AND r.status='AUTHORIZED'
   WHERE s.id=NEW.settlement_id
     AND (SELECT status FROM auction_handover_commands WHERE id=NEW.id)='pending';

  UPDATE auction_release_authorizations
     SET status='USED',used_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE settlement_id=NEW.settlement_id
     AND (SELECT status FROM auction_handover_commands WHERE id=NEW.id)='pending';

  UPDATE auction_settlements
     SET release_state='RELEASED',completion_state='COMPLETE',
         transport_state=CASE WHEN transport_state IN ('REQUESTED','SCHEDULED','PICKED_UP') THEN 'DELIVERED' ELSE transport_state END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.settlement_id
     AND (SELECT status FROM auction_handover_commands WHERE id=NEW.id)='pending';

  UPDATE auction_capacity_reservations
     SET status='SETTLED',release_reason='SETTLEMENT_COMPLETE',
         released_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE auction_id=(SELECT auction_id FROM auction_settlements WHERE id=NEW.settlement_id)
     AND status='WON_OBLIGATION'
     AND (SELECT status FROM auction_handover_commands WHERE id=NEW.id)='pending';

  UPDATE auction_handover_commands
     SET status='accepted',
         result_handover_id=(SELECT id FROM auction_handovers WHERE settlement_id=NEW.settlement_id),
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO auction_settlement_events(settlement_id,event_type,actor_user,actor_username,payload,created_at)
  SELECT NEW.settlement_id,'VEHICLE_HANDED_OVER',NEW.actor_user,NEW.actor_username,
         json_object('evidenceReference',NEW.evidence_reference),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_handover_commands WHERE id=NEW.id)='accepted';
END;
