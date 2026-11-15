-- TENGASELL-PI-01D / VEH-01 + VEH-04 — immutable assertions,
-- deterministic effective-value policy and explicit visibility rules.

CREATE TABLE pi_fact_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type TEXT NOT NULL CHECK(product_type IN ('VEHICLE','PART','AUCTION')),
  product_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  schema_version_id INTEGER NOT NULL REFERENCES pi_category_schema_versions(id),
  attribute_id INTEGER NOT NULL REFERENCES pi_attribute_definitions(id),
  attribute_version_id INTEGER NOT NULL REFERENCES pi_attribute_definition_versions(id),
  source_class TEXT NOT NULL CHECK(source_class IN (
    'SELLER_DECLARED','DOCUMENT_DERIVED','SYSTEM_DERIVED','INSPECTOR_VERIFIED','EXTERNAL_VERIFIED'
  )),
  verification_state TEXT NOT NULL CHECK(verification_state IN (
    'UNVERIFIED','PENDING','VERIFIED','REJECTED','EXPIRED'
  )),
  value_text TEXT,
  value_integer INTEGER,
  value_decimal REAL,
  value_boolean INTEGER CHECK(value_boolean IS NULL OR value_boolean IN (0,1)),
  value_date TEXT,
  value_datetime TEXT,
  value_option_key TEXT,
  value_json TEXT,
  measurement_unit TEXT,
  identifier_class TEXT,
  source_ref_type TEXT,
  source_ref_id INTEGER,
  asserted_by BLOB,
  verified_by BLOB,
  asserted_at TEXT NOT NULL,
  verified_at TEXT,
  valid_until TEXT,
  note TEXT NOT NULL DEFAULT '',
  CHECK(value_json IS NULL OR json_valid(value_json))
) STRICT;
CREATE INDEX idx_pi_facts_product_attribute
  ON pi_fact_assertions(product_type,product_id,attribute_id,asserted_at);
CREATE INDEX idx_pi_facts_source ON pi_fact_assertions(source_ref_type,source_ref_id);

CREATE TABLE pi_fact_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_assertion_id INTEGER NOT NULL REFERENCES pi_fact_assertions(id),
  to_assertion_id INTEGER NOT NULL REFERENCES pi_fact_assertions(id),
  link_type TEXT NOT NULL CHECK(link_type IN ('SUPERSEDES','VERIFIES','REJECTS','DERIVED_FROM','CORROBORATES')),
  created_by BLOB,
  created_at TEXT NOT NULL,
  UNIQUE(from_assertion_id,to_assertion_id,link_type),
  CHECK(from_assertion_id<>to_assertion_id)
) STRICT;

CREATE TABLE pi_effective_source_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL UNIQUE,
  attribute_id INTEGER REFERENCES pi_attribute_definitions(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE pi_effective_source_policy_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL REFERENCES pi_effective_source_policies(id),
  source_class TEXT NOT NULL CHECK(source_class IN (
    'SELLER_DECLARED','DOCUMENT_DERIVED','SYSTEM_DERIVED','INSPECTOR_VERIFIED','EXTERNAL_VERIFIED'
  )),
  trust_rank INTEGER NOT NULL CHECK(trust_rank>=0),
  verification_required INTEGER NOT NULL DEFAULT 0 CHECK(verification_required IN (0,1)),
  UNIQUE(policy_id,source_class)
) STRICT;

