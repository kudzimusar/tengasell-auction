-- TENGASELL-PI-01D / VEH-06 + VEH-07 + VEH-08 — atomic resumable intake,
-- inspection projection and privacy-safe buyer projection.

CREATE TABLE product_intake_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL UNIQUE REFERENCES auctions(id),
  owner_user BLOB NOT NULL,
  owner_username TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  schema_version_id INTEGER NOT NULL REFERENCES pi_category_schema_versions(id),
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','READY_FOR_PUBLISH','PUBLISHED','ABANDONED')),
  current_step TEXT NOT NULL DEFAULT 'CATEGORY' CHECK(current_step IN (
    'CATEGORY','IDENTITY','TECHNICAL','PHYSICAL','CONDITION','HISTORY','DOCUMENTS','MEDIA','COMMERCIAL','REVIEW'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
) STRICT;
CREATE INDEX idx_product_intake_owner ON product_intake_sessions(owner_user,state,updated_at);

CREATE TABLE product_intake_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES product_intake_sessions(id),
  step_key TEXT NOT NULL CHECK(step_key IN (
    'CATEGORY','IDENTITY','TECHNICAL','PHYSICAL','CONDITION','HISTORY','DOCUMENTS','MEDIA','COMMERCIAL','REVIEW'
  )),
  state TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(state IN ('NOT_STARTED','IN_PROGRESS','COMPLETE')),
  data_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id,step_key),
  CHECK(json_valid(data_json))
) STRICT;

CREATE TABLE product_intake_open_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key TEXT NOT NULL UNIQUE,
  actor_user BLOB NOT NULL,
  actor_username TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  schema_version_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL,
  legacy_category TEXT NOT NULL,
  condition TEXT NOT NULL,
  start_price REAL NOT NULL,
  buy_now_price REAL,
  reserve_price REAL,
  reserve_disclosure TEXT NOT NULL,
  shipping_fee REAL NOT NULL,
  shipping TEXT NOT NULL,
  city TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK(asset_kind IN ('general','vehicle','part')),
  images TEXT NOT NULL DEFAULT '[]',
  allow_offers INTEGER NOT NULL DEFAULT 0 CHECK(allow_offers IN (0,1)),
  offer_min REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code TEXT,
  result_auction_id INTEGER,
  result_session_id INTEGER,
  received_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  CHECK(json_valid(images))
) STRICT;

CREATE TABLE product_intake_step_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key TEXT NOT NULL UNIQUE,
  session_id INTEGER NOT NULL,
  actor_user BLOB NOT NULL,
  actor_admin INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  expected_revision INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  step_state TEXT NOT NULL CHECK(step_state IN ('IN_PROGRESS','COMPLETE')),
  data_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code TEXT,
  result_revision INTEGER,
  received_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  CHECK(json_valid(data_json))
) STRICT;

CREATE TABLE product_intake_publish_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_key TEXT NOT NULL UNIQUE,
  session_id INTEGER NOT NULL,
  actor_user BLOB NOT NULL,
  actor_admin INTEGER NOT NULL DEFAULT 0 CHECK(actor_admin IN (0,1)),
  expected_revision INTEGER NOT NULL,
  command_type TEXT NOT NULL CHECK(command_type IN ('CHECK_READY','PUBLISH','ABANDON')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  error_code TEXT,
  missing_attributes TEXT NOT NULL DEFAULT '[]',
  result_revision INTEGER,
  received_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  CHECK(json_valid(missing_attributes))
) STRICT;

CREATE TABLE pi_projection_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  product_type TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('FACT_ASSERTED','EFFECTIVE_FACT_CHANGED','PRODUCT_PUBLISHED','INSPECTION_PROJECTED')),
  payload TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  published_at TEXT,
  CHECK(json_valid(payload))
) STRICT;

