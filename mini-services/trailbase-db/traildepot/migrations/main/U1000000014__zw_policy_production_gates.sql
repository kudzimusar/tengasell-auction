-- TENGASELL-AUCTION-IMP-09
-- Zimbabwe policy convergence, controlled retraction, policy registry,
-- production readiness gates, reserve disclosure and observability authority.

ALTER TABLE auctions ADD COLUMN reserve_notice_status TEXT NOT NULL DEFAULT 'NO_RESERVE'
  CHECK(reserve_notice_status IN ('NO_RESERVE','RESERVE_APPLIES'));
ALTER TABLE auctions ADD COLUMN owner_bid_notice_status TEXT NOT NULL DEFAULT 'OWNER_BIDDING_NOT_PERMITTED'
  CHECK(owner_bid_notice_status IN ('OWNER_BIDDING_NOT_PERMITTED','OWNER_BIDDING_DISCLOSED'));

UPDATE auctions
   SET reserve_notice_status=CASE WHEN reserve_price IS NULL THEN 'NO_RESERVE' ELSE 'RESERVE_APPLIES' END;

CREATE TRIGGER IF NOT EXISTS trg_auction_reserve_notice_insert
AFTER INSERT ON auctions
BEGIN
  UPDATE auctions
     SET reserve_notice_status=CASE WHEN NEW.reserve_price IS NULL THEN 'NO_RESERVE' ELSE 'RESERVE_APPLIES' END
   WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_auction_reserve_notice_update
AFTER UPDATE OF reserve_price ON auctions
BEGIN
  UPDATE auctions
     SET reserve_notice_status=CASE WHEN NEW.reserve_price IS NULL THEN 'NO_RESERVE' ELSE 'RESERVE_APPLIES' END
   WHERE id=NEW.id;
END;

