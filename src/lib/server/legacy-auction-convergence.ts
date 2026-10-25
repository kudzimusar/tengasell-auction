import { createHash } from "node:crypto"
import { tbGet, tbList } from "@/lib/server/trailbase-admin"

export type PrismaAuctionListing = {
  id: string
  type: string
  title: string
  sellerId: string
  startingPrice: number
  currentPrice: number
  status: string
  endsAt: Date | null
  bidCount: number
}

export type LegacyAuctionAuthorityState =
  | "NOT_AUCTION"
  | "UNMAPPED_READ_ONLY"
  | "MAPPING_NOT_VERIFIED"
  | "MAPPED_MISSING_CANONICAL"
  | "MAPPED_IMMUTABLE_CONFLICT"
  | "VERIFIED_CANONICAL"
  | "CANONICAL_SERVICE_UNAVAILABLE"

export type LegacyAuctionResolution = {
  state: LegacyAuctionAuthorityState
  readOnly: boolean
  canonicalAuctionId: number | null
  mappingClassification: string | null
  canonical: Record<string, unknown> | null
  effective: {
    currentPrice: number
    status: string
    endsAt: Date | string | null
    bidCount: number
  }
}

const round = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100
const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()
const digest = (parts: unknown[]) =>
  createHash("sha256").update(parts.map(norm).join("|")).digest("hex")

export function legacyAuctionFingerprint(listing: Pick<PrismaAuctionListing, "id" | "title" | "sellerId" | "startingPrice">) {
  return digest([listing.id, listing.title, listing.sellerId, round(listing.startingPrice)])
}

export function canonicalAuctionFingerprint(auction: Record<string, unknown>) {
  return digest([
    Number(auction.id ?? 0),
    auction.title,
    auction.seller_username,
    round(auction.start_price),
  ])
}

export function canonicalStatusToLegacy(status: unknown): string {
  switch (String(status ?? "")) {
    case "live": return "ACTIVE"
    case "sold": return "SOLD"
    case "ended": return "ENDED"
    default: return "SUSPENDED"
  }
}

function failClosed(
  listing: PrismaAuctionListing,
  state: LegacyAuctionAuthorityState,
  canonicalAuctionId: number | null = null,
  mappingClassification: string | null = null,
): LegacyAuctionResolution {
  return {
    state,
    readOnly: true,
    canonicalAuctionId,
    mappingClassification,
    canonical: null,
    effective: {
      currentPrice: listing.currentPrice,
      status: listing.status,
      endsAt: listing.endsAt,
      bidCount: listing.bidCount,
    },
  }
}

/**
 * Resolve a retained Prisma AUCTION row to canonical TrailBase only when an
 * explicit VERIFIED mapping survives immutable fingerprint checks on both
 * sides. Any uncertainty is intentionally read-only/fail-closed.
 */
export async function resolveLegacyAuction(
  listing: PrismaAuctionListing,
): Promise<LegacyAuctionResolution> {
  if (listing.type !== "AUCTION") {
    return {
      state: "NOT_AUCTION",
      readOnly: false,
      canonicalAuctionId: null,
      mappingClassification: null,
      canonical: null,
      effective: {
        currentPrice: listing.currentPrice,
        status: listing.status,
        endsAt: listing.endsAt,
        bidCount: listing.bidCount,
      },
    }
  }

  let mappings: Record<string, unknown>[]
  try {
    mappings = await tbList("legacy_auction_mappings", {
      "filter[legacy_listing_id][$eq]": listing.id,
      limit: 2,
    })
  } catch {
    return failClosed(listing, "CANONICAL_SERVICE_UNAVAILABLE")
  }

  if (mappings.length === 0) return failClosed(listing, "UNMAPPED_READ_ONLY")
  if (mappings.length !== 1) return failClosed(listing, "MAPPING_NOT_VERIFIED")

  const mapping = mappings[0]
  const canonicalAuctionId = Number(mapping.canonical_auction_id ?? 0)
  const classification = String(mapping.classification ?? "")
  if (
    mapping.status !== "VERIFIED" ||
    !Number.isSafeInteger(canonicalAuctionId) ||
    canonicalAuctionId <= 0
  ) {
    return failClosed(listing, "MAPPING_NOT_VERIFIED", canonicalAuctionId || null, classification || null)
  }

  if (String(mapping.legacy_fingerprint ?? "") !== legacyAuctionFingerprint(listing)) {
    return failClosed(listing, "MAPPED_IMMUTABLE_CONFLICT", canonicalAuctionId, classification)
  }

  let canonical: Record<string, unknown> | null
  try {
    canonical = await tbGet("auctions", canonicalAuctionId)
  } catch {
    return failClosed(listing, "CANONICAL_SERVICE_UNAVAILABLE", canonicalAuctionId, classification)
  }
  if (!canonical) {
    return failClosed(listing, "MAPPED_MISSING_CANONICAL", canonicalAuctionId, classification)
  }

  if (String(mapping.canonical_fingerprint ?? "") !== canonicalAuctionFingerprint(canonical)) {
    return failClosed(listing, "MAPPED_IMMUTABLE_CONFLICT", canonicalAuctionId, classification)
  }

  return {
    state: "VERIFIED_CANONICAL",
    readOnly: true,
    canonicalAuctionId,
    mappingClassification: classification,
    canonical,
    effective: {
      currentPrice: round(canonical.current_price),
      status: canonicalStatusToLegacy(canonical.status),
      endsAt: String(canonical.ends_at ?? ""),
      bidCount: Number(canonical.bid_count ?? 0),
    },
  }
}

export async function resolveLegacyAuctionBatch<T extends PrismaAuctionListing>(
  listings: T[],
): Promise<Map<string, LegacyAuctionResolution>> {
  const results = await Promise.all(
    listings.map(async (listing) => [listing.id, await resolveLegacyAuction(listing)] as const),
  )
  return new Map(results)
}

export async function canonicalBidHistory(
  resolution: LegacyAuctionResolution,
  limit = 10,
): Promise<Record<string, unknown>[]> {
  if (resolution.state !== "VERIFIED_CANONICAL" || !resolution.canonicalAuctionId) return []
  return tbList("bids", {
    "filter[auction_id][$eq]": resolution.canonicalAuctionId,
    order: "-created_at",
    limit: Math.max(1, Math.min(100, limit)),
  })
}

export function auctionAuthorityPayload(resolution: LegacyAuctionResolution) {
  return {
    authority: "TRAILBASE_TRADE_ENGINE",
    legacyPrisma: true,
    legacyMode: resolution.state,
    readOnly: true,
    canonicalAuctionId: resolution.canonicalAuctionId,
    mappingClassification: resolution.mappingClassification,
  }
}
