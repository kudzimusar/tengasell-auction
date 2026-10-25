#!/usr/bin/env python3
"""IMP-05 real SQLite Event/Session/Run-List authority proof."""

from __future__ import annotations

import concurrent.futures
import datetime as dt
import os
import sqlite3
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000010__auction_events_run_list.sql"

PARENT = """
PRAGMA foreign_keys=OFF;
CREATE TABLE _user(id BLOB PRIMARY KEY, username TEXT, admin INTEGER);
CREATE TABLE audit_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT,action TEXT,entity TEXT,
  entity_id INTEGER,source TEXT,payload TEXT,created_at TEXT
);
CREATE TABLE auctions(
  id INTEGER PRIMARY KEY,user BLOB,seller_username TEXT,title TEXT,start_price REAL,current_price REAL,
  reserve_price REAL,bid_count INTEGER,ends_at TEXT,status TEXT,live_session_id INTEGER,
  version INTEGER NOT NULL DEFAULT 0,asset_kind TEXT NOT NULL DEFAULT 'general',updated_at TEXT
);
CREATE TABLE live_sessions(
  id INTEGER PRIMARY KEY,host_user BLOB NOT NULL,host_username TEXT NOT NULL,title TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'scheduled',current_lot_id INTEGER,
  lot_index INTEGER NOT NULL DEFAULT 0,close_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE vehicles(id INTEGER PRIMARY KEY,auction_id INTEGER UNIQUE,seller_user BLOB);
CREATE TABLE vehicle_eligibility(id INTEGER PRIMARY KEY,vehicle_id INTEGER,version INTEGER,status TEXT);
"""

def iso(hours: int = 0) -> str:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

def install(conn: sqlite3.Connection) -> None:
    conn.executescript(PARENT)
    conn.executescript(MIGRATION.read_text())
    conn.execute("INSERT INTO _user(id,username,admin) VALUES(?,?,?)", (b"host", "host", 0))
    conn.execute("INSERT INTO _user(id,username,admin) VALUES(?,?,?)", (b"other", "other", 0))
    conn.execute("INSERT INTO _user(id,username,admin) VALUES(?,?,?)", (b"admin", "admin", 1))

