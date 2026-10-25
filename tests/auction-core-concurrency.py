#!/usr/bin/env python3
"""IMP-02 transactional auction-core proof against disposable SQLite.

This is deliberately a database behavior/concurrency test, not a source-string
contract. It exercises the same SQLite migration that TrailBase applies.
"""
from __future__ import annotations
import concurrent.futures
import os
import sqlite3
import tempfile
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "mini-services/trailbase-db/traildepot/migrations/main/U1000000007__auction_core.sql"

def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def connect(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path, timeout=15, isolation_level=None)
    db.execute("PRAGMA busy_timeout=15000")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db

def parent_schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    CREATE TABLE auctions (
      id INTEGER PRIMARY KEY,
      user BLOB NOT NULL,
      seller_username TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'vehicles',
      condition TEXT NOT NULL DEFAULT 'used',
      start_price REAL NOT NULL,
      current_price REAL NOT NULL,
      buy_now_price REAL,
      reserve_price REAL,
      bid_count INTEGER NOT NULL DEFAULT 0,
      watch_count INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      shipping_fee REAL NOT NULL DEFAULT 0,
      shipping TEXT NOT NULL DEFAULT 'courier',
      city TEXT NOT NULL DEFAULT 'Harare',
      ends_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live',
      extension_count INTEGER NOT NULL DEFAULT 0,
      featured INTEGER NOT NULL DEFAULT 0,
      images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      allow_offers INTEGER NOT NULL DEFAULT 0,
      offer_min REAL,
      live_session_id INTEGER
    ) STRICT;
    CREATE TABLE bids (
      id INTEGER PRIMARY KEY,
      auction_id INTEGER NOT NULL,
      user BLOB NOT NULL,
      bidder_username TEXT NOT NULL,
      amount REAL NOT NULL,
      max_amount REAL NOT NULL,
      is_auto INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      retracted_at TEXT,
      retraction_reason TEXT
    ) STRICT;
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auction_id INTEGER NOT NULL,
      auction_title TEXT NOT NULL DEFAULT '',
      buyer_user BLOB NOT NULL,
      seller_user BLOB NOT NULL,
      buyer_username TEXT NOT NULL DEFAULT '',
      seller_username TEXT NOT NULL DEFAULT '',
      final_price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_payment',
      pay_by TEXT,
      paid_at TEXT,
      shipped_at TEXT,
      delivered_at TEXT,
      completed_at TEXT,
      carrier TEXT,
      tracking TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      address TEXT
    ) STRICT;
    CREATE TABLE live_sessions (
      id INTEGER PRIMARY KEY,
      host_user BLOB NOT NULL,
      host_username TEXT NOT NULL,
      title TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      current_lot_id INTEGER,
      lot_index INTEGER NOT NULL DEFAULT 0,
      close_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    """)

def insert_auction(db: sqlite3.Connection, auction_id: int, seller: bytes = b"seller",
                   start: float = 100.0, reserve: float | None = None,
                   seconds: int = 3600, live_session_id: int | None = None) -> None:
    now = datetime.now(timezone.utc)
    db.execute("""INSERT INTO auctions
      (id,user,seller_username,title,start_price,current_price,reserve_price,ends_at,started_at,
       status,created_at,updated_at,live_session_id)
      VALUES (?,?,?,?,?,?,?,?,?,'live',?,?,?)""",
      (auction_id, seller, "seller", f"Auction {auction_id}", start, start, reserve,
       iso(now + timedelta(seconds=seconds)), iso(now - timedelta(minutes=1)),
       iso(now), iso(now), live_session_id))

def command(db: sqlite3.Connection, key: str, auction_id: int, user: bytes, name: str,
            maximum: float, expected_version: int | None = None) -> sqlite3.Row:
    db.row_factory = sqlite3.Row
    db.execute("""INSERT INTO auction_commands
      (command_key,auction_id,actor_user,actor_username,max_amount,expected_version)
      VALUES (?,?,?,?,?,?)""", (key, auction_id, user, name, maximum, expected_version))
    return db.execute("SELECT * FROM auction_commands WHERE command_key=?", (key,)).fetchone()

def retract(db: sqlite3.Connection, key: str, auction_id: int, user: bytes, name: str,
            bid_id: int, reason: str, expected_version: int | None = None,
            admin: bool = False) -> sqlite3.Row:
    db.row_factory = sqlite3.Row
    db.execute("""INSERT INTO auction_commands
      (command_key,auction_id,actor_user,actor_username,actor_admin,command_type,target_bid_id,reason,expected_version)
      VALUES (?,?,?,?,?,'RETRACT_BID',?,?,?)""",
      (key, auction_id, user, name, 1 if admin else 0, bid_id, reason, expected_version))
    return db.execute("SELECT * FROM auction_commands WHERE command_key=?", (key,)).fetchone()

def finalize(db: sqlite3.Connection, key: str, auction_id: int, source: str = "TIMED_SWEEP",
             requested: str = "AUTO", buyer: bytes | None = None,
             buyer_name: str | None = None, price: float | None = None,
             expected_version: int | None = None) -> sqlite3.Row:
    db.row_factory = sqlite3.Row
    db.execute("""INSERT INTO auction_finalization_commands
      (command_key,auction_id,source,requested_outcome,buyer_user,buyer_username,final_price,expected_version)
      VALUES (?,?,?,?,?,?,?,?)""",
      (key, auction_id, source, requested, buyer, buyer_name, price, expected_version))
    return db.execute("SELECT * FROM auction_finalization_commands WHERE command_key=?", (key,)).fetchone()

def assert_eq(actual, expected, label: str) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")

def main() -> None:
    migration = MIGRATION.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory(prefix="tengasell-imp02-") as td:
        path = os.path.join(td, "auction-core.db")
        db = connect(path)
        parent_schema(db)

        # Parent -> tip proof with a real legacy proxy-bid history to backfill.
        insert_auction(db, 9000)
        db.execute("""INSERT INTO bids
          (id,auction_id,user,bidder_username,amount,max_amount,status,created_at)
          VALUES (1,9000,?,'legacyA',100,180,'superseded','2026-01-01T00:00:00Z'),
                 (2,9000,?,'legacyB',110,150,'active','2026-01-01T00:01:00Z')""",
          (b"legacyA", b"legacyB"))
        db.executescript(migration)
        legacy = db.execute(
            "SELECT COUNT(*) FROM auction_standing_bids WHERE auction_id=9000"
        ).fetchone()[0]
        assert_eq(legacy, 2, "legacy standing-max backfill")

        # Proxy bidding + dynamic increment + winner raising own max.
        insert_auction(db, 9100)
        a = command(db, "bid-A-1", 9100, b"A", "A", 200)
        assert_eq(a["status"], "accepted", "first bid accepted")
        assert_eq(a["result_price"], 100.0, "first bid opening price")
        b = command(db, "bid-B-1", 9100, b"B", "B", 150)
        assert_eq(b["status"], "accepted", "challenger accepted")
        assert_eq(b["result_winner_username"], "A", "proxy standing bidder")
        assert_eq(b["result_price"], 152.0, "dynamic increment proxy price")
        a2 = command(db, "bid-A-raise", 9100, b"A", "A", 300)
        assert_eq(a2["result_price"], 152.0, "winner max raise must not inflate price")
        b2 = command(db, "bid-B-equal", 9100, b"B", "B", 300)
        assert_eq(b2["result_winner_username"], "A", "equal max earlier bidder priority")
        assert_eq(b2["result_price"], 300.0, "equal max reaches tied maximum")

        # CAS/stale operator semantics at auction command boundary.
        stale = command(db, "bid-stale", 9100, b"C", "C", 400, expected_version=0)
        assert_eq(stale["status"], "rejected", "stale version rejected")
        assert_eq(stale["error_code"], "STALE_AUCTION_VERSION", "stale error code")

        # Persistent command idempotency: same key cannot execute twice.
        try:
            command(db, "bid-A-1", 9100, b"A", "A", 999)
            raise AssertionError("duplicate command key unexpectedly inserted")
        except sqlite3.IntegrityError:
            pass
        assert_eq(db.execute(
            "SELECT COUNT(*) FROM auction_commands WHERE command_key='bid-A-1'"
        ).fetchone()[0], 1, "persistent idempotency row")

        # Transactional retraction stays coherent with standing-max state.
        leader_bid_id = db.execute(
            "SELECT id FROM bids WHERE auction_id=9100 AND status='active'"
        ).fetchone()[0]
        retract_row = retract(
            db, "retract-A", 9100, b"A", "A", leader_bid_id,
            "Entered the wrong maximum amount",
        )
        assert_eq(retract_row["status"], "accepted", "leader retraction accepted")
        # A's immediately previous accepted maximum (200) is restored, so B's
        # standing 300 maximum becomes the leader.
        assert_eq(retract_row["result_winner_username"], "B", "retraction recomputes leader")
        assert_eq(db.execute(
            "SELECT COUNT(*) FROM bids WHERE auction_id=9100 AND status='active'"
        ).fetchone()[0], 1, "single active bid after retraction")

        # Server-time anti-snipe.
        insert_auction(db, 9200, seconds=120)
        old_end = db.execute("SELECT ends_at FROM auctions WHERE id=9200").fetchone()[0]
        anti = command(db, "anti-1", 9200, b"A", "A", 200)
        assert_eq(anti["status"], "accepted", "anti-snipe bid accepted")
        new_end, ext = db.execute(
            "SELECT ends_at,extension_count FROM auctions WHERE id=9200"
        ).fetchone()
        delta = int(datetime.fromisoformat(new_end.replace("Z","+00:00")).timestamp()
                    - datetime.fromisoformat(old_end.replace("Z","+00:00")).timestamp())
        assert_eq(delta, 300, "anti-snipe exact extension")
        assert_eq(ext, 1, "anti-snipe extension count")

        # Persisted 20-second live hammer is set atomically with accepted bid.
        now = iso(datetime.now(timezone.utc))
        db.execute("""INSERT INTO live_sessions
          (id,host_user,host_username,title,scheduled_at,status,current_lot_id,created_at,updated_at)
          VALUES (77,?,'host','Live',?,'live',9300,?,?)""", (b"host", now, now, now))
        insert_auction(db, 9300, seconds=3600, live_session_id=77)
        live = command(db, "live-1", 9300, b"A", "A", 200)
        assert_eq(live["status"], "accepted", "live bid accepted")
        close_at = db.execute("SELECT close_at FROM live_sessions WHERE id=77").fetchone()[0]
        close_delta = datetime.fromisoformat(close_at.replace("Z","+00:00")).timestamp() - time.time()
        if not (17 <= close_delta <= 21):
            raise AssertionError(f"persisted hammer expected ~20s, got {close_delta:.2f}s")

        # Real concurrent writers against one disposable SQLite database.
        insert_auction(db, 9400, start=100)
        db.close()
        contenders = [(f"c-{i}", bytes([65+i]), chr(65+i), 140 + i*13) for i in range(10)]
        def worker(item):
            key, user, name, maximum = item
            conn = connect(path)
            try:
                row = command(conn, key, 9400, user, name, maximum)
                return row["status"], row["error_code"]
            finally:
                conn.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            results = list(pool.map(worker, contenders))
        db = connect(path)
        accepted = sum(1 for status, _ in results if status == "accepted")
        if accepted < 2:
            raise AssertionError(f"concurrency proof too weak: only {accepted} accepted writes")
        version = db.execute("SELECT version FROM auctions WHERE id=9400").fetchone()[0]
        assert_eq(version, accepted, "serialized version equals accepted writes")
        assert_eq(db.execute(
            "SELECT COUNT(*) FROM bids WHERE auction_id=9400 AND status='active'"
        ).fetchone()[0], 1, "single active winner under concurrency")
        assert_eq(db.execute(
            "SELECT COUNT(*) FROM auction_outbox WHERE auction_id=9400 AND event_type='AUCTION_BID_ACCEPTED'"
        ).fetchone()[0], accepted, "outbox event per committed bid")

        # Unified finalization + CREATE_ORDER_ONCE + duplicate-finalization race.
        # Make timed auction genuinely due using DB server-time semantics.
        insert_auction(db, 9500, start=100, seconds=60)
        command(db, "final-bid-A", 9500, b"A", "A", 250)
        command(db, "final-bid-B", 9500, b"B", "B", 180)
        db.execute("UPDATE auctions SET ends_at=strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 second') WHERE id=9500")
        db.close()
        def final_worker(i: int):
            conn = connect(path)
            try:
                row = finalize(conn, f"final-{i}", 9500)
                return row["status"], row["result_order_id"]
            finally:
                conn.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            finals = list(pool.map(final_worker, range(8)))
        db = connect(path)
        assert_eq(db.execute("SELECT COUNT(*) FROM auction_outcomes WHERE auction_id=9500").fetchone()[0],
                  1, "single durable outcome")
        assert_eq(db.execute("SELECT COUNT(*) FROM orders WHERE auction_id=9500").fetchone()[0],
                  1, "CREATE_ORDER_ONCE")
        assert_eq(db.execute(
            "SELECT COUNT(*) FROM auction_outbox WHERE auction_id=9500 AND event_type='AUCTION_SOLD'"
        ).fetchone()[0], 1, "single final outbox event")
        accepted_final = sum(1 for s, _ in finals if s == "accepted")
        idempotent_final = sum(1 for s, _ in finals if s == "idempotent_existing")
        assert_eq(accepted_final, 1, "one finalization winner")
        assert_eq(idempotent_final, 7, "duplicate finalization replay classification")

        # Restart durability: close all connections, reopen, rows/outbox/outcome remain,
        # and another deterministic finalization is idempotent_existing.
        db.close()
        db = connect(path)
        replay = finalize(db, "final-after-restart", 9500)
        assert_eq(replay["status"], "idempotent_existing", "restart finalization replay")
        pending = db.execute(
            "SELECT COUNT(*) FR