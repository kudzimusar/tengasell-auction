// /api/trust/mfa/[action] — TOTP (IAM-004) state authority proxy. The MFA UX
// belongs to 12-e (/api/auth/security/*, TrailBase-native TOTP); this BFF
// surface exists so the trust-owned MFA state machine is reachable from the
// browser with the user's own TrailBase token (self-service + self-test):
//   POST enroll   → {secret, otpauth_uri}            (x-tgs-user)
//   POST activate → {code} → {recovery_codes[]}      (x-tgs-user)
//   POST verify   → {username, code} → {ok}          (self / admin / internal)
//   POST disable  → {code} → {ok}                    (x-tgs-user)
//   GET  status   → ?username= → {enrolled, active}  (self / admin)

import type { NextRequest } from "next/server";
import { trustProxy, trustJson } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POST_ACTIONS = new Set(["enroll", "activate", "verify", "disable"]);
const GET_ACTIONS = new Set(["status"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!POST_ACTIONS.has(action)) {
    return trustJson({ ok: false, error: "Unknown MFA action." }, 404);
  }
  const body = await req.json().catch(() => ({}));
  return trustProxy(req, `/mfa/${action}`, {
    body: body && typeof body === "object" ? body : {},
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!GET_ACTIONS.has(action)) {
    return trustJson({ ok: false, error: "Unknown MFA action." }, 404);
  }
  return trustProxy(req, `/mfa/status${req.nextUrl.search}`);
}
