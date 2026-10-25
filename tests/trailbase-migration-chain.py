#!/usr/bin/env python3
"""Fresh-install and parent->tip proof for the TrailBase SQL migration chain."""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "mini-services/trailbase-db/traildepot/migrations/main"
EXPECTED = [f"U{1_000_000_000 + i}__" for i in range(1, 12)]

def connection() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=OFF")
    db.create_function("uuid_v4", 0, lambda: sqlite3.Binary(uuid.uuid4().bytes))
    db.create_function("hash_password", 1, lambda value: f"test-hash:{value}")
    db.execute("""CREATE TABLE _user(
      id BLOB PRIMARY KEY,
      email TEXT,
      username TEXT UNIQUE,
      password_hash TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      admin INTEGER NOT NULL DEFAULT 0
    )""")
    return db

def migration_files() -> list[Path]:
    files = sorted(MIGRATIONS.glob("U*.sql"))
    names = [p.name for p in files]
    if len(files) != 11:
        raise AssertionError(f"expected 10 main migrations, found {names}")
    for prefix, name in zip(EXPECTED, names):
        if not name.startswith(prefix):
            raise AssertionError(f"migration sequence mismatch: expected {prefix}, got {name}")
    return files

def apply(db: sqlite3.Connection, files: list[Path]) -> None:
    for path in files:
        try:
            db.executescript(path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise AssertionError(f"migration failed: {path.name}: {exc}") from exc

def tables(db: sqlite3.Connection) -> set[str]:
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

def assert_tip(db: sqlite3.Connection) -> None:
    required = {
        "auctions","bids","orders","auction_commands","auction_finalization_commands",
        "auction_outbox","auction_outcomes","legacy_auction_mappings",
        "vehicles","vehicle_documents","vehicle_inspections","vehicle_eligibility",
        "auction_events","auction_venues","auction_event_operators","auction_lots","run_list_commands",
        "auction_bidder_qualifications","auction_qualification_commands",
        "auction_capacity_reservations","auction_bid_capacity_commands",
    }
    missing = required - tables(db)
    if missing:
        raise AssertionError(f"missing tip tables: {sorted(missing)}")

    order_columns = {row[1] for row in db.execute("PRAGMA table_info(orders)")}
    if "auction_outcome_key" not in order_columns:
        raise AssertionError("orders.auction_outcome_key missing")

    indices = {row[1] for row in db.execute("PRAGMA index_list(orders)")}
    if "uq_orders_auction_outcome_key" not in indices:
        raise AssertionError("canonical outcome unique index missing")
    if "uq_orders_auction_once" in indices:
        raise AssertionError("legacy-destructive global auction order unique index remains")

    legacy_dupes = db.execute(
        """SELECT COUNT(*) FROM (
             SELECT auction_id FROM orders
             WHERE auction_outcome_key IS NULL
             GROUP BY auction_id HAVING COUNT(*) > 1
           )"""
    ).fetchone()[0]
    if legacy_dupes < 1:
        raise AssertionError("seed no longer proves preservation of legacy duplicate auction orders")

    admin = db.execute("SELECT id,username FROM _user WHERE admin=1 ORDER BY username LIMIT 1").fetchone()
    if not admin:
        raise AssertionError("admin user unavailable after migration")
    before = db.execute("SELECT COUNT(*) FROM live_sessions").fetchone()[0]
    db.execute(
        """INSERT INTO auction_events(
          host_user,host_username,title,description,starts_at,status,created_at,updated_at
        ) VALUES(?,?,?,'','2030-01-01T10:00:00Z','SCHEDULED',
                 '2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
        (admin[0], admin[1], "Migration proof event"),
    )
    event_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    event = db.execute(
        "SELECT session_id,run_list_version,run_list_locked FROM auction_events WHERE id=?",
        (event_id,),
    ).fetchone()
    if not event or event[0] is None or event[1:] != (0,0):
        raise AssertionError(f"event/session trigger failed: {event}")
    after = db.execute("SELECT COUNT(*) FROM live_sessions").fetchone()[0]
    if after != before + 1:
        raise AssertionError("event insert did not create exactly one evolved LiveSession")
    host_role = db.execute(
        "SELECT role FROM auction_event_operators WHERE event_id=? AND user=?",
        (event_id, admin[0]),
    ).fetchone()
    if host_role != ("HOST",):
        raise AssertionError(f"event host operator missing: {host_role}")

def main() -> None:
    files = migration_files()

    fresh = connection()
    apply(fresh, files)
    assert_tip(fresh)
    fresh.close()

    upgraded = connection()
    apply(upgraded, files[:6])
    duplicate_before = upgraded.execute(
        """SELECT COUNT(*) FROM (
             SELECT auction_id FROM orders GROUP BY auction_id HAVING COUNT(*) > 1
           )"""
    ).fetchone()[0]
    if duplicate_before < 1:
        raise AssertionError("U1-U6 fixture no longer contains legacy duplicate order history")
    apply(upgraded, files[6:])
    assert_tip(upgraded)
    duplicate_after = upgraded.execute(
        """SELECT COUNT(*) FROM (
             SELECT auction_id FROM orders
             WHERE auction_outcome_key IS NULL
             GROUP BY auction_id HAVING COUNT(*) > 1
           )"""
    ).fetchone()[0]
    if duplicate_after != duplicate_before:
        raise AssertionError(
            f"parent->tip changed legacy duplicate-order evidence: before={duplicate_before}, after={duplicate_after}"
        )
    upgraded.close()

    print("TrailBase migration chain proof: PASS")
    print("  blank fresh install U1 -> U11: PASS")
    print("  U1-U6 parent -> U11 tip: PASS")
    print("  legacy duplicate orders preserved: PASS")
    print("  canonical outcome-key uniqueness: PASS")
    print("  IMP-02/03/04/05/06 tables present: PASS")
    print("  AuctionEvent -> LiveSession trigger: PASS")

if __name__ == "__main__":
    main()
