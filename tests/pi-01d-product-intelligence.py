#!/usr/bin/env python3
"""PI-01D schema, intake, privacy and document convergence proof."""

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


def expect_sql_error(db: sqlite3.Connection, statement: str, values: tuple = ()) -> str:
    try:
        db.execute(statement, values)
    except sqlite3.DatabaseError as exc:
        return str(exc)
    raise AssertionError(f"statement should have failed: {statement}")


def open_vehicle_intake(db: sqlite3.Connection) -> tuple[int, int, bytes]:
    actor = db.execute("SELECT id FROM _user WHERE admin=1 ORDER BY username LIMIT 1").fetchone()[0]
    category_id, schema_id = db.execute(
        """SELECT c.id,s.id FROM categories c JOIN pi_category_schema_versions s ON s.category_id=c.id
           WHERE c.category_key='VEHICLE_PASSENGER_CAR' AND s.status='ACTIVE'"""
    ).fetchone()
    db.execute(
        """INSERT INTO product_intake_open_commands(
          command_key,actor_user,actor_username,category_id,schema_version_id,title,slug,description,
          legacy_category,condition,start_price,buy_now_price,reserve_price,reserve_disclosure,
          shipping_fee,shipping,city,ends_at,asset_kind,images,allow_offers,received_at
        ) VALUES(?,?,?,?,?,'PI test car','pi-test-car','Synthetic local test','vehicles','used',1000,NULL,NULL,
                 'NO_RESERVE',0,'Pickup','Harare','2030-01-01T00:00:00Z','vehicle','[]',0,'')""",
        ("pi-open-1", actor, "admin", category_id, schema_id),
    )
    command = db.execute(
        "SELECT status,error_code,result_auction_id,result_session_id FROM product_intake_open_commands WHERE command_key='pi-open-1'"
    ).fetchone()
    assert command[0:2] == ("accepted", None), command
    return command[2], command[3], actor


