-- TENGASELL-AUCTION-IMP-04 — structured Vehicle / Inspection authority.
-- Canonical store remains TrailBase SQLite. Vehicle commercial activation is
-- fail-closed: a whole vehicle starts as draft and only a reviewed ELIGIBLE
-- verdict may activate it.

ALTER TABLE auctions ADD COLUMN asset_kind TEXT NOT NULL DEFAULT 'general'
  CHECK (asset_kind IN ('general','vehicle','part'));

CREATE TABLE IF NOT EXISTS vehicles (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id               INTEGER NOT NULL UNIQUE,
  seller_user              BLOB NOT NULL,
  seller_username          TEXT NOT NULL,
  vin                      TEXT UNIQUE,
  chassis_number           TEXT UNIQUE,
  registration_number      TEXT,
  make                     TEXT NOT NULL,
  model                    TEXT NOT NULL,
  variant                  TEXT,
  model_year               INTEGER NOT NULL CHECK (model_year BETWEEN 1900 AND 2100),
  engine_number            TEXT,
  engine_displacement_cc   INTEGER CHECK (engine_displacement_cc IS NULL OR engine_displacement_cc > 0),
  fuel_type                TEXT NOT NULL CHECK (fuel_type IN ('PETROL','DIESEL','HYBRID','ELECTRIC','LPG','OTHER')),
  transmission             TEXT NOT NULL CHECK (transmission IN ('MANUAL','AUTOMATIC','CVT','DCT','OTHER')),
  drivetrain               TEXT NOT NULL CHECK (drivetrain IN ('FWD','RWD','AWD','4WD','OTHER')),
  odometer_km              INTEGER NOT NULL CHECK (odometer_km >= 0),
  location_city            TEXT NOT NULL,
  location_country         TEXT NOT NULL DEFAULT 'Zimbabwe',
  ownership_status         TEXT NOT NULL CHECK (ownership_status IN ('DECLARED_OWNER','FINANCED','THIRD_PARTY','UNKNOWN')),
  customs_status           TEXT NOT NULL CHECK (customs_status IN ('LOCAL','CLEARED','PENDING','NOT_APPLICABLE','UNKNOWN')),
  requested_duration_hours INTEGER NOT NULL DEFAULT 72 CHECK (requested_duration_hours BETWEEN 1 AND 720),
  declaration_accepted_at  TEXT NOT NULL,
  lifecycle                TEXT NOT NULL DEFAULT 'INTAKE'
                           CHECK (lifecycle IN ('INTAKE','INSPECTION','REVIEW','ELIGIBLE','INELIGIBLE','RETIRED')),
  tengasell_grade          TEXT CHECK (tengasell_grade IS NULL OR tengasell_grade IN ('A','B','C','D','E','REJECT')),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  CHECK (
    (vin IS NOT NULL AND length(trim(vin)) = 17 AND upper(vin) = vin AND vin NOT GLOB '*[IOQ]*')
    OR
    (chassis_number IS NOT NULL AND length(trim(chassis_number)) BETWEEN 4 AND 40)
  )
) STRICT;

CREATE INDEX IF NOT EXISTS idx_vehicles_seller ON vehicles (seller_user);
CREATE INDEX IF NOT EXISTS idx_vehicles_lifecycle ON vehicles (lifecycle);

