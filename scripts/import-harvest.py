#!/usr/bin/env python3
"""Import harvested marketplace rows into a freshly-migrated Trailbase depot.

The depot schema comes from the migrations (authoritative, includes Gap-8).
The rows come from the harvested production snapshot.

Usage: python3 import-harvest.py <depot-data-db> <harvest-db>
"""
import sqlite3
import sys

dst_path, src_path = sys.argv[1], sys.argv[2]

# Parents before children.
TABLES = [
    "_user",
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
    "saved_searches",
    "offers",
    "live_sessions",
]


def columns(con, table, schema="main"):
    return [r[1] for r in con.execute(f"pragma {schema}.table_info('{table}')")]


def main():
    con = sqlite3.connect(dst_path)
    # Trailbase registers SQL functions in its own build (CHECK constraints and
    # generated columns reference them). Plain sqlite3 does not have them, so
    # provide permissive stubs for the duration of the import.
    con.create_function("is_email", 1, lambda v: 1 if v is None or "@" in str(v) else 0)
    con.create_function("is_uuid", 1, lambda v: 1)
    con.create_function("is_json", 1, lambda v: 1)
    con.create_function("jsonschema", -1, lambda *a: 1)
    con.execute("pragma foreign_keys=off")
    con.execute(f"attach database '{src_path}' as src")

    dst_tables = {
        r[0]
        for r in con.execute("select name from sqlite_master where type='table'")
    }

    for table in TABLES:
        if table not in dst_tables:
            print(f"  skip {table}: not in depot schema")
            continue
        src_tables = {
            r[0]
            for r in con.execute("select name from src.sqlite_master where type='table'")
        }
        if table not in src_tables:
            print(f"  skip {table}: not in harvest")
            continue

        common = [c for c in columns(con, table) if c in columns(con, table, "src")]
        if not common:
            print(f"  skip {table}: no common columns")
            continue

        cols = ", ".join(f'"{c}"' for c in common)
        con.execute(f'delete from main."{table}"')
        con.execute(
            f'insert into main."{table}" ({cols}) select {cols} from src."{table}"'
        )
        n = con.execute(f'select count(*) from main."{table}"').fetchone()[0]
        print(f"  {table}: {n} rows")

    con.commit()
    con.execute("detach database src")
    con.close()


if __name__ == "__main__":
    main()
