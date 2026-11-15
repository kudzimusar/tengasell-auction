-- TENGASELL-PI-01D / VEH-03 — structured history, modifications and equipment.

CREATE TABLE vehicle_history_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  event_type TEXT NOT NULL CHECK(event_type IN (
    'SERVICE','MAINTENANCE','ACCIDENT','DAMAGE','REPAIR','STRUCTURAL_REPAIR','PAINTWORK',
    'OWNERSHIP_CHANGE','REGISTRATION','IMPORT','CUSTOMS_CLEARANCE','MILEAGE_RECORD','OTHER'
  )),
  occurred_on TEXT,
  odometer_km INTEGER CHECK(odometer_km IS NULL OR odometer_km>=0),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider_name TEXT,
  country_code TEXT,
  source_class TEXT NOT NULL CHECK(source_class IN (
    'SELLER_DECLARED','DOCUMENT_DERIVED','SYSTEM_DERIVED','INSPECTOR_VERIFIED','EXTERNAL_VERIFIED'
  )),
  source_fact_assertion_id INTEGER REFERENCES pi_fact_assertions(id),
  created_by BLOB,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_vehicle_history_vehicle ON vehicle_history_events(vehicle_id,occurred_on,event_type);

CREATE TABLE vehicle_modifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  modification_category TEXT NOT NULL CHECK(modification_category IN (
    'ENGINE','DRIVETRAIN','SUSPENSION','BRAKES','WHEELS_TYRES','BODY','INTERIOR','ELECTRICAL',
    'SAFETY','ACCESSIBILITY','COMMERCIAL_CONVERSION','OTHER'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  installed_on TEXT,
  installer TEXT,
  approval_reference TEXT,
  reversible INTEGER CHECK(reversible IS NULL OR reversible IN (0,1)),
  status TEXT NOT NULL DEFAULT 'DECLARED' CHECK(status IN ('DECLARED','VERIFIED','REJECTED','REMOVED')),
  source_fact_assertion_id INTEGER REFERENCES pi_fact_assertions(id),
  created_by BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_vehicle_modifications_vehicle ON vehicle_modifications(vehicle_id,status,modification_category);

CREATE TABLE vehicle_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  equipment_type TEXT NOT NULL CHECK(equipment_type IN (
    'FACTORY_OPTION','AFTERMARKET_EQUIPMENT','INCLUDED_ACCESSORY','DOCUMENT','TOOL','OTHER_EQUIPMENT'
  )),
  equipment_key TEXT,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity>0),
  included INTEGER NOT NULL DEFAULT 1 CHECK(included IN (0,1)),
  condition_state TEXT CHECK(condition_state IS NULL OR condition_state IN ('NEW','GOOD','FAIR','POOR','UNKNOWN')),
  source_fact_assertion_id INTEGER REFERENCES pi_fact_assertions(id),
  created_by BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(vehicle_id,equipment_type,equipment_key)
) STRICT;
CREATE INDEX idx_vehicle_equipment_vehicle ON vehicle_equipment(vehicle_id,equipment_type,included);
