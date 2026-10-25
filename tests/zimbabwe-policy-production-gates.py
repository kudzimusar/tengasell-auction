#!/usr/bin/env python3
"""IMP-09 Zimbabwe auction policy + production-governance DB proof."""

from __future__ import annotations
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAIN = ROOT / "tests/trailbase-migration-chain.py"

spec = importlib.util.spec_from_file_location("migration_chain", CHAIN)
chain = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(chain)

def main() -> None:
    db = chain.connection()
    chain.apply(db, chain.migration_files())

    admin = db.execute("SELECT id,username FROM _user WHERE admin=1 ORDER BY username LIMIT 1").fetchone()
    users = db.execute("SELECT id,username FROM _user WHERE admin=0 ORDER BY username LIMIT 3").fetchall()
    assert admin and len(users) >= 2
    bidder = users[0]

    # Production policy starts fail-closed: no invented Owner/Finance values.
    missing = {
        row[0] for row in db.execute(
            "SELECT policy_key FROM auction_policy_registry WHERE required_for_production=1 AND configured=0"
        )
    }
    expected_missing = {
        "business.supplier_disclosure_profile",
        "business.auction_duration_minutes",
        "business.payment_deadline_hours",
        "business.deposit_policy",
        "business.fee_policy",
        "business.customs_verification_policy",
    }
    assert expected_missing.issubset(missing), missing

    # Legal/business classification is explicit.
    legal = db.execute(
        "SELECT classification,configured FROM auction_policy_registry WHERE policy_key='legal.auction.completion_retraction'"
    ).fetchone()
    assert legal == ("LEGALLY_REQUIRED",1)
    customs = db.execute(
        "SELECT classification,configured FROM auction_policy_registry WHERE policy_key='business.customs_verification_policy'"
    ).fetchone()
    assert customs == ("PENDING_LEGAL_REVIEW",0)

    # Ordinary users cannot mutate production policy; admins can do so with a reason.
    db.execute(
        """INSERT INTO auction_policy_commands(
          command_key,policy_key,actor_user,actor_username,actor_admin,value_json,configured,reason
        ) VALUES('policy-denied','business.deposit_policy',?,?,0,'{"enabled":false}',1,'self escalation attempt')""",
        (bidder[0],bidder[1]),
    )
    assert db.execute(
        "SELECT status,error_code FROM auction_policy_commands WHERE command_key='policy-denied'"
    ).fetchone() == ("rejected","POLICY_ADMIN_REQUIRED")

    db.execute(
        """INSERT INTO auction_policy_commands(
          command_key,policy_key,actor_user,actor_username,actor_admin,value_json,configured,reason
        ) VALUES('policy-admin','business.deposit_policy',?,?,1,'{"enabled":false}',1,'Owner policy explicitly disables deposit for certification fixture')""",
        (admin[0],admin[1]),
    )
    assert db.execute(
        "SELECT status,error_code FROM auction_policy_commands WHERE command_key='policy-admin'"
    ).fetchone() == ("accepted",None)
    assert db.execute(
        "SELECT configured,json_extract(value_json,'$.enabled') FROM auction_policy_registry WHERE policy_key='business.deposit_policy'"
    ).fetchone() == (1,0)

    # Public auction projection must never expose the private reserve amount.
    public_cols = {row[1] for row in db.execute("PRAGMA table_info(auction_public)")}
    assert "reserve_price" not in public_cols
    assert {"reserve_disclosure","owner_bid_right_disclosure"}.issubset(public_cols)

    # Create a fresh disposable general auction so policy proof is independent
    # of seeded bid history. It becomes a whole-vehicle auction only after the
    # accepted IMP-04 eligibility evidence is present.
    seller = users[0]
    bidder = users[1]
    auction_id = 99001
    current_price = 1000.0
    db.execute(
        """INSERT INTO auctions(
          id,user,seller_username,title,slug,description,category,condition,
          start_price,current_price,bid_count,watch_count,views,shipping_fee,shipping,city,
          ends_at,started_at,status,extension_count,featured,images,created_at,updated_at,
          allow_offers,asset_kind
        ) VALUES(?,?,?,'Zimbabwe policy synthetic lot','zw-policy-synthetic',
                 'Disposable IMP-09 policy fixture','vehicles','used',
                 ?,?,0,0,0,0,'pickup','Harare',
                 datetime('now','+4 hours'),datetime('now','-1 hour'),'live',0,0,'[]',
                 datetime('now'),datetime('now'),0,'general')""",
        (auction_id,seller[0],seller[1],current_price,current_price),
    )
    seller_user = seller[0]
    seller_username = seller[1]

    event_id = db.execute(
        """INSERT INTO auction_events(
          host_user,host_username,title,description,starts_at,status,created_at,updated_at
        ) VALUES(?,?,?,'','2030-01-01T10:00:00Z','SCHEDULED',
                 '2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
        (admin[0],admin[1],"Zimbabwe policy proof event"),
    ).lastrowid
    session_id = db.execute("SELECT session_id FROM auction_events WHERE id=?",(event_id,)).fetchone()[0]
    db.execute(
        """INSERT INTO auction_lots(
          event_id,session_id,auction_id,sequence_no,status,original_ends_at,created_by,created_at,updated_at
        ) VALUES(?,?,?,1,'READY',(SELECT ends_at FROM auctions WHERE id=?),?,
                 '2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
        (event_id,session_id,auction_id,auction_id,admin[0]),
    )

    # Keep the disposable fixture genuinely live and prepare the accepted
    # IMP-04 eligibility evidence before changing whole-vehicle authority.
    vehicle_id = db.execute(
        """INSERT INTO vehicles(
          auction_id,seller_user,seller_username,vin,make,model,model_year,fuel_type,
          transmission,drivetrain,odometer_km,location_city,ownership_status,customs_status,
          declaration_accepted_at,lifecycle,created_at,updated_at
        ) VALUES(?,?,?,'JT987654321012345','Toyota','Policy Fixture',2021,'DIESEL',
                 'AUTOMATIC','4WD',50000,'Harare','DECLARED_OWNER','CLEARED',
                 '2030-01-01T00:00:00Z','ELIGIBLE',
                 '2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
        (auction_id,seller_user,seller_username),
    ).lastrowid
    db.execute(
        """INSERT INTO vehicle_eligibility(
          vehicle_id,inspection_id,version,status,decided_by,decided_at,created_at
        ) VALUES(?,9901,1,'ELIGIBLE',?,'2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
        (vehicle_id,admin[0]),
    )

    # Canonical command creates an active bid. Make it >60 minutes old to prove
    # the historical LR01 time-window rule is NOT applied to the vehicle policy.
    db.execute(
        """INSERT INTO auction_commands(
          command_key,auction_id,actor_user,actor_username,actor_admin,command_type,max_amount
        ) VALUES('zw-policy-bid-1',?,?,?,?, 'PLACE_BID',?)""",
        (auction_id,bidder[0],bidder[1],0,float(current_price)+100),
    )
    command = db.execute(
        "SELECT status,error_code,result_price FROM auction_commands WHERE command_key='zw-policy-bid-1'"
    ).fetchone()
    assert command and command[0] == "accepted", command
    bid = db.execute(
        "SELECT id FROM bids WHERE auction_id=? AND user=? AND status='active' ORDER BY id DESC LIMIT 1",
        (auction_id,bidder[0]),
    ).fetchone()
    assert bid
    bid_id = bid[0]
    db.execute("UPDATE bids SET created_at=datetime('now','-2 hours') WHERE id=?",(bid_id,))
    db.execute(
        """UPDATE auctions
              SET asset_kind='vehicle',
                  reserve_disclosure=CASE WHEN reserve_price IS NULL THEN 'NO_RESERVE' ELSE 'RESERVE_APPLIES' END,
                  commercial_policy_ready=1
            WHERE id=?""",
        (auction_id,),
    )
    current_version = db.execute("SELECT version FROM auctions WHERE id=?",(auction_id,)).fetchone()[0]

    db.execute(
        """INSERT INTO auction_policy_retraction_requests(
          command_key,auction_id,event_id,target_bid_id,requester_user,requester_username,
          requester_admin,reason,expected_version
        ) VALUES('zw-retract-pre-completion',?,?,?,?,?,0,'Bidder requests retraction before hammer completion',?)""",
        (auction_id,event_id,bid_id,bidder[0],bidder[1],current_version),
    )
    retraction = db.execute(
        """SELECT status,error_code,decision_basis FROM auction_policy_retraction_requests
           WHERE command_key='zw-retract-pre-completion'"""
    ).fetchone()
    assert retraction == ("accepted",None,"ZW_CPA_S39_PRE_COMPLETION_RETRACTION"), retraction
    assert db.execute("SELECT status FROM bids WHERE id=?",(bid_id,)).fetchone() == ("retracted",)

    # A new active bid cannot be policy-retracted after auction completion.
    db.execute(
        """INSERT INTO auction_commands(
          command_key,auction_id,actor_user,actor_username,actor_admin,command_type,max_amount
        ) VALUES('zw-policy-bid-2',?,?,?,?, 'PLACE_BID',?)""",
        (auction_id,bidder[0],bidder[1],0,float(current_price)+150),
    )
    active2 = db.execute(
        "SELECT id FROM bids WHERE auction_id=? AND user=? AND status='active' ORDER BY id DESC LIMIT 1",
        (auction_id,bidder[0]),
    ).fetchone()
    assert active2
    db.execute("UPDATE auctions SET status='sold' WHERE id=?",(auction_id,))
    version2 = db.execute("SELECT version FROM auctions WHERE id=?",(auction_id,)).fetchone()[0]
    db.execute(
        """INSERT INTO auction_policy_retraction_requests(
          command_key,auction_id,event_id,target_bid_id,requester_user,requester_username,
          requester_admin,reason,expected_version
        ) VALUES('zw-retract-after-completion',?,?,?,?,?,0,'Attempt after auction completion',?)""",
        (auction_id,event_id,active2[0],bidder[0],bidder[1],version2),
    )
    assert db.execute(
        """SELECT status,error_code FROM auction_policy_retraction_requests
           WHERE command_key='zw-retract-after-completion'"""
    ).fetchone() == ("rejected","AUCTION_ALREADY_COMPLETE")

    # Observability records operational result without private proxy maxima.
    observed = db.execute(
        "SELECT signal,metrics_json FROM auction_observability_events ORDER BY id"
    ).fetchall()
    for signal,payload in observed:
        assert "max_amount" not in (payload or "")
        assert "proxy" not in (payload or "").lower()

    print("IMP-09 Zimbabwe policy + production governance DB proof: PASS")
    print("  required business policy starts fail-closed: PASS")
    print("  admin policy governance / ordinary escalation block: PASS")
    print("  public reserve amount redaction: PASS")
    print("  vehicle pre-completion retraction ignores historical 60-minute rule: PASS")
    print("  post-completion retraction=BLOCKED: PASS")
    print("  privacy-safe observability payloads: PASS")
    db.close()

if __name__ == "__main__":
    main()
