// POST /api/gov/admin/policies/[key]/[action] — editorial workflow.
//   action ∈ submit | approve | publish | unpublish | rollback
//     submit    draft|retired → in_review      (body: —)
//     approve   in_review   → approved          (body: —)
//     publish   approved    → published         (body: {at?} = scheduled ISO)
//     unpublish published   → retired           (public page 404s)
//     rollback  any         → copy of {toVersion} published as a new version
//                                                  (body: {toVersion, note?})

import type { NextRequest } from "next/server";
import { adminGovProxy, govJson } from "@/lib/server/gov";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set(["submit", "approve", "publish", "unpublish", "rollback"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string; action: string }> },
) {
  const { key, action } = await params;
  if (!ACTIONS.has(action)) {
    return govJson({ ok: false, error: "Unknown policy action." }, 404);
  }
  const body = await req.json().catch(() => ({}));
  return adminGovProxy(req, `/admin/policies/${encodeURIComponent(key)}/${action}`, {
    body,
  });
}
