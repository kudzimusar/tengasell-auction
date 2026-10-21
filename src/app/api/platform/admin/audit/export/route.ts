// GET /api/platform/admin/audit/export — CSV export of the audit log
// (CTL-025 / DAT-011). Same filters as the console, capped at 5000 rows.
// Admin-only, audit-logged as an export event (data-access trail).

import { NextRequest, NextResponse } from "next/server";
import { csvOf, csvResponse, isResponse, requireAdmin, userB64For, writeAudit } from "@/lib/server/platform";
import { tbList } from "@/lib/server/trailbase-admin";

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const sp = req.nextUrl.searchParams;
  const source = sp.get("source") ?? "";
  const action = (sp.get("action") ?? "").trim();
  const days = Math.min(Math.max(Number(sp.get("days") ?? 30), 1), 365);
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");

  const params: Record<string, string | number> = {
    order: "-id",
    limit: 5000,
    "filter[created_at][$gte]": since,
  };
  if (source && source !== "all") params["filter[source][$eq]"] = source;
  if (action) params["filter[action][$like]"] = `%${action}%`;

  const records = await tbList("audit_events", params);
  const rows: (string | number | null)[][] = [
    ["id", "at", "source", "action", "entity", "entity_id", "user", "payload"],
  ];
  for (const r of records) {
    rows.push([
      Number(r.id ?? 0),
      String(r.created_at ?? ""),
      String(r.source ?? ""),
      String(r.action ?? ""),
      String(r.entity ?? ""),
      r.entity_id == null ? "" : Number(r.entity_id),
      String(r.user ?? ""),
      String(r.payload ?? ""),
    ]);
  }

  await writeAudit({
    user: userB64For(gate.username),
    action: "platform:audit_export",
    entity: "audit_events",
    source: "admin",
    payload: { rows: records.length, days, source, actor: gate.username },
  });

  return csvResponse(csvOf(rows), `tengasell-audit-${new Date().toISOString().slice(0, 10)}.csv`);
}
