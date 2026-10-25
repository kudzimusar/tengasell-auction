// POST /api/listings/[id]/bid — IMP-01 legacy Prisma AUCTION write barrier.
// Canonical commercial bidding is owned by TrailBase + the Socket.IO trade-engine.
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { fail, ctxFrom, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"
import { AUCTION_AUTHORITY_ERRORS, authorityDetails, isLegacyPrismaAuction } from "@/lib/auction-authority"
import { auctionAuthorityPayload, resolveLegacyAuction } from "@/lib/server/legacy-auction-convergence"

export const runtime = "nodejs"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in to place bids", 401, requestId)
  if (!user) return fail("Account unavailable", 403, requestId)

  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) return fail("Listing not found", 404, requestId)

  if (isLegacyPrismaAuction(listing.type)) {
    const resolution = await resolveLegacyAuction(listing)
    const policy = AUCTION_AUTHORITY_ERRORS.CANONICAL_AUCTION_REQUIRED
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "auction.authority.blocked.prisma_bid",
      targetType: "LISTING",
      targetId: listing.id,
      after: authorityDetails("CANONICAL_AUCTION_REQUIRED"),
      requestId,
      ip,
    })
    return fail(
      policy.message,
      policy.status,
      requestId,
      {
        ...authorityDetails("CANONICAL_AUCTION_REQUIRED"),
        ...auctionAuthorityPayload(resolution),
        canonicalRpcEvent: resolution.state === "VERIFIED_CANONICAL" ? "bid:place" : null,
      },
    )
  }

  return fail("This listing is not an auction", 409, requestId)
}
