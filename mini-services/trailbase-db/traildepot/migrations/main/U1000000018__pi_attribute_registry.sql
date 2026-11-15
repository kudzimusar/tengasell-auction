-- TENGASELL-PI-01D / VEH-01 — typed attribute registry and category applicability.

CREATE TABLE pi_attribute_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_key TEXT NOT NULL UNIQUE,
  data_type TEXT NOT NULL CHECK(data_type IN (
    'TEXT','INTEGER','DECIMAL','BOOLEAN','DATE','DATETIME','ENUM','MULTI_ENUM','MEASUREMENT','IDENTIFIER'
  )),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  searchable INTEGER NOT NULL DEFAULT 0 CHECK(searchable IN (0,1)),
  filter_class TEXT CHECK(filter_class IS NULL OR filter_class IN ('TERM','RANGE','BOOLEAN','DATE','NONE')),
  comparable INTEGER NOT NULL DEFAULT 0 CHECK(comparable IN (0,1)),
  display_group TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  privacy_policy_key TEXT NOT NULL DEFAULT 'PRODUCT_PUBLIC',
  storage_strategy TEXT NOT NULL CHECK(storage_strategy IN ('CANONICAL_COLUMN','FACT_ONLY','DERIVED_PROJECTION')),
  storage_locator TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE pi_attribute_definition_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_id INTEGER NOT NULL REFERENCES pi_attribute_definitions(id),
  version INTEGER NOT NULL CHECK(version>0),
  validation_json TEXT NOT NULL DEFAULT '{}',
  unit_family TEXT,
  canonical_unit TEXT,
  help_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(attribute_id,version),
  CHECK(json_valid(validation_json))
) STRICT;

CREATE TABLE pi_attribute_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_id INTEGER NOT NULL REFERENCES pi_attribute_definitions(id),
  locale TEXT NOT NULL,
  label TEXT NOT NULL,
  help_text TEXT NOT NULL DEFAULT '',
  UNIQUE(attribute_id,locale)
) STRICT;

CREATE TABLE pi_attribute_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_id INTEGER NOT NULL REFERENCES pi_attribute_definitions(id),
  option_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(attribute_id,option_key)
) STRICT;

CREATE TABLE pi_attribute_option_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  option_id INTEGER NOT NULL REFERENCES pi_attribute_options(id),
  locale TEXT NOT NULL,
  label TEXT NOT NULL,
  UNIQUE(option_id,locale)
) STRICT;

CREATE TABLE pi_attribute_option_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  option_id INTEGER NOT NULL REFERENCES pi_attribute_options(id),
  locale TEXT NOT NULL DEFAULT 'und',
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  UNIQUE(option_id,locale,normalized_alias)
) STRICT;

CREATE TABLE pi_category_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  schema_version_id INTEGER NOT NULL REFERENCES pi_category_schema_versions(id),
  attribute_id INTEGER NOT NULL REFERENCES pi_attribute_definitions(id),
  attribute_version_id INTEGER NOT NULL REFERENCES pi_attribute_definition_versions(id),
  draft_required INTEGER NOT NULL DEFAULT 0 CHECK(draft_required IN (0,1)),
  publish_required INTEGER NOT NULL DEFAULT 0 CHECK(publish_required IN (0,1)),
  eligibility_required INTEGER NOT NULL DEFAULT 0 CHECK(eligibility_required IN (0,1)),
  display_group TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(schema_version_id,attribute_id)
) STRICT;
CREATE INDEX idx_pi_category_attributes_stage
  ON pi_category_attributes(category_id,draft_required,publish_required,eligibility_required);

CREATE TRIGGER trg_pi_attribute_version_immutable_update
BEFORE UPDATE ON pi_attribute_definition_versions
BEGIN SELECT RAISE(ABORT,'PI_ATTRIBUTE_VERSION_IMMUTABLE'); END;
CREATE TRIGGER trg_pi_attribute_version_immutable_delete
BEFORE DELETE ON pi_attribute_definition_versions
BEGIN SELECT RAISE(ABORT,'PI_ATTRIBUTE_VERSION_IMMUTABLE'); END;

