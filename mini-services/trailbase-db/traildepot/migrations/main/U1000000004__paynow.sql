-- Paynow payment sessions — one row per payment attempt (Task 6-b).
-- Written by the Next.js /api/paynow/* routes with the admin token only
-- (ACL mirrors the sensitive `payments` table).

CREATE TABLE IF NOT EXISTS paynow_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL,
  reference    TEXT NOT NULL UNIQUE,
  amount       REAL NOT NULL,
  method       TEXT NOT NULL,
  phone        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  poll_url     TEXT,
  redirect_url TEXT,
  paynow_hash  TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_paynow_sessions_order ON paynow_sessions (order_id);
CREATE INDEX IF NOT EXISTS idx_paynow_sessions_status ON paynow_sessions (status);
