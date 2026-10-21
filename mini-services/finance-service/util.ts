// Shared small utilities — timestamps, cents math, JSON, clamps.
// Mirrors the comms-service util.ts conventions (Task 11-a).

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

/** Dollars (float) → integer cents, rounding to the nearest cent. */
export function toCents(dollars: number): number {
  return Math.round(Number(dollars) * 100);
}

/** Integer cents → dollars string with 2 decimals ("12.50"). */
export function centsToUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function randToken(bytes = 12): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
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

/** Accept "25", 25 or "US$25" style dollar input → cents; null when invalid. */
export function parseAmountCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** First + last day of a "YYYY-MM" month as ISO date strings. */
export function monthRange(period: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const [y, m] = period.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(last).padStart(2, "0")}` };
}

export function escapeCsv(s: unknown): string {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