CREATE TABLE pi_effective_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type TEXT NOT NULL CHECK(product_type IN ('VEHICLE','PART','AUCTION')),
  product_id INTEGER NOT NULL,
  attribute_id INTEGER NOT NULL REFERENCES pi_attribute_definitions(id),
  assertion_id INTEGER REFERENCES pi_fact_assertions(id),
  source_class TEXT,
  verification_state TEXT,
  conflict_state TEXT NOT NULL CHECK(conflict_state IN (
    'NONE','LOWER_TRUST_DISAGREEMENT','PEER_CONFLICT','RESOLVED'
  )),
  value_text TEXT,
  value_integer INTEGER,
  value_decimal REAL,
  value_boolean INTEGER,
  value_date TEXT,
  value_datetime TEXT,
  value_option_key TEXT,
  value_json TEXT,
  measurement_unit TEXT,
  identifier_class TEXT,
  resolved_at TEXT NOT NULL,
  UNIQUE(product_type,product_id,attribute_id),
  CHECK(value_json IS NULL OR json_valid(value_json))
) STRICT;

CREATE TABLE pi_visibility_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  default_effect TEXT NOT NULL CHECK(default_effect IN ('PUBLIC','CLASSIFICATION_ONLY','OMIT','AUTHORISED_ONLY')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE pi_visibility_policy_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id INTEGER NOT NULL REFERENCES pi_visibility_policies(id),
  attribute_id INTEGER REFERENCES pi_attribute_definitions(id),
  audience TEXT NOT NULL CHECK(audience IN ('ANONYMOUS','AUTHENTICATED','SELLER','INSPECTOR','REVIEWER','OPERATOR','ADMIN')),
  effect TEXT NOT NULL CHECK(effect IN ('PUBLIC','CLASSIFICATION_ONLY','OMIT','FULL')),
  classification_label TEXT,
  UNIQUE(policy_id,attribute_id,audience)
) STRICT;

CREATE TRIGGER trg_pi_fact_assertion_binding
BEFORE INSERT ON pi_fact_assertions
WHEN NOT EXISTS(
  SELECT 1 FROM pi_category_attributes ca
   WHERE ca.category_id=NEW.category_id
     AND ca.schema_version_id=NEW.schema_version_id
     AND ca.attribute_id=NEW.attribute_id
     AND ca.attribute_version_id=NEW.attribute_version_id
)
BEGIN SELECT RAISE(ABORT,'PI_ATTRIBUTE_NOT_APPLICABLE'); END;

CREATE TRIGGER trg_pi_fact_assertion_typed_value
BEFORE INSERT ON pi_fact_assertions
WHEN NOT EXISTS(
  SELECT 1 FROM pi_attribute_definitions a WHERE a.id=NEW.attribute_id AND (
    (a.data_type='TEXT' AND NEW.value_text IS NOT NULL) OR
    (a.data_type='INTEGER' AND NEW.value_integer IS NOT NULL) OR
    (a.data_type='DECIMAL' AND NEW.value_decimal IS NOT NULL) OR
    (a.data_type='BOOLEAN' AND NEW.value_boolean IS NOT NULL) OR
    (a.data_type='DATE' AND NEW.value_date IS NOT NULL) OR
    (a.data_type='DATETIME' AND NEW.value_datetime IS NOT NULL) OR
    (a.data_type='ENUM' AND NEW.value_option_key IS NOT NULL) OR
    (a.data_type='MULTI_ENUM' AND NEW.value_json IS NOT NULL AND json_type(NEW.value_json)='array') OR
    (a.data_type='MEASUREMENT' AND NEW.value_decimal IS NOT NULL AND NEW.measurement_unit IS NOT NULL) OR
    (a.data_type='IDENTIFIER' AND NEW.value_text IS NOT NULL AND NEW.identifier_class IS NOT NULL)
  )
)
BEGIN SELECT RAISE(ABORT,'PI_ATTRIBUTE_VALUE_TYPE_MISMATCH'); END;

