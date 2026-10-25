#!/usr/bin/env python3
"""IMP-08 task authority, timeline, exception and operations DB proof."""

from __future__ import annotations
import sqlite3
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "mini-services/trailbase-db/traildepot/migrations/main"

def db_connection() -> sqlite3.Connection:
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=OFF")
    db.create_function("uuid_v4",0,lambda: sqlite3.Binary(uuid.uuid4().bytes))
    db.create_function("hash_password",1,lambda value:f"test-hash:{value}")
    db.execute("""CREATE TABLE _user(
      id BLOB PRIMARY KEY,email TEXT,username TEXT UNIQUE,password_hash TEXT,
      verified INTEGER NOT NULL DEFAULT 0,admin INTEGER NOT NULL DEFAULT 0
    )""")
    for path in sorted(MIGRATIONS.glob("U*.sql")):
        db.executescript(path.read_text())
    return db

def main() -> None:
    db=db_connection()
    admin=db.execute("SELECT id,username FROM _user WHERE admin=1 ORDER BY username LIMIT 1").fetchone()
    ordinary=db.execute("SELECT id,username FROM _user WHERE admin=0 ORDER BY username LIMIT 1").fetchone()
    assert admin and ordinary

    # Scoped operational grant reuses existing identity; no second user table.
    db.execute("""INSERT INTO auction_operation_grants(
      user,username,capability,scope_key,active,granted_by,granted_by_username,reason,granted_at
    ) VALUES(?,?,'FINANCE_OPERATOR','GLOBAL',1,?,?,'Finance desk test','2030-01-01T00:00:00Z')""",
      (ordinary[0],ordinary[1],admin[0],admin[1]))
    assert db.execute("""SELECT capability FROM auction_operation_grants
                         WHERE user=? AND active=1""",(ordinary[0],)).fetchone() == ("FINANCE_OPERATOR",)

    # Qualification PENDING automatically becomes real work exactly once.
    db.execute("""INSERT INTO auction_bidder_qualifications(
      event_id,user,username,status,qualification_basis,approved_limit,account_state,risk_state,
      deposit_state,deposit_amount,credit_state,credit_limit,version,created_at,updated_at
    ) VALUES(777,?,?,'PENDING','MANUAL_REVIEW',0,'ELIGIBLE','CLEAR',
             'NOT_REQUIRED',0,'NONE',0,0,'2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
      (ordinary[0],ordinary[1]))
    qualification_id=db.execute("SELECT last_insert_rowid()").fetchone()[0]
    assert db.execute("""SELECT task_type,status,required_capability FROM auction_tasks
                         WHERE source_key=?""",(f"qualification:{qualification_id}",)).fetchone() == (
                           "QUALIFICATION_REVIEW","TODO","QUALIFICATION_REVIEWER"
                         )

    # Settlement creates payment task with authoritative payment deadline.
    db.execute("""INSERT INTO auction_settlements(
      order_id,auction_id,event_id,buyer_user,buyer_username,seller_user,seller_username,
      hammer_price,invoice_total,paid_amount,outstanding_amount,payment_state,settlement_deadline,
      transfer_state,dispute_state,release_state,transport_state,completion_state,finance_bridge_state,
      seller_payout_state,created_at,updated_at
    ) VALUES(5001,6001,777,?,'buyer',?,'seller',1000,1000,0,1000,'PENDING',
             '2030-01-05T00:00:00Z','NOT_STARTED','NONE','BLOCKED','NOT_REQUESTED','OPEN',
             'INVOICE_REQUIRED','FINANCE_PENDING','2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
      (ordinary[0],admin[0]))
    settlement_id=db.execute("SELECT last_insert_rowid()").fetchone()[0]
    payment_task=db.execute("""SELECT id,status,due_at,required_capability FROM auction_tasks
                               WHERE source_key=?""",(f"payment:{settlement_id}",)).fetchone()
    assert payment_task[1:] == ("TODO","2030-01-05T00:00:00Z","FINANCE_OPERATOR")

    # Finance callback completes payment task and creates transfer work idempotently.
    db.execute("""INSERT INTO auction_finance_callbacks(
      idempotency_key,settlement_id,order_id,event_type,amount,currency,source_reference,
      actor_user,actor_username,actor_admin
    ) VALUES('ops-fin-paid',?,5001,'PAYMENT_CAPTURED',1000,'USD','FIN-OPS',?,?,1)""",
      (settlement_id,admin[0],admin[1]))
    assert db.execute("SELECT status FROM auction_tasks WHERE id=?",(payment_task[0],)).fetchone() == ("DONE",)
    assert db.execute("""SELECT task_type,status FROM auction_tasks WHERE source_key=?""",
                      (f"transfer:{settlement_id}",)).fetchone() == ("TRANSFER_DOCUMENT_REVIEW","TODO")

    # Transfer completion closes transfer task and creates release preparation.
    db.execute("""INSERT INTO auction_transfer_commands(
      command_key,settlement_id,actor_user,actor_username,actor_admin,command_type
    ) VALUES('ops-transfer-complete',?,?,?,1,'COMPLETE')""",(settlement_id,admin[0],admin[1]))
    assert db.execute("SELECT status FROM auction_tasks WHERE source_key=?",(f"transfer:{settlement_id}",)).fetchone() == ("DONE",)
    assert db.execute("""SELECT task_type,status,required_capability FROM auction_tasks
                         WHERE source_key=?""",(f"release:{settlement_id}",)).fetchone() == (
                           "RELEASE_PREPARATION","TODO","RELEASE_OPERATOR"
                         )

    # Release authorization closes prep and creates collection preparation.
    db.execute("""INSERT INTO auction_release_commands(
      command_key,settlement_id,actor_user,actor_username,actor_admin,collector_type,
      collector_user,collector_name,collector_reference
    ) VALUES('ops-release',?,?,?,1,'BUYER',?,'Synthetic Buyer','ID-1')""",
      (settlement_id,admin[0],admin[1],ordinary[0]))
    assert db.execute("SELECT status FROM auction_tasks WHERE source_key=?",(f"release:{settlement_id}",)).fetchone() == ("DONE",)
    assert db.execute("""SELECT task_type,status FROM auction_tasks WHERE source_key=?""",
                      (f"collection:{settlement_id}",)).fetchone() == ("COLLECTION_PREPARATION","TODO")

    # Transport creates a task + immutable timeline event.
    db.execute("""INSERT INTO auction_transport_bookings(
      request_key,settlement_id,requested_by,requested_by_username,transporter,pickup_location,
      destination,scheduled_at,status,created_at,updated_at
    ) VALUES('ops-transport',?,?,?,'Carrier','Harare','Bulawayo',NULL,'REQUESTED',
             '2030-01-02T00:00:00Z','2030-01-02T00:00:00Z')""",
      (settlement_id,ordinary[0],ordinary[1]))
    transport_id=db.execute("SELECT last_insert_rowid()").fetchone()[0]
    assert db.execute("""SELECT task_type,status,required_capability FROM auction_tasks
                         WHERE source_key=?""",(f"transport:{transport_id}",)).fetchone() == (
                           "TRANSPORT_SCHEDULING","TODO","TRANSPORT_OPERATOR"
                         )
    assert db.execute("""SELECT COUNT(*) FROM auction_timeline_events
                         WHERE settlement_id=? AND event_type='TRANSPORT_REQUESTED'""",(settlement_id,)).fetchone()[0] == 1

    # Task commands are permission checked, audited into timeline, and idempotent.
    task_id=db.execute("SELECT id FROM auction_tasks WHERE source_key=?",(f"transport:{transport_id}",)).fetchone()[0]
    db.execute("""INSERT INTO auction_task_commands(
      command_key,task_id,actor_user,actor_username,actor_authorized,command_type,reason
    ) VALUES('task-denied',?,?,?,0,'START','No grant')""",(task_id,ordinary[0],ordinary[1]))
    assert db.execute("SELECT status,error_code FROM auction_task_commands WHERE command_key='task-denied'").fetchone() == (
      "rejected","TASK_PERMISSION_REQUIRED"
    )
    db.execute("""INSERT INTO auction_task_commands(
      command_key,task_id,actor_user,actor_username,actor_authorized,command_type,reason
    ) VALUES('task-start',?,?,?,1,'START','Transport desk accepted work')""",(task_id,ordinary[0],ordinary[1]))
    assert db.execute("SELECT status FROM auction_tasks WHERE id=?",(task_id,)).fetchone() == ("IN_PROGRESS",)
    db.execute("""INSERT INTO auction_task_commands(
      command_key,task_id,actor_user,actor_username,actor_authorized,command_type,reason
    ) VALUES('task-complete',?,?,?,1,'COMPLETE','Transport scheduled externally')""",(task_id,ordinary[0],ordinary[1]))
    assert db.execute("SELECT status,resolution FROM auction_tasks WHERE id=?",(task_id,)).fetchone() == (
      "DONE","Transport scheduled externally"
    )
    try:
        db.execute("""INSERT INTO auction_task_commands(
          command_key,task_id,actor_user,actor_username,actor_authorized,command_type
        ) VALUES('task-complete',?,?,?,1,'COMPLETE')""",(task_id,ordinary[0],ordinary[1]))
        raise AssertionError("duplicate task command inserted")
    except sqlite3.IntegrityError:
        pass
    assert db.execute("""SELECT COUNT(*) FROM auction_timeline_events
                         WHERE entity_type='task' AND entity_id=?""",(task_id,)).fetchone()[0] == 2

    # Timeline is immutable at the DB boundary.
    timeline_id=db.execute("SELECT id FROM auction_timeline_events LIMIT 1").fetchone()[0]
    try:
        db.execute("UPDATE auction_timeline_events SET event_type='TAMPERED' WHERE id=?",(timeline_id,))
        raise AssertionError("timeline update unexpectedly succeeded")
    except sqlite3.IntegrityError as exc:
        assert "TIMELINE_IMMUTABLE" in str(exc)
    try:
        db.execute("DELETE FROM auction_timeline_events WHERE id=?",(timeline_id,))
        raise AssertionError("timeline delete unexpectedly succeeded")
    except sqlite3.IntegrityError as exc:
        assert "TIMELINE_IMMUTABLE" in str(exc)

    # Exception projection identifies what is blocked and resolver capability.
    db.execute("""INSERT INTO auction_settlements(
      order_id,auction_id,event_id,buyer_user,buyer_username,seller_user,seller_username,
      hammer_price,invoice_total,paid_amount,outstanding_amount,payment_state,settlement_deadline,
      transfer_state,dispute_state,release_state,transport_state,completion_state,finance_bridge_state,
      seller_payout_state,created_at,updated_at
    ) VALUES(5002,6002,777,?,'buyer',?,'seller',500,500,0,500,'PENDING',
             '2020-01-01T00:00:00Z','NOT_STARTED','NONE','BLOCKED','NOT_REQUESTED','OPEN',
             'INVOICE_REQUIRED','FINANCE_PENDING','2030-01-01T00:00:00Z','2030-01-01T00:00:00Z')""",
      (ordinary[0],admin[0]))
    overdue_id=db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.execute("UPDATE auction_settlements SET updated_at='2030-01-02T00:00:00Z' WHERE id=?",(overdue_id,))
    alert=db.execute("""SELECT alert_type,blocked_action,resolver_capability,status
                        FROM auction_operator_alerts WHERE alert_key=?""",(f"settlement:{overdue_id}:payment-overdue",)).fetchone()
    assert alert == ("PAYMENT_OVERDUE","TRANSFER_AND_RELEASE","FINANCE_OPERATOR","OPEN")

    print("IMP-08 operational authority: PASS")
    print("  automatic tasks + idempotent task commands: PASS")
    print("  qualification/payment/transfer/release/transport queues: PASS")
    print("  immutable timeline + audit projection: PASS")
    print("  role-restricted task mutation: PASS")
    print("  exception blocker/resolver projection: PASS")
    db.close()

if __name__ == "__main__":
    main()