CREATE TRIGGER trg_product_intake_open
AFTER INSERT ON product_intake_open_commands
BEGIN
  UPDATE product_intake_open_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;

  UPDATE product_intake_open_commands SET status='rejected',error_code='PI_CATEGORY_SCHEMA_INVALID'
   WHERE id=NEW.id AND status='pending' AND NOT EXISTS(
     SELECT 1 FROM categories c JOIN pi_category_schema_versions s ON s.category_id=c.id
      WHERE c.id=NEW.category_id AND c.node_kind='LEAF' AND c.active=1
        AND s.id=NEW.schema_version_id AND s.status='ACTIVE'
   );

  INSERT INTO auctions(
    user,seller_username,title,slug,description,category,condition,start_price,current_price,
    buy_now_price,reserve_price,bid_count,watch_count,views,shipping_fee,shipping,city,
    ends_at,started_at,status,extension_count,featured,images,created_at,updated_at,
    allow_offers,offer_min,version,asset_kind,reserve_disclosure,
    product_category_id,product_schema_version_id
  )
  SELECT NEW.actor_user,NEW.actor_username,NEW.title,NEW.slug,NEW.description,NEW.legacy_category,
         NEW.condition,NEW.start_price,NEW.start_price,NEW.buy_now_price,NEW.reserve_price,
         0,0,0,NEW.shipping_fee,NEW.shipping,NEW.city,NEW.ends_at,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),'draft',0,0,NEW.images,
         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'),
         NEW.allow_offers,NEW.offer_min,0,NEW.asset_kind,NEW.reserve_disclosure,
         NEW.category_id,NEW.schema_version_id
   WHERE (SELECT status FROM product_intake_open_commands WHERE id=NEW.id)='pending';

  UPDATE product_intake_open_commands SET result_auction_id=last_insert_rowid()
   WHERE id=NEW.id AND status='pending';

  INSERT INTO product_intake_sessions(
    auction_id,owner_user,owner_username,category_id,schema_version_id,state,current_step,revision,created_at,updated_at
  )
  SELECT result_auction_id,NEW.actor_user,NEW.actor_username,NEW.category_id,NEW.schema_version_id,
         'DRAFT','CATEGORY',0,strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now')
    FROM product_intake_open_commands WHERE id=NEW.id AND status='pending';

  UPDATE product_intake_open_commands
     SET result_session_id=last_insert_rowid(),status='accepted',completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';
END;

CREATE TRIGGER trg_product_intake_step
AFTER INSERT ON product_intake_step_commands
BEGIN
  UPDATE product_intake_step_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;
  UPDATE product_intake_step_commands SET status='rejected',error_code='INTAKE_SESSION_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NOT EXISTS(SELECT 1 FROM product_intake_sessions WHERE id=NEW.session_id);
  UPDATE product_intake_step_commands SET status='rejected',error_code='INTAKE_AUTHORITY_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1
     AND NOT EXISTS(SELECT 1 FROM product_intake_sessions WHERE id=NEW.session_id AND owner_user=NEW.actor_user);
  UPDATE product_intake_step_commands SET status='rejected',error_code='INTAKE_NOT_EDITABLE'
   WHERE id=NEW.id AND status='pending'
     AND EXISTS(SELECT 1 FROM product_intake_sessions WHERE id=NEW.session_id AND state<>'DRAFT');
  UPDATE product_intake_step_commands SET status='rejected',error_code='INTAKE_REVISION_CONFLICT'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM product_intake_sessions WHERE id=NEW.session_id AND revision=NEW.expected_revision);
  UPDATE product_intake_step_commands SET status='rejected',error_code='INTAKE_STEP_INVALID'
   WHERE id=NEW.id AND status='pending' AND NEW.step_key NOT IN (
     'CATEGORY','IDENTITY','TECHNICAL','PHYSICAL','CONDITION','HISTORY','DOCUMENTS','MEDIA','COMMERCIAL','REVIEW'
   );

  INSERT INTO product_intake_steps(session_id,step_key,state,data_json,revision,completed_at,updated_at)
  SELECT NEW.session_id,NEW.step_key,NEW.step_state,NEW.data_json,NEW.expected_revision+1,
         CASE WHEN NEW.step_state='COMPLETE' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') END,
         strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE (SELECT status FROM product_intake_step_commands WHERE id=NEW.id)='pending'
  ON CONFLICT(session_id,step_key) DO UPDATE SET
    state=excluded.state,data_json=excluded.data_json,revision=excluded.revision,
    completed_at=excluded.completed_at,updated_at=excluded.updated_at;

  UPDATE product_intake_sessions
     SET current_step=NEW.step_key,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND (SELECT status FROM product_intake_step_commands WHERE id=NEW.id)='pending';
  UPDATE product_intake_step_commands
     SET status='accepted',result_revision=NEW.expected_revision+1,completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';
