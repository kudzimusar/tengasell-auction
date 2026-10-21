// TUCS configuration — hardcoded port, env-activated provider modes, brand palette
// (hexes extracted verbatim from the Next app's src/app/globals.css :root tokens).

export const PORT = 3005;
export const DB_PATH = "/home/z/my-project/db/comms.db";

/** Public app origin used for deep links + unsubscribe URLs (BFF rewrites as needed). */
export const APP_URL = process.env.APP_URL ?? "http://localhost:81";

// ── Provider credentials (absent in sandbox ⇒ fully functional mock mode) ────
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
export const EMAIL_FROM = process.env.EMAIL_FROM ?? "Tengasell <onboarding@resend.dev>";
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN ?? "";
export const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID ?? "";
export const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "";
export const MESSENGER_PAGE_TOKEN = process.env.MESSENGER_PAGE_TOKEN ?? "";
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
