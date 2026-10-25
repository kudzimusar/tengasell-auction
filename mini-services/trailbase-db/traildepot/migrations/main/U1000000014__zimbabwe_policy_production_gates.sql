-- TENGASELL-AUCTION-IMP-09
-- Zimbabwe policy convergence, policy-aware vehicle bid retraction,
-- production readiness gates and privacy-safe observability.

ALTER TABLE auctions ADD COLUMN reserve_disclosure TEXT NOT NULL DEFAULT 'UNSPECIFIED'
  CHECK(reserve_disclosure IN ('UNSPECIFIED','NO_RESERVE','RESERVE_APPLIES','UPSET_APPLIES'));
ALTER TABLE auctions ADD COLUMN owner_bid_right_disclosure TEXT NOT NULL DEFAULT 'NOT_PERMITTED'
  CHECK(owner_bid_right_disclosure IN ('NOT_PERMITTED','DISCLOSED'));
ALTER TABLE auctions ADD COLUMN policy_profile_key TEXT NOT NULL DEFAULT 'ZW_VEHICLE_AUCTION_V1';
ALTER TABLE auctions ADD COLUMN commercial_policy_ready INTEGER NOT NULL DEFAULT 0 CHECK(commercial_policy_ready IN (0,1));

-- Public auction reads are a redacted view. Private reserve amounts stay in
-- the canonical auctions table and are available only to server/admin/seller
-- authority; public clients see only the disclosure classification.
CREATE VIEW IF NOT EXISTS auction_public AS
SELECT
  id,
  user,
  seller_username,
  title,
  slug,
  description,
  category,
  condition,
  start_price,
  current_price,
  buy_now_price,
  bid_count,
  watch_count,
  views,
  shipping_fee,
  shipping,
  city,
  ends_at,
  started_at,
  status,
  extension_count,
  featured,
  images,
  created_at,
  updated_at,
  allow_offers,
  offer_min,
  live_session_id,
  version,
  finalized_at,
  outcome,
  final_order_id,
  asset_kind,
  reserve_disclosure,
  owner_bid_right_disclosure,
  policy_profile_key,
  commercial_policy_ready
FROM auctions;