END;

CREATE TRIGGER trg_product_intake_publish
AFTER INSERT ON product_intake_publish_commands
BEGIN
  UPDATE product_intake_publish_commands SET received_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=NEW.id;
  UPDATE product_intake_publish_commands SET status='rejected',error_code='INTAKE_SESSION_NOT_FOUND'
   WHERE id=NEW.id AND status='pending' AND NOT EXISTS(SELECT 1 FROM product_intake_sessions WHERE id=NEW.session_id);
  UPDATE product_intake_publish_commands SET status='rejected',error_code='INTAKE_AUTHORITY_REQUIRED'
   WHERE id=NEW.id AND status='pending' AND NEW.actor_admin<>1
     AND NOT EXISTS(SELECT 1 FROM product_intake_sessions WHERE id=NEW.session_id AND owner_user=NEW.actor_user);
  UPDATE product_intake_publish_commands SET status='rejected',error_code='INTAKE_REVISION_CONFLICT'
   WHERE id=NEW.id AND status='pending'
     AND NOT EXISTS(SELECT 1 FROM product_intake_sessions WHERE id=NEW.session_id AND revision=NEW.expected_revision);

  UPDATE product_intake_publish_commands
     SET missing_attributes=COALESCE((
       SELECT json_group_array(a.attribute_key)
         FROM pi_category_attributes ca
         JOIN pi_attribute_definitions a ON a.id=ca.attribute_id
         JOIN product_intake_sessions s ON s.id=NEW.session_id
        WHERE ca.schema_version_id=s.schema_version_id AND ca.publish_required=1
          AND NOT EXISTS(
            SELECT 1 FROM pi_effective_facts ef
             JOIN vehicles v ON v.id=ef.product_id
            WHERE ef.product_type='VEHICLE' AND v.auction_id=s.auction_id
              AND ef.attribute_id=ca.attribute_id AND ef.assertion_id IS NOT NULL
              AND ef.conflict_state<>'PEER_CONFLICT'
          )
     ),'[]')
   WHERE id=NEW.id AND status='pending' AND NEW.command_type IN ('CHECK_READY','PUBLISH');

  UPDATE product_intake_publish_commands SET status='rejected',error_code='PUBLISH_REQUIRED_FACTS_MISSING'
   WHERE id=NEW.id AND status='pending' AND NEW.command_type IN ('CHECK_READY','PUBLISH')
     AND json_array_length(missing_attributes)>0;

  UPDATE product_intake_sessions
     SET state=CASE NEW.command_type
       WHEN 'CHECK_READY' THEN 'READY_FOR_PUBLISH'
       WHEN 'PUBLISH' THEN 'PUBLISHED'
       WHEN 'ABANDON' THEN 'ABANDONED' END,
       revision=revision+1,
       published_at=CASE WHEN NEW.command_type='PUBLISH' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE published_at END,
       updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.session_id AND (SELECT status FROM product_intake_publish_commands WHERE id=NEW.id)='pending';

  UPDATE auctions
     SET status=CASE WHEN asset_kind='vehicle' THEN 'draft' ELSE 'live' END,
         updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=(SELECT auction_id FROM product_intake_sessions WHERE id=NEW.session_id)
     AND NEW.command_type='PUBLISH'
     AND (SELECT status FROM product_intake_publish_commands WHERE id=NEW.id)='pending';

  UPDATE product_intake_publish_commands
     SET status='accepted',result_revision=NEW.expected_revision+1,completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
   WHERE id=NEW.id AND status='pending';
END;

-- Existing vehicle records remain readable and become resumable without
-- inventing step completion or product values.
INSERT OR IGNORE INTO product_intake_sessions(
  auction_id,owner_user,owner_username,category_id,schema_version_id,state,current_step,revision,created_at,updated_at,published_at
)
SELECT a.id,a.user,a.seller_username,a.product_category_id,a.product_schema_version_id,
       CASE WHEN v.id IS NULL THEN 'DRAFT' ELSE 'PUBLISHED' END,
       CASE WHEN v.id IS NULL THEN 'CATEGORY' ELSE 'REVIEW' END,
       0,a.created_at,a.updated_at,CASE WHEN v.id IS NULL THEN NULL ELSE a.updated_at END
  FROM auctions a LEFT JOIN vehicles v ON v.auction_id=a.id
 WHERE a.asset_kind IN ('vehicle','part')
   AND a.product_category_id IS NOT NULL AND a.product_schema_version_id IS NOT NULL;