CREATE TABLE IF NOT EXISTS vehicle_evidence (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id    INTEGER NOT NULL,
  field_key     TEXT NOT NULL,
  source_type   TEXT NOT NULL CHECK (source_type IN ('SELLER_DECLARATION','DOCUMENT','INSPECTION','REVIEW')),
  source_id     INTEGER,
  value_json    TEXT NOT NULL DEFAULT '{}',
  asserted_by   BLOB NOT NULL,
  verified_by   BLOB,
  verified_at   TEXT,
  created_at    TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vehicle_evidence_vehicle ON vehicle_evidence (vehicle_id, field_key);

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id       INTEGER NOT NULL,
  document_type    TEXT NOT NULL CHECK (document_type IN (
    'REGISTRATION','OWNERSHIP','CUSTOMS_CLEARANCE','IDENTITY','INSPECTION_PHOTO','OTHER'
  )),
  document_ref     TEXT NOT NULL,
  issuer           TEXT,
  issued_at        TEXT,
  expires_at       TEXT,
  storage_ref      TEXT,
  status           TEXT NOT NULL DEFAULT 'DECLARED'
                        CHECK (status IN ('DECLARED','UPLOADED','VERIFIED','REJECTED','EXPIRED')),
  uploaded_by      BLOB NOT NULL,
  verified_by      BLOB,
  verified_at      TEXT,
  rejection_reason TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents (vehicle_id, document_type, status);

CREATE TABLE IF NOT EXISTS vehicle_staff_roles (
  user        BLOB NOT NULL,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('INSPECTOR','REVIEWER')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  granted_by  BLOB,
  granted_at  TEXT NOT NULL,
  PRIMARY KEY (user, role)
) STRICT;

CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id      INTEGER NOT NULL,
  version         INTEGER NOT NULL CHECK (version > 0),
  inspector_user  BLOB NOT NULL,
  inspector_name  TEXT NOT NULL,
  reviewer_user   BLOB,
  reviewer_name   TEXT,
  lifecycle       TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (lifecycle IN ('DRAFT','SUBMITTED','REVIEWED','REJECTED','SUPERSEDED')),
  odometer_km     INTEGER NOT NULL CHECK (odometer_km >= 0),
  roadworthy      INTEGER NOT NULL DEFAULT 1 CHECK (roadworthy IN (0,1)),
  notes           TEXT NOT NULL DEFAULT '',
  grade_score     INTEGER CHECK (grade_score IS NULL OR grade_score BETWEEN 0 AND 100),
  grade           TEXT CHECK (grade IS NULL OR grade IN ('A','B','C','D','E','REJECT')),
  submitted_at    TEXT,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (vehicle_id, version)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_vehicle ON vehicle_inspections (vehicle_id, version DESC);

CREATE TABLE IF NOT EXISTS vehicle_inspection_findings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id        INTEGER NOT NULL,
  category             TEXT NOT NULL CHECK (category IN (
    'BODY','STRUCTURAL','MECHANICAL','INTERIOR','TYRES','ELECTRICAL','GLASS','UNDERBODY'
  )),
  component            TEXT NOT NULL,
  location             TEXT,
  severity             TEXT NOT NULL CHECK (severity IN ('MINOR','MODERATE','MAJOR','CRITICAL')),
  description          TEXT NOT NULL,
  repair_recommended   INTEGER NOT NULL DEFAULT 0 CHECK (repair_recommended IN (0,1)),
  safety_critical      INTEGER NOT NULL DEFAULT 0 CHECK (safety_critical IN (0,1)),
  evidence_document_id INTEGER,
  created_by           BLOB NOT NULL,
  created_at           TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vehicle_findings_inspection ON vehicle_inspection_findings (inspection_id, severity);

CREATE TABLE IF NOT EXISTS vehicle_eligibility (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id   INTEGER NOT NULL,
  inspection_id INTEGER NOT NULL,
  version      INTEGER NOT NULL CHECK (version > 0),
  status       TEXT NOT NULL CHECK (status IN ('PENDING','ELIGIBLE','INELIGIBLE')),
  decided_by   BLOB NOT NULL,
  decided_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (vehicle_id, version)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vehicle_eligibility_current
  ON vehicle_eligibility (vehicle_id, version DESC);

CREATE TABLE IF NOT EXISTS vehicle_eligibility_reasons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  eligibility_id INTEGER NOT NULL,
  code           TEXT NOT NULL CHECK (code IN (
    'NO_VERIFIED_OWNERSHIP',
    'NO_VERIFIED_REGISTRATION',
    'CUSTOMS_EVIDENCE_REQUIRED',
    'CUSTOMS_STATUS_UNRESOLVED',
    'ROADWORTHY_FAILED',
    'CRITICAL_SAFETY_FINDING',
    'GRADE_REJECTED'
  )),
  detail         TEXT NOT NULL DEFAULT '',
  UNIQUE (eligibility_id, code)
) STRICT;

CREATE TABLE IF NOT EXISTS vehicle_review_commands (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key    TEXT NOT NULL UNIQUE,
  vehicle_id     INTEGER NOT NULL,
  inspection_id  INTEGER NOT NULL,
  reviewer_user  BLOB NOT NULL,
  reviewer_name  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  error_code     TEXT,
  result_score   INTEGER,
  result_grade   TEXT,
  eligibility_id INTEGER,
  eligibility_status TEXT,
  received_at    TEXT NOT NULL DEFAULT '',
  completed_at   TEXT
) STRICT;

-- Existing admin account can bootstrap non-production inspection workflows.
-- Production role assignment remains explicit operational data, not a seed of
-- real inspectors/reviewers.
INSERT OR IGNORE INTO vehicle_staff_roles (user,username,role,active,granted_by,granted_at)
SELECT id, username, 'INSPECTOR', 1, id, strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM _user WHERE admin=TRUE;
INSERT OR IGNORE INTO vehicle_staff_roles (user,username,role,active,granted_by,granted_at)
SELECT id, username, 'REVIEWER', 1, id, strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM _user WHERE admin=TRUE;

-- A whole vehicle may never be browser-created directly into commercial live
-- state. Parts/accessories remain normal marketplace inventory.
CREATE TRIGGER IF NOT EXISTS trg_vehicle_auction_create_gate
BEFORE INSERT ON auctions
WHEN NEW.category='vehicles' AND NEW.asset_kind='vehicle' AND NEW.status<>'draft'
BEGIN
  SELECT RAISE(ABORT,'VEHICLE_ELIGIBILITY_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS trg_vehicle_auction_live_gate
BEFORE UPDATE OF status,asset_kind ON auctions
WHEN NEW.asset_kind='vehicle' AND NEW.status='live'
 AND NOT EXISTS (
   SELECT 1 FROM vehicle_eligibility e
    JOIN vehicles v ON v.id=e.vehicle_id
   WHERE v.auction_id=NEW.id
     AND e.version=(SELECT MAX(e2.version) FROM vehicle_eligibility e2 WHERE e2.vehicle_id=v.id)
     AND e.status='ELIGIBLE'
 )
BEGIN
  SELECT RAISE(ABORT,'VEHICLE_ELIGIBILITY_REQUIRED');
END;

-- Defence in depth. The trade engine also gives a user-facing rejection before
-- submitting the command, but the canonical database remains the final gate.
CREATE TRIGGER IF NOT EXISTS trg_vehicle_bid_gate
BEFORE INSERT ON auction_commands
WHEN NEW.command_type='PLACE_BID'
 AND EXISTS (SELECT 1 FROM auctions a WHERE a.id=NEW.auction_id AND a.asset_kind='vehicle')
 AND NOT EXISTS (
   SELECT 1 FROM vehicles v
   JOIN vehicle_eligibility e ON e.vehicle_id=v.id
   WHERE v.auction_id=NEW.auction_id
     AND e.version=(SELECT MAX(e2.version) FROM vehicle_eligibility e2 WHERE e2.vehicle_id=v.id)
     AND e.status='ELIGIBLE'
 )
BEGIN
  SELECT RAISE(ABORT,'VEHICLE_NOT_ELIGIBLE');
END;


CREATE TRIGGER IF NOT EXISTS trg_vehicle_review_process
AFTER INSERT ON vehicle_review_commands
BEGIN
  UPDATE vehicle_review_commands
     SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id;

  UPDATE vehicle_review_commands SET status='rejected', error_code='VEHICLE_NOT_FOUND'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (SELECT 1 FROM vehicles WHERE id=NEW.vehicle_id);

  UPDATE vehicle_review_commands SET status='rejected', error_code='REVIEWER_PERMISSION_REQUIRED'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (
       SELECT 1 FROM vehicle_staff_roles r
        WHERE r.user=NEW.reviewer_user AND r.role='REVIEWER' AND r.active=1
     )
     AND NOT EXISTS (
       SELECT 1 FROM _user u WHERE u.id=NEW.reviewer_user AND u.admin=TRUE
     );

  UPDATE vehicle_review_commands SET status='rejected', error_code='INSPECTION_NOT_SUBMITTED'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS (
       SELECT 1 FROM vehicle_inspections i
        WHERE i.id=NEW.inspection_id
          AND i.vehicle_id=NEW.vehicle_id
          AND i.lifecycle='SUBMITTED'
     );

  UPDATE vehicle_review_commands SET status='rejected', error_code='MAKER_CHECKER_REQUIRED'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS (
       SELECT 1 FROM vehicle_inspections i
        WHERE i.id=NEW.inspection_id AND i.inspector_user=NEW.reviewer_user
     )
     AND NOT EXISTS (
       SELECT 1 FROM _user u WHERE u.id=NEW.reviewer_user AND u.admin=TRUE
     );

  UPDATE vehicle_review_commands
     SET result_score=MAX(0,100-COALESCE((
       SELECT SUM(CASE f.severity
         WHEN 'MINOR' THEN 2
         WHEN 'MODERATE' THEN 7
         WHEN 'MAJOR' THEN 18
         WHEN 'CRITICAL' THEN 35
         ELSE 0 END)
       FROM vehicle_inspection_findings f
       WHERE f.inspection_id=NEW.inspection_id
     ),0))
   WHERE id=NEW.id AND status='pending';

  UPDATE vehicle_review_commands
     SET result_grade=CASE
       WHEN EXISTS (
         SELECT 1 FROM vehicle_inspections i
          WHERE i.id=NEW.inspection_id AND i.roadworthy=0
       ) THEN 'REJECT'
       WHEN EXISTS (
         SELECT 1 FROM vehicle_inspection_findings f
          WHERE f.inspection_id=NEW.inspection_id
            AND (f.safety_critical=1 OR f.severity='CRITICAL')
       ) THEN 'REJECT'
       WHEN result_score>=90 THEN 'A'
       WHEN result_score>=80 THEN 'B'
       WHEN result_score>=70 THEN 'C'
       WHEN result_score>=60 THEN 'D'
       WHEN result_score>=50 THEN 'E'
       ELSE 'REJECT'
     END
   WHERE id=NEW.id AND status='pending';

  UPDATE vehicle_inspections
     SET reviewer_user=NEW.reviewer_user,
         reviewer_name=NEW.reviewer_name,
         lifecycle='REVIEWED',
         grade_score=(SELECT result_score FROM vehicle_review_commands WHERE id=NEW.id),
         grade=(SELECT result_grade FROM vehicle_review_commands WHERE id=NEW.id),
         reviewed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.inspection_id
     AND (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  INSERT INTO vehicle_eligibility
    (vehicle_id,inspection_id,version,status,decided_by,decided_at,created_at)
  SELECT NEW.vehicle_id,NEW.inspection_id,
         COALESCE((SELECT MAX(version)+1 FROM vehicle_eligibility WHERE vehicle_id=NEW.vehicle_id),1),
         'ELIGIBLE',NEW.reviewer_user,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  UPDATE vehicle_review_commands
     SET eligibility_id=(
       SELECT id FROM vehicle_eligibility
        WHERE vehicle_id=NEW.vehicle_id
        ORDER BY version DESC LIMIT 1
     )
   WHERE id=NEW.id AND status='pending';

  INSERT OR IGNORE INTO vehicle_eligibility_reasons (eligibility_id,code,detail)
  SELECT eligibility_id,'NO_VERIFIED_OWNERSHIP','A verified ownership document is required.'
    FROM vehicle_review_commands c
   WHERE c.id=NEW.id AND c.status='pending'
     AND NOT EXISTS (
       SELECT 1 FROM vehicle_documents d
        WHERE d.vehicle_id=NEW.vehicle_id
          AND d.document_type='OWNERSHIP' AND d.status='VERIFIED'
          AND (d.expires_at IS NULL OR unixepoch(d.expires_at)>unixepoch('now'))
     );

  INSERT OR IGNORE INTO vehicle_eligibility_reasons (eligibility_id,code,detail)
  SELECT eligibility_id,'NO_VERIFIED_REGISTRATION','The declared registration requires verified evidence.'
    FROM vehicle_review_commands c
   WHERE c.id=NEW.id AND c.status='pending'
     AND EXISTS (
       SELECT 1 FROM vehicles v
        WHERE v.id=NEW.vehicle_id
          AND v.registration_number IS NOT NULL
          AND length(trim(v.registration_number))>0
     )
     AND NOT EXISTS (
       SELECT 1 FROM vehicle_documents d
        WHERE d.vehicle_id=NEW.vehicle_id
          AND d.document_type='REGISTRATION' AND d.status='VERIFIED'
          AND (d.expires_at IS NULL OR unixepoch(d.expires_at)>unixepoch('now'))
     );

  INSERT OR IGNORE INTO vehicle_eligibility_reasons (eligibility_id,code,detail)
  SELECT eligibility_id,'CUSTOMS_EVIDENCE_REQUIRED','Cleared imported vehicles require verified customs evidence.'
    FROM vehicle_review_commands c
   WHERE c.id=NEW.id AND c.status='pending'
     AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id=NEW.vehicle_id AND v.customs_status='CLEARED')
     AND NOT EXISTS (
       SELECT 1 FROM vehicle_documents d
        WHERE d.vehicle_id=NEW.vehicle_id
          AND d.document_type='CUSTOMS_CLEARANCE' AND d.status='VERIFIED'
          AND (d.expires_at IS NULL OR unixepoch(d.expires_at)>unixepoch('now'))
     );

  INSERT OR IGNORE INTO vehicle_eligibility_reasons (eligibility_id,code,detail)
  SELECT eligibility_id,'CUSTOMS_STATUS_UNRESOLVED','Customs status must be resolved before auction eligibility.'
    FROM vehicle_review_commands c
   WHERE c.id=NEW.id AND c.status='pending'
     AND EXISTS (
       SELECT 1 FROM vehicles v
        WHERE v.id=NEW.vehicle_id AND v.customs_status IN ('PENDING','UNKNOWN')
     );

  INSERT OR IGNORE INTO vehicle_eligibility_reasons (eligibility_id,code,detail)
  SELECT eligibility_id,'ROADWORTHY_FAILED','Inspection did not establish roadworthiness.'
    FROM vehicle_review_commands c
   WHERE c.id=NEW.id AND c.status='pending'
     AND EXISTS (
       SELECT 1 FROM vehicle_inspections i WHERE i.id=NEW.inspection_id AND i.roadworthy=0
     );

  INSERT OR IGNORE INTO vehicle_eligibility_reasons (eligibility_id,code,detail)
  SELECT eligibility_id,'CRITICAL_SAFETY_FINDING','Inspection contains a critical or safety-critical finding.'
    FROM vehicle_review_commands c
   WHERE c.id=NEW.id AND c.status='pending'
     AND EXISTS (
       SELECT 1 FROM vehicle_inspection_findings f
        WHERE f.inspection_id=NEW.inspection_id
          AND (f.safety_critical=1 OR f.severity='CRITICAL')
     );

  INSERT OR IGNORE INTO vehicle_eligibility_reasons (eligibility_id,code,detail)
  SELECT eligibility_id,'GRADE_REJECTED','Tengasell grade is below the auction eligibility threshold.'
    FROM vehicle_review_commands c
   WHERE c.id=NEW.id AND c.status='pending' AND c.result_grade='REJECT';

  UPDATE vehicle_eligibility
     SET status=CASE
       WHEN EXISTS (
         SELECT 1 FROM vehicle_eligibility_reasons r
          WHERE r.eligibility_id=vehicle_eligibility.id
       ) THEN 'INELIGIBLE'
       ELSE 'ELIGIBLE'
     END
   WHERE id=(SELECT eligibility_id FROM vehicle_review_commands WHERE id=NEW.id)
     AND (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  UPDATE vehicle_review_commands
     SET eligibility_status=(
       SELECT status FROM vehicle_eligibility
        WHERE id=vehicle_review_commands.eligibility_id
     )
   WHERE id=NEW.id AND status='pending';

  UPDATE vehicle_inspections
     SET lifecycle='SUPERSEDED',
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE vehicle_id=NEW.vehicle_id
     AND id<>NEW.inspection_id
     AND lifecycle='REVIEWED'
     AND (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  UPDATE vehicles
     SET tengasell_grade=(SELECT result_grade FROM vehicle_review_commands WHERE id=NEW.id),
         lifecycle=CASE
           WHEN (SELECT eligibility_status FROM vehicle_review_commands WHERE id=NEW.id)='ELIGIBLE'
             THEN 'ELIGIBLE'
           ELSE 'INELIGIBLE'
         END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.vehicle_id
     AND (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  INSERT INTO vehicle_evidence
    (vehicle_id,field_key,source_type,source_id,value_json,asserted_by,verified_by,verified_at,created_at)
  SELECT NEW.vehicle_id,'tengasell_grade','REVIEW',NEW.inspection_id,
         json_object(
           'score',(SELECT result_score FROM vehicle_review_commands WHERE id=NEW.id),
           'grade',(SELECT result_grade FROM vehicle_review_commands WHERE id=NEW.id),
           'eligibility',(SELECT eligibility_status FROM vehicle_review_commands WHERE id=NEW.id)
         ),
         NEW.reviewer_user,NEW.reviewer_user,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  -- A later failed inspection immediately removes commercial authority.
  -- With no bids the listing returns to draft for remediation; once bids exist
  -- the unsafe listing is cancelled and must be relisted after a fresh review.
  UPDATE auctions
     SET status=CASE WHEN bid_count=0 THEN 'draft' ELSE 'cancelled' END,
         version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(SELECT auction_id FROM vehicles WHERE id=NEW.vehicle_id)
     AND status='live'
     AND (SELECT eligibility_status FROM vehicle_review_commands WHERE id=NEW.id)='INELIGIBLE'
     AND (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  -- Vehicle auctions are activated only by the canonical review transaction.
  UPDATE auctions
     SET status='live',
         started_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         ends_at=strftime(
           '%Y-%m-%dT%H:%M:%SZ','now',
           '+' || (SELECT requested_duration_hours FROM vehicles WHERE id=NEW.vehicle_id) || ' hours'
         ),
         version=version+1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(SELECT auction_id FROM vehicles WHERE id=NEW.vehicle_id)
     AND status='draft'
     AND (SELECT eligibility_status FROM vehicle_review_commands WHERE id=NEW.id)='ELIGIBLE'
     AND (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  INSERT INTO audit_events (user,action,entity,entity_id,source,payload,created_at)
  SELECT NEW.reviewer_user,'vehicle:review','vehicles',NEW.vehicle_id,'vehicle-authority',
         json_object(
           'inspectionId',NEW.inspection_id,
           'score',(SELECT result_score FROM vehicle_review_commands WHERE id=NEW.id),
           'grade',(SELECT result_grade FROM vehicle_review_commands WHERE id=NEW.id),
           'eligibility',(SELECT eligibility_status FROM vehicle_review_commands WHERE id=NEW.id)
         ),
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM vehicle_review_commands WHERE id=NEW.id)='pending';

  UPDATE vehicle_review_commands
     SET status='accepted',
         completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';

  UPDATE vehicle_review_commands
     SET completed_at=COALESCE(completed_at,strftime('%Y-%m-%dT%H:%M:%SZ','now'))
   WHERE id=NEW.id;
END;
