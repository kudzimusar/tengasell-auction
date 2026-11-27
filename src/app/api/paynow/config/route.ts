import { NextResponse } from "next/server";
import { credentialsConfigured, mockPaymentsAllowed } from "@/lib/server/paynow";

// GET /api/paynow/config — PUBLIC payment capability descriptor.
//
// No authentication: the response carries no secrets and no per-order
// data — it tells the client which payment surface this deployment offers:
//   · mode: "live" (gateway credentials configured) | "sandbox"
//   · simulatedPayments: whether the simulated (non-gateway) methods —
//     EcoCash direct / ZIPIT / card forms / PayPal / COD — may be offered
//     in the checkout UI. False on any deployment where only the Paynow
//     gateway has settlement authority (production; R6 — no unsupported
//     payment method can falsely confirm a real payment).
//
// A deployment with neither live credentials nor allowed mock payments
// reports mode "sandbox" + simulatedPayments false → the client offers no
// payment method and surfaces a "gateway not configured" state instead of
// a fake checkout.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: credentialsConfigured() ? "live" : "sandbox",
    simulatedPayments: mockPaymentsAllowed(),
  });
}
