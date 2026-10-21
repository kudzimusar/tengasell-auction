// Small shared utilities (mirror comms util.ts).

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export function isoPlusMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "Z");
}

export function isoPlusHours(hours: number): string {
  return isoPlusMs(hours * 3_600_000);
}

export function isoPlusDays(days: number): string {
  return isoPlusMs(days * 86_400_000);
}

/** SQLite datetime('now') compatibility: "YYYY-MM-DD HH:MM:SS" (UTC). */
export function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

export function snippet(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
