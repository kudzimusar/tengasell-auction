// Shared small utilities — timestamps, tokens, escaping, clamps.

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/** Normalize SQLite `datetime('now')` ("YYYY-MM-DD HH:MM:SS") or ISO strings to ISO-8601 out. */
export function toIsoOut(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  if (!s) return null;
  if (s.includes("T")) return s;
  return `${s.replace(" ", "T")}Z`;
}

export function randToken(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Random 6-digit verification code (100000…999999). */
export function randCode6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** Parse an int query param with default + max, tolerating junk. */
export function clampInt(raw: string | null, def: number, max: number, min = 0): number {
  if (raw == null || raw === "") return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return def;
  return Math.min(n, max);
}

export function flagBool(v: unknown): 0 | 1 {
  return v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;
}

export function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Flatten whitespace + truncate to a one-line snippet. */
export function snippetOf(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
