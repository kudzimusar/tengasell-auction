#!/usr/bin/env python3
"""IMP-07 auction settlement, transfer, release and transport proof."""

from __future__ import annotations
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
M7 = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000007__auction_core.sql"
M10 = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000010__auction_events_run_list.sql"
M11 = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000011__bidder_qualification_capacity.sql"
M12 = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000012__settlement_transfer_release_transport.sql"

def iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def install(db: sqlite3.Connection) -> None:
    db.executescript("""
    PRAGMA foreign_keys=OFF;
    CREATE TABLE _user(id BLOB PRIMARY KEY,username TEXT UNIQUE,admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE audit_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT,action TEXT,entity TEXT,
      entity_id INTEGER,source TEXT,payload TEXT,created_at TEXT
    ) STRICT;
    CREATE TABLE auctions(
      id INTEGER PRIMARY KEY,user BLOB NOT NULL,seller_username TEXT NOT NULL,title TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'vehicles',
      condition TEXT NOT NULL DEFAULT 'used',start_price REAL NOT NULL,current_price REAL NOT NULL,buy_now_price REAL,
      reserve_price REAL,bid_count INTEGER NOT NULL DEFAULT 0,watch_count INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,shipping_fee REAL NOT NULL DEFAULT 0,shipping TEXT NOT NULL DEFAULT 'courier',
      city TEXT NOT NULL DEFAULT 'Harare',ends_at TEXT NOT NULL,started_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'live',
      extension_count INTEGER NOT NULL DEFAULT 0,featured INTEGER NOT NULL DEFAULT 0,images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,allow_offers INTEGER NOT NULL DEFAULT 0,offer_min REAL,
      live_session_id INTEGER,asset_kind TEXT NOT NULL DEFAULT 'vehicle'
    ) STRICT;
    CREATE TABLE bids(
      id INTEGER PRIMARY KEY,auction_id INTEGER NOT NULL,user BLOB NOT NULL,bidder_username TEXT NOT NULL,
      amount REAL NOT NULL,max_amount REAL NOT NULL,is_auto INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,retracted_at TEXT,retraction_reason TEXT
    ) STRICT;
    CREATE TABLE orders(
      id INTEGER PRIMARY KEY AUTOINCREMENT,auction_id INTEGER NOT NULL,auction_title TEXT NOT NULL DEFAULT '',
      buyer_user BLOB NOT NULL,seller_user BLOB NOT NULL,buyer_username TEXT NOT NULL DEFAULT '',
      seller_username TEXT NOT NULL DEFAULT '',final_price REAL NOT NULL,status TEXT NOT NULL DEFAULT 'pending_payment',
      pay_by TEXT,paid_at TEXT,shipped_at TEXT,delivered_at TEXT,completed_at TEXT,carrier TEXT,tracking TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,address TEXT
    ) STRICT;
    CREATE TABLE live_sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,host_user BLOB NOT NULL,host_username TEXT NOT NULL,title TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',current_lot_id INTEGER,
      lot_index INTEGER NOT NULL DEFAULT 0,close_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE vehicles(id INTEGER PRIMARY KEY,auction_id INTEGER UNIQUE,seller_user BLOB);
    CREATE TABLE vehicle_eligibility(id INTEGER PRIMARY KEY,vehicle_id INTEGER,version INTEGER,status TEXT);
    """)
    for migration in (M7,M10,M11,M12):
        db.executescript(migration.read_text())
    db.executemany("INSERT INTO _user(id,username,admin) VALUES(?,?,?)",[
        (b"admin","admin",1),(b"buyer","buyer",0),(b"seller","seller",0),(b"other","other",0)
    ])

