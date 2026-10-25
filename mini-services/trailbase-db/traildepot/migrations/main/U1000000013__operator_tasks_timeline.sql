-- TENGASELL-AUCTION-IMP-08
-- Scoped operator capabilities + operational tasks + immutable timeline.
-- Calendar/workbench remain projections over authoritative objects.

CREATE TABLE IF NOT EXISTS auction_operation_grants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user             BLOB NOT NULL,
  username         TEXT NOT NULL,
  capability       TEXT NOT NULL CHECK(capability IN (
    'QUALIFICATION_REVIEWER','FINANCE_OPERATOR','RELEASE_OPERATOR',
    'TRANSPORT_OPERATOR','AUCTION_OPERATOR','TASK_OPERATOR'
  )),
  scope_key        TEXT NOT NULL DEFAULT 'GLOBAL',
  event_id         INTEGER,
  active           INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  granted_by       BLOB NOT NULL,
  granted_by_username TEXT NOT NULL,
  reason           TEXT NOT NULL,
  expires_at       TEXT,
  granted_at       TEXT NOT NULL,
  revoked_at       TEXT,
  UNIQUE(user,capability,scope_key)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_operation_grants_user
  ON auction_operation_grants(user,active,capability,event_id);

CREATE TABLE IF NOT EXISTS auction_tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key            TEXT NOT NULL UNIQUE,
  task_type           TEXT NOT NULL CHECK(task_type IN (
    'VEHICLE_INSPECTION','DOCUMENT_REVIEW','QUALIFICATION_REVIEW',
    'PAYMENT_FOLLOW_UP','TRANSFER_DOCUMENT_REVIEW','RELEASE_PREPARATION',
    'COLLECTION_PREPARATION','TRANSPORT_SCHEDULING','EXCEPTION_REVIEW'
  )),
  entity_type         TEXT NOT NULL,
  entity_id           INTEGER NOT NULL,
  event_id            INTEGER,
  settlement_id       INTEGER,
  assignee_user       BLOB,
  assignee_username   TEXT,
  required_capability TEXT,
  status              TEXT NOT NULL DEFAULT 'TODO'
                      CHECK(status IN ('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
  priority            TEXT NOT NULL DEFAULT 'NORMAL'
                      CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
  due_at              TEXT,
  dependency_task_id  INTEGER,
  source              TEXT NOT NULL,
  source_key          TEXT NOT NULL UNIQUE,
  created_by          BLOB,
  created_by_username TEXT,
  resolution          TEXT,
  created_at          TEXT NOT NULL,
  started_at          TEXT,
  completed_at        TEXT,
  updated_at          TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_auction_tasks_queue ON auction_tasks(status,due_at,priority,id);
CREATE INDEX IF NOT EXISTS idx_auction_tasks_event ON auction_tasks(event_id,status,id);
CREATE INDEX IF NOT EXISTS idx_auction_tasks_settlement ON auction_tasks(settlement_id,status,id);

CREATE TABLE IF NOT EXISTS auction_task_commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key       TEXT NOT NULL UNIQUE,
  task_id           INTEGER NOT NULL,
  actor_user        BLOB NOT NULL,
  actor_username    TEXT NOT NULL,
  actor_authorized  INTEGER NOT NULL DEFAULT 0 CHECK(actor_authorized IN (0,1)),
  command_type      TEXT NOT NULL CHECK(command_type IN ('ASSIGN','START','BLOCK','COMPLETE','CANCEL','REOPEN')),
  assignee_user     BLOB,
  assignee_username TEXT,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code        TEXT,
  received_at       TEXT NOT NULL DEFAULT '',
  completed_at      TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS auction_timeline_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key      TEXT NOT NULL UNIQUE,
  entity_type    TEXT NOT NULL,
  entity_id      INTEGER NOT NULL,
  event_id       INTEGER,
  settlement_id  INTEGER,
  event_type     TEXT NOT NULL,
  actor_user     BLOB,
  actor_username TEXT,
  payload        TEXT NOT NULL DEFAULT '{}',
  occurred_at    TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_timeline_entity ON auction_timeline_events(entity_type,entity_id,id);
CREATE INDEX IF NOT EXISTS idx_timeline_settlement ON auction_timeline_events(settlement_id,id);
CREATE INDEX IF NOT EXISTS idx_timeline_event ON auction_timeline_events(event_id,id);

CREATE TABLE IF NOT EXISTS auction_operator_alerts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key          TEXT NOT NULL UNIQUE,
  alert_type         TEXT NOT NULL,
  severity           TEXT NOT NULL DEFAULT 'WARNING'
                     CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  entity_type        TEXT NOT NULL,
  entity_id          INTEGER NOT NULL,
  event_id           INTEGER,
  settlement_id      INTEGER,
  blocked_action     TEXT NOT NULL,
  resolver_capability TEXT,
  action_required    TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'OPEN'
                     CHECK(status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  created_at         TEXT NOT NULL,
  resolved_at        TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_operator_alerts_open ON auction_operator_alerts(status,severity,id);

-- Seed operational tasks/timeline from already-durable commercial objects.
INSERT OR IGNORE INTO auction_tasks(
  task_key,task_type,entity_type,entity_id,event_id,settlement_id,status,priority,due_at,
  required_capability,source,source_key,created_at,updated_at
)
SELECT 'payment:'||s.id,'PAYMENT_FOLLOW_UP','settlement',s.id,s.event_id,s.id,
       CASE WHEN s.payment_state='PAID' THEN 'DONE' ELSE 'TODO' END,
       'HIGH',s.settlement_deadline,'FINANCE_OPERATOR','SETTLEMENT','payment:'||s.id,
       s.created_at,s.updated_at
  FROM auction_settlements s;

INSERT OR IGNORE INTO auction_timeline_events(
  event_key,entity_type,entity_id,event_id,settlement_id,event_type,payload,occurred_at
)
SELECT 'settlement:'||s.id||':created','settlement',s.id,s.event_id,s.id,'SETTLEMENT_CREATED',
       json_object('orderId',s.order_id,'auctionId',s.auction_id),s.created_at
  FROM auction_settlements s;

CREATE TRIGGER IF NOT EXISTS trg_vehicle_create_inspection_task
AFTER INSERT ON vehicles
BEGIN
  INSERT OR IGNORE INTO auction_tasks(
    task_key,task_type,entity_type,entity_id,event_id,status,priority,required_capability,
    source,source_key,created_by,created_by_username,created_at,updated_at
  ) VALUES(
    'inspection:'||NEW.id,'VEHICLE_INSPECTION','vehicle',NEW.id,
    (SELECT event_id FROM auction_lots WHERE auction_id=NEW.auction_id LIMIT 1),
    'TODO','HIGH','AUCTION_OPERATOR','VEHICLE_INTAKE','inspection:'||NEW.id,
    NEW.seller_user,NEW.seller_username,strftime('%Y-%m-%dT%H:%M:%SZ','now'),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_id,event_type,actor_user,actor_username,payload,occurred_at
  ) VALUES(
    'vehicle:'||NEW.id||':submitted','vehicle',NEW.id,
    (SELECT event_id FROM auction_lots WHERE auction_id=NEW.auction_id LIMIT 1),
    'VEHICLE_SUBMITTED',NEW.seller_user,NEW.seller_username,
    json_object('auctionId',NEW.auction_id),strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_inspection_review_timeline
AFTER UPDATE OF lifecycle ON vehicle_inspections
WHEN NEW.lifecycle='REVIEWED' AND OLD.lifecycle<>'REVIEWED'
BEGIN
  UPDATE auction_tasks
     SET status='DONE',resolution='Inspection reviewed',
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE source_key='inspection:'||NEW.vehicle_id AND status<>'DONE';
  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_type,actor_user,actor_username,payload,occurred_at
  ) VALUES(
    'inspection:'||NEW.id||':reviewed','vehicle',NEW.vehicle_id,'INSPECTION_COMPLETED',
    NEW.reviewer_user,NEW.reviewer_name,json_object('inspectionId',NEW.id,'grade',NEW.grade),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_eligibility_timeline
AFTER INSERT ON vehicle_eligibility
BEGIN
  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_id,event_type,actor_user,payload,occurred_at
  )
  SELECT 'eligibility:'||NEW.id,'vehicle',NEW.vehicle_id,l.event_id,
         CASE WHEN NEW.status='ELIGIBLE' THEN 'VEHICLE_ELIGIBLE' ELSE 'VEHICLE_ELIGIBILITY_'||NEW.status END,
         NEW.decided_by,json_object('eligibilityId',NEW.id,'status',NEW.status),
         NEW.decided_at
    FROM vehicles v LEFT JOIN auction_lots l ON l.auction_id=v.auction_id
   WHERE v.id=NEW.vehicle_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_qualification_pending_task
AFTER INSERT ON auction_bidder_qualifications
WHEN NEW.status='PENDING'
BEGIN
  INSERT OR IGNORE INTO auction_tasks(
    task_key,task_type,entity_type,entity_id,event_id,status,priority,required_capability,
    source,source_key,created_at,updated_at
  ) VALUES(
    'qualification:'||NEW.id,'QUALIFICATION_REVIEW','qualification',NEW.id,NEW.event_id,
    'TODO','HIGH','QUALIFICATION_REVIEWER','QUALIFICATION','qualification:'||NEW.id,
    strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_qualification_status_operations
AFTER UPDATE OF status ON auction_bidder_qualifications
BEGIN
  UPDATE auction_tasks
     SET status=CASE WHEN NEW.status='QUALIFIED' THEN 'DONE'
                     WHEN NEW.status IN ('REJECTED','EXPIRED') THEN 'CANCELLED'
                     ELSE status END,
         resolution=CASE WHEN NEW.status='QUALIFIED' THEN 'Qualification approved'
                         WHEN NEW.status IN ('REJECTED','EXPIRED') THEN 'Qualification '||lower(NEW.status)
                         ELSE resolution END,
         completed_at=CASE WHEN NEW.status IN ('QUALIFIED','REJECTED','EXPIRED')
                           THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE completed_at END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE source_key='qualification:'||NEW.id;

  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_id,event_type,actor_user,actor_username,payload,occurred_at
  ) VALUES(
    'qualification:'||NEW.id||':'||NEW.version,'qualification',NEW.id,NEW.event_id,
    'QUALIFICATION_'||NEW.status,NEW.reviewer_user,NEW.reviewer_username,
    json_object('status',NEW.status,'reasonCode',NEW.reason_code),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_settlement_operations
AFTER INSERT ON auction_settlements
BEGIN
  INSERT OR IGNORE INTO auction_tasks(
    task_key,task_type,entity_type,entity_id,event_id,settlement_id,status,priority,due_at,
    required_capability,source,source_key,created_at,updated_at
  ) VALUES(
    'payment:'||NEW.id,'PAYMENT_FOLLOW_UP','settlement',NEW.id,NEW.event_id,NEW.id,
    'TODO','HIGH',NEW.settlement_deadline,'FINANCE_OPERATOR','SETTLEMENT','payment:'||NEW.id,
    NEW.created_at,NEW.updated_at
  );
  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_id,settlement_id,event_type,payload,occurred_at
  ) VALUES(
    'settlement:'||NEW.id||':created','settlement',NEW.id,NEW.event_id,NEW.id,
    'SETTLEMENT_CREATED',json_object('orderId',NEW.order_id,'auctionId',NEW.auction_id),NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_finance_callback_operations
AFTER UPDATE OF status ON auction_finance_callbacks
WHEN NEW.status='accepted' AND OLD.status<>'accepted'
BEGIN
  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,
    event_id,settlement_id,event_type,actor_user,actor_username,payload,occurred_at
  )
  SELECT 'finance-callback:'||NEW.id,'settlement',s.id,s.event_id,s.id,
         'FINANCE_'||NEW.event_type,NEW.actor_user,NEW.actor_username,
         json_object('amount',NEW.amount,'reference',NEW.source_reference),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s WHERE s.id=NEW.settlement_id;

  UPDATE auction_tasks
     SET status=CASE WHEN (SELECT payment_state FROM auction_settlements WHERE id=NEW.settlement_id)='PAID'
                     THEN 'DONE' ELSE status END,
         resolution=CASE WHEN (SELECT payment_state FROM auction_settlements WHERE id=NEW.settlement_id)='PAID'
                         THEN 'Finance confirmed settlement' ELSE resolution END,
         completed_at=CASE WHEN (SELECT payment_state FROM auction_settlements WHERE id=NEW.settlement_id)='PAID'
                           THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE completed_at END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE source_key='payment:'||NEW.settlement_id;

  INSERT OR IGNORE INTO auction_tasks(
    task_key,task_type,entity_type,entity_id,event_id,settlement_id,status,priority,
    required_capability,source,source_key,created_at,updated_at
  )
  SELECT 'transfer:'||s.id,'TRANSFER_DOCUMENT_REVIEW','settlement',s.id,s.event_id,s.id,
         'TODO','HIGH','RELEASE_OPERATOR','FINANCE','transfer:'||s.id,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_settlements s
   WHERE s.id=NEW.settlement_id AND s.payment_state='PAID';
END;

CREATE TRIGGER IF NOT EXISTS trg_transfer_operations
AFTER UPDATE OF transfer_state ON auction_settlements
BEGIN
  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_id,settlement_id,event_type,payload,occurred_at
  ) VALUES(
    'transfer:'||NEW.id||':'||NEW.transfer_state,'settlement',NEW.id,NEW.event_id,NEW.id,
    'TRANSFER_'||NEW.transfer_state,json_object('state',NEW.transfer_state),
    strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );

  UPDATE auction_tasks
     SET status=CASE WHEN NEW.transfer_state='COMPLETE' THEN 'DONE'
                     WHEN NEW.transfer_state='ON_HOLD' THEN 'BLOCKED' ELSE status END,
         resolution=CASE WHEN NEW.transfer_state='COMPLETE' THEN 'Transfer evidence complete'
                         WHEN NEW.transfer_state='ON_HOLD' THEN 'Transfer on hold' ELSE resolution END,
         completed_at=CASE WHEN NEW.transfer_state='COMPLETE' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE completed_at END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE source_key='transfer:'||NEW.id;

  INSERT OR IGNORE INTO auction_tasks(
    task_key,task_type,entity_type,entity_id,event_id,settlement_id,status,priority,
    required_capability,source,source_key,created_at,updated_at
  )
  SELECT 'release:'||NEW.id,'RELEASE_PREPARATION','settlement',NEW.id,NEW.event_id,NEW.id,
         'TODO','HIGH','RELEASE_OPERATOR','TRANSFER','release:'||NEW.id,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE NEW.transfer_state='COMPLETE' AND NEW.payment_state='PAID';
END;

CREATE TRIGGER IF NOT EXISTS trg_release_operations
AFTER INSERT ON auction_release_authorizations
BEGIN
  UPDATE auction_tasks
     SET status='DONE',resolution='Release authorized',
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE source_key='release:'||NEW.settlement_id;

  INSERT OR IGNORE INTO auction_tasks(
    task_key,task_type,entity_type,entity_id,settlement_id,status,priority,
    required_capability,source,source_key,created_at,updated_at
  ) VALUES(
    'collection:'||NEW.settlement_id,'COLLECTION_PREPARATION','settlement',NEW.settlement_id,
    NEW.settlement_id,'TODO','HIGH','RELEASE_OPERATOR','RELEASE','collection:'||NEW.settlement_id,
    strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
  );

  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,settlement_id,event_type,actor_user,actor_username,payload,occurred_at
  ) VALUES(
    'release:'||NEW.id||':authorized','settlement',NEW.settlement_id,NEW.settlement_id,
    'RELEASE_AUTHORIZED',NEW.authorized_by,NEW.authorized_by_username,
    json_object('reference',NEW.authorization_ref,'collectorType',NEW.collector_type),NEW.authorized_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_transport_operations
AFTER INSERT ON auction_transport_bookings
BEGIN
  INSERT OR IGNORE INTO auction_tasks(
    task_key,task_type,entity_type,entity_id,settlement_id,status,priority,due_at,
    required_capability,source,source_key,created_by,created_by_username,created_at,updated_at
  ) VALUES(
    'transport:'||NEW.id,'TRANSPORT_SCHEDULING','transport',NEW.id,NEW.settlement_id,
    CASE WHEN NEW.status='SCHEDULED' THEN 'DONE' ELSE 'TODO' END,
    'NORMAL',NEW.scheduled_at,'TRANSPORT_OPERATOR','TRANSPORT','transport:'||NEW.id,
    NEW.requested_by,NEW.requested_by_username,NEW.created_at,NEW.updated_at
  );
  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,settlement_id,event_type,actor_user,actor_username,payload,occurred_at
  ) VALUES(
    'transport:'||NEW.id||':requested','transport',NEW.id,NEW.settlement_id,'TRANSPORT_REQUESTED',
    NEW.requested_by,NEW.requested_by_username,
    json_object('transporter',NEW.transporter,'destination',NEW.destination),NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_handover_operations
AFTER INSERT ON auction_handovers
BEGIN
  UPDATE auction_tasks
     SET status='DONE',resolution='Vehicle handed over',
         completed_at=NEW.handed_over_at,updated_at=NEW.handed_over_at
   WHERE settlement_id=NEW.settlement_id
     AND task_type IN ('COLLECTION_PREPARATION','TRANSPORT_SCHEDULING')
     AND status<>'DONE';

  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,settlement_id,event_type,actor_user,actor_username,payload,occurred_at
  ) VALUES(
    'handover:'||NEW.id,'settlement',NEW.settlement_id,NEW.settlement_id,'VEHICLE_HANDED_OVER',
    NEW.operator_user,NEW.operator_username,json_object('evidenceReference',NEW.evidence_reference),
    NEW.handed_over_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_task_command_process
AFTER INSERT ON auction_task_commands
BEGIN
  UPDATE auction_task_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;
  UPDATE auction_task_commands SET status='rejected',error_code='TASK_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NOT EXISTS(SELECT 1 FROM auction_tasks WHERE id=NEW.task_id);
  UPDATE auction_task_commands SET status='rejected',error_code='TASK_PERMISSION_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_authorized<>1;

  UPDATE auction_tasks
     SET assignee_user=CASE WHEN NEW.command_type='ASSIGN' THEN NEW.assignee_user ELSE assignee_user END,
         assignee_username=CASE WHEN NEW.command_type='ASSIGN' THEN NEW.assignee_username ELSE assignee_username END,
         status=CASE NEW.command_type
           WHEN 'START' THEN 'IN_PROGRESS'
           WHEN 'BLOCK' THEN 'BLOCKED'
           WHEN 'COMPLETE' THEN 'DONE'
           WHEN 'CANCEL' THEN 'CANCELLED'
           WHEN 'REOPEN' THEN 'TODO'
           ELSE status END,
         resolution=CASE WHEN NEW.command_type IN ('BLOCK','COMPLETE','CANCEL') THEN NEW.reason ELSE resolution END,
         started_at=CASE WHEN NEW.command_type='START' THEN COALESCE(started_at,strftime('%Y-%m-%dT%H:%M:%SZ','now')) ELSE started_at END,
         completed_at=CASE WHEN NEW.command_type='COMPLETE' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now')
                           WHEN NEW.command_type='REOPEN' THEN NULL ELSE completed_at END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.task_id AND (SELECT status FROM auction_task_commands WHERE id=NEW.id)='pending';

  UPDATE auction_task_commands SET status='accepted',completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  INSERT OR IGNORE INTO auction_timeline_events(
    event_key,entity_type,entity_id,event_id,settlement_id,event_type,actor_user,actor_username,payload,occurred_at
  )
  SELECT 'task-command:'||NEW.id,'task',t.id,t.event_id,t.settlement_id,'TASK_'||NEW.command_type,
         NEW.actor_user,NEW.actor_username,json_object('reason',NEW.reason,'taskType',t.task_type),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM auction_tasks t
   WHERE t.id=NEW.task_id AND (SELECT status FROM auction_task_commands WHERE id=NEW.id)='accepted';
END;

-- Exception projections. They identify the blocked action and resolver without
-- becoming a second commercial state authority.
CREATE TRIGGER IF NOT EXISTS trg_settlement_exception_projection
AFTER UPDATE ON auction_settlements
BEGIN
  INSERT OR IGNORE INTO auction_operator_alerts(
    alert_key,alert_type,severity,entity_type,entity_id,event_id,settlement_id,
    blocked_action,resolver_capability,action_required,created_at
  )
  SELECT 'settlement:'||NEW.id||':dispute','ACTIVE_DISPUTE','CRITICAL','settlement',NEW.id,NEW.event_id,NEW.id,
         'VEHICLE_RELEASE','FINANCE_OPERATOR','Resolve the active payment/order dispute before physical release.',
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE NEW.dispute_state='OPEN';

  INSERT OR IGNORE INTO auction_operator_alerts(
    alert_key,alert_type,severity,entity_type,entity_id,event_id,settlement_id,
    blocked_action,resolver_capability,action_required,created_at
  )
  SELECT 'settlement:'||NEW.id||':payment-overdue','PAYMENT_OVERDUE','WARNING','settlement',NEW.id,NEW.event_id,NEW.id,
         'TRANSFER_AND_RELEASE','FINANCE_OPERATOR','Follow up payment; do not release the vehicle.',
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE NEW.payment_state<>'PAID' AND NEW.settlement_deadline IS NOT NULL
     AND unixepoch(NEW.settlement_deadline)<unixepoch('now');

  UPDATE auction_operator_alerts
     SET status='RESOLVED',resolved_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE alert_key='settlement:'||NEW.id||':dispute' AND NEW.dispute_state<>'OPEN' AND status<>'RESOLVED';

  UPDATE auction_operator_alerts
     SET status='RESOLVED',resolved_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE alert_key='settlement:'||NEW.id||':payment-overdue' AND NEW.payment_state='PAID' AND status<>'RESOLVED';
END;
