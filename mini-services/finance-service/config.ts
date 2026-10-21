// finance-service configuration — hardcoded port + db path (MSCS 12-b §B),
// TrailBase admin credentials (same convention as trade-engine), internal
// service secret (§F finance ↔ trust shared header) and the DEFAULT money
// model config (§G). Runtime overrides live in the `config` table and are
// managed via GET/POST /admin/config.

export const PORT = 3006;
export const DB_PATH =
  process.env.FINANCE_DB_PATH ?? "/home/z/my-project/db/finance.db";

export const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Tengasell#2025";

/** Shared internal header (x-tgs-internal) for trust-service ↔ finance calls. */
export const INTERNAL_TOKEN = process.env.TGS_INTERNAL_TOKEN ?? "tengasell-internal-v1";

// ── Default money model (§G MONEY MODEL, canonical) ─────────────────────
// Values are stored in the config table as JSON on first boot and are
// editable at runtime; units: fee_pct/vat_pct are fractions, fee_cap /
// featured_fee / payout_min / dual_approval_threshold are USD, escrow_days
// is days, currency is the display/reporting currency.
export const DEFAULT_CONFIG = {
  fee_pct: 0.08,
  fee_cap: 50,
  featured_fee: 2,
  vat_pct: 0.15,
  payout_min: 10,
  dual_approval_threshold: 100,
  escrow_days: 7,
  currency: "USD",
  /** Refunds up to this USD amount auto-process when raised by an admin. */
  refund_auto_max: 20,
} as const;

export const ALLOWED_CONFIG_KEYS = [
  "fee_pct",
  "fee_cap",
  "featured_fee",
  "vat_pct",
  "payout_min",
  "dual_approval_threshold",
  "escrow_days",
  "currency",
  "refund_auto_max",
] as const;
