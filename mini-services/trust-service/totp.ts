// TOTP (RFC 6238) — implemented with node:crypto only (HMAC-SHA1, 30s step,
// 6 digits, ±1 step verification window). No new dependencies.
//
// Flow (IAM-004 STATE — the UX is wired by Task 12-e via the BFF
// /api/trust/mfa/* routes):
//   1. POST /mfa/enroll     → base32 secret + otpauth:// URI (authenticator app)
//   2. POST /mfa/activate   → verify a current code → active=1 + recovery codes
//   3. POST /mfa/verify     → step-up check (sign-in / sensitive action)
//   4. POST /mfa/disable    → verify a current code → active=0
//
// Recovery codes: 8 codes of the form XXXX-XXXX (A-Z2-9, no confusing chars).
// At-rest storage is HASHED (v2 hardening, MSCS control closure — closes the
// v1 plaintext limitation): /mfa/activate persists ONLY SHA-256 hex hashes
// (sha256 of the normalized code — trim → uppercase → strip whitespace) in
// mfa.recovery_codes and returns the plaintext list exactly ONCE for the user
// to save. Verification hashes the presented code and compares against the
// stored hashes, consuming (splicing) the match on use — same single-use
// semantics as v1. A one-time boot migration in db.ts hashes any pre-v2
// plaintext rows IN PLACE, detected by regex:
//   plaintext: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/   vs   hashed: /^[a-f0-9]{64}$/

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { TOTP } from "./config";

// ── Base32 (RFC 4648, no padding) ────────────────────────────────────────

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ── HOTP / TOTP (RFC 4226 §5.3 dynamic truncation + RFC 6238) ─────────────

function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Current TOTP code for a base32 secret (test/self-test + demo helper). */
export function totpNow(secretB32: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TOTP.stepSeconds);
  return hotp(base32Decode(secretB32), counter, TOTP.digits);
}

/** Verify a 6-digit code with the ±1 step window (RFC 6238 §5.2). */
export function totpVerify(secretB32: string, code: string, atMs = Date.now()): boolean {
  const normalized = code.replace(/\D/g, "");
  if (normalized.length !== TOTP.digits) return false;
  const counter = Math.floor(atMs / 1000 / TOTP.stepSeconds);
  for (let drift = -TOTP.window; drift <= TOTP.window; drift++) {
    const candidate = hotp(base32Decode(secretB32), counter + drift, TOTP.digits);
    if (candidate === normalized) return true;
  }
  return false;
}

/** Fresh 20-byte (160-bit) base32 secret — RFC 4226 §4 recommendation. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** otpauth:// URI for authenticator apps (QR-content; 12-e renders the QR). */
export function otpauthUri(username: string, secretB32: string): string {
  const label = encodeURIComponent(`${TOTP.issuer}:${username}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer: TOTP.issuer,
    algorithm: "SHA1",
    digits: String(TOTP.digits),
    period: String(TOTP.stepSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Recovery codes ───────────────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1

const RECOVERY_PLAINTEXT_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const RECOVERY_HASH_RE = /^[a-f0-9]{64}$/;

/** Canonical comparison form: trim → uppercase → strip all whitespace. */
export function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/** SHA-256 hex hash of a recovery code — the ONLY form persisted at rest. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** True when the value is still a v1 PLAINTEXT code (needs boot-migration). */
export function isPlaintextRecoveryCode(value: string): boolean {
  return RECOVERY_PLAINTEXT_RE.test(value);
}

/** True when the value is already a v2 sha256 hex hash. */
export function isHashedRecoveryCode(value: string): boolean {
  return RECOVERY_HASH_RE.test(value);
}

/** 8 recovery codes like "7K2M-9QWX" — shown ONCE in clear; only sha256
 *  hashes are persisted at rest (see header). */
export function generateRecoveryCodes(count = TOTP.recoveryCodes): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let a = "";
    let b = "";
    const bytes = randomBytes(8);
    for (let j = 0; j < 4; j++) a += CODE_ALPHABET[bytes[j] % CODE_ALPHABET.length];
    for (let j = 4; j < 8; j++) b += CODE_ALPHABET[bytes[j] % CODE_ALPHABET.length];
    codes.push(`${a}-${b}`);
  }
  return codes;
}

/** Random 6-digit password-recovery code (hashed before storage). */
export function generateRecoveryCode6(): string {
  return String(100000 + (randomBytes(4).readUInt32BE(0) % 900000));
}

/** UUID for the second-admin seed row (TrailBase _user.id is a BLOB uuid). */
export function uuidBlob(): Buffer {
  return Buffer.from(randomUUID().replace(/-/g, ""), "hex");
}
