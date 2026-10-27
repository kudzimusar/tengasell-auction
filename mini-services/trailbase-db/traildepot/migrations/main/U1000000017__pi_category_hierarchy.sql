-- TENGASELL-PI-01D / VEH-01 — category hierarchy and immutable schema custody.
-- Existing categories remain the authority. Legacy slugs stay readable while
-- Product Intelligence binds auctions to governed leaf nodes and schema versions.

ALTER TABLE categories ADD COLUMN category_key TEXT;
ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id);
ALTER TABLE categories ADD COLUMN node_kind TEXT NOT NULL DEFAULT 'LEAF'
  CHECK(node_kind IN ('GROUP','LEAF'));
ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE categories ADD COLUMN legacy_slug TEXT;
ALTER TABLE categories ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE categories
   SET category_key='LEGACY_'||id,
       legacy_slug=slug,
       created_at='2026-01-01T00:00:00Z',
       updated_at='2026-01-01T00:00:00Z'
 WHERE category_key IS NULL;

CREATE UNIQUE INDEX uq_categories_category_key ON categories(category_key);
CREATE INDEX idx_categories_parent ON categories(parent_id,active,sort);

INSERT OR IGNORE INTO categories(
  slug,name,name_ja,icon,blurb,sort,category_key,parent_id,node_kind,active,
  legacy_slug,created_at,updated_at
) VALUES
('pi-products','Products','','layers','Product Intelligence root',9000,'PRODUCTS',NULL,'GROUP',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('pi-vehicles-mobility','Vehicles & Mobility','','car','Whole vehicles, mobility and parts',9010,'VEHICLES_MOBILITY',NULL,'GROUP',1,'vehicles','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('pi-technology','Technology','','smartphone','Technology product framework',9020,'TECHNOLOGY',NULL,'GROUP',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('pi-home-lifestyle','Home & Lifestyle','','house','Home and lifestyle product framework',9030,'HOME_LIFESTYLE',NULL,'GROUP',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('pi-industrial-agriculture','Industrial & Agriculture','','tractor','Industrial and agricultural product framework',9040,'INDUSTRIAL_AGRICULTURE',NULL,'GROUP',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('pi-collectibles-media','Collectibles & Media','','book-open','Collectibles and media product framework',9050,'COLLECTIBLES_MEDIA',NULL,'GROUP',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('pi-general-other','General','','tag','Unclassified extensibility framework',9060,'GENERAL_OTHER',NULL,'GROUP',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

UPDATE categories SET parent_id=(SELECT id FROM categories WHERE category_key='PRODUCTS')
 WHERE category_key IN ('VEHICLES_MOBILITY','TECHNOLOGY','HOME_LIFESTYLE','INDUSTRIAL_AGRICULTURE','COLLECTIBLES_MEDIA','GENERAL_OTHER');

INSERT OR IGNORE INTO categories(
  slug,name,name_ja,icon,blurb,sort,category_key,parent_id,node_kind,active,
  legacy_slug,created_at,updated_at
) VALUES
('vehicle-passenger-car','Passenger car','','car','Passenger cars',1,'VEHICLE_PASSENGER_CAR',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-suv-crossover','SUV / crossover','','car','SUVs and crossovers',2,'VEHICLE_SUV_CROSSOVER',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-pickup','Pickup','','truck','Single and double cab pickups',3,'VEHICLE_PICKUP',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-van-minibus','Van / minibus','','bus','Vans and minibuses',4,'VEHICLE_VAN_MINIBUS',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-truck','Truck','','truck','Commercial trucks',5,'VEHICLE_TRUCK',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-bus','Bus','','bus','Passenger buses',6,'VEHICLE_BUS',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-motorcycle','Motorcycle','','bike','Motorcycles and scooters',7,'VEHICLE_MOTORCYCLE',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-agricultural','Agricultural vehicle','','tractor','Agricultural vehicles and machinery',8,'VEHICLE_AGRICULTURAL',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-special-purpose','Special-purpose vehicle','','construction','Special-purpose vehicles',9,'VEHICLE_SPECIAL_PURPOSE',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-whole-unclassified','Whole vehicle — unclassified','','car','Whole vehicle awaiting precise classification',10,'VEHICLE_WHOLE_UNCLASSIFIED',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
('vehicle-parts-general','Vehicle parts & accessories','','wrench','Vehicle parts and accessories',11,'VEHICLE_PARTS_GENERAL',(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'),'LEAF',1,NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');

-- Place legacy leaves beneath a broad framework without guessing a new product subtype.
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE category_key='TECHNOLOGY')
 WHERE category_key LIKE 'LEGACY_%' AND legacy_slug IN ('phones','electronics','computers','solar-power');
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE category_key='HOME_LIFESTYLE')
 WHERE category_key LIKE 'LEGACY_%' AND legacy_slug IN ('home','fashion','sports');
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE category_key='INDUSTRIAL_AGRICULTURE')
 WHERE category_key LIKE 'LEGACY_%' AND legacy_slug IN ('farm-industrial');
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE category_key='COLLECTIBLES_MEDIA')
 WHERE category_key LIKE 'LEGACY_%' AND legacy_slug IN ('collectibles','books-media');
