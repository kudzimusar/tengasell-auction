-- TENGASELL-PI-01D / VEH-02 — nullable canonical vehicle specification extension.
-- No historical row is guessed or backfilled.

ALTER TABLE vehicles ADD COLUMN vehicle_class TEXT CHECK(vehicle_class IS NULL OR vehicle_class IN (
  'PASSENGER_CAR','SUV_CROSSOVER','PICKUP','VAN_MINIBUS','TRUCK','BUS','MOTORCYCLE','AGRICULTURAL','SPECIAL_PURPOSE','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN body_type TEXT CHECK(body_type IS NULL OR body_type IN (
  'SEDAN','HATCHBACK','WAGON','COUPE','CONVERTIBLE','SUV','CROSSOVER','PICKUP_SINGLE_CAB','PICKUP_DOUBLE_CAB','VAN','MINIBUS','TRUCK','BUS','MOTORCYCLE','TRACTOR','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN model_code TEXT;
ALTER TABLE vehicles ADD COLUMN generation_series TEXT;
ALTER TABLE vehicles ADD COLUMN trim TEXT;
ALTER TABLE vehicles ADD COLUMN manufacture_year INTEGER CHECK(manufacture_year IS NULL OR manufacture_year BETWEEN 1900 AND 2100);
ALTER TABLE vehicles ADD COLUMN first_registration_date TEXT;
ALTER TABLE vehicles ADD COLUMN steering_side TEXT CHECK(steering_side IS NULL OR steering_side IN ('RIGHT','LEFT','CENTRE','OTHER','UNKNOWN'));
ALTER TABLE vehicles ADD COLUMN doors INTEGER CHECK(doors IS NULL OR doors BETWEEN 0 AND 20);
ALTER TABLE vehicles ADD COLUMN seats INTEGER CHECK(seats IS NULL OR seats BETWEEN 1 AND 200);
ALTER TABLE vehicles ADD COLUMN cab_type TEXT CHECK(cab_type IS NULL OR cab_type IN ('SINGLE','EXTENDED','DOUBLE','CREW','DAY','SLEEPER','OTHER','UNKNOWN'));
ALTER TABLE vehicles ADD COLUMN primary_exterior_colour TEXT CHECK(primary_exterior_colour IS NULL OR primary_exterior_colour IN (
  'BLACK','WHITE','SILVER','GREY','RED','BLUE','GREEN','BROWN','BEIGE','GOLD','ORANGE','YELLOW','PURPLE','MULTICOLOUR','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN manufacturer_colour_name TEXT;
ALTER TABLE vehicles ADD COLUMN manufacturer_colour_code TEXT;
ALTER TABLE vehicles ADD COLUMN interior_colour TEXT CHECK(interior_colour IS NULL OR interior_colour IN (
  'BLACK','WHITE','GREY','BEIGE','BROWN','RED','BLUE','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN interior_material TEXT CHECK(interior_material IS NULL OR interior_material IN (
  'CLOTH','LEATHER','SYNTHETIC_LEATHER','VINYL','ALCANTARA','MIXED','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN engine_code TEXT;
ALTER TABLE vehicles ADD COLUMN power_kw REAL CHECK(power_kw IS NULL OR power_kw>=0);
ALTER TABLE vehicles ADD COLUMN torque_nm REAL CHECK(torque_nm IS NULL OR torque_nm>=0);
ALTER TABLE vehicles ADD COLUMN gear_count INTEGER CHECK(gear_count IS NULL OR gear_count BETWEEN 1 AND 30);
ALTER TABLE vehicles ADD COLUMN hybrid_type TEXT CHECK(hybrid_type IS NULL OR hybrid_type IN ('MILD','FULL','PLUG_IN','RANGE_EXTENDER','OTHER','UNKNOWN'));
ALTER TABLE vehicles ADD COLUMN ev_battery_capacity_kwh REAL CHECK(ev_battery_capacity_kwh IS NULL OR ev_battery_capacity_kwh>=0);
ALTER TABLE vehicles ADD COLUMN ev_range_km INTEGER CHECK(ev_range_km IS NULL OR ev_range_km>=0);
ALTER TABLE vehicles ADD COLUMN owner_count INTEGER CHECK(owner_count IS NULL OR owner_count>=0);
ALTER TABLE vehicles ADD COLUMN origin_country TEXT;
ALTER TABLE vehicles ADD COLUMN first_registration_country TEXT;
ALTER TABLE vehicles ADD COLUMN import_source_country TEXT;
ALTER TABLE vehicles ADD COLUMN service_history_class TEXT CHECK(service_history_class IS NULL OR service_history_class IN (
  'FULL_MANUFACTURER','FULL_INDEPENDENT','PARTIAL','NONE_DECLARED','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN accident_history TEXT CHECK(accident_history IS NULL OR accident_history IN (
  'NONE_DECLARED','ACCIDENT_DECLARED','DAMAGE_DECLARED','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN repair_history TEXT CHECK(repair_history IS NULL OR repair_history IN (
  'NONE_DECLARED','REPAIRED','PAINTWORK','MULTIPLE_REPAIRS','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN structural_repair_history TEXT CHECK(structural_repair_history IS NULL OR structural_repair_history IN (
  'NONE_DECLARED','STRUCTURAL_REPAIR_DECLARED','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN modification_status TEXT CHECK(modification_status IS NULL OR modification_status IN (
  'STANDARD','MODIFIED','RESTORED','CONVERTED','OTHER','UNKNOWN'
));
ALTER TABLE vehicles ADD COLUMN number_of_keys INTEGER CHECK(number_of_keys IS NULL OR number_of_keys BETWEEN 0 AND 20);
ALTER TABLE vehicles ADD COLUMN spare_key INTEGER CHECK(spare_key IS NULL OR spare_key IN (0,1));
ALTER TABLE vehicles ADD COLUMN spare_wheel INTEGER CHECK(spare_wheel IS NULL OR spare_wheel IN (0,1));
ALTER TABLE vehicles ADD COLUMN tool_kit INTEGER CHECK(tool_kit IS NULL OR tool_kit IN (0,1));
ALTER TABLE vehicles ADD COLUMN manuals INTEGER CHECK(manuals IS NULL OR manuals IN (0,1));
ALTER TABLE vehicles ADD COLUMN service_book INTEGER CHECK(service_book IS NULL OR service_book IN (0,1));

CREATE TABLE pi_vehicle_vocabulary_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
) STRICT;
CREATE TABLE pi_vehicle_vocabulary_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id INTEGER NOT NULL REFERENCES pi_vehicle_vocabulary_domains(id),
  value_key TEXT NOT NULL,
  label TEXT NOT NULL,
  legacy_value TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(domain_id,value_key)
) STRICT;

INSERT INTO pi_vehicle_vocabulary_domains(domain_key,description) VALUES
('VEHICLE_CLASS','Canonical whole-vehicle class'),
('BODY_TYPE','Canonical vehicle body type'),
('FUEL_TYPE','Fuel and propulsion'),
('TRANSMISSION','Transmission'),
('DRIVETRAIN','Driven wheels'),
('STEERING_SIDE','Steering position'),
('CANONICAL_COLOUR','Canonical buyer-facing colour'),
('SERVICE_HISTORY_CLASS','Service-history coverage'),
('ACCIDENT_HISTORY','Seller/verified accident state'),
('REPAIR_HISTORY','Repair state'),
('MODIFICATION_STATUS','Modification state');

INSERT INTO pi_vehicle_vocabulary_values(domain_id,value_key,label,legacy_value,sort_order)
SELECT d.id,v.key,v.label,v.legacy,v.sort_order FROM pi_vehicle_vocabulary_domains d JOIN (
  SELECT 'FUEL_TYPE' domain,'PETROL' key,'Petrol' label,'PETROL' legacy,1 sort_order UNION ALL
  SELECT 'FUEL_TYPE','DIESEL','Diesel','DIESEL',2 UNION ALL
  SELECT 'FUEL_TYPE','HYBRID','Hybrid','HYBRID',3 UNION ALL
  SELECT 'FUEL_TYPE','ELECTRIC','Electric','ELECTRIC',4 UNION ALL
  SELECT 'FUEL_TYPE','LPG','LPG','LPG',5 UNION ALL
  SELECT 'FUEL_TYPE','OTHER','Other','OTHER',98 UNION ALL
  SELECT 'FUEL_TYPE','UNKNOWN','Unknown',NULL,99 UNION ALL
  SELECT 'TRANSMISSION','MANUAL','Manual','MANUAL',1 UNION ALL
  SELECT 'TRANSMISSION','AUTOMATIC','Automatic','AUTOMATIC',2 UNION ALL
  SELECT 'TRANSMISSION','CVT','CVT','CVT',3 UNION ALL
  SELECT 'TRANSMISSION','DCT','Dual-clutch','DCT',4 UNION ALL
  SELECT 'TRANSMISSION','OTHER','Other','OTHER',98 UNION ALL
  SELECT 'TRANSMISSION','UNKNOWN','Unknown',NULL,99 UNION ALL
  SELECT 'DRIVETRAIN','FWD','Front-wheel drive','FWD',1 UNION ALL
  SELECT 'DRIVETRAIN','RWD','Rear-wheel drive','RWD',2 UNION ALL
  SELECT 'DRIVETRAIN','AWD','All-wheel drive','AWD',3 UNION ALL
  SELECT 'DRIVETRAIN','4WD','Four-wheel drive','4WD',4 UNION ALL
  SELECT 'DRIVETRAIN','OTHER','Other','OTHER',98 UNION ALL
  SELECT 'DRIVETRAIN','UNKNOWN','Unknown',NULL,99 UNION ALL
  SELECT 'STEERING_SIDE','RIGHT','Right-hand drive',NULL,1 UNION ALL
  SELECT 'STEERING_SIDE','LEFT','Left-hand drive',NULL,2 UNION ALL
  SELECT 'STEERING_SIDE','CENTRE','Centre',NULL,3 UNION ALL
  SELECT 'STEERING_SIDE','OTHER','Other',NULL,98 UNION ALL
  SELECT 'STEERING_SIDE','UNKNOWN','Unknown',NULL,99 UNION ALL
  SELECT 'SERVICE_HISTORY_CLASS','FULL_MANUFACTURER','Full manufacturer history',NULL,1 UNION ALL
  SELECT 'SERVICE_HISTORY_CLASS','FULL_INDEPENDENT','Full independent history',NULL,2 UNION ALL
  SELECT 'SERVICE_HISTORY_CLASS','PARTIAL','Partial history',NULL,3 UNION ALL
  SELECT 'SERVICE_HISTORY_CLASS','NONE_DECLARED','None declared',NULL,4 UNION ALL
  SELECT 'SERVICE_HISTORY_CLASS','OTHER','Other',NULL,98 UNION ALL
  SELECT 'SERVICE_HISTORY_CLASS','UNKNOWN','Unknown',NULL,99 UNION ALL
  SELECT 'ACCIDENT_HISTORY','NONE_DECLARED','No accident declared',NULL,1 UNION ALL
  SELECT 'ACCIDENT_HISTORY','ACCIDENT_DECLARED','Accident declared',NULL,2 UNION ALL
  SELECT 'ACCIDENT_HISTORY','DAMAGE_DECLARED','Damage declared',NULL,3 UNION ALL
  SELECT 'ACCIDENT_HISTORY','OTHER','Other',NULL,98 UNION ALL
  SELECT 'ACCIDENT_HISTORY','UNKNOWN','Unknown',NULL,99 UNION ALL
  SELECT 'REPAIR_HISTORY','NONE_DECLARED','No repair declared',NULL,1 UNION ALL
  SELECT 'REPAIR_HISTORY','REPAIRED','Repair declared',NULL,2 UNION ALL
  SELECT 'REPAIR_HISTORY','PAINTWORK','Paintwork declared',NULL,3 UNION ALL
  SELECT 'REPAIR_HISTORY','MULTIPLE_REPAIRS','Multiple repairs',NULL,4 UNION ALL
  SELECT 'REPAIR_HISTORY','OTHER','Other',NULL,98 UNION ALL
  SELECT 'REPAIR_HISTORY','UNKNOWN','Unknown',NULL,99 UNION ALL
  SELECT 'MODIFICATION_STATUS','STANDARD','Standard',NULL,1 UNION ALL
  SELECT 'MODIFICATION_STATUS','MODIFIED','Modified',NULL,2 UNION ALL
  SELECT 'MODIFICATION_STATUS','RESTORED','Restored',NULL,3 UNION ALL
  SELECT 'MODIFICATION_STATUS','CONVERTED','Converted',NULL,4 UNION ALL
  SELECT 'MODIFICATION_STATUS','OTHER','Other',NULL,98 UNION ALL
  SELECT 'MODIFICATION_STATUS','UNKNOWN','Unknown',NULL,99
) v ON v.domain=d.domain_key;

-- The vehicle vocabulary is also the option authority consumed by the active
-- category schema. The extra mapping keeps canonical colour reusable by both
-- exterior and interior attributes without duplicating machine values.
INSERT OR IGNORE INTO pi_attribute_options(attribute_id,option_key,active,sort_order)
SELECT a.id,v.value_key,v.active,v.sort_order
  FROM pi_attribute_definitions a
  JOIN pi_vehicle_vocabulary_domains d ON d.domain_key=CASE a.attribute_key
    WHEN 'EXTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    WHEN 'INTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    ELSE a.attribute_key END
  JOIN pi_vehicle_vocabulary_values v ON v.domain_id=d.id
 WHERE a.data_type='ENUM';

INSERT OR IGNORE INTO pi_attribute_option_labels(option_id,locale,label)
SELECT o.id,'en',v.label
  FROM pi_attribute_options o
  JOIN pi_attribute_definitions a ON a.id=o.attribute_id
  JOIN pi_vehicle_vocabulary_domains d ON d.domain_key=CASE a.attribute_key
    WHEN 'EXTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    WHEN 'INTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    ELSE a.attribute_key END
  JOIN pi_vehicle_vocabulary_values v ON v.domain_id=d.id AND v.value_key=o.option_key;

INSERT OR IGNORE INTO pi_attribute_option_aliases(option_id,locale,alias,normalized_alias)
SELECT o.id,'und',v.legacy_value,lower(v.legacy_value)
  FROM pi_attribute_options o
  JOIN pi_attribute_definitions a ON a.id=o.attribute_id
  JOIN pi_vehicle_vocabulary_domains d ON d.domain_key=a.attribute_key
  JOIN pi_vehicle_vocabulary_values v ON v.domain_id=d.id AND v.value_key=o.option_key
 WHERE v.legacy_value IS NOT NULL;

INSERT INTO pi_vehicle_vocabulary_values(domain_id,value_key,label,sort_order)
SELECT d.id,v.key,v.label,v.sort_order FROM pi_vehicle_vocabulary_domains d JOIN (
  SELECT 'VEHICLE_CLASS' domain,'PASSENGER_CAR' key,'Passenger car' label,1 sort_order UNION ALL
  SELECT 'VEHICLE_CLASS','SUV_CROSSOVER','SUV / crossover',2 UNION ALL
  SELECT 'VEHICLE_CLASS','PICKUP','Pickup',3 UNION ALL
  SELECT 'VEHICLE_CLASS','VAN_MINIBUS','Van / minibus',4 UNION ALL
  SELECT 'VEHICLE_CLASS','TRUCK','Truck',5 UNION ALL
  SELECT 'VEHICLE_CLASS','BUS','Bus',6 UNION ALL
  SELECT 'VEHICLE_CLASS','MOTORCYCLE','Motorcycle',7 UNION ALL
  SELECT 'VEHICLE_CLASS','AGRICULTURAL','Agricultural',8 UNION ALL
  SELECT 'VEHICLE_CLASS','SPECIAL_PURPOSE','Special purpose',9 UNION ALL
  SELECT 'VEHICLE_CLASS','OTHER','Other',98 UNION ALL
  SELECT 'VEHICLE_CLASS','UNKNOWN','Unknown',99 UNION ALL
  SELECT 'BODY_TYPE','SEDAN','Sedan',1 UNION ALL
  SELECT 'BODY_TYPE','HATCHBACK','Hatchback',2 UNION ALL
  SELECT 'BODY_TYPE','WAGON','Wagon',3 UNION ALL
  SELECT 'BODY_TYPE','COUPE','Coupe',4 UNION ALL
  SELECT 'BODY_TYPE','CONVERTIBLE','Convertible',5 UNION ALL
  SELECT 'BODY_TYPE','SUV','SUV',6 UNION ALL
  SELECT 'BODY_TYPE','CROSSOVER','Crossover',7 UNION ALL
  SELECT 'BODY_TYPE','PICKUP_SINGLE_CAB','Single-cab pickup',8 UNION ALL
  SELECT 'BODY_TYPE','PICKUP_DOUBLE_CAB','Double-cab pickup',9 UNION ALL
  SELECT 'BODY_TYPE','VAN','Van',10 UNION ALL
  SELECT 'BODY_TYPE','MINIBUS','Minibus',11 UNION ALL
  SELECT 'BODY_TYPE','TRUCK','Truck',12 UNION ALL
  SELECT 'BODY_TYPE','BUS','Bus',13 UNION ALL
  SELECT 'BODY_TYPE','MOTORCYCLE','Motorcycle',14 UNION ALL
  SELECT 'BODY_TYPE','TRACTOR','Tractor',15 UNION ALL
  SELECT 'BODY_TYPE','OTHER','Other',98 UNION ALL
  SELECT 'BODY_TYPE','UNKNOWN','Unknown',99 UNION ALL
  SELECT 'CANONICAL_COLOUR','BLACK','Black',1 UNION ALL
  SELECT 'CANONICAL_COLOUR','WHITE','White',2 UNION ALL
  SELECT 'CANONICAL_COLOUR','SILVER','Silver',3 UNION ALL
  SELECT 'CANONICAL_COLOUR','GREY','Grey',4 UNION ALL
  SELECT 'CANONICAL_COLOUR','RED','Red',5 UNION ALL
  SELECT 'CANONICAL_COLOUR','BLUE','Blue',6 UNION ALL
  SELECT 'CANONICAL_COLOUR','GREEN','Green',7 UNION ALL
  SELECT 'CANONICAL_COLOUR','BROWN','Brown',8 UNION ALL
  SELECT 'CANONICAL_COLOUR','BEIGE','Beige',9 UNION ALL
  SELECT 'CANONICAL_COLOUR','GOLD','Gold',10 UNION ALL
  SELECT 'CANONICAL_COLOUR','ORANGE','Orange',11 UNION ALL
  SELECT 'CANONICAL_COLOUR','YELLOW','Yellow',12 UNION ALL
  SELECT 'CANONICAL_COLOUR','PURPLE','Purple',13 UNION ALL
  SELECT 'CANONICAL_COLOUR','MULTICOLOUR','Multicolour',14 UNION ALL
  SELECT 'CANONICAL_COLOUR','OTHER','Other',98 UNION ALL
  SELECT 'CANONICAL_COLOUR','UNKNOWN','Unknown',99
) v ON v.domain=d.domain_key;

-- Final option convergence after all vocabulary domains are populated.
INSERT OR IGNORE INTO pi_attribute_options(attribute_id,option_key,active,sort_order)
SELECT a.id,v.value_key,v.active,v.sort_order
  FROM pi_attribute_definitions a
  JOIN pi_vehicle_vocabulary_domains d ON d.domain_key=CASE a.attribute_key
    WHEN 'EXTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    WHEN 'INTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    ELSE a.attribute_key END
  JOIN pi_vehicle_vocabulary_values v ON v.domain_id=d.id
 WHERE a.data_type='ENUM';
INSERT OR IGNORE INTO pi_attribute_option_labels(option_id,locale,label)
SELECT o.id,'en',v.label
  FROM pi_attribute_options o
  JOIN pi_attribute_definitions a ON a.id=o.attribute_id
  JOIN pi_vehicle_vocabulary_domains d ON d.domain_key=CASE a.attribute_key
    WHEN 'EXTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    WHEN 'INTERIOR_COLOUR' THEN 'CANONICAL_COLOUR'
    ELSE a.attribute_key END
  JOIN pi_vehicle_vocabulary_values v ON v.domain_id=d.id AND v.value_key=o.option_key;
