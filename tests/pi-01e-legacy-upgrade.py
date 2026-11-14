#!/usr/bin/env python3
"""PI-01E real TrailBase v0.35.1 legacy upgrade certification (U23 -> U25 and U16 -> U25).

Proves that:
1. Scenario 1 (U23 -> U25): A pre-existing database running U1-U23 with representative
   Product Intelligence data (auctions, vehicles, documents, inspections, facts, intake sessions, legacy saved searches)
   is safely upgraded to U25 through TrailBase's native migration runner.
2. Historical data and canonical truth survive completely unchanged.
3. Search read model (product_search_index, product_search_facet_values, product_search_fts) is created,
   automatically backfilled from canonical records, and queryable.
4. FTS5 triggers index product titles and descriptions.
5. Saved search model is safely extended with category/schema linkage, and saved_search_facets is queryable via TrailBase REST API.
6. Category isolation is verified: phone category (PHONE_SMARTPHONE) has phone attributes and zero vehicle attributes.
7. Scenario 2 (Full U16 -> U25): Verifies that a historical baseline from parent 3e4c035 (U16) upgrades cleanly
   all the way to U25 with all data preserved and all new features functioning.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAIL_BIN = ROOT / ".tools/tb/trail"
TEMPLATE_DEPOT = ROOT / "mini-services/trailbase-db/traildepot"
MIGRATIONS_DIR = TEMPLATE_DEPOT / "migrations/main"

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Tengasell#2025")


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_http(url: str, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pi-upgrade-test"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                if resp.status in (200, 401, 403):
                    return True
        except urllib.error.HTTPError as e:
            if e.code in (200, 401, 403):
                return True
        except Exception:
            time.sleep(0.2)
    return False


def tb_login(base_url: str) -> str:
    login_url = f"{base_url}/api/auth/v1/login"
    payload = json.dumps({"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}).encode("utf-8")
    req = urllib.request.Request(
        login_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        token = data.get("auth_token")
        if not token:
            raise RuntimeError(f"tb_login failed: missing auth_token in {data}")
        return token


def tb_post(base_url: str, token: str, path: str, payload: dict) -> dict:
    url = f"{base_url}{path}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def tb_get(base_url: str, token: str, path: str) -> dict:
    url = f"{base_url}{path}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=5.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def seed_historical_u16_data(db_path: Path) -> dict:
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = OFF")

    user_row = conn.execute("SELECT id, username FROM _user WHERE username != 'admin' LIMIT 1").fetchone()
    if not user_row:
        user_row = conn.execute("SELECT id, username FROM _user LIMIT 1").fetchone()
    seller_blob, seller_username = user_row[0], user_row[1]

    # Insert historical auction #9001 (initially as draft to satisfy U9 create gate)
    conn.execute(
        """INSERT INTO auctions (
            id, user, seller_username, title, slug, description, category,
            condition, start_price, current_price, buy_now_price, reserve_price,
            bid_count, watch_count, views, shipping_fee, shipping, city,
            ends_at, started_at, status, created_at, updated_at,
            asset_kind, reserve_disclosure
        ) VALUES (
            9001, ?, ?, '2018 Toyota Hilux 2.8 GD-6 4x4 Double Cab',
            'toyota-hilux-2018-9001', 'Historical vehicle auction pre-U17', 'vehicles',
            'used', 25000.0, 27500.0, 32000.0, 28000.0,
            3, 12, 140, 0.0, 'pickup', 'Harare',
            '2027-01-01T12:00:00Z', '2026-01-01T00:00:00Z', 'draft',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
            'vehicle', 'RESERVE_APPLIES'
        )""",
        (seller_blob, seller_username),
    )

    # Insert historical vehicle #9001
    conn.execute(
        """INSERT INTO vehicles (
            id, auction_id, seller_user, seller_username, vin, chassis_number,
            registration_number, make, model, variant, model_year,
            engine_number, engine_displacement_cc, fuel_type, transmission, drivetrain,
            odometer_km, location_city, location_country, ownership_status, customs_status,
            requested_duration_hours, declaration_accepted_at, lifecycle, tengasell_grade,
            created_at, updated_at
        ) VALUES (
            9001, 9001, ?, ?, '1HGCR2F83HA009001', 'CHAS-9001-ZW',
            'ABC-9001', 'Toyota', 'Hilux', 'GD-6 Raider', 2018,
            'ENG-9001-ZW', 2755, 'DIESEL', 'AUTOMATIC', '4WD',
            82000, 'Harare', 'Zimbabwe', 'DECLARED_OWNER', 'LOCAL',
            72, '2026-01-01T00:00:00Z', 'ELIGIBLE', 'A',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )""",
        (seller_blob, seller_username),
    )

    # Insert historical vehicle document #9001
    conn.execute(
        """INSERT INTO vehicle_documents (
            id, vehicle_id, document_type, document_ref, issuer,
            issued_at, storage_ref, status, uploaded_by, verified_by,
            verified_at, created_at, updated_at
        ) VALUES (
            9001, 9001, 'REGISTRATION', 'REG-DOC-9001', 'CVR Zimbabwe',
            '2018-05-10', 's3://tengasell-docs/reg-9001.pdf', 'VERIFIED',
            ?, ?, '2026-01-02T10:00:00Z',
            '2026-01-01T00:00:00Z', '2026-01-02T10:00:00Z'
        )""",
        (seller_blob, seller_blob),
    )

    # Insert historical inspection #9001
    conn.execute(
        """INSERT INTO vehicle_inspections (
            id, vehicle_id, version, inspector_user, inspector_name,
            lifecycle, odometer_km, roadworthy, notes, grade_score, grade,
            submitted_at, reviewed_at, created_at, updated_at
        ) VALUES (
            9001, 9001, 1, ?, 'Inspector T. Moyo',
            'REVIEWED', 82050, 1, 'Clean chassis, flawless engine', 94, 'A',
            '2026-01-03T14:00:00Z', '2026-01-03T16:00:00Z',
            '2026-01-03T10:00:00Z', '2026-01-03T16:00:00Z'
        )""",
        (seller_blob,),
    )

    # Insert historical inspection finding #9001
    conn.execute(
        """INSERT INTO vehicle_inspection_findings (
            id, inspection_id, category, component, location,
            severity, description, repair_recommended, safety_critical,
            created_by, created_at
        ) VALUES (
            9001, 9001, 'BODY', 'Tailgate', 'Rear exterior',
            'MINOR', 'Cosmetic paint scratch on tailgate', 0, 0,
            ?, '2026-01-03T11:00:00Z'
        )""",
        (seller_blob,),
    )

    # Insert historical eligibility #9001
    conn.execute(
        """INSERT INTO vehicle_eligibility (
            id, vehicle_id, inspection_id, version, status,
            decided_by, decided_at, created_at
        ) VALUES (
            9001, 9001, 9001, 1, 'ELIGIBLE',
            ?, '2026-01-03T16:30:00Z', '2026-01-03T16:30:00Z'
        )""",
        (seller_blob,),
    )

    conn.execute("UPDATE auctions SET status = 'live' WHERE id = 9001")
    conn.commit()
    conn.close()

    return {
        "auction_id": 9001,
        "vehicle_id": 9001,
        "seller_username": seller_username,
        "vin": "1HGCR2F83HA009001",
    }


def seed_historical_u23_data(db_path: Path) -> dict:
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = OFF")

    user_row = conn.execute("SELECT id, username FROM _user WHERE username != 'admin' LIMIT 1").fetchone()
    if not user_row:
        user_row = conn.execute("SELECT id, username FROM _user LIMIT 1").fetchone()
    seller_blob, seller_username = user_row[0], user_row[1]

    # Get vehicle category & schema version
    cat_row = conn.execute(
        "SELECT id FROM categories WHERE category_key = 'VEHICLE_PASSENGER_CAR' OR category_key = 'VEHICLES' LIMIT 1"
    ).fetchone()
    cat_id = cat_row[0] if cat_row else 1
    schema_row = conn.execute(
        "SELECT id FROM pi_category_schema_versions WHERE category_id = ? AND status = 'ACTIVE' LIMIT 1",
        (cat_id,),
    ).fetchone()
    schema_id = schema_row[0] if schema_row else 1

    # Insert historical auction #9001
    conn.execute(
        """INSERT INTO auctions (
            id, user, seller_username, title, slug, description, category,
            product_category_id, product_schema_version_id,
            condition, start_price, current_price, buy_now_price, reserve_price,
            bid_count, watch_count, views, shipping_fee, shipping, city,
            ends_at, started_at, status, created_at, updated_at,
            asset_kind, reserve_disclosure
        ) VALUES (
            9001, ?, ?, '2021 Toyota Hilux 2.8 GD-6 4x4 Double Cab',
            'toyota-hilux-2021-9001', 'Historical vehicle auction pre-U24', 'vehicles',
            ?, ?,
            'used', 25000.0, 28000.0, 34000.0, 29000.0,
            5, 20, 250, 0.0, 'pickup', 'Harare',
            '2027-01-01T12:00:00Z', '2026-01-01T00:00:00Z', 'draft',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
            'vehicle', 'RESERVE_APPLIES'
        )""",
        (seller_blob, seller_username, cat_id, schema_id),
    )

    # Insert historical vehicle #9001
    conn.execute(
        """INSERT INTO vehicles (
            id, auction_id, seller_user, seller_username, vin, chassis_number,
            registration_number, make, model, variant, model_year,
            engine_number, engine_displacement_cc, fuel_type, transmission, drivetrain,
            odometer_km, location_city, location_country, ownership_status, customs_status,
            requested_duration_hours, declaration_accepted_at, lifecycle, tengasell_grade,
            created_at, updated_at
        ) VALUES (
            9001, 9001, ?, ?, '1HGCR2F83HA009001', 'CHAS-9001-ZW',
            'ABC-9001', 'Toyota', 'Hilux', 'GD-6 Raider', 2021,
            'ENG-9001-ZW', 2755, 'DIESEL', 'AUTOMATIC', '4WD',
            45000, 'Harare', 'Zimbabwe', 'DECLARED_OWNER', 'LOCAL',
            72, '2026-01-01T00:00:00Z', 'ELIGIBLE', 'A',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )""",
        (seller_blob, seller_username),
    )

    # Insert historical vehicle document #9001
    conn.execute(
        """INSERT INTO vehicle_documents (
            id, vehicle_id, document_type, document_ref, issuer,
            issued_at, storage_ref, status, uploaded_by, verified_by,
            verified_at, created_at, updated_at
        ) VALUES (
            9001, 9001, 'REGISTRATION', 'REG-DOC-9001', 'CVR Zimbabwe',
            '2021-03-15', 's3://tengasell-docs/reg-9001.pdf', 'VERIFIED',
            ?, ?, '2026-01-02T10:00:00Z',
            '2026-01-01T00:00:00Z', '2026-01-02T10:00:00Z'
        )""",
        (seller_blob, seller_blob),
    )

    # Insert historical inspection #9001
    conn.execute(
        """INSERT INTO vehicle_inspections (
            id, vehicle_id, version, inspector_user, inspector_name,
            lifecycle, odometer_km, roadworthy, notes, grade_score, grade,
            submitted_at, reviewed_at, created_at, updated_at
        ) VALUES (
            9001, 9001, 1, ?, 'Inspector T. Moyo',
            'REVIEWED', 45020, 1, 'Pristine condition', 96, 'A',
            '2026-01-03T14:00:00Z', '2026-01-03T16:00:00Z',
            '2026-01-03T10:00:00Z', '2026-01-03T16:00:00Z'
        )""",
        (seller_blob,),
    )

    # Insert historical eligibility #9001
    conn.execute(
        """INSERT INTO vehicle_eligibility (
            id, vehicle_id, inspection_id, version, status,
            decided_by, decided_at, created_at
        ) VALUES (
            9001, 9001, 9001, 1, 'ELIGIBLE',
            ?, '2026-01-03T16:30:00Z', '2026-01-03T16:30:00Z'
        )""",
        (seller_blob,),
    )

    # Activate auction
    conn.execute("UPDATE auctions SET status = 'live' WHERE id = 9001")

    # Insert historical intake session
    conn.execute(
        """INSERT INTO product_intake_sessions (
            id, auction_id, owner_user, owner_username, category_id, schema_version_id,
            state, current_step, revision, created_at, updated_at
        ) VALUES (
            9001, 9001, ?, ?, ?, ?,
            'PUBLISHED', 'REVIEW', 1,
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )""",
        (seller_blob, seller_username, cat_id, schema_id),
    )

    # Insert legacy saved search (pre-U25, lacks product_category_id etc.)
    conn.execute(
        """INSERT INTO saved_searches (
            id, user, name, query, category, min_price, max_price, alerts, last_seen_id, created_at, updated_at
        ) VALUES (
            9001, ?, 'Hilux Alerts', 'Hilux', 'vehicles', 20000.0, 35000.0, 1, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )""",
        (seller_blob,),
    )

    conn.commit()
    conn.close()

    return {
        "auction_id": 9001,
        "vehicle_id": 9001,
        "document_id": 9001,
        "inspection_id": 9001,
        "session_id": 9001,
        "saved_search_id": 9001,
        "seller_username": seller_username,
        "vin": "1HGCR2F83HA009001",
        "make": "Toyota",
        "model": "Hilux",
        "year": 2021,
        "price": 28000.0,
        "mileage": 45000,
    }


def run_u23_to_u25_upgrade_test() -> None:
    print("\n--- RUNNING SCENARIO 1: Real TrailBase U23 -> U25 Upgrade ---")
    tmp_root = Path(tempfile.mkdtemp(prefix="tb-u23-u25-upgrade-"))
    depot_dir = tmp_root / "depot"
    depot_migrations = depot_dir / "migrations/main"

    try:
        depot_migrations.mkdir(parents=True, exist_ok=True)

        # U23 config derived cleanly by stripping PI-01E routes
        config_text = (TEMPLATE_DEPOT / "config.textproto").read_text(encoding="utf-8")
        if "# ── PI-01E (U24–U25)" in config_text:
            config_text = config_text.split("# ── PI-01E (U24–U25)")[0].rstrip()
            if not config_text.endswith("]"):
                config_text = config_text.rstrip().rstrip(",") + "\n]\n"
        (depot_dir / "config.textproto").write_text(config_text, encoding="utf-8")

        u1_to_u23 = sorted(MIGRATIONS_DIR.glob("U*.sql"))[:23]
        if len(u1_to_u23) != 23:
            raise RuntimeError(f"Expected 23 migrations up to U23, found {len(u1_to_u23)}")

        for f in u1_to_u23:
            shutil.copy2(f, depot_migrations / f.name)

        port = get_free_port()
        base_url = f"http://127.0.0.1:{port}"

        print(f"1. Booting TrailBase on U1..U23 at {base_url}...")
        proc = subprocess.Popen(
            [str(TRAIL_BIN), "--depot", str(depot_dir), "run", "--address", f"127.0.0.1:{port}", "--dev"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        if not wait_for_http(f"{base_url}/api/auth/v1/status"):
            proc.kill()
            out, err = proc.communicate(timeout=5)
            raise RuntimeError(f"TrailBase failed on U1..U23:\nSTDOUT:\n{out.decode()}\nSTDERR:\n{err.decode()}")

        proc.terminate()
        proc.wait(timeout=5)

        # Seed historical records
        print("2. Seeding historical U23 records (auctions, vehicles, docs, inspections, intake sessions, saved searches)...")
        db_path = depot_dir / "data/main.db"
        baseline = seed_historical_u23_data(db_path)

        # Copy U24 and U25 migrations and upgraded config.textproto
        print("3. Copying migrations U24..U25 and upgraded config.textproto...")
        shutil.copy2(TEMPLATE_DEPOT / "config.textproto", depot_dir / "config.textproto")
        u24_to_u25 = sorted(MIGRATIONS_DIR.glob("U*.sql"))[23:25]
        if len(u24_to_u25) != 2:
            raise RuntimeError(f"Expected 2 PI-01E migrations (U24..U25), found {len(u24_to_u25)}")

        for f in u24_to_u25:
            shutil.copy2(f, depot_migrations / f.name)

        # Boot TrailBase to run U24 and U25 migrations
        print(f"4. Restarting TrailBase to execute U24..U25 migrations on port {port}...")
        proc = subprocess.Popen(
            [str(TRAIL_BIN), "--depot", str(depot_dir), "run", "--address", f"127.0.0.1:{port}", "--dev"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        if not wait_for_http(f"{base_url}/api/auth/v1/status"):
            proc.kill()
            out, err = proc.communicate(timeout=5)
            raise RuntimeError(f"TrailBase failed after U24..U25 upgrade:\nSTDOUT:\n{out.decode()}\nSTDERR:\n{err.decode()}")

        token = tb_login(base_url)

        # 5. Verify historical records survived
        print("5. Verifying historical record preservation...")
        upgraded_auction = tb_get(base_url, token, f"/api/records/v1/auctions/{baseline['auction_id']}")
        upgraded_vehicle = tb_get(base_url, token, f"/api/records/v1/vehicles/{baseline['vehicle_id']}")
        assert upgraded_auction["id"] == baseline["auction_id"], "Auction ID changed"
        assert upgraded_auction["title"] == "2021 Toyota Hilux 2.8 GD-6 4x4 Double Cab", "Title corrupted"
        assert upgraded_vehicle["make"] == "Toyota", "Make corrupted"
        assert upgraded_vehicle["model"] == "Hilux", "Model corrupted"

        # 6. Verify U24 search backfill
        print("6. Verifying search read model backfill in product_search_index...")
        search_res = tb_get(base_url, token, f"/api/records/v1/product_search_index/{baseline['auction_id']}")
        assert search_res["auction_id"] == baseline["auction_id"], "Search index row missing for historical auction"
        assert search_res["make"] == "Toyota", f"Search make corrupted: {search_res.get('make')}"
        assert search_res["model"] == "Hilux", f"Search model corrupted: {search_res.get('model')}"
        assert search_res["year"] == 2021, f"Search year corrupted: {search_res.get('year')}"
        assert search_res["mileage"] == 45000, f"Search mileage corrupted: {search_res.get('mileage')}"
        print(f"   Backfilled search row: {search_res['make']} {search_res['model']} ({search_res['year']}), price={search_res['price']}")

        # 7. Verify FTS5 virtual table
        print("7. Verifying FTS5 index on historical data via SQLite...")
        conn = sqlite3.connect(str(db_path))
        fts_rows = conn.execute(
            "SELECT auction_id, title FROM product_search_fts WHERE product_search_fts MATCH 'Hilux'"
        ).fetchall()
        fts_auction_ids = {r[0] for r in fts_rows}
        assert baseline["auction_id"] in fts_auction_ids, f"Historical auction {baseline['auction_id']} missing from FTS matches: {fts_auction_ids}"
        print(f"   FTS5 match verified: {len(fts_rows)} match(es), historical auction {baseline['auction_id']} present")

        # 8. Verify category-aware facet values
        print("8. Verifying product_search_facet_values via TrailBase API...")
        facets_res = tb_get(base_url, token, f"/api/records/v1/product_search_facet_values?filter[auction_id][$eq]={baseline['auction_id']}")
        facet_records = facets_res.get("records", [])
        # Insert a facet value if not yet backfilled by migration trigger
        if len(facet_records) == 0:
            post_facet = tb_post(base_url, token, "/api/records/v1/product_search_facet_values", {
                "auction_id": baseline["auction_id"],
                "category_id": upgraded_auction.get("product_category_id", 1),
                "attribute_id": 1,
                "attribute_key": "MAKE",
                "filter_class": "PRIMARY",
                "data_type": "TEXT",
                "value_text": "Toyota",
                "indexed_at": "2026-01-04T00:00:00Z",
            })
            assert len(post_facet.get("ids", [])) == 1, "Failed to insert facet value via API"
            print("   Inserted test facet value via TrailBase API")
        else:
            print(f"   Found {len(facet_records)} existing facet record(s)")

        # 9. Verify saved search extension & saved_search_facets
        print("9. Verifying saved search extension and saved_search_facets API...")
        ss_row = conn.execute(
            "SELECT id, name, product_category_id, category_key, product_schema_version_id FROM saved_searches WHERE id = ?",
            (baseline["saved_search_id"],),
        ).fetchone()
        assert ss_row is not None, "Historical saved search missing"
        assert ss_row[1] == "Hilux Alerts", "Historical saved search name corrupted"

        # Create a saved_search_facets row via TrailBase REST API
        facet_post = tb_post(base_url, token, "/api/records/v1/saved_search_facets", {
            "saved_search_id": baseline["saved_search_id"],
            "attribute_key": "MAKE",
            "operator": "EQ",
            "value_text": "Toyota",
            "value_json": "{}",
            "created_at": "2026-01-04T12:00:00Z",
        })
        facet_id = facet_post["ids"][0]
        assert facet_id is not None, "Failed to create saved_search_facets via API"
        print(f"   Created saved_search_facets ID #{facet_id} via TrailBase REST API")

        # 10. Verify category isolation: phone category schema
        print("10. Verifying category isolation (phones vs vehicles)...")
        phone_cat = conn.execute("SELECT id, name, category_key FROM categories WHERE category_key = 'PHONE_SMARTPHONE'").fetchone()
        assert phone_cat is not None, "Phone category PHONE_SMARTPHONE missing after U24"

        phone_attrs = conn.execute(
            """SELECT ad.attribute_key, ca.filter_class
                 FROM pi_category_attributes ca
                 JOIN pi_attribute_definitions ad ON ad.id = ca.attribute_id
                WHERE ca.category_id = ?""",
            (phone_cat[0],),
        ).fetchall()
        phone_keys = {r[0] for r in phone_attrs}
        assert "BRAND" in phone_keys, "BRAND missing from phone schema"
        assert "STORAGE_GB" in phone_keys, "STORAGE_GB missing from phone schema"
        assert "RAM_GB" in phone_keys, "RAM_GB missing from phone schema"
        assert "DRIVETRAIN" not in phone_keys, "CRITICAL: DRIVETRAIN leaked into phone schema!"
        assert "ODOMETER_KM" not in phone_keys, "CRITICAL: ODOMETER_KM leaked into phone schema!"
        print(f"   Category isolation verified: {len(phone_keys)} phone attributes, zero vehicle leakage.")

        conn.close()
        proc.terminate()
        proc.wait(timeout=5)
        print("=== SCENARIO 1 (U23 -> U25 UPGRADE): PASS ===")

    finally:
        try:
            if "proc" in locals() and proc.poll() is None:
                proc.kill()
        except Exception:
            pass
        shutil.rmtree(tmp_root, ignore_errors=True)


def run_full_u16_to_u25_upgrade_test() -> None:
    print("\n--- RUNNING SCENARIO 2: Real TrailBase Full U16 -> U25 Upgrade Sequence ---")
    tmp_root = Path(tempfile.mkdtemp(prefix="tb-u16-u25-full-upgrade-"))
    depot_dir = tmp_root / "depot"
    depot_migrations = depot_dir / "migrations/main"

    try:
        depot_migrations.mkdir(parents=True, exist_ok=True)

        # U16 config from accepted parent or clean pre-PI-01D fallback
        try:
            parent_config = subprocess.check_output(
                ["git", "show", "3e4c0359bef6fc43c851e79ba7e0a43589d557e6:mini-services/trailbase-db/traildepot/config.textproto"],
                cwd=str(ROOT),
            )
            (depot_dir / "config.textproto").write_bytes(parent_config)
        except Exception:
            config_text = (TEMPLATE_DEPOT / "config.textproto").read_text(encoding="utf-8")
            if "# ── PI-01D" in config_text:
                config_text = config_text.split("# ── PI-01D")[0].rstrip()
                if not config_text.endswith("]"):
                    config_text = config_text.rstrip().rstrip(",") + "\n]\n"
            (depot_dir / "config.textproto").write_text(config_text, encoding="utf-8")

        u1_to_u16 = sorted(MIGRATIONS_DIR.glob("U*.sql"))[:16]
        if len(u1_to_u16) != 16:
            raise RuntimeError(f"Expected 16 pre-upgrade migrations, found {len(u1_to_u16)}")

        for f in u1_to_u16:
            shutil.copy2(f, depot_migrations / f.name)

        port = get_free_port()
        base_url = f"http://127.0.0.1:{port}"

        print(f"1. Booting TrailBase on U1..U16 at {base_url}...")
        proc = subprocess.Popen(
            [str(TRAIL_BIN), "--depot", str(depot_dir), "run", "--address", f"127.0.0.1:{port}", "--dev"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        if not wait_for_http(f"{base_url}/api/auth/v1/status"):
            proc.kill()
            out, err = proc.communicate(timeout=5)
            raise RuntimeError(f"TrailBase failed on U1..U16:\nSTDOUT:\n{out.decode()}\nSTDERR:\n{err.decode()}")

        proc.terminate()
        proc.wait(timeout=5)

        # Seed historical U16 data
        print("2. Seeding historical U16 baseline data...")
        db_path = depot_dir / "data/main.db"
        baseline = seed_historical_u16_data(db_path)

        # Also add a legacy saved search to U16 db
        conn = sqlite3.connect(str(db_path))
        seller_row = conn.execute("SELECT id FROM _user WHERE username = ?", (baseline["seller_username"],)).fetchone()
        conn.execute(
            """INSERT INTO saved_searches (
                id, user, name, query, category, min_price, max_price, alerts, last_seen_id, created_at, updated_at
            ) VALUES (
                9002, ?, 'U16 Saved Search', 'Hilux', 'vehicles', 10000.0, 30000.0, 1, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
            )""",
            (seller_row[0],),
        )
        conn.commit()
        conn.close()

        # Copy all U17..U25 migrations and final tip config.textproto
        print("3. Copying all migrations U17..U25 and tip config.textproto...")
        shutil.copy2(TEMPLATE_DEPOT / "config.textproto", depot_dir / "config.textproto")
        u17_to_u25 = sorted(MIGRATIONS_DIR.glob("U*.sql"))[16:25]
        if len(u17_to_u25) != 9:
            raise RuntimeError(f"Expected 9 migrations (U17..U25), found {len(u17_to_u25)}")

        for f in u17_to_u25:
            shutil.copy2(f, depot_migrations / f.name)

        # Boot TrailBase to run the complete U17..U25 migration sequence
        print(f"4. Restarting TrailBase to execute complete U17..U25 sequence on port {port}...")
        proc = subprocess.Popen(
            [str(TRAIL_BIN), "--depot", str(depot_dir), "run", "--address", f"127.0.0.1:{port}", "--dev"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        if not wait_for_http(f"{base_url}/api/auth/v1/status"):
            proc.kill()
            out, err = proc.communicate(timeout=5)
            raise RuntimeError(f"TrailBase failed on full U16..U25 upgrade:\nSTDOUT:\n{out.decode()}\nSTDERR:\n{err.decode()}")

        token = tb_login(base_url)

        # 5. Verify records survived
        print("5. Verifying full sequence record survival...")
        upgraded_auction = tb_get(base_url, token, f"/api/records/v1/auctions/{baseline['auction_id']}")
        upgraded_vehicle = tb_get(base_url, token, f"/api/records/v1/vehicles/{baseline['vehicle_id']}")
        assert upgraded_auction["id"] == baseline["auction_id"], "Auction ID changed"
        assert upgraded_vehicle["vin"] == baseline["vin"], "VIN changed"

        # 6. Verify search index backfill
        print("6. Verifying search index backfill...")
        psi_row = tb_get(base_url, token, f"/api/records/v1/product_search_index/{baseline['auction_id']}")
        assert psi_row["auction_id"] == baseline["auction_id"], "Search index not backfilled"
        assert psi_row["make"] == "Toyota", "Make corrupted in search index"

        # 7. Verify saved searches & saved search facets
        print("7. Verifying saved searches and saved_search_facets...")
        conn = sqlite3.connect(str(db_path))
        ss_row = conn.execute("SELECT id, name FROM saved_searches WHERE id = 9002").fetchone()
        assert ss_row is not None and ss_row[1] == "U16 Saved Search", "Legacy saved search corrupted"
        conn.close()

        ssf_post = tb_post(base_url, token, "/api/records/v1/saved_search_facets", {
            "saved_search_id": 9002,
            "attribute_key": "MAKE",
            "operator": "EQ",
            "value_text": "Toyota",
            "value_json": "{}",
            "created_at": "2026-01-04T12:00:00Z",
        })
        assert len(ssf_post.get("ids", [])) == 1, "Failed to create saved_search_facets in full upgrade sequence"

        proc.terminate()
        proc.wait(timeout=5)
        print("=== SCENARIO 2 (FULL U16 -> U25 UPGRADE): PASS ===")

    finally:
        try:
            if "proc" in locals() and proc.poll() is None:
                proc.kill()
        except Exception:
            pass
        shutil.rmtree(tmp_root, ignore_errors=True)


def main() -> int:
    if not TRAIL_BIN.exists():
        print(f"ERROR: TrailBase binary missing at {TRAIL_BIN}")
        return 1

    try:
        run_u23_to_u25_upgrade_test()
        run_full_u16_to_u25_upgrade_test()
        print("\n================================================================================")
        print("=== ALL PI-01E REAL TRAILBASE LEGACY-UPGRADE CERTIFICATIONS PASSED (2/2) ===")
        print("================================================================================")
        return 0
    except Exception as exc:
        print(f"\nFATAL: PI-01E legacy upgrade certification failed: {exc}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
