// POST /api/trust/me/tickets/[id]/csat → CSAT after the ticket is resolved
// (SUP-014). Body: {score: 1–5, comment?} — service enforces resolved state
// + one rating per ticket.

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
  return trustProxy(req, `/me/tickets/${encodeURIComponent(id)}/csat`, { body });
}