def seed_canonical_order(db: sqlite3.Connection) -> tuple[int,int]:
    now=iso()
    db.execute("""INSERT INTO auctions(
      id,user,seller_username,title,start_price,current_price,ends_at,started_at,status,
      created_at,updated_at,asset_kind,auction_outcome_key
    ) VALUES(900,?,'seller','Synthetic Hilux',100,250,'2030-01-01T00:00:00Z',?,'sold',?,?,'vehicle',NULL)""",
      (b"seller",now,now,now)) if False else None
    # auction_outcome_key belongs to orders, not auctions.
    db.execute("""INSERT INTO auctions(
      id,user,seller_username,title,start_price,current_price,ends_at,started_at,status,
      created_at,updated_at,asset_kind
    ) VALUES(900,?,'seller','Synthetic Hilux',100,250,'2030-01-01T00:00:00Z',?,'sold',?,?,'vehicle')""",
      (b"seller",now,now,now))
    db.execute("INSERT INTO vehicles(id,auction_id,seller_user) VALUES(90,900,?)",(b"seller",))
    event=db.execute("""INSERT INTO auction_events(
      host_user,host_username,title,description,starts_at,status,created_at,updated_at
    ) VALUES(?,?,?,'','2030-01-01T00:00:00Z','CLOSED',?,?)""",(b"admin","admin","Settlement Event",now,now)).lastrowid
    session=db.execute("SELECT session_id FROM auction_events WHERE id=?",(event,)).fetchone()[0]
    db.execute("""INSERT INTO auction_lots(
      event_id,session_id,auction_id,sequence_no,status,original_ends_at,created_by,created_at,updated_at
    ) VALUES(?,?,900,1,'SOLD','2030-01-01T00:00:00Z',?,?,?)""",(event,session,b"admin",now,now))
    order=db.execute("""INSERT INTO orders(
      auction_id,auction_title,buyer_user,seller_user,buyer_username,seller_username,
      final_price,status,pay_by,created_at,updated_at,auction_outcome_key
    ) VALUES(900,'Synthetic Hilux',?,?,'buyer','seller',250,'pending_payment',
             '2030-01-03T00:00:00Z',?,?, 'auction:900')""",(b"buyer",b"seller",now,now)).lastrowid
    settlement=db.execute("SELECT id FROM auction_settlements WHERE order_id=?",(order,)).fetchone()
    assert settlement, "canonical order did not create settlement"
    return int(order),int(settlement[0])

def finance(db,key,sid,order,event_type,amount=None,actor=b"admin",name="admin",admin=1,payout=None):
    db.execute("""INSERT INTO auction_finance_callbacks(
      idempotency_key,settlement_id,order_id,event_type,amount,currency,source_reference,payout_state,
      actor_user,actor_username,actor_admin
    ) VALUES(?,?,?,?,?,'USD',?,?, ?,?,?)""",
      (key,sid,order,event_type,amount,"FIN-REF",payout,actor,name,admin))
    return db.execute("SELECT status,error_code FROM auction_finance_callbacks WHERE idempotency_key=?",(key,)).fetchone()

def transfer(db,key,sid,kind,doc=None,ref=None,actor=b"admin",name="admin",admin=1,external=0,reason=None):
    db.execute("""INSERT INTO auction_transfer_commands(
      command_key,settlement_id,actor_user,actor_username,actor_admin,command_type,
      document_type,document_ref,external_process,reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?)""",(key,sid,actor,name,admin,kind,doc,ref,external,reason))
    return db.execute("SELECT status,error_code FROM auction_transfer_commands WHERE command_key=?",(key,)).fetchone()

def release(db,key,sid,actor=b"admin",name="admin",admin=1,collector="buyer",kind="BUYER"):
    db.execute("""INSERT INTO auction_release_commands(
      command_key,settlement_id,actor_user,actor_username,actor_admin,collector_type,
      collector_user,collector_name,collector_reference,conditions
    ) VALUES(?,?,?,?,?,?,?,?,?,?)""",(key,sid,actor,name,admin,kind,b"buyer",collector,"ID-REF","Photo ID required"))
    return db.execute("SELECT status,error_code,result_authorization_id FROM auction_release_commands WHERE command_key=?",(key,)).fetchone()

