// POST /api/admin/listings/[id]/action — APPROVE|REJECT|SUSPEND|REINSTATE|END (MODERATOR+)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, MOD_PLUS, notify, listingSnapshot } from "../../../_lib/ctl"
import { AUCTION_AUTHORITY_ERRORS, authorityDetails, isLegacyPrismaAuction } from "@/lib/auction-authority"

export const runtime = "nodejs"

const bodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "SUSPEND", "REINSTATE", "END"]),
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(MOD_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  try {
    const listing = await db.listing.findUnique({ where: { id } })
    if (!listing) return fail("Listing not found", 404, requestId)

    if (isLegacyPrismaAuction(listing.type)) {
      const policy = AUCTION_AUTHORITY_ERRORS.CANONICAL_AUCTION_REQUIRED
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: "auction.authority.blocked.prisma_admin_action",
        targetType: "LISTING",
        targetId: listing.id,
        after: { requestedAction: data.action, ...authorityDetails("CANONICAL_AUCTION_REQUIRED") },
        requestId,
        ip,
      })
      return fail(policy.message, policy.status, requestId, authorityDetails("CANONICAL_AUCTION_REQUIRED"))
    }

    const reason = `${data.reasonCode}${data.note ? ` — ${data.note}` : ""}`
    const now = new Date()

    let newStatus: string
    let snapshot = false
    switch (data.action) {
      case "APPROVE":
        if (!["PENDING_REVIEW", "REJECTED", "DRAFT"].includes(listing.status)) {
          return fail(`Cannot approve a listing in status ${listing.status}`, 422, requestId)
        }
        newStatus = "ACTIVE"
        snapshot = true
        break
      case "REJECT":
        if (!["PENDING_REVIEW", "ACTIVE", "DRAFT"].includes(listing.status)) {
          return fail(`Cannot reject a listing in status ${listing.status}`, 422, requestId)
        }
        newStatus = "REJECTED"
        snapshot = true
        break
      case "SUSPEND":
        if (!["ACTIVE", "PENDING_REVIEW"].includes(listing.status)) {
          return fail(`Cannot suspend a listing in status ${listing.status}`, 422, requestId)
        }
        newStatus = "SUSPENDED"
        break
      case "REINSTATE":
        if (!["SUSPENDED", "REJECTED"].includes(listing.status)) {
          return fail(`Cannot reinstate a listing in status ${listing.status}`, 422, requestId)
        }
        newStatus = "ACTIVE"
        break
      case "END":
        if (!["ACTIVE", "PENDING_REVIEW"].includes(listing.status)) {
          return fail(`Cannot end a listing in status ${listing.status}`, 422, requestId)
        }
        newStatus = "ENDED"
        break
      default:
        return fail("Unknown action", 422, requestId)
    }

    const before = { status: listing.status, rejectReason: listing.rejectReason, publishedAt: listing.publishedAt, version: listing.version }
    const nextVersion = snapshot ? listing.version + 1 : listing.version

    const updated = await db.listing.update({
      where: { id },
      data: {
        status: newStatus,
        rejectReason: data.action === "REJECT" ? reason : data.action === "SUSPEND" ? reason : null,
        publishedAt: newStatus === "ACTIVE" && !listing.publishedAt ? now : listing.publishedAt,
        endedAt: newStatus === "ENDED" ? now : listing.endedAt,
        ...(snapshot ? { version: nextVersion } : {}),
      },
    })

    // Version snapshot on APPROVE/REJECT
    if (snapshot) {
      await db.listingVersion.create({
        data: {
          listingId: updated.id, version: updated.version,
          snapshot: listingSnapshot(updated),
          changedBy: user.id,
          changeNote: `${data.action} by ${user.role}: ${reason}`,
        },
      })
    }

    // Notify the seller on moderation decisions
    await notify(listing.sellerId, `LISTING_${data.action}`, {
      listingId: listing.id, title: listing.title, status: newStatus, reason: data.reasonCode,
    })

    await audit({
      actorId: user.id, actorRole: user.role, action: `listing.${data.action.toLowerCase()}`, targetType: "LISTING", targetId: listing.id,
      before, after: { status: updated.status, rejectReason: updated.rejectReason, publishedAt: updated.publishedAt, version: updated.version },
      reason, requestId, ip,
    })
    return ok({ status: updated.status, version: updated.version }, requestId)
  } catch {
    return fail("Action failed", 500, requestId)
  }
}
