// /api/admin/finance/payouts/[id]/reverse — payout reversal with balanced ledger + audit (COM-018)
import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { ok, fail, ctxFrom, parseBody, audit, notify as _n } from "@/lib/server/api"
import { guard, FINANCE_ROLES, round2 } from "../../../../_lib/ctl"

export const runtime = "nodejs"

const schema = z.object({ note: z.string().trim().min(3).max(500) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requestId, ip } = ctxFrom(req)
  const { id } = await params
  const { user, res } = await guard(FINANCE_ROLES, requestId)
  if (!user) return res
  const { data, error } = await parseBody(req, schema)
  if (error) return error
  const payout = await db.payout.findUnique({ where: { id } })
  if (!payout) return fail("Payout not found", 404, requestId)
  if (payout.status !== "PAID") return fail(`Only PAID payouts can be reversed (current: ${payout.status})`, 422, requestId)
  const amount = round2(payout.amount)
  const updated = await db.payout.update({
    where: { id }, data: { status: "REVERSED" },
  })
  await db.ledgerEntry.create({ data: { account: "PAYOUT_CLEARING", direction: "DEBIT", amount, memo: `Payout reversal ${payout.batchRef || id.slice(-6)}`, refs: JSON.stringify({ payoutId: id, sellerId: payout.sellerId }) } })
  await db.ledgerEntry.create({ data: { account: "SELLER_PAYABLE", direction: "CREDIT", amount, memo: "Reversal: funds returned to seller balance", refs: JSON.stringify({ payoutId: id, sellerId: payout.sellerId }) } })
  await db.notification.create({ data: { userId: payout.sellerId, type: "PAYOUT_REVERSED", params: JSON.stringify({ payoutId: id, amount, note: data.note }) } }).catch(() => undefined)
  await audit({
    actorId: user.id, actorRole: user.role, action: "payout.reverse", targetType: "PAYOUT", targetId: id,
    before: { status: "PAID", amount }, after: { status: updated.status, amount },
    reason: data.note, requestId, ip,
  })
  return ok({ id, status: "REVERSED", amount }, requestId)
}
