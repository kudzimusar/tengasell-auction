import { createHash } from "node:crypto"

const norm = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()
const round = (v) => Math.round(Number(v ?? 0) * 100) / 100
const digest = (parts) => createHash("sha256").update(parts.map(norm).join("|")).digest("hex")

export const legacyFingerprint = (listing) =>
  digest([listing.id, listing.title, listing.sellerId, round(listing.startingPrice)])

export const canonicalFingerprint = (auction) =>
  digest([Number(auction.id ?? 0), auction.title, auction.seller_username, round(auction.start_price)])

const candidateKeyLegacy = (listing) =>
  `${norm(listing.title)}|${round(listing.startingPrice).toFixed(2)}`
const candidateKeyCanonical = (auction) =>
  `${norm(auction.title)}|${round(auction.start_price).toFixed(2)}`

export function reconcileSnapshot({
  legacyListings = [],
  legacyOrders = [],
  canonicalAuctions = [],
  canonicalOrders = [],
  mappings = [],
}) {
  const canonicalById = new Map(canonicalAuctions.map((a) => [Number(a.id), a]))
  const mappingsByLegacy = new Map()
  for (const m of mappings) {
    const id = String(m.legacy_listing_id)
    const arr = mappingsByLegacy.get(id) ?? []
    arr.push(m)
    mappingsByLegacy.set(id, arr)
  }

  const candidates = new Map()
  for (const auction of canonicalAuctions) {
    const key = candidateKeyCanonical(auction)
    const arr = candidates.get(key) ?? []
    arr.push(auction)
    candidates.set(key, arr)
  }

  const listingResults = legacyListings
    .filter((l) => l.type === "AUCTION")
    .map((listing) => {
      const found = mappingsByLegacy.get(String(listing.id)) ?? []
      if (found.length > 1) {
        return {
          legacyListingId: listing.id,
          classification: "DUPLICATE_MAPPING_CONFLICT",
          canonicalAuctionId: null,
          safeToMap: false,
        }
      }
      if (found.length === 0) {
        const possible = candidates.get(candidateKeyLegacy(listing)) ?? []
        return {
          legacyListingId: listing.id,
          classification:
            possible.length === 0
              ? "LEGACY_ONLY"
              : possible.length === 1
                ? "CANDIDATE_UNPROVEN"
                : "AMBIGUOUS_CANDIDATE",
          canonicalAuctionId: possible.length === 1 ? Number(possible[0].id) : null,
          candidateIds: possible.map((a) => Number(a.id)),
          safeToMap: false,
        }
      }

      const mapping = found[0]
      const canonicalAuctionId = Number(mapping.canonical_auction_id)
      const canonical = canonicalById.get(canonicalAuctionId)
      if (String(mapping.status) !== "VERIFIED") {
        return {
          legacyListingId: listing.id,
          classification: "MAPPING_NOT_VERIFIED",
          canonicalAuctionId,
          safeToMap: false,
        }
      }
      if (!canonical) {
        return {
          legacyListingId: listing.id,
          classification: "MAPPED_MISSING_CANONICAL",
          canonicalAuctionId,
          safeToMap: false,
        }
      }

      const legacyOk = String(mapping.legacy_fingerprint) === legacyFingerprint(listing)
      const canonicalOk = String(mapping.canonical_fingerprint) === canonicalFingerprint(canonical)
      if (!legacyOk || !canonicalOk) {
        return {
          legacyListingId: listing.id,
          classification: "MAPPED_IMMUTABLE_CONFLICT",
          canonicalAuctionId,
          safeToMap: false,
          legacyFingerprintMatch: legacyOk,
          canonicalFingerprintMatch: canonicalOk,
        }
      }

      return {
        legacyListingId: listing.id,
        classification: "VERIFIED_CANONICAL",
        canonicalAuctionId,
        safeToMap: true,
      }
    })

  const resultByListing = new Map(listingResults.map((r) => [String(r.legacyListingId), r]))
  const canonicalOrdersByAuction = new Map()
  for (const order of canonicalOrders) {
    const id = Number(order.auction_id)
    const arr = canonicalOrdersByAuction.get(id) ?? []
    arr.push(order)
    canonicalOrdersByAuction.set(id, arr)
  }

  const orderResults = legacyOrders
    .filter((o) => o.type === "AUCTION")
    .map((order) => {
      const listing = resultByListing.get(String(order.listingId))
      if (!listing || listing.classification !== "VERIFIED_CANONICAL") {
        return {
          legacyOrderId: order.id,
          legacyListingId: order.listingId,
          classification: "UNMAPPED_AUCTION_ORDER",
          canonicalOrderId: null,
        }
      }
      const orders = canonicalOrdersByAuction.get(Number(listing.canonicalAuctionId)) ?? []
      if (orders.length === 0) {
        return {
          legacyOrderId: order.id,
          legacyListingId: order.listingId,
          classification: "CANONICAL_ORDER_MISSING",
          canonicalOrderId: null,
        }
      }
      if (orders.length > 1) {
        return {
          legacyOrderId: order.id,
          legacyListingId: order.listingId,
          classification: "CANONICAL_ORDER_DUPLICATE",
          canonicalOrderId: null,
          canonicalOrderIds: orders.map((o) => Number(o.id)),
        }
      }
      const canonical = orders[0]
      const amountMatch = Math.abs(round(order.amount) - round(canonical.final_price)) < 0.00001
      return {
        legacyOrderId: order.id,
        legacyListingId: order.listingId,
        classification: amountMatch ? "ORDER_AMOUNT_MATCH" : "ORDER_AMOUNT_CONFLICT",
        canonicalOrderId: Number(canonical.id),
        legacyAmount: round(order.amount),
        canonicalAmount: round(canonical.final_price),
      }
    })

  const mappedCanonical = new Set(
    listingResults
      .filter((r) => r.classification === "VERIFIED_CANONICAL")
      .map((r) => Number(r.canonicalAuctionId)),
  )
  const canonicalOnly = canonicalAuctions
    .filter((a) => !mappedCanonical.has(Number(a.id)))
    .map((a) => Number(a.id))

  const tally = (rows) =>
    rows.reduce((out, row) => {
      out[row.classification] = (out[row.classification] ?? 0) + 1
      return out
    }, {})

  return {
    mode: "DRY_RUN",
    mutationAllowed: false,
    generatedAt: new Date().toISOString(),
    listings: listingResults,
    orders: orderResults,
    canonicalOnlyAuctionIds: canonicalOnly,
    summary: {
      legacyAuctionListings: listingResults.length,
      legacyAuctionOrders: orderResults.length,
      canonicalAuctions: canonicalAuctions.length,
      canonicalOrders: canonicalOrders.length,
      listingClassifications: tally(listingResults),
      orderClassifications: tally(orderResults),
    },
  }
}
