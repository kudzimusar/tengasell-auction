-- TENGASELL-PI-01E / DISC-01 + DISC-02 — structured search projection,
-- category-aware filters, and search read model.
--
-- Search is DERIVED, REBUILDABLE, and NON-AUTHORITATIVE. Canonical truth remains
-- in auctions, vehicles, pi_effective_facts and inspection records. Sensitive
-- identifiers (VIN, chassis, reg, engine serial, document numbers) are NEVER indexed.

-- 1. Extend category attribute bindings with filter classes
ALTER TABLE pi_category_attributes ADD COLUMN filter_class TEXT NOT NULL DEFAULT 'NONE'
  CHECK(filter_class IN ('PRIMARY','SECONDARY','ADVANCED','DISPLAY_ONLY','NONE'));

-- Vehicle attribute filter classification
UPDATE pi_category_attributes
   SET filter_class='PRIMARY'
 WHERE attribute_id IN (
   SELECT id FROM pi_attribute_definitions
    WHERE attribute_key IN ('MAKE','MODEL','MODEL_YEAR','ODOMETER_KM','VEHICLE_CLASS','BODY_TYPE')
 );

UPDATE pi_category_attributes
   SET filter_class='SECONDARY'
 WHERE attribute_id IN (
   SELECT id FROM pi_attribute_definitions
    WHERE attribute_key IN ('FUEL_TYPE','TRANSMISSION','DRIVETRAIN','EXTERIOR_COLOUR','INSPECTION_GRADE','INSPECTION_STATUS','ROADWORTHY')
 );

UPDATE pi_category_attributes
   SET filter_class='ADVANCED'
 WHERE attribute_id IN (
   SELECT id FROM pi_attribute_definitions
    WHERE attribute_key IN (
      'VARIANT','TRIM','ENGINE_DISPLACEMENT_CC','STEERING_SIDE','DOORS','SEATS',
      'SERVICE_HISTORY_CLASS','ACCIDENT_HISTORY','REPAIR_HISTORY',
      'STRUCTURAL_REPAIR_HISTORY','MODIFICATION_STATUS','CUSTOMS_STATUS'
    )
 );

UPDATE pi_category_attributes
   SET filter_class='DISPLAY_ONLY'
 WHERE filter_class='NONE'
   AND attribute_id IN (
     SELECT id FROM pi_attribute_definitions
      WHERE attribute_key IN (
        'MANUFACTURE_YEAR','FIRST_REGISTRATION_DATE','POWER_KW','TORQUE_NM',
        'GEAR_COUNT','INTERIOR_COLOUR','NUMBER_OF_KEYS','SPARE_KEY',
        'SPARE_WHEEL','TOOL_KIT','MANUALS','SERVICE_BOOK','MAJOR_DEFECT_COUNT'
      )
   );

-- 2. Seed phone category leaf & attributes to establish the phone architecture seam
-- and prove category isolation (phone schema has brand/storage/ram; no drivetrain).
INSERT OR IGNORE INTO categories(
  slug,name,name_ja,icon,blurb,sort,category_key,parent_id,node_kind,active,
  legacy_slug,created_at,updated_at
) VALUES(
  'phone-smartphone','Smartphones','','smartphone','Mobile phones and smartphones',20,
  'PHONE_SMARTPHONE',(SELECT id FROM categories WHERE category_key='TECHNOLOGY'),
  'LEAF',1,'phones','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
);

INSERT OR IGNORE INTO pi_category_labels(category_id,locale,label,description,created_at)
SELECT id,'en','Smartphones','Mobile phones and smartphones','2026-01-01T00:00:00Z'
  FROM categories WHERE category_key='PHONE_SMARTPHONE';

INSERT OR IGNORE INTO pi_category_schema_versions(
  category_id,version,schema_key,status,schema_hash,change_note,created_at,activated_at
)
SELECT id,1,'PHONE_SMARTPHONE_V1','ACTIVE','hash-phone-v1','Initial phone schema','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
  FROM categories WHERE category_key='PHONE_SMARTPHONE';

