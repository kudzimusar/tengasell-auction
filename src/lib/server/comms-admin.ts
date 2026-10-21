// comms-admin.ts — BFF-side helpers for the admin Comms Console.
//
// SEGMENT RESOLUTION (worklog Task 11-c §B/2b): campaign segments resolve to
// concrete comms userIds (= TrailBase usernames — the comms-service keys every
// user by username) with BEST-EFFORT queries through the app's existing
// TrailBase admin data layer (trailbase-admin.ts tbList). Any query failure
// degrades to the `all_users` fallback instead of failing the campaign, and
// the response flags the fallback so the admin UI can say so.
//
//   active_bidders        users with a bid in the last 7 days
//   ending_soon_watchers  watchers of live auctions ending < 24h from now
//   dormant_30d           users with NO bid/order/message in the last 30 days
//   category_fans         bidders + watchers + sellers of auctions in a category
//   all_users             every profile username (fallback)

import { tbFetch } from "./trailbase-admin";

export const SEGMENT_KEYS = [
  "active_bidders",
  "ending_soon_watchers",
  "dormant_30d",
  "category_fans",
  "all_users",
] as const;

export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export function isSegmentKey(v: unknown): v is SegmentKey {
  return typeof v === "string" && (SEGMENT_KEYS as readonly string[]).includes(v);
}

export interface SegmentResolution {
  userIds: string[];
  /** Present only when the requested segment degraded to the fallback. */
  fallback?: "all_users";
}

// ── TrailBase list pagination (cursor-based, best-effort caps) ─────────

interface ListPage {
  cursor?: string;
  records?: Record<string, unknown>[];
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 6; // 3,000 rows per collection — plenty for the demo + gold path

async function listAll(
  collection: string,
  params: Record<string, string | number> = {},
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const out: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = cursor
      ? `/api/records/v1/${collection}?${qs.toString()}&cursor=${encodeURIComponent(cursor)}`
      : `/api/records/v1/${collection}?${qs.toString()}`;
    const res = await tbFetch(url);
    if (!res.ok) throw new Error(`${collection} list failed (${res.status})`);
    const data = (await res.json().catch(() => null)) as ListPage | null;
    out.push(...(data?.records ?? []));
    cursor = data?.cursor ?? null;
    if (!cursor || (data?.records?.length ?? 0) === 0) break;
  }
  return out;
}

// ── row helpers ────────────────────────────────────────────────────────

function str(r: Record<string, unknown>, k: string): string {
  return String(r[k] ?? "").trim();
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function isoHoursFromNow(h: number): string {
  return new Date(Date.now() + h * 3_600_000).toISOString();
}

function distinct(list: string[]): string[] {
  return [...new Set(list.filter((u) => u && !u.startsWith("__auth")))].sort();
}

/** profiles rows → {usernames, blobToUsername map} (blob = _user id base64). */
async function loadProfiles(): Promise<{
  usernames: string[];
  blobToName: Map<string, string>;
}> {
  const rows = await listAll("profiles", { limit: PAGE_LIMIT });
  const blobToName = new Map<string, string>();
  const usernames: string[] = [];
  for (const r of rows) {
    const name = str(r, "username");
    const blob = str(r, "user");
    if (name) usernames.push(name);
    if (blob && name) blobToName.set(blob, name);
  }
  return { usernames, blobToName };
}

// ── segments ───────────────────────────────────────────────────────────

async function activeBidders(): Promise<string[]> {
  const rows = await listAll("bids", {
    limit: PAGE_LIMIT,
    "filter[created_at][$gte]": isoDaysAgo(7),
  });
  return distinct(rows.map((r) => str(r, "bidder_username")));
}

async function endingSoonWatchers(): Promise<string[]> {
  const auctions = await listAll("auctions", {
    limit: PAGE_LIMIT,
    "filter[status][$eq]": "live",
    "filter[ends_at][$lte]": isoHoursFromNow(24),
  });
  const ids = new Set(auctions.map((r) => Number(r.id)));
  if (ids.size === 0) return [];
  const { blobToName } = await loadProfiles();
  const watchers = await listAll("watchlist", { limit: PAGE_LIMIT });
  return distinct(
    watchers
      .filter((r) => ids.has(Number(r.auction_id)))
      .map((r) => blobToName.get(str(r, "user")) ?? ""),
  );
}

async function dormant30d(): Promise<string[]> {
  const { usernames } = await loadProfiles();
  const since = isoDaysAgo(30);
  const [bids, orders, messages] = await Promise.all([
    listAll("bids", { limit: PAGE_LIMIT, "filter[created_at][$gte]": since }),
    listAll("orders", { limit: PAGE_LIMIT, "filter[created_at][$gte]": since }),
    listAll("messages", { limit: PAGE_LIMIT, "filter[created_at][$gte]": since }),
  ]);
  const active = new Set<string>([
    ...bids.map((r) => str(r, "bidder_username")),
    ...orders.flatMap((r) => [str(r, "buyer_username"), str(r, "seller_username")]),
    ...messages.map((r) => str(r, "sender_username")),
  ]);
  return distinct(usernames.filter((u) => !active.has(u)));
}

async function categoryFans(category: string): Promise<string[]> {
  const auctions = await listAll("auctions", {
    limit: PAGE_LIMIT,
    "filter[category][$eq]": category,
  });
  const ids = new Set(auctions.map((r) => Number(r.id)));
  if (ids.size === 0) return [];
  const [bids, watchers, { blobToName }] = await Promise.all([
    listAll("bids", { limit: PAGE_LIMIT }),
    listAll("watchlist", { limit: PAGE_LIMIT }),
    loadProfiles(),
  ]);
  const names = [
    ...auctions.map((r) => str(r, "seller_username")),
    ...bids.filter((r) => ids.has(Number(r.auction_id))).map((r) => str(r, "bidder_username")),
    ...watchers
      .filter((r) => ids.has(Number(r.auction_id)))
      .map((r) => blobToName.get(str(r, "user")) ?? ""),
  ];
  return distinct(names);
}

/**
 * Resolve a campaign segment to comms userIds (usernames). Best-effort: any
 * TrailBase failure degrades to the all_users fallback (flagged in the
 * response). `category` is only read by the category_fans segment.
 */
export async function resolveSegment(
  segmentKey: string,
  category?: string,
): Promise<SegmentResolution> {
  try {
    switch (segmentKey) {
      case "active_bidders": {
        const userIds = await activeBidders();
        if (userIds.length > 0) return { userIds };
        break;
      }
      case "ending_soon_watchers": {
        const userIds = await endingSoonWatchers();
        if (userIds.length > 0) return { userIds };
        break;
      }
      case "dormant_30d": {
        const userIds = await dormant30d();
        if (userIds.length > 0) return { userIds };
        break;
      }
      case "category_fans": {
        const slug = (category ?? "").trim();
        if (!slug) break;
        const userIds = await categoryFans(slug);
        if (userIds.length > 0) return { userIds };
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("[comms-admin] segment resolution failed:", err);
  }
  // fallback (also the all_users path itself)
  try {
    const { usernames } = await loadProfiles();
    return {
      userIds: distinct(usernames),
      fallback: segmentKey === "all_users" ? undefined : "all_users",
    };
  } catch (err) {
    console.error("[comms-admin] all_users fallback failed:", err);
    return { userIds: [], fallback: "all_users" };
  }
}
