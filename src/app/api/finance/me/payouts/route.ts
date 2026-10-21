// GET  /api/finance/me/payouts → GET  :3006/me/payouts (my payout history)
// POST /api/finance/me/payouts → POST :3006/me/payouts
//   body: { amountCents|amount, method:"ecocash"|"bank", destination,
//           idNumber (REQUIRED — payout KYC), taxNumber?, note? }

import type { NextRequest } from "next/server";
import { financeJson, financeProxy } from "@/lib/server/finance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return financeProxy(req, "/me/payouts");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return financeJson({ ok: false, error: "Invalid request body." }, 400);
  }
  return financeProxy(req, "/me/payouts", { body });
}