INSERT OR IGNORE INTO pi_attribute_definitions(
  attribute_key,data_type,searchable,filter_class,comparable,display_group,display_order,
  privacy_policy_key,storage_strategy,storage_locator,created_at
) VALUES
('BRAND','TEXT',1,'TERM',1,'IDENTITY',10,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z'),
('PHONE_MODEL','TEXT',1,'TERM',1,'IDENTITY',20,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z'),
('STORAGE_GB','INTEGER',1,'RANGE',1,'TECHNICAL',30,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z'),
('RAM_GB','INTEGER',1,'RANGE',1,'TECHNICAL',40,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z'),
('DEVICE_COLOUR','ENUM',1,'TERM',1,'PHYSICAL',50,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z'),
('NETWORK_GENERATION','ENUM',1,'TERM',1,'TECHNICAL',60,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z'),
('BATTERY_HEALTH_PCT','INTEGER',1,'RANGE',1,'CONDITION',70,'PRODUCT_PUBLIC','FACT_ONLY',NULL,'2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO pi_attribute_definition_versions(attribute_id,version,validation_json,unit_family,canonical_unit,created_at)
SELECT id,1,'{}',
  CASE WHEN attribute_key IN ('STORAGE_GB','RAM_GB') THEN 'DIGITAL_STORAGE'
       WHEN attribute_key='BATTERY_HEALTH_PCT' THEN 'PERCENT' ELSE NULL END,
  CASE WHEN attribute_key IN ('STORAGE_GB','RAM_GB') THEN 'GB'
       WHEN attribute_key='BATTERY_HEALTH_PCT' THEN '%' ELSE NULL END,
  '2026-01-01T00:00:00Z'
  FROM pi_attribute_definitions WHERE attribute_key IN ('BRAND','PHONE_MODEL','STORAGE_GB','RAM_GB','DEVICE_COLOUR','NETWORK_GENERATION','BATTERY_HEALTH_PCT');

INSERT OR IGNORE INTO pi_attribute_labels(attribute_id,locale,label,help_text)
SELECT id,'en',
  CASE attribute_key
    WHEN 'BRAND' THEN 'Brand'
    WHEN 'PHONE_MODEL' THEN 'Model'
    WHEN 'STORAGE_GB' THEN 'Storage'
    WHEN 'RAM_GB' THEN 'RAM'
    WHEN 'DEVICE_COLOUR' THEN 'Colour'
    WHEN 'NETWORK_GENERATION' THEN 'Network'
    WHEN 'BATTERY_HEALTH_PCT' THEN 'Battery Health'
    ELSE attribute_key END,
  ''
  FROM pi_attribute_definitions WHERE attribute_key IN ('BRAND','PHONE_MODEL','STORAGE_GB','RAM_GB','DEVICE_COLOUR','NETWORK_GENERATION','BATTERY_HEALTH_PCT');

INSERT OR IGNORE INTO pi_category_attributes(
  category_id,schema_version_id,attribute_id,attribute_version_id,
  draft_required,publish_required,eligibility_required,display_group,display_order,filter_class
)
SELECT c.id,s.id,a.id,v.id,
  CASE WHEN a.attribute_key IN ('BRAND','PHONE_MODEL','STORAGE_GB') THEN 1 ELSE 0 END,
  CASE WHEN a.attribute_key IN ('BRAND','PHONE_MODEL','STORAGE_GB') THEN 1 ELSE 0 END,
  0,a.display_group,a.display_order,
  CASE WHEN a.attribute_key IN ('BRAND','PHONE_MODEL','STORAGE_GB') THEN 'PRIMARY'
       WHEN a.attribute_key IN ('RAM_GB','DEVICE_COLOUR','NETWORK_GENERATION') THEN 'SECONDARY'
       WHEN a.attribute_key IN ('BATTERY_HEALTH_PCT') THEN 'ADVANCED'
       ELSE 'NONE' END
  FROM categories c
  JOIN pi_category_schema_versions s ON s.category_id=c.id AND s.status='ACTIVE'
  CROSS JOIN pi_attribute_definitions a
  JOIN pi_attribute_definition_versions v ON v.attribute_id=a.id AND v.version=1
 WHERE c.category_key='PHONE_SMARTPHONE'
   AND a.attribute_key IN ('BRAND','PHONE_MODEL','STORAGE_GB','RAM_GB','DEVICE_COLOUR','NETWORK_GENERATION','BATTERY_HEALTH_PCT');

-- 3. Core Search Read Model (Derived, Rebuildable, Non-Authoritative)
CREATE TABLE product_search_index (
  auction_id INTEGER PRIMARY KEY REFERENCES auctions(id),
  product_category_id INTEGER NOT NULL REFERENCES categories(id),
  category_key TEXT NOT NULL,
  schema_version_id INTEGER NOT NULL REFERENCES pi_category_schema_versions(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  make TEXT,
  model TEXT,
  generation TEXT,
  variant TEXT,
  trim TEXT,
  model_code TEXT,
  year INTEGER,
  price REAL NOT NULL DEFAULT 0,
  mileage INTEGER,
  vehicle_class TEXT,
  body_type TEXT,
  fuel TEXT,
  transmission TEXT,
  drivetrain TEXT,
  steering_side TEXT,
  exterior_colour TEXT,
  location TEXT NOT NULL DEFAULT '',
  sale_condition TEXT NOT NULL DEFAULT '',
  inspection_status TEXT,
  inspection_grade TEXT,
  roadworthy INTEGER,
  service_history_class TEXT,
  accident_history TEXT,
  repair_history TEXT,
  modification_status TEXT,
  import_state TEXT,
  customs_status TEXT,
  reserve_disclosure TEXT NOT NULL DEFAULT 'UNSPECIFIED',
  auction_status TEXT NOT NULL DEFAULT 'live',
  ending_time TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_psi_cat_status ON product_search_index(category_key, auction_status);
CREATE INDEX idx_psi_price ON product_search_index(price);
CREATE INDEX idx_psi_mileage ON product_search_index(mileage);
CREATE INDEX idx_psi_year ON product_search_index(year);
CREATE INDEX idx_psi_make_model ON product_search_index(make, model);
CREATE INDEX idx_psi_ending ON product_search_index(ending_time);
CREATE INDEX idx_psi_status_ending ON product_search_index(auction_status, ending_time);
CREATE INDEX idx_psi_location ON product_search_index(location);
CREATE INDEX idx_psi_condition ON product_search_index(sale_condition);

-- 4. Category-Aware Facet Values Table
CREATE TABLE product_search_facet_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL REFERENCES auctions(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  attribute_id INTEGER NOT NULL REFERENCES pi_attribute_definitions(id),
  attribute_key TEXT NOT NULL,
  filter_class TEXT NOT NULL CHECK(filter_class IN ('PRIMARY','SECONDARY','ADVANCED','DISPLAY_ONLY','NONE')),
  data_type TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_boolean INTEGER,
  value_date TEXT,
  indexed_at TEXT NOT NULL DEFAULT '',
  UNIQUE(auction_id, attribute_key, value_text)
) STRICT;

CREATE INDEX idx_psfv_attr_val ON product_search_facet_values(attribute_key, value_text);
CREATE INDEX idx_psfv_attr_num ON product_search_facet_values(attribute_key, value_number);
CREATE INDEX idx_psfv_auction ON product_search_facet_values(auction_id);

-- 5. Full-Text Search (FTS5) Virtual Table
CREATE VIRTUAL TABLE product_search_fts USING fts5(
  auction_id UNINDEXED,
  title,
  description,
  make,
  model,
  variant,
  trim,
  model_code,
  brand,
  search_text
);

-- 6. Initial Population / Backfill from Canonical Data
INSERT OR REPLACE INTO product_search_index(
  auction_id, product_category_id, category_key, schema_version_id,
  title, description, make, model, generation, variant, trim, model_code,
  year, price, mileage, vehicle_class, body_type, fuel, transmission,
  drivetrain, steering_side, exterior_colour, location, sale_condition,
  inspection_status, inspection_grade, roadworthy, service_history_class,
  accident_history, repair_history, modification_status, import_state,
  customs_status, reserve_disclosure, auction_status, ending_time,
  featured, created_at, updated_at, indexed_at
)
SELECT
  a.id AS auction_id,
  COALESCE(a.product_category_id, (SELECT id FROM categories WHERE category_key='VEHICLE_WHOLE_UNCLASSIFIED')) AS product_category_id,
  COALESCE(c.category_key, 'VEHICLE_WHOLE_UNCLASSIFIED') AS category_key,
  COALESCE(a.product_schema_version_id, (SELECT id FROM pi_category_schema_versions WHERE category_id=COALESCE(a.product_category_id, (SELECT id FROM categories WHERE category_key='VEHICLE_WHOLE_UNCLASSIFIED')) AND status='ACTIVE' LIMIT 1), 1) AS schema_version_id,
  a.title,
  COALESCE(a.description, '') AS description,
  v.make,
  v.model,
  v.generation_series AS generation,
  v.variant,
  v.trim,
  v.model_code,
  COALESCE(v.model_year, v.manufacture_year) AS year,
  COALESCE(a.current_price, a.start_price, 0) AS price,
  COALESCE(
    (SELECT CAST(ef.value_decimal AS INTEGER) FROM pi_effective_facts ef
      JOIN pi_attribute_definitions ad ON ad.id=ef.attribute_id
     WHERE ef.product_type='VEHICLE' AND ef.product_id=v.id AND ad.attribute_key='ODOMETER_KM'),
    v.odometer_km
  ) AS mileage,
  v.vehicle_class,
  v.body_type,
  v.fuel_type AS fuel,
  v.transmission,
  v.drivetrain,
  v.steering_side,
  v.primary_exterior_colour AS exterior_colour,
  COALESCE(a.city, '') AS location,
  COALESCE(a.condition, '') AS sale_condition,
  ip.inspection_status,
  ip.inspection_grade,
  ip.roadworthy,
  v.service_history_class,
  v.accident_history,
  v.repair_history,
  v.modification_status,
  CASE WHEN v.customs_status IN ('LOCAL') THEN 'DOMESTIC'
       WHEN v.customs_status IN ('CLEARED','PENDING') THEN 'IMPORTED'
       ELSE 'UNSPECIFIED' END AS import_state,
  v.customs_status,
  COALESCE(a.reserve_disclosure, 'UNSPECIFIED') AS reserve_disclosure,
  a.status AS auction_status,
  a.ends_at AS ending_time,
  COALESCE(a.featured, 0) AS featured,
  a.created_at,
  a.updated_at,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now') AS indexed_at
FROM auctions a
LEFT JOIN categories c ON c.id=a.product_category_id
LEFT JOIN vehicles v ON v.auction_id=a.id
LEFT JOIN pi_vehicle_inspection_projection ip ON ip.vehicle_id=v.id;

-- Initial FTS Index Population
INSERT INTO product_search_fts(auction_id, title, description, make, model, variant, trim, model_code, brand, search_text)
SELECT
  psi.auction_id,
  psi.title,
  psi.description,
  COALESCE(psi.make, ''),
  COALESCE(psi.model, ''),
  COALESCE(psi.variant, ''),
  COALESCE(psi.trim, ''),
  COALESCE(psi.model_code, ''),
  COALESCE(psi.make, ''),
  trim(COALESCE(psi.title,'') || ' ' || COALESCE(psi.description,'') || ' ' || COALESCE(psi.make,'') || ' ' || COALESCE(psi.model,'') || ' ' || COALESCE(psi.variant,'') || ' ' || COALESCE(psi.trim,'') || ' ' || COALESCE(psi.model_code,'') || ' ' || COALESCE(psi.vehicle_class,'') || ' ' || COALESCE(psi.body_type,'') || ' ' || COALESCE(psi.fuel,'') || ' ' || COALESCE(psi.transmission,'') || ' ' || COALESCE(psi.drivetrain,'') || ' ' || COALESCE(psi.exterior_colour,'') || ' ' || COALESCE(psi.location,''))
FROM product_search_index psi;

-- Initial Facet Population
INSERT OR IGNORE INTO product_search_facet_values(
  auction_id, category_id, attribute_id, attribute_key, filter_class, data_type, value_text, value_number, value_boolean, value_date, indexed_at
)
SELECT
  psi.auction_id,
  psi.product_category_id,
  ad.id,
  ad.attribute_key,
  COALESCE(ca.filter_class, 'NONE'),
  ad.data_type,
  CASE ad.attribute_key
    WHEN 'MAKE' THEN psi.make
    WHEN 'MODEL' THEN psi.model
    WHEN 'VARIANT' THEN psi.variant
    WHEN 'TRIM' THEN psi.trim
    WHEN 'VEHICLE_CLASS' THEN psi.vehicle_class
    WHEN 'BODY_TYPE' THEN psi.body_type
    WHEN 'FUEL_TYPE' THEN psi.fuel
    WHEN 'TRANSMISSION' THEN psi.transmission
    WHEN 'DRIVETRAIN' THEN psi.drivetrain
    WHEN 'EXTERIOR_COLOUR' THEN psi.exterior_colour
    WHEN 'INSPECTION_STATUS' THEN psi.inspection_status
    WHEN 'INSPECTION_GRADE' THEN psi.inspection_grade
    WHEN 'SERVICE_HISTORY_CLASS' THEN psi.service_history_class
    WHEN 'ACCIDENT_HISTORY' THEN psi.accident_history
    WHEN 'CUSTOMS_STATUS' THEN psi.customs_status
    ELSE NULL END AS value_text,
  CASE ad.attribute_key
    WHEN 'MODEL_YEAR' THEN psi.year
    WHEN 'ODOMETER_KM' THEN psi.mileage
    ELSE NULL END AS value_number,
  CASE ad.attribute_key
    WHEN 'ROADWORTHY' THEN psi.roadworthy
    ELSE NULL END AS value_boolean,
  NULL,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM product_search_index psi
CROSS JOIN pi_attribute_definitions ad
LEFT JOIN pi_category_attributes ca ON ca.attribute_id=ad.id AND ca.schema_version_id=psi.schema_version_id
WHERE (
  (ad.attribute_key='MAKE' AND psi.make IS NOT NULL) OR
  (ad.attribute_key='MODEL' AND psi.model IS NOT NULL) OR
  (ad.attribute_key='MODEL_YEAR' AND psi.year IS NOT NULL) OR
  (ad.attribute_key='ODOMETER_KM' AND psi.mileage IS NOT NULL) OR
  (ad.attribute_key='VEHICLE_CLASS' AND psi.vehicle_class IS NOT NULL) OR
  (ad.attribute_key='BODY_TYPE' AND psi.body_type IS NOT NULL) OR
  (ad.attribute_key='FUEL_TYPE' AND psi.fuel IS NOT NULL) OR
  (ad.attribute_key='TRANSMISSION' AND psi.transmission IS NOT NULL) OR
  (ad.attribute_key='DRIVETRAIN' AND psi.drivetrain IS NOT NULL) OR
  (ad.attribute_key='EXTERIOR_COLOUR' AND psi.exterior_colour IS NOT NULL) OR
  (ad.attribute_key='INSPECTION_STATUS' AND psi.inspection_status IS NOT NULL) OR
  (ad.attribute_key='INSPECTION_GRADE' AND psi.inspection_grade IS NOT NULL) OR
  (ad.attribute_key='ROADWORTHY' AND psi.roadworthy IS NOT NULL)
);

-- 7. Outbox Triggers for Search Index Synchronization
CREATE TRIGGER trg_psi_auction_mutation
AFTER UPDATE ON auctions
BEGIN
  INSERT OR IGNORE INTO pi_projection_outbox(event_key, product_type, product_id, event_type, payload, occurred_at)
  VALUES('search:auction:'||NEW.id||':'||NEW.updated_at, 'AUCTION', NEW.id, 'SEARCH_INDEX_REFRESH',
         json_object('auctionId', NEW.id, 'status', NEW.status, 'price', NEW.current_price), NEW.updated_at);
END;

CREATE TRIGGER trg_psi_vehicle_mutation
AFTER UPDATE ON vehicles
BEGIN
  INSERT OR IGNORE INTO pi_projection_outbox(event_key, product_type, product_id, event_type, payload, occurred_at)
  VALUES('search:vehicle:'||NEW.id||':'||NEW.updated_at, 'VEHICLE', NEW.id, 'SEARCH_INDEX_REFRESH',
         json_object('vehicleId', NEW.id, 'auctionId', NEW.auction_id), NEW.updated_at);
END;
