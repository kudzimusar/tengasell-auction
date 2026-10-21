// POST /api/trust/me/tickets/[id]/reply → append a public message to my
// ticket (reopens a resolved ticket + resets the SLA clock).

import type { NextRequest } from "next/server";
import { trustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  return trustProxy(req, `/me/tickets/${encodeURIComponent(id)}/reply`, { body });
}
