// TUCS moderation pipeline — contract section D, in pinned order:
//   length ≤ 2000 → banned words → PII scrub (emails / phones / contact-steering
//   phrases / non-tengasell URLs) → advance-fee fraud heuristics → per-thread
//   rate limit (30 msgs/hour/sender).
// Verdict: clean | masked (delivered with masks) | blocked | review.

import { CONTACT_MASK, PHONE_MASK } from "./config";
import { scalar } from "./db";

export interface ModerationFlag {
  rule: "length" | "banned_word" | "pii" | "fraud" | "gray" | "rate_limit";
  kind?: "email" | "phone" | "steering" | "url";
  detail?: string;
}

export type Verdict = "clean" | "masked" | "blocked" | "review";

export interface ModerationResult {
  status: Verdict;
  maskedContent: string;
  flags: ModerationFlag[];
}

const MAX_LEN = 2000;
const RATE_LIMIT_PER_HOUR = 30;

// Banned words — small in-code list incl. slurs/scam-bait. Substring match on
// lowercased content.
const BANNED: string[] = [
  "nigger",
  "faggot",
  "kaffir",
  "chink",
  "wetback",
  "coon",
  "motherfucker",
  "cunt",
  "bitch",
  "bastard",
];

// Advance-fee / 419 fraud wording (checked AFTER PII scrub, per contract order).
const FRAUD: string[] = [
  "advance fee",
  "processing fee",
  "upfront fee",
  "lottery winner",
  "won the lottery",
  "inheritance fund",
  "next of kin",
  "unclaimed funds",
  "claim your winnings",
  "fund release fee",
  "transfer fee required",
  "dear beneficiary",
  "dear winner",
  "atm card",
  "419",
];

// Gray-list → verdict "review" (held for admin moderation queue).
const GRAY: string[] = [
  "pay me directly",
  "outside tengasell",
  "off the platform",
  "off-platform",
  "direct transfer",
  "western union",
  "moneygram",
  "mukuru",
  "gift card",
  "cash only",
  "no receipt",
  "meet me in person",
  "private deal",
  "side deal",
  "my personal number",
  "bypass",
  "dont use the app",
  "don't use the app",
];

// Contact-steering phrases — longest first so "whatsapp me" masks before bare
// "whatsapp".
const STEERING: string[] = [
  "whatsapp me",
  "inbox me on",
  "inbox me at",
  "call me on",
  "call me at",
  "phone me on",
  "text me on",
  "text me at",
  "telegram me",
  "dm me on",
  "dm me at",
  "hit me up on",
  "hit me on",
  "reach me on",
  "reach me at",
  "email me at",
  "contact me on",
  "contact me at",
  "add me on",
  "find me on",
  "whatsapp",
];

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RES: RegExp[] = [
  /\+?263[\s-]?\d{3}[\s-]?\d{3,6}/g, // +263 772 123 456
  /\b07\d{2}[\s-]?\d{3}[\s-]?\d{3,4}\b/g, // 0771234567 / 077-123-4567
  /\b0\d{2}-\d{3}-\d{3,4}\b/g, // 024-274-7077 landline "0XX-…" pattern
];
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ModerateOpts {
  threadId?: string | null;
  senderId?: string | null;
  skipRateLimit?: boolean;
}

export function moderate(content: string, opts: ModerateOpts = {}): ModerationResult {
  const flags: ModerationFlag[] = [];
  let blocked = false;
  let review = false;

  // 1. Length gate.
  if (content.length > MAX_LEN) {
    flags.push({ rule: "length", detail: `${content.length} > ${MAX_LEN}` });
    blocked = true;
  }

  // 2. Banned words (slurs / scam-bait).
  const lower = content.toLowerCase();
  for (const w of BANNED) {
    if (lower.includes(w)) {
      flags.push({ rule: "banned_word", detail: w });
      blocked = true;
      break;
    }
  }

  // 3. PII scrub — emails → phones → steering phrases → non-tengasell URLs.
  let masked = content;
  masked = masked.replace(EMAIL_RE, () => {
    flags.push({ rule: "pii", kind: "email" });
    return CONTACT_MASK;
  });
  for (const re of PHONE_RES) {
    masked = masked.replace(re, () => {
      flags.push({ rule: "pii", kind: "phone" });
      return PHONE_MASK;
    });
  }
  const steeringSorted = [...STEERING].sort((a, b) => b.length - a.length);
  for (const phrase of steeringSorted) {
    const re = new RegExp(escapeRe(phrase), "gi");
    masked = masked.replace(re, () => {
      flags.push({ rule: "pii", kind: "steering", detail: phrase });
      return CONTACT_MASK;
    });
  }
  masked = masked.replace(URL_RE, (m) => {
    if (/tengasell/i.test(m)) return m; // on-platform links stay
    flags.push({ rule: "pii", kind: "url" });
    return CONTACT_MASK;
  });

  // 4. Advance-fee fraud heuristics (on the scrubbed text).
  const maskedLower = masked.toLowerCase();
  for (const w of FRAUD) {
    if (maskedLower.includes(w)) {
      flags.push({ rule: "fraud", detail: w });
      blocked = true;
      break;
    }
  }

  // 5. Gray-list → review.
  for (const w of GRAY) {
    if (maskedLower.includes(w)) {
      flags.push({ rule: "gray", detail: w });
      review = true;
      break;
    }
  }

  // 6. Per-thread rate limit — 30 msgs/hour/sender (relay_log rows in last hour).
  if (!opts.skipRateLimit && opts.threadId && opts.senderId) {
    const n = scalar(
      `SELECT COUNT(*) AS n FROM relay_log
       WHERE thread_id = ? AND from_user_id = ?
         AND datetime(created_at) >= datetime('now', '-1 hour')`,
      [opts.threadId, opts.senderId],
    );
    if (n >= RATE_LIMIT_PER_HOUR) {
      flags.push({ rule: "rate_limit", detail: `${RATE_LIMIT_PER_HOUR} msgs/hour` });
      blocked = true;
    }
  }

  let status: Verdict = "clean";
  if (blocked) status = "blocked";
  else if (review) status = "review";
  else if (masked !== content) status = "masked";

  return { status, maskedContent: masked, flags };
}