def auction(conn: sqlite3.Connection, auction_id: int, kind: str = "general") -> None:
    conn.execute(
        """INSERT INTO auctions(
          id,user,seller_username,title,start_price,current_price,reserve_price,bid_count,
          ends_at,status,live_session_id,version,asset_kind,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (auction_id,b"host","host",f"Auction {auction_id}",100,100,None,0,iso(24),"live",None,0,kind,iso()),
    )

def create_event(conn: sqlite3.Connection) -> tuple[int,int]:
    cur = conn.execute(
        """INSERT INTO auction_events(
          host_user,host_username,title,description,starts_at,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?)""",
        (b"host","host","Harare Saturday Auction","",iso(1),"SCHEDULED",iso(),iso()),
    )
    event_id = int(cur.lastrowid)
    session_id = int(conn.execute("SELECT session_id FROM auction_events WHERE id=?", (event_id,)).fetchone()[0])
    return event_id, session_id

def command(
    conn: sqlite3.Connection,
    key: str,
    event_id: int,
    session_id: int,
    command_type: str,
    version: int,
    *,
    actor: bytes = b"host",
    username: str = "host",
    admin: int = 0,
    lot_id: int | None = None,
    auction_id: int | None = None,
    target: int | None = None,
    reason: str | None = None,
    source: str = "OPERATOR",
):
    conn.execute(
        """INSERT INTO run_list_commands(
          command_key,event_id,session_id,operator_user,operator_username,operator_admin,
          command_type,lot_id,auction_id,target_sequence_no,reason,expected_run_list_version,source
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (key,event_id,session_id,actor,username,admin,command_type,lot_id,auction_id,target,reason,version,source),
    )
    return conn.execute(
        """SELECT status,error_code,version_before,version_after,result_lot_id,
                  result_current_lot_id,result_next_lot_id
             FROM run_list_commands WHERE command_key=?""",
        (key,),
    ).fetchone()

def main() -> None:
    conn = sqlite3.connect(":memory:")
    install(conn)
    auction(conn, 1)
    auction(conn, 2)
    auction(conn, 3, "vehicle")
    conn.execute("INSERT INTO vehicles(id,auction_id,seller_user) VALUES(?,?,?)", (30,3,b"host"))
    event_id, session_id = create_event(conn)

    assert conn.execute("SELECT event_id FROM live_sessions WHERE id=?", (session_id,)).fetchone() == (event_id,)
    assert conn.execute(
        "SELECT role FROM auction_event_operators WHERE event_id=? AND user=?",
        (event_id,b"host"),
    ).fetchone() == ("HOST",)

    denied = command(conn,"unauthorized",event_id,session_id,"ADD",0,actor=b"other",username="other",auction_id=1)
    assert denied[0:2] == ("rejected","OPERATOR_PERMISSION_REQUIRED")

    add1 = command(conn,"add-1",event_id,session_id,"ADD",0,auction_id=1)
    add2 = command(conn,"add-2",event_id,session_id,"ADD",1,auction_id=2)
    assert add1[0] == add2[0] == "accepted"
    assert conn.execute(
        "SELECT auction_id,sequence_no FROM auction_lots WHERE event_id=? ORDER BY sequence_no",
        (event_id,),
    ).fetchall() == [(1,1),(2,2)]

    vehicle_block = command(conn,"vehicle-block",event_id,session_id,"ADD",2,auction_id=3)
    assert vehicle_block[0:2] == ("rejected","VEHICLE_NOT_ELIGIBLE")
    conn.execute("INSERT INTO vehicle_eligibility(id,vehicle_id,version,status) VALUES(1,30,1,'ELIGIBLE')")
    vehicle_add = command(conn,"vehicle-add",event_id,session_id,"ADD",2,auction_id=3)
    assert vehicle_add[0] == "accepted"

    lot_ids = {
        row[1]: row[0]
        for row in conn.execute("SELECT id,auction_id FROM auction_lots WHERE event_id=?", (event_id,))
    }
    version = 3
    for auction_id in (1,2,3):
        ready = command(conn,f"ready-{auction_id}",event_id,session_id,"READY",version,lot_id=lot_ids[auction_id])
        assert ready[0] == "accepted"
        version += 1

    moved = command(
        conn,"move-vehicle-first",event_id,session_id,"MOVE",version,
        lot_id=lot_ids[3],target=1,
    )
    assert moved[0] == "accepted"
    version += 1
    assert conn.execute(
        "SELECT auction_id,sequence_no FROM auction_lots WHERE event_id=? ORDER BY sequence_no",
        (event_id,),
    ).fetchall() == [(3,1),(1,2),(2,3)]

    stale = command(conn,"stale-operator",event_id,session_id,"MOVE",version-1,lot_id=lot_ids[2],target=1)
    assert stale[0:2] == ("rejected","STALE_RUN_LIST_VERSION")

    locked = command(conn,"lock",event_id,session_id,"LOCK",version)
    assert locked[0] == "accepted"
    version += 1
    blocked_locked = command(conn,"locked-move",event_id,session_id,"MOVE",version,lot_id=lot_ids[2],target=1)
    assert blocked_locked[0:2] == ("rejected","RUN_LIST_LOCKED")

    opened = command(conn,"open",event_id,session_id,"OPEN",version,lot_id=lot_ids[3])
    assert opened[0] == "accepted"
    version += 1
    assert conn.execute(
        "SELECT status,current_lot_id,next_lot_id,run_list_locked,run_list_version FROM auction_events WHERE id=?",
        (event_id,),
    ).fetchone() == ("LIVE",lot_ids[3],lot_ids[1],1,version)
    assert conn.execute(
        "SELECT status,current_lot_id,next_lot_id,run_list_locked,run_list_version FROM live_sessions WHERE id=?",
        (session_id,),
    ).fetchone() == ("live",3,1,1,version)

    premature = command(conn,"advance-before-outcome",event_id,session_id,"ADVANCE",version,lot_id=lot_ids[3])
    assert premature[0:2] == ("rejected","LOT_OUTCOME_NOT_COMMITTED")
    conn.execute("UPDATE auctions SET status='sold' WHERE id=3")
    advanced = command(conn,"advance",event_id,session_id,"ADVANCE",version,lot_id=lot_ids[3],source="SYSTEM")
    assert advanced[0] == "accepted"
    version += 1
    assert conn.execute("SELECT status FROM auction_lots WHERE id=?", (lot_ids[3],)).fetchone() == ("SOLD",)
    assert conn.execute(
        "SELECT current_lot_id,next_lot_id,run_list_version FROM auction_events WHERE id=?",
        (event_id,),
    ).fetchone() == (None,lot_ids[1],version)

    unlock = command(conn,"unlock",event_id,session_id,"UNLOCK",version)
    assert unlock[0] == "accepted"
    version += 1
    withdrawn = command(
        conn,"withdraw",event_id,session_id,"WITHDRAW",version,
        lot_id=lot_ids[2],reason="Seller withdrew before reaching the block.",
    )
    assert withdrawn[0] == "accepted"
    version += 1
    assert conn.execute("SELECT status FROM auction_lots WHERE id=?", (lot_ids[2],)).fetchone() == ("WITHDRAWN",)

    lock2 = command(conn,"lock-final",event_id,session_id,"LOCK",version)
    assert lock2[0] == "accepted"
    version += 1
    closed = command(conn,"close-event",event_id,session_id,"CLOSE_EVENT",version)
    assert closed[0] == "accepted"
    assert conn.execute("SELECT status FROM auction_events WHERE id=?", (event_id,)).fetchone() == ("CLOSED",)
    assert conn.execute("SELECT status FROM live_sessions WHERE id=?", (session_id,)).fetchone() == ("closed",)
    assert conn.execute("SELECT COUNT(*) FROM audit_events WHERE source='run-list-authority'").fetchone()[0] >= 10

    # Real concurrent stale-operator proof against a disposable file DB.
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        path = tmp.name
    try:
        base = sqlite3.connect(path)
        install(base)
        auction(base, 10)
        auction(base, 11)
        ce, cs = create_event(base)
        base.commit()
        base.close()

        def concurrent_add(key: str, auction_id: int):
            db = sqlite3.connect(path, timeout=10, isolation_level=None)
            db.execute("PRAGMA busy_timeout=10000")
            db.execute("BEGIN IMMEDIATE")
            row = command(db,key,ce,cs,"ADD",0,auction_id=auction_id)
            db.commit()
            db.close()
            return row[0:2]

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda args: concurrent_add(*args), [("c-1",10),("c-2",11)]))
        assert sorted(outcomes) == [("accepted",None),("rejected","STALE_RUN_LIST_VERSION")]
        proof = sqlite3.connect(path)
        assert proof.execute("SELECT run_list_version FROM auction_events WHERE id=?", (ce,)).fetchone() == (1,)
        assert proof.execute("SELECT COUNT(*) FROM auction_lots WHERE event_id=?", (ce,)).fetchone() == (1,)
        proof.close()
    finally:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass

    print("IMP-05 Event/Session/Run-List SQLite authority proof: PASS")
    print("  event->session integrity: PASS")
    print("  durable sequence/run-list ordering: PASS")
    print("  vehicle eligibility gate: PASS")
    print("  lock/version authority: PASS")
    print("  stale operator rejection: PASS")
    print("  current/next lot: PASS")
    print("  withdrawal + close lifecycle: PASS")
    print("  RBAC + audit: PASS")
    print("  real concurrent writers: one accepted / one stale: PASS")

if __name__ == "__main__":
    main()
