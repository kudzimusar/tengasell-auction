// POST /api/listings/[id]/bid — place a bid (auctions.enabled flag, min-increment, outbid notify+email+webhook)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"
import { flagEnabled, getSettings, notify, round2, sendTemplatedEmail, dispatchWebhook } from "@/app/api/listings/shared/mkt"

export const runtime = "nodejs"

const bidSchema = z.object({
  amount: z.number().positive().max(1_000_000),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in to place bids", 401, requestId)
  if (!user) return fail("Account unavailable", 403, requestId)

  const { data, error: bodyErr } = await parseBody(req, bidSchema)
  if (bodyErr) return bodyErr

  const auctionsOn = await flagEnabled("auctions.enabled", true)
  if (!auctionsOn) return fail("Bidding is temporarily disabled", 503, requestId)

  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) return fail("Listing not found", 404, requestId)
  if (listing.type !== "AUCTION") return fail("This listing is not an auction", 409, requestId)
  if (listing.status !== "ACTIVE") return fail("This auction is not accepting bids", 409, requestId)
  if (listing.sellerId === user.id) return fail("You cannot bid on your own listing", 409, requestId)
  if (!listing.endsAt || listing.endsAt.getTime() <= Date.now()) return fail("This auction has already ended", 409, requestId)

  const settings = await getSettings()
  const amount = round2(data.amount)
  const minAmount = round2(listing.currentPrice + settings.bidIncrement)
  if (amount < minAmount) {
    return fail(`Bid must be at least $${minAmount.toFixed(2)} (current + $${settings.bidIncrement.toFixed(2)} increment)`, 422, requestId)
  }

  // Previous top bidder (before this bid) gets OUTBID notice
  const prevTop = await db.bid.findFirst({ where: { listingId: listing.id, isActive: true }, orderBy: { amount: "desc" } })
  const prevBidder = prevTop ? await db.user.findUnique({ where: { id: prevTop.bidderId } }) : null

  try {
    const bid = await db.$transaction(async (tx) => {
      // Invariant: only the winning bid stays active
      await tx.bid.updateMany({ where: { listingId: listing.id, isActive: true }, data: { isActive: false } })
      const b = await tx.bid.create({ data: { listingId: listing.id, bidderId: user.id, amount, isActive: true } })
      await tx.listing.update({
        where: { id: listing.id },
        data: { currentPrice: amount, bidCount: { increment: 1 } },
      })
      return b
    })

    if (prevBidder && prevBidder.id !== user.id) {
      await notify(prevBidder.id, "OUTBID", { listingId: listing.id, title: listing.title, amount, minNext: round2(amount + settings.bidIncrement) })
      await sendTemplatedEmail({
        templateKey: "outbid",
        toUser: prevBidder,
        vars: {
          name: prevBidder.name,
          title: listing.title,
          amount: `$${amount.toFixed(2)}`,
          link: `https://tengasell.co.zw/?item=${listing.id}`,
        },
        fallbackSubject: `You've been outbid on ${listing.title}`,
        fallbackBody: `Someone bid $${amount.toFixed(2)} on "${listing.title}". Bid again before it ends.`,
      })
    }
    await dispatchWebhook(listing.sellerId, "bid.placed", { listingId: listing.id, title: listing.title, amount, bidderId: user.id, bidId: bid.id })
    await audit({
      actorId: user.id, actorRole: user.role, action: "listing.bid", targetType: "LISTING", targetId: listing.id,
      before: { currentPrice: listing.currentPrice }, after: { currentPrice: amount, bidId: bid.id },
      requestId, ip,
    })
    return ok({ currentPrice: amount, bidCount: listing.bidCount + 1, minNext: round2(amount + settings.bidIncrement) }, requestId, 201)
  } catch {
    return fail("Could not place bid — please retry", 500, requestId)
  }
}