CREATE TABLE IF NOT EXISTS auction_policy_registry (
  policy_key              TEXT PRIMARY KEY,
  classification          TEXT NOT NULL CHECK(classification IN (
    'LEGALLY_REQUIRED','BUSINESS_POLICY','CONFIGURABLE','PENDING_LEGAL_REVIEW','UNKNOWN'
  )),
  value_json              TEXT,
  status                  TEXT NOT NULL DEFAULT 'PENDING_OWNER'
                          CHECK(status IN ('CONFIGURED','PENDING_OWNER','PENDING_LEGAL_REVIEW','UNKNOWN','RETIRED')),
  required_for_production INTEGER NOT NULL DEFAULT 0 CHECK(required_for_production IN (0,1)),
  source_ref              TEXT,
  rationale               TEXT NOT NULL DEFAULT '',
  version                 INTEGER NOT NULL DEFAULT 1,
  updated_by              BLOB,
  updated_by_username     TEXT,
  updated_at              TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_policy_commands (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key        TEXT NOT NULL UNIQUE,
  policy_key         TEXT NOT NULL,
  actor_user         BLOB NOT NULL,
  actor_username     TEXT NOT NULL,
  actor_admin        INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  value_json         TEXT,
  status_value       TEXT,
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code         TEXT,
  received_at        TEXT NOT NULL DEFAULT '',
  completed_at       TEXT
) STRICT;

INSERT OR IGNORE INTO auction_policy_registry(
  policy_key,classification,value_json,status,required_for_production,source_ref,rationale,updated_at
) VALUES
('zw.auction.bid_retraction',
 'LEGALLY_REQUIRED',
 '{"rightBeforeCompletion":true,"workflow":"REQUEST_REVIEW_EXECUTE","directVehicleUndo":false}',
 'CONFIGURED',1,
 'Consumer Protection Act [Chapter 14:44], s39(3)',
 'Vehicle-auction bids may be retracted before hammer/customary completion. Tengasell uses a durable request/evaluation/authorized execution workflow.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('zw.auction.reserve_notice',
 'LEGALLY_REQUIRED',
 '{"advanceReserveNoticeRequired":true,"privateReserveAmountMayRemainPrivate":true}',
 'CONFIGURED',1,
 'Consumer Protection Act [Chapter 14:44], s39(4)',
 'Advance notice is required when an auction is subject to a reserve/upset price. The implementation discloses reserve applicability without exposing the amount.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('zw.auction.owner_bidding',
 'LEGALLY_REQUIRED',
 '{"ownerBiddingPermitted":false,"advanceNoticeRequiredIfEnabledLater":true}',
 'CONFIGURED',1,
 'Consumer Protection Act [Chapter 14:44], s39(4)-(5)',
 'Owner/auctioneer bidding remains prohibited in Tengasell vehicle auctions unless a future reviewed policy explicitly enables and discloses it.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('zw.ecommerce.supplier_disclosures',
 'LEGALLY_REQUIRED',
 '{"supplierIdentity":true,"goodsDescription":true,"fullPriceAndFees":true,"paymentMethod":true,"terms":true,"delivery":true,"recordAccess":true,"refundPolicy":true,"privacySecurity":true}',
 'CONFIGURED',1,
 'Consumer Protection Act [Chapter 14:44], s52',
 'Electronic transaction surfaces must make the statutory supplier/transaction information available and provide review/correction/withdrawal before final order placement.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('zw.ecommerce.cooling_off',
 'PENDING_LEGAL_REVIEW',
 '{"generalElectronicTransactionPeriodDays":7,"generalRefundDeadlineDays":14}',
 'PENDING_LEGAL_REVIEW',1,
 'Consumer Protection Act [Chapter 14:44], s53',
 'The Act states a general electronic-transaction cooling-off right. Vehicle-auction interaction with auction completion and downstream transfer requires Zimbabwe counsel sign-off before Production wording/default handling.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('zw.vehicle.change_of_ownership',
 'LEGALLY_REQUIRED',
 '{"externalProcess":true,"sellerTransferWindowDays":14,"cvr4Required":true,"policeClearanceRequired":true}',
 'CONFIGURED',1,
 'ZIMRA change-of-ownership guidance citing Vehicle and Licensing Act s13; CVR requirements',
 'Commercial auction completion is not statutory registration transfer. The product must retain EXTERNAL_PROCESS_PENDING until transfer evidence is received.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('zw.vehicle.customs_clearance_verification',
 'BUSINESS_POLICY',
 '{"verificationBeforePaymentRecommended":true,"externalAuthority":"ZIMRA"}',
 'CONFIGURED',1,
 'ZIMRA Public Notice 35/2026',
 'For second-hand vehicles, ZIMRA advises clearance verification before payment. Tengasell represents this as an external verification/evidence step rather than automated legal clearance.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('auction.duration',
 'CONFIGURABLE',NULL,'PENDING_OWNER',1,NULL,
 'Owner policy required. No Production auction duration is inferred from historic demo/default behavior.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('auction.anti_snipe',
 'CONFIGURABLE',NULL,'PENDING_OWNER',1,NULL,
 'Owner policy required. LR01 behavior remains a non-Production implementation default until explicitly configured.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('auction.hammer',
 'CONFIGURABLE',NULL,'PENDING_OWNER',1,NULL,
 'Owner policy required for Production hammer behavior. Existing LR01 live mechanics remain pre-certification behavior.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('qualification.requirements',
 'CONFIGURABLE',NULL,'PENDING_OWNER',1,NULL,
 'Owner policy required. Identity/trust, deposit and credit conditions are configurable and must not be invented.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('deposit.rules',
 'CONFIGURABLE',NULL,'PENDING_OWNER',1,NULL,
 'Owner policy required. No deposit percentage, fixed amount or forfeiture is implied.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('payment.deadline',
 'CONFIGURABLE',NULL,'PENDING_OWNER',1,NULL,
 'Owner policy required. Historic 48-hour behavior is not promoted to Production policy.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('auction.fees',
 'CONFIGURABLE',NULL,'PENDING_OWNER',1,NULL,
 'Owner/Finance policy required. No buyer fee, inspection charge, tax rate or auction commission is invented.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('release.prerequisites',
 'BUSINESS_POLICY',
 '{"paymentSettled":true,"transferComplete":true,"noActiveDispute":true,"releaseAuthorization":true,"collectorIdentified":true}',
 'CONFIGURED',1,NULL,
 'Fail-closed physical release policy implemented in IMP-07. Finance escrow/payout release is a separate financial event.',
 strftime('%Y-%m-%dT%H:%M:%SZ','now'));

CREATE TRIGGER IF NOT EXISTS trg_policy_command_process
AFTER INSERT ON auction_policy_commands
BEGIN
  UPDATE auction_policy_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;

  UPDATE auction_policy_commands SET status='rejected',error_code='POLICY_ADMIN_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1;

  UPDATE auction_policy_commands SET status='rejected',error_code='POLICY_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM auction_policy_registry WHERE policy_key=NEW.policy_key);

  UPDATE auction_policy_commands SET status='rejected',error_code='POLICY_REASON_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND length(trim(NEW.reason))<5;

  UPDATE auction_policy_commands SET status='rejected',error_code='POLICY_STATUS_INVALID'
   WHERE id=NEW.id AND status='pending'
     AND NEW.status_value NOT IN ('CONFIGURED','PENDING_OWNER','PENDING_LEGAL_REVIEW','UNKNOWN','RETIRED');

  UPDATE auction_policy_registry
     SET value_json=NEW.value_json,
         status=NEW.status_value,
         version=version+1,
         updated_by=NEW.actor_user,
         updated_by_username=NEW.actor_username,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE policy_key=NEW.policy_key
     AND (SELECT status FROM auction_policy_commands WHERE id=NEW.id)='pending';

  UPDATE auction_policy_commands
     SET status='accepted',completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.actor_user)),'auction_policy:update','auction_policy_registry',NULL,'policy-authority',
         json_object('policyKey',NEW.policy_key,'status',NEW.status_value,'reason',NEW.reason),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_policy_commands WHERE id=NEW.id)='accepted';
