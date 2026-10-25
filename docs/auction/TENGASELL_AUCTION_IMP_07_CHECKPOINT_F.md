# TENGASELL-AUCTION-IMP-07 — CHECKPOINT F

Parent long-run: TENGASELL-AUCTION-IMP-LR02

This checkpoint freezes the IMP-07 implementation layer after the release-gate
ordering remediation discovered by exact-head CI.

Implemented authority:
- one auction settlement per canonical auction order;
- hammer-only default invoice line with no invented fees;
- Finance bridge outbox and idempotent Finance callback authority;
- partial/full/failed/refunded/disputed payment projection;
- statutory transfer-document state distinct from commercial payment;
- fail-closed physical release authorization;
- buyer / representative / transporter collection identity;
- bounded transport booking;
- durable physical handover;
- seller payout state as a Finance-owned mirror, not a second ledger.

No Production deployment or canonical staging mutation is authorized by this
checkpoint.
