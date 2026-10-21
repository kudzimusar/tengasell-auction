// Trust-service configuration — hardcoded port + paths (mirror comms config).

export const PORT = 3007;
export const DB_PATH =
  process.env.TRUST_DB_PATH ?? "/home/z/my-project/db/trust.db";

/** TrailBase (Rust backend) origin + admin credentials (same as trade-engine). */
export const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Tengasell#2025";

/** TUCS comms-service origin for fire-and-forget user notices. */
export const COMMS_BASE = process.env.COMMS_URL ?? "http://127.0.0.1:3005";
export const APP_URL = process.env.APP_URL ?? "http://localhost:81";

/**
 * Shared secret for /internal/* endpoints (12-e platform wiring + finance
 * service). Callers MUST send `x-tgs-internal: <secret>`. BFF user/admin
 * routes use x-tgs-user / x-tgs-admin instead (set by the Next BFF).
 */
export const INTERNAL_SECRET = process.env.TGS_INTERNAL_SECRET ?? "tgs-internal-v1";

/** TOTP (RFC 6238) parameters — HMAC-SHA1, 30s step, 6 digits, ±1 window. */
export const TOTP = {
  issuer: "Tengasell",
  stepSeconds: 30,
  digits: 6,
  window: 1,
  recoveryCodes: 8,
} as const;

/** Ticket first-response SLA hours per priority (SUP-006). */
export const SLA_HOURS: Record<string, number> = {
  urgent: 4,
  high: 12,
  normal: 24,
  low: 48,
};

/** Suspension dual-approval threshold: >7 days (or open-ended) needs a second admin. */
export const DUAL_APPROVAL_DAYS = 7;

/** Ticket attachment cap: 500 KB binary, image mime only (SUP-009). */
export const ATTACHMENT_MAX_BYTES = 500 * 1024;

/** Password recovery code TTL (IAM recovery, consumed by 12-e wiring). */
export const RECOVERY_TTL_MINUTES = 30;