END;

CREATE TABLE IF NOT EXISTS auction_retraction_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key        TEXT NOT NULL UNIQUE,
  auction_id         INTEGER NOT NULL,
  bid_id             INTEGER NOT NULL,
  requester_user     BLOB NOT NULL,
  requester_username TEXT NOT NULL,
  reason             TEXT NOT NULL,
  eligibility        TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK(eligibility IN ('PENDING','ELIGIBLE','INELIGIBLE')),
  eligibility_code   TEXT,
  status             TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                     CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','EXECUTED','INELIGIBLE')),
  requested_at       TEXT NOT NULL DEFAULT '',
  decided_by         BLOB,
  decided_by_username TEXT,
  decision_reason    TEXT,
  decided_at         TEXT,
  executed_command_id INTEGER,
  executed_at        TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_retraction_requests_review ON auction_retraction_requests(status,auction_id,id);

CREATE TABLE IF NOT EXISTS auction_retraction_decisions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key        TEXT NOT NULL UNIQUE,
  request_id         INTEGER NOT NULL,
  actor_user         BLOB NOT NULL,
  actor_username     TEXT NOT NULL,
  actor_authorized   INTEGER NOT NULL DEFAULT 0 CHECK(actor_authorized IN (0,1)),
  decision           TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code         TEXT,
  received_at        TEXT NOT NULL DEFAULT '',
  completed_at       TEXT
) STRICT;

CREATE TRIGGER IF NOT EXISTS trg_vehicle_direct_retract_requires_request
BEFORE INSERT ON auction_commands
WHEN NEW.command_type='RETRACT_BID'
 AND NEW.actor_admin=0
 AND EXISTS(SELECT 1 FROM auctions WHERE id=NEW.auction_id AND asset_kind='vehicle')
