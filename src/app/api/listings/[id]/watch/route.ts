// POST /api/listings/[id]/watch — toggle watch for current user
import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, audit } from "@/lib/server/api"
import { requireUser } from "@/lib/server/auth-core"

export const runtime = "nodejs"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId } = ctxFrom(req)
  const { id } = await params
  const { user, error } = await requireUser()
  if (error === 401) return fail("Sign in to watch items", 401, requestId)
  if (!user) return fail("Account unavailable", 403, requestId)

  const listing = await db.listing.findUnique({ where: { id } })
  if (!listing) return fail("Listing not found", 404, requestId)

  const existing = await db.watch.findUnique({ where: { userId_listingId: { userId: user.id, listingId: id } } })
  if (existing) {
    await db.$transaction(async (tx) => {
      await tx.watch.delete({ where: { id: existing.id } })
      await tx.listing.update({ where: { id }, data: { watchCount: { decrement: 1 } } })
    })
    await audit({ actorId: user.id, actorRole: user.role, action: "listing.watch", targetType: "LISTING", targetId: id, after: { watching: false }, requestId })
    return ok({ watching: false }, requestId)
  }
  await db.$transaction(async (tx) => {
    await tx.watch.create({ data: { userId: user.id, listingId: id } })
    await tx.listing.update({ where: { id }, data: { watchCount: { increment: 1 } } })
  })
  await audit({ actorId: user.id, actorRole: user.role, action: "listing.watch", targetType: "LISTING", targetId: id, after: { watching: true }, requestId })
  return ok({ watching: true, watchCount: listing.watchCount + 1 }, requestId, 201)
}
