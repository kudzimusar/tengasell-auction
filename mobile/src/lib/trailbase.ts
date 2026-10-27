// TENGASELL-MOBILE-01 — canonical authority client.
//
// Per TENGASELL-AUCTION-IMP-01, the ONLY commercial auction authority is
// TrailBase + the Socket.IO trade engine. Prisma is legacy/read-only. This
// client therefore talks to the gateway exactly the way the web app's
// remote.ts does: same base URL, same ?XTransformPort routing, same records
// API. No Next BFF, no Prisma, no local fallback for commercial mutations.
//
// Base URL comes from EXPO_PUBLIC_TENGASELL_API (EAS env or .env).
// Reads are unauthenticated (ACL: world READ on categories/auctions);
// authenticated flows arrive with MOB-01 auth in a later unit.

import type { Auction, Category } from "./types";

export const TB_PORT = 3001;

function base(): string {
  const fromEnv = process.env.EXPO_PUBLIC_TENGASELL_API;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // Default: the staging tunnel. Set EXPO_PUBLIC_TENGASELL_API for any other
  // environment (this is a client-side value, baked at build time by Expo).
  return "https://english-merely-commonwealth-sole.trycloudflare.com";
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  sp.set("XTransformPort", String(TB_PORT));
  return sp.toString();
}

async function tbGet<T>(
  collection: string,
  params: Record<string, string | number | undefined>,
): Promise<{ records: T[]; cursor?: string; total_count?: number }> {
  const res = await fetch(`${base()}/api/records/v1/${collection}?${qs(params)}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`records API ${collection}: HTTP ${res.status}`);
  }
  return (await res.json()) as { records: T[]; cursor?: string; total_count?: number };
}

/** Canonical-authority reachability probe (same contract as web initApi). */
export async function probeCanonical(): Promise<boolean> {
  try {
    const res = await fetch(
      `${base()}/api/records/v1/categories?${qs({ limit: 1 })}`,
      { headers: { accept: "application/json" } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchCategories(): Promise<Category[]> {
  const data = await tbGet<Category>("categories", { order: "sort", limit: 50 });
  return data.records ?? [];
}

export interface AuctionQuery {
  status?: string;
  category?: string;
  order?: string;
  limit?: number;
}

export async function fetchAuctions(q: AuctionQuery = {}): Promise<Auction[]> {
  const data = await tbGet<Auction>("auctions", {
    "filter[status][$eq]": q.status ?? "live",
    ...(q.category ? { "filter[category][$eq]": q.category } : {}),
    order: q.order ?? "ends_at",
    limit: q.limit ?? 20,
  });
  return data.records ?? [];
}

export async function fetchAuction(id: number): Promise<Auction | null> {
  try {
    const res = await fetch(`${base()}/api/records/v1/auctions/${id}?${qs({})}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Auction;
  } catch {
    return null;
  }
}