CREATE VIEW pi_vehicle_inspection_projection AS
SELECT v.id AS vehicle_id,v.auction_id,
       i.id AS inspection_id,i.lifecycle AS inspection_status,i.grade AS inspection_grade,
       i.grade_score,i.roadworthy,i.odometer_km AS inspection_odometer_km,
       COALESCE((SELECT COUNT(*) FROM vehicle_inspection_findings f WHERE f.inspection_id=i.id AND f.severity IN ('MAJOR','CRITICAL')),0) AS major_defect_count,
       CASE WHEN EXISTS(SELECT 1 FROM vehicle_inspection_findings f WHERE f.inspection_id=i.id AND f.safety_critical=1) THEN 1 ELSE 0 END AS safety_critical,
       COALESCE((SELECT group_concat(DISTINCT f.category) FROM vehicle_inspection_findings f WHERE f.inspection_id=i.id AND f.category='STRUCTURAL'),'NOT_PROVIDED') AS structural_condition_summary,
       COALESCE((SELECT group_concat(DISTINCT f.category) FROM vehicle_inspection_findings f WHERE f.inspection_id=i.id AND f.category='MECHANICAL'),'NOT_PROVIDED') AS mechanical_condition_summary,
       e.status AS eligibility_status
  FROM vehicles v
  LEFT JOIN vehicle_inspections i ON i.id=(SELECT i2.id FROM vehicle_inspections i2 WHERE i2.vehicle_id=v.id ORDER BY i2.version DESC LIMIT 1)
  LEFT JOIN vehicle_eligibility e ON e.id=(SELECT e2.id FROM vehicle_eligibility e2 WHERE e2.vehicle_id=v.id ORDER BY e2.version DESC LIMIT 1);

-- Privacy-safe anonymous projection. Raw canonical identifiers, document
-- references, storage references and personal user identifiers are absent.
CREATE VIEW pi_vehicle_public AS
SELECT v.id AS vehicle_id,v.auction_id,c.category_key,cl.label AS product_type,
       s.schema_key,a.title,a.status AS auction_status,a.current_price,a.reserve_disclosure,a.city,a.ends_at,
       v.make,v.model,v.variant,v.trim,v.model_year,v.manufacture_year,
       v.vehicle_class,v.body_type,v.fuel_type,v.transmission,v.drivetrain,
       COALESCE(
         (SELECT CAST(ef.value_decimal AS INTEGER) FROM pi_effective_facts ef JOIN pi_attribute_definitions ad ON ad.id=ef.attribute_id
           WHERE ef.product_type='VEHICLE' AND ef.product_id=v.id AND ad.attribute_key='ODOMETER_KM'),
         v.odometer_km
       ) AS effective_odometer_km,
       COALESCE(
         (SELECT ef.source_class FROM pi_effective_facts ef JOIN pi_attribute_definitions ad ON ad.id=ef.attribute_id
           WHERE ef.product_type='VEHICLE' AND ef.product_id=v.id AND ad.attribute_key='ODOMETER_KM'),
         'SELLER_DECLARED'
       ) AS odometer_source,
       COALESCE(
         (SELECT ef.conflict_state FROM pi_effective_facts ef JOIN pi_attribute_definitions ad ON ad.id=ef.attribute_id
           WHERE ef.product_type='VEHICLE' AND ef.product_id=v.id AND ad.attribute_key='ODOMETER_KM'),
         'NONE'
       ) AS odometer_conflict,
       v.engine_displacement_cc,v.power_kw,v.torque_nm,v.gear_count,v.hybrid_type,
       v.ev_battery_capacity_kwh,v.ev_range_km,v.steering_side,v.doors,v.seats,v.cab_type,
       v.primary_exterior_colour,v.manufacturer_colour_name,v.interior_colour,v.interior_material,
       v.service_history_class,v.accident_history,v.repair_history,v.structural_repair_history,
       v.modification_status,v.number_of_keys,v.spare_key,v.spare_wheel,v.tool_kit,v.manuals,v.service_book,
       CASE WHEN v.vin IS NULL THEN 'NOT_PROVIDED' ELSE 'RECORDED' END AS vin_classification,
       CASE WHEN v.chassis_number IS NULL THEN 'NOT_PROVIDED' ELSE 'RECORDED' END AS chassis_classification,
       CASE WHEN v.registration_number IS NULL THEN 'NOT_PROVIDED' ELSE 'RECORDED' END AS registration_classification,
       ip.inspection_status,ip.inspection_grade,ip.grade_score,ip.roadworthy,ip.inspection_odometer_km,
       ip.major_defect_count,ip.safety_critical,ip.structural_condition_summary,ip.mechanical_condition_summary,
       ip.eligibility_status,
       COALESCE((SELECT COUNT(*) FROM vehicle_documents d WHERE d.vehicle_id=v.id AND d.status='VERIFIED'),0) AS verified_document_count,
       COALESCE((SELECT COUNT(*) FROM vehicle_inspection_findings f WHERE f.inspection_id=ip.inspection_id),0) AS finding_count
  FROM vehicles v
  JOIN auctions a ON a.id=v.auction_id
  JOIN categories c ON c.id=a.product_category_id
  JOIN pi_category_schema_versions s ON s.id=a.product_schema_version_id
  LEFT JOIN pi_category_labels cl ON cl.category_id=c.id AND cl.locale='en'
  LEFT JOIN pi_vehicle_inspection_projection ip ON ip.vehicle_id=v.id;