UPDATE categories SET parent_id=(SELECT id FROM categories WHERE category_key='GENERAL_OTHER')
 WHERE category_key LIKE 'LEGACY_%' AND parent_id IS NULL;

CREATE TABLE pi_category_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  locale TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(category_id,locale)
) STRICT;

INSERT OR IGNORE INTO pi_category_labels(category_id,locale,label,description,created_at)
SELECT id,'en',name,blurb,'2026-01-01T00:00:00Z' FROM categories;
INSERT OR IGNORE INTO pi_category_labels(category_id,locale,label,description,created_at)
SELECT id,'ja',name_ja,'','2026-01-01T00:00:00Z' FROM categories WHERE length(trim(name_ja))>0;

CREATE TABLE pi_category_schema_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  version INTEGER NOT NULL CHECK(version>0),
  schema_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE','RETIRED')),
  schema_hash TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_by BLOB,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  UNIQUE(category_id,version)
) STRICT;
CREATE UNIQUE INDEX uq_pi_active_category_schema
  ON pi_category_schema_versions(category_id) WHERE status='ACTIVE';

INSERT INTO pi_category_schema_versions(
  category_id,version,schema_key,status,schema_hash,change_note,created_at,activated_at
)
SELECT id,1,category_key||'_V1','ACTIVE','PI01D:'||category_key||':V1',
       'PI-01D initial governed schema','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
  FROM categories WHERE node_kind='LEAF';

ALTER TABLE auctions ADD COLUMN product_category_id INTEGER REFERENCES categories(id);
ALTER TABLE auctions ADD COLUMN product_schema_version_id INTEGER REFERENCES pi_category_schema_versions(id);
CREATE INDEX idx_auctions_product_category ON auctions(product_category_id,status);

UPDATE auctions
   SET product_category_id=CASE
     WHEN asset_kind='vehicle' THEN (SELECT id FROM categories WHERE category_key='VEHICLE_WHOLE_UNCLASSIFIED')
     WHEN asset_kind='part' THEN (SELECT id FROM categories WHERE category_key='VEHICLE_PARTS_GENERAL')
     ELSE (SELECT id FROM categories c WHERE c.legacy_slug=auctions.category AND c.node_kind='LEAF' LIMIT 1)
   END;
UPDATE auctions
   SET product_schema_version_id=(
     SELECT s.id FROM pi_category_schema_versions s
      WHERE s.category_id=auctions.product_category_id AND s.status='ACTIVE'
   )
 WHERE product_category_id IS NOT NULL;

CREATE TRIGGER trg_pi_category_parent_kind_insert
BEFORE INSERT ON categories
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM categories p WHERE p.id=NEW.parent_id AND p.node_kind='GROUP'
)
BEGIN SELECT RAISE(ABORT,'PI_CATEGORY_PARENT_MUST_BE_GROUP'); END;

CREATE TRIGGER trg_pi_category_parent_kind_update
BEFORE UPDATE OF parent_id,node_kind ON categories
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM categories p WHERE p.id=NEW.parent_id AND p.node_kind='GROUP'
)
BEGIN SELECT RAISE(ABORT,'PI_CATEGORY_PARENT_MUST_BE_GROUP'); END;

CREATE TRIGGER trg_pi_category_group_has_no_product_binding
BEFORE UPDATE OF node_kind ON categories
WHEN NEW.node_kind='LEAF' AND EXISTS(SELECT 1 FROM categories c WHERE c.parent_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'PI_CATEGORY_WITH_CHILDREN_MUST_BE_GROUP'); END;

CREATE TRIGGER trg_pi_schema_version_immutable_update
BEFORE UPDATE ON pi_category_schema_versions
BEGIN SELECT RAISE(ABORT,'PI_SCHEMA_VERSION_IMMUTABLE'); END;
CREATE TRIGGER trg_pi_schema_version_immutable_delete
BEFORE DELETE ON pi_category_schema_versions
BEGIN SELECT RAISE(ABORT,'PI_SCHEMA_VERSION_IMMUTABLE'); END;

CREATE TRIGGER trg_pi_auction_category_insert
BEFORE INSERT ON auctions
WHEN NEW.product_category_id IS NOT NULL AND (
  NOT EXISTS(SELECT 1 FROM categories c WHERE c.id=NEW.product_category_id AND c.node_kind='LEAF' AND c.active=1)
  OR NOT EXISTS(SELECT 1 FROM pi_category_schema_versions s WHERE s.id=NEW.product_schema_version_id AND s.category_id=NEW.product_category_id)
)
BEGIN SELECT RAISE(ABORT,'PI_PRODUCT_SCHEMA_BINDING_INVALID'); END;

CREATE TRIGGER trg_pi_auction_category_update
BEFORE UPDATE OF product_category_id,product_schema_version_id ON auctions
WHEN NEW.product_category_id IS NOT NULL AND (
  NOT EXISTS(SELECT 1 FROM categories c WHERE c.id=NEW.product_category_id AND c.node_kind='LEAF' AND c.active=1)
  OR NOT EXISTS(SELECT 1 FROM pi_category_schema_versions s WHERE s.id=NEW.product_schema_version_id AND s.category_id=NEW.product_category_id)
)
BEGIN SELECT RAISE(ABORT,'PI_PRODUCT_SCHEMA_BINDING_INVALID'); END;
