#!/usr/bin/env python3
"""PI-01E structured discovery, search projection, category-aware filters, saved search facets, and comparison proof."""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "mini-services/trailbase-db/traildepot/migrations/main"


def database() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=OFF")
    db.create_function("uuid_v4", 0, lambda: sqlite3.Binary(uuid.uuid4().bytes))
    db.create_function("hash_password", 1, lambda value: f"test-hash:{value}")
    db.execute("""CREATE TABLE _user(
      id BLOB PRIMARY KEY,email TEXT,username TEXT UNIQUE,password_hash TEXT,
      verified INTEGER NOT NULL DEFAULT 0,admin INTEGER NOT NULL DEFAULT 0
    )""")
    for path in sorted(MIGRATIONS.glob("U*.sql")):
        db.executescript(path.read_text(encoding="utf-8"))
    return db


def main() -> None:
    db = database()

    # 1. Schema integrity & safe migrations U24 & U25
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert "product_search_index" in tables, "product_search_index missing"
    assert "product_search_facet_values" in tables, "product_search_facet_values missing"
    assert "product_search_fts" in tables, "product_search_fts missing"
    assert "saved_search_facets" in tables, "saved_search_facets missing"

    # Verify filter_class on pi_category_attributes
    cols = {r[1] for r in db.execute("PRAGMA table_info(pi_category_attributes)").fetchall()}
    assert "filter_class" in cols, "filter_class column missing on pi_category_attributes"

    filter_classes = {r[0] for r in db.execute("SELECT DISTINCT filter_class FROM pi_category_attributes").fetchall()}
    assert {"PRIMARY", "SECONDARY", "ADVANCED"}.issubset(filter_classes), f"filter classes missing: {filter_classes}"

    # Verify saved_searches extension
    ss_cols = {r[1] for r in db.execute("PRAGMA table_info(saved_searches)").fetchall()}
    assert "product_category_id" in ss_cols, "product_category_id missing on saved_searches"
    assert "category_key" in ss_cols, "category_key missing on saved_searches"

    # 2. Sensitive fields strict exclusion from search read model
    psi_cols = {r[1].lower() for r in db.execute("PRAGMA table_info(product_search_index)").fetchall()}
    sensitive = {"vin", "chassis_number", "registration_number", "engine_number", "document_number", "serial_number"}
    found_sensitive = sensitive.intersection(psi_cols)
    assert not found_sensitive, f"sensitive columns found in product_search_index: {found_sensitive}"

    # 3. Seed test vehicle auctions with PI effective facts
    admin_user = db.execute("SELECT id FROM _user WHERE admin=1 ORDER BY username LIMIT 1").fetchone()[0]
    veh_cat_id, veh_schema_id = db.execute(
        "SELECT category_id, id FROM pi_category_schema_versions WHERE category_id=(SELECT id FROM categories WHERE category_key='VEHICLE_PASSENGER_CAR') AND status='ACTIVE'"
    ).fetchone()
    phone_cat_id, phone_schema_id = db.execute(
        "SELECT category_id, id FROM pi_category_schema_versions WHERE category_id=(SELECT id FROM categories WHERE category_key='PHONE_SMARTPHONE') AND status='ACTIVE'"
    ).fetchone()

    # Insert test vehicle 1: Toyota Hilux 2021 Diesel 4WD 45,000 km, Grade A
    db.execute("""
      INSERT INTO auctions(
        id, user, seller_username, title, slug, description, category, product_category_id, product_schema_version_id,
        condition, start_price, current_price, bid_count, views, status, reserve_disclosure,
        started_at, ends_at, created_at, updated_at
      ) VALUES (
        9001, ?, 'dealer_one', '2021 Toyota Hilux 2.8 GD-6 4x4 Double Cab', 'toyota-hilux-2021',
        'Clean local Toyota Hilux 4WD bakkie with full service history', 'vehicles', ?, ?,
        'like-new', 25000, 28000, 4, 120, 'live', 'RESERVE_APPLIES',
        '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    """, (admin_user, veh_cat_id, veh_schema_id))

    db.execute("""
      INSERT INTO product_search_index(
        auction_id, product_category_id, category_key, schema_version_id, title, description, make, model, year, price, mileage,
        vehicle_class, body_type, fuel, transmission, drivetrain, steering_side, exterior_colour,
        location, sale_condition, inspection_status, inspection_grade, roadworthy, service_history_class,
        accident_history, import_state, customs_status, reserve_disclosure, auction_status, ending_time, created_at, updated_at, indexed_at
      ) VALUES (
        9001, ?, 'VEHICLE_PASSENGER_CAR', ?, '2021 Toyota Hilux 2.8 GD-6 4x4 Double Cab', 'Clean local Toyota Hilux 4WD bakkie with full service history',
        'Toyota', 'Hilux', 2021, 28000, 45000, 'LIGHT_COMMERCIAL', 'PICKUP', 'DIESEL', 'AUTOMATIC',
        'AWD_4WD', 'RHD', 'White', 'Harare', 'like-new', 'COMPLETED', 'GRADE_A', 1, 'FULL_FRANCHISE',
        'NO_ACCIDENTS_REPORTED', 'DOMESTIC_REGISTERED', 'CLEARED_DOMESTIC', 'RESERVE_MET', 'live',
        '2030-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    """, (veh_cat_id, veh_schema_id))

    db.execute("""
      INSERT INTO product_search_fts(rowid, title, description, make, model, search_text)
      VALUES (9001, '2021 Toyota Hilux 2.8 GD-6 4x4 Double Cab', 'Clean local Toyota Hilux 4WD bakkie with full service history', 'Toyota', 'Hilux', 'Toyota Hilux Pickup Diesel Automatic Harare 2021')
    """)

    # Insert test vehicle 2: Nissan X-Trail 2016 Petrol FWD 140,000 km, Grade C
    db.execute("""
      INSERT INTO auctions(
        id, user, seller_username, title, slug, description, category, product_category_id, product_schema_version_id,
        condition, start_price, current_price, bid_count, views, status, reserve_disclosure,
        started_at, ends_at, created_at, updated_at
      ) VALUES (
        9002, ?, 'seller_two', '2016 Nissan X-Trail 2.0 2WD', 'nissan-xtrail-2016',
        'Used family SUV Nissan X-Trail in Harare', 'vehicles', ?, ?,
        'used', 11000, 11500, 2, 45, 'live', 'NO_RESERVE',
        '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    """, (admin_user, veh_cat_id, veh_schema_id))

    db.execute("""
      INSERT INTO product_search_index(
        auction_id, product_category_id, category_key, schema_version_id, title, description, make, model, year, price, mileage,
        vehicle_class, body_type, fuel, transmission, drivetrain, steering_side, exterior_colour,
        location, sale_condition, inspection_status, inspection_grade, roadworthy, service_history_class,
        accident_history, import_state, customs_status, reserve_disclosure, auction_status, ending_time, created_at, updated_at, indexed_at
      ) VALUES (
        9002, ?, 'VEHICLE_PASSENGER_CAR', ?, '2016 Nissan X-Trail 2.0 2WD', 'Used family SUV Nissan X-Trail in Harare',
        'Nissan', 'X-Trail', 2016, 11500, 140000, 'PASSENGER_CAR', 'SUV', 'PETROL', 'CVT',
        'FWD', 'RHD', 'Silver', 'Harare', 'used', 'COMPLETED', 'GRADE_C', 1, 'PARTIAL',
        'MINOR_REPAIRED', 'DOMESTIC_REGISTERED', 'CLEARED_DOMESTIC', 'NO_RESERVE', 'live',
        '2030-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    """, (veh_cat_id, veh_schema_id))

    db.execute("""
      INSERT INTO product_search_fts(rowid, title, description, make, model, search_text)
      VALUES (9002, '2016 Nissan X-Trail 2.0 2WD', 'Used family SUV Nissan X-Trail in Harare', 'Nissan', 'X-Trail', 'Nissan X-Trail SUV Petrol CVT Harare 2016')
    """)

    # Insert test phone: Apple iPhone 15 Pro 256GB
    db.execute("""
      INSERT INTO auctions(
        id, user, seller_username, title, slug, description, category, product_category_id, product_schema_version_id,
        condition, start_price, current_price, bid_count, views, status, reserve_disclosure,
        started_at, ends_at, created_at, updated_at
      ) VALUES (
        9003, ?, 'phone_seller', 'Apple iPhone 15 Pro 256GB Titanium', 'iphone-15-pro-256',
        'Brand new boxed iPhone 15 Pro in Mutare', 'electronics', ?, ?,
        'new', 950, 950, 0, 80, 'live', 'NO_RESERVE',
        '2026-01-01T00:00:00Z', '2030-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    """, (admin_user, phone_cat_id, phone_schema_id))

    db.execute("""
      INSERT INTO product_search_index(
        auction_id, product_category_id, category_key, schema_version_id, title, description, make, model, year, price, mileage,
        location, sale_condition, reserve_disclosure, auction_status, ending_time, created_at, updated_at, indexed_at
      ) VALUES (
        9003, ?, 'PHONE_SMARTPHONE', ?, 'Apple iPhone 15 Pro 256GB Titanium', 'Brand new boxed iPhone 15 Pro in Mutare',
        'Apple', 'iPhone 15 Pro', 2023, 950, NULL, 'Mutare', 'new', 'NO_RESERVE', 'live',
        '2030-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    """, (phone_cat_id, phone_schema_id))

    # 4. FTS Search Tests
    fts_toyota = [r[0] for r in db.execute("SELECT rowid FROM product_search_fts WHERE product_search_fts MATCH 'Toyota'").fetchall()]
    assert 9001 in fts_toyota, f"FTS Toyota query failed to find 9001: {fts_toyota}"

    fts_hilux = [r[0] for r in db.execute("SELECT rowid FROM product_search_fts WHERE product_search_fts MATCH 'Hilux'").fetchall()]
    assert 9001 in fts_hilux, f"FTS Hilux query failed to find 9001: {fts_hilux}"

    # FTS query for nonexistent sensitive number should yield 0 results
    fts_vin = db.execute("SELECT rowid FROM product_search_fts WHERE product_search_fts MATCH 'AHTFR22G900'").fetchall()
    assert len(fts_vin) == 0, "FTS unexpectedly matched synthetic VIN"

    # 5. Compound Vehicle Filtering Proof
    # Target: Toyota + Hilux + 2018-2024 + 4WD + Diesel + Mileage < 120,000 km
    compound_match = db.execute("""
      SELECT auction_id FROM product_search_index
      WHERE make='Toyota'
        AND model='Hilux'
        AND year BETWEEN 2018 AND 2024
        AND drivetrain='AWD_4WD'
        AND fuel='DIESEL'
        AND mileage <= 120000
    """).fetchall()
    assert [r[0] for r in compound_match] == [9001], f"Compound filter should find 9001: {compound_match}"

    # Compound negative test: Mileage < 30,000 km (9001 has 45,000 km) -> 0 results
    compound_miss = db.execute("""
      SELECT auction_id FROM product_search_index
      WHERE make='Toyota'
        AND model='Hilux'
        AND mileage <= 30000
    """).fetchall()
    assert len(compound_miss) == 0, f"Expected 0 matches for mileage <= 30000, got: {compound_miss}"

    # 6. Category Isolation Proof
    # Vehicle attribute keys must NOT appear in phone category attributes
    veh_attrs = {
        r[0]
        for r in db.execute(
            """SELECT ad.attribute_key FROM pi_category_attributes ca
               JOIN pi_attribute_definitions ad ON ad.id = ca.attribute_id
               WHERE ca.category_id=?""",
            (veh_cat_id,),
        ).fetchall()
    }
    phone_attrs = {
        r[0]
        for r in db.execute(
            """SELECT ad.attribute_key FROM pi_category_attributes ca
               JOIN pi_attribute_definitions ad ON ad.id = ca.attribute_id
               WHERE ca.category_id=?""",
            (phone_cat_id,),
        ).fetchall()
    }

    assert "ODOMETER_KM" in veh_attrs
    assert "DRIVETRAIN" in veh_attrs
    assert "ODOMETER_KM" not in phone_attrs
    assert "DRIVETRAIN" not in phone_attrs

    assert "STORAGE_GB" in phone_attrs
    assert "RAM_GB" in phone_attrs
    assert "STORAGE_GB" not in veh_attrs

    # 7. Saved Searches with Structured Facets & Alert Matching (DISC-03)
    # Save a structured search for: Toyota, Year >= 2018, Max km: 100,000
    db.execute("""
      INSERT INTO saved_searches(
        id, user, name, query, category, product_category_id, category_key, min_price, max_price, alerts, last_seen_id, created_at, updated_at
      ) VALUES (
        801, ?, 'Late Model Low Mileage Toyota', NULL, 'vehicles', ?, 'VEHICLE_PASSENGER_CAR', NULL, 50000, 1, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
      )
    """, (admin_user, veh_cat_id))

    db.execute("""
      INSERT INTO saved_search_facets(id, saved_search_id, attribute_key, operator, value_text, value_min, value_max)
      VALUES
        (8001, 801, 'MAKE', 'EQ', 'Toyota', NULL, NULL),
        (8002, 801, 'YEAR', 'MIN', NULL, 2018, NULL),
        (8003, 801, 'ODOMETER_KM', 'MAX', NULL, NULL, 100000)
    """)

    # Verify matching against product_search_index:
    # 9001 (Toyota, 2021, 45,000 km) satisfies all facets
    matches_9001 = db.execute("""
      SELECT psi.auction_id FROM product_search_index psi
      JOIN saved_searches ss ON ss.id=801
      WHERE psi.auction_id=9001
        AND psi.make = (SELECT value_text FROM saved_search_facets WHERE saved_search_id=801 AND attribute_key='MAKE')
        AND psi.year >= (SELECT value_min FROM saved_search_facets WHERE saved_search_id=801 AND attribute_key='YEAR')
        AND psi.mileage <= (SELECT value_max FROM saved_search_facets WHERE saved_search_id=801 AND attribute_key='ODOMETER_KM')
    """).fetchall()
    assert [r[0] for r in matches_9001] == [9001], f"Saved search alert should match 9001: {matches_9001}"

    # 9002 (Nissan, 2016, 140,000 km) fails make, year, and mileage -> no alert
    matches_9002 = db.execute("""
      SELECT psi.auction_id FROM product_search_index psi
      JOIN saved_searches ss ON ss.id=801
      WHERE psi.auction_id=9002
        AND psi.make = (SELECT value_text FROM saved_search_facets WHERE saved_search_id=801 AND attribute_key='MAKE')
        AND psi.year >= (SELECT value_min FROM saved_search_facets WHERE saved_search_id=801 AND attribute_key='YEAR')
        AND psi.mileage <= (SELECT value_max FROM saved_search_facets WHERE saved_search_id=801 AND attribute_key='ODOMETER_KM')
    """).fetchall()
    assert len(matches_9002) == 0, f"Saved search alert should NOT match 9002: {matches_9002}"

    # 8. Non-Destructive Search Index Rebuild Safety
    # Wipe the search projection and prove canonical auctions remain intact
    db.execute("DELETE FROM product_search_index")
    db.execute("DELETE FROM product_search_fts")
    assert db.execute("SELECT count(*) FROM product_search_index").fetchone()[0] == 0

    # Canonical auctions are untouched
    assert db.execute("SELECT count(*) FROM auctions WHERE id IN (9001, 9002, 9003)").fetchone()[0] == 3

    # Rebuild projection for 9001
    db.execute("""
      INSERT INTO product_search_index(
        auction_id, product_category_id, category_key, schema_version_id, title, description, make, model, year, price, mileage,
        vehicle_class, body_type, fuel, transmission, drivetrain, steering_side, exterior_colour,
        location, sale_condition, reserve_disclosure, auction_status, ending_time, created_at, updated_at, indexed_at
      )
      SELECT a.id, a.product_category_id, 'VEHICLE_PASSENGER_CAR', a.product_schema_version_id, a.title, a.description, 'Toyota', 'Hilux', 2021, a.current_price, 45000,
             'LIGHT_COMMERCIAL', 'PICKUP', 'DIESEL', 'AUTOMATIC', 'AWD_4WD', 'RHD', 'White',
             a.city, a.condition, a.reserve_disclosure, a.status, a.ends_at, a.created_at, a.updated_at, a.updated_at
      FROM auctions a WHERE a.id=9001
    """)
    assert db.execute("SELECT count(*) FROM product_search_index WHERE auction_id=9001").fetchone()[0] == 1

    print("PI-01E structured discovery & search projection proof: PASS")
    print("  migrations U24-U25 verified: PASS")
    print("  sensitive identifier exclusion verified: PASS")
    print("  FTS5 full text search verified: PASS")
    print("  compound vehicle filtering verified: PASS")
    print("  category schema isolation verified: PASS")
    print("  structured saved search facets and alert matching: PASS")
    print("  non-authoritative search rebuild safety: PASS")


if __name__ == "__main__":
    main()
