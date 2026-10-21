// GET /api/platform/admin/users?q= — user lookup (CTL-003).
//
// _user search via node:sqlite (records API on _user is closed by TrailBase),
// enriched with: profile stats (TrailBase profiles, world-readable), trust
// suspension + roles per user (2s budget each, fail-open → null), TrailBase
//-native MFA flag. Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { isResponse, requireAdmin, searchUsers, trustStatus } from "@/lib/server/platform";
import { tbList } from "@/lib/server/trailbase-admin";

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const rows = searchUsers(q, 40);
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, users: [] });
  }

  // profile stats in one read (profiles are world-readable records)
  const profiles = await tbList("profiles", { limit: 100 });
  const byName = new Map(profiles.map((p) => [String(p.username ?? "").toLowerCase(), p]));

  // trust status per user — parallel, hard 2s budget, fail-open
  const statuses = await Promise.all(rows.map((r) => trustStatus(r.username)));

  const users = rows.map((r, i) => {
    const p = byName.get(r.username.toLowerCase()) as Record<string, unknown> | undefined;
    const st = statuses[i];
    return {
      username: r.username,
      email: r.email,
      admin: r.admin,
      mfa_active: r.has_totp,
      created: new Date(r.created * 1000).toISOString(),
      profile: p
        ? {
            display_name: String(p.display_name ?? r.username),
            city: String(p.city ?? ""),
            sales: Number(p.sales ?? 0),
            rating_avg: Number(p.rating_avg ?? 0),
            rating_count: Number(p.rating_count ?? 0),
            verified: Number(p.verified ?? 0) === 1,
          }
        : null,
      suspended: st.available && st.suspended,
      suspension_reason: st.available && st.suspended ? st.reason ?? null : null,
      roles: st.available ? st.roles : [],
      trust_available: st.available,
    };
  });

  return NextResponse.json({ ok: true, users });
}
