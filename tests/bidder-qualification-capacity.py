#!/usr/bin/env python3
"""IMP-06 bidder qualification + transactional capacity proof."""

from __future__ import annotations
import concurrent.futures
import os
import sqlite3
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
M7 = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000007__auction_core.sql"
M10 = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000010__auction_events_run_list.sql"
M11 = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000011__bidder_qualification_capacity.sql"

def iso(hours: int = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

def connect(path: str | None = None) -> sqlite3.Connection:
    db = sqlite3.connect(path or ":memory:", timeout=15, isolation_level=None)
    db.execute("PRAGMA busy_timeout=15000")
    if path:
        db.execute("PRAGMA journal_mode=WAL")
    return db

def install(db: sqlite3.Connection) -> None:
    db.executescript("""
    PRAGMA foreign_keys=OFF;
    CREATE TABLE _user(id BLOB PRIMARY KEY, username TEXT UNIQUE, admin INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE audit_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT,action TEXT,entity TEXT,
      entity_id INTEGER,source TEXT,payload TEXT,created_at TEXT
    ) STRICT;
    CREATE TABLE auctions(
      id INTEGER PRIMARY KEY,user BLOB NOT NULL,seller_username TEXT NOT NULL,title TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'vehicles',
      condition TEXT NOT NULL DEFAULT 'used',start_price REAL NOT NULL,current_price REAL NOT NULL,
      buy_now_price REAL,reserve_price REAL,bid_count INTEGER NOT NULL DEFAULT 0,watch_count INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,shipping_fee REAL NOT NULL DEFAULT 0,shipping TEXT NOT NULL DEFAULT 'courier',
      city TEXT NOT NULL DEFAULT 'Harare',ends_at TEXT NOT NULL,started_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'live',
      extension_count INTEGER NOT NULL DEFAULT 0,featured INTEGER NOT NULL DEFAULT 0,images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,allow_offers INTEGER NOT NULL DEFAULT 0,offer_min REAL,
      live_session_id INTEGER,asset_kind TEXT NOT NULL DEFAULT 'general'
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
    db.executescript(M7.read_text())
    db.executescript(M10.read_text())
    db.executescript(M11.read_text())
    db.executemany("INSERT INTO _user(id,username,admin) VALUES(?,?,?)", [
        (b"admin","admin",1),(b"A","bidderA",0),(b"B","bidderB",0),(b"C","bidderC",0),(b"seller","seller",0)
    ])

def auction(db: sqlite3.Connection, auction_id: int) -> None:
    now=iso()
    db.execute("""INSERT INTO auctions(
      id,user,seller_username,title,start_price,current_price,ends_at,started_at,status,created_at,updated_at,asset_kind
    ) VALUES(?,?,?,?,100,100,?,?,'live',?,?,'general')""",
    (auction_id,b"seller","seller",f"Lot {auction_id}",iso(24),now,now,now))

def event(db: sqlite3.Connection, title: str, lot_ids: list[int]) -> tuple[int,int]:
    cur=db.execute("""INSERT INTO auction_events(
      host_user,host_username,title,description,starts_at,status,created_at,updated_at
    ) VALUES(?,?,?,'',?,'SCHEDULED',?,?)""",(b"admin","admin",title,iso(1),iso(),iso()))
    eid=int(cur.lastrowid)
    sid=int(db.execute("SELECT session_id FROM auction_events WHERE id=?",(eid,)).fetchone()[0])
    for seq,aid in enumerate(lot_ids,1):
        db.execute("""INSERT INTO auction_lots(
          event_id,session_id,auction_id,sequence_no,status,original_ends_at,created_by,created_at,updated_at
        ) VALUES(?,?,?,?, 'READY', ?,?,?,?)""",
        (eid,sid,aid,seq,db.execute("SELECT ends_at FROM auctions WHERE id=?",(aid,)).fetchone()[0],b"admin",iso(),iso()))
    return eid,sid

def qualification_command(db,key,eid,target,name,actor=b"admin",actor_name="admin",actor_admin=1,kind="APPROVE",limit=500):
    db.execute("""INSERT INTO auction_qualification_commands(
      command_key,event_id,target_user,target_username,actor_user,actor_username,actor_admin,
      command_type,qualification_basis,approved_limit,risk_state,deposit_state,credit_state,reason_code
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
    (key,eid,target,name,actor,actor_name,actor_admin,kind,"MANUAL_REVIEW",limit,"CLEAR","NOT_REQUIRED","NONE","TEST"))
    return db.execute("SELECT status,error_code,result_qualification_id FROM auction_qualification_commands WHERE command_key=?",(key,)).fetchone()

def capacity_bid(db,key,eid,aid,user,name,maximum):
    db.execute("""INSERT INTO auction_bid_capacity_commands(
      command_key,auction_command_key,event_id,auction_id,actor_user,actor_username,max_amount
    ) VALUES(?,?,?,?,?,?,?)""",(key,"qualified:"+key,eid,aid,user,name,maximum))
    return db.execute("""SELECT status,error_code,reserved_before,reserved_after,available_after,
                               result_winner_username,result_price
                          FROM auction_bid_capacity_commands WHERE command_key=?""",(key,)).fetchone()

def main():
    db=connect()
    install(db)
    for aid in (101,102,201,202,301):
        auction(db,aid)
    eid,_=event(db,"Qualification event",[101,102,301])

    # Ordinary user cannot approve; admin can and command keys are durable.
    denied=qualification_command(db,"q-denied",eid,b"C","bidderC",actor=b"A",actor_name="bidderA",actor_admin=0)
    assert denied[:2] == ("rejected","QUALIFICATION_ADMIN_REQUIRED")
    approved=qualification_command(db,"q-a",eid,b"A","bidderA",limit=500)
    assert approved[0] == "accepted"
    qualification_command(db,"q-b",eid,b"B","bidderB",limit=1000)
    try:
        qualification_command(db,"q-a",eid,b"A","bidderA",limit=999)
        raise AssertionError("qualification command idempotency key reused")
    except sqlite3.IntegrityError:
        pass

    # Unqualified user cannot bid.
    unqualified=capacity_bid(db,"c-unqualified",eid,301,b"C","bidderC",200)
    assert unqualified[:2] == ("rejected","BIDDER_NOT_QUALIFIED")

    # Qualified bidder reserves standing maximum.
    first=capacity_bid(db,"c-a-1",eid,101,b"A","bidderA",300)
    assert first[0] == "accepted", first
    assert db.execute("""SELECT reserved_amount,status FROM auction_capacity_reservations
                         WHERE event_id=? AND auction_id=101 AND user=?""",(eid,b"A")).fetchone() == (300.0,"ACTIVE")

    # Higher qualified bid outbids A and immediately releases A capacity.
    second=capacity_bid(db,"c-b-1",eid,101,b"B","bidderB",350)
    assert second[0] == "accepted", second
    assert db.execute("""SELECT status,release_reason FROM auction_capacity_reservations
                         WHERE event_id=? AND auction_id=101 AND user=?""",(eid,b"A")).fetchone() == ("RELEASED","OUTBID")
    assert db.execute("""SELECT reserved_amount,status FROM auction_capacity_reservations
                         WHERE event_id=? AND auction_id=101 AND user=?""",(eid,b"B")).fetchone() == (350.0,"ACTIVE")

    # Released capacity is available on another lot.
    other=capacity_bid(db,"c-a-2",eid,102,b"A","bidderA",450)
    assert other[0] == "accepted", other
    assert other[4] == 50.0, other

    # Suspension releases active capacity and blocks future bidding.
    susp=qualification_command(db,"q-a-suspend",eid,b"A","bidderA",kind="SUSPEND",limit=500)
    assert susp[0] == "accepted"
    assert db.execute("""SELECT status FROM auction_capacity_reservations
                         WHERE event_id=? AND auction_id=102 AND user=?""",(eid,b"A")).fetchone() == ("RELEASED",)
    blocked=capacity_bid(db,"c-a-blocked",eid,301,b"A","bidderA",100)
    assert blocked[:2] == ("rejected","BIDDER_NOT_QUALIFIED")

    # Winner obligation persists after auction outcome instead of vanishing.
    qualification_command(db,"q-a-restore",eid,b"A","bidderA",kind="APPROVE",limit=500)
    won=capacity_bid(db,"c-a-win",eid,301,b"A","bidderA",400)
    assert won[0] == "accepted", won
    db.execute("""INSERT INTO auction_outcomes(
      auction_id,source,outcome,winner_user,winner_username,final_price,order_id,command_id,decided_at
    ) VALUES(301,'MANUAL_HAMMER','sold',?,'bidderA',275,NULL,999,?)""",(b"A",iso()))
    assert db.execute("""SELECT status,reserved_amount FROM auction_capacity_reservations
                         WHERE event_id=? AND auction_id=301 AND user=?""",(eid,b"A")).fetchone() == ("WON_OBLIGATION",275.0)

    db.close()

    # Real cross-lot race: one bidder with US$500 capacity attempts two US$400
    # maxima simultaneously. SQLite transaction serialization must allow only one.
    with tempfile.NamedTemporaryFile(suffix=".db",delete=False) as tmp:
        path=tmp.name
    try:
        base=connect(path); install(base)
        for aid in (201,202): auction(base,aid)
        ce,_=event(base,"Concurrent capacity event",[201,202])
        qualification_command(base,"q-concurrent",ce,b"A","bidderA",limit=500)
        base.close()

        def worker(args):
            key,aid=args
            conn=connect(path)
            try:
                conn.execute("BEGIN IMMEDIATE")
                row=capacity_bid(conn,key,ce,aid,b"A","bidderA",400)
                conn.commit()
                return row[:2]
            finally:
                conn.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            outcomes=list(pool.map(worker,[("race-1",201),("race-2",202)]))
        assert sorted(outcomes,key=lambda x:x[0]) == [("accepted",None),("rejected","INSUFFICIENT_BID_CAPACITY")], outcomes
        proof=connect(path)
        total=proof.execute("""SELECT COALESCE(SUM(reserved_amount),0) FROM auction_capacity_reservations
                               WHERE event_id=? AND user=? AND status IN ('ACTIVE','WON_OBLIGATION')""",(ce,b"A")).fetchone()[0]
        assert total == 400.0, total
        proof.close()
    finally:
        try: os.unlink(path)
        except FileNotFoundError: pass

    print("IMP-06 bidder qualification + finance capacity: PASS")
    print("  unqualified=BLOCKED qualified=PASS suspended=BLOCKED")
    print("  admin-approve=PASS ordinary-approve=BLOCKED idempotency=PASS")
    print("  reservation=PASS outbid-release=PASS winner-obligation=PASS")
    print("  concurrent cross-lot capacity overrun=BLOCKED")

if __name__ == "__main__":
    main()