def main() -> None:
    db = database()

    # Governed hierarchy and schema custody.
    leaves = db.execute(
        """SELECT count(*) FROM categories WHERE parent_id=(SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY')
           AND node_kind='LEAF'"""
    ).fetchone()[0]
    assert leaves == 11, leaves
    schema_id = db.execute("SELECT id FROM pi_category_schema_versions ORDER BY id LIMIT 1").fetchone()[0]
    assert "PI_SCHEMA_VERSION_IMMUTABLE" in expect_sql_error(
        db, "UPDATE pi_category_schema_versions SET schema_hash='mutated' WHERE id=?", (schema_id,)
    )

    # Invalid group bindings fail as one command; no orphan auction is committed.
    admin = db.execute("SELECT id FROM _user WHERE admin=1 ORDER BY username LIMIT 1").fetchone()[0]
    group_id = db.execute("SELECT id FROM categories WHERE category_key='VEHICLES_MOBILITY'").fetchone()[0]
    before = db.execute("SELECT count(*) FROM auctions").fetchone()[0]
    db.execute(
        """INSERT INTO product_intake_open_commands(
          command_key,actor_user,actor_username,category_id,schema_version_id,title,slug,description,
          legacy_category,condition,start_price,reserve_disclosure,shipping_fee,shipping,city,ends_at,
          asset_kind,images,allow_offers,received_at
        ) VALUES('pi-invalid',?,'admin',?,0,'Invalid','invalid','', 'vehicles','used',1,'NO_RESERVE',0,'','',
                 '2030-01-01T00:00:00Z','vehicle','[]',0,'')""",
        (admin, group_id),
    )
    invalid = db.execute("SELECT status,error_code FROM product_intake_open_commands WHERE command_key='pi-invalid'").fetchone()
    assert invalid == ("rejected", "PI_CATEGORY_SCHEMA_INVALID"), invalid
    assert db.execute("SELECT count(*) FROM auctions").fetchone()[0] == before

    auction_id, session_id, actor = open_vehicle_intake(db)
    auction = db.execute(
        "SELECT asset_kind,status,reserve_disclosure,product_category_id,product_schema_version_id FROM auctions WHERE id=?",
        (auction_id,),
    ).fetchone()
    assert auction[0:3] == ("vehicle", "draft", "NO_RESERVE"), auction

    # Partial draft + resumability + optimistic revision conflict.
    db.execute(
        """INSERT INTO product_intake_step_commands(
          command_key,session_id,actor_user,actor_admin,expected_revision,step_key,step_state,data_json,received_at
        ) VALUES('step-1',?,?,0,0,'IDENTITY','COMPLETE','{"make":"Toyota"}','')""",
        (session_id, actor),
    )
    accepted = db.execute("SELECT status,result_revision FROM product_intake_step_commands WHERE command_key='step-1'").fetchone()
    assert accepted == ("accepted", 1), accepted
    db.execute(
        """INSERT INTO product_intake_step_commands(
          command_key,session_id,actor_user,actor_admin,expected_revision,step_key,step_state,data_json,received_at
        ) VALUES('step-stale',?,?,0,0,'TECHNICAL','IN_PROGRESS','{}','')""",
        (session_id, actor),
    )
    stale = db.execute("SELECT status,error_code FROM product_intake_step_commands WHERE command_key='step-stale'").fetchone()
    assert stale == ("rejected", "INTAKE_REVISION_CONFLICT"), stale

    # Canonical product persists with no guessed PI extension values.
    db.execute(
        """INSERT INTO vehicles(
          auction_id,seller_user,seller_username,vin,chassis_number,registration_number,make,model,variant,
          model_year,engine_number,engine_displacement_cc,fuel_type,transmission,drivetrain,odometer_km,
          location_city,location_country,ownership_status,customs_status,requested_duration_hours,
          declaration_accepted_at,lifecycle,created_at,updated_at
        ) VALUES(?,?, 'admin','JH4KA8260MC000001',NULL,'LOCAL-PI-1','Toyota','Corolla',NULL,2020,NULL,1800,
                 'PETROL','AUTOMATIC','FWD',87000,'Harare','Zimbabwe','DECLARED_OWNER','LOCAL',72,
                 '2026-01-01T00:00:00Z','INTAKE','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')""",
        (auction_id, actor),
    )
    vehicle_id = db.execute("SELECT id FROM vehicles WHERE auction_id=?", (auction_id,)).fetchone()[0]
    nullable_extensions = db.execute(
        "SELECT vehicle_class,body_type,trim,manufacture_year,steering_side,power_kw,owner_count,service_history_class FROM vehicles WHERE id=?",
        (vehicle_id,),
    ).fetchone()
    assert nullable_extensions == (None,) * len(nullable_extensions), nullable_extensions

    # Typed assertions reject an incompatible storage column.
    make_attr, make_version = db.execute(
        """SELECT a.id,v.id FROM pi_attribute_definitions a JOIN pi_attribute_definition_versions v ON v.attribute_id=a.id
           WHERE a.attribute_key='MAKE' AND v.version=1"""
    ).fetchone()
    category_id, schema_version_id = db.execute(
        "SELECT product_category_id,product_schema_version_id FROM auctions WHERE id=?", (auction_id,)
    ).fetchone()
    typed_error = expect_sql_error(
        db,
        """INSERT INTO pi_fact_assertions(
          product_type,product_id,category_id,schema_version_id,attribute_id,attribute_version_id,
          source_class,verification_state,value_integer,asserted_by,asserted_at
        ) VALUES('VEHICLE',?,?,?,?,?,'SELLER_DECLARED','UNVERIFIED',42,?,'2026-01-01T00:00:00Z')""",
        (vehicle_id, category_id, schema_version_id, make_attr, make_version, actor),
    )
    assert "PI_ATTRIBUTE_VALUE_TYPE_MISMATCH" in typed_error, typed_error

    # Artifact-required verification is fail-closed; historical/readable state is preserved.
    db.execute(
        """INSERT INTO vehicle_documents(
          vehicle_id,document_type,document_ref,storage_ref,status,uploaded_by,created_at,updated_at,
          artifact_required,artifact_state,visibility_policy_key,historic_review_required
        ) VALUES(?,'REGISTRATION','PRIVATE-REF',NULL,'DECLARED',?,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',
                 1,'MISSING','DOCUMENT_REFERENCE_CLASSIFIED',0)""",
        (vehicle_id, actor),
    )
    document_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    artifact_error = expect_sql_error(db, "UPDATE vehicle_documents SET status='VERIFIED' WHERE id=?", (document_id,))
    assert "VEHICLE_DOCUMENT_ARTIFACT_REQUIRED" in artifact_error, artifact_error
    assert db.execute("SELECT status FROM vehicle_documents WHERE id=?", (document_id,)).fetchone()[0] == "DECLARED"
    db.execute(
        "UPDATE vehicle_documents SET storage_ref='local-uat://registration/artifact',artifact_state='STORED',status='UPLOADED' WHERE id=?",
        (document_id,),
    )
    db.execute("UPDATE vehicle_documents SET status='VERIFIED',artifact_state='VERIFIED' WHERE id=?", (document_id,))
    registration_attr, registration_version = db.execute(
        """SELECT a.id,v.id FROM pi_attribute_definitions a JOIN pi_attribute_definition_versions v ON v.attribute_id=a.id
           WHERE a.attribute_key='REGISTRATION_NUMBER' AND v.version=1"""
    ).fetchone()
    db.execute(
        """INSERT INTO pi_fact_assertions(
          product_type,product_id,category_id,schema_version_id,attribute_id,attribute_version_id,
          source_class,verification_state,value_text,identifier_class,source_ref_type,source_ref_id,
          asserted_by,verified_by,asserted_at,verified_at
        ) VALUES('VEHICLE',?,?,?,?,?,'DOCUMENT_DERIVED','VERIFIED','LOCAL-PI-1','REGISTRATION_NUMBER',
                 'vehicle_documents',?,?,?,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')""",
        (vehicle_id, category_id, schema_version_id, registration_attr, registration_version, document_id, actor, actor),
    )
    document_fact_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute(
        """INSERT INTO pi_document_fact_assertions(document_id,fact_assertion_id,extraction_path,created_by,created_at)
           VALUES(?,?,'registration.number',?,'2026-01-01T00:00:00Z')""",
        (document_id, document_fact_id, actor),
    )
    assert db.execute("SELECT count(*) FROM pi_document_fact_assertions WHERE document_id=?", (document_id,)).fetchone()[0] == 1

    # Public projections contain classifications, never the raw identifier/reference/user values.
    public = db.execute(
        "SELECT vin_classification,registration_classification FROM pi_vehicle_public WHERE auction_id=?", (auction_id,)
    ).fetchone()
    assert public == ("RECORDED", "RECORDED"), public
    public_columns = {row[1] for row in db.execute("PRAGMA table_info(pi_vehicle_public)")}
    assert not ({"vin", "chassis_number", "registration_number", "engine_number", "seller_user"} & public_columns)
    public_doc_columns = {row[1] for row in db.execute("PRAGMA table_info(pi_vehicle_document_public)")}
    assert "document_ref" not in public_doc_columns and "storage_ref" not in public_doc_columns

    # Publish readiness is distinct from draft persistence and fails on missing governed facts.
    db.execute(
        """INSERT INTO product_intake_publish_commands(
          command_key,session_id,actor_user,actor_admin,expected_revision,command_type,received_at
        ) VALUES('publish-check',?,?,0,1,'CHECK_READY','')""",
        (session_id, actor),
    )
    readiness = db.execute(
        "SELECT status,error_code,json_array_length(missing_attributes) FROM product_intake_publish_commands WHERE command_key='publish-check'"
    ).fetchone()
    assert readiness[0:2] == ("rejected", "PUBLISH_REQUIRED_FACTS_MISSING") and readiness[2] > 0, readiness

    db.close()
    print("PI-01D Product Intelligence migration and authority proof: PASS")
    print("  category hierarchy + immutable schema: PASS")
    print("  atomic intake open + resumable revision control: PASS")
    print("  nullable no-guess vehicle extension: PASS")
    print("  typed fact enforcement: PASS")
    print("  artifact-required document gate: PASS")
    print("  specific document-derived fact convergence: PASS")
    print("  anonymous privacy projection: PASS")
    print("  stage-specific publish readiness: PASS")


if __name__ == "__main__":
    main()
