-- Paynow settlement journal — durable idempotency for order settlement
-- (R3: webhook-independent completion, crash-safe settlement).
--
-- One row per settlement attempt for a paid session. `reference` is
-- UNIQUE — the atomic claim: the first process to insert wins and every
-- later caller (webhook, return-page poll, reconcile sweep — in any
-- process) reads the claim's state (pending = in flight / recoverable,
-- done = fully settled). Written by the /api/paynow/* routes and the
-- reconcile sweep with the admin token only.

CREATE TABLE IF NOT EXISTS paynow_settlements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reference    TEXT NOT NULL UNIQUE,
  order_id     INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  attempts     INTEGER NOT NULL DEFAULT 1,
  last_error   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_paynow_settlements_order ON paynow_settlements (order_id);
CREATE INDEX IF NOT EXISTS idx_paynow_settlements_status ON paynow_settlements (status);
