// Tengasell item module helpers — Yahoo Auctions-style privacy masking.

/**
 * Mask a username for public bid history / Q&A, Yahoo style: "simba" → "si***a".
 * Short names keep only the first character. Never returns empty.
 */
export function maskUsername(name: string): string {
  if (!name) return "—";
  if (name.length <= 3) return `${name[0]!}***`;
  return `${name.slice(0, 2)}***${name.slice(-1)}`;
}