BEGIN
  SELECT RAISE(ABORT,'VEHICLE_RETRACTION_REQUEST_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_retraction_request_evaluate
AFTER INSERT ON auction_retraction_requests
BEGIN
  UPDATE auction_retraction_requests
     SET requested_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         eligibility='INELIGIBLE',status='INELIGIBLE',eligibility_code='AUCTION_NOT_LIVE'
   WHERE id=NEW.id
     AND NOT EXISTS(SELECT 1 FROM auctions WHERE id=NEW.auction_id AND status='live');

  UPDATE auction_retraction_requests
     SET eligibility='INELIGIBLE',status='INELIGIBLE',eligibility_code='AUCTION_ALREADY_COMPLETED'
   WHERE id=NEW.id AND eligibility='PENDING'
     AND EXISTS(SELECT 1 FROM auction_outcomes WHERE auction_id=NEW.auction_id);

  UPDATE auction_retraction_requests
     SET eligibility='INELIGIBLE',status='INELIGIBLE',eligibility_code='BID_NOT_ACTIVE'
   WHERE id=NEW.id AND eligibility='PENDING'
     AND NOT EXISTS(
       SELECT 1 FROM bids
        WHERE id=NEW.bid_id AND auction_id=NEW.auction_id AND status='active'
     );

  UPDATE auction_retraction_requests
     SET eligibility='INELIGIBLE',status='INELIGIBLE',eligibility_code='BID_NOT_OWNED'
   WHERE id=NEW.id AND eligibility='PENDING'
     AND EXISTS(
       SELECT 1 FROM bids
        WHERE id=NEW.bid_id AND auction_id=NEW.auction_id AND user<>NEW.requester_user
     );

  UPDATE auction_retraction_requests
     SET eligibility='INELIGIBLE',status='INELIGIBLE',eligibility_code='REASON_REQUIRED'
   WHERE id=NEW.id AND eligibility='PENDING' AND length(trim(NEW.reason))<10;

  UPDATE auction_retraction_requests
     SET eligibility='ELIGIBLE',status='PENDING_REVIEW',eligibility_code='BEFORE_AUCTION_COMPLETION'
   WHERE id=NEW.id AND eligibility='PENDING';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.requester_user)),'bid:retraction-request','auction_retraction_requests',NEW.id,'policy-authority',
         json_object('auctionId',NEW.auction_id,'bidId',NEW.bid_id,'eligibility',eligibility,'eligibilityCode',eligibility_code),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_retraction_requests WHERE id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_retraction_decision_process
