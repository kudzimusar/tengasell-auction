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
            bid_id: int, reason: str, expected_version: