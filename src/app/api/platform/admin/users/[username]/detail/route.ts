// GET /api/platform/admin/users/[username]/detail — account inspection
// (CTL-004/008): profile, order counts both sides, ratings, recent audit
// activity, suspension + MFA state. Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername, isResponse, requireAdmin, tbListCount, trustStatus } from "@/lib/server/platform";
import { tbGet, tbList } from "@/lib/server/trailbase-admin";

export async function GET(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const gate = await requireAdmin(req);
  if (isResponse(gate)) return gate;
  const { username } = await params;
  const uname = decodeURIComponent(username).toLowerCase();

  const row = findUserByUsername(uname);
  if (!row) {
    return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
  }

  const userB64 = Buffer.from(row.id_hex, "hex").toString("base64");
  const [profile, ordersBuying, ordersSelling, ratings, auditRows, status] = await Promise.all([
    tbGet("profiles", `filter[username][$eq]=${encodeURIComponent(uname)}`),
    tbListCount("orders", { "filter[buyer_username][$eq]": uname, limit: 1 }),
    tbListCount("orders", { "filter[seller_username][$eq]": uname, limit: 1 }),
    tbList("ratings", { "filter[ratee_username][$eq]": uname, order: "-created_at", limit: 200 }),
    tbList("audit_events", { "filter[user][$eq]": userB64, order: "-id", limit: 12 }),
    trustStatus(uname),
  ]);

  const p = (profile ?? null) as Record<string, unknown> | null;
  const ratingScores = ratings.map((r) => Number(r.score ?? 0));

  return NextResponse.json({
    ok: true,
    user: {
      username: row.username,
      email: row.email,
      admin: row.admin,
      mfa_active: row.has_totp,
      created: new Date(row.created * 1000).toISOString(),
      profile: p
        ? {
            display_name: String(p.display_name ?? row.username),
            bio: String(p.bio ?? ""),
            city: String(p.city ?? ""),
            sales: Number(p.sales ?? 0),
            rating_avg: Number(p.rating_avg ?? 0),
            rating_count: Number(p.rating_count ?? 0),
            verified: Number(p.verified ?? 0) === 1,
            joined_at: String(p.joined_at ?? ""),
          }
        : null,
      orders: { buying: ordersBuying.total, selling: ordersSelling.total },
      ratings: {
        count: ratingScores.length,
        avg: ratingScores.length ? Math.round((ratingScores.reduce((a, b) => a + b, 0) / ratingScores.length) * 10) / 10 : null,
      },
      suspended: status.available && status.suspended,
      suspension_reason: status.available && status.suspended ? status.reason ?? null : null,
      roles: status.available ? status.roles : [],
      trust_available: status.available,
      recent_audit: auditRows.map((r) => ({
        id: Number(r.id ?? 0),
        action: String(r.action ?? ""),
        entity: String(r.entity ?? ""),
        source: String(r.source ?? ""),
        at: String(r.created_at ?? ""),
      })),
    },
  });
}
