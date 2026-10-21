// POST /api/gov/public/acceptances — record a policy acceptance.
// NO AUTH required (anonymous acceptances are legal records too); when the
// caller IS signed in the BFF attaches their username to the body before
// forwarding (govern-service stores username NULL for anonymous).
// Body: {policy_key, version, surface?} (surface: signup|sell|policy_page).

import type { NextRequest } from "next/server";
import { govAcceptanceProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as { policy_key?: unknown }).policy_key !== "string") {
    return govJson({ ok: false, error: "policy_key is required." }, 400);
  }
  return govAcceptanceProxy(req, "/public/acceptances", { body });
}
