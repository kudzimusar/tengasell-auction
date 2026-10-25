#!/usr/bin/env python3
"""Create one synthetic, eligible vehicle in a disposable LR01-R1 TrailBase DB."""

from __future__ import annotations
import json
import sqlite3
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: lr01-r1-visual-fixtures.py <main.db>")

db_path = Path(sys.argv[1])
if not db_path.exists():
    raise SystemExit(f"TrailBase DB not found: {db_path}")

db = sqlite3.connect(db_path)
db.execute("PRAGMA foreign_keys=OFF")
now = "2026-10-25T04:30:00Z"

admin = db.execute("SELECT id,username FROM _user WHERE username='admin' AND admin=1 LIMIT 1").fetchone()
ordinary = db.execute("SELECT id,username FROM _user WHERE username='simba' LIMIT 1").fetchone()
if not admin or not ordinary:
    raise SystemExit("expected seeded admin and simba users are missing")

auction = db.execute(
    """SELECT a.id,a.user,a.seller_username
         FROM auctions a
         LEFT JOIN vehicles v ON v.auction_id=a.id
        WHERE v.id IS NULL
        ORDER BY CASE WHEN COALESCE(a.bid_count,0)=0 THEN 0 ELSE 1 END,a.id
        LIMIT 1"""
).fetchone()
if not auction:
    raise SystemExit("no auction is available for disposable vehicle fixture")

auction_id, seller_user, seller_username = auction

# Move the selected disposable auction to draft before declaring it a whole
# vehicle, satisfying the U9 fail-closed activation trigger.
db.execute(
    """UPDATE auctions
          SET status='draft', bid_count=0, live_session_id=NULL
        WHERE id=?""",
    (auction_id,),
)

columns = {row[1] for row in db.execute("PRAGMA table_info(auctions)")}
patch = {
    "category": "vehicles",
    "asset_kind": "vehicle",
    "title": "LR01-R1 Synthetic 2022 Toyota Hilux GD-6",
    "description": "Disposable exact-head visual UAT vehicle. Structured Tengasell inspection evidence is synthetic and confined to the CI runner.",
    "city": "Harare",
    "condition": "used",
    "status": "draft",
    "bid_count": 0,
    "current_price": 18500.0,
    "start_price": 18500.0,
    "ends_at": "2030-11-07T15:00:00Z",
    "updated_at": now,
}
available = {k: v for k, v in patch.items() if k in columns}
assignments = ",".join(f"{k}=?" for k in available)
db.execute(f"UPDATE auctions SET {assignments} WHERE id=?", (*available.values(), auction_id))

cur = db.execute(
    """INSERT INTO vehicles(
      auction_id,seller_user,seller_username,vin,chassis_number,registration_number,
      make,model,variant,model_year,engine_number,engine_displacement_cc,
      fuel_type,transmission,drivetrain,odometer_km,location_city,location_country,
      ownership_status,customs_status,requested_duration_hours,declaration_accepted_at,
      lifecycle,tengasell_grade,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
    (
        auction_id,seller_user,seller_username,
        "AHTBA3CD1N1234567","AHT-HILUX-R1-2022","AFJ 2210",
        "Toyota","Hilux","2.8 GD-6 Raider",2022,"1GD-R1-2022",2755,
        "DIESEL","AUTOMATIC","4WD",43820,"Harare","Zimbabwe",
        "DECLARED_OWNER","LOCAL",72,now,"ELIGIBLE","A",now,now,
    ),
)
vehicle_id = cur.lastrowid

for document_type, ref in (("OWNERSHIP","OWN-LR01-R1"),("REGISTRATION","REG-LR01-R1")):
    db.execute(
        """INSERT INTO vehicle_documents(
          vehicle_id,document_type,document_ref,issuer,issued_at,expires_at,storage_ref,
          status,uploaded_by,verified_by,verified_at,rejection_reason,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            vehicle_id,document_type,ref,"LR01-R1 Disposable UAT","2026-10-01T00:00:00Z",
            None,f"uat://{ref}","VERIFIED",seller_user,admin[0],now,None,now,now,
        ),
    )

inspection = db.execute(
    """INSERT INTO vehicle_inspections(
      vehicle_id,version,inspector_user,inspector_name,reviewer_user,reviewer_name,
      lifecycle,odometer_km,roadworthy,notes,grade_score,grade,submitted_at,reviewed_at,
      created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
    (
        vehicle_id,1,admin[0],"Tengasell UAT Inspector",admin[0],"Tengasell UAT Reviewer",
        "REVIEWED",43820,1,"Synthetic disposable visual-UAT inspection. No production record.",
        92,"A",now,now,now,now,
    ),
)
inspection_id = inspection.lastrowid

db.execute(
    """INSERT INTO vehicle_inspection_findings(
      inspection_id,category,component,location,severity,description,
      repair_recommended,safety_critical,evidence_document_id,created_by,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
    (
        inspection_id,"BODY","Right rear door","Exterior","MINOR",
        "Light cosmetic scratch; no structural impact.",0,0,None,admin[0],now,
    ),
)

eligibility = db.execute(
    """INSERT INTO vehicle_eligibility(
      vehicle_id,inspection_id,version,status,decided_by,decided_at,created_at
    ) VALUES(?,?,?,?,?,?,?)""",
    (vehicle_id,inspection_id,1,"ELIGIBLE",admin[0],now,now),
)
eligibility_id = eligibility.lastrowid

for field, value in (
    ("vin", '"AHTBA3CD1N1234567"'),
    ("make", '"Toyota"'),
    ("model", '"Hilux"'),
    ("odometer_km", "43820"),
):
    db.execute(
        """INSERT INTO vehicle_evidence(
          vehicle_id,field_key,source_type,source_id,value_json,asserted_by,verified_by,verified_at,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?)""",
        (vehicle_id,field,"REVIEW",inspection_id,value,admin[0],admin[0],now,now),
    )

# U9 requires a current ELIGIBLE verdict before a whole vehicle may become live.
db.execute("UPDATE auctions SET status='live',updated_at=? WHERE id=?", (now, auction_id))
db.commit()

result = {
    "auctionId": auction_id,
    "vehicleId": vehicle_id,
    "inspectionId": inspection_id,
    "eligibilityId": eligibility_id,
    "sellerUsername": seller_username,
    "adminUsername": admin[1],
    "ordinaryUsername": ordinary[1],
    "database": str(db_path),
}
print(json.dumps(result, sort_keys=True))
db.close()
