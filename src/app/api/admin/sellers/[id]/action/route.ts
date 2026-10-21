// POST /api/admin/sellers/[id]/action — VERIFY|REJECT|SUSPEND|REINSTATE (SUPPORT+)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit } from "@/lib/server/api"
import { guard, STAFF_PLUS, notify } from "../../../_lib/ctl"

export const runtime = "nodejs"

const bodySchema = z.object({
  action: z.enum(["VERIFY", "REJECT", "SUSPEND", "REINSTATE"]),
  reasonCode: z.string().trim().min(1).max(80),
  note: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(STAFF_PLUS, requestId)
  if (!user) return res
  const { id } = await params

  const { data, error: bodyErr } = await parseBody(req, bodySchema)
  if (bodyErr) return bodyErr

  try {
    const profile = await db.sellerProfile.findUnique({ where: { id } })
    if (!profile) return fail("Seller not found", 404, requestId)

    const before = {
      status: profile.status, identityVerified: profile.identityVerified, businessVerified: profile.businessVerified,
      taxVerified: profile.taxVerified, payoutVerified: profile.payoutVerified,
    }
    const reason = `${data.reasonCode}${data.note ? ` — ${data.note}` : ""}`
    const flags = data.action === "VERIFY"
      ? { identityVerified: true, businessVerified: true, taxVerified: true, payoutVerified: true }
      : {}

    const newStatus =
      data.action === "VERIFY" ? "VERIFIED"
      : data.action === "REJECT" ? "REJECTED"
      : data.action === "SUSPEND" ? "SUSPENDED"
      : profile.status === "SUSPENDED" ? "VERIFIED" // reinstatement restores verified standing
      : "PENDING"

    const updated = await db.sellerProfile.update({
      where: { id },
      data: { status: newStatus, verificationNotes: reason, ...flags },
    })

    // Notify the seller on every verification-state change
    await notify(profile.userId, `SELLER_${data.action}`, { status: newStatus, reason: data.reasonCode, shopName: profile.shopName })

    await audit({
      actorId: user.id, actorRole: user.role, action: `seller.${data.action.toLowerCase()}`, targetType: "SELLER", targetId: profile.id,
      before, after: {
        status: updated.status, identityVerified: updated.identityVerified, businessVerified: updated.businessVerified,
        taxVerified: updated.taxVerified, payoutVerified: updated.payoutVerified,
      },
      reason, requestId, ip,
    })
    return ok({ status: updated.status }, requestId)
  } catch {
    return fail("Action failed", 500, requestId)
  }
}
