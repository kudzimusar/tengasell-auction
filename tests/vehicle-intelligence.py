#!/usr/bin/env python3
"""IMP-04 Vehicle / Tengasell Inspection authority proof on disposable SQLite."""
from __future__ import annotations
import os, sqlite3, tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MIG=ROOT/"mini-services/trailbase-db/traildepot/migrations/main/U1000000009__vehicle_intelligence.sql"

def dbconn(path):
    db=sqlite3.connect(path, timeout=10, isolation_level=None)
    db.row_factory=sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db

def iso(dt=None):
    return (dt or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")

def eq(a,b,label):
    if a!=b: raise AssertionError(f"{label}: expected {b!r}, got {a!r}")

def main():
    with tempfile.TemporaryDirectory(prefix="tengasell-imp04-") as td:
        path=os.path.join(td,"vehicle.db")
        db=dbconn(path)
        db.executescript("""
        CREATE TABLE _user (
          id BLOB PRIMARY KEY,
          username TEXT NOT NULL,
          admin INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE auctions (
          id INTEGER PRIMARY KEY,
          user BLOB NOT NULL,
          seller_username TEXT NOT NULL,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'live',
          bid_count INTEGER NOT NULL DEFAULT 0,
          started_at TEXT NOT NULL,
          ends_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE auction_commands (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          command_key TEXT,
          auction_id INTEGER NOT NULL,
          command_type TEXT NOT NULL
        ) STRICT;
        CREATE TABLE audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user TEXT,
          action TEXT NOT NULL,
          entity TEXT NOT NULL DEFAULT '',
          entity_id INTEGER,
          source TEXT NOT NULL DEFAULT 'web',
          payload TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        ) STRICT;
        """)
        users=[
          (b"admin","admin",1),
          (b"seller","seller",0),
          (b"inspector","inspector",0),
          (b"reviewer","reviewer",0),
          (b"outsider","outsider",0),
        ]
        db.executemany("INSERT INTO _user(id,username,admin) VALUES(?,?,?)",users)
        db.executescript(MIG.read_text())

        # Whole vehicles may not bypass intake/review by posting live directly.
        try:
            db.execute("""INSERT INTO auctions
              (id,user,seller_username,title,category,status,bid_count,started_at,ends_at,version,updated_at,asset_kind)
              VALUES(1,?,'seller','Unsafe bypass','vehicles','live',0,?,?,0,?,'vehicle')""",
              (b"seller",iso(),iso(datetime.now(timezone.utc)+timedelta(hours=72)),iso()))
            raise AssertionError("vehicle live-create gate did not fire")
        except sqlite3.IntegrityError as e:
            if "VEHICLE_ELIGIBILITY_REQUIRED" not in str(e): raise

        db.execute("""INSERT INTO auctions
          (id,user,seller_username,title,category,status,bid_count,started_at,ends_at,version,updated_at,asset_kind)
          VALUES(2,?,'seller','Reviewed Hilux','vehicles','draft',0,?,?,0,?,'vehicle')""",
          (b"seller",iso(),iso(datetime.now(timezone.utc)+timedelta(hours=72)),iso()))

        # VIN/chassis semantics are database-enforced.
        try:
            db.execute("""INSERT INTO vehicles
              (auction_id,seller_user,seller_username,vin,chassis_number,make,model,model_year,
               fuel_type,transmission,drivetrain,odometer_km,location_city,ownership_status,
               customs_status,requested_duration_hours,declaration_accepted_at,created_at,updated_at)
              VALUES(2,?,'seller','SHORT',NULL,'Toyota','Hilux',2020,'DIESEL','MANUAL','4WD',
                     82000,'Harare','DECLARED_OWNER','LOCAL',72,?,?,?)""",
              (b"seller",iso(),iso(),iso()))
            raise AssertionError("invalid VIN unexpectedly accepted")
        except sqlite3.IntegrityError:
            pass

        db.execute("""INSERT INTO vehicles
          (auction_id,seller_user,seller_username,vin,chassis_number,registration_number,
           make,model,variant,model_year,engine_number,engine_displacement_cc,fuel_type,
           transmission,drivetrain,odometer_km,location_city,location_country,
           ownership_status,customs_status,requested_duration_hours,declaration_accepted_at,
           lifecycle,created_at,updated_at)
          VALUES(2,?,'seller','JH4KA8260MC000001',NULL,'ABC1234','Toyota','Hilux','GD-6',2020,
                 'ENG-100',2755,'DIESEL','MANUAL','4WD',82000,'Harare','Zimbabwe',
                 'DECLARED_OWNER','LOCAL',72,?,'INTAKE',?,?)""",
          (b"seller",iso(),iso(),iso()))
        vehicle_id=db.execute("SELECT id FROM vehicles WHERE auction_id=2").fetchone()[0]

        # Explicit staff authority.
        now=iso()
        db.execute("""INSERT INTO vehicle_staff_roles(user,username,role,active,granted_by,granted_at)
                      VALUES(?, 'inspector','INSPECTOR',1,?,?)""",(b"inspector",b"admin",now))
        db.execute("""INSERT INTO vehicle_staff_roles(user,username,role,active,granted_by,granted_at)
                      VALUES(?, 'reviewer','REVIEWER',1,?,?)""",(b"reviewer",b"admin",now))

        # Required verified evidence.
        for dtype,ref in [("OWNERSHIP","OWN-1"),("REGISTRATION","REG-1")]:
            db.execute("""INSERT INTO vehicle_documents
              (vehicle_id,document_type,document_ref,status,uploaded_by,verified_by,verified_at,created_at,updated_at)
              VALUES(?,?,?,'VERIFIED',?,?,?,?,?)""",
              (vehicle_id,dtype,ref,b"seller",b"reviewer",now,now,now))

        db.execute("""INSERT INTO vehicle_inspections
          (vehicle_id,version,inspector_user,inspector_name,lifecycle,odometer_km,roadworthy,
           notes,submitted_at,created_at,updated_at)
          VALUES(?,1,?,'inspector','SUBMITTED',82010,1,'Roadworthy',?,?,?)""",
          (vehicle_id,b"inspector",now,now,now))
        inspection1=db.execute("SELECT id FROM vehicle_inspections WHERE vehicle_id=? AND version=1",(vehicle_id,)).fetchone()[0]
        db.execute("""INSERT INTO vehicle_inspection_findings
          (inspection_id,category,component,location,severity,description,repair_recommended,
           safety_critical,created_by,created_at)
          VALUES(?,'BODY','Tailgate','rear','MINOR','Small cosmetic dent',1,0,?,?)""",
          (inspection1,b"inspector",now))

        # Unauthorized reviewer is rejected durably.
        db.execute("""INSERT INTO vehicle_review_commands
          (command_key,vehicle_id,inspection_id,reviewer_user,reviewer_name)
          VALUES('review-bad',?,?,?,'outsider')""",(vehicle_id,inspection1,b"outsider"))
        bad=db.execute("SELECT * FROM vehicle_review_commands WHERE command_key='review-bad'").fetchone()
        eq(bad["status"],"rejected","unauthorized reviewer")
        eq(bad["error_code"],"REVIEWER_PERMISSION_REQUIRED","reviewer RBAC code")

        # Authorized reviewer: Tengasell score 98 => A; verified docs => eligible.
        db.execute("""INSERT INTO vehicle_review_commands
          (command_key,vehicle_id,inspection_id,reviewer_user,reviewer_name)
          VALUES('review-good',?,?,?,'reviewer')""",(vehicle_id,inspection1,b"reviewer"))
        good=db.execute("SELECT * FROM vehicle_review_commands WHERE command_key='review-good'").fetchone()
        eq(good["status"],"accepted","authorized review")
        eq(good["result_score"],98,"Tengasell score")
        eq(good["result_grade"],"A","Tengasell grade")
        eq(good["eligibility_status"],"ELIGIBLE","eligibility")
        eq(db.execute("SELECT status FROM auctions WHERE id=2").fetchone()[0],"live","eligible activation")
        eq(db.execute("SELECT lifecycle FROM vehicles WHERE id=?",(vehicle_id,)).fetchone()[0],"ELIGIBLE","vehicle lifecycle")
        if db.execute("SELECT COUNT(*) FROM audit_events WHERE action='vehicle:review'").fetchone()[0] != 1:
            raise AssertionError("review audit not persisted")

        # Database bid gate permits current eligible authority.
        db.execute("INSERT INTO auction_commands(command_key,auction_id,command_type) VALUES('bid-ok',2,'PLACE_BID')")

        # A new critical inspection supersedes eligibility and removes commerce.
        db.execute("""INSERT INTO vehicle_inspections
          (vehicle_id,version,inspector_user,inspector_name,lifecycle,odometer_km,roadworthy,
           notes,submitted_at,created_at,updated_at)
          VALUES(?,2,?,'inspector','SUBMITTED',82100,1,'Critical finding',?,?,?)""",
          (vehicle_id,b"inspector",now,now,now))
        inspection2=db.execute("SELECT id FROM vehicle_inspections WHERE vehicle_id=? AND version=2",(vehicle_id,)).fetchone()[0]
        db.execute("""INSERT INTO vehicle_inspection_findings
          (inspection_id,category,component,location,severity,description,repair_recommended,
           safety_critical,created_by,created_at)
          VALUES(?,'STRUCTURAL','Chassis rail','front-left','CRITICAL',
                 'Structural fracture affects safe operation',1,1,?,?)""",
          (inspection2,b"inspector",now))
        db.execute("""INSERT INTO vehicle_review_commands
          (command_key,vehicle_id,inspection_id,reviewer_user,reviewer_name)
          VALUES('review-critical',?,?,?,'reviewer')""",(vehicle_id,inspection2,b"reviewer"))
        critical=db.execute("SELECT * FROM vehicle_review_commands WHERE command_key='review-critical'").fetchone()
        eq(critical["status"],"accepted","critical review processed")
        eq(critical["result_grade"],"REJECT","critical grade")
        eq(critical["eligibility_status"],"INELIGIBLE","critical eligibility")
        reason_codes={r[0] for r in db.execute(
          """SELECT code FROM vehicle_eligibility_reasons
             WHERE eligibility_id=?""",(critical["eligibility_id"],)
        ).fetchall()}
        if not {"CRITICAL_SAFETY_FINDING","GRADE_REJECTED"}.issubset(reason_codes):
            raise AssertionError(f"missing eligibility reasons: {reason_codes}")
        eq(db.execute("SELECT status FROM auctions WHERE id=2").fetchone()[0],"draft","ineligible removes live authority")

        try:
            db.execute("INSERT INTO auction_commands(command_key,auction_id,command_type) VALUES('bid-blocked',2,'PLACE_BID')")
            raise AssertionError("ineligible vehicle bid unexpectedly accepted")
        except sqlite3.IntegrityError as e:
            if "VEHICLE_NOT_ELIGIBLE" not in str(e): raise

        # Parts/accessories remain ordinary marketplace inventory.
        db.execute("""INSERT INTO auctions
          (id,user,seller_username,title,category,status,bid_count,started_at,ends_at,version,updated_at,asset_kind)
          VALUES(3,?,'seller','Hilux mirror','vehicles','live',0,?,?,0,?,'part')""",
          (b"seller",iso(),iso(datetime.now(timezone.utc)+timedelta(hours=24)),iso()))
        db.execute("INSERT INTO auction_commands(command_key,auction_id,command_type) VALUES('part-bid',3,'PLACE_BID')")

        print("IMP-04 vehicle / inspection authority: PASS")
        print("VIN=PASS roles=PASS documents=PASS grading=PASS eligibility=PASS reasons=PASS")
        print("activation=PASS reinspection-fail-closed=PASS vehicle-bid-gate=PASS parts-preserved=PASS")
        db.close()

if __name__=="__main__":
    main()
