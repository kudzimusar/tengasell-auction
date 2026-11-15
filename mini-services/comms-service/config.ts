// TUCS configuration — hardcoded port, env-activated provider modes, brand palette
// (hexes extracted verbatim from the Next app's src/app/globals.css :root tokens).

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export const PORT = 3005;

export const BANNED_LEGACY_SECRETS: ReadonlySet<string> = new Set([
  "tgs_sec_internal_comms_default_k9102",
  "secret",
  "password",
  "changeme",
]);

export const MIN_INTERNAL_SECRET_LENGTH = 16;

/**
 * Validates whether the credential possesses sufficient cryptographic entropy.
 * Rejects low-entropy strings, single-character repetitions, and obvious patterns.
 */
export function isSufficientEntropy(secret: string): boolean {
  if (secret.length < MIN_INTERNAL_SECRET_LENGTH) return false;
  // Unique character diversity check
  const uniqueChars = new Set(secret);
  if (uniqueChars.size < 6) return false;
  // Repetitive or trivial patterns
  const lower = secret.toLowerCase();
  const trivialPatterns = [
    "1234567890123456",
    "abcdefghijklmnop",
    "password12345678",
    "adminadminadmin1",
    "aaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbb",
    "0000000000000000",
  ];
  for (const p of trivialPatterns) {
    if (lower.includes(p)) return false;
  }
  return true;
}

/**
 * Validates whether the environment has a cryptographically sound internal service secret configured.
 * Strictly rejects unset, empty, short (<16 chars), low-entropy, and known legacy default credentials.
 */
export function isInternalSecretConfigured(): boolean {
  const secret = process.env.INTERNAL_COMMS_SECRET;
  if (!secret || typeof secret !== "string") return false;
  const trimmed = secret.trim();
  if (!isSufficientEntropy(trimmed)) return false;
  if (BANNED_LEGACY_SECRETS.has(trimmed)) return false;
  return true;
}

/**
 * Returns the configured internal secret, or null if unconfigured/invalid.
 */
export function getInternalCommsSecret(): string | null {
  if (!isInternalSecretConfigured()) return null;
  return process.env.INTERNAL_COMMS_SECRET!.trim();
}

/**
 * Constant-time comparison of the incoming header value against the configured internal secret.
 * Fails closed if the secret is unconfigured, header is missing, or values do not match.
 */
export function verifyInternalSecret(candidate: string | null | undefined): boolean {
  if (!isInternalSecretConfigured()) return false;
  if (!candidate || typeof candidate !== "string") return false;
  const expected = process.env.INTERNAL_COMMS_SECRET!.trim();
  const actual = candidate.trim();
  if (actual.length !== expected.length) return false;
  try {
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(actual, "utf8");
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

export const TRAILBASE_URL =
  process.env.TRAILBASE_URL || "http://127.0.0.1:3001";

function resolveDbPath(): string {
  if (process.env.COMMS_DB_PATH) return process.env.COMMS_DB_PATH;
  if (fs.existsSync("/home/z/my-project")) return "/home/z/my-project/db/comms.db";
  return path.resolve(process.cwd(), "db/comms.db");
}

export const DB_PATH = resolveDbPath();

/** Public app origin used for deep links + unsubscribe URLs (BFF rewrites as needed). */
export const APP_URL = process.env.APP_URL ?? "http://localhost:81";

// ── Provider credentials (R3A hard-locks external providers to mock mode: $0 spend) ────
const allowExternal = process.env.COMMS_ALLOW_EXTERNAL_R4 === "1";
export const RESEND_API_KEY = allowExternal ? (process.env.RESEND_API_KEY ?? "") : "";
export const EMAIL_FROM = process.env.EMAIL_FROM ?? "Tengasell <onboarding@resend.dev>";
export const TELEGRAM_BOT_TOKEN = allowExternal ? (process.env.TELEGRAM_BOT_TOKEN ?? "") : "";
export const WHATSAPP_TOKEN = allowExternal ? (process.env.WHATSAPP_TOKEN ?? "") : "";
export const WHATSAPP_PHONE_ID = allowExternal ? (process.env.WHATSAPP_PHONE_ID ?? "") : "";
export const WHATSAPP_APP_SECRET = allowExternal ? (process.env.WHATSAPP_APP_SECRET ?? "") : "";
export const MESSENGER_PAGE_TOKEN = allowExternal ? (process.env.MESSENGER_PAGE_TOKEN ?? "") : "";
export const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION ?? "v20.0";

// ── Brand palette (from src/app/globals.css :root — read-only extraction) ─────
export const BRAND = {
  teal: "#19717b",
  tealDeep: "#0f4a50",
  tealSoft: "#2e8a93",
  tealTint: "#e6f1f2",
  gold: "#dfae2e",
  goldDeep: "#af7a14",
  goldSoft: "#f8ecc8",
  goldOn: "#3a2b05",
  tag: "#c47d1a",
  ink: "#1c2424",
  muted: "#5c6a6a",
  hairline: "#e3e7e5",
  canvas: "#eef2f1",
} as const;

// ── Moderation masks (contract section D) ─────────────────────────────────────
export const CONTACT_MASK = "[contact removed — keep it on Tengasell]";
export const PHONE_MASK = "[phone removed]";
