// /api/admin/finance/payouts — GET list (FINANCE+ADMIN) · POST create → dual approval (FINANCE)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, paginate, parseBody, audit } from "@/lib/server/api"
import { guard, FINANCE_ROLES, round2, sellerPayableBalance, notify } from "../../_lib/ctl"

export const runtime = "nodejs"

// ── GET /api/admin/finance/payouts?status ────────────────────────
export async function GET(req: NextRequest) {
  const { requestId } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res

  const sp = req.nextUrl.searchParams
  const { limit, page, skip } = paginate(sp)
  const status = sp.get("status") || undefined

  const where: Record<string, unknown> = {}
  if (status && status !== "ALL") where.status = status

  try {
    const [rows, total] = await Promise.all([
      db.payout.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
      db.payout.count({ where }),
    ])
    const sellerIds = [...new Set(rows.map((r) => r.sellerId))]
    const [owners, profiles] = await Promise.all([
      sellerIds.length ? db.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, name: true, email: true } }) : [],
      sellerIds.length ? db.sellerProfile.findMany({ where: { userId: { in: sellerIds } } }) : [],
    ])
    const ownerM = new Map(owners.map((o) => [o.id, o]))
    const profM = new Map(profiles.map((p) => [p.userId, p]))

    const items = rows.map((p) => ({
      ...p,
      sellerName: ownerM.get(p.sellerId)?.name || null,
      sellerEmail: ownerM.get(p.sellerId)?.email || null,
      sellerShop: profM.get(p.sellerId)?.shopName || null,
    }))
    return ok({ items, total, page, limit }, requestId)
  } catch {
    return ok({ items: [], total: 0, page, limit }, requestId)
  }
}

// ── POST /api/admin/finance/payouts {sellerId, amount, note} ─────
const createSchema = z.object({
  sellerId: z.string().trim().min(5).max(60),
  amount: z.number().positive().max(1_000_000),
  note: z.string().trim().max(500).optional(),
})

export async function POST(req: NextRequest) {
  const { requestId, ip } = ctxFrom(req)
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res

  const { data, error: bodyErr } = await parseBody(req, createSchema)
  if (bodyErr) return bodyErr

  try {
    const seller = await db.user.findUnique({ where: { id: data.sellerId } })
    if (!seller || !seller.isSeller) return fail("Seller not found", 404, requestId)

    const amount = round2(data.amount)
    const balance = await sellerPayableBalance(seller.id)
    if (balance < amount) {
      return fail(`Insufficient seller balance: available ${balance.toFixed(2)}, requested ${amount.toFixed(2)}`, 422, requestId)
    }

    const dup = await db.payout.findFirst({ where: { sellerId: seller.id, status: { in: ["PENDING", "APPROVED"] } } })
    if (dup) return fail("A payout is already in flight for this seller", 409, requestId)

    const payout = await db.payout.create({
      data: {
        sellerId: seller.id, amount, status: "PENDING",
        idempotencyKey: `po-${seller.id}-${Date.now()}`,
        requestedBy: user.id,
      },
    })
    const approval = await db.approvalRequest.create({
      data: {
        type: "PAYOUT",
        payload: JSON.stringify({ payoutId: payout.id, sellerId: seller.id, sellerName: seller.name, amount, note: data.note || null, balance }),
        requestedBy: user.id, status: "PENDING",
      },
    })

    await audit({
      actorId: user.id, actorRole: user.role, action: "payout.request", targetType: "PAYOUT", targetId: payout.id,
      before: { sellerBalance: balance },
      after: { amount, status: "PENDING", approvalId: approval.id },
      reason: data.note || `payout request for ${seller.name}`, requestId, ip,
    })
    return ok({ payoutId: payout.id, approvalId: approval.id, status: payout.status, amount, balance }, requestId, 201)
  } catch {
    return fail("Could not create payout request", 500, requestId)
  }
}