CREATE TRIGGER trg_pi_fact_assertion_immutable_update
BEFORE UPDATE ON pi_fact_assertions
BEGIN SELECT RAISE(ABORT,'PI_FACT_ASSERTION_IMMUTABLE'); END;
CREATE TRIGGER trg_pi_fact_assertion_immutable_delete
BEFORE DELETE ON pi_fact_assertions
BEGIN SELECT RAISE(ABORT,'PI_FACT_ASSERTION_IMMUTABLE'); END;
CREATE TRIGGER trg_pi_fact_link_immutable_update
BEFORE UPDATE ON pi_fact_links
BEGIN SELECT RAISE(ABORT,'PI_FACT_LINK_IMMUTABLE'); END;
CREATE TRIGGER trg_pi_fact_link_immutable_delete
BEFORE DELETE ON pi_fact_links
BEGIN SELECT RAISE(ABORT,'PI_FACT_LINK_IMMUTABLE'); END;

INSERT INTO pi_effective_source_policies(policy_key,attribute_id,description,created_at)
VALUES('DEFAULT_PRODUCT_FACT',NULL,'External, inspection, system, document, seller authority order','2026-01-01T00:00:00Z');
INSERT INTO pi_effective_source_policies(policy_key,attribute_id,description,created_at)
SELECT 'ODOMETER_AUTHORITY',id,'Inspection odometer overrides seller declaration while preserving disagreement','2026-01-01T00:00:00Z'
  FROM pi_attribute_definitions WHERE attribute_key='ODOMETER_KM';

INSERT INTO pi_effective_source_policy_entries(policy_id,source_class,trust_rank,verification_required)
SELECT p.id,s.source_class,s.trust_rank,s.requires_verification
  FROM pi_effective_source_policies p
 CROSS JOIN (
   SELECT 'SELLER_DECLARED' source_class,10 trust_rank,0 requires_verification
   UNION ALL SELECT 'DOCUMENT_DERIVED',20,1
   UNION ALL SELECT 'SYSTEM_DERIVED',30,1
   UNION ALL SELECT 'INSPECTOR_VERIFIED',40,1
   UNION ALL SELECT 'EXTERNAL_VERIFIED',50,1
 ) s;

INSERT INTO pi_visibility_policies(policy_key,description,default_effect,created_at) VALUES
('PRODUCT_PUBLIC','Normal buyer-visible product facts','PUBLIC','2026-01-01T00:00:00Z'),
('VEHICLE_IDENTIFIER_CLASSIFIED','Presence/classification only for anonymous identifiers','CLASSIFICATION_ONLY','2026-01-01T00:00:00Z'),
('PRODUCT_INTERNAL','Internal authority only','AUTHORISED_ONLY','2026-01-01T00:00:00Z'),
('PRODUCT_RESTRICTED','Seller and operational authority only','AUTHORISED_ONLY','2026-01-01T00:00:00Z'),
('DOCUMENT_REFERENCE_CLASSIFIED','Document status only; never raw reference','CLASSIFICATION_ONLY','2026-01-01T00:00:00Z');

INSERT INTO pi_visibility_policy_rules(policy_id,attribute_id,audience,effect,classification_label)
SELECT p.id,a.id,'ANONYMOUS','CLASSIFICATION_ONLY',
       CASE a.attribute_key
         WHEN 'VIN' THEN 'VIN recorded'
         WHEN 'CHASSIS_NUMBER' THEN 'Chassis identifier recorded'
         WHEN 'REGISTRATION_NUMBER' THEN 'Registration recorded'
       END
  FROM pi_visibility_policies p
  JOIN pi_attribute_definitions a ON a.attribute_key IN ('VIN','CHASSIS_NUMBER','REGISTRATION_NUMBER')
 WHERE p.policy_key='VEHICLE_IDENTIFIER_CLASSIFIED';
INSERT INTO pi_visibility_policy_rules(policy_id,attribute_id,audience,effect,classification_label)
SELECT p.id,a.id,'ANONYMOUS','OMIT',NULL
  FROM pi_visibility_policies p
  JOIN pi_attribute_definitions a ON a.attribute_key IN ('ENGINE_NUMBER','OWNERSHIP_STATUS')
 WHERE p.policy_key IN ('PRODUCT_INTERNAL','PRODUCT_RESTRICTED') AND p.policy_key=a.privacy_policy_key;
