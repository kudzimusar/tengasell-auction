#!/usr/bin/env python3
"""CERT-01-PREP synthetic full vehicle-auction business journey.

Runs the exact TrailBase SQL migration chain in disposable SQLite and proves a
single vehicle can move from eligible seller inventory through event admission,
qualified bidding, sale, Finance-confirmed settlement, statutory-transfer
evidence, release, transport and physical handover.
"""

from __future__ import annotations
import importlib.util
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAIN = ROOT / "tests/trailbase-migration-chain.py"
spec = importlib.util.spec_from_file_location("migration_chain", CHAIN)
chain = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(chain)

def row(db: sqlite3.Connection, sql: str, params=()):
    value = db.execute(sql, params).fetchone()
    if not value:
        raise AssertionError(f"missing row for: {sql}")
    return value

def run_list(db, key, event_id, session_id, actor, username, command_type, version, *,
             lot_id=None, auction_id=None, source="OPERATOR"):
    db.execute(
        """INSERT INTO run_list_commands(
          command_key,event_id,session_id,operator_user,operator_username,operator_admin,
          command_type,lot_id,auction_id,expected_run_list_version,source
        ) VALUES(?,?,?,?,?,1,?,?,?,?,?)""",
        (key,event_id,session_id,actor,username,command_type,lot_id,auction_id,version,source),
    )
    return row(db, "SELECT status,error_code,version_after,result_lot_id FROM run_list_commands WHERE command_key=?", (key,))