CREATE VIEW pi_vehicle_document_public AS
SELECT d.vehicle_id,d.document_type,d.status,
       CASE WHEN d.status='VERIFIED' THEN 'VERIFIED_EVIDENCE'
            WHEN d.status IN ('DECLARED','UPLOADED') THEN 'PENDING_EVIDENCE'
            ELSE d.status END AS evidence_classification,
       d.historic_review_required
  FROM vehicle_documents d;

CREATE TRIGGER trg_pi_fact_projection_event
AFTER INSERT ON pi_fact_assertions
BEGIN
  INSERT OR IGNORE INTO pi_projection_outbox(event_key,product_type,product_id,event_type,payload,occurred_at)
  VALUES('fact:'||NEW.id,NEW.product_type,NEW.product_id,'FACT_ASSERTED',
         json_object('assertionId',NEW.id,'attributeId',NEW.attribute_id,'sourceClass',NEW.source_class),NEW.asserted_at);
END;

CREATE TRIGGER trg_pi_effective_projection_event
AFTER INSERT ON pi_effective_facts
BEGIN
  INSERT OR IGNORE INTO pi_projection_outbox(event_key,product_type,product_id,event_type,payload,occurred_at)
  VALUES('effective:'||NEW.id||':'||NEW.resolved_at,NEW.product_type,NEW.product_id,'EFFECTIVE_FACT_CHANGED',
         json_object('effectiveFactId',NEW.id,'attributeId',NEW.attribute_id,'conflict',NEW.conflict_state),NEW.resolved_at);
END;

CREATE TRIGGER trg_pi_effective_projection_update_event
AFTER UPDATE ON pi_effective_facts
BEGIN
  INSERT OR IGNORE INTO pi_projection_outbox(event_key,product_type,product_id,event_type,payload,occurred_at)
  VALUES('effective:'||NEW.id||':'||NEW.resolved_at,NEW.product_type,NEW.product_id,'EFFECTIVE_FACT_CHANGED',
         json_object('effectiveFactId',NEW.id,'attributeId',NEW.attribute_id,'conflict',NEW.conflict_state),NEW.resolved_at);
END;

CREATE TRIGGER trg_pi_product_published_event
AFTER UPDATE OF state ON product_intake_sessions
WHEN NEW.state='PUBLISHED' AND OLD.state<>'PUBLISHED'
BEGIN
  INSERT OR IGNORE INTO pi_projection_outbox(event_key,product_type,product_id,event_type,payload,occurred_at)
  VALUES('published:'||NEW.auction_id||':'||NEW.revision,'AUCTION',NEW.auction_id,'PRODUCT_PUBLISHED',
         json_object('auctionId',NEW.auction_id,'categoryId',NEW.category_id,'schemaVersionId',NEW.schema_version_id),NEW.updated_at);
END;