def main() -> None:
    db=sqlite3.connect(":memory:")
    install(db)
    order,sid=seed_canonical_order(db)

    # Exactly one settlement + one hammer invoice line + one Finance bridge event.
    assert db.execute("SELECT COUNT(*) FROM auction_settlements WHERE order_id=?",(order,)).fetchone()[0] == 1
    assert db.execute("SELECT line_key,amount FROM auction_invoice_lines WHERE settlement_id=?",(sid,)).fetchall() == [("HAMMER",250.0)]
    assert db.execute("SELECT COUNT(*) FROM auction_finance_bridge_outbox WHERE settlement_id=?",(sid,)).fetchone()[0] == 1

    # Unpaid release fails closed, and ordinary accounts cannot self-authorize.
    unpaid=release(db,"release-unpaid",sid)
    assert unpaid[:2] == ("rejected","PAYMENT_NOT_SETTLED"), unpaid
    unauthorized=release(db,"release-ordinary",sid,actor=b"buyer",name="buyer",admin=0)
    assert unauthorized[:2] == ("rejected","RELEASE_AUTHORITY_REQUIRED"), unauthorized

    # Finance callback authority is server/admin only in IMP-07.
    bad_fin=finance(db,"fin-ordinary",sid,order,"PAYMENT_CAPTURED",250,actor=b"buyer",name="buyer",admin=0)
    assert bad_fin == ("rejected","FINANCE_AUTHORITY_REQUIRED"), bad_fin
    partial=finance(db,"fin-partial",sid,order,"PAYMENT_CAPTURED",100)
    assert partial[0] == "accepted"
    assert db.execute("SELECT payment_state,paid_amount,outstanding_amount FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("PARTIALLY_PAID",100.0,150.0)
    full=finance(db,"fin-final",sid,order,"PAYMENT_CAPTURED",150)
    assert full[0] == "accepted"
    assert db.execute("SELECT payment_state,paid_amount,outstanding_amount FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("PAID",250.0,0.0)
    assert db.execute("SELECT status,paid_at IS NOT NULL FROM orders WHERE id=?",(order,)).fetchone() == ("paid",1)

    # Callback idempotency key protects against provider replay.
    try:
        finance(db,"fin-final",sid,order,"PAYMENT_CAPTURED",150)
        raise AssertionError("duplicate finance callback unexpectedly inserted")
    except sqlite3.IntegrityError:
        pass
    assert db.execute("SELECT paid_amount FROM auction_settlements WHERE id=?",(sid,)).fetchone() == (250.0,)

    # Paid is insufficient: legal/statutory transfer remains a separate process.
    paid_early=release(db,"release-before-transfer",sid)
    assert paid_early[:2] == ("rejected","TRANSFER_NOT_COMPLETE"), paid_early
    assert transfer(db,"t-start",sid,"START")[0] == "accepted"
    assert transfer(db,"t-require",sid,"REQUIRE_DOCUMENT","OWNERSHIP_TRANSFER","CVR4-REF",external=1)[0] == "accepted"
    assert transfer(db,"t-submit",sid,"SUBMIT_DOCUMENT","OWNERSHIP_TRANSFER","CVR4-REF",external=1)[0] == "accepted"
    assert transfer(db,"t-accept",sid,"ACCEPT_DOCUMENT","OWNERSHIP_TRANSFER","CVR4-REF",external=1)[0] == "accepted"
    assert transfer(db,"t-external",sid,"MARK_EXTERNAL_PENDING",external=1)[0] == "accepted"
    assert db.execute("SELECT transfer_state FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("EXTERNAL_TRANSFER_PENDING",)
    assert transfer(db,"t-evidence",sid,"EVIDENCE_RECEIVED")[0] == "accepted"
    assert transfer(db,"t-complete",sid,"COMPLETE")[0] == "accepted"
    assert db.execute("SELECT transfer_state,release_state FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("COMPLETE","READY")

    # Dispute blocks release even after full payment + completed transfer.
    assert finance(db,"fin-dispute",sid,order,"DISPUTE_OPENED")[0] == "accepted"
    disputed=release(db,"release-disputed",sid)
    assert disputed[:2] == ("rejected","ACTIVE_DISPUTE"), disputed
    assert finance(db,"fin-dispute-resolve",sid,order,"DISPUTE_RESOLVED")[0] == "accepted"

    # Release authorization is explicit and durable. Duplicate command key cannot duplicate it.
    good=release(db,"release-good",sid,collector="Authorized buyer")
    assert good[0] == "accepted", good
    auth_id=good[2]
    assert db.execute("SELECT status,collector_type FROM auction_release_authorizations WHERE id=?",(auth_id,)).fetchone() == ("AUTHORIZED","BUYER")
    try:
        release(db,"release-good",sid,collector="Authorized buyer")
        raise AssertionError("duplicate release command unexpectedly inserted")
    except sqlite3.IntegrityError:
        pass
    assert db.execute("SELECT COUNT(*) FROM auction_release_authorizations WHERE settlement_id=?",(sid,)).fetchone()[0] == 1

    # Buyer-requested transport is a logistics record, not a second marketplace.
    db.execute("""INSERT INTO auction_transport_bookings(
      request_key,settlement_id,requested_by,requested_by_username,transporter,transporter_reference,
      pickup_location,destination,scheduled_at,status,created_at,updated_at
    ) VALUES('transport-1',?,?,?,?,?,?,?,'2030-01-04T08:00:00Z','SCHEDULED',?,?)""",
      (sid,b"buyer","buyer","Synthetic Carrier","CARRIER-REF","Harare Yard","Bulawayo",iso(),iso()))
    booking=db.execute("SELECT id FROM auction_transport_bookings WHERE request_key='transport-1'").fetchone()[0]
    assert db.execute("SELECT transport_state FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("SCHEDULED",)
    db.execute("UPDATE auction_transport_bookings SET status='PICKED_UP',updated_at=? WHERE id=?",(iso(),booking))
    assert db.execute("SELECT transport_state FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("PICKED_UP",)

    # Handover requires release authority; records evidence and completes transaction.
    db.execute("""INSERT INTO auction_handover_commands(
      command_key,settlement_id,actor_user,actor_username,actor_admin,evidence_reference
    ) VALUES('handover-1',?,?, 'admin',1,'HANDOVER-EVIDENCE-001')""",(sid,b"admin"))
    hand=db.execute("SELECT status,error_code,result_handover_id FROM auction_handover_commands WHERE command_key='handover-1'").fetchone()
    assert hand[0] == "accepted", hand
    assert db.execute("SELECT release_state,completion_state,transport_state FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("RELEASED","COMPLETE","DELIVERED")
    assert db.execute("SELECT status FROM auction_release_authorizations WHERE settlement_id=?",(sid,)).fetchone() == ("USED",)
    assert db.execute("SELECT evidence_reference FROM auction_handovers WHERE settlement_id=?",(sid,)).fetchone() == ("HANDOVER-EVIDENCE-001",)

    # Seller payout remains a Finance-owned mirrored state, not an auction ledger entry.
    assert finance(db,"fin-payout",sid,order,"SELLER_PAYOUT_STATUS",payout="PAID")[0] == "accepted"
    assert db.execute("SELECT seller_payout_state FROM auction_settlements WHERE id=?",(sid,)).fetchone() == ("PAID",)

    print("IMP-07 settlement + transfer + release + transport: PASS")
    print("  canonical order -> one settlement/invoice/Finance bridge: PASS")
    print("  payment authority + partial/full + callback replay safety: PASS")
    print("  unpaid / transfer-incomplete / dispute release gates: PASS")
    print("  unauthorized release=BLOCKED authorized release=PASS")
    print("  statutory transfer remains external-evidence-capable: PASS")
    print("  transport lifecycle + durable handover + seller payout mirror: PASS")
    db.close()

if __name__ == "__main__":
    main()
