#!/usr/bin/env python3
"""Vehicle draft disclosure contract and U15 enforcement regression."""

from __future__ import annotations

import importlib.util
import re
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REMOTE = ROOT / "src/lib/tengasell/api/remote.ts"
CHAIN = ROOT / "tests/trailbase-migration-chain.py"
spec = importlib.util.spec_from_file_location("migration_chain", CHAIN)
chain = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(chain)


def assert_client_contract() -> None:
    source = REMOTE.read_text(encoding="utf-8")
    contract = re.compile(
        r'reserve_price: input\.reserve_price \?\? null,\s*'
        r'reserve_disclosure:\s*input\.assetKind === "vehicle"\s*'
        r'\? input\.reserve_price == null\s*'
        r'\? "NO_RESERVE"\s*:\s*"RESERVE_APPLIES"\s*:\s*undefined,'
    )
    if not contract.search(source):
        raise AssertionError("vehicle reserve-disclosure payload mapping is missing")


def insert_auction(
    db: sqlite3.Connection,
    auction_id: int,
    seller: bytes,
    *,
    asset_kind: str,
    reserve_price: float | None,
    disclosure: str | None = None,
    omit_disclosure: bool = False,
) -> None:
    columns = [
        "id", "user", "seller_username", "title", "slug", "description",
        "category", "condition", "start_price", "current_price", "reserve_price",
        "shipping", "city", "ends_at", "started_at", "status", "images",
        "created_at", "updated_at", "asset_kind",
    ]
    values: list[object] = [
        auction_id, seller, "takudzwa", f"Reserve regression {auction_id}",
        f"reserve-regression-{auction_id}", "Synthetic local-only regression",
        "vehicles" if asset_kind == "vehicle" else "general", "used", 1000.0,
        1000.0, reserve_price, "pickup", "Harare", "2030-01-02T00:00:00Z",
        "2030-01-01T00:00:00Z", "draft" if asset_kind == "vehicle" else "live",
        "[]", "2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z", asset_kind,
    ]
    if not omit_disclosure:
        columns.append("reserve_disclosure")
        values.append(disclosure)
    placeholders = ",".join("?" for _ in columns)
    db.execute(
        f"INSERT INTO auctions({','.join(columns)}) VALUES({placeholders})",
        values,
    )


def expect_u15_rejection(db: sqlite3.Connection, auction_id: int, seller: bytes, **kwargs: object) -> None:
    try:
        insert_auction(db, auction_id, seller, **kwargs)
    except sqlite3.IntegrityError as exc:
        if "VEHICLE_RESERVE_DISCLOSURE_REQUIRED" not in str(exc):
            raise
    else:
        raise AssertionError("U15 accepted an undisclosed vehicle reserve state")


def main() -> None:
    assert_client_contract()
    db = chain.connection()
    chain.apply(db, chain.migration_files())
    seller = db.execute("SELECT id FROM _user WHERE username='takudzwa'").fetchone()
    if seller is None:
        seller = db.execute("SELECT id FROM _user WHERE admin=0 ORDER BY username LIMIT 1").fetchone()
    assert seller is not None

    insert_auction(
        db, 99101, seller[0], asset_kind="vehicle", reserve_price=None,
        disclosure="NO_RESERVE",
    )
    assert db.execute(
        "SELECT reserve_price,reserve_disclosure FROM auctions WHERE id=99101"
    ).fetchone() == (None, "NO_RESERVE")

    insert_auction(
        db, 99102, seller[0], asset_kind="vehicle", reserve_price=15000.0,
        disclosure="RESERVE_APPLIES",
    )
    assert db.execute(
        "SELECT reserve_price,reserve_disclosure FROM auctions WHERE id=99102"
    ).fetchone() == (15000.0, "RESERVE_APPLIES")

    expect_u15_rejection(
        db, 99103, seller[0], asset_kind="vehicle", reserve_price=None,
        disclosure="UNSPECIFIED",
    )
    expect_u15_rejection(
        db, 99104, seller[0], asset_kind="vehicle", reserve_price=None,
        omit_disclosure=True,
    )

    insert_auction(
        db, 99105, seller[0], asset_kind="general", reserve_price=None,
        omit_disclosure=True,
    )
    assert db.execute(
        "SELECT reserve_disclosure FROM auctions WHERE id=99105"
    ).fetchone() == ("UNSPECIFIED",)

    public_columns = {
        row[1] for row in db.execute("PRAGMA table_info(auction_public)")
    }
    assert "reserve_disclosure" in public_columns
    assert "reserve_price" not in public_columns
    print("Vehicle reserve disclosure boundary: PASS")
    print("no-reserve=PASS private-reserve=PASS U15-invalid=BLOCKED non-vehicle=UNCHANGED")
    print("auction_public private reserve redaction=PASS")


if __name__ == "__main__":
    main()