CREATE TABLE IF NOT EXISTS auction_policy_registry (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key             TEXT NOT NULL UNIQUE,
  value_json             TEXT,
  classification         TEXT NOT NULL CHECK(classification IN (
    'LEGALLY_REQUIRED','BUSINESS_POLICY','CONFIGURABLE','PENDING_LEGAL_REVIEW','UNKNOWN'
  )),
  configured             INTEGER NOT NULL DEFAULT 0 CHECK(configured IN (0,1)),
  required_for_production INTEGER NOT NULL DEFAULT 0 CHECK(required_for_production IN (0,1)),
  source_title           TEXT,
  source_url             TEXT,
  source_checked_at      TEXT,
  notes                  TEXT,
  updated_by             BLOB,
  updated_by_username    TEXT,
  updated_at             TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_policy_commands (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key     TEXT NOT NULL UNIQUE,
  policy_key      TEXT NOT NULL,
  actor_user      BLOB NOT NULL,
  actor_username  TEXT NOT NULL,
  actor_admin     INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  value_json      TEXT,
  classification TEXT,
  configured      INTEGER CHECK(configured IN (0,1)),
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code      TEXT,
  received_at     TEXT NOT NULL DEFAULT '',
  completed_at    TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_service_health (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  service_key      TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'UNKNOWN'
                   CHECK(status IN ('HEALTHY','DEGRADED','UNAVAILABLE','UNKNOWN','DISABLED')),
  critical         INTEGER NOT NULL DEFAULT 1 CHECK(critical IN (0,1)),
  detail           TEXT,
  checked_by       BLOB,
  checked_by_username TEXT,
  checked_at       TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS auction_observability_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key     TEXT NOT NULL UNIQUE,
  signal        TEXT NOT NULL CHECK(signal IN (
    'BID_PROCESSING','FINALIZATION','OUTBOX_BACKLOG','FINANCE_BRIDGE',
    'QUALIFICATION_FAILURE','SETTLEMENT_FAILURE','RELEASE_BLOCK','EVENT_RUN_LIST'
  )),
  severity      TEXT NOT NULL DEFAULT 'INFO' CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  entity_type   TEXT,
  entity_id     INTEGER,
  event_id      INTEGER,
  settlement_id INTEGER,
  code          TEXT,
  metrics_json  TEXT NOT NULL DEFAULT '{}',
  occurred_at   TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_observability_signal ON auction_observability_events(signal,severity,id);

CREATE TABLE IF NOT EXISTS auction_policy_retraction_requests (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key            TEXT NOT NULL UNIQUE,
  auction_id             INTEGER NOT NULL,
  event_id               INTEGER NOT NULL,
  target_bid_id          INTEGER NOT NULL,
  requester_user         BLOB NOT NULL,
  requester_username     TEXT NOT NULL,
  requester_admin        INTEGER NOT NULL DEFAULT 0 CHECK(requester_admin IN (0,1)),
  reason                 TEXT,
  expected_version       INTEGER,
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','accepted','rejected')),
  error_code             TEXT,
  decision_basis         TEXT,
  decision_actor         TEXT,
  previous_winner_user   BLOB,
  previous_winner_username TEXT,
  result_price           REAL,
  result_winner_user     BLOB,
  result_winner_username TEXT,
  version_before         INTEGER,
  version_after          INTEGER,
  requested_at           TEXT NOT NULL DEFAULT '',
  decided_at             TEXT
) STRICT;

-- Current legal/policy source registry. Legal-source rows describe requirements;
-- they do not invent rates, fees, deposit amounts or commercial credit.
INSERT OR IGNORE INTO auction_policy_registry(
 policy_key,value_json,classification,configured,required_for_production,
 source_title,source_url,source_checked_at,notes,updated_by,updated_by_username,updated_at
) VALUES
(
 'legal.auction.completion_retraction',
 '{"completion":"HAMMER_OR_CUSTOMARY","retractionBeforeCompletion":"ALLOWED"}',
 'LEGALLY_REQUIRED',1,1,
 'Zimbabwe Consumer Protection Act, 2019 — section 39(3)',
 'https://zimlii.org/akn/zw/act/2019/5/eng@2019-12-10',
 '2026-10-25T00:00:00Z',
 'Auction completion is distinct from pre-completion bidding. Vehicle production retraction must not inherit the historical 60-minute restriction.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'legal.auction.reserve_upset_notice',
 '{"advanceNoticeRequired":true,"privateReserveAmountDisclosureRequired":false}',
 'LEGALLY_REQUIRED',1,1,
 'Zimbabwe Consumer Protection Act, 2019 — section 39(4)',
 'https://zimlii.org/akn/zw/act/2019/5/eng@2019-12-10',
 '2026-10-25T00:00:00Z',
 'Disclose that reserve/upset applies in advance; this registry does not assert that the private reserve amount itself must be published.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'legal.electronic_transaction.requirements',
 '{"supplierIdentity":true,"goodsDescription":true,"fullPriceAndFees":true,"paymentMethod":true,"terms":true,"deliveryCollection":true,"transactionRecords":true,"refundDispute":true,"securityPrivacy":true}',
 'LEGALLY_REQUIRED',1,1,
 'Zimbabwe Consumer Protection Act, 2019 — section 52',
 'https://zimlii.org/akn/zw/act/2019/5/eng@2019-12-10',
 '2026-10-25T00:00:00Z',
 'Requirement registry only; production supplier particulars remain a separate required business configuration.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'legal.vehicle.transfer_external_process',
 '{"commercialSaleIsNotStatutoryTransfer":true,"changeOfOwnershipExternal":true,"targetWindowDays":14}',
 'LEGALLY_REQUIRED',1,1,
 'ZIMRA — Special Excise Duty / Change of Ownership; Vehicle and Licensing Act section 13(1)',
 'https://www.zimra.co.zw/',
 '2026-10-25T00:00:00Z',
 'Tengasell records transfer readiness/evidence but does not claim to perform statutory registration transfer.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'legal.vehicle.customs_clearance_verification',
 '{"verifyBeforePaymentWhereClearanceIsInQuestion":true,"externalAuthority":"ZIMRA"}',
 'PENDING_LEGAL_REVIEW',1,0,
 'ZIMRA Public Notice 35 of 2026 — Confirmation of Customs Clearance Details for Motor Vehicles Before Purchase',
 'https://www.zimra.co.zw/public-notices',
 '2026-10-25T00:00:00Z',
 'Official current operational notice; treated conservatively as pending legal review rather than overstated as a statutory auction rule.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.supplier_disclosure_profile',
 NULL,'CONFIGURABLE',0,1,NULL,NULL,'2026-10-25T00:00:00Z',
 'Must contain approved Tengasell supplier identity/contact/registration/terms references before Production.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.auction_duration_minutes',
 NULL,'CONFIGURABLE',0,1,NULL,NULL,'2026-10-25T00:00:00Z',
 'Owner policy required; no production duration invented by this migration.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.payment_deadline_hours',
 NULL,'CONFIGURABLE',0,1,NULL,NULL,'2026-10-25T00:00:00Z',
 'Owner/Finance policy required. Historical 48-hour core behavior is not promoted to Production policy automatically.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.deposit_policy',
 NULL,'CONFIGURABLE',0,1,NULL,NULL,'2026-10-25T00:00:00Z',
 'Must explicitly configure enabled/disabled and, if enabled, approved amount/rule. No deposit amount is invented.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.fee_policy',
 NULL,'CONFIGURABLE',0,1,NULL,NULL,'2026-10-25T00:00:00Z',
 'Must explicitly configure enabled/disabled line items. No buyer/seller fee percentage is invented.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.anti_snipe_policy',
 '{"triggerSeconds":300,"extensionSeconds":300,"maxExtensions":15}',
 'BUSINESS_POLICY',1,1,'Accepted LR01 transactional auction core',NULL,'2026-10-25T00:00:00Z',
 'Traceable accepted technical policy; future Owner change must use governed policy update.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.live_hammer_policy',
 '{"hammerSeconds":20}',
 'BUSINESS_POLICY',1,1,'Accepted LR01 transactional auction core',NULL,'2026-10-25T00:00:00Z',
 'Traceable accepted live-auction technical policy.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.qualification_requirements',
 '{"eventQualification":true,"financialCapacity":true}',
 'BUSINESS_POLICY',1,1,'Accepted IMP-06 authority',NULL,'2026-10-25T00:00:00Z',
 'Event-scoped qualification and capacity are mandatory for whole-vehicle auction bidding.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.release_prerequisites',
 '{"paymentSettled":true,"transferComplete":true,"noActiveDispute":true,"collectorIdentified":true}',
 'BUSINESS_POLICY',1,1,'Accepted IMP-07 authority',NULL,'2026-10-25T00:00:00Z',
 'Physical release is distinct from Finance escrow/payout and fails closed on these prerequisites.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.retraction_policy',
 '{"vehicleAuctions":"PRE_COMPLETION_RETRACTION_ALLOWED","auditRequired":true}',
 'BUSINESS_POLICY',1,1,
 'Zimbabwe Consumer Protection Act, 2019 — section 39(3)',
 'https://zimlii.org/akn/zw/act/2019/5/eng@2019-12-10',
 '2026-10-25T00:00:00Z',
 'Vehicle auction path uses policy-aware request/evaluation/audit. General marketplace historical behavior is unchanged.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
),
(
 'business.customs_verification_policy',
 NULL,'PENDING_LEGAL_REVIEW',0,1,
 'ZIMRA Public Notice 35 of 2026',
 'https://www.zimra.co.zw/public-notices',
 '2026-10-25T00:00:00Z',
 'Owner/legal decision required for exact Production gate and evidence requirements.',
 NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')
);

INSERT OR IGNORE INTO auction_service_health(
 service_key,status,critical,detail,checked_by,checked_by_username,checked_at
) VALUES
 ('FINANCE','UNKNOWN',1,'Finance bridge not yet certified for Production',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('TRUST','UNKNOWN',1,'Trust/qualification dependency not yet certified for Production',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('COMMS','UNKNOWN',1,'Communications availability not yet certified for Production',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('MIGRATIONS','HEALTHY',1,'Schema tip U14 installed',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 ('LOCAL_COMMERCIAL_FALLBACK','DISABLED',1,'Commercial LocalStore fallback is forbidden',NULL,NULL,strftime('%Y-%m-%dT%H:%M:%SZ','now'));

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

  UPDATE auction_policy_registry
     SET value_json=NEW.value_json,
         classification=COALESCE(NEW.classification,classification),
         configured=COALESCE(NEW.configured,configured),
         updated_by=NEW.actor_user,updated_by_username=NEW.actor_username,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE policy_key=NEW.policy_key
     AND (SELECT status FROM auction_policy_commands WHERE id=NEW.id)='pending';

  UPDATE auction_policy_commands SET status='accepted',completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.actor_user)),'auction-policy:update','auction_policy_registry',NULL,'policy-governance',
         json_object('policyKey',NEW.policy_key,'reason',NEW.reason,'configured',NEW.configured),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM auction_policy_commands WHERE id=NEW.id)='accepted';
END;

-- Once Owner/Finance configures a production payment deadline, override the
-- historical LR01 +48h order SLA for all NEW auction settlements.
CREATE TRIGGER IF NOT EXISTS trg_configured_payment_deadline
AFTER INSERT ON auction_settlements
WHEN EXISTS(
  SELECT 1 FROM auction_policy_registry
   WHERE policy_key='business.payment_deadline_hours'
     AND configured=1
     AND json_extract(value_json,'$.hours') IS NOT NULL
     AND CAST(json_extract(value_json,'$.hours') AS REAL)>0
)
BEGIN
  UPDATE auction_settlements
     SET settlement_deadline=strftime(
       '%Y-%m-%dT%H:%M:%SZ',
       datetime(NEW.created_at,'+'||CAST(
         CAST(json_extract((SELECT value_json FROM auction_policy_registry
                            WHERE policy_key='business.payment_deadline_hours'),'$.hours') AS INTEGER
       ) AS TEXT)||' hours')
     ),
     updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id;

  UPDATE orders
     SET pay_by=(SELECT settlement_deadline FROM auction_settlements WHERE id=NEW.id),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.order_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_policy_retraction_process
AFTER INSERT ON auction_policy_retraction_requests
BEGIN
  UPDATE auction_policy_retraction_requests
     SET requested_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         version_before=(SELECT version FROM auctions WHERE id=NEW.auction_id),
         previous_winner_user=(
           SELECT user FROM auction_standing_bids
            WHERE auction_id=NEW.auction_id
            ORDER BY max_amount DESC,first_sequence ASC LIMIT 1
         ),
         previous_winner_username=(
           SELECT bidder_username FROM auction_standing_bids
            WHERE auction_id=NEW.auction_id
            ORDER BY max_amount DESC,first_sequence ASC LIMIT 1
         )
   WHERE id=NEW.id;

  UPDATE auction_policy_retraction_requests SET status='rejected',error_code='VEHICLE_EVENT_REQUIRED',
         decision_basis='VEHICLE_AUCTION_POLICY',decision_actor='SYSTEM'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(
       SELECT 1 FROM auction_lots l
       JOIN auctions a ON a.id=l.auction_id
       WHERE l.event_id=NEW.event_id AND l.auction_id=NEW.auction_id AND a.asset_kind='vehicle'
     );

  UPDATE auction_policy_retraction_requests SET status='rejected',error_code='AUCTION_ALREADY_COMPLETE',
         decision_basis='ZW_CPA_S39_COMPLETION',decision_actor='SYSTEM'
   WHERE id=NEW.id AND status='pending'
     AND (
       EXISTS(SELECT 1 FROM auction_outcomes WHERE auction_id=NEW.auction_id)
       OR EXISTS(SELECT 1 FROM auctions WHERE id=NEW.auction_id AND status<>'live')
     );

  UPDATE auction_policy_retraction_requests SET status='rejected',error_code='STALE_AUCTION_VERSION',
         decision_basis='TRANSACTIONAL_VERSION',decision_actor='SYSTEM'
   WHERE id=NEW.id AND status='pending'
     AND NEW.expected_version IS NOT NULL
     AND EXISTS(SELECT 1 FROM auctions WHERE id=NEW.auction_id AND version<>NEW.expected_version);

  UPDATE auction_policy_retraction_requests SET status='rejected',error_code='RETRACTION_TARGET_NOT_ACTIVE',
         decision_basis='ACTIVE_BID_REQUIRED',decision_actor='SYSTEM'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(
       SELECT 1 FROM bids WHERE id=NEW.target_bid_id AND auction_id=NEW.auction_id AND status='active'
     );

  UPDATE auction_policy_retraction_requests SET status='rejected',error_code='RETRACTION_FORBIDDEN',
         decision_basis='BID_OWNERSHIP_REQUIRED',decision_actor='SYSTEM'
   WHERE id=NEW.id AND status='pending' AND NEW.requester_admin=0
     AND EXISTS(SELECT 1 FROM bids WHERE id=NEW.target_bid_id AND user<>NEW.requester_user);

  UPDATE bids
     SET status='retracted',
         retracted_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         retraction_reason=substr(COALESCE(NULLIF(trim(NEW.reason),''),'Policy retraction before auction completion'),1,200)
   WHERE id=NEW.target_bid_id
     AND (SELECT status FROM auction_policy_retraction_requests WHERE id=NEW.id)='pending';

  DELETE FROM auction_standing_bids
   WHERE auction_id=NEW.auction_id
     AND user=(SELECT user FROM bids WHERE id=NEW.target_bid_id)
     AND (SELECT status FROM auction_policy_retraction_requests WHERE id=NEW.id)='pending';

  -- Restore the requester's immediately preceding accepted maximum, if one
  -- existed before the retracted active bid. No 60-minute rule is applied.
  INSERT INTO auction_standing_bids(
    auction_id,user,bidder_username,max_amount,first_sequence,updated_at
  )
  SELECT NEW.auction_id,c.actor_user,c.actor_username,c.max_amount,
         (SELECT MIN(c0.id) FROM auction_commands c0
           WHERE c0.auction_id=NEW.auction_id AND c0.actor_user=c.actor_user
             AND c0.command_type='PLACE_BID' AND c0.status='accepted'),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_commands c
   WHERE c.auction_id=NEW.auction_id
     AND c.actor_user=(SELECT user FROM bids WHERE id=NEW.target_bid_id)
     AND c.command_type='PLACE_BID'
     AND c.status='accepted'
     AND c.id < COALESCE((SELECT sequence_no FROM bids WHERE id=NEW.target_bid_id),9223372036854775807)
   ORDER BY c.id DESC LIMIT 1
  ON CONFLICT(auction_id,user) DO UPDATE SET
    max_amount=excluded.max_amount,bidder_username=excluded.bidder_username,
    first_sequence=excluded.first_sequence,updated_at=excluded.updated_at;

  UPDATE bids SET status='superseded'
   WHERE auction_id=NEW.auction_id AND status='active'
     AND (SELECT status FROM auction_policy_retraction_requests WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET current_price=(
       SELECT CASE
         WHEN COUNT(*)=0 THEN auctions.start_price
         WHEN COUNT(*)=1 THEN auctions.start_price
         ELSE MIN(
           (SELECT max_amount FROM auction_standing_bids
             WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1),
           (SELECT max_amount FROM auction_standing_bids
             WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1 OFFSET 1)
           + CASE
               WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1 OFFSET 1) < 50 THEN 1
               WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1 OFFSET 1) < 500 THEN 2
               WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1 OFFSET 1) < 1000 THEN 5
               WHEN (SELECT max_amount FROM auction_standing_bids WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1 OFFSET 1) < 5000 THEN 10
               ELSE 25 END
         ) END
         FROM auction_standing_bids WHERE auction_id=NEW.auction_id
     ),
     bid_count=MAX(0,bid_count-1),
     version=version+1,
     updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.auction_id
     AND (SELECT status FROM auction_policy_retraction_requests WHERE id=NEW.id)='pending';

  INSERT INTO bids(
    auction_id,user,bidder_username,amount,max_amount,is_auto,status,created_at,command_key,sequence_no
  )
  SELECT NEW.auction_id,s.user,s.bidder_username,a.current_price,s.max_amount,1,'active',
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),'policy-retract:'||NEW.command_key,
         1000000000+NEW.id
    FROM auctions a JOIN auction_standing_bids s ON s.auction_id=a.id
   WHERE a.id=NEW.auction_id
     AND (SELECT status FROM auction_policy_retraction_requests WHERE id=NEW.id)='pending'
     AND s.first_sequence=(
       SELECT first_sequence FROM auction_standing_bids
        WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1
     );

  -- Capacity follows the post-retraction leader.
  UPDATE auction_capacity_reservations
     SET status='RELEASED',release_reason='POLICY_RETRACTION',
         released_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE event_id=NEW.event_id AND auction_id=NEW.auction_id AND status='ACTIVE'
     AND (SELECT status FROM auction_policy_retraction_requests WHERE id=NEW.id)='pending';

  INSERT INTO auction_capacity_reservations(
    qualification_id,event_id,auction_id,user,username,reserved_amount,status,
    source_command_key,created_at,updated_at
  )
  SELECT q.id,NEW.event_id,NEW.auction_id,s.user,s.bidder_username,s.max_amount,'ACTIVE',
         'policy-retract:'||NEW.command_key,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_standing_bids s
    JOIN auction_bidder_qualifications q ON q.event_id=NEW.event_id AND q.user=s.user
   WHERE s.auction_id=NEW.auction_id
     AND s.first_sequence=(
       SELECT first_sequence FROM auction_standing_bids
        WHERE auction_id=NEW.auction_id ORDER BY max_amount DESC,first_sequence ASC LIMIT 1
     )
     AND (SELECT status FROM auction_policy_retraction_requests WHERE id=NEW.id)='pending'
  ON CONFLICT(event_id,auction_id,user) DO UPDATE SET
    qualification_id=excluded.qualification_id,username=excluded.username,
    reserved_amount=excluded.reserved_amount,status='ACTIVE',
    source_command_key=excluded.source_command_key,release_reason=NULL,released_at=NULL,
    updated_at=excluded.updated_at;

  UPDATE auction_policy_retraction_requests
     SET status='accepted',
         decision_basis='ZW_CPA_S39_PRE_COMPLETION_RETRACTION',
         decision_actor='SYSTEM_POLICY',
         result_price=(SELECT current_price FROM auctions WHERE id=NEW.auction_id),
         result_winner_user=(
           SELECT user FROM auction_standing_bids WHERE auction_id=NEW.auction_id
            ORDER BY max_amount DESC,first_sequence ASC LIMIT 1
         ),
         result_winner_username=(
           SELECT bidder_username FROM auction_standing_bids WHERE auction_id=NEW.auction_id
            ORDER BY max_amount DESC,first_sequence ASC LIMIT 1
         ),
         version_after=(SELECT version FROM auctions WHERE id=NEW.auction_id),
         decided_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT OR IGNORE INTO auction_outbox(
    event_key,auction_id,command_id,event_type,payload,occurred_at
  )
  SELECT 'policy-retract:'||NEW.command_key,NEW.auction_id,NULL,'AUCTION_BID_RETRACTED',
         json_object('auctionId',NEW.auction_id,'price',result_price,'version',version_after,'basis',decision_basis),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_policy_retraction_requests
   WHERE id=NEW.id AND status='accepted';

  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_id,event_type,actor_user,actor_username,payload,occurred_at
  )
  SELECT 'policy-retract:'||NEW.id,'auction',NEW.auction_id,NEW.event_id,'BID_RETRACTED_PRE_COMPLETION',
         NEW.requester_user,NEW.requester_username,
         json_object('bidId',NEW.target_bid_id,'decisionBasis',decision_basis,'reason',NEW.reason),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_policy_retraction_requests WHERE id=NEW.id AND status='accepted';

  INSERT INTO audit_events(user,action,entity,entity_id,source,payload,created_at)
  SELECT lower(hex(NEW.requester_user)),'bid:policy-retract','auctions',NEW.auction_id,'zw-auction-policy',
         json_object('bidId',NEW.target_bid_id,'status',status,'errorCode',error_code,'decisionBasis',decision_basis),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_policy_retraction_requests WHERE id=NEW.id;
