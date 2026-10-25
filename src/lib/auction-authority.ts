// TENGASELL-AUCTION-IMP-01 — bounded auction authority policy.
// This module does not migrate data or implement the transactional core.
// It only defines which legacy writes are forbidden and how degraded/demo
// client modes are distinguished.

export const CANONICAL_AUCTION_AUTHORITY = "TRAILBASE_TRADE_ENGINE" as const

export const AUCTION_AUTHORITY_ERRORS = {
  AUCTION_AUTHORITY_MOVED: {
    status: 409,
    message: "Auction creation is handled by the canonical Tengasell auction service.",
  },
  CANONICAL_AUCTION_REQUIRED: {
    status: 409,
    message: "This legacy Prisma auction write path is read-only. Use the canonical Tengasell auction service.",
  },
  AUCTION_SERVICE_UNAVAILABLE: {
    status: 503,
    message: "Auction service unavailable. Commercial auction actions are disabled until the canonical service reconnects.",
  },
  DEMO_COMMERCIAL_MUTATION_BLOCKED: {
    status: 409,
    message: "Commercial auction mutation is disabled outside an explicit Tengasell demo build.",
  },
} as const

export type AuctionAuthorityErrorCode = keyof typeof AUCTION_AUTHORITY_ERRORS

export function isLegacyPrismaAuction(type: unknown): boolean {
  return type === "AUCTION"
}

export function isExplicitDemoIntent(value: string | undefined): boolean {
  return value === "1"
}

export function authorityDetails(code: AuctionAuthorityErrorCode) {
  return {
    code,
    canonicalAuthority: CANONICAL_AUCTION_AUTHORITY,
  }
}

export const DEGRADED_COMMERCIAL_MUTATIONS = new Set([
  "placeBid",
  "createAuction",
  "saveVehicleIntake",
  "addVehicleDocument",
  "reviewVehicleDocument",
  "startVehicleInspection",
  "addVehicleFinding",
  "submitVehicleInspection",
  "reviewVehicleInspection",
  "buyNow",
  "submitOffer",
  "withdrawOffer",
  "respondOffer",
  "acceptCounter",
  "retractBid",
  "featureListing",
  "createLiveRoom",
  "createAuctionEvent",
  "grantEventOperator",
  "runListCommand",
  "addRoomLot",
  "removeRoomLot",
  "openRoomLot",
  "closeRoomLot",
  "endLiveRoom",
  "payOrder",
  "markShipped",
  "confirmDelivery",
  "rateOrder",
])

export class AuctionAuthorityError extends Error {
  readonly code: AuctionAuthorityErrorCode
  readonly status: number

  constructor(code: AuctionAuthorityErrorCode) {
    const policy = AUCTION_AUTHORITY_ERRORS[code]
    super(policy.message)
    this.name = "AuctionAuthorityError"
    this.code = code
    this.status = policy.status
  }
}