INSERT INTO pi_visibility_policy_rules(policy_id,attribute_id,audience,effect,classification_label)
SELECT p.id,a.id,role.audience,'FULL',NULL
  FROM pi_visibility_policies p
  JOIN pi_attribute_definitions a ON a.privacy_policy_key=p.policy_key
 CROSS JOIN (
   SELECT 'SELLER' audience UNION ALL SELECT 'INSPECTOR' UNION ALL SELECT 'REVIEWER'
   UNION ALL SELECT 'OPERATOR' UNION ALL SELECT 'ADMIN'
 ) role;

-- Converge historical scalar vehicle evidence without deleting the accepted
-- evidence ledger. Unmapped composite evidence remains readable in its legacy table.
INSERT INTO pi_fact_assertions(
  product_type,product_id,category_id,schema_version_id,attribute_id,attribute_version_id,
  source_class,verification_state,value_text,value_integer,value_decimal,value_boolean,
  value_date,value_datetime,value_option_key,value_json,measurement_unit,identifier_class,
  source_ref_type,source_ref_id,asserted_by,verified_by,asserted_at,verified_at,valid_until,note
)
SELECT 'VEHICLE',v.id,a.product_category_id,a.product_schema_version_id,d.id,dv.id,
       CASE e.source_type
         WHEN 'SELLER_DECLARATION' THEN 'SELLER_DECLARED'
         WHEN 'DOCUMENT' THEN 'DOCUMENT_DERIVED'
         WHEN 'INSPECTION' THEN 'INSPECTOR_VERIFIED'
         WHEN 'REVIEW' THEN 'SYSTEM_DERIVED'
       END,
       CASE WHEN e.source_type='SELLER_DECLARATION' THEN 'UNVERIFIED' ELSE 'VERIFIED' END,
       CASE WHEN d.data_type IN ('TEXT','IDENTIFIER') THEN CAST(json_extract(e.value_json,'$.value') AS TEXT) END,
       CASE WHEN d.data_type='INTEGER' THEN CAST(json_extract(e.value_json,'$.value') AS INTEGER) END,
       CASE WHEN d.data_type IN ('DECIMAL','MEASUREMENT') THEN CAST(json_extract(e.value_json,'$.value') AS REAL) END,
       CASE WHEN d.data_type='BOOLEAN' THEN CAST(json_extract(e.value_json,'$.value') AS INTEGER) END,
       CASE WHEN d.data_type='DATE' THEN CAST(json_extract(e.value_json,'$.value') AS TEXT) END,
       CASE WHEN d.data_type='DATETIME' THEN CAST(json_extract(e.value_json,'$.value') AS TEXT) END,
       CASE WHEN d.data_type='ENUM' THEN CAST(json_extract(e.value_json,'$.value') AS TEXT) END,
       CASE WHEN d.data_type='MULTI_ENUM' THEN json_extract(e.value_json,'$.value') END,
       CASE WHEN d.data_type='MEASUREMENT' THEN COALESCE(dv.canonical_unit,'unit') END,
       CASE WHEN d.data_type='IDENTIFIER' THEN d.attribute_key END,
       'vehicle_evidence',e.id,e.asserted_by,e.verified_by,e.created_at,e.verified_at,NULL,'Migrated legacy vehicle evidence'
  FROM vehicle_evidence e
  JOIN vehicles v ON v.id=e.vehicle_id
  JOIN auctions a ON a.id=v.auction_id
  JOIN pi_attribute_definitions d ON d.attribute_key=upper(e.field_key)
  JOIN pi_attribute_definition_versions dv ON dv.attribute_id=d.id AND dv.version=1
 WHERE a.product_category_id IS NOT NULL
   AND a.product_schema_version_id IS NOT NULL
   AND json_type(e.value_json,'$.value') IS NOT NULL
   AND json_type(e.value_json,'$.value')<>'null';