CREATE TRIGGER trg_pi_category_attribute_binding_insert
BEFORE INSERT ON pi_category_attributes
WHEN NOT EXISTS(
  SELECT 1 FROM pi_category_schema_versions s
   WHERE s.id=NEW.schema_version_id AND s.category_id=NEW.category_id
) OR NOT EXISTS(
  SELECT 1 FROM pi_attribute_definition_versions v
   WHERE v.id=NEW.attribute_version_id AND v.attribute_id=NEW.attribute_id
)
BEGIN SELECT RAISE(ABORT,'PI_CATEGORY_ATTRIBUTE_BINDING_INVALID'); END;

INSERT INTO pi_attribute_definitions(
  attribute_key,data_type,searchable,filter_class,comparable,display_group,display_order,
  privacy_policy_key,storage_strategy,storage_locator,created_at
) VALUES
('VIN','IDENTIFIER',0,'NONE',0,'IDENTITY',10,'VEHICLE_IDENTIFIER_CLASSIFIED','CANONICAL_COLUMN','vehicles.vin','2026-01-01T00:00:00Z'),
('CHASSIS_NUMBER','IDENTIFIER',0,'NONE',0,'IDENTITY',20,'VEHICLE_IDENTIFIER_CLASSIFIED','CANONICAL_COLUMN','vehicles.chassis_number','2026-01-01T00:00:00Z'),
('REGISTRATION_NUMBER','IDENTIFIER',0,'NONE',0,'IDENTITY',30,'VEHICLE_IDENTIFIER_CLASSIFIED','CANONICAL_COLUMN','vehicles.registration_number','2026-01-01T00:00:00Z'),
('MAKE','TEXT',1,'TERM',1,'IDENTITY',40,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.make','2026-01-01T00:00:00Z'),
('MODEL','TEXT',1,'TERM',1,'IDENTITY',50,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.model','2026-01-01T00:00:00Z'),
('VARIANT','TEXT',1,'TERM',1,'IDENTITY',60,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.variant','2026-01-01T00:00:00Z'),
('TRIM','TEXT',1,'TERM',1,'IDENTITY',70,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.trim','2026-01-01T00:00:00Z'),
('MODEL_YEAR','INTEGER',1,'RANGE',1,'IDENTITY',80,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.model_year','2026-01-01T00:00:00Z'),
('MANUFACTURE_YEAR','INTEGER',1,'RANGE',1,'IDENTITY',90,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.manufacture_year','2026-01-01T00:00:00Z'),
('FIRST_REGISTRATION_DATE','DATE',0,'DATE',1,'IDENTITY',100,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.first_registration_date','2026-01-01T00:00:00Z'),
('VEHICLE_CLASS','ENUM',1,'TERM',1,'TECHNICAL',10,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.vehicle_class','2026-01-01T00:00:00Z'),
('BODY_TYPE','ENUM',1,'TERM',1,'TECHNICAL',20,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.body_type','2026-01-01T00:00:00Z'),
('FUEL_TYPE','ENUM',1,'TERM',1,'TECHNICAL',30,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.fuel_type','2026-01-01T00:00:00Z'),
('TRANSMISSION','ENUM',1,'TERM',1,'TECHNICAL',40,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.transmission','2026-01-01T00:00:00Z'),
('DRIVETRAIN','ENUM',1,'TERM',1,'TECHNICAL',50,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.drivetrain','2026-01-01T00:00:00Z'),
('ODOMETER_KM','MEASUREMENT',1,'RANGE',1,'TECHNICAL',60,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.odometer_km','2026-01-01T00:00:00Z'),
('ENGINE_DISPLACEMENT_CC','INTEGER',1,'RANGE',1,'TECHNICAL',70,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.engine_displacement_cc','2026-01-01T00:00:00Z'),
('ENGINE_CODE','TEXT',0,'TERM',1,'TECHNICAL',80,'PRODUCT_INTERNAL','CANONICAL_COLUMN','vehicles.engine_code','2026-01-01T00:00:00Z'),
('ENGINE_NUMBER','IDENTIFIER',0,'NONE',0,'TECHNICAL',90,'PRODUCT_INTERNAL','CANONICAL_COLUMN','vehicles.engine_number','2026-01-01T00:00:00Z'),
('POWER_KW','DECIMAL',1,'RANGE',1,'TECHNICAL',100,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.power_kw','2026-01-01T00:00:00Z'),
('TORQUE_NM','DECIMAL',1,'RANGE',1,'TECHNICAL',110,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.torque_nm','2026-01-01T00:00:00Z'),
('GEAR_COUNT','INTEGER',0,'RANGE',1,'TECHNICAL',120,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.gear_count','2026-01-01T00:00:00Z'),
('STEERING_SIDE','ENUM',1,'TERM',1,'PHYSICAL',10,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.steering_side','2026-01-01T00:00:00Z'),
('DOORS','INTEGER',0,'RANGE',1,'PHYSICAL',20,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.doors','2026-01-01T00:00:00Z'),
('SEATS','INTEGER',0,'RANGE',1,'PHYSICAL',30,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.seats','2026-01-01T00:00:00Z'),
('EXTERIOR_COLOUR','ENUM',1,'TERM',1,'PHYSICAL',40,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.primary_exterior_colour','2026-01-01T00:00:00Z'),
('INTERIOR_COLOUR','ENUM',0,'TERM',1,'PHYSICAL',50,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.interior_colour','2026-01-01T00:00:00Z'),
('SERVICE_HISTORY_CLASS','ENUM',1,'TERM',1,'HISTORY',10,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.service_history_class','2026-01-01T00:00:00Z'),
('ACCIDENT_HISTORY','ENUM',1,'TERM',1,'HISTORY',20,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.accident_history','2026-01-01T00:00:00Z'),
('REPAIR_HISTORY','ENUM',0,'TERM',1,'HISTORY',30,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.repair_history','2026-01-01T00:00:00Z'),
('STRUCTURAL_REPAIR_HISTORY','ENUM',0,'TERM',1,'HISTORY',40,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.structural_repair_history','2026-01-01T00:00:00Z'),
('MODIFICATION_STATUS','ENUM',1,'TERM',1,'HISTORY',50,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.modification_status','2026-01-01T00:00:00Z'),
('OWNERSHIP_STATUS','ENUM',0,'TERM',0,'DOCUMENTATION',10,'PRODUCT_RESTRICTED','CANONICAL_COLUMN','vehicles.ownership_status','2026-01-01T00:00:00Z'),
('CUSTOMS_STATUS','ENUM',0,'TERM',0,'DOCUMENTATION',20,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.customs_status','2026-01-01T00:00:00Z'),
('NUMBER_OF_KEYS','INTEGER',0,'RANGE',1,'EQUIPMENT',10,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.number_of_keys','2026-01-01T00:00:00Z'),
('SPARE_KEY','BOOLEAN',0,'BOOLEAN',1,'EQUIPMENT',20,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.spare_key','2026-01-01T00:00:00Z'),
('SPARE_WHEEL','BOOLEAN',0,'BOOLEAN',1,'EQUIPMENT',30,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.spare_wheel','2026-01-01T00:00:00Z'),
('TOOL_KIT','BOOLEAN',0,'BOOLEAN',1,'EQUIPMENT',40,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.tool_kit','2026-01-01T00:00:00Z'),
('MANUALS','BOOLEAN',0,'BOOLEAN',1,'EQUIPMENT',50,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.manuals','2026-01-01T00:00:00Z'),
('SERVICE_BOOK','BOOLEAN',0,'BOOLEAN',1,'EQUIPMENT',60,'PRODUCT_PUBLIC','CANONICAL_COLUMN','vehicles.service_book','2026-01-01T00:00:00Z'),
('INSPECTION_STATUS','ENUM',0,'TERM',1,'INSPECTION',10,'PRODUCT_PUBLIC','DERIVED_PROJECTION','vehicle_inspections.lifecycle','2026-01-01T00:00:00Z'),
('INSPECTION_GRADE','ENUM',1,'TERM',1,'INSPECTION',20,'PRODUCT_PUBLIC','DERIVED_PROJECTION','vehicle_inspections.grade','2026-01-01T00:00:00Z'),
('ROADWORTHY','BOOLEAN',1,'BOOLEAN',1,'INSPECTION',30,'PRODUCT_PUBLIC','DERIVED_PROJECTION','vehicle_inspections.roadworthy','2026-01-01T00:00:00Z'),
('MAJOR_DEFECT_COUNT','INTEGER',0,'RANGE',1,'INSPECTION',40,'PRODUCT_PUBLIC','DERIVED_PROJECTION','vehicle_inspection_findings','2026-01-01T00:00:00Z'),
('PART_NUMBER','TEXT',1,'TERM',1,'IDENTITY',10,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z'),
('COMPATIBLE_MODELS','MULTI_ENUM',1,'TERM',1,'TECHNICAL',20,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z');

INSERT INTO pi_attribute_definition_versions(attribute_id,version,validation_json,unit_family,canonical_unit,created_at)
SELECT id,1,
       CASE attribute_key
         WHEN 'VIN' THEN '{"minLength":17,"maxLength":17,"identifierClass":"VIN"}'
         WHEN 'ODOMETER_KM' THEN '{"minimum":0,"maximum":99999999}'
         WHEN 'MODEL_YEAR' THEN '{"minimum":1900,"maximum":2100}'
         WHEN 'MANUFACTURE_YEAR' THEN '{"minimum":1900,"maximum":2100}'
         ELSE '{}'
       END,
       CASE WHEN attribute_key='ODOMETER_KM' THEN 'DISTANCE' ELSE NULL END,
       CASE WHEN attribute_key='ODOMETER_KM' THEN 'km' ELSE NULL END,
       '2026-01-01T00:00:00Z'
  FROM pi_attribute_definitions;

INSERT INTO pi_attribute_labels(attribute_id,locale,label,help_text)
SELECT id,'en',replace(substr(attribute_key,1,1)||lower(substr(attribute_key,2)),'_',' '),''
  FROM pi_attribute_definitions;

-- Every whole-vehicle leaf shares the governed V1 vehicle schema. Values are
-- still category-applicable records, so later versions can diverge safely.
INSERT INTO pi_category_attributes(
  category_id,schema_version_id,attribute_id,attribute_version_id,
  draft_required,publish_required,eligibility_required,display_group,display_order
)
SELECT c.id,s.id,a.id,v.id,
       CASE WHEN a.attribute_key IN ('MAKE','MODEL','MODEL_YEAR','FUEL_TYPE','TRANSMISSION','DRIVETRAIN','ODOMETER_KM') THEN 1 ELSE 0 END,
       CASE WHEN a.attribute_key IN ('MAKE','MODEL','MODEL_YEAR','FUEL_TYPE','TRANSMISSION','DRIVETRAIN','ODOMETER_KM','OWNERSHIP_STATUS','CUSTOMS_STATUS') THEN 1 ELSE 0 END,
       CASE WHEN a.attribute_key IN ('ODOMETER_KM','OWNERSHIP_STATUS','CUSTOMS_STATUS','INSPECTION_STATUS','ROADWORTHY') THEN 1 ELSE 0 END,
       a.display_group,a.display_order
  FROM categories c
  JOIN pi_category_schema_versions s ON s.category_id=c.id AND s.status='ACTIVE'
  CROSS JOIN pi_attribute_definitions a
  JOIN pi_attribute_definition_versions v ON v.attribute_id=a.id AND v.version=1
 WHERE c.category_key LIKE 'VEHICLE_%'
   AND c.category_key<>'VEHICLE_PARTS_GENERAL'
   AND a.attribute_key NOT IN ('PART_NUMBER','COMPATIBLE_MODELS');

INSERT INTO pi_category_attributes(
  category_id,schema_version_id,attribute_id,attribute_version_id,
  draft_required,publish_required,eligibility_required,display_group,display_order
)
SELECT c.id,s.id,a.id,v.id,
       CASE WHEN a.attribute_key='PART_NUMBER' THEN 1 ELSE 0 END,
       CASE WHEN a.attribute_key='PART_NUMBER' THEN 1 ELSE 0 END,
       0,a.display_group,a.display_order
  FROM categories c
  JOIN pi_category_schema_versions s ON s.category_id=c.id AND s.status='ACTIVE'
  CROSS JOIN pi_attribute_definitions a
  JOIN pi_attribute_definition_versions v ON v.attribute_id=a.id AND v.version=1
 WHERE c.category_key='VEHICLE_PARTS_GENERAL'
   AND a.attribute_key IN ('PART_NUMBER','COMPATIBLE_MODELS');