AFTER INSERT ON auction_retraction_decisions
BEGIN
  UPDATE auction_retraction_decisions SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;

  UPDATE auction_retraction_decisions SET status='rejected',error_code='RETRACTION_REVIEW_AUTHORITY_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_authorized<>1;

  UPDATE auction_retraction_decisions SET status='rejected',error_code='RETRACTION_REQUEST_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM auction_retraction_requests WHERE id=NEW.request_id);

  UPDATE auction_retraction_decisions SET status='rejected',error_code='RETRACTION_REQUEST_NOT_REVIEWABLE'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS(
       SELECT 1 FROM auction_retraction_requests
        WHERE id=NEW.request_id AND status<>'PENDING_REVIEW'
     );

  UPDATE auction_retraction_decisions SET status='rejected',error_code='RETRACTION_NOT_ELIGIBLE'
   WHERE id=NEW.id AND status='pending' AND NEW.decision='APPROVE'
     AND EXISTS(
       SELECT 1 FROM auction_retraction_requests
        WHERE id=NEW.request_id AND eligibility<>'ELIGIBLE'
     );

  UPDATE auction_retraction_decisions SET status='rejected',error_code='DECISION_REASON_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND length(trim(NEW.reason))<5;

  UPDATE auction_retraction_requests
     SET status=CASE WHEN NEW.decision='APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
         decided_by=NEW.actor_user,decided_by_username=NEW.actor_username,
         decision_reason=substr(trim(NEW.reason),1,240),
         decided_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.request_id
     AND (SELECT status FROM auction_retraction_decisions WHERE id=NEW.id)='pending';

  INSERT INTO auction_commands(
    command_key,auction_id,actor_user,actor_username,actor_admin,command_type,target_bid_id,reason,expected_version
  )
  SELECT 'policy-retract:'||r.request_key,r.auction_id,r.requester_user,r.requester_username,1,
         'RETRACT_BID',r.bid_id,r.reason,a.version
    FROM auction_retraction_requests r JOIN auctions a ON a.id=r.auction_id
   WHERE r.id=NEW.request_id AND NEW.decision='APPROVE'
     AND (SELECT status FROM auction_retraction_decisions WHERE id=NEW.id)='pending';

  UPDATE auction_retraction_requests
     SET executed_command_id=(
           SELECT id FROM auction_commands WHERE command_key='policy-retract:'||request_key
         ),
         status=CASE
           WHEN NEW.decision='APPROVE'
            AND EXISTS(
              SELECT 1 FROM auction_commands c
               WHERE c.command_key='policy-retract:'||auction_retraction_requests.request_key
                 AND c.status='accepted'
            )
           THEN 'EXECUTED'
           ELSE status END,
         executed_at=CASE
           WHEN NEW.decision='APPROVE'
            AND EXISTS(
              SELECT 1 FROM auction_commands c
               WHERE c.command_key='policy-retract:'||auction_retraction_requests.request_key
                 AND c.status='accepted'
            )
           THEN strftime('%Y-%m-%dT%H:%M:%SZ','now')
           ELSE executed_at END
   WHERE id=NEW.request_id;

  UPDATE auction_retraction_decisions
     SET status=CASE
       WHEN NEW.decision='APPROVE'
        AND NOT EXISTS(
          SELECT 1 FROM auction_commands c
           JOIN auction_retraction_requests r ON r.id=NEW.request_id
          WHERE c.command_key='policy-retract:'||r.request_key AND c.status='accepted'
        )
       THEN 'rejected'
       ELSE 'accepted' END,
       error_code=CASE
       WHEN NEW.decision='APPROVE'
        AND NOT EXISTS(
          SELECT 1 FROM auction_commands c
           JOIN auction_retraction_requests r ON r.id=NEW.request_id
          WHERE c.command_key='policy-retract:'||r.request_key AND c.status='accepted'
        )
       THEN COALESCE((
          SELECT c.error_code FROM auction_commands c
          JOIN auction_retraction_requests r ON r.id=NEW.request_id
          WHERE c.command_key='policy-retract:'||r.request_key
        ),'RETRACTION_EXECUTION_FAILED')
       ELSE NULL END,
       completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.actor_user)),'bid:retraction-decision','auction_retraction_requests',NEW.request_id,'policy-authority',
         json_object('decision',NEW.decision,'decisionStatus',status,'errorCode',error_code,'reason',NEW.reason),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_retraction_decisions WHERE id=NEW.id;
END;