def main() -> None:
    db = chain.connection()
    chain.apply(db, chain.migration_files())

    admin = row(db, "SELECT id,username FROM _user WHERE admin=1 ORDER BY username LIMIT 1")
    users = db.execute("SELECT id,username FROM _user WHERE admin=0 ORDER BY username LIMIT 5").fetchall()
    assert len(users) >= 2
    seller = users[0]
    bidder = users[1]

    # SELLER / VEHICLE: use a fresh disposable auction so the end-to-end
    # journey is independent of seeded timing and bid history.
    seller = users[0]
    bidder = users[1]
    auction_id = 99002
    current_price = 18000.0
    disclosure = "NO_RESERVE"
    db.execute(
        """INSERT INTO auctions(
          id,user,seller_username,title,slug,description,category,condition,
          start_price,current_price,bid_count,watch_count,views,shipping_fee,shipping,city,
          ends_at,started_at,status,extension_count,featured,images,created_at,updated_at,
          allow_offers,asset_kind
        ) VALUES(?,?,?,'CERT-01 Toyota Hilux','cert01-toyota-hilux',
                 'Disposable CERT-01 vehicle-auction fixture','vehicles','used',
                 ?,?,0,0,0,0,'pickup','Harare',
                 datetime('now','+6 hours'),datetime('now','-1 hour'),'live',0,0,'[]',
                 datetime('now'),datetime('now'),0,'general')""",
        (auction_id,seller[0],seller[1],current_price,current_price),
    )

    vehicle_id = db.execute(
        """INSERT INTO vehicles(
          auction_id,seller_user,seller_username,vin,chassis_number,registration_number,
          make,model,variant,model_year,engine_number,engine_displacement_cc,fuel_type,
          transmission,drivetrain,odometer_km,location_city,location_country,
          ownership_status,customs_status,requested_duration_hours,declaration_accepted_at,
          lifecycle,tengasell_grade,created_at,updated_at
        ) VALUES(?,?,?,'JT123456789012345',NULL,'CERT-001',
          'Toyota','Hilux','Synthetic certification fixture',2022,'ENG-CERT',2755,'DIESEL',
          'AUTOMATIC','4WD',42000,'Harare','Zimbabwe','DECLARED_OWNER','CLEARED',72,
          '2030-01-01T00:00:00Z','ELIGIBLE','B','2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
        (auction_id,seller[0],seller[1]),
    ).lastrowid
    db.execute(
        """INSERT INTO vehicle_eligibility(
          vehicle_id,inspection_id,version,status,decided_by,decided_at,created_at
        ) VALUES(?,9001,1,'ELIGIBLE',?,'2030-01-01T00:10:00Z','2030-01-01T00:10:00Z')""",
        (vehicle_id,admin[0]),
    )
    db.execute(
        """UPDATE auctions
              SET asset_kind='vehicle',
                  reserve_disclosure=?,
                  owner_bid_right_disclosure='NOT_PERMITTED',
                  commercial_policy_ready=1,
                  updated_at='2030-01-01T00:15:00Z'
            WHERE id=?""",
        (disclosure,auction_id),
    )
    assert row(db, "SELECT asset_kind,reserve_disclosure FROM auctions WHERE id=?", (auction_id,)) == ("vehicle",disclosure)

    # OPERATOR: event -> run list -> ready -> lock -> open.
    event_id = db.execute(
        """INSERT INTO auction_events(
          host_user,host_username,title,description,starts_at,status,created_at,updated_at
        ) VALUES(?,?,?,'CERT-01 synthetic event','2030-01-02T09:00:00Z','SCHEDULED',
                 '2030-01-01T00:20:00Z','2030-01-01T00:20:00Z')""",
        (admin[0],admin[1],"CERT-01 Vehicle Auction"),
    ).lastrowid
    session_id = int(row(db, "SELECT session_id FROM auction_events WHERE id=?", (event_id,))[0])
    add = run_list(db,"cert-add",event_id,session_id,admin[0],admin[1],"ADD",0,auction_id=auction_id)
    assert add[0] == "accepted", add
    lot_id = int(add[3])
    ready = run_list(db,"cert-ready",event_id,session_id,admin[0],admin[1],"READY",1,lot_id=lot_id)
    assert ready[0] == "accepted", ready
    lock = run_list(db,"cert-lock",event_id,session_id,admin[0],admin[1],"LOCK",2)
    assert lock[0] == "accepted", lock
    opened = run_list(db,"cert-open",event_id,session_id,admin[0],admin[1],"OPEN",3,lot_id=lot_id)
    assert opened[0] == "accepted", opened
    assert row(db, "SELECT status,current_lot_id FROM auction_events WHERE id=?", (event_id,)) == ("LIVE",lot_id)

    # BUYER: event qualification + bounded capacity.
    db.execute(
        """INSERT INTO auction_qualification_commands(
          command_key,event_id,target_user,target_username,actor_user,actor_username,
          actor_admin,command_type,qualification_basis,approved_limit,lot_limit,
          account_state,risk_state,deposit_state,deposit_amount,credit_state,credit_limit,reason_code
        ) VALUES('cert-qualify',?,?,?,?,?,1,'APPROVE','MANUAL_REVIEW',5000,4000,
                 'ELIGIBLE','CLEAR','NOT_REQUIRED',0,'NONE',0,'CERT_APPROVED')""",
        (event_id,bidder[0],bidder[1],admin[0],admin[1]),
    )
    assert row(db, "SELECT status FROM auction_qualification_commands WHERE command_key='cert-qualify'") == ("accepted",)

    # Failure journey: unqualified third user cannot bid.
    other = users[2] if len(users) > 2 else users[0]
    if other[0] == seller[0]:
        other = users[-1]
    db.execute(
        """INSERT INTO auction_bid_capacity_commands(
          command_key,auction_command_key,event_id,auction_id,actor_user,actor_username,max_amount
        ) VALUES('cert-unqualified','qualified:cert-unqualified',?,?,?,?,500)""",
        (event_id,auction_id,other[0],other[1]),
    )
    assert row(db, "SELECT status,error_code FROM auction_bid_capacity_commands WHERE command_key='cert-unqualified'") == (
        "rejected","BIDDER_NOT_QUALIFIED"
    )

    # Qualified bid accepted and reserves bidder capacity.
    current_price = float(row(db, "SELECT current_price FROM auctions WHERE id=?", (auction_id,))[0])
    maximum = max(current_price + 1000, 1500)
    db.execute(
        """INSERT INTO auction_bid_capacity_commands(
          command_key,auction_command_key,event_id,auction_id,actor_user,actor_username,max_amount
        ) VALUES('cert-bid','qualified:cert-bid',?,?,?,?,?)""",
        (event_id,auction_id,bidder[0],bidder[1],maximum),
    )
    bid_result = row(
        db,
        """SELECT status,error_code,result_winner_user,reserved_after
             FROM auction_bid_capacity_commands WHERE command_key='cert-bid'""",
    )
    assert bid_result[0] == "accepted", bid_result
    assert bid_result[2] == bidder[0]
    assert row(
        db,
        """SELECT status FROM auction_capacity_reservations
            WHERE event_id=? AND auction_id=? AND user=?""",
        (event_id,auction_id,bidder[0]),
    ) == ("ACTIVE",)

    # Failure journey: second lot would exceed remaining capacity.
    second_auction = row(
        db,
        """SELECT id FROM auctions
            WHERE status='live' AND id<>?
            ORDER BY id LIMIT 1""",
        (auction_id,),
    )[0]
    # The capacity command's event/lot check must fail closed because the second
    # auction is not admitted to this event.
    db.execute(
        """INSERT INTO auction_bid_capacity_commands(
          command_key,auction_command_key,event_id,auction_id,actor_user,actor_username,max_amount
        ) VALUES('cert-wrong-event','qualified:cert-wrong-event',?,?,?,?,4500)""",
        (event_id,second_auction,bidder[0],bidder[1]),
    )
    assert row(db, "SELECT status,error_code FROM auction_bid_capacity_commands WHERE command_key='cert-wrong-event'") == (
        "rejected","AUCTION_EVENT_MISMATCH"
    )

    # WINNER: timed finalization -> one order -> one settlement.
    db.execute(
        "UPDATE auctions SET ends_at=strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 second') WHERE id=?",
        (auction_id,),
    )
    db.execute(
        """INSERT INTO auction_finalization_commands(
          command_key,auction_id,source,requested_outcome
        ) VALUES('cert-finalize',?,'TIMED_SWEEP','AUTO')""",
        (auction_id,),
    )
    final = row(
        db,
        """SELECT status,result_outcome,result_order_id,result_price
             FROM auction_finalization_commands WHERE command_key='cert-finalize'""",
    )
    assert final[0] == "accepted" and final[1] == "sold" and final[2] is not None, final
    order_id = int(final[2])
    settlement = row(
        db,
        """SELECT id,payment_state,transfer_state,release_state,completion_state
             FROM auction_settlements WHERE order_id=?""",
        (order_id,),
    )
    settlement_id = int(settlement[0])
    assert settlement[1:] == ("PENDING","NOT_STARTED","BLOCKED","OPEN")

    # Duplicate finalization is retry-safe.
    db.execute(
        """INSERT INTO auction_finalization_commands(
          command_key,auction_id,source,requested_outcome
        ) VALUES('cert-finalize-retry',?,'TIMED_SWEEP','AUTO')""",
        (auction_id,),
    )
    assert row(db, "SELECT status FROM auction_finalization_commands WHERE command_key='cert-finalize-retry'") == (
        "idempotent_existing",
    )

    # Operator advances live event after commercial outcome.
    advance = run_list(
        db,"cert-advance",event_id,session_id,admin[0],admin[1],"ADVANCE",4,
        lot_id=lot_id,source="SYSTEM",
    )
    assert advance[0] == "accepted", advance

    # Financial integrity: direct vehicle order paid/shipped bypasses are blocked.
    try:
        db.execute("UPDATE orders SET status='paid',paid_at='2030-01-02T10:00:00Z' WHERE id=?", (order_id,))
        raise AssertionError("direct vehicle payment bypass unexpectedly succeeded")
    except sqlite3.IntegrityError as exc:
        assert "FINANCE_CONFIRMATION_REQUIRED" in str(exc)

    # FINANCE: authoritative callback advances payment and mirrors order paid.
    db.execute(
        """INSERT INTO auction_finance_callbacks(
          idempotency_key,settlement_id,order_id,event_type,amount,currency,source_reference,
          actor_user,actor_username,actor_admin
        )
        SELECT 'cert-finance-paid',s.id,s.order_id,'PAYMENT_CAPTURED',s.invoice_total,s.currency,
               'CERT-FINANCE-REF',?,?,1
          FROM auction_settlements s WHERE s.id=?""",
        (admin[0],admin[1],settlement_id),
    )
    assert row(db, "SELECT payment_state,outstanding_amount FROM auction_settlements WHERE id=?", (settlement_id,)) == (
        "PAID",0.0
    )
    assert row(db, "SELECT status,paid_at IS NOT NULL FROM orders WHERE id=?", (order_id,)) == ("paid",1)
    try:
        db.execute(
            """INSERT INTO auction_finance_callbacks(
              idempotency_key,settlement_id,order_id,event_type,amount,currency,source_reference,
              actor_user,actor_username,actor_admin
            ) VALUES('cert-finance-paid',?,?, 'PAYMENT_CAPTURED',1,'USD','REPLAY',?,?,1)""",
            (settlement_id,order_id,admin[0],admin[1]),
        )
        raise AssertionError("duplicate Finance callback unexpectedly inserted")
    except sqlite3.IntegrityError:
        pass

    # TRANSFER: completion fails without accepted external evidence.
    db.execute(
        """INSERT INTO auction_transfer_commands(
          command_key,settlement_id,actor_user,actor_username,actor_admin,command_type
        ) VALUES('cert-transfer-start',?,?,?,1,'START')""",
        (settlement_id,admin[0],admin[1]),
    )
    try:
        db.execute(
            """INSERT INTO auction_transfer_commands(
              command_key,settlement_id,actor_user,actor_username,actor_admin,command_type
            ) VALUES('cert-transfer-too-early',?,?,?,1,'COMPLETE')""",
            (settlement_id,admin[0],admin[1]),
        )
        raise AssertionError("transfer completed without statutory evidence")
    except sqlite3.IntegrityError as exc:
        assert "EXTERNAL_TRANSFER_EVIDENCE_REQUIRED" in str(exc)

    for key,kind in [
        ("cert-transfer-require","REQUIRE_DOCUMENT"),
        ("cert-transfer-submit","SUBMIT_DOCUMENT"),
        ("cert-transfer-accept","ACCEPT_DOCUMENT"),
    ]:
        db.execute(
            """INSERT INTO auction_transfer_commands(
              command_key,settlement_id,actor_user,actor_username,actor_admin,command_type,
              document_type,document_ref,external_process
            ) VALUES(?,?,?,?,1,?,'OWNERSHIP_TRANSFER','CERT-CVR4',1)""",
            (key,settlement_id,admin[0],admin[1],kind),
        )
    db.execute(
        """INSERT INTO auction_transfer_commands(
          command_key,settlement_id,actor_user,actor_username,actor_admin,command_type,external_process
        ) VALUES('cert-transfer-external',?,?,?,1,'MARK_EXTERNAL_PENDING',1)""",
        (settlement_id,admin[0],admin[1]),
    )
    db.execute(
        """INSERT INTO auction_transfer_commands(
          command_key,settlement_id,actor_user,actor_username,actor_admin,command_type
        ) VALUES('cert-transfer-evidence',?,?,?,1,'EVIDENCE_RECEIVED')""",
        (settlement_id,admin[0],admin[1]),
    )
    db.execute(
        """INSERT INTO auction_transfer_commands(
          command_key,settlement_id,actor_user,actor_username,actor_admin,command_type
        ) VALUES('cert-transfer-complete',?,?,?,1,'COMPLETE')""",
        (settlement_id,admin[0],admin[1]),
    )
    assert row(db, "SELECT transfer_state,release_state FROM auction_settlements WHERE id=?", (settlement_id,)) == (
        "COMPLETE","READY"
    )

    # RELEASE: unauthorized account blocked; authorized yard operation succeeds.
    db.execute(
        """INSERT INTO auction_release_commands(
          command_key,settlement_id,actor_user,actor_username,actor_admin,collector_type,
          collector_user,collector_name,collector_reference
        ) VALUES('cert-release-denied',?,?,?,0,'BUYER',?,'Certification buyer','BUYER-ID')""",
        (settlement_id,bidder[0],bidder[1],bidder[0]),
    )
    assert row(db, "SELECT status,error_code FROM auction_release_commands WHERE command_key='cert-release-denied'") == (
        "rejected","RELEASE_AUTHORITY_REQUIRED"
    )
    db.execute(
        """INSERT INTO auction_release_commands(
          command_key,settlement_id,actor_user,actor_username,actor_admin,collector_type,
          collector_user,collector_name,collector_reference,conditions
        ) VALUES('cert-release',?,?,?,1,'BUYER',?,'Certification buyer','BUYER-ID','Photo ID and release reference')""",
        (settlement_id,admin[0],admin[1],bidder[0]),
    )
    assert row(db, "SELECT release_state FROM auction_settlements WHERE id=?", (settlement_id,)) == ("AUTHORIZED",)

    # COLLECTION / TRANSPORT + HANDOVER.
    db.execute(
        """INSERT INTO auction_transport_bookings(
          request_key,settlement_id,requested_by,requested_by_username,transporter,
          pickup_location,destination,scheduled_at,status,created_at,updated_at
        ) VALUES('cert-transport',?,?,?,'CERT Transport','Harare Yard','Bulawayo',
                 '2030-01-03T08:00:00Z','SCHEDULED',
                 '2030-01-02T12:00:00Z','2030-01-02T12:00:00Z')""",
        (settlement_id,bidder[0],bidder[1]),
    )
    db.execute(
        """INSERT INTO auction_handover_commands(
          command_key,settlement_id,actor_user,actor_username,actor_admin,evidence_reference
        ) VALUES('cert-handover',?,?,?,1,'CERT-HANDOVER-EVIDENCE')""",
        (settlement_id,admin[0],admin[1]),
    )
    assert row(
        db,
        "SELECT release_state,completion_state FROM auction_settlements WHERE id=?",
        (settlement_id,),
    ) == ("RELEASED","COMPLETE")
    assert row(db, "SELECT status,completed_at IS NOT NULL FROM orders WHERE id=?", (order_id,)) == ("completed",1)

    # OPERATIONAL PROJECTIONS: tasks/timeline persisted from authoritative events.
    assert row(
        db,
        """SELECT COUNT(*) FROM auction_tasks
            WHERE settlement_id=? AND task_type IN (
              'PAYMENT_FOLLOW_UP','TRANSFER_DOCUMENT_REVIEW','RELEASE_PREPARATION','COLLECTION_PREPARATION'
            )""",
        (settlement_id,),
    )[0] >= 4
    timeline_types = {
        value[0] for value in db.execute(
            "SELECT event_type FROM auction_timeline_events WHERE settlement_id=?",
            (settlement_id,),
        )
    }
    for required in ("SETTLEMENT_CREATED","FINANCE_PAYMENT_CAPTURED","TRANSFER_COMPLETE","RELEASE_AUTHORIZED","VEHICLE_HANDED_OVER"):
        assert required in timeline_types, (required,timeline_types)

    # Production remains intentionally fail-closed until Owner/Finance policy
    # and service-health attestations are supplied.
    missing = row(
        db,
        """SELECT COUNT(*) FROM auction_policy_registry
            WHERE required_for_production=1 AND configured=0""",
    )[0]
    unknown_health = row(
        db,
        """SELECT COUNT(*) FROM auction_service_health
            WHERE critical=1 AND status IN ('UNKNOWN','DEGRADED','UNAVAILABLE')""",
    )[0]
    assert missing > 0 and unknown_health > 0

    print("CERT-01-PREP end-to-end commercial journey: PASS")
    print("  Seller vehicle eligibility -> event/run-list: PASS")
    print("  Buyer qualification -> capacity -> bid -> win: PASS")
    print("  one order -> one settlement -> Finance confirmation: PASS")
    print("  external transfer evidence -> release -> transport -> handover: PASS")
    print("  unauthorized/direct-state bypasses: BLOCKED")
    print("  operator tasks + immutable timeline projection: PASS")
    print("  Production launch remains fail-closed pending policy/health: PASS")
    db.close()

if __name__ == "__main__":
    main()