END;

-- Privacy-safe operational signals; proxy maxima are intentionally omitted.
CREATE TRIGGER IF NOT EXISTS trg_observe_bid_capacity
AFTER UPDATE OF status ON auction_bid_capacity_commands
WHEN NEW.status IN ('accepted','rejected') AND OLD.status<>NEW.status
BEGIN
  INSERT OR IGNORE INTO auction_observability_events(
    event_key,signal,severity,entity_type,entity_id,event_id,code,metrics_json,occurred_at
  ) VALUES(
    'bid-capacity:'||NEW.id,
    CASE WHEN NEW.status='rejected' AND NEW.error_code IN ('BIDDER_NOT_QUALIFIED','INSUFFICIENT_BID_CAPACITY','LOT_BID_LIMIT_EXCEEDED')
         THEN 'QUALIFICATION_FAILURE' ELSE 'BID_PROCESSING' END,
    CASE WHEN NEW.status='rejected' THEN 'WARNING' ELSE 'INFO' END,
    'auction',NEW.auction_id,NEW.event_id,NEW.error_code,
    json_object('status',NEW.status,'availableAfter',NEW.available_after),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_observe_finance_callback
AFTER UPDATE OF status ON auction_finance_callbacks
WHEN NEW.status IN ('accepted','rejected') AND OLD.status<>NEW.status
BEGIN
  INSERT OR IGNORE INTO auction_observability_events(
    event_key,signal,severity,entity_type,entity_id,settlement_id,code,metrics_json,occurred_at
  ) VALUES(
    'finance-callback:'||NEW.id,
    CASE WHEN NEW.status='rejected' THEN 'SETTLEMENT_FAILURE' ELSE 'FINANCE_BRIDGE' END,
    CASE WHEN NEW.status='rejected' THEN 'WARNING' ELSE 'INFO' END,
    'settlement',NEW.settlement_id,NEW.settlement_id,NEW.error_code,
    json_object('eventType',NEW.event_type,'status',NEW.status),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_observe_release
AFTER UPDATE OF status ON auction_release_commands
WHEN NEW.status IN ('accepted','rejected') AND OLD.status<>NEW.status
BEGIN
  INSERT OR IGNORE INTO auction_observability_events(
    event_key,signal,severity,entity_type,entity_id,settlement_id,code,metrics_json,occurred_at
  ) VALUES(
    'release-command:'||NEW.id,'RELEASE_BLOCK',
    CASE WHEN NEW.status='rejected' THEN 'WARNING' ELSE 'INFO' END,
    'settlement',NEW.settlement_id,NEW.settlement_id,NEW.error_code,
    json_object('status',NEW.status),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_observe_run_list
AFTER UPDATE OF status ON run_list_commands
WHEN NEW.status='rejected' AND OLD.status<>NEW.status
BEGIN
  INSERT OR IGNORE INTO auction_observability_events(
    event_key,signal,severity,entity_type,entity_id,event_id,code,metrics_json,occurred_at
  ) VALUES(
    'run-list-reject:'||NEW.id,'EVENT_RUN_LIST','WARNING','auction_event',NEW.event_id,NEW.event_id,NEW.error_code,
    json_object('commandType',NEW.command_type),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;