CREATE TABLE IF NOT EXISTS auction_production_gate_attestations (
  gate_key       TEXT PRIMARY KEY,
  required       INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
  status         TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(status IN ('UNKNOWN','PASS','FAIL')),
  detail         TEXT NOT NULL DEFAULT '',
  checked_by     BLOB,
  checked_by_username TEXT,
  checked_at     TEXT,
  updated_at     TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_gate_commands (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key    TEXT NOT NULL UNIQUE,
  gate_key       TEXT NOT NULL,
  actor_user     BLOB NOT NULL,
  actor_username TEXT NOT NULL,
  actor_admin    INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  gate_status    TEXT NOT NULL CHECK(gate_status IN ('PASS','FAIL','UNKNOWN')),
  detail         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code     TEXT,
  received_at    TEXT NOT NULL DEFAULT '',
  completed_at   TEXT
) STRICT;

INSERT OR IGNORE INTO auction_production_gate_attestations(gate_key,required,status,detail,updated_at) VALUES
('CANONICAL_DATABASE',1,'UNKNOWN','Must attest canonical TrailBase database configuration.',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('TRADE_ENGINE_HEALTHY',1,'UNKNOWN','Must attest canonical trade engine health.',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('FINANCE_HEALTHY',1,'UNKNOWN','Must attest Finance integration health.',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('TRUST_QUALIFICATION_HEALTHY',1,'UNKNOWN','Must attest Trust/qualification health.',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('COMMS_AVAILABLE',1,'UNKNOWN','Must attest required transactional communications availability.',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('MIGRATIONS_CURRENT',1,'UNKNOWN','Must attest canonical migrations current at deploy target.',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('OPERATOR_AUTHORITY_PRESENT',1,'UNKNOWN','Must attest required operator authority exists.',strftime('%Y-%m-%dT%H:%M:%SZ','now')),
('NO_LOCAL_COMMERCIAL_FALLBACK',1,'UNKNOWN','Must attest commercial mutation cannot fall back to LocalStore/demo.',strftime('%Y-%m-%dT%H:%M:%SZ','now'));

CREATE TRIGGER IF NOT EXISTS trg_gate_command_process
AFTER INSERT ON auction_gate_commands
BEGIN
  UPDATE auction_gate_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;

  UPDATE auction_gate_commands SET status='rejected',error_code='GATE_ADMIN_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1;

  UPDATE auction_gate_commands SET status='rejected',error_code='GATE_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM auction_production_gate_attestations WHERE gate_key=NEW.gate_key);

  UPDATE auction_gate_commands SET status='rejected',error_code='GATE_DETAIL_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND length(trim(NEW.detail))<5;

  UPDATE auction_production_gate_attestations
     SET status=NEW.gate_status,detail=substr(trim(NEW.detail),1,500),
         checked_by=NEW.actor_user,checked_by_username=NEW.actor_username,
         checked_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE gate_key=NEW.gate_key
     AND (SELECT status FROM auction_gate_commands WHERE id=NEW.id)='pending';

  UPDATE auction_gate_commands
     SET status='accepted',completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.actor_user)),'production_gate:attest','auction_production_gate_attestations',NULL,'policy-authority',
         json_object('gateKey',NEW.gate_key,'gateStatus',NEW.gate_status,'detail',NEW.detail),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_gate_commands WHERE id=NEW.id)='accepted';
END;

CREATE TABLE IF NOT EXISTS auction_operational_signals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_key     TEXT NOT NULL,
  signal_type    TEXT NOT NULL CHECK(signal_type IN (
    'BID_PROCESSING','FINALIZATION','OUTBOX','FINANCE_BRIDGE','QUALIFICATION',
    'SETTLEMENT','RELEASE','EVENT_RUN_LIST','PRODUCTION_GATE'
  )),
  severity       TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  entity_type    TEXT,
  entity_id      INTEGER,
  metric_value   REAL,
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_operational_signals_recent ON auction_operational_signals(signal_type,created_at,id);

CREATE TRIGGER IF NOT EXISTS trg_capacity_rejection_signal
AFTER INSERT ON auction_bid_capacity_commands
WHEN NEW.status='rejected'
BEGIN
  INSERT INTO auction_operational_signals(
    signal_key,signal_type,severity,entity_type,entity_id,detail,created_at
  ) VALUES(
    'capacity:'||NEW.id,'QUALIFICATION',
    CASE WHEN NEW.error_code='INSUFFICIENT_BID_CAPACITY' THEN 'INFO' ELSE 'WARNING' END,
    'auction',NEW.auction_id,
    COALESCE(NEW.error_code,'QUALIFIED_BID_REJECTED'),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_finance_failure_signal
AFTER UPDATE OF status ON auction_finance_callbacks
WHEN NEW.status='rejected' AND OLD.status<>'rejected'
BEGIN
  INSERT INTO auction_operational_signals(
    signal_key,signal_type,severity,entity_type,entity_id,detail,created_at
  ) VALUES(
    'finance-callback:'||NEW.id,'FINANCE_BRIDGE','WARNING','settlement',NEW.settlement_id,
    COALESCE(NEW.error_code,'FINANCE_CALLBACK_REJECTED'),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_release_block_signal
AFTER INSERT ON auction_release_commands
WHEN NEW.status='rejected'
BEGIN
  INSERT INTO auction_operational_signals(
    signal_key,signal_type,severity,entity_type,entity_id,detail,created_at
  ) VALUES(
    'release:'||NEW.id,'RELEASE','INFO','settlement',NEW.settlement_id,
    COALESCE(NEW.error_code,'RELEASE_BLOCKED'),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;
