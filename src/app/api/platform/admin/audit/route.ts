// GET /api/platform/admin/audit — the audit log console (CTL-018/024).
//
// Reads TrailBase audit_events with the admin token. Filters: source
// (web|agent|mcp|admin), action (LIKE), user (base64 uuid), days. Returns a
// page of rows (payload parsed) + the "Privileged actions (30d)" summary:
// counts by action for source="admin" plus account-security events.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, requireAdmin } from "@/lib/server/platform";
import { tbListCount } from "@/lib/server/platform";

const PAGE = 25;

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const sp = req.nextUrl.searchParams;
  const source = sp.get("source") ?? "";
  const action = (sp.get("action") ?? "").trim();
  const user = (sp.get("user") ?? "").trim();
  const days = Math.min(Math.max(Number(sp.get("days") ?? 30), 1), 365);
  const page = Math.max(Number(sp.get("page") ?? 1), 1);

  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");

  const params: Record<string, string | number> = {
    order: "-id",
    limit: PAGE,
    offset: (page - 1) * PAGE,
    "filter[created_at][$gte]": since,
  };
  if (source && source !== "all") params["filter[source][$eq]"] = source;
  if (action) params["filter[action][$like]"] = `%${action}%`;
  if (user) params["filter[user][$eq]"] = user;

  const { records, total } = await tbListCount("audit_events", params);

  const rows = records.map((r) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(String(r.payload ?? "{}")) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return {
      id: Number(r.id ?? 0),
      user: String(r.user ?? ""),
      action: String(r.action ?? ""),
      entity: String(r.entity ?? ""),
      entity_id: r.entity_id == null ? null : Number(r.entity_id),
      source: String(r.source ?? ""),
      payload,
      created_at: String(r.created_at ?? ""),
    };
  });

  // privileged-action summary (last 30 days): source=admin + account:* security events
  const since30 = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
  const [adminEvents, accountEvents] = await Promise.all([
    tbListCount("audit_events", {
      "filter[source][$eq]": "admin",
      "filter[created_at][$gte]": since30,
      limit: 500,
      order: "-id",
    }),
    tbListCount("audit_events", {
      "filter[action][$like]": "account:%",
      "filter[created_at][$gte]": since30,
      limit: 500,
      order: "-id",
    }),
  ]);
  const tally = (list: Record<string, unknown>[]) => {
    const m = new Map<string, number>();
    for (const r of list) {
      const a = String(r.action ?? "");
      m.set(a, (m.get(a) ?? 0) + 1);
    }
    return [...m.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count);
  };

  return NextResponse.json({
    ok: true,
    rows,
    page,
    page_size: PAGE,
    total,
    days,
    privileged: {
      admin_actions: tally(adminEvents.records),
      admin_total: adminEvents.total,
      account_events: tally(accountEvents.records),
      account_total: accountEvents.total,
    },
  });
}
