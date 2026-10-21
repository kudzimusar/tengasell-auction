#!/usr/bin/env python3
"""Merge a recovered marketplace database into the live one.

Use this when you obtain a newer Trailbase database from z.ai (the export that
actually contains 24 orders and the Gap-8 rows). Rows are matched by primary
key and replaced, so it is safe to run against a populated database.

Usage:
    python3 scripts/merge-recovered-db.py <live.db> <recovered.db> [--dry-run]

Typical:
    python3 scripts/merge-recovered-db.py \
        /data/traildepot/data/main.db recovered-main.db

What it merges (marketplace tables only; auth users are preserved unless you
pass --include-users):
    profiles categories auctions bids orders payments questions ratings
    watchlist threads messages notifications audit_events paynow_sessions
    offers saved_searches live_sessions
"""
import sqlite3
import sys

TABLES = [
    "profiles",
    "categories",
    "auctions",
    "bids",
    "orders",
    "payments",
    "questions",
    "ratings",
    "watchlist",
    "threads",
    "messages",
    "notifications",
    "audit_events",
    "paynow_sessions",
    "offers",
    "saved_searches",
    "live_sessions",
]


def columns(con, table, schema="main"):
    return [r[1] for r in con.execute(f"pragma {schema}.table_info('{table}')")]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) != 2:
        print(__doc__)
        sys.exit(1)

    live_path, recovered_path = args
    dry_run = "--dry-run" in flags
    include_users = "--include-users" in flags

    con = sqlite3.connect(live_path)
    con.create_function("is_email", 1, lambda v: 1 if v is None or "@" in str(v) else 0)
    con.create_function("is_uuid", 1, lambda v: 1)
    con.create_function("is_json", 1, lambda v: 1)
    con.create_function("jsonschema", -1, lambda *a: 1)
    con.execute("pragma foreign_keys=off")
    con.execute(f"attach database '{recovered_path}' as rec")

    tables = list(TABLES)
    if include_users:
        tables.insert(0, "_user")

    total = 0
    for table in tables:
        live_tables = {r[0] for r in con.execute(
            "select name from sqlite_master where type='table'")}
        rec_tables = {r[0] for r in con.execute(
            "select name from rec.sqlite_master where type='table'")}
        if table not in live_tables or table not in rec_tables:
            print(f"  skip {table}: missing on one side")
            continue

        common = [c for c in columns(con, table) if c in columns(con, table, "rec")]
        if not common:
            print(f"  skip {table}: no common columns")
            continue

        cols = ", ".join(f'"{c}"' for c in common)
        before = con.execute(f'select count(*) from main."{table}"').fetchone()[0]
        incoming = con.execute(f'select count(*) from rec."{table}"').fetchone()[0]

        if dry_run:
            print(f"  {table}: live={before} recovered={incoming} (dry run)")
            continue

        con.execute(
            f'insert or replace into main."{table}" ({cols}) '
            f'select {cols} from rec."{table}"'
        )
        after = con.execute(f'select count(*) from main."{table}"').fetchone()[0]
        total += max(0, after - before)
        print(f"  {table}: live {before} -> {after} (recovered had {incoming})")

    if dry_run:
        print("dry run — nothing written")
    else:
        con.commit()
        print(f"merged; {total} net new rows")
    con.execute("detach database rec")
    con.close()


if __name__ == "__main__":
    main()
