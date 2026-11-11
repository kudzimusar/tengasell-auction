import { NextRequest, NextResponse } from "next/server";
import { revokeAuthSession } from "@/lib/server/platform";

const TRAILBASE = process.env.TRAILBASE_URL ?? "http://localhost:3001";

function extractBearer(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

async function handleLogout(req: NextRequest) {
  const token = extractBearer(req);
  if (token) {
    try {
      await fetch(`${TRAILBASE}/api/auth/v1/logout`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      /* best effort — still record durable token revocation below */
    }
    // Token-specific revocation only (do NOT revoke subject so <1s re-login gets a fresh token).
    await revokeAuthSession({ token });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  return handleLogout(req);
}

export async function GET(req: NextRequest) {
  return handleLogout(req);
}
