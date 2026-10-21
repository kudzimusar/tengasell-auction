// GET /api/trust/me/tickets/[id] → my ticket thread (public messages only —
// internal notes are never exposed to the customer, SUP-007).

import type { NextRequest } from "next/server";
import { trustProxy } from "@/lib/server/trust";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return trustProxy(req, `/me/tickets/${encodeURIComponent(id)}`);
}
